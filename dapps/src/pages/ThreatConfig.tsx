import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useConnection } from '@evefrontier/dapp-kit'
import { useAssemblyBinding } from '../hooks/useAssemblyBinding'
import { useBindingRole } from '../hooks/useBindingRole'
import { useSubmitTransaction } from '../hooks/useSubmitTransaction'
import {
  buildSetBlockAggressorsTx,
  buildAddToBlocklistTx,
  buildRemoveFromBlocklistTx,
} from '../lib/tx-builders'
import { DEFAULT_BINDING_ID } from '../env'

export function ThreatConfig() {
  const { walletAddress, isConnected } = useConnection()
  const qc = useQueryClient()
  const { submit, isPending } = useSubmitTransaction()

  const [bindingId] = useState(DEFAULT_BINDING_ID || '')
  const { data: binding, isLoading } = useAssemblyBinding(bindingId || null)
  const role = useBindingRole(binding, walletAddress)
  const canEdit = isConnected && role === 'owner'

  const [newCharId, setNewCharId] = useState('')

  async function handleToggleAggressors() {
    if (!binding) return
    await submit(buildSetBlockAggressorsTx(binding.id, !binding.threat_config.block_aggressors))
    await qc.invalidateQueries({ queryKey: ['assembly-binding'] })
  }

  async function handleAddToBlocklist() {
    if (!binding || !newCharId.trim()) return
    await submit(buildAddToBlocklistTx(binding.id, newCharId.trim()))
    await qc.invalidateQueries({ queryKey: ['assembly-binding'] })
    setNewCharId('')
  }

  async function handleRemoveFromBlocklist(charId: string) {
    if (!binding) return
    await submit(buildRemoveFromBlocklistTx(binding.id, charId))
    await qc.invalidateQueries({ queryKey: ['assembly-binding'] })
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-4">
      <h1 className="text-xl font-bold text-white">Threat Config</h1>
      <p className="text-sm text-default">
        Configure threat overrides. Criminal timers are not available on-chain;
        blocklist entries are manually managed.
      </p>

      {isLoading && <p className="text-sm text-default animate-pulse">Loading…</p>}

      {binding && (
        <>
          {/* Block aggressors toggle */}
          <div className="bg-surface-1 border border-surface-3 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-white">Block Aggressors</h2>
                <p className="text-xs text-default mt-0.5">
                  Automatically deny characters with active aggression flags (turret context).
                </p>
              </div>
              <button
                onClick={handleToggleAggressors}
                disabled={!canEdit || isPending}
                className={`relative w-10 h-6 rounded-full transition-colors ${
                  binding.threat_config.block_aggressors ? 'bg-green-600' : 'bg-surface-3'
                } disabled:opacity-50`}
              >
                <span
                  className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                    binding.threat_config.block_aggressors ? 'translate-x-4' : ''
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Blocklist */}
          <div className="bg-surface-1 border border-surface-3 rounded-lg p-4">
            <h2 className="text-sm font-semibold text-default uppercase tracking-wider mb-3">
              Blocklist ({binding.threat_config.blocklist.length} entries)
            </h2>

            {binding.threat_config.blocklist.length === 0 && (
              <p className="text-xs text-default mb-3">No characters on the blocklist.</p>
            )}

            <ul className="space-y-1 mb-4">
              {binding.threat_config.blocklist.map((charId) => (
                <li key={charId} className="flex items-center justify-between text-sm">
                  <span className="font-mono text-white">{charId}</span>
                  {canEdit && (
                    <button
                      onClick={() => handleRemoveFromBlocklist(charId)}
                      disabled={isPending}
                      className="text-xs text-default hover:text-red-400"
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>

            {canEdit && (
              <div className="flex gap-2">
                <input
                  className="flex-1 bg-surface-2 border border-surface-3 rounded px-3 py-1.5 text-sm text-white font-mono placeholder:text-default focus:outline-none focus:border-accent"
                  placeholder="Character game ID (u64)"
                  value={newCharId}
                  onChange={(e) => setNewCharId(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddToBlocklist()}
                />
                <button
                  onClick={handleAddToBlocklist}
                  disabled={isPending || !newCharId.trim()}
                  className="px-4 py-1.5 bg-accent hover:bg-accent-dim text-white text-sm rounded disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
