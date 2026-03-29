/**
 * Policy state stored in localStorage.
 *
 * A "policy config" maps building group IDs to their rule entries.
 * Each entry references a SavedRule by ID, has an effect (Allow/Deny),
 * an enabled flag, and a sort order.
 *
 * On "Apply", only enabled entries are sent on-chain via set_policy.
 */
import { useState, useCallback } from 'react'
import type { RuleEffect } from '../types'

export interface PolicyEntry {
  id: string
  ruleId: string          // references SavedRule.id
  effect: RuleEffect      // 'Allow' | 'Deny'
  enabled: boolean        // disabled = excluded from on-chain tx
  order: number           // for drag-to-reorder
}

export interface GroupPolicy {
  buildingGroupId: string // references BuildingGroup.id or a single assembly ID
  entries: PolicyEntry[]
  dirty: boolean          // has unsaved changes vs on-chain state
}

const STORAGE_KEY = 'efguard-policies'

function load(): GroupPolicy[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

function save(policies: GroupPolicy[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(policies))
}

export function usePolicies() {
  const [policies, setPolicies] = useState<GroupPolicy[]>(load)

  const addGroupPolicy = useCallback((buildingGroupId: string) => {
    setPolicies((prev) => {
      if (prev.some((p) => p.buildingGroupId === buildingGroupId)) return prev
      const next = [...prev, { buildingGroupId, entries: [], dirty: true }]
      save(next)
      return next
    })
  }, [])

  const removeGroupPolicy = useCallback((buildingGroupId: string) => {
    setPolicies((prev) => {
      const next = prev.filter((p) => p.buildingGroupId !== buildingGroupId)
      save(next)
      return next
    })
  }, [])

  const addEntry = useCallback((buildingGroupId: string, ruleId: string, effect: RuleEffect) => {
    setPolicies((prev) => {
      const next = prev.map((p) => {
        if (p.buildingGroupId !== buildingGroupId) return p
        const maxOrder = p.entries.reduce((max, e) => Math.max(max, e.order), -1)
        const entry: PolicyEntry = {
          id: crypto.randomUUID(),
          ruleId,
          effect,
          enabled: true,
          order: maxOrder + 1,
        }
        return { ...p, entries: [...p.entries, entry], dirty: true }
      })
      save(next)
      return next
    })
  }, [])

  const removeEntry = useCallback((buildingGroupId: string, entryId: string) => {
    setPolicies((prev) => {
      const next = prev.map((p) => {
        if (p.buildingGroupId !== buildingGroupId) return p
        return { ...p, entries: p.entries.filter((e) => e.id !== entryId), dirty: true }
      })
      save(next)
      return next
    })
  }, [])

  const toggleEntry = useCallback((buildingGroupId: string, entryId: string) => {
    setPolicies((prev) => {
      const next = prev.map((p) => {
        if (p.buildingGroupId !== buildingGroupId) return p
        return {
          ...p,
          entries: p.entries.map((e) =>
            e.id === entryId ? { ...e, enabled: !e.enabled } : e,
          ),
          dirty: true,
        }
      })
      save(next)
      return next
    })
  }, [])

  const setEffect = useCallback((buildingGroupId: string, entryId: string, effect: RuleEffect) => {
    setPolicies((prev) => {
      const next = prev.map((p) => {
        if (p.buildingGroupId !== buildingGroupId) return p
        return {
          ...p,
          entries: p.entries.map((e) =>
            e.id === entryId ? { ...e, effect } : e,
          ),
          dirty: true,
        }
      })
      save(next)
      return next
    })
  }, [])

  const reorderEntries = useCallback((buildingGroupId: string, entryIds: string[]) => {
    setPolicies((prev) => {
      const next = prev.map((p) => {
        if (p.buildingGroupId !== buildingGroupId) return p
        const reordered = entryIds.map((id, i) => {
          const entry = p.entries.find((e) => e.id === id)!
          return { ...entry, order: i }
        })
        return { ...p, entries: reordered, dirty: true }
      })
      save(next)
      return next
    })
  }, [])

  const markClean = useCallback((buildingGroupId: string) => {
    setPolicies((prev) => {
      const next = prev.map((p) =>
        p.buildingGroupId === buildingGroupId ? { ...p, dirty: false } : p,
      )
      save(next)
      return next
    })
  }, [])

  return {
    policies,
    addGroupPolicy,
    removeGroupPolicy,
    addEntry,
    removeEntry,
    toggleEntry,
    setEffect,
    reorderEntries,
    markClean,
  }
}
