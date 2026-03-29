import { useState, useEffect, useRef } from 'react'
import { useIndexerConfig } from '../hooks/useIndexerConfig'
import { DEFAULT_BINDING_ID } from '../env'
import type { ThreatAlert } from '../types'

type AlertFilter = 'all' | 'blocklist' | 'aggressor'

function formatDate(iso: string) {
  return new Date(iso).toLocaleString()
}

export function ThreatAlerts() {
  const { url: indexerUrl } = useIndexerConfig()
  const [bindingId] = useState(DEFAULT_BINDING_ID || '')
  const [filter, setFilter] = useState<AlertFilter>('all')
  const [alerts, setAlerts] = useState<ThreatAlert[]>([])
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!indexerUrl || !bindingId) return

    const url = `${indexerUrl}/base/${bindingId}/threats`
    const es = new EventSource(url)
    esRef.current = es

    es.onopen = () => { setConnected(true); setError(null) }

    es.onmessage = (event) => {
      try {
        const alert = JSON.parse(event.data as string) as ThreatAlert
        setAlerts((prev) => [alert, ...prev].slice(0, 200))
      } catch {
        // ignore malformed events
      }
    }

    es.onerror = () => {
      setConnected(false)
      setError('Connection lost. Retrying…')
    }

    return () => {
      es.close()
      esRef.current = null
      setConnected(false)
    }
  }, [indexerUrl, bindingId])

  const filtered =
    filter === 'all' ? alerts : alerts.filter((a) => a.reason === filter)

  if (!indexerUrl) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <h1 className="text-xl font-bold text-white mb-4">Threat Alerts</h1>
        <div className="bg-surface-1 border border-surface-3 rounded-lg p-6 text-center">
          <p className="text-default mb-2">No indexer connected.</p>
          <p className="text-xs text-default">
            Connect an indexer URL on the Overview page to receive live threat alerts.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-white">Threat Alerts</h1>
        <span
          className={`w-2 h-2 rounded-full ${
            connected ? 'bg-green-500 animate-pulse' : 'bg-gray-500'
          }`}
        />
        <span className="text-xs text-default">{connected ? 'Live' : 'Connecting…'}</span>
      </div>

      {error && <p className="text-xs text-yellow-400">{error}</p>}

      <div className="flex gap-2">
        {(['all', 'blocklist', 'aggressor'] as AlertFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 text-xs rounded capitalize ${
              filter === f
                ? 'bg-accent text-white'
                : 'bg-surface-2 text-default hover:text-white border border-surface-3'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="bg-surface-1 border border-surface-3 rounded-lg p-6 text-center">
            <p className="text-default text-sm">No alerts yet.</p>
          </div>
        )}
        {filtered.map((alert) => (
          <div
            key={alert.id}
            className={`bg-surface-1 border rounded-lg p-3 text-sm ${
              alert.reason === 'aggressor'
                ? 'border-red-800/60'
                : 'border-orange-800/60'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <span
                  className={`text-xs font-semibold uppercase tracking-wider mr-2 ${
                    alert.reason === 'aggressor' ? 'text-red-400' : 'text-orange-400'
                  }`}
                >
                  {alert.reason}
                </span>
                <span className="font-mono text-white">{alert.char_game_id}</span>
              </div>
              <span className="text-xs text-default flex-shrink-0">
                {formatDate(alert.timestamp)}
              </span>
            </div>
            <div className="mt-1 text-xs text-default">
              <span className="capitalize">{alert.assembly_type}</span>{' '}
              <span className="font-mono">{alert.assembly_id.slice(0, 16)}…</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
