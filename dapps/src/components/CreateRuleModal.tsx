import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { RuleTarget } from '../types'
import { DATAHUB_API_URL } from '../env'
import { lookupCharacterByGameId } from '../lib/character-lookup'
import { theme, S } from '../lib/theme'

interface TribeInfo { id: number; name: string; nameShort: string }

function useTribes() {
  return useQuery({
    queryKey: ['datahub-tribes'],
    queryFn: async (): Promise<TribeInfo[]> => {
      const res = await fetch(`${DATAHUB_API_URL}/v2/tribes?limit=500`)
      const data = await res.json()
      // Deduplicate by ID (API sometimes returns duplicates)
      const seen = new Set<number>()
      const unique: TribeInfo[] = []
      for (const t of (data.data ?? []) as TribeInfo[]) {
        if (!seen.has(t.id)) { seen.add(t.id); unique.push(t) }
      }
      return unique
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
  const [type, setType] = useState<'tribe' | 'character' | 'everyone' | 'min_balance' | 'token_holder' | 'attestation'>('tribe')
  const [tribeId, setTribeId] = useState('')
  const [tribeName, setTribeName] = useState('')
  const [charId, setCharId] = useState('')
  const [charName, setCharName] = useState<string | null>(null)
  const [charLooking, setCharLooking] = useState(false)
  const [charNotFound, setCharNotFound] = useState(false)
  const [tribeQuery, setTribeQuery] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const { data: tribes, isLoading: tribesLoading } = useTribes()
  const searchRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowSearch(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const q = tribeQuery.trim().toLowerCase()
  const qWords = q.split(/\s+/).filter(Boolean)
  const filtered = tribes?.filter((t) => {
    if (qWords.length === 0) return true // show all when empty
    const haystack = `${t.name} ${t.nameShort} ${t.id}`.toLowerCase()
    return qWords.every((w) => haystack.includes(w))
  }).sort((a, b) => {
    if (qWords.length === 0) return a.name.localeCompare(b.name)
    const aExact = a.name.toLowerCase() === q || a.nameShort.toLowerCase() === q
    const bExact = b.name.toLowerCase() === q || b.nameShort.toLowerCase() === q
    if (aExact && !bExact) return -1
    if (!aExact && bExact) return 1
    return a.name.localeCompare(b.name)
  }).slice(0, 20) ?? []

  async function handleCharLookup() {
    const id = charId.trim()
    if (!id) return
    setCharLooking(true)
    setCharNotFound(false)
    setCharName(null)
    try {
      const result = await lookupCharacterByGameId(id)
      if (result) {
        setCharName(result.name || `Player #${id}`)
        setCharNotFound(false)
      } else {
        setCharNotFound(true)
      }
    } catch {
      setCharNotFound(true)
    } finally {
      setCharLooking(false)
    }
  }

  function canCreate(): boolean {
    if (type === 'tribe') return !!tribeId
    if (type === 'character') return !!charId.trim() && !!charName && !charNotFound
    if (type === 'everyone') return true
    return false // advanced types not yet configurable from DApp
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
      if (!charId.trim() || !charName) return
      target = { type: 'character', char_game_id: charId.trim() }
      label = `${charName} (#${charId.trim()})`
    } else {
      target = { type: 'everyone' }
      label = 'Everyone'
    }

    onCreate(label, target)
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={onClose}>
      <div className="p-6 w-96 space-y-4" style={S.panel} onClick={(e) => e.stopPropagation()}>
        <h2 className="text-sm font-semibold" style={{ color: theme.textPrimary }}>Add Rule</h2>

        <div>
          <label className="text-xs block mb-1" style={{ color: theme.textSecondary }}>Who does this rule apply to?</label>
          <select
            className="w-full"
            style={S.select}
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
          >
            <option value="tribe">A Tribe</option>
            <option value="character">A Specific Player</option>
            <option value="everyone">Everyone</option>
            <optgroup label="Advanced Conditions">
              <option value="min_balance">Minimum Coin Balance</option>
              <option value="token_holder">NFT / Token Holder</option>
              <option value="attestation">Signed Attestation</option>
            </optgroup>
          </select>
        </div>

        {type === 'tribe' && (
          <div ref={searchRef} className="relative">
            <label className="text-xs block mb-1" style={{ color: theme.textSecondary }}>Search tribe</label>
            <input
              style={S.input}
              placeholder="Type a tribe name, ticker, or ID..."
              value={tribeQuery}
              onChange={(e) => { setTribeQuery(e.target.value); setShowSearch(true) }}
              onFocus={() => setShowSearch(true)}
              autoFocus
            />
            {showSearch && tribesLoading && (
              <div
                className="absolute z-10 mt-1 w-full px-2 py-2 text-xs"
                style={{ background: theme.panelBg, border: `1px solid ${theme.border}`, color: theme.textSecondary }}
              >
                Loading tribes...
              </div>
            )}
            {showSearch && !tribesLoading && filtered.length === 0 && tribeQuery.trim().length > 0 && (
              <div
                className="absolute z-10 mt-1 w-full px-2 py-2 text-xs"
                style={{ background: theme.panelBg, border: `1px solid ${theme.border}`, color: theme.textMuted }}
              >
                No tribes found for "{tribeQuery.trim()}"
              </div>
            )}
            {showSearch && filtered.length > 0 && (
              <ul
                className="absolute z-10 mt-1 w-full shadow-lg max-h-40 overflow-y-auto"
                style={{ background: theme.panelBg, border: `1px solid ${theme.border}` }}
              >
                {filtered.map((t) => (
                  <li key={t.id}>
                    <button
                      className="w-full text-left px-2 py-1.5 text-xs flex items-center gap-2"
                      style={{ color: theme.textPrimary }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = theme.headerBg }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                      onClick={() => {
                        setTribeId(String(t.id))
                        setTribeName(`[${t.nameShort}] ${t.name}`)
                        setTribeQuery(`[${t.nameShort}] ${t.name}`)
                        setShowSearch(false)
                      }}
                    >
                      <span className="font-mono" style={{ color: theme.orange }}>[{t.nameShort}]</span>
                      <span style={{ color: theme.textPrimary }}>{t.name}</span>
                      <span className="ml-auto" style={{ color: theme.textSecondary }}>#{t.id}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {tribeId && (
              <p className="text-xs mt-1" style={{ color: theme.green }}>Selected: {tribeName}</p>
            )}
          </div>
        )}

        {type === 'character' && (
          <div>
            <label className="text-xs block mb-1" style={{ color: theme.textSecondary }}>Player Game ID</label>
            <div className="flex gap-2">
              <input
                className="flex-1 font-mono"
                style={S.input}
                placeholder="e.g. 2112080400"
                value={charId}
                onChange={(e) => {
                  setCharId(e.target.value)
                  setCharName(null)
                  setCharNotFound(false)
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleCharLookup()}
                autoFocus
              />
              <button
                onClick={handleCharLookup}
                disabled={!charId.trim() || charLooking}
                className="disabled:opacity-50"
                style={S.btn}
              >
                {charLooking ? 'Searching...' : 'Verify'}
              </button>
            </div>
            {charName && (
              <p className="text-xs mt-1" style={{ color: theme.green }}>Found: {charName}</p>
            )}
            {charNotFound && (
              <p className="text-xs mt-1" style={{ color: theme.red }}>Player not found. Check the ID and try again.</p>
            )}
            {!charName && !charNotFound && !charLooking && (
              <p className="text-[10px] mt-1" style={{ color: theme.textSecondary }}>
                Enter the player's game ID and click Verify to confirm they exist.
              </p>
            )}
          </div>
        )}

        {type === 'everyone' && (
          <p className="text-xs" style={{ color: theme.textSecondary }}>
            This rule will match all players. Typically used as a catch-all at the bottom of the list.
          </p>
        )}

        {type === 'min_balance' && (
          <div>
            <label className="text-xs block mb-1" style={{ color: theme.textSecondary }}>Minimum Coin Balance</label>
            <p className="text-xs mb-2" style={{ color: theme.textMuted }}>
              Player must hold at least this amount of SUI (or other coin type) to access the building.
              The player proves ownership by including their coin in the transaction.
            </p>
            <div style={{ background: theme.headerBg, border: `1px solid ${theme.border}`, padding: '8px 10px', fontSize: '10px', color: theme.orange }}>
              This condition is available on-chain but not yet configurable from the DApp.
              Use the CLI or a custom script to create a MinBalanceCondition.
            </div>
          </div>
        )}

        {type === 'token_holder' && (
          <div>
            <label className="text-xs block mb-1" style={{ color: theme.textSecondary }}>NFT / Token Holder</label>
            <p className="text-xs mb-2" style={{ color: theme.textMuted }}>
              Player must hold a specific type of Sui object (NFT, membership card, etc.).
              Works with any token — streamers can gate access to NFT holders, tribes can use membership cards.
            </p>
            <div style={{ background: theme.headerBg, border: `1px solid ${theme.border}`, padding: '8px 10px', fontSize: '10px', color: theme.orange }}>
              This condition is available on-chain but not yet configurable from the DApp.
              Use the CLI or a custom script to create a TokenHolderCondition.
            </div>
          </div>
        )}

        {type === 'attestation' && (
          <div>
            <label className="text-xs block mb-1" style={{ color: theme.textSecondary }}>Signed Attestation</label>
            <p className="text-xs mb-2" style={{ color: theme.textMuted }}>
              A trusted server signs an attestation that the player meets certain criteria
              (inventory totals, reputation, Discord role, etc.). The signature is verified on-chain.
              Future: replaceable with zero-knowledge proofs for trustless verification.
            </p>
            <div style={{ background: theme.headerBg, border: `1px solid ${theme.border}`, padding: '8px 10px', fontSize: '10px', color: theme.orange }}>
              This condition is available on-chain but not yet configurable from the DApp.
              Use the CLI or a custom script to create an AttestationCondition.
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
            disabled={!canCreate()}
            className="disabled:opacity-50"
            style={S.btn}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  )
}
