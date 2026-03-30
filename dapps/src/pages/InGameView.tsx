/**
 * In-game assembly view — styled to match EVE Frontier's UI.
 * Route: #/ingame
 */
import { useEffect } from 'react'
import { useConnection } from '@evefrontier/dapp-kit'
import { useOwnedAssemblies, displayName } from '../hooks/useOwnedAssemblies'
import { useRules } from '../hooks/useRules'
import { usePolicies } from '../hooks/usePolicies'
import { useBuildingGroups } from '../hooks/useBuildingGroups'

const S = {
  page: 'min-h-screen bg-[#0a0a0a] text-[#c8c8c8] px-3 py-2 font-mono text-[11px] leading-tight',
  header: 'flex items-center justify-between border-b border-[#2a2a2a] pb-2 mb-3',
  logo: 'text-[#e87b00] font-bold text-xs tracking-[0.2em] uppercase',
  wallet: 'text-[10px] text-[#666] font-mono',
  connectBtn: 'px-2 py-1 bg-[#e87b00] hover:bg-[#ff8c00] text-black text-[10px] font-bold uppercase tracking-wider',
  section: 'border border-[#1f1f1f] bg-[#0f0f0f] mb-2',
  sectionHeader: 'px-3 py-1.5 border-b border-[#1f1f1f] bg-[#141414] text-[#e87b00] text-[10px] uppercase tracking-[0.15em] font-bold',
  sectionBody: 'px-3 py-2',
  row: 'flex items-center justify-between py-1 border-b border-[#1a1a1a] last:border-0',
  label: 'text-[#999]',
  value: 'text-[#ddd]',
  allow: 'text-[#4ade80] text-[10px] uppercase font-bold tracking-wider',
  deny: 'text-[#f87171] text-[10px] uppercase font-bold tracking-wider',
  online: 'text-[#4ade80]',
  offline: 'text-[#f87171]',
  muted: 'text-[#444] text-[10px]',
  btn: 'px-3 py-1 bg-[#e87b00] hover:bg-[#ff8c00] text-black text-[10px] font-bold uppercase tracking-wider',
  protected: 'text-[#e87b00] text-[10px] uppercase tracking-wider',
} as const

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

  return (
    <div className={S.page}>
      {/* Header */}
      <div className={S.header}>
        <div className="flex items-center gap-3">
          <span className={S.logo}>ef guard</span>
          {assembly && (
            <>
              <span className={S.muted}>|</span>
              <span className={S.value}>{displayName(assembly)}</span>
            </>
          )}
        </div>
        {!isConnected ? (
          <button onClick={handleConnect} className={S.connectBtn}>Connect</button>
        ) : (
          <span className={S.wallet}>{walletAddress?.slice(0, 8)}..{walletAddress?.slice(-4)}</span>
        )}
      </div>

      {/* Connecting */}
      {!isConnected && (
        <div className={S.section}>
          <div className={S.sectionBody}>
            <span className={S.muted}>Connecting wallet...</span>
          </div>
        </div>
      )}

      {/* Loading specific building */}
      {isConnected && itemId && !assembly && (
        <div className={S.section}>
          <div className={S.sectionBody}>
            <span className={S.muted}>Loading building data...</span>
          </div>
        </div>
      )}

      {/* Overview — no specific building */}
      {isConnected && !itemId && (
        <>
          <div className={S.section}>
            <div className={S.sectionHeader}>Your Protected Buildings</div>
            <div className={S.sectionBody}>
              {protectedBuildings.length === 0 ? (
                <span className={S.muted}>No buildings with ef guard installed.</span>
              ) : (
                protectedBuildings.map((a) => (
                  <div key={a.id} className={S.row}>
                    <span className={S.value}>{displayName(a)}</span>
                    <div className="flex items-center gap-3">
                      <span className={a.details?.status === 'ONLINE' ? S.online : S.offline}>
                        {a.details?.status ?? '?'}
                      </span>
                      <span className={S.protected}>Protected</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {isOwner && (
            <div className="mt-3">
              <a href={window.location.origin + window.location.pathname + '#/'} className={S.btn}>
                Admin Panel
              </a>
            </div>
          )}
        </>
      )}

      {/* Specific building view */}
      {isConnected && assembly && (
        <>
          {/* Building info */}
          <div className={S.section}>
            <div className={S.sectionHeader}>Building Status</div>
            <div className={S.sectionBody}>
              <div className={S.row}>
                <span className={S.label}>Name</span>
                <span className={S.value}>{displayName(assembly)}</span>
              </div>
              {assembly.details?.description && (
                <div className={S.row}>
                  <span className={S.label}>Description</span>
                  <span className={S.value}>{assembly.details.description}</span>
                </div>
              )}
              <div className={S.row}>
                <span className={S.label}>Status</span>
                <span className={assembly.details?.status === 'ONLINE' ? S.online : S.offline}>
                  {assembly.details?.status ?? '?'}
                </span>
              </div>
              <div className={S.row}>
                <span className={S.label}>Protection</span>
                {assembly.details?.extension ? (
                  <span className={S.protected}>Active</span>
                ) : (
                  <span className={S.muted}>None</span>
                )}
              </div>
            </div>
          </div>

          {/* Access rules */}
          <div className={S.section}>
            <div className={S.sectionHeader}>Access Rules</div>
            <div className={S.sectionBody}>
              {activeRules.length > 0 ? (
                activeRules.map((r, i) => (
                  <div key={r.id} className={S.row}>
                    <div className="flex items-center gap-2">
                      <span className={S.muted}>{String(i + 1).padStart(2, '0')}</span>
                      <span className={S.value}>{r.label}</span>
                    </div>
                    <span className={r.effect === 'Allow' ? S.allow : S.deny}>
                      {r.effect}
                    </span>
                  </div>
                ))
              ) : (
                <span className={S.muted}>No rules configured.</span>
              )}
            </div>
          </div>

          {/* Owner management */}
          {isOwner && (
            <div className={S.section}>
              <div className={S.sectionHeader}>Management</div>
              <div className={S.sectionBody}>
                {containingGroups.length > 0 && (
                  <div className={S.row}>
                    <span className={S.label}>Building Group</span>
                    <span className={S.value}>{containingGroups.map((g) => g.name).join(', ')}</span>
                  </div>
                )}
                <div className="mt-2">
                  <a
                    href={window.location.origin + window.location.pathname + '#/'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={S.btn}
                  >
                    Admin Panel
                  </a>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Footer */}
      <div className="mt-4 border-t border-[#1a1a1a] pt-2">
        <span className={S.muted}>ef guard // access control middleware</span>
      </div>
    </div>
  )
}
