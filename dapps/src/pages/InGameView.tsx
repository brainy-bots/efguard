/**
 * In-game assembly view — matches EVE Frontier's UI style.
 * Route: #/ingame
 */
import { useEffect } from 'react'
import { useConnection } from '@evefrontier/dapp-kit'
import { useOwnedAssemblies, displayName } from '../hooks/useOwnedAssemblies'
import { useRules } from '../hooks/useRules'
import { usePolicies } from '../hooks/usePolicies'
import { useBuildingGroups } from '../hooks/useBuildingGroups'

// EVE Frontier UI color tokens (matched from screenshot)
const C = {
  bg: '#111318',
  panelBg: '#171b22',
  headerBg: '#1a1e26',
  border: '#252a33',
  borderLight: '#2e3440',
  orange: '#d4710a',
  orangeHover: '#e87b00',
  orangeDim: '#7a4200',
  textPrimary: '#d0d0d0',
  textSecondary: '#808890',
  textMuted: '#505860',
  green: '#44b840',
  red: '#c83030',
}

export function InGameView({ itemId }: { itemId: string | null }) {
  const { walletAddress, isConnected, handleConnect, hasEveVault } = useConnection()
  const { data: owned } = useOwnedAssemblies(walletAddress)
  const { rules } = useRules(walletAddress)
  const { policies } = usePolicies(walletAddress)
  const { groups } = useBuildingGroups(walletAddress)

  useEffect(() => {
    if (!isConnected && hasEveVault) handleConnect()
  }, [isConnected, hasEveVault, handleConnect])

  const assembly = itemId
    ? owned?.assemblies.find((a) => a.id === itemId || a.id.includes(itemId))
    : null

  const protectedBuildings = owned?.assemblies.filter((a) => !!a.details?.extension) ?? []
  const isOwner = !!owned && !!walletAddress

  const containingGroups = groups.filter((g) =>
    g.entries.some((e) => e.assemblyId === assembly?.id),
  )

  const activeRules = containingGroups.flatMap((g) => {
    const policy = policies.find((p) => p.buildingGroupId === g.id)
    if (!policy) return []
    return policy.entries
      .filter((e) => e.enabled)
      .sort((a, b) => a.order - b.order)
      .map((e) => {
        const rule = rules.find((r) => r.id === e.ruleId)
        return { ...e, label: rule?.label ?? 'Unknown', target: rule?.target }
      })
  })

  // Shared styles matching game UI
  const panelStyle = { background: C.panelBg, border: `1px solid ${C.border}` }
  const headerStyle = { background: C.headerBg, borderBottom: `1px solid ${C.border}`, color: C.orange, fontSize: '10px', letterSpacing: '0.12em', fontWeight: 700, textTransform: 'uppercase' as const, padding: '6px 10px' }
  const rowStyle = { borderBottom: `1px solid ${C.border}`, padding: '5px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }
  const labelStyle = { color: C.textSecondary, fontSize: '11px' }
  const valueStyle = { color: C.textPrimary, fontSize: '11px' }
  const btnStyle = { background: C.orange, color: '#000', border: 'none', padding: '5px 14px', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.1em', cursor: 'pointer' }
  const tabStyle = (active: boolean) => ({
    background: active ? C.headerBg : 'transparent',
    color: active ? C.orange : C.textSecondary,
    borderBottom: active ? `2px solid ${C.orange}` : '2px solid transparent',
    padding: '6px 14px',
    fontSize: '10px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.1em',
    cursor: 'pointer',
    border: 'none',
    borderBottomStyle: 'solid' as const,
  })

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.textPrimary, fontFamily: "'Segoe UI', 'Arial Narrow', Arial, sans-serif", fontSize: '11px', padding: 0 }}>

      {/* Top bar — mimics the game's tab row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${C.border}`, background: C.headerBg }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
          <div style={tabStyle(true)}>
            EF GUARD
          </div>
          {assembly && (
            <div style={{ ...tabStyle(false), color: C.textMuted }}>
              {displayName(assembly)}
            </div>
          )}
        </div>
        <div style={{ padding: '0 10px' }}>
          {!isConnected ? (
            <button onClick={handleConnect} style={btnStyle}>Connect</button>
          ) : (
            <span style={{ color: C.textMuted, fontSize: '10px', fontFamily: 'monospace' }}>
              {walletAddress?.slice(0, 8)}..{walletAddress?.slice(-4)}
            </span>
          )}
        </div>
      </div>

      <div style={{ padding: '8px' }}>

        {/* Connecting */}
        {!isConnected && (
          <div style={{ ...panelStyle, marginBottom: 8 }}>
            <div style={{ padding: '12px 10px', color: C.textMuted }}>Connecting wallet...</div>
          </div>
        )}

        {/* Loading specific building */}
        {isConnected && itemId && !assembly && (
          <div style={{ ...panelStyle, marginBottom: 8 }}>
            <div style={{ padding: '12px 10px', color: C.textMuted }}>Loading building data...</div>
          </div>
        )}

        {/* Overview — no specific building */}
        {isConnected && !itemId && (
          <>
            <div style={{ ...panelStyle, marginBottom: 8 }}>
              <div style={headerStyle}>Your Protected Buildings</div>
              {protectedBuildings.length === 0 ? (
                <div style={{ padding: '10px', color: C.textMuted }}>No buildings with ef guard installed.</div>
              ) : (
                protectedBuildings.map((a, i) => (
                  <div key={a.id} style={{ ...rowStyle, ...(i === protectedBuildings.length - 1 ? { borderBottom: 'none' } : {}) }}>
                    <span style={valueStyle}>{displayName(a)}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{ color: a.details?.status === 'ONLINE' ? C.green : C.red, fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' }}>
                        {a.details?.status ?? '?'}
                      </span>
                      <span style={{ color: C.orange, fontSize: '10px', letterSpacing: '0.08em' }}>PROTECTED</span>
                    </div>
                  </div>
                ))
              )}
            </div>

            {isOwner && (
              <a href={window.location.origin + window.location.pathname + '#/'} style={{ ...btnStyle, display: 'inline-block', textDecoration: 'none' }}>
                Admin Panel
              </a>
            )}
          </>
        )}

        {/* Specific building view */}
        {isConnected && assembly && (
          <>
            {/* Building info — mimics the "Testing About Option" panel from the game */}
            <div style={{ ...panelStyle, marginBottom: 8 }}>
              <div style={headerStyle}>Building Status</div>
              <div style={rowStyle}>
                <span style={labelStyle}>Name</span>
                <span style={valueStyle}>{displayName(assembly)}</span>
              </div>
              {assembly.details?.description && (
                <div style={rowStyle}>
                  <span style={labelStyle}>Description</span>
                  <span style={valueStyle}>{assembly.details.description}</span>
                </div>
              )}
              <div style={rowStyle}>
                <span style={labelStyle}>Status</span>
                <span style={{ color: assembly.details?.status === 'ONLINE' ? C.green : C.red, fontSize: '11px', fontWeight: 600 }}>
                  {assembly.details?.status ?? '?'}
                </span>
              </div>
              <div style={{ ...rowStyle, borderBottom: 'none' }}>
                <span style={labelStyle}>Protection</span>
                {assembly.details?.extension ? (
                  <span style={{ color: C.orange, fontWeight: 600 }}>Active</span>
                ) : (
                  <span style={{ color: C.textMuted }}>None</span>
                )}
              </div>
            </div>

            {/* Access rules */}
            <div style={{ ...panelStyle, marginBottom: 8 }}>
              <div style={headerStyle}>Access Rules</div>
              {activeRules.length > 0 ? (
                activeRules.map((r, i) => (
                  <div key={r.id} style={{ ...rowStyle, ...(i === activeRules.length - 1 ? { borderBottom: 'none' } : {}) }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ color: C.textMuted, width: '16px' }}>{String(i + 1).padStart(2, '0')}</span>
                      <span style={valueStyle}>{r.label}</span>
                    </div>
                    <span style={{ color: r.effect === 'Allow' ? C.green : C.red, fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      {r.effect}
                    </span>
                  </div>
                ))
              ) : (
                <div style={{ padding: '10px', color: C.textMuted }}>No rules configured.</div>
              )}
            </div>

            {/* Owner management */}
            {isOwner && (
              <div style={{ ...panelStyle, marginBottom: 8 }}>
                <div style={headerStyle}>Management</div>
                <div style={{ padding: '8px 10px' }}>
                  {containingGroups.length > 0 && (
                    <div style={{ ...rowStyle, border: 'none', padding: '4px 0' }}>
                      <span style={labelStyle}>Building Group</span>
                      <span style={valueStyle}>{containingGroups.map((g) => g.name).join(', ')}</span>
                    </div>
                  )}
                  <div style={{ marginTop: '8px' }}>
                    <a
                      href={window.location.origin + window.location.pathname + '#/'}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ ...btnStyle, display: 'inline-block', textDecoration: 'none' }}
                    >
                      Admin Panel
                    </a>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div style={{ borderTop: `1px solid ${C.border}`, padding: '6px 10px', marginTop: '8px' }}>
        <span style={{ color: C.textMuted, fontSize: '9px', letterSpacing: '0.1em' }}>EF GUARD // ACCESS CONTROL MIDDLEWARE</span>
      </div>
    </div>
  )
}
