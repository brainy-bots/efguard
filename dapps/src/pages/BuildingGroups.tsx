import { useState } from 'react'
import { useConnection } from '@evefrontier/dapp-kit'
import { useBuildingGroups } from '../hooks/useBuildingGroups'
import { useOwnedAssemblies, displayName, type OwnedAssembly } from '../hooks/useOwnedAssemblies'
import type { AssemblyType } from '../types'

const STATUS_COLORS: Record<string, string> = {
  ONLINE: 'text-green-400', OFFLINE: 'text-red-400', ANCHORED: 'text-yellow-400',
}

function AssemblyLabel({ assembly }: { assembly: OwnedAssembly }) {
  const d = assembly.details
  const name = displayName(assembly)
  const statusColor = STATUS_COLORS[d?.status ?? ''] ?? 'text-default'
  return (
    <span className="flex items-center gap-2" title={assembly.id}>
      <span className="text-white">{name}</span>
      {d?.customName && d.typeName && (
        <span className="text-default text-[10px]">({d.typeName})</span>
      )}
      {d?.status && (
        <span className={`${statusColor} uppercase text-[10px] font-semibold`}>{d.status}</span>
      )}
    </span>
  )
}

function AssemblyPicker({
  assemblies,
  alreadyAdded,
  onAdd,
}: {
  assemblies: OwnedAssembly[]
  alreadyAdded: Set<string>
  onAdd: (id: string, type: AssemblyType) => void
}) {
  const available = assemblies.filter((a) => !alreadyAdded.has(a.id))
  if (available.length === 0) {
    return <p className="text-xs text-default">All your assemblies are already in this group.</p>
  }

  return (
    <div className="space-y-1 max-h-48 overflow-y-auto">
      {available.map((a) => (
        <div key={a.id} className="flex items-center justify-between text-xs py-1 px-2 rounded hover:bg-surface-2">
          <div className="min-w-0 flex-1">
            <AssemblyLabel assembly={a} />
            {a.details?.description && (
              <div className="text-default text-[10px] truncate">{a.details.description}</div>
            )}
          </div>
          <button
            onClick={() => onAdd(a.id, a.type === 'assembly' ? 'ssu' : a.type as AssemblyType)}
            className="ml-2 px-2 py-0.5 bg-accent hover:bg-accent-dim text-white rounded text-[10px] shrink-0"
          >
            Add
          </button>
        </div>
      ))}
    </div>
  )
}

