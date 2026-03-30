import { useState } from 'react'
import { useConnection } from '@evefrontier/dapp-kit'
import { useOwnedAssemblies, displayName } from '../hooks/useOwnedAssemblies'
import type { AssemblyType, BuildingGroupEntry } from '../types'
import { theme, S } from '../lib/theme'

export function CreateBuildingGroupModal({
  onClose,
  onCreate,
  createGroup,
  addEntry,
}: {
  onClose: () => void
  onCreate: (groupId: string) => void
  createGroup: (name: string) => string
  addEntry: (groupId: string, entry: BuildingGroupEntry) => void
}) {
  const { walletAddress } = useConnection()
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

    for (const assembly of owned?.assemblies ?? []) {
      if (selected.has(assembly.id)) {
        const type: AssemblyType = assembly.type === 'assembly' ? 'ssu' : assembly.type as AssemblyType
        addEntry(groupId, { assemblyId: assembly.id, assemblyType: type })
      }
    }

    onCreate(groupId)
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={onClose}>
      <div className="p-6 w-[500px] max-h-[80vh] overflow-y-auto space-y-4" style={S.panel} onClick={(e) => e.stopPropagation()}>
        <h2 className="text-sm font-semibold" style={{ color: theme.textPrimary }}>Create Building Group</h2>

        <input
          style={S.input}
          placeholder="Group name (e.g. Alpha Sector Gates)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />

        {owned && owned.assemblies.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs" style={{ color: theme.textSecondary }}>Select buildings</label>
              <div className="flex gap-2 text-xs">
                <button
                  onClick={() => setSelected(new Set(owned.assemblies.map((a) => a.id)))}
                  style={{ color: theme.orange, background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  All
                </button>
                <button
                  onClick={() => setSelected(new Set())}
                  style={{ color: theme.textSecondary, background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  None
                </button>
              </div>
            </div>
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {owned.assemblies.map((a) => (
                <label
                  key={a.id}
                  className="flex items-center gap-2 text-xs py-1 px-2 cursor-pointer"
                  style={{ color: theme.textPrimary }}
                  title={a.id}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(a.id)}
                    onChange={() => toggle(a.id)}
                  />
                  <span>{displayName(a)}</span>
                  {a.details?.status && (
                    <span
                      className="text-[10px] uppercase font-semibold ml-auto"
                      style={{ color: a.details.status === 'ONLINE' ? theme.green : theme.red }}
                    >
                      {a.details.status}
                    </span>
                  )}
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs"
            style={{ color: theme.textSecondary, background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim()}
            className="disabled:opacity-50"
            style={S.btn}
          >
            Create ({selected.size} buildings)
          </button>
        </div>
      </div>
    </div>
  )
}
