import { useState, useCallback } from 'react'
import type { BuildingGroup, BuildingGroupEntry } from '../types'

const STORAGE_KEY = 'efguard:building-groups'

function load(): BuildingGroup[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as BuildingGroup[]) : []
  } catch {
    return []
  }
}

function save(groups: BuildingGroup[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(groups))
}

export function useBuildingGroups() {
  const [groups, setGroups] = useState<BuildingGroup[]>(load)

  const createGroup = useCallback((name: string) => {
    const group: BuildingGroup = {
      id: crypto.randomUUID(),
      name,
      entries: [],
    }
    setGroups((prev) => {
      const next = [...prev, group]
      save(next)
      return next
    })
    return group.id
  }, [])

  const deleteGroup = useCallback((id: string) => {
    setGroups((prev) => {
      const next = prev.filter((g) => g.id !== id)
      save(next)
      return next
    })
  }, [])

  const addEntry = useCallback((groupId: string, entry: BuildingGroupEntry) => {
    setGroups((prev) => {
      const next = prev.map((g) => {
        if (g.id !== groupId) return g
        // Skip duplicates
        if (g.entries.some((e) => e.assemblyId === entry.assemblyId)) return g
        return { ...g, entries: [...g.entries, entry] }
      })
      save(next)
      return next
    })
  }, [])

  const removeEntry = useCallback((groupId: string, assemblyId: string) => {
    setGroups((prev) => {
      const next = prev.map((g) => {
        if (g.id !== groupId) return g
        return { ...g, entries: g.entries.filter((e) => e.assemblyId !== assemblyId) }
      })
      save(next)
      return next
    })
  }, [])

  return { groups, createGroup, deleteGroup, addEntry, removeEntry }
}
