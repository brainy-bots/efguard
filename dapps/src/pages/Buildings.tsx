import { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useConnection, executeGraphQLQuery } from '@evefrontier/dapp-kit'
import { storageKey } from '../lib/storage'
import { useDAppKit } from '@mysten/dapp-kit-react'
import { Transaction } from '@mysten/sui/transactions'
import { useOwnedAssemblies, displayName, type OwnedAssembly } from '../hooks/useOwnedAssemblies'
import type { AssemblyType } from '../types'
import { EFGUARD_PKG, WORLD_PKG, TENANT } from '../env'
import { useToast } from '../components/Toast'
import { theme, S } from '../lib/theme'

const TYPE_LABELS: Record<string, string> = {
  gate: 'Gate', turret: 'Turret', ssu: 'Smart Storage', assembly: 'Assembly', unknown: 'Unknown',
}

const DAPP_URL_BASE = 'https://brainy-bots.github.io/efguard/'
const DAPP_URL = `${DAPP_URL_BASE}#/ingame`

async function getDappUrlForAssembly(assemblyId: string): Promise<string> {
  try {
    const res = await executeGraphQLQuery<{
      object: { asMoveObject: { contents: { json: { key?: { item_id?: string; tenant?: string } } } } }
    }>(
      `query ($id: SuiAddress!) { object(address: $id) { asMoveObject { contents { json } } } }`,
      { id: assemblyId },
    )
    const key = res.data?.object?.asMoveObject?.contents?.json?.key
    if (key?.item_id) {
      const tenant = key.tenant || TENANT
      return `${DAPP_URL_BASE}?itemId=${key.item_id}&tenant=${tenant}#/ingame`
    }
  } catch { /* fall back */ }
  return DAPP_URL
}

function supportsExtension(a: OwnedAssembly): boolean {
  // Turrets excluded — game server controls targeting calls, can't pass custom objects
  return ['gate', 'ssu'].includes(a.type)
}

function getExtensionStr(a: OwnedAssembly): string {
  const ext = a.details?.extension
  if (!ext) return ''
  if (typeof ext === 'string') return ext
  if (typeof ext === 'object' && (ext as any).name) return (ext as any).name
  return JSON.stringify(ext)
}

function getExtensionDisplayName(a: OwnedAssembly): string {
  const raw = getExtensionStr(a)
  if (!raw) return ''
  // Format: "pkgId::module::Type" → "module::Type"
  const parts = raw.split('::')
  if (parts.length >= 3) return parts.slice(1).join('::')
  return raw
}

function hasEfGuardExtension(a: OwnedAssembly): boolean {
  const ext = getExtensionStr(a)
  // Compare without 0x prefix — on-chain value may omit it
  const pkgNorm = EFGUARD_PKG.replace(/^0x/, '')
  return ext.includes(pkgNorm)
}

function isOldEfGuard(a: OwnedAssembly): boolean {
  const ext = getExtensionStr(a)
  const pkgNorm = EFGUARD_PKG.replace(/^0x/, '')
  return !ext.includes(pkgNorm) && ext.includes('EfGuard')
}

function hasOtherExtension(a: OwnedAssembly): boolean {
  return !!a.details?.extension && !hasEfGuardExtension(a) && !isOldEfGuard(a)
}

