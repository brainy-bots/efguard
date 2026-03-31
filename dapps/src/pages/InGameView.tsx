/**
 * In-game assembly view — matches EVE Frontier's UI style.
 * Route: #/ingame
 *
 * Reads all data from chain (no localStorage dependency), so it works
 * identically in the in-game browser and regular browsers.
 * Uses useSmartObject() from dapp-kit to get the building the game passes via ?itemId=
 */
import { useState, useEffect } from 'react'
import { useConnection, useSmartObject } from '@evefrontier/dapp-kit'
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

export function InGameView() {
  const { isConnected, handleConnect, hasEveVault } = useConnection()
  const { assembly, loading: assemblyLoading } = useSmartObject()

  const [rules, setRules] = useState<OnChainRule[]>([])
  const [rulesLoading, setRulesLoading] = useState(false)

  useEffect(() => {
    if (!isConnected && hasEveVault) handleConnect()
  }, [isConnected, hasEveVault, handleConnect])

  // Fetch on-chain rules when assembly is resolved
  const assemblyId = assembly?.id ?? null
  useEffect(() => {
    if (!assemblyId) return
    setRulesLoading(true)
    fetchPoliciesForAssembly(assemblyId)
      .then(setRules)
      .catch(console.error)
      .finally(() => setRulesLoading(false))
  }, [assemblyId])

  const loading = assemblyLoading || rulesLoading
  const name = assembly?.name ?? 'Building'
  const status = assembly?.state === 'online' ? 'ONLINE' : assembly ? 'OFFLINE' : null
  const raw = assembly?._raw?.contents?.json as Record<string, any> | undefined
  const hasExtension = !!raw?.extension

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

          {isConnected && !assembly && !loading && (
            <div style={panelStyle}>
              <div style={headerStyle}>ef guard</div>
              <div style={{ padding: '20px', color: C.textMuted, textAlign: 'center' }}>
                This building has ef guard access control installed.
                Interact with a specific building to see its rules.
              </div>
            </div>
          )}

          {isConnected && assembly && !loading && (
            <>
              <div style={{ ...panelStyle, marginBottom: 8 }}>
                <div style={headerStyle}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{name}</span>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                      <span style={{ color: status === 'ONLINE' ? C.green : C.red }}>
                        {status ?? '?'}
                      </span>
                      {hasExtension && (
                        <span style={{ color: C.orange }}>PROTECTED</span>
                      )}
                    </div>
                  </div>
                </div>
                {assembly.description && (
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
                    {hasExtension ? 'No rules configured — all access denied by default.' : 'No ef guard extension installed.'}
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
