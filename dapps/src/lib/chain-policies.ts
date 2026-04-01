/**
 * Read on-chain policies from AssemblyBinding objects.
 * Shared between InGameView and Overview.
 */
import { executeGraphQLQuery } from '@evefrontier/dapp-kit'
import { EFGUARD_PKG, DATAHUB_API_URL } from '../env'
import { lookupCharacterByGameId } from './character-lookup'

export interface OnChainRule {
  conditionId: string
  effect: 'Allow' | 'Deny'
  label: string
}

export interface OnChainAssemblyPolicy {
  assemblyId: string
  assemblyName: string | null
  gameItemId: string | null
  assemblyType: 'gate' | 'ssu' | 'turret' | 'unknown'
  rules: OnChainRule[]
}

export interface BindingSummary {
  bindingId: string
  owner: string
  assemblies: string[]
  policies: OnChainAssemblyPolicy[]
}

let tribesCache: Array<{ id: number; name: string; nameShort: string }> | null = null

async function getTribes(): Promise<Array<{ id: number; name: string; nameShort: string }>> {
  if (tribesCache) return tribesCache
  try {
    const res = await fetch(`${DATAHUB_API_URL}/v2/tribes?limit=500`)
    const data = await res.json()
    tribesCache = data.data ?? []
  } catch {
    tribesCache = []
  }
  return tribesCache!
}

async function resolveConditionLabels(conditionIds: string[]): Promise<Map<string, string>> {
  const labels = new Map<string, string>()
  if (conditionIds.length === 0) return labels

  for (const id of conditionIds) {
    try {
      const res = await executeGraphQLQuery<{
        object: { asMoveObject: { contents: { json: any; type: { repr: string } } } }
      }>(
        `query ($id: SuiAddress!) { object(address: $id) { asMoveObject { contents { json type { repr } } } } }`,
        { id },
      )
      const typeRepr = res.data?.object?.asMoveObject?.contents?.type?.repr ?? ''
      const json = res.data?.object?.asMoveObject?.contents?.json ?? {}

      if (typeRepr.includes('EveryoneCondition')) {
        labels.set(id, 'Everyone')
      } else if (typeRepr.includes('TribeCondition')) {
        const tribeId = json.tribe_id
        let tribeName = `Tribe #${tribeId ?? '?'}`
        if (tribeId) {
          try {
            const tribes = await getTribes()
            const tribe = tribes.find((t) => String(t.id) === String(tribeId))
            if (tribe) tribeName = `[${tribe.nameShort}] ${tribe.name}`
          } catch { /* fall back to ID */ }
        }
        labels.set(id, tribeName)
      } else if (typeRepr.includes('CharacterCondition')) {
        const charGameId = json.char_game_id
        let charName = `Player #${charGameId ?? '?'}`
        if (charGameId) {
          try {
            const result = await lookupCharacterByGameId(String(charGameId))
            if (result?.name) charName = `${result.name} (#${charGameId})`
          } catch { /* fall back to ID */ }
        }
        labels.set(id, charName)
      } else if (typeRepr.includes('MinBalanceCondition')) {
        labels.set(id, `Min Balance: ${json.min_amount ?? '?'}`)
      } else if (typeRepr.includes('TokenHolderCondition')) {
        labels.set(id, 'Token Holder')
      } else if (typeRepr.includes('AttestationCondition')) {
        labels.set(id, 'Signed Attestation')
      } else {
        labels.set(id, 'Custom Condition')
      }
    } catch {
      labels.set(id, `Condition ${id.slice(0, 8)}...`)
    }
  }

  return labels
}

function parseRules(rawRules: any[]): { conditionId: string; effectStr: 'Allow' | 'Deny' }[] {
  return rawRules.map((r: any) => {
    const eff = r.effect
    // Sui GraphQL represents Move enums as {"@variant": "Allow"} or {"Allow": ...}
    const isAllow = eff?.['@variant'] === 'Allow' || eff?.Allow !== undefined
    return {
      conditionId: r.condition_id,
      effectStr: isAllow ? 'Allow' as const : 'Deny' as const,
    }
  })
}

