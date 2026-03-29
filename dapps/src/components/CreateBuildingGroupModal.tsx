import { useState } from 'react'
import { useConnection } from '@evefrontier/dapp-kit'
import { useBuildingGroups } from '../hooks/useBuildingGroups'
import { useOwnedAssemblies, displayName } from '../hooks/useOwnedAssemblies'
import type { AssemblyType } from '../types'

export function CreateBuildingGroupModal({
  onClose,
  onCreate,
}: {
  onClose: () => void
  onCreate: (groupId: string) => void
}) {
  const { walletAddress } = useConnection()
  const { createGroup, addEntry } = useBuildingGroups()
  const { data: owned } = useOwnedAssemblies(walletAddress)
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleCreate() {
    const trimmed = name.trim()
    if (!trimmed) return
    const groupId = createGroup(trimmed)

    // Add selected assemblies
    for (const assembly of owned?.assemblies ?? []) {
      if (selected.has(assembly.id)) {
        const type: AssemblyType = assembly.type === 'assembly' ? 'ssu' : assembly.type as AssemblyType
        addEntry(groupId, { assemblyId: assembly.id, assemblyType: type })
      }
    }

    onCreate(groupId)
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface-1 border border-surface-3 rounded-lg p-6 w-[500px] max-h-[80vh] overflow-y-auto space-y-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-sm font-semibold text-white">Create Building Group</h2>

        <input
          className="w-full bg-surface-2 border border-surface-3 rounded px-3 py-1.5 text-sm text-white placeholder:text-default focus:outline-none focus:border-accent"
          placeholder="Group name (e.g. Alpha Sector Gates)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />

        {owned && owned.assemblies.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-default">Select buildings</label>
              <div className="flex gap-2 text-xs">
                <button
                  onClick={() => setSelected(new Set(owned.assemblies.map((a) => a.id)))}
                  className="text-accent hover:underline"
                >
                  All
                </button>
                <button
                  onClick={() => setSelected(new Set())}
                  className="text-default hover:text-white"
                >
                  None
                </button>
              </div>
            </div>
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {owned.assemblies.map((a) => (
                <label key={a.id} className="flex items-center gap-2 text-xs py-1 px-2 rounded hover:bg-surface-2 cursor-pointer" title={a.id}>
                  <input
                    type="checkbox"
                    checked={selected.has(a.id)}
                    onChange={() => toggle(a.id)}
                    className="accent-accent"
                  />
                  <span className="text-white">{displayName(a)}</span>
                  {a.details?.status && (
                    <span className={`text-[10px] uppercase font-semibold ml-auto ${
                      a.details.status === 'ONLINE' ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {a.details.status}
                    </span>
                  )}
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-default hover:text-white">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim()}
            className="px-4 py-1.5 bg-accent hover:bg-accent-dim text-white text-xs rounded disabled:opacity-50"
          >
            Create ({selected.size} buildings)
          </button>
        </div>
      </div>
    </div>
  )
}
