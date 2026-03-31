/**
 * In-game assembly view — matches EVE Frontier's UI style.
 * Route: #/ingame
 *
 * Reads all data from chain (no localStorage dependency), so it works
 * identically in the in-game browser and regular browsers.
 */
import { useState, useEffect } from 'react'
import { useConnection, executeGraphQLQuery } from '@evefrontier/dapp-kit'
import { fetchPoliciesForAssembly, type OnChainRule } from '../lib/chain-policies'
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

interface AssemblyInfo {
  name: string | null
  description: string | null
  status: string | null
  hasExtension: boolean
}

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

          {isConnected && !itemId && !loading && (
            <div style={panelStyle}>
              <div style={headerStyle}>ef guard</div>
              <div style={{ padding: '20px', color: C.textMuted, textAlign: 'center' }}>
                This building has ef guard access control installed.
                Interact with a specific building to see its rules.
              </div>
            </div>
          )}

          {isConnected && !loading && itemId && (
            <>
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

      <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', padding: '8px 16px', borderTop: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', opacity: 0.6 }}>
          <img src="./logo.png" alt="ef guard" style={{ height: '20px' }} />
          <span style={{ color: '#d0d0d0', fontWeight: 700, fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase' }}>EF GUARD</span>
        </div>
      </div>
    </div>
  )
}
