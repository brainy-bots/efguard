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

  const panelStyle = { background: C.panelBg, border: `1px solid ${C.border}`, backdropFilter: 'blur(4px)' }
  const headerStyle = { background: C.headerBg, borderBottom: `1px solid ${C.border}`, color: C.orange, fontSize: '10px', letterSpacing: '0.12em', fontWeight: 700, textTransform: 'uppercase' as const, padding: '6px 10px' }
  const rowStyle = { borderBottom: `1px solid ${C.border}`, padding: '5px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }
  const labelStyle = { color: C.textSecondary, fontSize: '11px' }
  const valueStyle = { color: C.textPrimary, fontSize: '11px' }
  const btnStyle = { background: C.orange, color: '#000', border: 'none', padding: '5px 14px', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.1em', cursor: 'pointer' }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.textPrimary, fontFamily: "'Segoe UI', 'Arial Narrow', Arial, sans-serif", fontSize: '11px', position: 'relative', display: 'flex', flexDirection: 'column' }}>
      <AsciiBackground />

      {/* Center content vertically and horizontally */}
      <div style={{ position: 'relative', zIndex: 1, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 60px' }}>
        <div style={{ width: '100%', maxWidth: '480px' }}>

          {/* Loading / not connected */}
          {!isConnected && (
            <div style={{ ...panelStyle }}>
              <div style={{ padding: '20px', color: C.textMuted, textAlign: 'center' }}>Connecting wallet...</div>
            </div>
          )}

          {isConnected && itemId && !assembly && (
            <div style={{ ...panelStyle }}>
              <div style={{ padding: '20px', color: C.textMuted, textAlign: 'center' }}>Loading building data...</div>
            </div>
          )}

          {/* Overview — no specific building */}
          {isConnected && !itemId && (
            <>
              {protectedBuildings.length === 0 ? (
                <div style={{ ...panelStyle, minHeight: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ color: C.textMuted }}>No buildings with ef guard installed.</span>
                </div>
              ) : (
                protectedBuildings.map((a) => {
                  // Find rules for this specific building
                  const buildingGroups = groups.filter((g) =>
                    g.entries.some((e) => e.assemblyId === a.id),
                  )
                  const buildingRules = buildingGroups.flatMap((g) => {
                    const policy = policies.find((p) => p.buildingGroupId === g.id)
                    if (!policy) return []
                    return policy.entries
                      .filter((e) => e.enabled)
                      .sort((x, y) => x.order - y.order)
                      .map((e) => {
                        const rule = rules.find((r) => r.id === e.ruleId)
                        return { ...e, label: rule?.label ?? 'Unknown' }
                      })
                  })

                  return (
                    <div key={a.id} style={{ marginBottom: 8 }}>
                      {/* Building header */}
                      <div style={{ ...panelStyle, minHeight: '80px' }}>
                        <div style={headerStyle}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>{displayName(a)}</span>
                            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                              <span style={{ color: a.details?.status === 'ONLINE' ? C.green : C.red }}>
                                {a.details?.status ?? '?'}
                              </span>
                              <span style={{ color: C.orange }}>PROTECTED</span>
                            </div>
                          </div>
                        </div>

                        {/* Rules for this building */}
                        {buildingRules.length > 0 ? (
                          buildingRules.map((r, i) => (
                            <div key={r.id} style={{ ...rowStyle, ...(i === buildingRules.length - 1 ? { borderBottom: 'none' } : {}) }}>
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
                          <div style={{ padding: '12px 10px', color: C.textMuted }}>No rules configured.</div>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </>
          )}

          {/* Specific building view */}
          {isConnected && assembly && (
            <>
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
                  <div style={{ padding: '12px 10px', color: C.textMuted }}>No rules configured.</div>
                )}
              </div>

              {isOwner && containingGroups.length > 0 && (
                <div style={{ marginTop: '4px', color: C.textMuted, fontSize: '10px' }}>
                  Group: {containingGroups.map((g) => g.name).join(', ')}
                </div>
              )}
            </>
          )}

        </div>
      </div>

      {/* Footer — fixed at bottom */}
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 16px', borderTop: `1px solid ${C.border}` }}>
        {isOwner ? (
          <a
            href={window.location.origin + window.location.pathname + '#/'}
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...btnStyle, display: 'inline-block', textDecoration: 'none', fontSize: '9px', padding: '4px 10px' }}
          >
            Admin Panel
          </a>
        ) : <span />}
        <span style={{ color: C.textMuted, fontSize: '9px', letterSpacing: '0.15em' }}>EF GUARD // ACCESS CONTROL MIDDLEWARE</span>
      </div>
    </div>
  )
}
