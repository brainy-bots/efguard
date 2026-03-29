import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useConnection } from '@evefrontier/dapp-kit'
import { useAssemblyBinding } from '../hooks/useAssemblyBinding'
import { useBindingRole } from '../hooks/useBindingRole'
import { useSubmitTransaction } from '../hooks/useSubmitTransaction'
import { RuleList } from '../components/RuleMatrix'
import {
  buildAddRuleTx,
  buildRemoveRuleTx,
  buildRegisterAssemblyTx,
  buildDeregisterAssemblyTx,
  buildInstallExtensionTx,
} from '../lib/tx-builders'
import { DEFAULT_BINDING_ID } from '../env'
import type { AssemblyType, PolicyRule, ExtensionConfig } from '../types'

function AssemblyList({
  label,
  ids,
  type,
  bindingId,
  canEdit,
}: {
  label: string
  ids: string[]
  type: AssemblyType
  bindingId: string
  canEdit: boolean
}) {
  const qc = useQueryClient()
  const { submit, isPending } = useSubmitTransaction()
  const [newId, setNewId] = useState('')

  async function handleRegister() {
    if (!newId.trim()) return
    await submit(buildRegisterAssemblyTx(bindingId, newId.trim(), type))
    await qc.invalidateQueries({ queryKey: ['assembly-binding'] })
    setNewId('')
  }

  async function handleDeregister(assemblyId: string) {
    await submit(buildDeregisterAssemblyTx(bindingId, assemblyId, type))
    await qc.invalidateQueries({ queryKey: ['assembly-binding'] })
  }

  return (
    <div className="mb-4">
      <h3 className="text-sm font-medium text-default mb-2 uppercase tracking-wider">
        {label} ({ids.length})
      </h3>
      {ids.length === 0 && (
        <p className="text-xs text-default mb-2">None registered.</p>
      )}
      <ul className="space-y-1 mb-2">
        {ids.map((id) => (
          <li key={id} className="flex items-center justify-between text-xs">
            <span className="font-mono text-white">{id.slice(0, 20)}...</span>
            {canEdit && (
              <button
                onClick={() => handleDeregister(id)}
                disabled={isPending}
                className="text-default hover:text-red-400 ml-3"
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="flex gap-2">
          <input
            className="flex-1 bg-surface-2 border border-surface-3 rounded px-2 py-1 text-xs text-white font-mono placeholder:text-default focus:outline-none focus:border-accent"
            placeholder="Object ID (0x...)"
            value={newId}
            onChange={(e) => setNewId(e.target.value)}
          />
          <button
            onClick={handleRegister}
            disabled={isPending || !newId.trim()}
            className="px-3 py-1 bg-accent hover:bg-accent-dim text-white text-xs rounded disabled:opacity-50"
          >
            Register
          </button>
        </div>
      )}
    </div>
  )
}

function InstallExtensionForm({
  assemblyId,
  assemblyType,
}: {
  assemblyId: string
  assemblyType: AssemblyType
}) {
  const { submit, isPending } = useSubmitTransaction()
  const [open, setOpen] = useState(false)
  const [characterId, setCharacterId] = useState('')
  const [ownerCapId, setOwnerCapId] = useState('')
  const [ownerCapVersion, setOwnerCapVersion] = useState('')
  const [ownerCapDigest, setOwnerCapDigest] = useState('')
  const [config, setConfig] = useState<ExtensionConfig>({
    permit_ttl_ms: 3_600_000,
    deny_weight: 100,
    allow_weight: 0,
    allow_deposit: true,
    allow_withdraw: false,
  })

  async function handleInstall() {
    await submit(
      buildInstallExtensionTx(
        assemblyType,
        assemblyId,
        characterId,
        ownerCapId,
        ownerCapVersion,
        ownerCapDigest,
        config,
      ),
    )
    setOpen(false)
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-accent hover:underline"
      >
        Install extension
      </button>
    )
  }

  return (
    <div className="mt-2 p-3 bg-surface-0 border border-surface-3 rounded space-y-2 text-xs">
      <p className="text-default">Install efguard extension on this assembly.</p>
      <input
        className="w-full bg-surface-2 border border-surface-3 rounded px-2 py-1 text-white font-mono placeholder:text-default"
        placeholder="Character object ID"
        value={characterId}
        onChange={(e) => setCharacterId(e.target.value)}
      />
      <input
        className="w-full bg-surface-2 border border-surface-3 rounded px-2 py-1 text-white font-mono placeholder:text-default"
        placeholder="OwnerCap object ID"
        value={ownerCapId}
        onChange={(e) => setOwnerCapId(e.target.value)}
      />
      <div className="flex gap-2">
        <input
          className="flex-1 bg-surface-2 border border-surface-3 rounded px-2 py-1 text-white placeholder:text-default"
          placeholder="OwnerCap version"
          value={ownerCapVersion}
          onChange={(e) => setOwnerCapVersion(e.target.value)}
        />
        <input
          className="flex-1 bg-surface-2 border border-surface-3 rounded px-2 py-1 text-white placeholder:text-default"
          placeholder="OwnerCap digest"
          value={ownerCapDigest}
          onChange={(e) => setOwnerCapDigest(e.target.value)}
        />
      </div>

      {assemblyType === 'gate' && (
        <input
          type="number"
          className="w-full bg-surface-2 border border-surface-3 rounded px-2 py-1 text-white placeholder:text-default"
          placeholder="Permit TTL (ms)"
          value={config.permit_ttl_ms}
          onChange={(e) =>
            setConfig((c) => ({ ...c, permit_ttl_ms: parseInt(e.target.value, 10) }))
          }
        />
      )}

      {assemblyType === 'turret' && (
        <div className="flex gap-2">
          <input
            type="number"
            className="flex-1 bg-surface-2 border border-surface-3 rounded px-2 py-1 text-white placeholder:text-default"
            placeholder="Deny weight"
            value={config.deny_weight}
            onChange={(e) =>
              setConfig((c) => ({ ...c, deny_weight: parseInt(e.target.value, 10) }))
            }
          />
          <input
            type="number"
            className="flex-1 bg-surface-2 border border-surface-3 rounded px-2 py-1 text-white placeholder:text-default"
            placeholder="Allow weight"
            value={config.allow_weight}
            onChange={(e) =>
              setConfig((c) => ({ ...c, allow_weight: parseInt(e.target.value, 10) }))
            }
          />
        </div>
      )}

      {assemblyType === 'ssu' && (
        <div className="flex gap-4">
          <label className="flex items-center gap-1 text-white">
            <input
              type="checkbox"
              checked={config.allow_deposit}
              onChange={(e) => setConfig((c) => ({ ...c, allow_deposit: e.target.checked }))}
            />
            Allow deposit
          </label>
          <label className="flex items-center gap-1 text-white">
            <input
              type="checkbox"
              checked={config.allow_withdraw}
              onChange={(e) => setConfig((c) => ({ ...c, allow_withdraw: e.target.checked }))}
            />
            Allow withdraw
          </label>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          onClick={handleInstall}
          disabled={isPending || !characterId || !ownerCapId}
          className="px-3 py-1 bg-accent hover:bg-accent-dim text-white rounded disabled:opacity-50"
        >
          {isPending ? 'Installing...' : 'Install'}
        </button>
        <button onClick={() => setOpen(false)} className="px-3 py-1 text-default hover:text-white">
          Cancel
        </button>
      </div>
    </div>
  )
}

function AssemblyPolicySection({
  assemblyId,
  assemblyType,
  bindingId,
  rules,
  canEdit,
}: {
  assemblyId: string
  assemblyType: AssemblyType
  bindingId: string
  rules: PolicyRule[]
  canEdit: boolean
}) {
  const qc = useQueryClient()
  const { submit, isPending } = useSubmitTransaction()
  const [expanded, setExpanded] = useState(false)

  async function handleAddRule(rule: PolicyRule) {
    await submit(buildAddRuleTx(bindingId, assemblyId, rule))
    await qc.invalidateQueries({ queryKey: ['assembly-binding'] })
  }

  async function handleRemoveRule(index: number) {
    await submit(buildRemoveRuleTx(bindingId, assemblyId, index))
    await qc.invalidateQueries({ queryKey: ['assembly-binding'] })
  }

  const typeLabel = assemblyType === 'ssu' ? 'SSU' : assemblyType.charAt(0).toUpperCase() + assemblyType.slice(1)

  return (
    <div className="border border-surface-3 rounded mb-3">
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-surface-2"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-2 text-sm">
          <span className="text-default text-xs uppercase">{typeLabel}</span>
          <span className="font-mono text-white text-xs">{assemblyId.slice(0, 16)}...</span>
          <span className="text-default text-xs">({rules.length} rule{rules.length !== 1 ? 's' : ''})</span>
        </div>
        <span className="text-default text-xs">{expanded ? '\u25B2' : '\u25BC'}</span>
      </div>

      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-surface-3 space-y-3">
          <RuleList
            rules={rules}
            readOnly={!canEdit}
            isPending={isPending}
            onAddRule={handleAddRule}
            onRemoveRule={handleRemoveRule}
          />
          {canEdit && (
            <InstallExtensionForm assemblyId={assemblyId} assemblyType={assemblyType} />
          )}
        </div>
      )}
    </div>
  )
}

export function AssemblyBindings() {
  const { walletAddress, isConnected } = useConnection()

  const [bindingId, setBindingId] = useState(DEFAULT_BINDING_ID || '')
  const [bindingInput, setBindingInput] = useState(DEFAULT_BINDING_ID || '')

  const { data: binding, isLoading: bindingLoading } = useAssemblyBinding(bindingId || null)

  const role = useBindingRole(binding, walletAddress)
  const canEdit = isConnected && role === 'owner'

  function rulesFor(assemblyId: string): PolicyRule[] {
    return binding?.policies[assemblyId]?.rules ?? []
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <h1 className="text-xl font-bold text-white">Assembly Bindings</h1>

      {/* Binding selector */}
      <div className="bg-surface-1 border border-surface-3 rounded-lg p-4">
        <div className="flex gap-2">
          <input
            className="flex-1 bg-surface-2 border border-surface-3 rounded px-3 py-1.5 text-sm text-white font-mono placeholder:text-default focus:outline-none focus:border-accent"
            placeholder="AssemblyBinding object ID"
            value={bindingInput}
            onChange={(e) => setBindingInput(e.target.value)}
          />
          <button
            onClick={() => setBindingId(bindingInput.trim())}
            className="px-4 py-1.5 bg-accent hover:bg-accent-dim text-white text-sm rounded"
          >
            Load
          </button>
        </div>
        {bindingLoading && <p className="mt-2 text-sm text-default animate-pulse">Loading...</p>}
        {binding && role !== 'loading' && (
          <p className="mt-2 text-xs text-default">
            Role: <span className="text-white capitalize">{role}</span>
          </p>
        )}
      </div>

      {binding && (
        <>
          {/* Assemblies + their policies */}
          <div className="bg-surface-1 border border-surface-3 rounded-lg p-4">
            <h2 className="text-sm font-semibold text-default uppercase tracking-wider mb-4">
              Registered Assemblies
            </h2>

            <AssemblyList
              label="Gates"
              ids={binding.gates}
              type="gate"
              bindingId={binding.id}
              canEdit={role === 'owner'}
            />
            {binding.gates.map((id) => (
              <AssemblyPolicySection
                key={id}
                assemblyId={id}
                assemblyType="gate"
                bindingId={binding.id}
                rules={rulesFor(id)}
                canEdit={canEdit}
              />
            ))}

            <AssemblyList
              label="Turrets"
              ids={binding.turrets}
              type="turret"
              bindingId={binding.id}
              canEdit={role === 'owner'}
            />
            {binding.turrets.map((id) => (
              <AssemblyPolicySection
                key={id}
                assemblyId={id}
                assemblyType="turret"
                bindingId={binding.id}
                rules={rulesFor(id)}
                canEdit={canEdit}
              />
            ))}

            <AssemblyList
              label="SSUs"
              ids={binding.storage_units}
              type="ssu"
              bindingId={binding.id}
              canEdit={role === 'owner'}
            />
            {binding.storage_units.map((id) => (
              <AssemblyPolicySection
                key={id}
                assemblyId={id}
                assemblyType="ssu"
                bindingId={binding.id}
                rules={rulesFor(id)}
                canEdit={canEdit}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
