/**
 * RuleList — displays and edits an assembly's inline policy rules.
 * Replaces the old RoleMatrix that showed a group x assembly role grid.
 */
import { useState } from 'react'
import type { PolicyRule, RuleEffect, RuleTarget } from '../types'

interface RuleListProps {
  rules: PolicyRule[]
  readOnly: boolean
  isPending: boolean
  onAddRule: (rule: PolicyRule) => void
  onRemoveRule: (index: number) => void
}

function ruleLabel(rule: PolicyRule): string {
  switch (rule.target.type) {
    case 'tribe': return `Tribe #${rule.target.tribe_id}`
    case 'character': return `Character ${rule.target.char_game_id}`
    case 'everyone': return 'Everyone'
  }
}

export function RuleList({ rules, readOnly, isPending, onAddRule, onRemoveRule }: RuleListProps) {
  const [addType, setAddType] = useState<'tribe' | 'character' | 'everyone'>('tribe')
  const [addValue, setAddValue] = useState('')
  const [addEffect, setAddEffect] = useState<RuleEffect>('Allow')

  function handleAdd() {
    let target: RuleTarget
    if (addType === 'tribe') {
      const id = parseInt(addValue.trim(), 10)
      if (isNaN(id) || id < 0) return
      target = { type: 'tribe', tribe_id: id }
    } else if (addType === 'character') {
      if (!addValue.trim()) return
      target = { type: 'character', char_game_id: addValue.trim() }
    } else {
      target = { type: 'everyone' }
    }
    onAddRule({ condition_id: '', target, effect: addEffect })
    setAddValue('')
  }

  return (
    <div>
      {rules.length === 0 ? (
        <p className="text-xs text-default">No rules. All traffic uses default policy.</p>
      ) : (
        <ul className="space-y-1 mb-3">
          {rules.map((rule, i) => (
            <li key={i} className="flex items-center justify-between text-sm">
              <span>
                <span className="text-default text-xs mr-2">#{i}</span>
                <span
                  className={`text-xs font-medium mr-2 ${
                    rule.effect === 'Allow' ? 'text-green-400' : 'text-red-400'
                  }`}
                >
                  {rule.effect}
                </span>
                <span className="text-white">{ruleLabel(rule)}</span>
              </span>
              {!readOnly && (
                <button
                  onClick={() => onRemoveRule(i)}
                  disabled={isPending}
                  className="text-xs text-default hover:text-red-400 ml-4"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <div className="flex gap-2 items-center flex-wrap">
          <select
            value={addType}
            onChange={(e) => { setAddType(e.target.value as typeof addType); setAddValue('') }}
            className="bg-surface-1 border border-surface-3 rounded px-2 py-1 text-xs text-white"
          >
            <option value="tribe">Tribe</option>
            <option value="character">Character ID</option>
            <option value="everyone">Everyone</option>
          </select>
          <select
            value={addEffect}
            onChange={(e) => setAddEffect(e.target.value as RuleEffect)}
            className="bg-surface-1 border border-surface-3 rounded px-2 py-1 text-xs text-white"
          >
            <option value="Allow">Allow</option>
            <option value="Deny">Deny</option>
          </select>

          {addType !== 'everyone' && (
            <input
              className="flex-1 min-w-[120px] bg-surface-1 border border-surface-3 rounded px-2 py-1 text-xs text-white placeholder:text-default focus:outline-none focus:border-accent"
              placeholder={addType === 'tribe' ? 'Tribe ID (number)' : 'Character game ID'}
              value={addValue}
              onChange={(e) => setAddValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
          )}

          <button
            onClick={handleAdd}
            disabled={isPending || (addType !== 'everyone' && !addValue.trim())}
            className="px-3 py-1 bg-accent hover:bg-accent-dim text-white text-xs rounded disabled:opacity-50"
          >
            {isPending ? '...' : 'Add Rule'}
          </button>
        </div>
      )}
    </div>
  )
}
