/**
 * First-time setup wizard.
 *
 * Creates an AssemblyBinding with selected assemblies in one transaction.
 * Policy setting can be done after setup on the Bindings page.
 */
import { useState } from 'react'
import { useDAppKit } from '@mysten/dapp-kit-react'
import { useConnection } from '@evefrontier/dapp-kit'
import { buildSetupTx } from '../lib/tx-builders'
import { useOwnedAssemblies, displayName, type OwnedAssembly } from '../hooks/useOwnedAssemblies'
import type { AssemblyType } from '../types'

type AssemblyEntry = { id: string; type: AssemblyType }

type Phase =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'done'; bindingId: string }
  | { kind: 'error'; message: string }

// ---- Sub-component: discovered assembly checklist ----

const STATUS_COLORS: Record<string, string> = {
  ONLINE: 'text-green-400', OFFLINE: 'text-red-400', ANCHORED: 'text-yellow-400',
}

function AssemblyChecklist({
  label,
  assemblies,
  selected,
  onToggle,
  disabled,
}: {
  label: string
  assemblies: OwnedAssembly[]
  selected: Set<string>
  onToggle: (id: string, type: AssemblyType) => void
  disabled: boolean
}) {
  if (assemblies.length === 0) return null
  return (
    <div className="mb-3">
      <p className="text-xs text-default uppercase font-medium mb-2">{label} ({assemblies.length})</p>
      <ul className="space-y-2">
        {assemblies.map((a) => {
          const d = a.details
          const name = displayName(a)
          const statusColor = STATUS_COLORS[d?.status ?? ''] ?? 'text-default'
          return (
            <li key={a.id} className="flex items-start gap-2 text-xs" title={a.id}>
              <input
                type="checkbox"
                id={a.id}
                checked={selected.has(a.id)}
                onChange={() => onToggle(a.id, a.type === 'assembly' ? 'ssu' : a.type as AssemblyType)}
                disabled={disabled}
                className="accent-accent mt-0.5"
              />
              <label htmlFor={a.id} className="cursor-pointer flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-white font-medium">{name}</span>
                  {d?.customName && d.typeName && (
                    <span className="text-default text-[10px]">({d.typeName})</span>
                  )}
                  {d?.status && (
                    <span className={`${statusColor} uppercase text-[10px] font-semibold`}>{d.status}</span>
                  )}
                </div>
                {d?.description && (
                  <div className="text-default text-[10px] truncate">{d.description}</div>
                )}
              </label>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ---- Component ----

export function Setup() {
  const dAppKit = useDAppKit()
  const { walletAddress, isConnected } = useConnection()

  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })

  // Discovered assemblies + selection
  const { data: owned, isLoading: ownedLoading } = useOwnedAssemblies(walletAddress)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Manual entry fallback
  const [manualInput, setManualInput] = useState('')
  const [manualType, setManualType] = useState<AssemblyType>('gate')
  const [manualList, setManualList] = useState<AssemblyEntry[]>([])

  const isRunning = phase.kind === 'submitting'

  // ---- Helpers ----

  function toggleAssembly(id: string, _type: AssemblyType) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function addManual() {
    const id = manualInput.trim()
    if (!id) return
    if (manualList.some((a) => a.id === id)) return
    setManualList((prev) => [...prev, { id, type: manualType }])
    setManualInput('')
  }

  // All assemblies to register: discovered (selected) + manual
  function buildAssemblyList(): AssemblyEntry[] {
    const entries: AssemblyEntry[] = []
    if (owned) {
      for (const id of owned.gates) if (selected.has(id)) entries.push({ id, type: 'gate' })
      for (const id of owned.turrets) if (selected.has(id)) entries.push({ id, type: 'turret' })
      for (const id of owned.ssus) if (selected.has(id)) entries.push({ id, type: 'ssu' })
    }
    for (const e of manualList) {
      if (!entries.some((x) => x.id === e.id)) entries.push(e)
    }
    return entries
  }

  // ---- Submit ----

  async function handleSetup() {
    if (!walletAddress) return
    const assemblies = buildAssemblyList()

    try {
      setPhase({ kind: 'submitting' })

      const tx = buildSetupTx(assemblies)

      const result = await dAppKit.signAndExecuteTransaction({ transaction: tx })
      if (result.$kind === 'FailedTransaction') {
        throw new Error(`Transaction failed: ${result.FailedTransaction.status.error ?? 'unknown'}`)
      }

      // Parse created binding ID from effects
      const txData = await dAppKit.getClient().core.getTransaction({
        digest: result.Transaction.digest,
        include: { effects: true, objectTypes: true },
      })
      const txResult = txData.Transaction!
      const objectTypes = (txResult.objectTypes ?? {}) as Record<string, string>
      const changedObjects = (txResult.effects?.changedObjects ?? []) as Array<{ objectId: string; idOperation: string }>
      const created = changedObjects.filter((c) => c.idOperation === 'Created')

      const bindingObj = created.find((c) => objectTypes[c.objectId]?.includes('assembly_binding::AssemblyBinding'))
      if (!bindingObj) throw new Error('Could not find AssemblyBinding in transaction effects')

      setPhase({ kind: 'done', bindingId: bindingObj.objectId })
    } catch (err) {
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  // ---- Success screen ----

  if (phase.kind === 'done') {
    const { bindingId } = phase
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-4">
        <h1 className="text-xl font-bold text-white">Setup Complete</h1>
        <div className="bg-green-900/30 border border-green-700 rounded-lg p-4 space-y-3">
          <p className="text-sm text-green-400 font-semibold">Your binding is created. Save this ID:</p>
          <div>
            <p className="text-xs text-default mb-0.5">Binding ID</p>
            <p
              className="font-mono text-xs text-white bg-surface-2 border border-surface-3 rounded px-2 py-1 cursor-pointer hover:border-accent"
              onClick={() => navigator.clipboard.writeText(bindingId)}
              title="Click to copy"
            >
              {bindingId}
            </p>
          </div>
        </div>
        <div className="bg-surface-1 border border-surface-3 rounded-lg p-4 text-sm space-y-2">
          <p className="font-semibold text-white">Next steps:</p>
          <ol className="list-decimal list-inside space-y-1 text-default">
            <li>Go to <strong className="text-white">Bindings</strong> -- load your Binding ID -- install extensions on each assembly.</li>
            <li>Go to <strong className="text-white">Bindings</strong> -- expand an assembly -- add rules to its policy.</li>
            <li>Go to <strong className="text-white">Policies</strong> -- apply rules in bulk across building groups.</li>
          </ol>
        </div>
        <button onClick={() => setPhase({ kind: 'idle' })} className="text-sm text-accent hover:underline">
          Set up another binding
        </button>
      </div>
    )
  }

  // ---- Main form ----

  const totalDiscovered = (owned?.gates.length ?? 0) + (owned?.turrets.length ?? 0) + (owned?.ssus.length ?? 0)
  const assemblies = buildAssemblyList()

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-4">
      <h1 className="text-xl font-bold text-white">Setup</h1>
      <p className="text-sm text-default">
        Creates your <strong className="text-white">Assembly Binding</strong> and registers
        selected assemblies in one wallet transaction. You can add policy rules afterwards.
      </p>

      {/* Assemblies */}
      <div className="bg-surface-1 border border-surface-3 rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-semibold text-default uppercase tracking-wider">Assemblies</h2>

        {/* Auto-discovered */}
        {!isConnected && (
          <p className="text-xs text-default">Connect your wallet to discover your assemblies.</p>
        )}

        {isConnected && ownedLoading && (
          <p className="text-xs text-default animate-pulse">Scanning wallet for assemblies...</p>
        )}

        {isConnected && !ownedLoading && totalDiscovered === 0 && (
          <p className="text-xs text-default">No assemblies found in your wallet. Use manual entry below.</p>
        )}

        {isConnected && !ownedLoading && totalDiscovered > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-default">
                Found <span className="text-white">{totalDiscovered}</span> assembl{totalDiscovered !== 1 ? 'ies' : 'y'} in your wallet.
                Select the ones to register:
              </p>
              <div className="flex gap-3 text-xs">
                <button
                  onClick={() => {
                    const all = new Set([...(owned?.gates ?? []), ...(owned?.turrets ?? []), ...(owned?.ssus ?? [])])
                    setSelected(all)
                  }}
                  disabled={isRunning}
                  className="text-accent hover:underline disabled:opacity-50"
                >
                  Select all
                </button>
                <button
                  onClick={() => setSelected(new Set())}
                  disabled={isRunning}
                  className="text-default hover:text-white disabled:opacity-50"
                >
                  Clear
                </button>
              </div>
            </div>

            <AssemblyChecklist label="Gates" assemblies={owned?.assemblies.filter((a) => a.type === 'gate') ?? []} selected={selected} onToggle={toggleAssembly} disabled={isRunning} />
            <AssemblyChecklist label="Turrets" assemblies={owned?.assemblies.filter((a) => a.type === 'turret') ?? []} selected={selected} onToggle={toggleAssembly} disabled={isRunning} />
            <AssemblyChecklist label="Storage Units" assemblies={owned?.assemblies.filter((a) => a.type === 'ssu' || a.type === 'assembly') ?? []} selected={selected} onToggle={toggleAssembly} disabled={isRunning} />
          </div>
        )}

        {/* Manual entry fallback */}
        <details className="text-xs">
          <summary className="text-default cursor-pointer hover:text-white select-none">
            Add assembly manually
          </summary>
          <div className="mt-2 space-y-2">
            <div className="flex gap-2">
              <select
                className="bg-surface-2 border border-surface-3 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-accent disabled:opacity-50"
                value={manualType}
                onChange={(e) => setManualType(e.target.value as AssemblyType)}
                disabled={isRunning}
              >
                <option value="gate">Gate</option>
                <option value="turret">Turret</option>
                <option value="ssu">SSU</option>
              </select>
              <input
                className="flex-1 bg-surface-2 border border-surface-3 rounded px-2 py-1 text-sm text-white font-mono placeholder:text-default focus:outline-none focus:border-accent disabled:opacity-50"
                placeholder="Object ID (0x...)"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addManual()}
                disabled={isRunning}
              />
              <button
                onClick={addManual}
                disabled={isRunning || !manualInput.trim()}
                className="px-3 py-1 bg-accent hover:bg-accent-dim text-white text-sm rounded disabled:opacity-50"
              >
                Add
              </button>
            </div>
            {manualList.length > 0 && (
              <ul className="space-y-1">
                {manualList.map((a) => (
                  <li key={a.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-default uppercase">{a.type === 'ssu' ? 'SSU' : a.type}</span>
                      <span className="font-mono text-white">{a.id.slice(0, 20)}...</span>
                    </div>
                    <button
                      onClick={() => setManualList((prev) => prev.filter((x) => x.id !== a.id))}
                      disabled={isRunning}
                      className="text-default hover:text-red-400"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>

        {/* Summary */}
        {assemblies.length > 0 && (
          <p className="text-xs text-green-400">
            {assemblies.length} assembl{assemblies.length !== 1 ? 'ies' : 'y'} will be registered.
          </p>
        )}
      </div>

      {/* Error */}
      {phase.kind === 'error' && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-3">
          <p className="text-sm text-red-400 font-semibold mb-1">Setup failed</p>
          <p className="text-xs text-red-300">{phase.message}</p>
          <button onClick={() => setPhase({ kind: 'idle' })} className="mt-2 text-xs text-default hover:text-white">
            Try again
          </button>
        </div>
      )}

      {/* Progress */}
      {isRunning && (
        <div className="bg-surface-1 border border-surface-3 rounded-lg p-3">
          <p className="text-sm text-default animate-pulse">
            Creating binding and registering assemblies...
          </p>
          <p className="text-xs text-default mt-1">Approve the transaction in your wallet.</p>
        </div>
      )}

      {/* Submit */}
      {!isRunning && (
        <button
          onClick={handleSetup}
          disabled={!isConnected}
          className="w-full py-2.5 bg-accent hover:bg-accent-dim text-white text-sm rounded font-semibold disabled:opacity-50"
        >
          {!isConnected ? 'Connect wallet to continue' : 'Create Binding'}
        </button>
      )}
    </div>
  )
}
