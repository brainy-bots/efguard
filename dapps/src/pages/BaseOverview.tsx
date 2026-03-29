import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAssemblyBinding } from '../hooks/useAssemblyBinding'
import { useIndexerConfig } from '../hooks/useIndexerConfig'
import { DEFAULT_BINDING_ID } from '../env'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-1 border border-surface-3 rounded-lg p-4">
      <h2 className="text-sm font-semibold text-default uppercase tracking-wider mb-3">{title}</h2>
      {children}
    </div>
  )
}

export function BaseOverview() {
  const [bindingInput, setBindingInput] = useState(DEFAULT_BINDING_ID)
  const [bindingId, setBindingId] = useState(DEFAULT_BINDING_ID || null)
  const { url: indexerUrl, setUrl: setIndexerUrl } = useIndexerConfig()
  const [indexerInput, setIndexerInput] = useState(indexerUrl ?? '')

  const { data: binding, isLoading: bindingLoading, error: bindingError } = useAssemblyBinding(bindingId)

  // Count total rules across all assembly policies
  const totalRules = binding
    ? Object.values(binding.policies).reduce((sum, p) => sum + p.rules.length, 0)
    : 0
  const assembliesWithPolicies = binding
    ? Object.keys(binding.policies).filter((id) => binding.policies[id].rules.length > 0).length
    : 0

  return (
    <div className="p-6 space-y-4 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold text-white">Base Overview</h1>

      {/* Binding selector */}
      <Section title="Binding">
        <div className="flex gap-2">
          <input
            className="flex-1 bg-surface-2 border border-surface-3 rounded px-3 py-1.5 text-sm text-white font-mono placeholder:text-default focus:outline-none focus:border-accent"
            placeholder="AssemblyBinding object ID (0x...)"
            value={bindingInput}
            onChange={(e) => setBindingInput(e.target.value)}
          />
          <button
            onClick={() => setBindingId(bindingInput.trim() || null)}
            className="px-4 py-1.5 bg-accent hover:bg-accent-dim text-white text-sm rounded"
          >
            Load
          </button>
        </div>

        {bindingError && (
          <p className="mt-2 text-sm text-red-400">{String(bindingError)}</p>
        )}

        {binding && (
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-default">Owner:</span>{' '}
              <span className="font-mono text-white text-xs">
                {binding.owner.slice(0, 8)}...{binding.owner.slice(-6)}
              </span>
            </div>
            <div>
              <span className="text-default">Gates:</span>{' '}
              <span className="text-white">{binding.gates.length}</span>
            </div>
            <div>
              <span className="text-default">Turrets:</span>{' '}
              <span className="text-white">{binding.turrets.length}</span>
            </div>
            <div>
              <span className="text-default">SSUs:</span>{' '}
              <span className="text-white">{binding.storage_units.length}</span>
            </div>
          </div>
        )}

        {bindingLoading && (
          <p className="mt-2 text-sm text-default animate-pulse">Loading binding...</p>
        )}
      </Section>

      {/* Policy summary */}
      {binding && (
        <Section title="Policies">
          {totalRules === 0 ? (
            <p className="text-sm text-default">
              No rules configured.{' '}
              <Link to="/bindings" className="text-accent hover:underline">
                Add rules
              </Link>
            </p>
          ) : (
            <div className="text-sm text-default space-y-1">
              <p>
                <span className="text-white font-medium">{totalRules}</span> rule{totalRules !== 1 ? 's' : ''} across{' '}
                <span className="text-white font-medium">{assembliesWithPolicies}</span> assembl{assembliesWithPolicies !== 1 ? 'ies' : 'y'}
              </p>
            </div>
          )}
          <Link to="/bindings" className="mt-3 inline-block text-xs text-accent hover:underline">
            Manage policies &rarr;
          </Link>
        </Section>
      )}

      {/* Threat summary */}
      {binding && (
        <Section title="Threat Config">
          <div className="flex items-center gap-4 text-sm">
            <div>
              <span className="text-default">Block aggressors:</span>{' '}
              <span className={binding.threat_config.block_aggressors ? 'text-green-400' : 'text-default'}>
                {binding.threat_config.block_aggressors ? 'On' : 'Off'}
              </span>
            </div>
            <div>
              <span className="text-default">Blocklist entries:</span>{' '}
              <span className="text-white">{binding.threat_config.blocklist.length}</span>
            </div>
          </div>
          <Link to="/threat" className="mt-2 inline-block text-xs text-accent hover:underline">
            Manage threat config &rarr;
          </Link>
        </Section>
      )}

      {/* Indexer */}
      <Section title="Indexer">
        {!indexerUrl && (
          <p className="text-sm text-default mb-3">
            Connect an indexer to enable the audit log and live threat alerts.
          </p>
        )}
        <div className="flex gap-2">
          <input
            className="flex-1 bg-surface-2 border border-surface-3 rounded px-3 py-1.5 text-sm text-white placeholder:text-default focus:outline-none focus:border-accent"
            placeholder="Indexer URL (https://...)"
            value={indexerInput}
            onChange={(e) => setIndexerInput(e.target.value)}
          />
          <button
            onClick={() => setIndexerUrl(indexerInput)}
            className="px-4 py-1.5 bg-accent hover:bg-accent-dim text-white text-sm rounded"
          >
            {indexerUrl ? 'Update' : 'Connect'}
          </button>
          {indexerUrl && (
            <button
              onClick={() => { setIndexerUrl(''); setIndexerInput('') }}
              className="px-3 py-1.5 text-sm text-default hover:text-red-400"
            >
              Disconnect
            </button>
          )}
        </div>
        {indexerUrl && (
          <p className="mt-2 text-xs text-green-400">Connected: {indexerUrl}</p>
        )}
      </Section>
    </div>
  )
}
