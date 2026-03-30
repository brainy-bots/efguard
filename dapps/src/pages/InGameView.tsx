/**
 * In-game assembly view — matches EVE Frontier's UI style.
 * Route: #/ingame
 *
 * Reads all data from chain (no localStorage dependency), so it works
 * identically in the in-game browser and regular browsers.
 */
import { useState, useEffect } from 'react'
import { useConnection, executeGraphQLQuery } from '@evefrontier/dapp-kit'
import { EFGUARD_PKG } from '../env'
import { AsciiBackground } from '../components/AsciiBackground'

const C = {
  bg: '#111318',
  panelBg: 'rgba(23, 27, 34, 0.85)',
  headerBg: 'rgba(26, 30, 38, 0.9)',
  border: '#252a33',
  orange: '#d4710a',
  textPrimary: '#d0d0d0',
  textSecondary: '#808890',
  textMuted: '#505860',
  green: '#44b840',
  red: '#c83030',
}

const panelStyle = { background: C.panelBg, border: `1px solid ${C.border}`, backdropFilter: 'blur(4px)' }
const headerStyle = { background: C.headerBg, borderBottom: `1px solid ${C.border}`, color: C.orange, fontSize: '10px', letterSpacing: '0.12em', fontWeight: 700, textTransform: 'uppercase' as const, padding: '6px 10px' }
const rowStyle = { borderBottom: `1px solid ${C.border}`, padding: '5px 10px', display: 'flex' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const }

// ── Chain data types ────────────────────────────────────────────────────────

interface OnChainRule {
  conditionId: string
  effect: 'Allow' | 'Deny'
  label: string
}

interface AssemblyInfo {
  name: string | null
  description: string | null
  status: string | null
  hasExtension: boolean
}

// ── Chain queries ───────────────────────────────────────────────────────────

async function fetchAssemblyInfo(assemblyId: string): Promise<AssemblyInfo | null> {
  try {
    const res = await executeGraphQLQuery<{
      object: { asMoveObject: { contents: { json: any; type: { repr: string } } } }
    }>(
      `query ($id: SuiAddress!) { object(address: $id) { asMoveObject { contents { json type { repr } } } } }`,
      { id: assemblyId },
    )
    const json = res.data?.object?.asMoveObject?.contents?.json
    if (!json) return null
    const metadata = json.metadata ?? {}
    return {
      name: metadata.name ?? null,
      description: metadata.description ?? null,
      status: json.status?.is_online ? 'ONLINE' : 'OFFLINE',
      hasExtension: !!json.extension,
    }
  } catch {
    return null
  }
}

async function fetchPoliciesForAssembly(assemblyId: string): Promise<OnChainRule[]> {
  // Find binding that has this assembly registered
  const bindingType = `${EFGUARD_PKG}::assembly_binding::AssemblyBinding`
  const bindingRes = await executeGraphQLQuery<{
    objects: { nodes: Array<{ address: string; asMoveObject: { contents: { json: any } } }> }
  }>(
    `query ($type: String!) { objects(filter: { type: $type }, first: 20) { nodes { address asMoveObject { contents { json } } } } }`,
    { type: bindingType },
  )

  const nodes = bindingRes.data?.objects?.nodes ?? []
  let binding: any = null
  for (const n of nodes) {
    const json = n.asMoveObject?.contents?.json
    if (!json) continue
    const allIds = [
      ...(json.gates?.contents ?? []),
      ...(json.turrets?.contents ?? []),
      ...(json.storage_units?.contents ?? []),
    ]
    if (allIds.includes(assemblyId)) {
      binding = json
      break
    }
  }

  if (!binding) return []

  // Find policy for this assembly
  const policies = binding.policies?.contents ?? []
  const policyEntry = policies.find((p: any) => p.key === assemblyId)
  if (!policyEntry) return []

  const rules = policyEntry.value?.rules ?? []

  // Resolve condition labels
  const conditionIds = rules.map((r: any) => r.condition_id).filter(Boolean)
  const conditionLabels = await resolveConditionLabels(conditionIds)

  return rules.map((r: any) => {
    const effect = r.effect?.Allow !== undefined ? 'Allow' : 'Deny'
    return {
      conditionId: r.condition_id,
      effect,
      label: conditionLabels.get(r.condition_id) ?? `Condition ${r.condition_id?.slice(0, 8)}...`,
    } as OnChainRule
  })
}

