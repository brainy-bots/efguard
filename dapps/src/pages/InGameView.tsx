/**
 * In-game assembly view — matches EVE Frontier's UI style.
 * Route: #/ingame
 *
 * Reads all data from chain (no localStorage dependency), so it works
 * identically in the in-game browser and regular browsers.
 * Uses useSmartObject() from dapp-kit to get the building the game passes via ?itemId=
 */
import { useState, useEffect } from 'react'
import { useConnection, useSmartObject, executeGraphQLQuery } from '@evefrontier/dapp-kit'
import { useDAppKit } from '@mysten/dapp-kit-react'
import { Transaction } from '@mysten/sui/transactions'
import { fetchAllBindings, type BindingSummary } from '../lib/chain-policies'
import { useToast } from '../components/Toast'
import { EFGUARD_PKG, WORLD_PKG } from '../env'
import { AsciiBackground } from '../components/AsciiBackground'

/** Extract itemId from anywhere in the URL — search params, hash params, or fragment */
function extractItemId(): string | null {
  // Check window.location.search (?itemId=123#/ingame)
  const search = new URLSearchParams(window.location.search)
  if (search.get('itemId')) return search.get('itemId')

  // Check inside the hash (#/ingame?itemId=123)
  const hash = window.location.hash
  const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?')) : ''
  if (hashQuery) {
    const hashParams = new URLSearchParams(hashQuery)
    if (hashParams.get('itemId')) return hashParams.get('itemId')
  }

  return null
}

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