interface AssemblyMeta { name: string | null; gameItemId: string | null; assemblyType: 'gate' | 'ssu' | 'turret' | 'unknown' }

async function resolveAssemblyMeta(assemblyIds: string[]): Promise<Map<string, AssemblyMeta>> {
  const meta = new Map<string, AssemblyMeta>()
  if (assemblyIds.length === 0) return meta

  for (const id of assemblyIds) {
    try {
      const res = await executeGraphQLQuery<{
        object: { asMoveObject: { contents: { json: any; type: { repr: string } } } }
      }>(
        `query ($id: SuiAddress!) { object(address: $id) { asMoveObject { contents { json type { repr } } } } }`,
        { id },
      )
      const json = res.data?.object?.asMoveObject?.contents?.json
      const typeRepr = res.data?.object?.asMoveObject?.contents?.type?.repr ?? ''
      let assemblyType: AssemblyMeta['assemblyType'] = 'unknown'
      if (typeRepr.includes('gate::Gate')) assemblyType = 'gate'
      else if (typeRepr.includes('storage_unit::StorageUnit')) assemblyType = 'ssu'
      else if (typeRepr.includes('turret::Turret')) assemblyType = 'turret'
      meta.set(id, {
        name: json?.metadata?.name ?? null,
        gameItemId: json?.key?.item_id ? String(json.key.item_id) : null,
        assemblyType,
      })
    } catch { /* ignore */ }
  }

  return meta
}

/** Fetch all bindings and their policies from chain. */
export async function fetchAllBindings(): Promise<BindingSummary[]> {
  const bindingType = `${EFGUARD_PKG}::assembly_binding::AssemblyBinding`

  const res = await executeGraphQLQuery<{
    objects: { nodes: Array<{ address: string; asMoveObject: { contents: { json: any } } }> }
  }>(
    `query ($type: String!) { objects(filter: { type: $type }, first: 20) { nodes { address asMoveObject { contents { json } } } } }`,
    { type: bindingType },
  )


  const nodes = res.data?.objects?.nodes ?? []
  const summaries: BindingSummary[] = []


  for (const n of nodes) {
    const json = n.asMoveObject?.contents?.json
    if (!json) continue

    const allIds = [
      ...(json.gates?.contents ?? []),
      ...(json.turrets?.contents ?? []),
      ...(json.storage_units?.contents ?? []),
    ]

    const policyEntries = json.policies?.contents ?? []
    const allConditionIds = new Set<string>()
    for (const p of policyEntries) {
      for (const r of p.value?.rules ?? []) {
        if (r.condition_id) allConditionIds.add(r.condition_id)
      }
    }

    const conditionLabels = await resolveConditionLabels([...allConditionIds])
    const assemblyMeta = await resolveAssemblyMeta(allIds)

    const policies: OnChainAssemblyPolicy[] = policyEntries.map((p: any) => {
      const parsed = parseRules(p.value?.rules ?? [])
      const am = assemblyMeta.get(p.key)
      return {
        assemblyId: p.key,
        assemblyName: am?.name ?? null,
        gameItemId: am?.gameItemId ?? null,
        assemblyType: am?.assemblyType ?? 'unknown',
        rules: parsed.map((r) => ({
          conditionId: r.conditionId,
          effect: r.effectStr,
          label: conditionLabels.get(r.conditionId) ?? `Condition ${r.conditionId?.slice(0, 8)}...`,
        })),
      }
    })

    summaries.push({
      bindingId: n.address,
      owner: json.owner ?? '',
      assemblies: allIds,
      policies,
    })
  }

  return summaries
}

/** Fetch policies for a single assembly by finding its binding. */
export async function fetchPoliciesForAssembly(assemblyId: string): Promise<OnChainRule[]> {
  const bindings = await fetchAllBindings()
  for (const b of bindings) {
    const policy = b.policies.find((p) => p.assemblyId === assemblyId)
    if (policy) return policy.rules
  }
  return []
}
