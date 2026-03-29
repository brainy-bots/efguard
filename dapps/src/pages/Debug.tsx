import { useEffect, useState } from 'react'
import { useConnection, executeGraphQLQuery, getOwnedObjectsByType } from '@evefrontier/dapp-kit'
import { WORLD_PKG } from '../env'

interface DebugState {
  walletAddress: string | null
  profileAddress: string | null
  characterId: string | null
  ownedObjects: Array<{ address: string; type: string; json: unknown }>
  errors: string[]
  loading: boolean
}

export function Debug() {
  const { walletAddress, isConnected } = useConnection()
  const [state, setState] = useState<DebugState>({
    walletAddress: null, profileAddress: null, characterId: null,
    ownedObjects: [], errors: [], loading: false,
  })

  useEffect(() => {
    if (!isConnected || !walletAddress) return
    run()

    async function run() {
      setState((s) => ({ ...s, walletAddress: walletAddress ?? null, loading: true, errors: [] }))
      const errors: string[] = []

      try {
        // Step 1: Find PlayerProfile
        const profileType = `${WORLD_PKG}::character::PlayerProfile`
        const profileRes = await getOwnedObjectsByType(walletAddress!, profileType)
        const profileAddr = profileRes.data?.address?.objects?.nodes?.[0]?.address ?? null

        if (!profileAddr) {
          errors.push(`No PlayerProfile found for wallet. Type queried: ${profileType}`)
        }
        setState((s) => ({ ...s, profileAddress: profileAddr }))

        if (!profileAddr) {
          setState((s) => ({ ...s, errors, loading: false }))
          return
        }

        // Step 2: Read character_id from PlayerProfile
        const profileObj = await executeGraphQLQuery<{
          object: { asMoveObject: { contents: { json: Record<string, unknown> } } } | null
        }>(
          `query ($addr: SuiAddress!) { object(address: $addr) { asMoveObject { contents { json } } } }`,
          { addr: profileAddr },
        )
        const profileJson = profileObj.data?.object?.asMoveObject?.contents?.json
        const charId = (profileJson as { character_id?: string })?.character_id ?? null

        if (!charId) {
          errors.push(`PlayerProfile found (${profileAddr}) but no character_id in JSON: ${JSON.stringify(profileJson)}`)
        }
        setState((s) => ({ ...s, characterId: charId }))

        if (!charId) {
          setState((s) => ({ ...s, errors, loading: false }))
          return
        }

        // Step 3: Get ALL objects owned by Character
        const ownedRes = await executeGraphQLQuery<{
          address: { objects: { nodes: Array<{ address: string; contents: { type: { repr: string }; json: unknown } }> } } | null
        }>(
          `query ($addr: SuiAddress!) {
            address(address: $addr) {
              objects {
                nodes {
                  address
                  contents { type { repr } json }
                }
              }
            }
          }`,
          { addr: charId },
        )

        const nodes = ownedRes.data?.address?.objects?.nodes ?? []
        const ownedObjects = nodes.map((n) => ({
          address: n.address,
          type: n.contents?.type?.repr ?? 'unknown',
          json: n.contents?.json,
        }))

        if (ownedObjects.length === 0) {
          errors.push(`Character (${charId}) owns 0 objects`)
        }

        setState((s) => ({ ...s, ownedObjects, errors, loading: false }))
      } catch (err) {
        errors.push(`Exception: ${err instanceof Error ? err.message : String(err)}`)
        setState((s) => ({ ...s, errors, loading: false }))
      }
    }
  }, [walletAddress, isConnected])

  if (!isConnected) {
    return <div className="p-6 text-default">Connect wallet to see debug info.</div>
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <h1 className="text-xl font-bold">Debug: Chain Data</h1>

      <Section title="Wallet">
        <KV label="Address" value={state.walletAddress} />
        <KV label="WORLD_PKG" value={WORLD_PKG} />
        <KV label="VITE_EVE_WORLD_PACKAGE_ID" value={import.meta.env.VITE_EVE_WORLD_PACKAGE_ID ?? '(not set)'} />
      </Section>

      <Section title="PlayerProfile">
        <KV label="Profile address" value={state.profileAddress ?? '(not found)'} />
      </Section>

      <Section title="Character">
        <KV label="Character ID" value={state.characterId ?? '(not found)'} />
      </Section>

      {state.errors.length > 0 && (
        <Section title="Errors">
          {state.errors.map((e, i) => (
            <div key={i} className="text-red-400 text-sm font-mono break-all">{e}</div>
          ))}
        </Section>
      )}

      <Section title={`Objects owned by Character (${state.ownedObjects.length})`}>
        {state.loading && <div className="text-default">Loading...</div>}
        {state.ownedObjects.map((obj) => (
          <details key={obj.address} className="border border-surface-2 rounded p-2 mb-2">
            <summary className="text-sm font-mono cursor-pointer">
              <span className="text-accent">{shortType(obj.type)}</span>
              {' — '}
              <span className="text-surface-3">{obj.address}</span>
            </summary>
            <pre className="text-xs text-surface-3 mt-2 overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(obj.json, null, 2)}
            </pre>
          </details>
        ))}
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-surface-2 rounded p-4">
      <h2 className="text-sm font-semibold text-accent mb-2">{title}</h2>
      {children}
    </div>
  )
}

function KV({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="text-sm mb-1">
      <span className="text-default">{label}: </span>
      <span className="font-mono text-surface-3 break-all">{value ?? '—'}</span>
    </div>
  )
}

function shortType(repr: string): string {
  const match = repr.match(/::\w+::\w+(?:<.*>)?$/)
  return match ? match[0].slice(2) : repr
}