export function Buildings() {
  const { walletAddress, isConnected } = useConnection()
  const dAppKit = useDAppKit()
  const qc = useQueryClient()
  const toast = useToast()
  const { data: owned, isLoading } = useOwnedAssemblies(walletAddress)
  const [installing, setInstalling] = useState<string | null>(null)
  const [result, setResult] = useState<{ id: string; ok: boolean; msg: string } | null>(null)
  const [existingBindingId, setExistingBindingId] = useState<string | null>(null)
  const [expectedUrls, setExpectedUrls] = useState<Record<string, string>>({})

  // Precompute expected DApp URLs for all assemblies
  const assemblyIds = owned?.assemblies.map((a) => a.id).join(',') ?? ''
  useEffect(() => {
    if (!owned?.assemblies.length) return
    Promise.all(
      owned.assemblies.map(async (a) => {
        const url = await getDappUrlForAssembly(a.id)
        return [a.id, url] as const
      }),
    ).then((pairs) => {
      setExpectedUrls(Object.fromEntries(pairs))
    }).catch(console.error)
  }, [assemblyIds]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-discover existing binding
  useEffect(() => {
    if (!walletAddress) return
    const bindingType = `${EFGUARD_PKG}::assembly_binding::AssemblyBinding`
    executeGraphQLQuery<{
      objects: { nodes: Array<{ address: string; asMoveObject: { contents: { json: { owner: string } } } }> }
    }>(
      `query ($type: String!) { objects(filter: { type: $type }, first: 10) { nodes { address asMoveObject { contents { json } } } } }`,
      { type: bindingType },
    ).then((res) => {
      const bindings = res.data?.objects?.nodes ?? []
      const mine = bindings.find((b) => b.asMoveObject?.contents?.json?.owner === walletAddress)
      if (mine) {
        setExistingBindingId(mine.address)
        localStorage.setItem(storageKey('binding-id', walletAddress), mine.address)
      }
    }).catch(console.error)
  }, [walletAddress])

  async function handleUpdateUrl(assembly: OwnedAssembly) {
    if (!owned?.characterId) return
    const charId = owned.characterId
    const assemblyType = assembly.type === 'assembly' ? 'ssu' : assembly.type as AssemblyType

    setInstalling(assembly.id)
    setResult(null)

    try {
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
          tx.receivingRef({ objectId: assembly.ownerCapId, version, digest }),
        ],
      })

      const updateUrlTarget = assemblyType === 'gate'
        ? `${WORLD_PKG}::gate::update_metadata_url`
        : assemblyType === 'turret'
          ? `${WORLD_PKG}::turret::update_metadata_url`
          : `${WORLD_PKG}::storage_unit::update_metadata_url`

      tx.moveCall({
        target: updateUrlTarget,
        arguments: [tx.object(assembly.id), cap, tx.pure.string(await getDappUrlForAssembly(assembly.id))],
      })

      tx.moveCall({
        target: `${WORLD_PKG}::character::return_owner_cap`,
        typeArguments: [worldTypeMap[assemblyType]],
        arguments: [tx.object(charId), cap, receipt],
      })

      await dAppKit.signAndExecuteTransaction({ transaction: tx })
      setResult({ id: assembly.id, ok: true, msg: 'DApp URL updated!' })
      toast.success('DApp URL updated!')
      await qc.invalidateQueries({ queryKey: ['owned-assemblies'] })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setResult({ id: assembly.id, ok: false, msg })
      toast.error(`URL update failed: ${msg}`)
    } finally {
      setInstalling(null)
    }
  }

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

      // Create binding if none exists, then register this assembly
      let bindingObj: ReturnType<typeof tx.moveCall>[0] | null = null
      if (!existingBindingId) {
        const [newBinding] = tx.moveCall({ target: `${EFGUARD_PKG}::assembly_binding::new_binding` })
        bindingObj = newBinding
        const regFn = assemblyType === 'gate' ? 'register_gate' : assemblyType === 'turret' ? 'register_turret' : 'register_ssu'
        tx.moveCall({
          target: `${EFGUARD_PKG}::assembly_binding::${regFn}`,
          arguments: [newBinding, tx.pure.id(assembly.id)],
        })
      } else {
        // Check if assembly is already registered before trying to register
        let alreadyRegistered = false
        try {
          const bindingRes = await executeGraphQLQuery<{
            object: { asMoveObject: { contents: { json: any } } }
          }>(
            `query ($id: SuiAddress!) { object(address: $id) { asMoveObject { contents { json } } } }`,
            { id: existingBindingId },
          )
          const bJson = bindingRes.data?.object?.asMoveObject?.contents?.json ?? {}
          const registered = [
            ...(bJson.gates?.contents ?? []),
            ...(bJson.turrets?.contents ?? []),
            ...(bJson.storage_units?.contents ?? []),
          ]
          alreadyRegistered = registered.includes(assembly.id)
        } catch { /* ignore, try to register anyway */ }

        if (!alreadyRegistered) {
          const regFn = assemblyType === 'gate' ? 'register_gate' : assemblyType === 'turret' ? 'register_turret' : 'register_ssu'
          tx.moveCall({
            target: `${EFGUARD_PKG}::assembly_binding::${regFn}`,
            arguments: [tx.object(existingBindingId), tx.pure.id(assembly.id)],
          })
        }
      }

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
        arguments: [tx.object(assembly.id), cap, tx.pure.string(await getDappUrlForAssembly(assembly.id))],
      })

      tx.moveCall({
        target: `${WORLD_PKG}::character::return_owner_cap`,
        typeArguments: [worldTypeMap[assemblyType]],
        arguments: [tx.object(charId), cap, receipt],
      })

      // Share binding after returning OwnerCap (must be last — moves the object)
      if (bindingObj) {
        tx.moveCall({
          target: `${EFGUARD_PKG}::assembly_binding::share_binding`,
          arguments: [bindingObj],
        })
      }

      const txResult = await dAppKit.signAndExecuteTransaction({ transaction: tx })

      // Extract binding ID from result if we created one
      if (!existingBindingId) {
        const r = txResult as any
        const digest = r?.Transaction?.digest ?? r?.digest ?? ''
        if (digest) {
          try {
            const detail = await dAppKit.getClient().core.getTransaction({
              digest,
              include: { effects: true, objectTypes: true },
            })
            const txData = (detail as any).Transaction
            const objectTypes = txData?.objectTypes ?? {}
            const changedObjects = txData?.effects?.changedObjects ?? []
            const bindingChange = changedObjects.find((c: any) =>
              c.idOperation === 'Created' && (objectTypes[c.objectId] ?? '').includes('AssemblyBinding'),
            )
            if (bindingChange) {
              setExistingBindingId(bindingChange.objectId)
              localStorage.setItem(storageKey('binding-id', walletAddress ?? ''), bindingChange.objectId)
              console.log('[ef_guard] Binding created:', bindingChange.objectId)
            }
          } catch (e) {
            console.error('[ef_guard] Failed to extract binding ID:', e)
          }
        }
      }

      setResult({ id: assembly.id, ok: true, msg: 'ef_guard installed!' })
      toast.success('ef_guard installed successfully!')
      await qc.invalidateQueries({ queryKey: ['owned-assemblies'] })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setResult({ id: assembly.id, ok: false, msg })
      toast.error(`Install failed: ${msg}`)
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
            {owned.assemblies.filter((a) => a.type !== 'turret').map((a) => {
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
                        <p className="text-[10px] mt-0.5" style={{ color: d.dappUrl === expectedUrls[a.id] ? theme.textMuted : theme.orange }}>
                          DApp: {d.dappUrl}
                          {expectedUrls[a.id] && d.dappUrl !== expectedUrls[a.id] && ' (outdated)'}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {hasEfGuardExtension(a) && (
                        <span className="text-[10px] font-semibold" style={{ color: theme.green }}>ef_guard active</span>
                      )}
                      {isOldEfGuard(a) && (
                        <span className="text-[10px] font-semibold" style={{ color: '#eab308' }}>ef_guard (old version)</span>
                      )}
                      {hasOtherExtension(a) && (
                        <span className="text-[10px] font-semibold" style={{ color: '#eab308' }} title={getExtensionDisplayName(a)}>
                          {getExtensionDisplayName(a) || 'Other extension'}
                        </span>
                      )}
                      {supportsExtension(a) && (
                        <button
                          onClick={() => handleInstall(a)}
                          disabled={isInstalling}
                          className="disabled:opacity-50"
                          style={S.btn}
                        >
                          {isInstalling ? 'Installing...' : hasEfGuardExtension(a) ? 'Reinstall' : isOldEfGuard(a) ? 'Upgrade ef_guard' : hasOtherExtension(a) ? 'Replace with ef_guard' : 'Install ef_guard'}
                        </button>
                      )}
                      {d?.dappUrl && expectedUrls[a.id] && d.dappUrl !== expectedUrls[a.id] && hasEfGuardExtension(a) && (
                        <button
                          onClick={() => handleUpdateUrl(a)}
                          disabled={isInstalling}
                          className="disabled:opacity-50"
                          style={S.btnSmall}
                        >
                          Update URL
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
