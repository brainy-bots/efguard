import { useState, useRef } from 'react'
import { useConnection } from '@evefrontier/dapp-kit'
import { useDAppKit } from '@mysten/dapp-kit-react'
import { useBuildingGroups } from '../hooks/useBuildingGroups'
import { useRules } from '../hooks/useRules'
import { usePolicies, type PolicyEntry } from '../hooks/usePolicies'
import { useOwnedAssemblies, displayName } from '../hooks/useOwnedAssemblies'
// tx-builders used inline in handleApply
import type { RuleTarget, RuleEffect } from '../types'
import { CreateRuleModal } from '../components/CreateRuleModal'
import { CreateBuildingGroupModal } from '../components/CreateBuildingGroupModal'
import { HelpPanel } from '../components/HelpPanel'
import { theme, S } from '../lib/theme'

// ── Visitor access evaluation (client-side preview) ─────────────────────────

interface AccessResult {
  effect: RuleEffect
  matchedRuleLabel: string
}

function evaluateAccess(
  visitorTribeId: number | null,
  visitorCharId: string | null,
  entries: PolicyEntry[],
  getRule: (id: string) => { target: RuleTarget; label: string } | undefined,
): AccessResult | null {
  const sorted = [...entries].filter((e) => e.enabled).sort((a, b) => a.order - b.order)

  for (const entry of sorted) {
    const rule = getRule(entry.ruleId)
    if (!rule) continue

    const { target } = rule
    if (target.type === 'everyone') {
      return { effect: entry.effect, matchedRuleLabel: rule.label }
    }
    if (target.type === 'tribe' && visitorTribeId !== null && target.tribe_id === visitorTribeId) {
      return { effect: entry.effect, matchedRuleLabel: rule.label }
    }
    if (target.type === 'character' && visitorCharId !== null && target.char_game_id === visitorCharId) {
      return { effect: entry.effect, matchedRuleLabel: rule.label }
    }
  }

  return null // no matching rule
}

