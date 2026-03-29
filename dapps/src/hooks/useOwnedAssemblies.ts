import { useQuery } from '@tanstack/react-query'
import { executeGraphQLQuery, getOwnedObjectsByType } from '@evefrontier/dapp-kit'
import { WORLD_PKG } from '../env'

export interface AssemblyDetails {
  /** Player-set custom name (from on-chain metadata) */
  customName: string
  /** Player-set description (from on-chain metadata) */
  description: string
  /** Game type name from datahub (e.g. "Mini Storage", "Refinery") */
  typeName: string
  typeId: string
  status: string
  locationHash: string
  extension: string | null
  dappUrl: string
}

export interface OwnedAssembly {
  id: string
  ownerCapId: string
  type: 'gate' | 'turret' | 'ssu' | 'assembly' | 'unknown'
  details: AssemblyDetails | null
}

export interface OwnedAssemblies {
  characterId: string | null
  assemblies: OwnedAssembly[]
  gates: string[]
  turrets: string[]
  ssus: string[]
}

function classifyOwnerCapType(typeRepr: string): OwnedAssembly['type'] {
  if (typeRepr.includes('::gate::Gate')) return 'gate'
  if (typeRepr.includes('::turret::Turret')) return 'turret'
  if (typeRepr.includes('::storage_unit::StorageUnit')) return 'ssu'
  if (typeRepr.includes('::assembly::Assembly')) return 'assembly'
  return 'unknown'
}

function parseStatus(status: unknown): string {
  if (!status || typeof status !== 'object') return 'unknown'
  const s = status as { status?: { '@variant'?: string } }
  return s.status?.['@variant'] ?? 'unknown'
}

function parseDetails(json: Record<string, unknown>, typeName: string): AssemblyDetails {
  const metadata = json.metadata as Record<string, string> | undefined
  return {
    customName: metadata?.name || '',
    description: metadata?.description || '',
    typeName,
    typeId: (json.type_id as string) ?? '',
    status: parseStatus(json.status),
    locationHash: (json.location as { location_hash?: string })?.location_hash ?? '',
    extension: (json.extension as string) ?? null,
    dappUrl: metadata?.url || '',
  }
}

/** Display name: custom name if set, otherwise game type name */
export function displayName(a: OwnedAssembly): string {
  if (!a.details) return a.id.slice(0, 10) + '…'
  return a.details.customName || a.details.typeName || `Type #${a.details.typeId}`
}

// Fetch game type names from datahub API
async function fetchTypeNames(typeIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(typeIds.filter(Boolean))]
  const map = new Map<string, string>()
  await Promise.all(
    unique.map(async (tid) => {
      try {
        const res = await fetch(
          `https://world-api-stillness.live.tech.evefrontier.com/v2/types/${tid}`,
        )
        if (!res.ok) return
        const data = await res.json()
        if (data.name) map.set(tid, data.name)
      } catch {
        // ignore — we'll fall back to type ID
      }
    }),
  )
  return map
}

// Batch-fetch assembly details in a single GraphQL query
async function fetchAssemblyDetails(
  ids: string[],
): Promise<Map<string, { json: Record<string, unknown>; typeId: string }>> {
  if (ids.length === 0) return new Map()

  const fragments = ids.map(
    (id, i) =>
      `a${i}: object(address: "${id}") { asMoveObject { contents { type { repr } json } } }`,
  )
  const query = `query { ${fragments.join('\n')} }`

  const res = await executeGraphQLQuery<Record<string, {
    asMoveObject?: { contents?: { type?: { repr: string }; json?: Record<string, unknown> } }
  }>>(query, {})

  const map = new Map<string, { json: Record<string, unknown>; typeId: string }>()
  ids.forEach((id, i) => {
    const obj = res.data?.[`a${i}`]?.asMoveObject?.contents?.json
    if (obj) {
      map.set(id, { json: obj, typeId: (obj.type_id as string) ?? '' })
    }
  })
  return map
}

/**
 * Discovers assemblies owned by the connected wallet's Character.
 * Fetches full details including game type names from the datahub API.
 */
export function useOwnedAssemblies(walletAddress: string | null | undefined) {
  return useQuery({
    queryKey: ['owned-assemblies', walletAddress],
    enabled: Boolean(walletAddress),
    queryFn: async (): Promise<OwnedAssemblies> => {
      // Step 1: Find PlayerProfile → character_id
      const profileType = `${WORLD_PKG}::character::PlayerProfile`
      const profileRes = await getOwnedObjectsByType(walletAddress!, profileType)
      const profileAddress = profileRes.data?.address?.objects?.nodes?.[0]?.address
      if (!profileAddress) {
        return { characterId: null, assemblies: [], gates: [], turrets: [], ssus: [] }
      }

      const profileObj = await executeGraphQLQuery<{
        object: { asMoveObject: { contents: { json: { character_id: string } } } }
      }>(
        `query ($addr: SuiAddress!) { object(address: $addr) { asMoveObject { contents { json } } } }`,
        { addr: profileAddress },
      )
      const characterId = profileObj.data?.object?.asMoveObject?.contents?.json?.character_id
      if (!characterId) {
        return { characterId: null, assemblies: [], gates: [], turrets: [], ssus: [] }
      }

      // Step 2: Get ALL OwnerCaps owned by the Character
      const ownedRes = await executeGraphQLQuery<{
        address: {
          objects: {
            nodes: Array<{
              address: string
              contents: { type: { repr: string }; json: { authorized_object_id: string } }
            }>
          }
        }
      }>(
        `query ($charAddr: SuiAddress!) {
          address(address: $charAddr) {
            objects {
              nodes {
                address
                contents { type { repr } json }
              }
            }
          }
        }`,
        { charAddr: characterId },
      )

      const ownedNodes = ownedRes.data?.address?.objects?.nodes ?? []

      const basicAssemblies: Array<{ id: string; ownerCapId: string; type: OwnedAssembly['type'] }> = []
      for (const node of ownedNodes) {
        const typeRepr = node.contents?.type?.repr ?? ''
        if (!typeRepr.includes('::access::OwnerCap<')) continue
        const assemblyType = classifyOwnerCapType(typeRepr)
        if (assemblyType === 'unknown') continue
        const assemblyId = node.contents?.json?.authorized_object_id
        if (!assemblyId) continue
        basicAssemblies.push({ id: assemblyId, ownerCapId: node.address, type: assemblyType })
      }

      // Step 3: Batch-fetch on-chain details
      const rawDetails = await fetchAssemblyDetails(basicAssemblies.map((a) => a.id))

      // Step 4: Fetch game type names from datahub
      const typeIds = [...rawDetails.values()].map((d) => d.typeId)
      const typeNames = await fetchTypeNames(typeIds)

      // Step 5: Combine everything
      const assemblies: OwnedAssembly[] = basicAssemblies.map((a) => {
        const raw = rawDetails.get(a.id)
        if (!raw) return { ...a, details: null }
        const typeName = typeNames.get(raw.typeId) ?? ''
        return { ...a, details: parseDetails(raw.json, typeName) }
      })

      return {
        characterId,
        assemblies,
        gates: assemblies.filter((a) => a.type === 'gate').map((a) => a.id),
        turrets: assemblies.filter((a) => a.type === 'turret').map((a) => a.id),
        ssus: assemblies.filter((a) => a.type === 'ssu' || a.type === 'assembly').map((a) => a.id),
      }
    },
    staleTime: 60_000,
  })
}
