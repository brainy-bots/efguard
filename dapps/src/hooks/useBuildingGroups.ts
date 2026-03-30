import { useState, useCallback, useEffect } from 'react'
import type { BuildingGroup, BuildingGroupEntry } from '../types'
import { storageKey } from '../lib/storage'

function getKey(wallet?: string) { return storageKey('building-groups', wallet) }

function load(wallet?: string): BuildingGroup[] {
  try {
    const raw = localStorage.getItem(getKey(wallet))
    return raw ? (JSON.parse(raw) as BuildingGroup[]) : []
  } catch {
    return []
  }
}

function save(groups: BuildingGroup[], wallet?: string) {
  localStorage.setItem(getKey(wallet), JSON.stringify(groups))
}

export function useBuildingGroups(walletAddress?: string | null) {
  const wallet = walletAddress ?? undefined
  const [groups, setGroups] = useState<BuildingGroup[]>(() => load(wallet))

  // Reload when wallet changes
  useEffect(() => {
    setGroups(load(wallet))
  }, [wallet])

  const createGroup = useCallback((name: string) => {
    const group: BuildingGroup = { id: crypto.randomUUID(), name, entries: [] }
    setGroups((prev) => {
      const next = [...prev, group]
      save(next, wallet)
      return next
    })
    return group.id
  }, [wallet])

  const deleteGroup = useCallback((id: string) => {
    setGroups((prev) => {
      const next = prev.filter((g) => g.id !== id)
      save(next, wallet)
      return next
    })
  }, [wallet])

  const addEntry = useCallback((groupId: string, entry: BuildingGroupEntry) => {
    setGroups((prev) => {
      const next = prev.map((g) => {
        if (g.id !== groupId) return g
        if (g.entries.some((e) => e.assemblyId === entry.assemblyId)) return g
        return { ...g, entries: [...g.entries, entry] }
      })
      save(next, wallet)
      return next
    })
  }, [wallet])

  const removeEntry = useCallback((groupId: string, assemblyId: string) => {
    setGroups((prev) => {
      const next = prev.map((g) => {
        if (g.id !== groupId) return g
        return { ...g, entries: g.entries.filter((e) => e.assemblyId !== assemblyId) }
      })
      save(next, wallet)
      return next
    })
  }, [wallet])

  return { groups, createGroup, deleteGroup, addEntry, removeEntry }
}
