import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useConnection } from '@evefrontier/dapp-kit'
import { useAssemblyBinding } from '../hooks/useAssemblyBinding'
import { useBuildingGroups } from '../hooks/useBuildingGroups'
import { useSubmitTransaction } from '../hooks/useSubmitTransaction'
import { buildSetPolicyTx } from '../lib/tx-builders'
import { DEFAULT_BINDING_ID } from '../env'
import type { RuleEffect, RuleTarget, PolicyRule } from '../types'

export function Policies() {
  const { isConnected, walletAddress } = useConnection()
  const qc = useQueryClient()
  const { submit, isPending } = useSubmitTransaction()

  const { groups: buildingGroups } = useBuildingGroups(walletAddress)

  const [bindingIdInput, setBindingIdInput] = useState(DEFAULT_BINDING_ID || '')
  const [bindingId, setBindingId] = useState(DEFAULT_BINDING_ID || null)
  const [selectedBuildingGroupId, setSelectedBuildingGroupId] = useState('')

  // Rule to apply
  const [targetType, setTargetType] = useState<'tribe' | 'character' | 'everyone'>('tribe')
  const [targetValue, setTargetValue] = useState('')
  const [effect, setEffect] = useState<RuleEffect>('Allow')

  const { data: binding, isLoading: bindingLoading } = useAssemblyBinding(bindingId)

  const selectedBuildingGroup = buildingGroups.find((g) => g.id === selectedBuildingGroupId)

  // Compute which entries in the building group are valid (registered in binding)
  const validEntries = selectedBuildingGroup?.entries.filter((entry) => {
    if (!binding) return false
    const list =
      entry.assemblyType === 'gate'
        ? binding.gates
        : entry.assemblyType === 'turret'
          ? binding.turrets
          : binding.storage_units
    return list.includes(entry.assemblyId)
  }) ?? []

  const skippedEntries = selectedBuildingGroup?.entries.filter(
    (e) => !validEntries.includes(e),
  ) ?? []

  function buildRule(): PolicyRule | null {
    let target: RuleTarget
    if (targetType === 'tribe') {
      const id = parseInt(targetValue.trim(), 10)
      if (isNaN(id) || id < 0) return null
      target = { type: 'tribe', tribe_id: id }
    } else if (targetType === 'character') {
      if (!targetValue.trim()) return null
      target = { type: 'character', char_game_id: targetValue.trim() }
    } else {
      target = { type: 'everyone' }
    }
    return { condition_id: '', target, effect }
  }

  const rule = buildRule()

  const canSubmit =
    isConnected &&
    bindingId &&
    selectedBuildingGroupId &&
    rule !== null &&
    validEntries.length > 0

  async function handleApply() {
    if (!bindingId || !rule || validEntries.length === 0) return

    // For each assembly in the building group, append the rule to its existing policy
    for (const entry of validEntries) {
      const existing = (binding?.policies[entry.assemblyId]?.rules ?? []).map((r) => ({
        conditionId: r.condition_id,
        effect: r.effect,
      }))
      const newRules = [...existing, { conditionId: rule.condition_id, effect: rule.effect }]
      await submit(buildSetPolicyTx(bindingId, entry.assemblyId, newRules))
    }
    await qc.invalidateQueries({ queryKey: ['assembly-binding'] })
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <h1 className="text-xl font-bold text-white">Bulk Policies</h1>
      <p className="text-sm text-default">
        Apply a rule to all assemblies in a building group. This appends the rule
        to each assembly's existing policy.
      </p>

      {/* Step 1: Binding */}
      <div className="bg-surface-1 border border-surface-3 rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-semibold text-default uppercase tracking-wider">
          1. Target Binding
        </h2>
        <div className="flex gap-2">
          <input
            className="flex-1 bg-surface-2 border border-surface-3 rounded px-3 py-1.5 text-sm text-white font-mono placeholder:text-default focus:outline-none focus:border-accent"
            placeholder="AssemblyBinding object ID (0x...)"
            value={bindingIdInput}
            onChange={(e) => setBindingIdInput(e.target.value)}
          />
          <button
            onClick={() => setBindingId(bindingIdInput.trim() || null)}
            className="px-4 py-1.5 bg-accent hover:bg-accent-dim text-white text-sm rounded"
          >
            Load
          </button>
        </div>
        {bindingLoading && (
          <p className="text-xs text-default animate-pulse">Loading binding...</p>
        )}
        {binding && (
          <p className="text-xs text-default">
            Binding loaded -- {binding.gates.length} gates, {binding.turrets.length} turrets,{' '}
            {binding.storage_units.length} SSUs
          </p>
        )}
      </div>

      {/* Step 2: Building group */}
      <div className="bg-surface-1 border border-surface-3 rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-semibold text-default uppercase tracking-wider">
          2. Building Group
        </h2>
        {buildingGroups.length === 0 ? (
          <p className="text-xs text-default">
            No building groups yet.{' '}
            <a href="#/building-groups" className="text-accent hover:underline">
              Create one
            </a>
          </p>
        ) : (
          <select
            className="w-full bg-surface-2 border border-surface-3 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-accent"
            value={selectedBuildingGroupId}
            onChange={(e) => setSelectedBuildingGroupId(e.target.value)}
          >
            <option value="">-- Select building group --</option>
            {buildingGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.entries.length} assemblies)
              </option>
            ))}
          </select>
        )}

        {selectedBuildingGroup && (
          <div className="text-xs space-y-1">
            {validEntries.length > 0 && (
              <p className="text-green-400">
                {validEntries.length} assembl{validEntries.length !== 1 ? 'ies' : 'y'} registered in binding
              </p>
            )}
            {skippedEntries.length > 0 && (
              <p className="text-yellow-400">
                {skippedEntries.length} assembl{skippedEntries.length !== 1 ? 'ies' : 'y'} not registered -- will be skipped
              </p>
            )}
            {!binding && (
              <p className="text-default">Load a binding above to validate entries.</p>
            )}
          </div>
        )}
      </div>

      {/* Step 3: Rule */}
      <div className="bg-surface-1 border border-surface-3 rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-semibold text-default uppercase tracking-wider">
          3. Rule
        </h2>
        <div className="flex gap-3 items-center flex-wrap">
          <select
            value={effect}
            onChange={(e) => setEffect(e.target.value as RuleEffect)}
            className="bg-surface-2 border border-surface-3 rounded px-3 py-1.5 text-sm text-white"
          >
            <option value="Allow">Allow</option>
            <option value="Deny">Deny</option>
          </select>

          <select
            value={targetType}
            onChange={(e) => { setTargetType(e.target.value as typeof targetType); setTargetValue('') }}
            className="bg-surface-2 border border-surface-3 rounded px-3 py-1.5 text-sm text-white"
          >
            <option value="tribe">Tribe</option>
            <option value="character">Character</option>
            <option value="everyone">Everyone</option>
          </select>

          {targetType !== 'everyone' && (
            <input
              className="flex-1 min-w-[150px] bg-surface-2 border border-surface-3 rounded px-3 py-1.5 text-sm text-white font-mono placeholder:text-default focus:outline-none focus:border-accent"
              placeholder={targetType === 'tribe' ? 'Tribe ID (number)' : 'Character game ID'}
              value={targetValue}
              onChange={(e) => setTargetValue(e.target.value)}
            />
          )}
        </div>
      </div>

      {/* Preview + Submit */}
      <div className="bg-surface-1 border border-surface-3 rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-semibold text-default uppercase tracking-wider">
          4. Apply
        </h2>

        {canSubmit ? (
          <p className="text-sm text-default">
            This will append an{' '}
            <span className={`font-semibold ${effect === 'Allow' ? 'text-green-400' : 'text-red-400'}`}>{effect}</span>{' '}
            rule for{' '}
            <span className="text-white">
              {targetType === 'tribe' ? `Tribe #${targetValue}` : targetType === 'character' ? `Character ${targetValue}` : 'Everyone'}
            </span>{' '}
            to <span className="text-white font-semibold">{validEntries.length}</span> assembl{validEntries.length !== 1 ? 'ies' : 'y'}{' '}
            in <span className="text-white">{selectedBuildingGroup?.name}</span>.
          </p>
        ) : (
          <p className="text-xs text-default">
            Complete steps 1-3 above to enable submission.
          </p>
        )}

        <button
          onClick={handleApply}
          disabled={!canSubmit || isPending}
          className="px-5 py-2 bg-accent hover:bg-accent-dim text-white text-sm rounded font-semibold disabled:opacity-50"
        >
          {isPending ? 'Submitting...' : 'Apply Rule'}
        </button>

        {!isConnected && (
          <p className="text-xs text-yellow-400">Connect your wallet to submit transactions.</p>
        )}
      </div>
    </div>
  )
}
