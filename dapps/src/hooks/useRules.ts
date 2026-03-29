/**
 * Access rules stored in localStorage.
 * A rule defines "who" — a tribe, a character, or everyone.
 * Display label is derived from the target (tribe name from datahub, or character game ID).
 */
import { useState, useCallback } from 'react'
import type { RuleTarget } from '../types'

export interface SavedRule {
  id: string
  target: RuleTarget
  /** Cached display label — tribe name, character ID, or "Everyone" */
  label: string
}

const STORAGE_KEY = 'efguard-rules'

function load(): SavedRule[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

function save(rules: SavedRule[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rules))
}

export function ruleLabel(rule: SavedRule): string {
  return rule.label
}

export function useRules() {
  const [rules, setRules] = useState<SavedRule[]>(load)

  const createRule = useCallback((label: string, target: RuleTarget): SavedRule => {
    const rule: SavedRule = { id: crypto.randomUUID(), target, label }
    setRules((prev) => {
      const next = [...prev, rule]
      save(next)
      return next
    })
    return rule
  }, [])

  const deleteRule = useCallback((id: string) => {
    setRules((prev) => {
      const next = prev.filter((r) => r.id !== id)
      save(next)
      return next
    })
  }, [])

  return { rules, createRule, deleteRule }
}
