import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useConnection } from '@evefrontier/dapp-kit'
import { useAssemblyBinding } from '../hooks/useAssemblyBinding'
import { useSubmitTransaction } from '../hooks/useSubmitTransaction'
import { buildSetPolicyTx } from '../lib/tx-builders'
import { DEFAULT_BINDING_ID } from '../env'
import type { RuleEffect } from '../types'

interface ParsedEntry {
  value: string
  parsed: number | null
  valid: boolean
}

function parseLine(line: string): ParsedEntry {
  const trimmed = line.trim()
  if (!trimmed) return { value: trimmed, parsed: null, valid: false }
  const n = parseInt(trimmed, 10)
  const valid = !isNaN(n) && n >= 0 && n <= 4_294_967_295
  return { value: trimmed, parsed: valid ? n : null, valid }
}

export function BulkImport() {
  const { isConnected } = useConnection()
  const qc = useQueryClient()
  const { submit, isPending } = useSubmitTransaction()

  const [bindingIdInput, setBindingIdInput] = useState(DEFAULT_BINDING_ID || '')
  const [bindingId, setBindingId] = useState(DEFAULT_BINDING_ID || null)
  const [selectedAssemblyId, setSelectedAssemblyId] = useState('')
  const [effect, setEffect] = useState<RuleEffect>('Allow')
  const [rawInput, setRawInput] = useState('')

  const { data: binding, isLoading: bindingLoading } = useAssemblyBinding(bindingId)

  // All registered assembly IDs
  const allAssemblyIds = binding
    ? [...binding.gates, ...binding.turrets, ...binding.storage_units]
    : []

  const entries = rawInput
    .split(/[\n,]+/)
    .map(parseLine)
    .filter((e) => e.value !== '')

  const validEntries = entries.filter((e) => e.valid)

  async function handleSubmit() {
    if (!bindingId || !selectedAssemblyId || validEntries.length === 0) return

    // Build rules: existing + new tribe rules
    // Note: bulk import creates rules with placeholder condition IDs.
    // Users should create shared condition objects first and use their IDs.
    const existing = (binding?.policies[selectedAssemblyId]?.rules ?? []).map((r) => ({
      conditionId: r.condition_id,
      effect: r.effect,
    }))
    const newRules = validEntries.map((_e) => ({
      conditionId: '', // TODO: requires condition object IDs — create conditions first
      effect,
    }))
    const combined = [...existing, ...newRules]

    await submit(buildSetPolicyTx(bindingId, selectedAssemblyId, combined))
    await qc.invalidateQueries({ queryKey: ['assembly-binding'] })
    setRawInput('')
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-4">
      <h1 className="text-xl font-bold text-white">Bulk Import Tribes</h1>
      <p className="text-sm text-default">
        Paste a list of tribe IDs (one per line or comma-separated) to add rules
        to an assembly's policy in a single transaction.
      </p>

      {!isConnected && (
        <p className="text-sm text-default">Connect your wallet to import tribes.</p>
      )}

      {isConnected && (
        <>
          {/* Binding selector */}
          <div className="bg-surface-1 border border-surface-3 rounded-lg p-4 space-y-3">
            <label className="block text-sm text-default mb-2">Binding</label>
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
          </div>

          {/* Assembly selector */}
          <div className="bg-surface-1 border border-surface-3 rounded-lg p-4">
            <label className="block text-sm text-default mb-2">Target Assembly</label>
            {allAssemblyIds.length === 0 && binding && (
              <p className="text-xs text-default">No assemblies registered in this binding.</p>
            )}
            {!binding && (
              <p className="text-xs text-default">Load a binding first.</p>
            )}
            {allAssemblyIds.length > 0 && (
              <select
                value={selectedAssemblyId}
                onChange={(e) => setSelectedAssemblyId(e.target.value)}
                className="w-full bg-surface-2 border border-surface-3 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-accent"
              >
                <option value="">Select an assembly...</option>
                {allAssemblyIds.map((id) => {
                  const ruleCount = binding?.policies[id]?.rules.length ?? 0
                  return (
                    <option key={id} value={id}>
                      {id.slice(0, 16)}... ({ruleCount} rules)
                    </option>
                  )
                })}
              </select>
            )}
          </div>

          {/* Effect selector */}
          <div className="bg-surface-1 border border-surface-3 rounded-lg p-4">
            <label className="block text-sm text-default mb-2">Effect</label>
            <div className="flex gap-3">
              {(['Allow', 'Deny'] as const).map((e) => (
                <button
                  key={e}
                  onClick={() => setEffect(e)}
                  className={`px-4 py-2 text-sm rounded border font-medium transition-colors ${
                    effect === e
                      ? e === 'Allow'
                        ? 'bg-green-900/60 text-green-400 border-green-700'
                        : 'bg-red-900/60 text-red-400 border-red-700'
                      : 'border-surface-3 text-default hover:border-accent hover:text-white'
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          {/* Input area */}
          <div className="bg-surface-1 border border-surface-3 rounded-lg p-4">
            <label className="block text-sm text-default mb-2">Tribe IDs</label>
            <textarea
              className="w-full h-40 bg-surface-2 border border-surface-3 rounded px-3 py-2 text-sm text-white font-mono placeholder:text-default focus:outline-none focus:border-accent resize-none"
              placeholder={'98000001\n98000002\n98000003'}
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
            />
          </div>

          {/* Preview */}
          {entries.length > 0 && (
            <div className="bg-surface-1 border border-surface-3 rounded-lg p-4">
              <h2 className="text-sm font-semibold text-default uppercase tracking-wider mb-3">
                Preview ({validEntries.length} valid / {entries.length} total)
              </h2>
              <ul className="max-h-48 overflow-y-auto space-y-1">
                {entries.map((e, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs">
                    <span
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        e.valid ? 'bg-green-500' : 'bg-red-500'
                      }`}
                    />
                    <span className={e.valid ? 'text-white font-mono' : 'text-red-400 font-mono'}>
                      {e.value}
                    </span>
                    {!e.valid && <span className="text-default">invalid</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={
              isPending || !selectedAssemblyId || validEntries.length === 0
            }
            className="px-6 py-2 bg-accent hover:bg-accent-dim text-white text-sm rounded font-semibold disabled:opacity-50"
          >
            {isPending
              ? 'Submitting...'
              : `Add ${validEntries.length} tribe rule${validEntries.length !== 1 ? 's' : ''}`}
          </button>
        </>
      )}
    </div>
  )
}
