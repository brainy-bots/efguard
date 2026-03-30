import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useConnection, executeGraphQLQuery } from '@evefrontier/dapp-kit'
import { useDAppKit } from '@mysten/dapp-kit-react'
import { Transaction } from '@mysten/sui/transactions'
import { useOwnedAssemblies, displayName, type OwnedAssembly } from '../hooks/useOwnedAssemblies'
import { STATUS_COLORS, type AssemblyType } from '../types'
import { EFGUARD_PKG, WORLD_PKG } from '../env'

const TYPE_LABELS: Record<string, string> = {
  gate: 'Gate', turret: 'Turret', ssu: 'Smart Storage', assembly: 'Assembly', unknown: 'Unknown',
}

const DAPP_URL = 'https://brainy-bots.github.io/efguard/#/ingame'

function supportsExtension(a: OwnedAssembly): boolean {
  return ['gate', 'turret', 'ssu'].includes(a.type)
}

function hasEfGuardExtension(a: OwnedAssembly): boolean {
  // Check if the extension type contains our package ID
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

    // We need the OwnerCap details (version + digest) for receivingRef
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

      // Borrow OwnerCap from Character
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

      // Authorize ef_guard extension
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

      // Set DApp URL on the assembly metadata
      const updateUrlTarget = assemblyType === 'gate'
        ? `${WORLD_PKG}::gate::update_metadata_url`
        : assemblyType === 'turret'
          ? `${WORLD_PKG}::turret::update_metadata_url`
          : `${WORLD_PKG}::storage_unit::update_metadata_url`

      tx.moveCall({
        target: updateUrlTarget,
        arguments: [tx.object(assembly.id), cap, tx.pure.string(DAPP_URL)],
      })

      // Return OwnerCap
      tx.moveCall({
        target: `${WORLD_PKG}::character::return_owner_cap`,
        typeArguments: [worldTypeMap[assemblyType]],
        arguments: [tx.object(charId), cap, receipt],
      })

      await dAppKit.signAndExecuteTransaction({ transaction: tx })

      setResult({ id: assembly.id, ok: true, msg: 'ef_guard installed!' })
      // Re-fetch assembly data to reflect the new extension status
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
        <h1 className="text-xl font-bold text-white mb-4">Buildings</h1>
        <p className="text-default text-sm">Connect your wallet to see your buildings.</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold text-white mb-4">Buildings</h1>

      {isLoading && <p className="text-default text-sm animate-pulse">Loading buildings...</p>}

      {owned && owned.assemblies.length === 0 && !isLoading && (
        <p className="text-default text-sm">No buildings found for your character.</p>
      )}

      {owned && owned.assemblies.length > 0 && (
        <>
          <p className="text-xs text-default mb-3">
            {owned.assemblies.length} building{owned.assemblies.length !== 1 ? 's' : ''} owned by character {owned.characterId?.slice(0, 10)}…
          </p>
          <div className="space-y-2">
            {owned.assemblies.map((a) => {
              const d = a.details
              const statusColor = STATUS_COLORS[d?.status ?? ''] ?? 'text-default'
              const isInstalling = installing === a.id
              const thisResult = result?.id === a.id ? result : null

              return (
                <div key={a.id} className="bg-surface-1 border border-surface-3 rounded-lg p-4" title={a.id}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-white font-medium text-sm">{displayName(a)}</span>
                        <span className="text-default text-[10px]">{d?.typeName || TYPE_LABELS[a.type]}</span>
                        <span className={`${statusColor} uppercase text-[10px] font-semibold`}>
                          {d?.status ?? '?'}
                        </span>
                      </div>
                      {d?.description && (
                        <p className="text-default text-[10px] mt-0.5">{d.description}</p>
                      )}
                      {d?.dappUrl && (
                        <p className="text-[10px] text-surface-3 mt-0.5">DApp: {d.dappUrl}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {hasEfGuardExtension(a) && (
                        <span className="text-green-400 text-[10px] font-semibold">ef_guard active</span>
                      )}
                      {hasOtherExtension(a) && (
                        <span className="text-yellow-400 text-[10px] font-semibold">Other extension</span>
                      )}
                      {supportsExtension(a) && (
                        <button
                          onClick={() => handleInstall(a)}
                          disabled={isInstalling}
                          className="px-3 py-1.5 bg-accent hover:bg-accent-dim text-white text-xs rounded disabled:opacity-50"
                        >
                          {isInstalling ? 'Installing...' : hasEfGuardExtension(a) ? 'Reinstall' : hasOtherExtension(a) ? 'Replace with ef_guard' : 'Install ef_guard'}
                        </button>
                      )}
                      {a.type === 'assembly' && (
                        <span className="text-default text-[10px]">No extension support yet</span>
                      )}
                    </div>
                  </div>

                  {thisResult && (
                    <div className={`mt-2 text-xs ${thisResult.ok ? 'text-green-400' : 'text-red-400'}`}>
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
