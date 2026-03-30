/**
 * In-game assembly view. Shown when the DApp is opened from within
 * the EVE Frontier game client (detected by ?itemId= query param).
 *
 * - No navigation bar, minimal chrome
 * - Black/orange theme matching in-game UI
 * - Auto-connects wallet
 * - Owner: shows current building's rules + link to full admin
 * - Visitor: shows their access status
 */
import { useEffect } from 'react'
import { useConnection } from '@evefrontier/dapp-kit'
import { useOwnedAssemblies, displayName } from '../hooks/useOwnedAssemblies'
import { useRules } from '../hooks/useRules'
import { usePolicies } from '../hooks/usePolicies'
import { useBuildingGroups } from '../hooks/useBuildingGroups'

export function InGameView({ itemId }: { itemId: string }) {
  const { walletAddress, isConnected, handleConnect, hasEveVault } = useConnection()
  const { data: owned } = useOwnedAssemblies(walletAddress)
  const { rules } = useRules(walletAddress)
  const { policies } = usePolicies(walletAddress)
  const { groups } = useBuildingGroups(walletAddress)

  // Auto-connect wallet
  useEffect(() => {
    if (!isConnected && hasEveVault) {
      handleConnect()
    }
  }, [isConnected, hasEveVault, handleConnect])

  // Find the assembly matching the itemId
  // Find the assembly matching the itemId from the game URL
  // The game might pass the item_id (numeric) or the object ID
  const assembly = owned?.assemblies.find((a) =>
    a.id === itemId || a.id.includes(itemId),
  )

  // Check if the connected wallet is the owner of this assembly
  const isOwner = !!owned && !!walletAddress

  // Find which building groups contain this assembly
  const containingGroups = groups.filter((g) =>
    g.entries.some((e) => e.assemblyId === assembly?.id),
  )

  // Find policies for those groups
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
    <div className="min-h-screen bg-black text-white p-4" style={{ fontFamily: "'Segoe UI', sans-serif" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <span className="text-orange-500 font-bold text-sm tracking-wider uppercase">ef guard</span>
          {assembly && (
            <span className="text-gray-400 text-xs">
              {displayName(assembly)}
            </span>
          )}
        </div>
        {!isConnected ? (
          <button
            onClick={handleConnect}
            className="px-3 py-1 bg-orange-600 hover:bg-orange-700 text-white text-xs rounded"
          >
            Connect Wallet
          </button>
        ) : (
          <span className="text-xs text-gray-500 font-mono">
            {walletAddress?.slice(0, 6)}...{walletAddress?.slice(-4)}
          </span>
        )}
      </div>

      {/* Loading state */}
      {!isConnected && (
        <div className="text-center py-12">
          <p className="text-gray-400 text-sm">Connecting wallet...</p>
        </div>
      )}

      {isConnected && !assembly && (
        <div className="text-center py-12">
          <p className="text-gray-400 text-sm">Loading building data...</p>
          <p className="text-gray-600 text-xs mt-2">Item ID: {itemId}</p>
        </div>
      )}

      {isConnected && assembly && (
        <div className="space-y-4">
          {/* Building info */}
          <div className="border border-gray-800 rounded p-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-medium">{displayName(assembly)}</h2>
                {assembly.details?.description && (
                  <p className="text-gray-500 text-xs mt-0.5">{assembly.details.description}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {assembly.details?.extension ? (
                  <span className="text-orange-500 text-[10px] font-semibold uppercase">Protected</span>
                ) : (
                  <span className="text-gray-600 text-[10px]">No protection</span>
                )}
                <span className={`text-[10px] uppercase font-semibold ${
                  assembly.details?.status === 'ONLINE' ? 'text-green-500' : 'text-red-500'
                }`}>
                  {assembly.details?.status ?? '?'}
                </span>
              </div>
            </div>
          </div>

          {/* Access rules */}
          {activeRules.length > 0 ? (
            <div className="border border-gray-800 rounded p-3">
              <h3 className="text-xs text-orange-500 uppercase font-semibold mb-2">Access Rules</h3>
              <div className="space-y-1">
                {activeRules.map((r, i) => (
                  <div key={r.id} className="flex items-center justify-between text-xs py-1 border-b border-gray-900 last:border-0">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-600 w-4">{i + 1}</span>
                      <span className="text-white">{r.label}</span>
                    </div>
                    <span className={`text-[10px] font-semibold uppercase ${
                      r.effect === 'Allow' ? 'text-green-500' : 'text-red-500'
                    }`}>
                      {r.effect}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="border border-gray-800 rounded p-3">
              <p className="text-gray-500 text-xs">No access rules configured for this building.</p>
            </div>
          )}

          {/* Visitor access status */}
          {!isOwner && (
            <div className="border border-gray-800 rounded p-3">
              <h3 className="text-xs text-orange-500 uppercase font-semibold mb-2">Your Access</h3>
              <p className="text-gray-400 text-xs">
                Connect your wallet to check your access level for this building.
              </p>
            </div>
          )}

          {/* Owner actions */}
          {isOwner && (
            <div className="border border-gray-800 rounded p-3">
              <h3 className="text-xs text-orange-500 uppercase font-semibold mb-2">Management</h3>
              {containingGroups.length > 0 ? (
                <p className="text-gray-400 text-xs mb-2">
                  This building is in: {containingGroups.map((g) => g.name).join(', ')}
                </p>
              ) : (
                <p className="text-gray-400 text-xs mb-2">
                  This building is not in any building group yet.
                </p>
              )}
              <a
                href={window.location.origin + window.location.pathname + '#/'}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-xs rounded"
              >
                Open Full Admin Panel
              </a>
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="mt-8 text-center">
        <span className="text-gray-700 text-[10px]">ef guard access control middleware</span>
      </div>
    </div>
  )
}