async function resolveConditionLabels(conditionIds: string[]): Promise<Map<string, string>> {
  const labels = new Map<string, string>()
  if (conditionIds.length === 0) return labels

  // Fetch each condition object to determine its type and params
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
        labels.set(id, `Tribe #${json.tribe_id ?? '?'}`)
      } else if (typeRepr.includes('CharacterCondition')) {
        labels.set(id, `Player #${json.char_game_id ?? '?'}`)
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

// ── Component ───────────────────────────────────────────────────────────────

export function InGameView({ itemId }: { itemId: string | null }) {
  const { isConnected, handleConnect, hasEveVault } = useConnection()

  const [assembly, setAssembly] = useState<AssemblyInfo | null>(null)
  const [rules, setRules] = useState<OnChainRule[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isConnected && hasEveVault) handleConnect()
  }, [isConnected, hasEveVault, handleConnect])

  useEffect(() => {
    if (!itemId) { setLoading(false); return }

    let cancelled = false
    setLoading(true)

    Promise.all([
      fetchAssemblyInfo(itemId),
      fetchPoliciesForAssembly(itemId),
    ]).then(([info, chainRules]) => {
      if (cancelled) return
      setAssembly(info)
      setRules(chainRules)
    }).catch(console.error).finally(() => {
      if (!cancelled) setLoading(false)
    })

    return () => { cancelled = true }
  }, [itemId])

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.textPrimary, fontFamily: "'Segoe UI', 'Arial Narrow', Arial, sans-serif", fontSize: '11px', position: 'relative', display: 'flex', flexDirection: 'column' }}>
      <AsciiBackground />

      <div style={{ position: 'relative', zIndex: 1, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 60px' }}>
        <div style={{ width: '100%', maxWidth: '480px' }}>

          {/* Loading / not connected */}
          {!isConnected && (
            <div style={panelStyle}>
              <div style={{ padding: '20px', color: C.textMuted, textAlign: 'center' }}>Connecting wallet...</div>
            </div>
          )}

          {isConnected && loading && (
            <div style={panelStyle}>
              <div style={{ padding: '20px', color: C.textMuted, textAlign: 'center' }}>Loading building data...</div>
            </div>
          )}

          {/* No itemId */}
          {isConnected && !itemId && !loading && (
            <div style={panelStyle}>
              <div style={headerStyle}>ef guard</div>
              <div style={{ padding: '20px', color: C.textMuted, textAlign: 'center' }}>
                This building has ef guard access control installed.
                Interact with a specific building to see its rules.
              </div>
            </div>
          )}

          {/* Building view */}
          {isConnected && !loading && itemId && (
            <>
              {/* Building status */}
              <div style={{ ...panelStyle, marginBottom: 8 }}>
                <div style={headerStyle}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{assembly?.name ?? 'Building'}</span>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                      <span style={{ color: assembly?.status === 'ONLINE' ? C.green : C.red }}>
                        {assembly?.status ?? '?'}
                      </span>
                      {assembly?.hasExtension && (
                        <span style={{ color: C.orange }}>PROTECTED</span>
                      )}
                    </div>
                  </div>
                </div>
                {assembly?.description && (
                  <div style={{ ...rowStyle, borderBottom: 'none' }}>
                    <span style={{ color: C.textSecondary }}>{assembly.description}</span>
                  </div>
                )}
              </div>

              {/* Access rules */}
              <div style={{ ...panelStyle, marginBottom: 8 }}>
                <div style={headerStyle}>Access Rules</div>
                {rules.length > 0 ? (
                  rules.map((r, i) => (
                    <div key={r.conditionId} style={{ ...rowStyle, ...(i === rules.length - 1 ? { borderBottom: 'none' } : {}) }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ color: C.textMuted, width: '16px' }}>{String(i + 1).padStart(2, '0')}</span>
                        <span style={{ color: C.textPrimary, fontSize: '11px' }}>{r.label}</span>
                      </div>
                      <span style={{ color: r.effect === 'Allow' ? C.green : C.red, fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                        {r.effect}
                      </span>
                    </div>
                  ))
                ) : (
                  <div style={{ padding: '12px 10px', color: C.textMuted }}>
                    {assembly?.hasExtension ? 'No rules configured — all access denied by default.' : 'No ef guard extension installed.'}
                  </div>
                )}
              </div>
            </>
          )}

        </div>
      </div>

      {/* Footer */}
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', padding: '8px 16px', borderTop: `1px solid ${C.border}` }}>
        <img src="./logo-with-text.png" alt="ef guard" style={{ height: '16px', opacity: 0.4 }} />
      </div>
    </div>
  )
}