export function BuildingGroups() {
  const { walletAddress, isConnected } = useConnection()
  const { groups, createGroup, deleteGroup, addEntry, removeEntry } = useBuildingGroups()
  const { data: owned, isLoading: ownedLoading } = useOwnedAssemblies(walletAddress)
  const [newName, setNewName] = useState('')
  const [pickerOpen, setPickerOpen] = useState<string | null>(null)

  // Manual entry state per group
  const [entryInputs, setEntryInputs] = useState<Record<string, { id: string; type: AssemblyType }>>({})

  function handleCreate() {
    const name = newName.trim()
    if (!name) return
    createGroup(name)
    setNewName('')
  }

  function getEntryInput(groupId: string) {
    return entryInputs[groupId] ?? { id: '', type: 'gate' as AssemblyType }
  }

  function handleAddEntry(groupId: string) {
    const input = getEntryInput(groupId)
    if (!input.id.trim()) return
    addEntry(groupId, { assemblyId: input.id.trim(), assemblyType: input.type })
    setEntryInputs((prev) => ({ ...prev, [groupId]: { id: '', type: input.type } }))
  }

  // Lookup assembly details by ID
  function getAssemblyInfo(assemblyId: string): OwnedAssembly | undefined {
    return owned?.assemblies.find((a) => a.id === assemblyId)
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <h1 className="text-xl font-bold text-white">Building Groups</h1>
      <p className="text-sm text-default">
        Building groups are local collections of assemblies. Use them on the Policies page to
        apply a role to many assemblies at once.
      </p>

      {/* Create new group */}
      <div className="bg-surface-1 border border-surface-3 rounded-lg p-4">
        <h2 className="text-sm font-semibold text-default uppercase tracking-wider mb-3">
          New Group
        </h2>
        <div className="flex gap-2">
          <input
            className="flex-1 bg-surface-2 border border-surface-3 rounded px-3 py-1.5 text-sm text-white placeholder:text-default focus:outline-none focus:border-accent"
            placeholder="Group name (e.g. Alpha Sector Gates)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
          <button
            onClick={handleCreate}
            disabled={!newName.trim()}
            className="px-4 py-1.5 bg-accent hover:bg-accent-dim text-white text-sm rounded disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </div>

      {/* Existing groups */}
      {groups.length === 0 && (
        <p className="text-sm text-default">No building groups yet.</p>
      )}

      {groups.map((group) => {
        const addedIds = new Set(group.entries.map((e) => e.assemblyId))
        const isPickerOpen = pickerOpen === group.id

        return (
          <div key={group.id} className="bg-surface-1 border border-surface-3 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-white">{group.name}</h2>
              <button
                onClick={() => deleteGroup(group.id)}
                className="text-xs text-default hover:text-red-400"
              >
                Delete group
              </button>
            </div>

            {/* Assembly list with details */}
            {group.entries.length === 0 ? (
              <p className="text-xs text-default mb-3">No assemblies added.</p>
            ) : (
              <ul className="space-y-2 mb-3">
                {group.entries.map((entry) => {
                  const info = getAssemblyInfo(entry.assemblyId)
                  return (
                    <li key={entry.assemblyId} className="flex items-center justify-between text-xs" title={entry.assemblyId}>
                      <div className="min-w-0 flex-1">
                        {info ? (
                          <>
                            <AssemblyLabel assembly={info} />
                            {info.details?.description && (
                              <div className="text-default text-[10px] truncate">{info.details.description}</div>
                            )}
                          </>
                        ) : (
                          <span className="text-default">{entry.assemblyId.slice(0, 12)}…</span>
                        )}
                      </div>
                      <button
                        onClick={() => removeEntry(group.id, entry.assemblyId)}
                        className="text-default hover:text-red-400 ml-3 shrink-0"
                      >
                        Remove
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}

            {/* Add from discovered assemblies */}
            {isConnected && owned && owned.assemblies.length > 0 && (
              <div className="mb-3">
                <button
                  onClick={() => setPickerOpen(isPickerOpen ? null : group.id)}
                  className="text-xs text-accent hover:underline mb-2"
                >
                  {isPickerOpen ? 'Hide assembly picker' : 'Add from your assemblies'}
                </button>
                {isPickerOpen && (
                  <div className="bg-surface-2 border border-surface-3 rounded p-2 mt-1">
                    {ownedLoading ? (
                      <p className="text-xs text-default animate-pulse">Loading assemblies...</p>
                    ) : (
                      <AssemblyPicker
                        assemblies={owned.assemblies}
                        alreadyAdded={addedIds}
                        onAdd={(id, type) => addEntry(group.id, { assemblyId: id, assemblyType: type })}
                      />
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Manual entry fallback */}
            <details className="text-xs">
              <summary className="text-default cursor-pointer hover:text-white select-none">
                Add manually by ID
              </summary>
              <div className="flex gap-2 mt-2">
                <select
                  className="bg-surface-2 border border-surface-3 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-accent"
                  value={getEntryInput(group.id).type}
                  onChange={(e) =>
                    setEntryInputs((prev) => ({
                      ...prev,
                      [group.id]: { ...getEntryInput(group.id), type: e.target.value as AssemblyType },
                    }))
                  }
                >
                  <option value="gate">Gate</option>
                  <option value="turret">Turret</option>
                  <option value="ssu">SSU</option>
                </select>
                <input
                  className="flex-1 bg-surface-2 border border-surface-3 rounded px-2 py-1 text-xs text-white font-mono placeholder:text-default focus:outline-none focus:border-accent"
                  placeholder="Object ID (0x...)"
                  value={getEntryInput(group.id).id}
                  onChange={(e) =>
                    setEntryInputs((prev) => ({
                      ...prev,
                      [group.id]: { ...getEntryInput(group.id), id: e.target.value },
                    }))
                  }
                  onKeyDown={(e) => e.key === 'Enter' && handleAddEntry(group.id)}
                />
                <button
                  onClick={() => handleAddEntry(group.id)}
                  disabled={!getEntryInput(group.id).id.trim()}
                  className="px-3 py-1 bg-accent hover:bg-accent-dim text-white text-xs rounded disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            </details>
          </div>
        )
      })}
    </div>
  )
}
