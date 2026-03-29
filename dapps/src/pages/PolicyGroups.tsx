/**
 * Tribe Lookup page.
 *
 * The old PolicyGroups page managed on-chain PolicyGroup objects which no
 * longer exist. This page preserves the tribe search autocomplete so users
 * can look up tribe IDs to use when creating rules on the Bindings or
 * Policies pages.
 */
import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DATAHUB_API_URL } from '../env'

// ---- Tribe data from Datahub API ----

interface TribeInfo {
  id: number
  name: string
  nameShort: string
}

function useTribes() {
  return useQuery({
    queryKey: ['datahub-tribes'],
    queryFn: async (): Promise<TribeInfo[]> => {
      const res = await fetch(`${DATAHUB_API_URL}/v2/tribes`)
      const data = await res.json()
      return (data.data ?? []) as TribeInfo[]
    },
    staleTime: 5 * 60_000,
  })
}

// ---- Tribe search autocomplete (reusable) ----

export function TribeSearch({
  onSelect,
  disabled,
}: {
  onSelect: (tribeId: number, name: string) => void
  disabled?: boolean
}) {
  const { data: tribes } = useTribes()
  const [query, setQuery] = useState('')
  const [showResults, setShowResults] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setShowResults(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const q = query.trim().toLowerCase()
  const filtered = tribes?.filter((t) =>
    q.length > 0 && (
      t.name.toLowerCase().includes(q) ||
      t.nameShort.toLowerCase().includes(q) ||
      String(t.id).includes(q)
    ),
  ).slice(0, 15) ?? []

  return (
    <div ref={ref} className="relative flex-1 min-w-[200px]">
      <input
        className="w-full bg-surface-1 border border-surface-3 rounded px-2 py-1 text-xs text-white placeholder:text-default focus:outline-none focus:border-accent"
        placeholder="Search tribe by name, ticker, or ID..."
        value={query}
        onChange={(e) => { setQuery(e.target.value); setShowResults(true) }}
        onFocus={() => setShowResults(true)}
        disabled={disabled}
      />
      {showResults && filtered.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full bg-surface-1 border border-surface-3 rounded shadow-lg max-h-48 overflow-y-auto">
          {filtered.map((t) => (
            <li key={t.id}>
              <button
                className="w-full text-left px-2 py-1.5 text-xs hover:bg-surface-2 flex items-center gap-2"
                onClick={() => {
                  onSelect(t.id, t.name)
                  setQuery('')
                  setShowResults(false)
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
      {showResults && q.length > 0 && filtered.length === 0 && (
        <div className="absolute z-10 mt-1 w-full bg-surface-1 border border-surface-3 rounded px-2 py-2 text-xs text-default">
          No tribes matching "{query}"
        </div>
      )}
    </div>
  )
}

// ---- Page component ----

export function PolicyGroups() {
  const [selected, setSelected] = useState<Array<{ id: number; name: string }>>([])

  function handleSelect(tribeId: number, name: string) {
    if (selected.some((s) => s.id === tribeId)) return
    setSelected((prev) => [...prev, { id: tribeId, name }])
  }

  function handleCopy() {
    const text = selected.map((s) => String(s.id)).join('\n')
    navigator.clipboard.writeText(text)
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <h1 className="text-xl font-bold text-white">Tribe Lookup</h1>
      <p className="text-sm text-default">
        Search for tribes to find their IDs. Use these IDs when adding tribe rules
        on the Bindings or Policies pages.
      </p>

      <div className="bg-surface-1 border border-surface-3 rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-semibold text-default uppercase tracking-wider">
          Search Tribes
        </h2>
        <TribeSearch onSelect={handleSelect} />
      </div>

      {selected.length > 0 && (
        <div className="bg-surface-1 border border-surface-3 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-default uppercase tracking-wider">
              Selected ({selected.length})
            </h2>
            <div className="flex gap-2">
              <button
                onClick={handleCopy}
                className="text-xs text-accent hover:underline"
              >
                Copy IDs
              </button>
              <button
                onClick={() => setSelected([])}
                className="text-xs text-default hover:text-white"
              >
                Clear
              </button>
            </div>
          </div>
          <ul className="space-y-1">
            {selected.map((s) => (
              <li key={s.id} className="flex items-center justify-between text-sm">
                <span>
                  <span className="text-white">{s.name}</span>
                  <span className="text-default ml-2">#{s.id}</span>
                </span>
                <button
                  onClick={() => setSelected((prev) => prev.filter((x) => x.id !== s.id))}
                  className="text-xs text-default hover:text-red-400"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
