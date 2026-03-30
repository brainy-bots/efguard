import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useConnection, executeGraphQLQuery } from '@evefrontier/dapp-kit'
import { useDAppKit } from '@mysten/dapp-kit-react'
import { Transaction } from '@mysten/sui/transactions'
import { useOwnedAssemblies, displayName, type OwnedAssembly } from '../hooks/useOwnedAssemblies'
import type { AssemblyType } from '../types'
import { EFGUARD_PKG, WORLD_PKG } from '../env'
import { theme, S } from '../lib/theme'

const TYPE_LABELS: Record<string, string> = {
  gate: 'Gate', turret: 'Turret', ssu: 'Smart Storage', assembly: 'Assembly', unknown: 'Unknown',
}

const DAPP_URL = 'https://brainy-bots.github.io/efguard/#/ingame'

function supportsExtension(a: OwnedAssembly): boolean {
  return ['gate', 'turret', 'ssu'].includes(a.type)
}

function hasEfGuardExtension(a: OwnedAssembly): boolean {
  const ext = a.details?.extension
  if (!ext) return false
  return typeof ext === 'string' && ext.includes(EFGUARD_PKG)
}

function hasOtherExtension(a: OwnedAssembly): boolean {
  return !!a.details?.extension && !hasEfGuardExtension(a)
}

