import { useState, useEffect } from 'react'
import { useIndexerConfig } from '../hooks/useIndexerConfig'
import { DEFAULT_BINDING_ID } from '../env'
import type { AuditEntry, AssemblyType } from '../types'

type ResultFilter = 'all' | 'allowed' | 'denied'
type AssemblyFilter = 'all' | AssemblyType

function formatDate(iso: string) {
  return new Date(iso).toLocaleString()
}

export function AuditLog() {
  const { url: indexerUrl } = useIndexerConfig()
  const [bindingId] = useState(DEFAULT_BINDING_ID || '')

  const [assemblyFilter, setAssemblyFilter] = useState<AssemblyFilter>('all')
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all')
  const [page, setPage] = useState(0)
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pageSize = 50

  useEffect(() => {
    if (!indexerUrl || !bindingId) return

    const params = new URLSearchParams()
    if (assemblyFilter !== 'all') params.set('assembly_type', assemblyFilter)
    if (resultFilter !== 'all') params.set('result', resultFilter)
    params.set('offset', String(page * pageSize))
    params.set('limit', String(pageSize))

    setLoading(true)
    setError(null)

    fetch(`${indexerUrl}/base/${bindingId}/log?${params}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data) => setEntries(data as AuditEntry[]))
      .catch((err: unknown) => setError(String(err)))
      .finally(() => setLoading(false))
  }, [indexerUrl, bindingId, assemblyFilter, resultFilter, page])

  function handleExport() {
    const headers = 'timestamp,char_game_id,tribe_id,assembly_id,assembly_type,action,result,reason\n'
    const rows = entries
      .map((e) =>
        [
          e.timestamp,
          e.char_game_id,
          e.tribe_id,
          e.assembly_id,
          e.assembly_type,
          e.action,
          e.result,
          e.reason,
        ].join(','),
      )
      .join('\n')
    const blob = new Blob([headers + rows], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `efguard-audit-${Date.now()}.csv`
    a.click()
  }

  if (!indexerUrl) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <h1 className="text-xl font-bold text-white mb-4">Audit Log</h1>
        <div className="bg-surface-1 border border-surface-3 rounded-lg p-6 text-center">
          <p className="text-default mb-2">No indexer connected.</p>
          <p className="text-xs text-default">
            Connect an indexer URL on the Overview page to view audit events.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Audit Log</h1>
        <button
          onClick={handleExport}
          disabled={entries.length === 0}
          className="px-3 py-1.5 text-sm bg-surface-2 border border-surface-3 text-white rounded hover:border-accent disabled:opacity-50"
        >
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div>
          <label className="text-xs text-default mr-2">Assembly</label>
          <select
            value={assemblyFilter}
            onChange={(e) => { setAssemblyFilter(e.target.value as AssemblyFilter); setPage(0) }}
            className="bg-surface-2 border border-surface-3 rounded px-2 py-1 text-xs text-white"
          >
            <option value="all">All</option>
            <option value="gate">Gate</option>
            <option value="turret">Turret</option>
            <option value="ssu">SSU</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-default mr-2">Result</label>
          <select
            value={resultFilter}
            onChange={(e) => { setResultFilter(e.target.value as ResultFilter); setPage(0) }}
            className="bg-surface-2 border border-surface-3 rounded px-2 py-1 text-xs text-white"
          >
            <option value="all">All</option>
            <option value="allowed">Allowed</option>
            <option value="denied">Denied</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-surface-1 border border-surface-3 rounded-lg overflow-hidden">
        {loading && (
          <p className="p-4 text-sm text-default animate-pulse">Loading…</p>
        )}
        {error && (
          <p className="p-4 text-sm text-red-400">Error: {error}</p>
        )}
        {!loading && !error && entries.length === 0 && (
          <p className="p-4 text-sm text-default">No events found.</p>
        )}
        {!loading && entries.length > 0 && (
          <table className="w-full text-xs">
            <thead className="bg-surface-2 text-default">
              <tr>
                <th className="text-left px-3 py-2">Time</th>
                <th className="text-left px-3 py-2">Character</th>
                <th className="text-left px-3 py-2">Assembly</th>
                <th className="text-left px-3 py-2">Action</th>
                <th className="text-left px-3 py-2">Result</th>
                <th className="text-left px-3 py-2">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-2">
              {entries.map((e) => (
                <tr key={e.id} className="hover:bg-surface-2">
                  <td className="px-3 py-2 text-default">{formatDate(e.timestamp)}</td>
                  <td className="px-3 py-2 font-mono text-white">{e.char_game_id}</td>
                  <td className="px-3 py-2 text-default capitalize">
                    {e.assembly_type} {e.assembly_id.slice(0, 8)}…
                  </td>
                  <td className="px-3 py-2 text-white">{e.action}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`font-medium ${
                        e.result === 'allowed' ? 'text-green-400' : 'text-red-400'
                      }`}
                    >
                      {e.result}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-default">{e.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {entries.length > 0 && (
        <div className="flex items-center gap-3 text-sm">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-3 py-1 bg-surface-2 border border-surface-3 text-white rounded disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-default">Page {page + 1}</span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={entries.length < pageSize}
            className="px-3 py-1 bg-surface-2 border border-surface-3 text-white rounded disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}
