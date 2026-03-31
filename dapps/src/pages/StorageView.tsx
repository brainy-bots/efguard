/**
 * In-game storage interaction view — lets any player browse & withdraw from an SSU.
 * Route: #/storage?itemId=0x...
 *
 * This page is shown inside EVE Frontier's in-game browser when players interact
 * with a Smart Storage Unit that has ef_guard installed.
 */
import { useState, useEffect, useCallback } from 'react'
import { useConnection, executeGraphQLQuery } from '@evefrontier/dapp-kit'
import { useDAppKit } from '@mysten/dapp-kit-react'
import { Transaction } from '@mysten/sui/transactions'
import { AsciiBackground } from '../components/AsciiBackground'
import { EFGUARD_PKG, WORLD_PKG } from '../env'

// ── Theme (matches InGameView) ──────────────────────────────────────────────

const C = {
  bg: '#111318',
  panelBg: 'rgba(23, 27, 34, 0.85)',
  headerBg: 'rgba(26, 30, 38, 0.9)',
  border: '#252a33',
  orange: '#d4710a',
  textPrimary: '#d0d0d0',
  textSecondary: '#808890',
  textMuted: '#505860',
  green: '#44b840',
  red: '#c83030',
}

const panelStyle = { background: C.panelBg, border: `1px solid ${C.border}`, backdropFilter: 'blur(4px)' }
const headerStyle = { background: C.headerBg, borderBottom: `1px solid ${C.border}`, color: C.orange, fontSize: '10px', letterSpacing: '0.12em', fontWeight: 700, textTransform: 'uppercase' as const, padding: '6px 10px' }
const rowStyle = { borderBottom: `1px solid ${C.border}`, padding: '5px 10px', display: 'flex' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const }
const btnStyle = { background: C.orange, color: '#000', border: 'none', padding: '5px 14px', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.1em', cursor: 'pointer' }

// ── Types ───────────────────────────────────────────────────────────────────

interface InventoryItem {
  type_id: string
  item_id: string
  quantity: string
  volume: string
  tenant: string
}

interface SSUInfo {
  name: string | null
  description: string | null
  status: string | null
  owner: string | null
  items: InventoryItem[]
  capacity: string | null
  usedCapacity: string | null
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function fetchSSUInfo(ssuId: string): Promise<SSUInfo> {
  // Fetch SSU object with dynamic fields (inventory)
  const res = await executeGraphQLQuery<{
    object: {
      asMoveObject: {
        contents: { json: Record<string, any> }
        dynamicFields: {
          nodes: Array<{
            name: { json: any; type: { repr: string } }
            contents: { json: any }
          }>
        }
      }
    }
  }>(
    `query ($id: SuiAddress!) {
      object(address: $id) {
        asMoveObject {
          contents { json }
          dynamicFields {
            nodes {
              name { json type { repr } }
              contents { json }
            }
          }
        }
      }
    }`,
    { id: ssuId },
  )

  const obj = res.data?.object?.asMoveObject
  const json = obj?.contents?.json ?? {}
  const fields = obj?.dynamicFields?.nodes ?? []

  // Extract metadata
  const metadata = json.metadata ?? {}
  const name = metadata.name ?? null
  const description = metadata.description ?? null
  const status = json.status?.is_online ? 'ONLINE' : 'OFFLINE'

  // Find inventory from dynamic fields
  // The inventory is stored as a dynamic field keyed by owner_cap_id
  const items: InventoryItem[] = []
  let capacity: string | null = null
  let usedCapacity: string | null = null

  for (const field of fields) {
    const val = field.contents?.json?.value ?? field.contents?.json
    if (val && val.items) {
      // This is an Inventory dynamic field
      capacity = val.max_capacity ?? null
      usedCapacity = val.used_capacity ?? null
      const contents = val.items?.contents ?? val.items ?? []
      for (const entry of Array.isArray(contents) ? contents : []) {
        const item = entry.value ?? entry
        if (item.type_id !== undefined) {
          items.push({
            type_id: String(item.type_id),
            item_id: String(item.item_id ?? ''),
            quantity: String(item.quantity ?? 0),
            volume: String(item.volume ?? 0),
            tenant: item.tenant ?? '',
          })
        }
      }
    }
  }

  return { name, description, status, owner: json.owner_cap_id ?? null, items, capacity, usedCapacity }
}

async function findSSUConfig(ssuId: string): Promise<string | null> {
  const configType = `${EFGUARD_PKG}::ssu_extension::SSUExtensionConfig`
  const res = await executeGraphQLQuery<{
    objects: { nodes: Array<{ address: string; asMoveObject: { contents: { json: { ssu_id: string } } } }> }
  }>(
    `query ($type: String!) { objects(filter: { type: $type }, first: 20) { nodes { address asMoveObject { contents { json } } } } }`,
    { type: configType },
  )
  const nodes = res.data?.objects?.nodes ?? []
  const match = nodes.find((n) => n.asMoveObject?.contents?.json?.ssu_id === ssuId)
  return match?.address ?? null
}

async function findBinding(ssuId: string): Promise<string | null> {
  const bindingType = `${EFGUARD_PKG}::assembly_binding::AssemblyBinding`
  const res = await executeGraphQLQuery<{
    objects: { nodes: Array<{ address: string; asMoveObject: { contents: { json: { storage_units: { contents: string[] } } } } }> }
  }>(
    `query ($type: String!) { objects(filter: { type: $type }, first: 20) { nodes { address asMoveObject { contents { json } } } } }`,
    { type: bindingType },
  )
  const nodes = res.data?.objects?.nodes ?? []
  const match = nodes.find((n) => {
    const ssus = n.asMoveObject?.contents?.json?.storage_units?.contents ?? []
    return ssus.includes(ssuId)
  })
  return match?.address ?? null
}

async function findEveryoneCondition(): Promise<string | null> {
  const condType = `${EFGUARD_PKG}::condition_everyone::EveryoneCondition`
  const res = await executeGraphQLQuery<{
    objects: { nodes: Array<{ address: string }> }
  }>(
    `query ($type: String!) { objects(filter: { type: $type }, first: 5) { nodes { address } } }`,
    { type: condType },
  )
  return res.data?.objects?.nodes?.[0]?.address ?? null
}

async function findCharacterId(walletAddress: string): Promise<string | null> {
  const profileType = `${WORLD_PKG}::character::PlayerProfile`
  const profileRes = await executeGraphQLQuery<{
    address: { objects: { nodes: Array<{ address: string }> } }
  }>(
    `query ($owner: SuiAddress!, $type: String) { address(address: $owner) { objects(filter: { type: $type }, last: 1) { nodes { address } } } }`,
    { owner: walletAddress, type: profileType },
  )
  const profileAddr = profileRes.data?.address?.objects?.nodes?.[0]?.address
  if (!profileAddr) return null

  const profileObj = await executeGraphQLQuery<{
    object: { asMoveObject: { contents: { json: { character_id: string } } } }
  }>(
    `query ($addr: SuiAddress!) { object(address: $addr) { asMoveObject { contents { json } } } }`,
    { addr: profileAddr },
  )
  return profileObj.data?.object?.asMoveObject?.contents?.json?.character_id ?? null
}

// ── Component ───────────────────────────────────────────────────────────────

export function StorageView({ itemId }: { itemId: string | null }) {
  const { walletAddress, isConnected, handleConnect, hasEveVault } = useConnection()
  const dAppKit = useDAppKit()

  const [ssuInfo, setSSUInfo] = useState<SSUInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Withdraw state
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null)
  const [quantity, setQuantity] = useState('1')
  const [withdrawing, setWithdrawing] = useState(false)
  const [withdrawResult, setWithdrawResult] = useState<{ ok: boolean; msg: string } | null>(null)

  // On-chain references (resolved once)
  const [configId, setConfigId] = useState<string | null>(null)
  const [bindingId, setBindingId] = useState<string | null>(null)
  const [conditionId, setConditionId] = useState<string | null>(null)
  const [characterId, setCharacterId] = useState<string | null>(null)

  // Auto-connect wallet
  useEffect(() => {
    if (!isConnected && hasEveVault) handleConnect()
  }, [isConnected, hasEveVault, handleConnect])

  // Load SSU data
  const loadSSU = useCallback(async () => {
    if (!itemId) return
    setLoading(true)
    setError(null)
    try {
      const info = await fetchSSUInfo(itemId)
      setSSUInfo(info)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [itemId])

  useEffect(() => { loadSSU() }, [loadSSU])

  // Resolve on-chain references
  useEffect(() => {
    if (!itemId || !isConnected) return
    findSSUConfig(itemId).then(setConfigId).catch(console.error)
    findBinding(itemId).then(setBindingId).catch(console.error)
    findEveryoneCondition().then(setConditionId).catch(console.error)
  }, [itemId, isConnected])

  useEffect(() => {
    if (!walletAddress) return
    findCharacterId(walletAddress).then(setCharacterId).catch(console.error)
  }, [walletAddress])

  async function handleWithdraw() {
    if (!selectedItem || !configId || !bindingId || !characterId || !itemId) return

    setWithdrawing(true)
    setWithdrawResult(null)

    try {
      const tx = new Transaction()

      // Build eval context
      // Note: we need char_game_id and tribe_id, but the ssu_extension::withdraw
      // extracts these from the Character object internally via identity_resolver.
      // We only need condition proofs.

      // Create condition proof vector
      if (conditionId) {
        // Build eval context (needed by condition_everyone::verify)
        const evalCtx = tx.moveCall({
          target: `${EFGUARD_PKG}::assembly_binding::build_eval_context`,
          arguments: [
            tx.object(bindingId),
            tx.pure.id(itemId),           // assembly_id
            tx.pure.u64(0),               // char_game_id — condition_everyone ignores this
            tx.pure.u32(0),               // tribe_id — condition_everyone ignores this
            tx.pure.address(walletAddress!), // char_address
          ],
        })

        // Verify everyone condition
        const proof = tx.moveCall({
          target: `${EFGUARD_PKG}::condition_everyone::verify`,
          arguments: [tx.object(conditionId), evalCtx[0]],
        })

        // Build proofs vector
        const proofs = tx.makeMoveVec({
          type: `${EFGUARD_PKG}::assembly_binding::ConditionProof`,
          elements: [proof[0]],
        })

        // Withdraw
        const [item] = tx.moveCall({
          target: `${EFGUARD_PKG}::ssu_extension::withdraw`,
          arguments: [
            tx.object(configId),
            tx.object(bindingId),
            tx.object(itemId),
            tx.object(characterId),
            tx.pure.u64(selectedItem.type_id),
            tx.pure.u32(parseInt(quantity, 10)),
            proofs,
          ],
        })

        // Transfer withdrawn item to player
        tx.transferObjects([item], walletAddress!)
      }

      await dAppKit.signAndExecuteTransaction({ transaction: tx })
      setWithdrawResult({ ok: true, msg: `Withdrew ${quantity}x item #${selectedItem.type_id}` })
      setSelectedItem(null)
      setQuantity('1')
      // Refresh inventory
      setTimeout(loadSSU, 2000)
    } catch (err) {
      setWithdrawResult({ ok: false, msg: err instanceof Error ? err.message : String(err) })
    } finally {
      setWithdrawing(false)
    }
  }

  const maxQty = selectedItem ? parseInt(selectedItem.quantity, 10) : 0
  const canWithdraw = !!selectedItem && parseInt(quantity, 10) > 0 && parseInt(quantity, 10) <= maxQty && !!configId && !!bindingId && !!characterId && !withdrawing

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.textPrimary, fontFamily: "'Segoe UI', 'Arial Narrow', Arial, sans-serif", fontSize: '11px', position: 'relative', display: 'flex', flexDirection: 'column' }}>
      <AsciiBackground />

      <div style={{ position: 'relative', zIndex: 1, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 60px' }}>
        <div style={{ width: '100%', maxWidth: '480px' }}>

          {/* Not connected */}
          {!isConnected && (
            <div style={panelStyle}>
              <div style={{ padding: '20px', color: C.textMuted, textAlign: 'center' }}>Connecting wallet...</div>
            </div>
          )}

          {/* Loading */}
          {isConnected && loading && (
            <div style={panelStyle}>
              <div style={{ padding: '20px', color: C.textMuted, textAlign: 'center' }}>Loading storage inventory...</div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={panelStyle}>
              <div style={{ padding: '20px', color: C.red, textAlign: 'center' }}>{error}</div>
            </div>
          )}

          {/* No itemId */}
          {isConnected && !itemId && !loading && (
            <div style={panelStyle}>
              <div style={{ padding: '20px', color: C.textMuted, textAlign: 'center' }}>No storage unit specified.</div>
            </div>
          )}

          {/* SSU info + inventory */}
          {isConnected && ssuInfo && !loading && (
            <>
              {/* Header panel */}
              <div style={{ ...panelStyle, marginBottom: 8 }}>
                <div style={headerStyle}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{ssuInfo.name ?? 'Smart Storage Unit'}</span>
                    <span style={{ color: ssuInfo.status === 'ONLINE' ? C.green : C.red }}>
                      {ssuInfo.status ?? '?'}
                    </span>
                  </div>
                </div>
                {ssuInfo.description && (
                  <div style={{ ...rowStyle, borderBottom: 'none' }}>
                    <span style={{ color: C.textSecondary }}>{ssuInfo.description}</span>
                  </div>
                )}
                {ssuInfo.capacity && (
                  <div style={{ ...rowStyle, borderBottom: 'none' }}>
                    <span style={{ color: C.textSecondary }}>Capacity</span>
                    <span style={{ color: C.textPrimary }}>{ssuInfo.usedCapacity} / {ssuInfo.capacity}</span>
                  </div>
                )}
              </div>

              {/* Inventory */}
              <div style={{ ...panelStyle, marginBottom: 8 }}>
                <div style={headerStyle}>Inventory</div>

                {ssuInfo.items.length === 0 ? (
                  <div style={{ padding: '20px 10px', color: C.textMuted, textAlign: 'center' }}>Storage is empty.</div>
                ) : (
                  ssuInfo.items.map((item, i) => {
                    const isSelected = selectedItem?.type_id === item.type_id
                    return (
                      <div
                        key={item.type_id}
                        onClick={() => { setSelectedItem(isSelected ? null : item); setQuantity('1'); setWithdrawResult(null) }}
                        style={{
                          ...rowStyle,
                          cursor: 'pointer',
                          background: isSelected ? 'rgba(212, 113, 10, 0.15)' : 'transparent',
                          ...(i === ssuInfo.items.length - 1 ? { borderBottom: 'none' } : {}),
                        }}
                      >
                        <div>
                          <span style={{ color: C.textPrimary, fontFamily: 'monospace' }}>Item #{item.type_id}</span>
                          {item.item_id && item.item_id !== '0' && (
                            <span style={{ color: C.textMuted, marginLeft: 6, fontSize: '10px' }}>id:{item.item_id}</span>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                          <span style={{ color: C.textSecondary, fontSize: '10px' }}>vol: {item.volume}</span>
                          <span style={{ color: C.orange, fontWeight: 700 }}>x{item.quantity}</span>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {/* Withdraw panel */}
              {selectedItem && (
                <div style={{ ...panelStyle, marginBottom: 8 }}>
                  <div style={headerStyle}>Withdraw</div>
                  <div style={{ padding: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: 8 }}>
                      <span style={{ color: C.textSecondary, fontSize: '11px' }}>Item #{selectedItem.type_id}</span>
                      <span style={{ color: C.textMuted, fontSize: '10px' }}>({selectedItem.quantity} available)</span>
                    </div>

                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <label style={{ color: C.textSecondary, fontSize: '10px' }}>Qty:</label>
                      <input
                        type="number"
                        min={1}
                        max={maxQty}
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                        style={{
                          background: C.headerBg,
                          border: `1px solid ${C.border}`,
                          color: C.textPrimary,
                          padding: '4px 8px',
                          fontSize: '11px',
                          fontFamily: 'monospace',
                          width: '80px',
                          outline: 'none',
                        }}
                      />
                      <button
                        onClick={() => setQuantity(String(maxQty))}
                        style={{ background: 'none', border: `1px solid ${C.border}`, color: C.textSecondary, padding: '3px 8px', fontSize: '9px', cursor: 'pointer' }}
                      >
                        MAX
                      </button>
                      <button
                        onClick={handleWithdraw}
                        disabled={!canWithdraw}
                        style={{ ...btnStyle, opacity: canWithdraw ? 1 : 0.4, marginLeft: 'auto' }}
                      >
                        {withdrawing ? 'Withdrawing...' : 'Withdraw'}
                      </button>
                    </div>

                    {!characterId && isConnected && (
                      <div style={{ marginTop: 6, color: C.red, fontSize: '10px' }}>
                        No character found for your wallet. You need an EVE Frontier character to interact.
                      </div>
                    )}
                    {!configId && isConnected && (
                      <div style={{ marginTop: 6, color: C.orange, fontSize: '10px' }}>
                        ef_guard extension config not found for this SSU.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Result message */}
              {withdrawResult && (
                <div style={{ ...panelStyle, padding: '10px', marginBottom: 8 }}>
                  <span style={{ color: withdrawResult.ok ? C.green : C.red, fontSize: '11px' }}>
                    {withdrawResult.msg}
                  </span>
                </div>
              )}

              {/* Refresh button */}
              <div style={{ textAlign: 'center', marginTop: 4 }}>
                <button
                  onClick={loadSSU}
                  style={{ background: 'none', border: `1px solid ${C.border}`, color: C.textSecondary, padding: '4px 16px', fontSize: '9px', cursor: 'pointer', letterSpacing: '0.1em', textTransform: 'uppercase' }}
                >
                  Refresh
                </button>
              </div>
            </>
          )}

        </div>
      </div>

      {/* Footer */}
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 16px', borderTop: `1px solid ${C.border}` }}>
        <span style={{ color: C.textMuted, fontSize: '9px' }}>Protected by ef guard</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', opacity: 0.6 }}>
          <img src="./logo.png" alt="ef guard" style={{ height: '20px' }} />
          <span style={{ color: '#d0d0d0', fontWeight: 700, fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase' }}>EF GUARD</span>
        </div>
      </div>
    </div>
  )
}