export function Overview() {
  const { walletAddress, isConnected } = useConnection()
  const dAppKit = useDAppKit()
  const { data: owned } = useOwnedAssemblies(walletAddress)
  const { groups, createGroup, addEntry: addBuildingEntry } = useBuildingGroups(walletAddress)
  const { rules, createRule, updateRule, deleteRule } = useRules(walletAddress)
  const {
    policies, addGroupPolicy, removeGroupPolicy,
    addEntry, removeEntry, toggleEntry, setEffect,
    reorderEntries, markClean,
  } = usePolicies(walletAddress)

  const [showRuleModal, setShowRuleModal] = useState<string | null>(null) // buildingGroupId
  const [showGroupModal, setShowGroupModal] = useState(false)
  const [applying, setApplying] = useState<string | null>(null)
  const [bindingId, setBindingId] = useState('')
  const [bindingOwner, setBindingOwner] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [visitorTribeId, setVisitorTribeId] = useState<string>('')
  const [visitorCharId, setVisitorCharId] = useState<string>('')

  // Drag state
  const dragItem = useRef<{ groupId: string; entryId: string } | null>(null)
  const dragOver = useRef<string | null>(null)

  const isOwner = !bindingOwner || (!!walletAddress && bindingOwner === walletAddress)

  function getRule(ruleId: string) {
    return rules.find((r) => r.id === ruleId)
  }

  function RuleLabel({ ruleId }: { ruleId: string }) {
    const rule = getRule(ruleId)
    if (!rule) return <span style={{ color: theme.textSecondary }}>Unknown rule</span>
    const { target } = rule

    const typeColors: Record<string, string> = {
      tribe: '#60a5fa',
      character: '#c084fc',
      everyone: '#facc15',
    }
    const typeLabels: Record<string, string> = {
      tribe: 'Tribe',
      character: 'Player',
      everyone: 'Everyone',
    }
    const color = typeColors[target.type] ?? theme.textSecondary
    const typeLabel = typeLabels[target.type] ?? target.type

    if (target.type === 'everyone') {
      return <span style={{ color }}>{typeLabel}</span>
    }

    const nameLabel = target.type === 'character'
      ? rule.label.replace(/^Character /, '')
      : rule.label

    return (
      <span>
        <span className="text-[10px] uppercase font-semibold mr-1.5" style={{ color }}>{typeLabel}</span>
        <span>{nameLabel}</span>
      </span>
    )
  }

  function sortedEntries(entries: PolicyEntry[]): PolicyEntry[] {
    return [...entries].sort((a, b) => a.order - b.order)
  }

  // ── Apply ALL pending changes to chain in one transaction ────────────
  async function handleApplyAll() {
    const dirtyPolicies = policies.filter((p) => p.dirty)
    if (dirtyPolicies.length === 0) return

    setApplying('all')
    try {
      const { Transaction } = await import('@mysten/sui/transactions')
      const { EFGUARD_PKG } = await import('../env')
      const tx = new Transaction()

      // Step 1: Create binding if we don't have one
      let bindingRef: ReturnType<typeof tx.moveCall>[0] | null = null
      let currentBindingId = bindingId.trim()

      if (!currentBindingId) {
        const [newBinding] = tx.moveCall({ target: `${EFGUARD_PKG}::assembly_binding::new_binding` })
        bindingRef = newBinding

        // Register all assemblies from all dirty groups
        const allAssemblyIds = new Set<string>()
        for (const policy of dirtyPolicies) {
          const group = groups.find((g) => g.id === policy.buildingGroupId)
          if (!group) continue
          for (const entry of group.entries) {
            allAssemblyIds.add(entry.assemblyId)
          }
        }

        for (const assemblyId of allAssemblyIds) {
          // Find the type from any group that contains this assembly
          let assemblyType = 'ssu'
          for (const g of groups) {
            const e = g.entries.find((e) => e.assemblyId === assemblyId)
            if (e) { assemblyType = e.assemblyType; break }
          }
          const fn = assemblyType === 'gate' ? 'register_gate' : assemblyType === 'turret' ? 'register_turret' : 'register_ssu'
          tx.moveCall({
            target: `${EFGUARD_PKG}::assembly_binding::${fn}`,
            arguments: [newBinding, tx.pure.id(assemblyId)],
          })
        }
      }

      // Step 2: Create condition objects for rules that don't have them
      const conditionMap = new Map<string, ReturnType<typeof tx.moveCall>[0]>()
      const rulesNeedingConditions: Array<{ ruleId: string; target: RuleTarget }> = []

      for (const policy of dirtyPolicies) {
        for (const entry of sortedEntries(policy.entries).filter((e) => e.enabled)) {
          const rule = getRule(entry.ruleId)
          if (!rule) continue
          if (!rule.conditionObjectId && !conditionMap.has(rule.id)) {
            rulesNeedingConditions.push({ ruleId: rule.id, target: rule.target })
          }
        }
      }

      for (const { ruleId, target } of rulesNeedingConditions) {
        let condObj: ReturnType<typeof tx.moveCall>[0]
        if (target.type === 'tribe') {
          ;[condObj] = tx.moveCall({
            target: `${EFGUARD_PKG}::condition_tribe::new`,
            arguments: [tx.pure.u32(target.tribe_id)],
          })
          tx.moveCall({ target: `${EFGUARD_PKG}::condition_tribe::share`, arguments: [condObj] })
        } else if (target.type === 'character') {
          ;[condObj] = tx.moveCall({
            target: `${EFGUARD_PKG}::condition_character::new`,
            arguments: [tx.pure.u64(target.char_game_id)],
          })
          tx.moveCall({ target: `${EFGUARD_PKG}::condition_character::share`, arguments: [condObj] })
        } else {
          ;[condObj] = tx.moveCall({
            target: `${EFGUARD_PKG}::condition_everyone::new`,
          })
          tx.moveCall({ target: `${EFGUARD_PKG}::condition_everyone::share`, arguments: [condObj] })
        }
        conditionMap.set(ruleId, condObj)
      }

      // Step 3: Build set_policy calls for each assembly in each dirty group
      for (const policy of dirtyPolicies) {
        const group = groups.find((g) => g.id === policy.buildingGroupId)
        if (!group) continue

        const enabledEntries = sortedEntries(policy.entries).filter((e) => e.enabled)

        for (const groupEntry of group.entries) {
          const ruleElements = enabledEntries.map((entry) => {
            const rule = getRule(entry.ruleId)
            // Use existing condition ID or the one we just created
            let condId: ReturnType<typeof tx.moveCall>[0] | string
            if (rule?.conditionObjectId) {
              condId = rule.conditionObjectId
            } else if (conditionMap.has(entry.ruleId)) {
              // Can't use PTB result as pure.id — need to use the object directly
              // This is a limitation: we'll get the IDs from tx effects after
              condId = conditionMap.get(entry.ruleId)!
            } else {
              return null
            }

            const [effect] = tx.moveCall({
              target: `${EFGUARD_PKG}::assembly_binding::${entry.effect === 'Allow' ? 'allow' : 'deny'}`,
            })

            // If condId is a string (existing on-chain ID), use pure.id
            // If it's a tx result (just created), use it directly
            const condArg = typeof condId === 'string' ? tx.pure.id(condId) : condId
            const [ruleObj] = tx.moveCall({
              target: `${EFGUARD_PKG}::assembly_binding::rule`,
              arguments: [condArg, effect],
            })
            return ruleObj
          }).filter(Boolean)

          if (ruleElements.length === 0) continue

          const ruleVec = tx.makeMoveVec({
            type: `${EFGUARD_PKG}::assembly_binding::Rule`,
            elements: ruleElements as any[],
          })

          const bindArg = currentBindingId ? tx.object(currentBindingId) : bindingRef!
          tx.moveCall({
            target: `${EFGUARD_PKG}::assembly_binding::set_policy`,
            arguments: [bindArg, tx.pure.id(groupEntry.assemblyId), ruleVec],
          })
        }
      }

      // Step 4: Share binding if we created it (must be last — moves the object)
      if (bindingRef && !currentBindingId) {
        tx.moveCall({
          target: `${EFGUARD_PKG}::assembly_binding::share_binding`,
          arguments: [bindingRef],
        })
      }

      // Execute
      const result = await dAppKit.signAndExecuteTransaction({ transaction: tx })

      // Step 5: Extract created object IDs from effects
      const txResult = result as any
      if (txResult.Transaction) {
        const changes = txResult.Transaction.objectChanges ?? txResult.objectChanges ?? []

        // Find binding ID if we created one
        if (!currentBindingId) {
          const bindingChange = changes.find((c: any) =>
            c.type === 'created' && c.objectType?.includes('AssemblyBinding'),
          )
          if (bindingChange) {
            currentBindingId = bindingChange.objectId
            setBindingId(currentBindingId)
          }
        }

        // Find condition object IDs and update rules
        for (const { ruleId, target } of rulesNeedingConditions) {
          const typeSuffix = target.type === 'tribe' ? 'TribeCondition'
            : target.type === 'character' ? 'CharacterCondition'
            : 'EveryoneCondition'
          const condChange = changes.find((c: any) =>
            c.type === 'created' && c.objectType?.includes(typeSuffix),
          )
          if (condChange) {
            updateRule(ruleId, { conditionObjectId: condChange.objectId })
          }
        }
      }

      // Mark all dirty policies as clean
      for (const policy of dirtyPolicies) {
        markClean(policy.buildingGroupId)
      }
    } catch (err) {
      console.error('Apply failed:', err)
      alert(`Failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setApplying(null)
    }
  }

  // ── Drag handlers ─────────────────────────────────────────────────────
  function handleDragStart(groupId: string, entryId: string) {
    dragItem.current = { groupId, entryId }
  }

  function handleDragEnter(entryId: string) {
    dragOver.current = entryId
  }

  function handleDragEnd(groupId: string) {
    if (!dragItem.current || !dragOver.current) return
    if (dragItem.current.groupId !== groupId) return

    const policy = policies.find((p) => p.buildingGroupId === groupId)
    if (!policy) return

    const sorted = sortedEntries(policy.entries)
    const ids = sorted.map((e) => e.id)
    const fromIdx = ids.indexOf(dragItem.current.entryId)
    const toIdx = ids.indexOf(dragOver.current)
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return

    const reordered = [...ids]
    const [moved] = reordered.splice(fromIdx, 1)
    reordered.splice(toIdx, 0, moved)
    reorderEntries(groupId, reordered)

    dragItem.current = null
    dragOver.current = null
  }

  // ── Render ────────────────────────────────────────────────────────────
  if (!isConnected) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-xl font-bold mb-4" style={{ color: theme.textPrimary }}>ef_guard</h1>
        <p style={{ color: theme.textSecondary }}>Connect your wallet to manage access policies.</p>
      </div>
    )
  }

  // Groups that don't have a policy yet
  const managedGroupIds = new Set(policies.map((p) => p.buildingGroupId))
  const unmanagedGroups = groups.filter((g) => !managedGroupIds.has(g.id))

  // Parse visitor IDs for access preview
  const parsedVisitorTribe = visitorTribeId ? parseInt(visitorTribeId, 10) : null
  const parsedVisitorChar = visitorCharId || null

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <h1 className="text-xl font-bold" style={{ color: theme.textPrimary }}>Access Policies</h1>

      {/* Advanced: Binding ID / Owner — collapsible */}
      <div style={S.panel}>
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full flex items-center justify-between px-4 py-2 text-xs transition-colors"
          style={{ color: theme.textSecondary }}
        >
          <span className="font-semibold uppercase tracking-wider">Advanced</span>
          <span className="text-[10px]">{showAdvanced ? '\u25B2' : '\u25BC'}</span>
        </button>

        {showAdvanced && (
          <div className="px-4 pb-4 pt-3 space-y-3" style={{ borderTop: `1px solid ${theme.border}` }}>
            <p className="text-[10px]" style={{ color: theme.textSecondary }}>These IDs link to your on-chain access control configuration.</p>
            <div className="flex items-center gap-2 text-xs">
              <label style={{ color: theme.textSecondary }}>Binding ID:</label>
              <input
                className="font-mono w-64"
                style={S.input}
                placeholder="0x..."
                value={bindingId}
                onChange={(e) => setBindingId(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2 text-xs">
              <label style={{ color: theme.textSecondary }}>Binding owner:</label>
              <input
                className="font-mono w-64"
                style={S.input}
                placeholder="0x... (leave blank if you are the owner)"
                value={bindingOwner}
                onChange={(e) => setBindingOwner(e.target.value)}
              />
              {bindingOwner && !isOwner && (
                <span className="text-[10px]" style={{ color: '#facc15' }}>Read-only (visitor)</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Visitor access check (shown when not owner) */}
      {!isOwner && (
        <div className="p-4 space-y-3" style={S.panel}>
          <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: theme.textSecondary }}>Check your access</h2>
          <div className="flex items-center gap-3 text-xs">
            <label style={{ color: theme.textSecondary }}>Your tribe ID:</label>
            <input
              className="font-mono w-32"
              style={S.input}
              placeholder="e.g. 42"
              value={visitorTribeId}
              onChange={(e) => setVisitorTribeId(e.target.value)}
            />
            <label style={{ color: theme.textSecondary }}>Your char game ID:</label>
            <input
              className="font-mono w-40"
              style={S.input}
              placeholder="e.g. 123456"
              value={visitorCharId}
              onChange={(e) => setVisitorCharId(e.target.value)}
            />
          </div>

          {(parsedVisitorTribe !== null || parsedVisitorChar) && policies.length > 0 && (
            <div className="space-y-2">
              {policies.map((policy) => {
                const group = groups.find((g) => g.id === policy.buildingGroupId)
                const groupName = group?.name ?? 'Unknown group'
                const result = evaluateAccess(
                  parsedVisitorTribe,
                  parsedVisitorChar,
                  policy.entries,
                  (id) => getRule(id),
                )

                return (
                  <div key={policy.buildingGroupId} className="flex items-center gap-3 text-xs">
                    <span style={{ color: theme.textPrimary }}>{groupName}:</span>
                    {result ? (
                      <>
                        <span
                          className="px-2 py-0.5 font-semibold text-[10px] uppercase"
                          style={{
                            background: result.effect === 'Allow' ? 'rgba(68,184,64,0.2)' : 'rgba(200,48,48,0.2)',
                            color: result.effect === 'Allow' ? theme.green : theme.red,
                          }}
                        >
                          {result.effect === 'Allow' ? 'Allowed' : 'Denied'}
                        </span>
                        <span style={{ color: theme.textSecondary }}>matched: {result.matchedRuleLabel}</span>
                      </>
                    ) : (
                      <span style={{ color: theme.textSecondary }}>No matching rule (default deny)</span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Help panel (collapsed by default) */}
      <HelpPanel />

      {/* Policy sections per building group */}
      {policies.map((policy) => {
        const group = groups.find((g) => g.id === policy.buildingGroupId)
        const groupName = group?.name ?? 'Unknown group'
        const assemblyCount = group?.entries.length ?? 0
        const sorted = sortedEntries(policy.entries)
        void applying // used in buttons below

        return (
          <div key={policy.buildingGroupId} style={S.panel}>
            {/* Header */}
            <div style={S.header} className="flex items-center justify-between px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold" style={{ color: theme.textPrimary }}>{groupName}</h2>
                <p className="text-xs" style={{ color: theme.textSecondary }}>{assemblyCount} building{assemblyCount !== 1 ? 's' : ''}</p>
              </div>
              {isOwner && (
                <div className="flex items-center gap-2">
                  {policy.dirty && (
                    <span className="text-xs" style={{ color: '#facc15' }}>unsaved</span>
                  )}
                  <button
                    onClick={() => handleApplyAll()}
                    disabled={!policy.dirty || applying === 'all'}
                    className="disabled:opacity-30"
                    style={S.btnSmall}
                  >
                    {applying === 'all' ? 'Applying...' : 'Apply'}
                  </button>
                  <button
                    onClick={() => removeGroupPolicy(policy.buildingGroupId)}
                    className="text-xs"
                    style={{ color: theme.textSecondary, background: 'none', border: 'none', cursor: 'pointer' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = theme.red }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = theme.textSecondary }}
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>

            {/* Rule entries */}
            <div className="p-4 space-y-1">
              {sorted.length === 0 && (
                <p className="text-xs" style={{ color: theme.textSecondary }}>No rules. {isOwner ? 'Add one below.' : ''}</p>
              )}

              {sorted.map((entry, i) => (
                <div
                  key={entry.id}
                  draggable={isOwner}
                  onDragStart={() => handleDragStart(policy.buildingGroupId, entry.id)}
                  onDragEnter={() => handleDragEnter(entry.id)}
                  onDragEnd={() => handleDragEnd(policy.buildingGroupId)}
                  onDragOver={(e) => e.preventDefault()}
                  className="flex items-center gap-3 text-xs"
                  style={{
                    ...S.row,
                    opacity: entry.enabled ? 1 : 0.5,
                    background: entry.enabled ? 'rgba(30,35,44,0.5)' : 'transparent',
                  }}
                >
                  {/* Drag handle (owner only) */}
                  {isOwner && <span className="cursor-grab select-none" style={{ color: theme.textSecondary }}>&#x2807;</span>}

                  {/* Priority number */}
                  <span className="w-4 text-center" style={{ color: theme.textSecondary }}>{i + 1}</span>

                  {/* Rule label */}
                  <span className={`flex-1 flex items-center gap-2 ${entry.enabled ? '' : 'line-through opacity-50'}`}>
                    <span style={{ color: entry.enabled ? theme.textPrimary : theme.textSecondary }}>
                      <RuleLabel ruleId={entry.ruleId} />
                    </span>
                    {/* Condition warning */}
                    {(() => {
                      const rule = getRule(entry.ruleId)
                      if (!rule?.conditionObjectId) {
                        return <span className="text-[10px]" style={{ color: theme.orange }} title="Not yet linked on-chain — Apply will prompt you to create it">&#x26A0;</span>
                      }
                      return null
                    })()}
                  </span>

                  {/* Effect toggle (owner) / Effect display (visitor) */}
                  {isOwner ? (
                    <button
                      onClick={() => setEffect(
                        policy.buildingGroupId,
                        entry.id,
                        entry.effect === 'Allow' ? 'Deny' : 'Allow',
                      )}
                      className="px-2 py-0.5 font-semibold text-[10px] uppercase"
                      style={{
                        background: entry.effect === 'Allow' ? 'rgba(68,184,64,0.2)' : 'rgba(200,48,48,0.2)',
                        color: entry.effect === 'Allow' ? theme.green : theme.red,
                        border: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      {entry.effect}
                    </button>
                  ) : (
                    <span
                      className="px-2 py-0.5 font-semibold text-[10px] uppercase"
                      style={{
                        background: entry.effect === 'Allow' ? 'rgba(68,184,64,0.2)' : 'rgba(200,48,48,0.2)',
                        color: entry.effect === 'Allow' ? theme.green : theme.red,
                      }}
                    >
                      {entry.effect}
                    </span>
                  )}

                  {/* Enable/disable toggle (owner only) */}
                  {isOwner && (
                    <button
                      onClick={() => toggleEntry(policy.buildingGroupId, entry.id)}
                      title={entry.enabled ? 'Disable' : 'Enable'}
                      style={{ color: theme.textSecondary, background: 'none', border: 'none', cursor: 'pointer' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = theme.textPrimary }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = theme.textSecondary }}
                    >
                      {entry.enabled ? '\u25CF' : '\u25CB'}
                    </button>
                  )}

                  {/* Remove (owner only) */}
                  {isOwner && (
                    <button
                      onClick={() => removeEntry(policy.buildingGroupId, entry.id)}
                      style={{ color: theme.textSecondary, background: 'none', border: 'none', cursor: 'pointer' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = theme.red }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = theme.textSecondary }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}

              {/* Add rule (owner only) */}
              {isOwner && (
                <div className="flex items-center gap-2 pt-2">
                  <select
                    className="flex-1"
                    style={S.select}
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value === '__new__') {
                        setShowRuleModal(policy.buildingGroupId)
                      } else if (e.target.value) {
                        addEntry(policy.buildingGroupId, e.target.value, 'Allow')
                      }
                      e.target.value = ''
                    }}
                  >
                    <option value="" disabled>+ Add rule...</option>
                    {rules
                      .filter((r) => !sorted.some((e) => e.ruleId === r.id))
                      .map((r) => (
                        <option key={r.id} value={r.id}>{r.label}</option>
                      ))
                    }
                    <option value="__new__">Create new rule...</option>
                  </select>
                </div>
              )}
            </div>
          </div>
        )
      })}

      {/* Add building group (owner only) */}
      {isOwner && (
        <div className="flex items-center gap-2">
          <select
            className="flex-1"
            style={S.select}
            defaultValue=""
            onChange={(e) => {
              if (e.target.value === '__new__') {
                setShowGroupModal(true)
              } else if (e.target.value) {
                addGroupPolicy(e.target.value)
              }
              e.target.value = ''
            }}
          >
            <option value="" disabled>+ Add building group...</option>
            {unmanagedGroups.map((g) => (
              <option key={g.id} value={g.id}>{g.name} ({g.entries.length} buildings)</option>
            ))}
            <option value="__new__">Create new building group...</option>
          </select>
        </div>
      )}

      {/* Unassigned buildings */}
      {owned && owned.assemblies.length > 0 && (
        <div className="p-4" style={S.panel}>
          <h2 style={S.header} className="mb-2">
            All Buildings ({owned.assemblies.length})
          </h2>
          <div className="space-y-1">
            {owned.assemblies.map((a) => (
              <div key={a.id} className="flex items-center justify-between text-xs py-1" title={a.id}>
                <span style={{ color: theme.textPrimary }}>{displayName(a)}</span>
                <span
                  className="text-[10px] uppercase font-semibold"
                  style={{
                    color: a.details?.status === 'ONLINE' ? theme.green :
                      a.details?.status === 'OFFLINE' ? theme.red : theme.textSecondary,
                  }}
                >
                  {a.details?.status ?? '?'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Saved Rules management */}
      {isOwner && rules.length > 0 && (
        <details style={S.panel}>
          <summary
            className="px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer"
            style={{ color: theme.textSecondary }}
          >
            Saved Rules ({rules.length})
          </summary>
          <div className="px-4 pb-3 space-y-1">
            {rules.map((r) => (
              <div key={r.id} className="flex items-center justify-between text-xs py-1">
                <span style={{ color: theme.textPrimary }}>{r.label}</span>
                <button
                  onClick={() => deleteRule(r.id)}
                  className="text-[10px]"
                  style={{ color: theme.textSecondary, background: 'none', border: 'none', cursor: 'pointer' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = theme.red }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = theme.textSecondary }}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Modals */}
      {showRuleModal && (
        <CreateRuleModal
          onClose={() => setShowRuleModal(null)}
          onCreate={(label, target) => {
            const rule = createRule(label, target)
            addEntry(showRuleModal, rule.id, 'Allow')
            setShowRuleModal(null)
          }}
        />
      )}

      {showGroupModal && (
        <CreateBuildingGroupModal
          onClose={() => setShowGroupModal(false)}
          createGroup={createGroup}
          addEntry={addBuildingEntry}
          onCreate={(groupId) => {
            addGroupPolicy(groupId)
            setShowGroupModal(false)
          }}
        />
      )}
    </div>
  )
}
