import { useConnection } from '@evefrontier/dapp-kit'
import { useOwnedAssemblies, displayName } from '../hooks/useOwnedAssemblies'
import { STATUS_COLORS } from '../types'

const TYPE_LABELS: Record<string, string> = {
  gate: 'Gate', turret: 'Turret', ssu: 'Storage Unit', assembly: 'Assembly', unknown: 'Unknown',
}

export function Buildings() {
  const { walletAddress, isConnected } = useConnection()
  const { data: owned, isLoading } = useOwnedAssemblies(walletAddress)

  if (!isConnected) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-xl font-bold text-white mb-4">Buildings</h1>
        <p className="text-default text-sm">Connect your wallet to see your buildings.</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold text-white mb-4">Buildings</h1>

      {isLoading && <p className="text-default text-sm animate-pulse">Loading buildings...</p>}

      {owned && owned.assemblies.length === 0 && !isLoading && (
        <p className="text-default text-sm">No buildings found for your character.</p>
      )}

      {owned && owned.assemblies.length > 0 && (
        <>
          <p className="text-xs text-default mb-3">
            {owned.assemblies.length} building{owned.assemblies.length !== 1 ? 's' : ''} owned by character {owned.characterId?.slice(0, 10)}…
          </p>
          <div className="bg-surface-1 border border-surface-3 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-surface-3 text-default uppercase tracking-wider">
                  <th className="text-left px-4 py-2 font-medium">Name</th>
                  <th className="text-left px-4 py-2 font-medium">Type</th>
                  <th className="text-left px-4 py-2 font-medium">On-chain type</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="text-left px-4 py-2 font-medium">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-2">
                {owned.assemblies.map((a) => {
                  const d = a.details
                  const statusColor = STATUS_COLORS[d?.status ?? ''] ?? 'text-default'
                  return (
                    <tr key={a.id} className="hover:bg-surface-2" title={a.id}>
                      <td className="px-4 py-2">
                        <span className="text-white">{displayName(a)}</span>
                        {d?.customName && d.typeName && (
                          <span className="text-default ml-1 text-[10px]">({d.typeName})</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-default">{d?.typeName || TYPE_LABELS[a.type]}</td>
                      <td className="px-4 py-2 text-default">{TYPE_LABELS[a.type]}</td>
                      <td className="px-4 py-2">
                        <span className={`${statusColor} uppercase font-semibold`}>
                          {d?.status ?? '?'}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-default truncate max-w-48">
                        {d?.description || '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
