/**
 * Policy state stored in localStorage, namespaced by tenant + wallet.
 */
import { useState, useCallback, useEffect } from 'react'
import type { RuleEffect } from '../types'
import { storageKey } from '../lib/storage'

export interface PolicyEntry {
  id: string
  ruleId: string
  effect: RuleEffect
  enabled: boolean
  order: number
}

export interface GroupPolicy {
  buildingGroupId: string
  entries: PolicyEntry[]
  dirty: boolean
}

function getKey(wallet?: string) { return storageKey('policies', wallet) }

function load(wallet?: string): GroupPolicy[] {
  try {
    return JSON.parse(localStorage.getItem(getKey(wallet)) || '[]')
  } catch {
    return []
  }
}

function save(policies: GroupPolicy[], wallet?: string) {
  localStorage.setItem(getKey(wallet), JSON.stringify(policies))
}

export function usePolicies(walletAddress?: string | null) {
  const wallet = walletAddress ?? undefined
  const [policies, setPolicies] = useState<GroupPolicy[]>(() => load(wallet))

  useEffect(() => {
    setPolicies(load(wallet))
  }, [wallet])

  const addGroupPolicy = useCallback((buildingGroupId: string) => {
    setPolicies((prev) => {
      if (prev.some((p) => p.buildingGroupId === buildingGroupId)) return prev
      const next = [...prev, { buildingGroupId, entries: [], dirty: true }]
      save(next, wallet)
      return next
    })
  }, [wallet])

  const removeGroupPolicy = useCallback((buildingGroupId: string) => {
    setPolicies((prev) => {
      const next = prev.filter((p) => p.buildingGroupId !== buildingGroupId)
      save(next, wallet)
      return next
    })
  }, [wallet])

  const addEntry = useCallback((buildingGroupId: string, ruleId: string, effect: RuleEffect) => {
    setPolicies((prev) => {
      const next = prev.map((p) => {
        if (p.buildingGroupId !== buildingGroupId) return p
        const maxOrder = p.entries.reduce((max, e) => Math.max(max, e.order), -1)
        const entry: PolicyEntry = {
          id: crypto.randomUUID(), ruleId, effect, enabled: true, order: maxOrder + 1,
        }
        return { ...p, entries: [...p.entries, entry], dirty: true }
      })
      save(next, wallet)
      return next
    })
  }, [wallet])

  const removeEntry = useCallback((buildingGroupId: string, entryId: string) => {
    setPolicies((prev) => {
      const next = prev.map((p) => {
        if (p.buildingGroupId !== buildingGroupId) return p
        return { ...p, entries: p.entries.filter((e) => e.id !== entryId), dirty: true }
      })
      save(next, wallet)
      return next
    })
  }, [wallet])

  const toggleEntry = useCallback((buildingGroupId: string, entryId: string) => {
    setPolicies((prev) => {
      const next = prev.map((p) => {
        if (p.buildingGroupId !== buildingGroupId) return p
        return {
          ...p,
          entries: p.entries.map((e) => e.id === entryId ? { ...e, enabled: !e.enabled } : e),
          dirty: true,
        }
      })
      save(next, wallet)
      return next
    })
  }, [wallet])

  const setEffect = useCallback((buildingGroupId: string, entryId: string, effect: RuleEffect) => {
    setPolicies((prev) => {
      const next = prev.map((p) => {
        if (p.buildingGroupId !== buildingGroupId) return p
        return {
          ...p,
          entries: p.entries.map((e) => e.id === entryId ? { ...e, effect } : e),
          dirty: true,
        }
      })
      save(next, wallet)
      return next
    })
  }, [wallet])

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
      save(next, wallet)
      return next
    })
  }, [wallet])

  const markClean = useCallback((buildingGroupId: string) => {
    setPolicies((prev) => {
      const next = prev.map((p) =>
        p.buildingGroupId === buildingGroupId ? { ...p, dirty: false } : p,
      )
      save(next, wallet)
      return next
    })
  }, [wallet])

  return {
    policies, addGroupPolicy, removeGroupPolicy, addEntry,
    removeEntry, toggleEntry, setEffect, reorderEntries, markClean,
  }
}