export function Buildings() {
  const { walletAddress, isConnected } = useConnection()
  const dAppKit = useDAppKit()
  const qc = useQueryClient()
  const { data: owned, isLoading } = useOwnedAssemblies(walletAddress)
  const [installing, setInstalling] = useState<string | null>(null)
  const [result, setResult] = useState<{ id: string; ok: boolean; msg: string } | null>(null)

  async function handleInstall(assembly: OwnedAssembly) {
    if (!owned?.characterId) return

    if (assembly.details?.extension) {
      const confirmed = window.confirm(
        'This building already has an extension installed. Installing ef_guard will replace it. Any existing extension logic will stop working.\n\nContinue?'
      )
      if (!confirmed) return
    }

    const charId = owned.characterId
    const assemblyType = assembly.type === 'assembly' ? 'ssu' : assembly.type as AssemblyType

    const capDetail = await executeGraphQLQuery<{
      object: { version: number; digest: string }
    }>(
      `query ($addr: SuiAddress!) { object(address: $addr) { version digest } }`,
      { addr: assembly.ownerCapId },
    )

    const version = String(capDetail.data?.object?.version ?? '')
    const digest = capDetail.data?.object?.digest ?? ''

    if (!version || !digest) {
      setResult({ id: assembly.id, ok: false, msg: 'Could not fetch OwnerCap details' })
      return
    }

    setInstalling(assembly.id)
    setResult(null)

    try {
      const tx = new Transaction()

      const worldTypeMap: Record<string, string> = {
        gate: `${WORLD_PKG}::gate::Gate`,
        turret: `${WORLD_PKG}::turret::Turret`,
        ssu: `${WORLD_PKG}::storage_unit::StorageUnit`,
      }

      const [cap, receipt] = tx.moveCall({
        target: `${WORLD_PKG}::character::borrow_owner_cap`,
        typeArguments: [worldTypeMap[assemblyType]],
        arguments: [
          tx.object(charId),
          tx.receivingRef({
            objectId: assembly.ownerCapId,
            version,
            digest,
          }),
        ],
      })

      if (assemblyType === 'gate') {
        const [config] = tx.moveCall({
          target: `${EFGUARD_PKG}::gate_extension::authorize_on_gate`,
          arguments: [tx.object(assembly.id), cap, tx.pure.u64(3600000)],
        })
        tx.moveCall({
          target: `${EFGUARD_PKG}::gate_extension::share_config`,
          arguments: [config],
        })
      } else if (assemblyType === 'turret') {
        const [config] = tx.moveCall({
          target: `${EFGUARD_PKG}::turret_extension::authorize_on_turret`,
          arguments: [tx.object(assembly.id), cap, tx.pure.u64(10000), tx.pure.u64(0)],
        })
        tx.moveCall({
          target: `${EFGUARD_PKG}::turret_extension::share_config`,
          arguments: [config],
        })
      } else {
        const [config] = tx.moveCall({
          target: `${EFGUARD_PKG}::ssu_extension::authorize_on_ssu`,
          arguments: [tx.object(assembly.id), cap, tx.pure.bool(true), tx.pure.bool(true)],
        })
        tx.moveCall({
          target: `${EFGUARD_PKG}::ssu_extension::share_config`,
          arguments: [config],
        })
      }

      const updateUrlTarget = assemblyType === 'gate'
        ? `${WORLD_PKG}::gate::update_metadata_url`
        : assemblyType === 'turret'
          ? `${WORLD_PKG}::turret::update_metadata_url`
          : `${WORLD_PKG}::storage_unit::update_metadata_url`

      tx.moveCall({
        target: updateUrlTarget,
        arguments: [tx.object(assembly.id), cap, tx.pure.string(DAPP_URL)],
      })

      tx.moveCall({
        target: `${WORLD_PKG}::character::return_owner_cap`,
        typeArguments: [worldTypeMap[assemblyType]],
        arguments: [tx.object(charId), cap, receipt],
      })

      await dAppKit.signAndExecuteTransaction({ transaction: tx })

      setResult({ id: assembly.id, ok: true, msg: 'ef_guard installed!' })
      await qc.invalidateQueries({ queryKey: ['owned-assemblies'] })
    } catch (err) {
      setResult({ id: assembly.id, ok: false, msg: err instanceof Error ? err.message : String(err) })
    } finally {
      setInstalling(null)
    }
  }

  if (!isConnected) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-xl font-bold mb-4" style={{ color: theme.textPrimary }}>Buildings</h1>
        <p className="text-sm" style={{ color: theme.textSecondary }}>Connect your wallet to see your buildings.</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold mb-4" style={{ color: theme.textPrimary }}>Buildings</h1>

      {isLoading && <p className="text-sm animate-pulse" style={{ color: theme.textSecondary }}>Loading buildings...</p>}

      {owned && owned.assemblies.length === 0 && !isLoading && (
        <p className="text-sm" style={{ color: theme.textSecondary }}>No buildings found for your character.</p>
      )}

      {owned && owned.assemblies.length > 0 && (
        <>
          <p className="text-xs mb-3" style={{ color: theme.textSecondary }}>
            {owned.assemblies.length} building{owned.assemblies.length !== 1 ? 's' : ''} owned by character {owned.characterId?.slice(0, 10)}…
          </p>
          <div className="space-y-2">
            {owned.assemblies.map((a) => {
              const d = a.details
              const statusColor = d?.status === 'ONLINE' ? theme.green : d?.status === 'OFFLINE' ? theme.red : theme.textSecondary
              const isInstalling = installing === a.id
              const thisResult = result?.id === a.id ? result : null

              return (
                <div key={a.id} className="p-4" style={S.panel} title={a.id}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm" style={{ color: theme.textPrimary }}>{displayName(a)}</span>
                        <span className="text-[10px]" style={{ color: theme.textSecondary }}>{d?.typeName || TYPE_LABELS[a.type]}</span>
                        <span className="uppercase text-[10px] font-semibold" style={{ color: statusColor }}>
                          {d?.status ?? '?'}
                        </span>
                      </div>
                      {d?.description && (
                        <p className="text-[10px] mt-0.5" style={{ color: theme.textSecondary }}>{d.description}</p>
                      )}
                      {d?.dappUrl && (
                        <p className="text-[10px] mt-0.5" style={{ color: theme.textMuted }}>DApp: {d.dappUrl}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {hasEfGuardExtension(a) && (
                        <span className="text-[10px] font-semibold" style={{ color: theme.green }}>ef_guard active</span>
                      )}
                      {hasOtherExtension(a) && (
                        <span className="text-[10px] font-semibold" style={{ color: '#eab308' }}>Other extension</span>
                      )}
                      {supportsExtension(a) && (
                        <button
                          onClick={() => handleInstall(a)}
                          disabled={isInstalling}
                          className="disabled:opacity-50"
                          style={S.btn}
                        >
                          {isInstalling ? 'Installing...' : hasEfGuardExtension(a) ? 'Reinstall' : hasOtherExtension(a) ? 'Replace with ef_guard' : 'Install ef_guard'}
                        </button>
                      )}
                      {a.type === 'assembly' && (
                        <span className="text-[10px]" style={{ color: theme.textSecondary }}>No extension support yet</span>
                      )}
                    </div>
                  </div>

                  {thisResult && (
                    <div className="mt-2 text-xs" style={{ color: thisResult.ok ? theme.green : theme.red }}>
                      {thisResult.msg}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
