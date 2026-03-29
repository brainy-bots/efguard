import { useState, useCallback } from 'react'

const STORAGE_KEY = 'efguard:indexer-url'

export function useIndexerConfig() {
  const [url, setUrlState] = useState<string | null>(() => {
    return localStorage.getItem(STORAGE_KEY)
  })

  const setUrl = useCallback((value: string) => {
    const trimmed = value.trim()
    if (trimmed) {
      localStorage.setItem(STORAGE_KEY, trimmed)
      setUrlState(trimmed)
    } else {
      localStorage.removeItem(STORAGE_KEY)
      setUrlState(null)
    }
  }, [])

  return { url, setUrl }
}
