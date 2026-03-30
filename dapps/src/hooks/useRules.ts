import { useState, useCallback, useEffect } from 'react'
import type { RuleTarget } from '../types'
import { storageKey } from '../lib/storage'

export interface SavedRule {
  id: string
  target: RuleTarget
  label: string
  conditionObjectId?: string
}

function getKey(wallet?: string) { return storageKey('rules', wallet) }

function load(wallet?: string): SavedRule[] {
  try {
    return JSON.parse(localStorage.getItem(getKey(wallet)) || '[]')
  } catch {
    return []
  }
}

function save(rules: SavedRule[], wallet?: string) {
  localStorage.setItem(getKey(wallet), JSON.stringify(rules))
}

export function ruleLabel(rule: SavedRule): string {
  return rule.label
}

export function useRules(walletAddress?: string | null) {
  const wallet = walletAddress ?? undefined
  const [rules, setRules] = useState<SavedRule[]>(() => load(wallet))

  useEffect(() => {
    setRules(load(wallet))
  }, [wallet])

  const createRule = useCallback((label: string, target: RuleTarget): SavedRule => {
    const rule: SavedRule = { id: crypto.randomUUID(), target, label }
    setRules((prev) => {
      const next = [...prev, rule]
      save(next, wallet)
      return next
    })
    return rule
  }, [wallet])

  const deleteRule = useCallback((id: string) => {
    setRules((prev) => {
      const next = prev.filter((r) => r.id !== id)
      save(next, wallet)
      return next
    })
  }, [wallet])

  return { rules, createRule, deleteRule }
}