export function InGameView() {
  const { isConnected, walletAddress, handleConnect, hasEveVault } = useConnection()
  const { assembly, loading: assemblyLoading } = useSmartObject()
  const dAppKit = useDAppKit()
  const toast = useToast()

  const [bindings, setBindings] = useState<BindingSummary[]>([])
  const [bindingsLoading, setBindingsLoading] = useState(false)
  const [requesting, setRequesting] = useState(false)

  useEffect(() => {
    if (!isConnected && hasEveVault) handleConnect()
  }, [isConnected, hasEveVault, handleConnect])

  // Fetch all bindings — single source of truth for rules
  useEffect(() => {
    let stale = false
    setBindingsLoading(true)
    fetchAllBindings()
      .then((b) => { if (!stale) setBindings(b) })
      .catch(console.error)
      .finally(() => { if (!stale) setBindingsLoading(false) })
    return () => { stale = true }
  }, [])

  // Match the URL's itemId against assemblies in the bindings
  const urlItemId = extractItemId()
  const matchedPolicy = bindings.flatMap((b) =>
    b.policies.filter((p) => p.rules.length > 0)
  ).find((p) => p.gameItemId === urlItemId)

  // Also check if useSmartObject resolved it
  const assemblyId = assembly?.id ?? null
  const matchedByObjectId = assemblyId
    ? bindings.flatMap((b) => b.policies).find((p) => p.assemblyId === assemblyId)
    : null

  const specificPolicy = matchedPolicy ?? matchedByObjectId
  const isGate = specificPolicy?.assemblyType === 'gate'
  const loading = assemblyLoading || bindingsLoading
  const name = assembly?.name ?? specificPolicy?.assemblyName ?? null

  async function handleRequestPermit() {
    if (!specificPolicy || !walletAddress) return
    setRequesting(true)
    try {
      const gateId = specificPolicy.assemblyId
      const bindingForGate = bindings.find((b) =>
        b.policies.some((p) => p.assemblyId === gateId),
      )
      if (!bindingForGate) throw new Error('Binding not found')

      // Find the GateExtensionConfig for this gate
      const configType = `${EFGUARD_PKG}::gate_extension::GateExtensionConfig`
      const configRes = await executeGraphQLQuery<{
        objects: { nodes: Array<{ address: string; asMoveObject: { contents: { json: { gate_id: string } } } }> }
      }>(
        `query ($type: String!) { objects(filter: { type: $type }, first: 20) { nodes { address asMoveObject { contents { json } } } } }`,
        { type: configType },
      )
      const config = configRes.data?.objects?.nodes?.find(
        (n) => n.asMoveObject?.contents?.json?.gate_id === gateId,
      )
      if (!config) throw new Error('Gate config not found')

      // Find the destination gate (linked gate)
      const gateRes = await executeGraphQLQuery<{
        object: { asMoveObject: { contents: { json: { linked_gate_id: string } } } }
      }>(
        `query ($id: SuiAddress!) { object(address: $id) { asMoveObject { contents { json } } } }`,
        { id: gateId },
      )
      const destGateId = gateRes.data?.object?.asMoveObject?.contents?.json?.linked_gate_id
      if (!destGateId) throw new Error('Gate has no linked destination')

      // Find player's character
      const profileType = `${WORLD_PKG}::character::PlayerProfile`
      const profileRes = await executeGraphQLQuery<{
        address: { objects: { nodes: Array<{ address: string }> } }
      }>(
        `query ($owner: SuiAddress!, $type: String) { address(address: $owner) { objects(filter: { type: $type }, last: 1) { nodes { address } } } }`,
        { owner: walletAddress, type: profileType },
      )
      const profileAddr = profileRes.data?.address?.objects?.nodes?.[0]?.address
      if (!profileAddr) throw new Error('No character found')

      const profileObj = await executeGraphQLQuery<{
        object: { asMoveObject: { contents: { json: { character_id: string } } } }
      }>(
        `query ($addr: SuiAddress!) { object(address: $addr) { asMoveObject { contents { json } } } }`,
        { addr: profileAddr },
      )
      const characterId = profileObj.data?.object?.asMoveObject?.contents?.json?.character_id
      if (!characterId) throw new Error('Character ID not found')

      // Find condition objects for the rules
      const conditionIds = specificPolicy.rules.map((r) => r.conditionId)

      // Build the PTB
      const tx = new Transaction()

      // Build eval context
      const evalCtx = tx.moveCall({
        target: `${EFGUARD_PKG}::assembly_binding::build_eval_context`,
        arguments: [
          tx.object(bindingForGate.bindingId),
          tx.pure.id(gateId),
          tx.pure.u64(0), // char_game_id — conditions will read from Character
          tx.pure.u32(0), // tribe_id
          tx.pure.address(walletAddress),
        ],
      })

      // Verify each condition
      const proofElements = []
      for (const condId of conditionIds) {
        // Fetch condition type
        const condRes = await executeGraphQLQuery<{
          object: { asMoveObject: { contents: { type: { repr: string } } } }
        }>(
          `query ($id: SuiAddress!) { object(address: $id) { asMoveObject { contents { type { repr } } } } }`,
          { id: condId },
        )
        const condType = condRes.data?.object?.asMoveObject?.contents?.type?.repr ?? ''

        let verifyTarget: string
        if (condType.includes('EveryoneCondition')) {
          verifyTarget = `${EFGUARD_PKG}::condition_everyone::verify`
        } else if (condType.includes('TribeCondition')) {
          verifyTarget = `${EFGUARD_PKG}::condition_tribe::verify`
        } else if (condType.includes('CharacterCondition')) {
          verifyTarget = `${EFGUARD_PKG}::condition_character::verify`
        } else {
          console.warn('[ef_guard] Unknown condition type:', condType)
          continue
        }

        const [proof] = tx.moveCall({
          target: verifyTarget,
          arguments: [tx.object(condId), evalCtx[0]],
        })
        proofElements.push(proof)
      }

      const proofs = tx.makeMoveVec({
        type: `${EFGUARD_PKG}::assembly_binding::ConditionProof`,
        elements: proofElements,
      })

      // Request permit
      tx.moveCall({
        target: `${EFGUARD_PKG}::gate_extension::request_permit`,
        arguments: [
          tx.object(config.address),
          tx.object(bindingForGate.bindingId),
          proofs,
          tx.object(gateId),
          tx.object(destGateId),
          tx.object(characterId),
          tx.object('0x6'), // Clock
        ],
      })

      await dAppKit.signAndExecuteTransaction({ transaction: tx })
      toast.success('Jump permit issued! You can now jump through the gate.')
    } catch (err) {
      toast.error(`Permit failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setRequesting(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.textPrimary, fontFamily: "'Segoe UI', 'Arial Narrow', Arial, sans-serif", fontSize: '11px', position: 'relative', display: 'flex', flexDirection: 'column' }}>
      <AsciiBackground />

      <div style={{ position: 'relative', zIndex: 1, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 60px' }}>
        <div style={{ width: '100%', maxWidth: '480px' }}>

          {!isConnected && (
            <div style={panelStyle}>
              <div style={{ padding: '20px', color: C.textMuted, textAlign: 'center' }}>Connecting wallet...</div>
            </div>
          )}

          {isConnected && loading && (
            <div style={panelStyle}>
              <div style={{ padding: '20px', color: C.textMuted, textAlign: 'center' }}>Loading building data...</div>
            </div>
          )}

          {/* Specific building matched by itemId or object ID */}
          {isConnected && specificPolicy && !loading && (
            <div style={{ ...panelStyle, marginBottom: 8 }}>
              <div style={headerStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{name ?? specificPolicy.assemblyName ?? 'Building'}</span>
                  <span style={{ color: C.orange }}>PROTECTED</span>
                </div>
              </div>
              {specificPolicy.rules.map((r, i) => (
                <div key={r.conditionId} style={{ ...rowStyle, ...(i === specificPolicy.rules.length - 1 && !isGate ? { borderBottom: 'none' } : {}) }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ color: C.textMuted, width: '16px' }}>{String(i + 1).padStart(2, '0')}</span>
                    <span style={{ color: C.textPrimary, fontSize: '11px' }}>{r.label}</span>
                  </div>
                  <span style={{ color: r.effect === 'Allow' ? C.green : C.red, fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    {r.effect}
                  </span>
                </div>
              ))}
              {isGate && isConnected && (
                <div style={{ padding: '10px', borderTop: `1px solid ${C.border}`, textAlign: 'center' }}>
                  <button
                    onClick={handleRequestPermit}
                    disabled={requesting}
                    style={{
                      background: C.orange,
                      color: '#000',
                      border: 'none',
                      padding: '8px 24px',
                      fontSize: '11px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.1em',
                      cursor: requesting ? 'wait' : 'pointer',
                      opacity: requesting ? 0.6 : 1,
                    }}
                  >
                    {requesting ? 'Requesting...' : 'Request Jump Permit'}
                  </button>
                  <p style={{ color: C.textMuted, fontSize: '9px', marginTop: '6px' }}>
                    Get a permit, then use "Jump to" in-game
                  </p>
                </div>
              )}
            </div>
          )}

          {/* No specific building — show all bindings */}
          {isConnected && !specificPolicy && !loading && (
            <>
              {bindings.flatMap((b) =>
                b.policies.filter((p) => p.rules.length > 0).map((p) => (
                  <div key={p.assemblyId} style={{ ...panelStyle, marginBottom: 8 }}>
                    <div style={headerStyle}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>{p.assemblyName ?? `Building ${p.assemblyId.slice(0, 8)}...${p.assemblyId.slice(-4)}`}</span>
                        <span style={{ color: C.orange }}>PROTECTED</span>
                      </div>
                    </div>
                    {p.rules.map((r, i) => (
                      <div key={r.conditionId} style={{ ...rowStyle, ...(i === p.rules.length - 1 ? { borderBottom: 'none' } : {}) }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ color: C.textMuted, width: '16px' }}>{String(i + 1).padStart(2, '0')}</span>
                          <span style={{ color: C.textPrimary, fontSize: '11px' }}>{r.label}</span>
                        </div>
                        <span style={{ color: r.effect === 'Allow' ? C.green : C.red, fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                          {r.effect}
                        </span>
                      </div>
                    ))}
                  </div>
                ))
              )}
              {bindings.length === 0 && (
                <div style={panelStyle}>
                  <div style={headerStyle}>ef guard</div>
                  <div style={{ padding: '20px', color: C.textMuted, textAlign: 'center' }}>
                    No ef guard policies found on-chain.
                  </div>
                </div>
              )}
            </>
          )}


        </div>
      </div>

      <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', padding: '8px 16px', borderTop: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', opacity: 0.6 }}>
          <img src="./logo.png" alt="ef guard" style={{ height: '20px' }} />
          <span style={{ color: '#d0d0d0', fontWeight: 700, fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase' }}>EF GUARD</span>
        </div>
      </div>
    </div>
  )
}
