import { useState, useRef, useEffect } from 'react'
import { useConnection, executeGraphQLQuery } from '@evefrontier/dapp-kit'
import { storageKey } from '../lib/storage'
import { EFGUARD_PKG } from '../env'
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
  const { groups, createGroup, addEntry: addBuildingEntry, updateGroup } = useBuildingGroups(walletAddress)
  const { rules, createRule, updateRule, deleteRule } = useRules(walletAddress)
  const {
    policies, addGroupPolicy, removeGroupPolicy,
    addEntry, removeEntry, toggleEntry, setEffect,
    reorderEntries, markClean,
  } = usePolicies(walletAddress)

  const [showRuleModal, setShowRuleModal] = useState<string | null>(null)
  const [showGroupModal, setShowGroupModal] = useState(false)
  const [editingGroup, setEditingGroup] = useState<string | null>(null)
  const [applying, setApplying] = useState<string | null>(null)
  const [bindingId, setBindingId] = useState('')
  const [bindingOwner, setBindingOwner] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Auto-discover existing binding: check localStorage first, then chain
  useEffect(() => {
    if (!walletAddress || bindingId) return

    // Check localStorage (set by Buildings page on install)
    const saved = localStorage.getItem(storageKey('binding-id', walletAddress))
    if (saved) {
      setBindingId(saved)
      setBindingOwner(walletAddress)
      return
    }

    // Fall back to chain query
    const bindingType = `${EFGUARD_PKG}::assembly_binding::AssemblyBinding`
    executeGraphQLQuery<{
      objects: { nodes: Array<{ address: string; asMoveObject: { contents: { json: { owner: string } } } }> }
    }>(
      `query ($type: String!) { objects(filter: { type: $type }, first: 10) { nodes { address asMoveObject { contents { json } } } } }`,
      { type: bindingType },
    ).then((res) => {
      const bindings = res.data?.objects?.nodes ?? []
      const mine = bindings.find((b) => b.asMoveObject?.contents?.json?.owner === walletAddress)
      if (mine) {
        setBindingId(mine.address)
        setBindingOwner(mine.asMoveObject.contents.json.owner)
        localStorage.setItem(storageKey('binding-id', walletAddress), mine.address)
      }
    }).catch(console.error)
  }, [walletAddress, bindingId])
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

  // ── Apply ALL pending changes to chain ──────────────────────────────
  // Two transactions if conditions need creating, one if they already exist.
  async function handleApplyAll() {
    const dirtyPolicies = policies.filter((p) => p.dirty)
    if (dirtyPolicies.length === 0) return

    setApplying('all')
    try {
      const { Transaction } = await import('@mysten/sui/transactions')
      const { EFGUARD_PKG } = await import('../env')
      let currentBindingId = bindingId.trim()

      // Re-read rules from localStorage to get latest conditionObjectIds
      // (React state may be stale if updateRule was called in a previous Apply)
      const freshRules: Record<string, typeof rules[0]> = {}
      try {
        const stored = JSON.parse(localStorage.getItem(storageKey('rules', walletAddress ?? undefined)) || '[]')
        for (const r of stored) freshRules[r.id] = r
      } catch { /* ignore */ }

      // Build map of all ruleId → conditionObjectId
      const conditionIdMap = new Map<string, string>()
      const rulesNeedingConditions: Array<{ ruleId: string; target: RuleTarget }> = []
      for (const policy of dirtyPolicies) {
        for (const entry of sortedEntries(policy.entries).filter((e) => e.enabled)) {
          const rule = freshRules[entry.ruleId] ?? getRule(entry.ruleId)
          if (!rule) continue
          if (rule.conditionObjectId) {
            conditionIdMap.set(rule.id, rule.conditionObjectId)
          } else if (!rulesNeedingConditions.some((r) => r.ruleId === rule.id)) {
            rulesNeedingConditions.push({ ruleId: rule.id, target: rule.target })
          }
        }
      }

      console.log('[ef_guard] Existing condition IDs:', Object.fromEntries(conditionIdMap))
      console.log('[ef_guard] Rules needing conditions:', rulesNeedingConditions.map(r => r.ruleId))

      // TX1: Create binding (if needed) + conditions (if needed)
      const needsSetup = !currentBindingId || rulesNeedingConditions.length > 0
      if (needsSetup) {
        const tx1 = new Transaction()

        // Create binding if needed
        if (!currentBindingId) {
          const [newBinding] = tx1.moveCall({ target: `${EFGUARD_PKG}::assembly_binding::new_binding` })

          // Register all assemblies
          const allAssemblyIds = new Set<string>()
          for (const policy of dirtyPolicies) {
            const group = groups.find((g) => g.id === policy.buildingGroupId)
            if (!group) continue
            for (const entry of group.entries) allAssemblyIds.add(entry.assemblyId)
          }
          for (const assemblyId of allAssemblyIds) {
            let assemblyType = 'ssu'
            for (const g of groups) {
              const e = g.entries.find((e) => e.assemblyId === assemblyId)
              if (e) { assemblyType = e.assemblyType; break }
            }
            const fn = assemblyType === 'gate' ? 'register_gate' : assemblyType === 'turret' ? 'register_turret' : 'register_ssu'
            tx1.moveCall({ target: `${EFGUARD_PKG}::assembly_binding::${fn}`, arguments: [newBinding, tx1.pure.id(assemblyId)] })
          }

          tx1.moveCall({ target: `${EFGUARD_PKG}::assembly_binding::share_binding`, arguments: [newBinding] })
        }

        // Create conditions
        for (const { target } of rulesNeedingConditions) {
          if (target.type === 'tribe') {
            const [c] = tx1.moveCall({ target: `${EFGUARD_PKG}::condition_tribe::new`, arguments: [tx1.pure.u32(target.tribe_id)] })
            tx1.moveCall({ target: `${EFGUARD_PKG}::condition_tribe::share`, arguments: [c] })
          } else if (target.type === 'character') {
            const [c] = tx1.moveCall({ target: `${EFGUARD_PKG}::condition_character::new`, arguments: [tx1.pure.u64(target.char_game_id)] })
            tx1.moveCall({ target: `${EFGUARD_PKG}::condition_character::share`, arguments: [c] })
          } else {
            const [c] = tx1.moveCall({ target: `${EFGUARD_PKG}::condition_everyone::new` })
            tx1.moveCall({ target: `${EFGUARD_PKG}::condition_everyone::share`, arguments: [c] })
          }
        }

        const result1 = await dAppKit.signAndExecuteTransaction({ transaction: tx1 })
        console.log('[ef_guard] TX1 result:', JSON.stringify(result1, null, 2))

        // Extract IDs from TX1 effects — try multiple result formats
        const r1 = result1 as any
        const digest = r1?.Transaction?.digest ?? r1?.digest ?? ''

        // Fetch full transaction details with object changes
        let changes: any[] = []
        if (digest) {
          try {
            const txDetail = await dAppKit.getClient().core.getTransaction({
              digest,
              include: { effects: true, objectTypes: true },
            })
            const txData = (txDetail as any).Transaction
            const objectTypes = txData?.objectTypes ?? {}
            const changedObjects = txData?.effects?.changedObjects ?? []
            changes = changedObjects
              .filter((c: any) => c.idOperation === 'Created')
              .map((c: any) => ({
                type: 'created',
                objectId: c.objectId,
                objectType: objectTypes[c.objectId] ?? '',
              }))
            console.log('[ef_guard] TX1 created objects:', changes)
          } catch (e) {
            console.error('[ef_guard] Failed to fetch TX1 details:', e)
          }
        }

        if (!currentBindingId) {
          const bc = changes.find((c: any) => c.type === 'created' && c.objectType?.includes('AssemblyBinding'))
          if (bc) { currentBindingId = bc.objectId; setBindingId(currentBindingId) }
        }

        // Match conditions to rules (in order of creation)
        const condTypeMap: Record<string, string> = { tribe: 'TribeCondition', character: 'CharacterCondition', everyone: 'EveryoneCondition' }
        const createdConds: Record<string, string[]> = { TribeCondition: [], CharacterCondition: [], EveryoneCondition: [] }
        for (const c of changes) {
          if (c.type !== 'created') continue
          for (const typeName of Object.keys(createdConds)) {
            if (c.objectType?.includes(typeName)) createdConds[typeName].push(c.objectId)
          }
        }

        // Add newly created condition IDs from TX1 to the map
        const condCounters: Record<string, number> = { TribeCondition: 0, CharacterCondition: 0, EveryoneCondition: 0 }
        for (const { ruleId, target } of rulesNeedingConditions) {
          const typeName = condTypeMap[target.type]
          const idx = condCounters[typeName]++
          const objId = createdConds[typeName]?.[idx]
          if (objId) {
            conditionIdMap.set(ruleId, objId)
            updateRule(ruleId, { conditionObjectId: objId }) // save to localStorage for future
          }
        }

        console.log('[ef_guard] Condition ID map:', Object.fromEntries(conditionIdMap))

        // Small delay for shared objects to be available
        await new Promise((r) => setTimeout(r, 2000))
      }

      console.log('[ef_guard] Final condition ID map:', Object.fromEntries(conditionIdMap))

      // TX2: Set policies using the local conditionIdMap
      if (!currentBindingId) {
        alert('Failed to create binding')
        return
      }

      // Fetch binding to check which assemblies are already registered
      let registeredAssemblies = new Set<string>()
      try {
        const bindingRes = await executeGraphQLQuery<{
          object: { asMoveObject: { contents: { json: any } } }
        }>(
          `query ($id: SuiAddress!) { object(address: $id) { asMoveObject { contents { json } } } }`,
          { id: currentBindingId },
        )
        const bJson = bindingRes.data?.object?.asMoveObject?.contents?.json ?? {}
        for (const arr of [bJson.gates?.contents, bJson.turrets?.contents, bJson.storage_units?.contents]) {
          if (Array.isArray(arr)) arr.forEach((id: string) => registeredAssemblies.add(id))
        }
      } catch (e) {
        console.warn('[ef_guard] Could not fetch binding registrations:', e)
      }

      const tx2 = new Transaction()

      // Register any unregistered assemblies before setting policies
      for (const policy of dirtyPolicies) {
        const group = groups.find((g) => g.id === policy.buildingGroupId)
        if (!group) continue
        for (const entry of group.entries) {
          if (!registeredAssemblies.has(entry.assemblyId)) {
            const fn = entry.assemblyType === 'gate' ? 'register_gate' : entry.assemblyType === 'turret' ? 'register_turret' : 'register_ssu'
            tx2.moveCall({
              target: `${EFGUARD_PKG}::assembly_binding::${fn}`,
              arguments: [tx2.object(currentBindingId), tx2.pure.id(entry.assemblyId)],
            })
            registeredAssemblies.add(entry.assemblyId) // avoid duplicates in same TX
            console.log('[ef_guard] Registering assembly:', entry.assemblyId, 'as', entry.assemblyType)
          }
        }
      }

      for (const policy of dirtyPolicies) {
        const group = groups.find((g) => g.id === policy.buildingGroupId)
        if (!group) continue

        const enabledEntries = sortedEntries(policy.entries).filter((e) => e.enabled)

        for (const groupEntry of group.entries) {
          const ruleElements = enabledEntries.map((entry) => {
            // Use local map first, fall back to rule's stored ID
            const condObjId = conditionIdMap.get(entry.ruleId) ?? getRule(entry.ruleId)?.conditionObjectId
            if (!condObjId) {
              console.warn('[ef_guard] No condition ID for rule:', entry.ruleId)
              return null
            }

            const [effect] = tx2.moveCall({
              target: `${EFGUARD_PKG}::assembly_binding::${entry.effect === 'Allow' ? 'allow' : 'deny'}`,
            })
            const [ruleObj] = tx2.moveCall({
              target: `${EFGUARD_PKG}::assembly_binding::rule`,
              arguments: [tx2.pure.id(condObjId), effect],
            })
            return ruleObj
          }).filter(Boolean)

          if (ruleElements.length === 0) continue

          const ruleVec = tx2.makeMoveVec({
            type: `${EFGUARD_PKG}::assembly_binding::Rule`,
            elements: ruleElements as any[],
          })
          tx2.moveCall({
            target: `${EFGUARD_PKG}::assembly_binding::set_policy`,
            arguments: [tx2.object(currentBindingId), tx2.pure.id(groupEntry.assemblyId), ruleVec],
          })
        }
      }

      await dAppKit.signAndExecuteTransaction({ transaction: tx2 })

      for (const policy of dirtyPolicies) markClean(policy.buildingGroupId)
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
                    onClick={() => setEditingGroup(policy.buildingGroupId)}
                    className="text-xs"
                    style={{ color: theme.textSecondary, background: 'none', border: 'none', cursor: 'pointer' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = theme.orange }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = theme.textSecondary }}
                  >
                    Edit
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

      {/* Blocklist — direct on-chain, no conditions needed */}
      {isOwner && bindingId && (
        <details style={S.panel}>
          <summary
            className="px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer"
            style={{ color: theme.orange }}
          >
            Blocklist
          </summary>
          <div className="px-4 pb-3">
            <p className="text-xs mb-2" style={{ color: theme.textMuted }}>
              Blocklisted players are always denied, regardless of rules. Overrides everything.
            </p>
            <div className="flex gap-2">
              <input
                id="blocklist-input"
                style={S.input}
                placeholder="Player game ID (e.g. 2112079904)"
                className="flex-1"
              />
              <button
                style={S.btn}
                onClick={async () => {
                  const input = document.getElementById('blocklist-input') as HTMLInputElement
                  const gameId = input?.value?.trim()
                  if (!gameId) return
                  try {
                    const { Transaction } = await import('@mysten/sui/transactions')
                    const { EFGUARD_PKG } = await import('../env')
                    const tx = new Transaction()
                    tx.moveCall({
                      target: `${EFGUARD_PKG}::assembly_binding::add_to_blocklist`,
                      arguments: [tx.object(bindingId), tx.pure.u64(gameId)],
                    })
                    await dAppKit.signAndExecuteTransaction({ transaction: tx })
                    alert('Player blocklisted!')
                    input.value = ''
                  } catch (err) {
                    alert(`Failed: ${err instanceof Error ? err.message : String(err)}`)
                  }
                }}
              >
                Blocklist
              </button>
              <button
                style={S.btnSmall}
                onClick={async () => {
                  const input = document.getElementById('blocklist-input') as HTMLInputElement
                  const gameId = input?.value?.trim()
                  if (!gameId) return
                  try {
                    const { Transaction } = await import('@mysten/sui/transactions')
                    const { EFGUARD_PKG } = await import('../env')
                    const tx = new Transaction()
                    tx.moveCall({
                      target: `${EFGUARD_PKG}::assembly_binding::remove_from_blocklist`,
                      arguments: [tx.object(bindingId), tx.pure.u64(gameId)],
                    })
                    await dAppKit.signAndExecuteTransaction({ transaction: tx })
                    alert('Player removed from blocklist!')
                    input.value = ''
                  } catch (err) {
                    alert(`Failed: ${err instanceof Error ? err.message : String(err)}`)
                  }
                }}
              >
                Remove
              </button>
            </div>
          </div>
        </details>
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
          updateGroup={updateGroup}
          onCreate={(groupId) => {
            addGroupPolicy(groupId)
            setShowGroupModal(false)
          }}
        />
      )}

      {editingGroup && (
        <CreateBuildingGroupModal
          onClose={() => setEditingGroup(null)}
          createGroup={createGroup}
          addEntry={addBuildingEntry}
          updateGroup={updateGroup}
          editGroup={groups.find((g) => g.id === editingGroup) ?? null}
          onCreate={() => setEditingGroup(null)}
          onUpdate={() => setEditingGroup(null)}
        />
      )}
    </div>
  )
}
