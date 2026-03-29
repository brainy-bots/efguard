import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { RuleTarget } from '../types'

interface TribeInfo { id: number; name: string; nameShort: string }

function useTribes() {
  return useQuery({
    queryKey: ['datahub-tribes'],
    queryFn: async (): Promise<TribeInfo[]> => {
      const res = await fetch('https://world-api-stillness.live.tech.evefrontier.com/v2/tribes')
      const data = await res.json()
      return (data.data ?? []) as TribeInfo[]
    },
    staleTime: 5 * 60_000,
  })
}

export function CreateRuleModal({
  onClose,
  onCreate,
}: {
  onClose: () => void
  onCreate: (label: string, target: RuleTarget) => void
}) {
  const [type, setType] = useState<'tribe' | 'character' | 'everyone'>('tribe')
  const [tribeId, setTribeId] = useState('')
  const [tribeName, setTribeName] = useState('')
  const [charId, setCharId] = useState('')
  const [tribeQuery, setTribeQuery] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const { data: tribes } = useTribes()
  const searchRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowSearch(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const q = tribeQuery.trim().toLowerCase()
  const filtered = tribes?.filter((t) =>
    q.length > 0 && (
      t.name.toLowerCase().includes(q) ||
      t.nameShort.toLowerCase().includes(q) ||
      String(t.id).includes(q)
    ),
  ).slice(0, 10) ?? []

  function canCreate(): boolean {
    if (type === 'tribe') return !!tribeId
    if (type === 'character') return !!charId.trim()
    return true // everyone
  }

  function handleCreate() {
    let target: RuleTarget
    let label: string

    if (type === 'tribe') {
      const id = parseInt(tribeId, 10)
      if (isNaN(id)) return
      target = { type: 'tribe', tribe_id: id }
      label = tribeName || `Tribe #${id}`
    } else if (type === 'character') {
      if (!charId.trim()) return
      target = { type: 'character', char_game_id: charId.trim() }
      label = `Character #${charId.trim()}`
    } else {
      target = { type: 'everyone' }
      label = 'Everyone'
    }

    onCreate(label, target)
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface-1 border border-surface-3 rounded-lg p-6 w-96 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-sm font-semibold text-white">Add Rule</h2>

        <div>
          <label className="text-xs text-default block mb-1">Who does this rule apply to?</label>
          <select
            className="w-full bg-surface-2 border border-surface-3 rounded px-2 py-1.5 text-sm text-white"
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
          >
            <option value="tribe">A Tribe</option>
            <option value="character">A Specific Player</option>
            <option value="everyone">Everyone</option>
          </select>
        </div>

        {type === 'tribe' && (
          <div ref={searchRef} className="relative">
            <label className="text-xs text-default block mb-1">Search tribe</label>
            <input
              className="w-full bg-surface-2 border border-surface-3 rounded px-2 py-1.5 text-sm text-white placeholder:text-default focus:outline-none focus:border-accent"
              placeholder="Type a tribe name, ticker, or ID..."
              value={tribeQuery}
              onChange={(e) => { setTribeQuery(e.target.value); setShowSearch(true) }}
              onFocus={() => setShowSearch(true)}
              autoFocus
            />
            {showSearch && filtered.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full bg-surface-1 border border-surface-3 rounded shadow-lg max-h-40 overflow-y-auto">
                {filtered.map((t) => (
                  <li key={t.id}>
                    <button
                      className="w-full text-left px-2 py-1.5 text-xs hover:bg-surface-2 flex items-center gap-2"
                      onClick={() => {
                        setTribeId(String(t.id))
                        setTribeName(`[${t.nameShort}] ${t.name}`)
                        setTribeQuery(`[${t.nameShort}] ${t.name}`)
                        setShowSearch(false)
                      }}
                    >
                      <span className="text-accent font-mono">[{t.nameShort}]</span>
                      <span className="text-white">{t.name}</span>
                      <span className="text-default ml-auto">#{t.id}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {tribeId && (
              <p className="text-xs text-green-400 mt-1">Selected: {tribeName}</p>
            )}
          </div>
        )}

        {type === 'character' && (
          <div>
            <label className="text-xs text-default block mb-1">Player Game ID</label>
            <input
              className="w-full bg-surface-2 border border-surface-3 rounded px-2 py-1.5 text-sm text-white font-mono placeholder:text-default focus:outline-none focus:border-accent"
              placeholder="Numeric game ID (e.g. 811880)"
              value={charId}
              onChange={(e) => setCharId(e.target.value)}
              autoFocus
            />
            <p className="text-[10px] text-default mt-1">
              You can find a player's game ID on the Debug page by looking up their wallet address.
            </p>
          </div>
        )}

        {type === 'everyone' && (
          <p className="text-xs text-default">
            This rule will match all players. Typically used as a catch-all at the bottom of the list.
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-default hover:text-white">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!canCreate()}
            className="px-4 py-1.5 bg-accent hover:bg-accent-dim text-white text-xs rounded disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  )
}
