import { Transaction } from '@mysten/sui/transactions'
import type { AssemblyType, RuleEffect, ExtensionConfig } from '../types'
import { EFGUARD_PKG, WORLD_PKG } from '../env'

// ── Condition creation ─────────────────────────────────────────────────────

/** Create and share a TribeCondition (shared object). */
export function buildCreateTribeConditionTx(tribeId: number): Transaction {
  const tx = new Transaction()
  const [condition] = tx.moveCall({
    target: `${EFGUARD_PKG}::condition_tribe::new`,
    arguments: [tx.pure.u32(tribeId)],
  })
  tx.moveCall({
    target: `${EFGUARD_PKG}::condition_tribe::share`,
    arguments: [condition],
  })
  return tx
}

/** Create and share a CharacterCondition (shared object). */
export function buildCreateCharacterConditionTx(charGameId: string): Transaction {
  const tx = new Transaction()
  const [condition] = tx.moveCall({
    target: `${EFGUARD_PKG}::condition_character::new`,
    arguments: [tx.pure.u64(charGameId)],
  })
  tx.moveCall({
    target: `${EFGUARD_PKG}::condition_character::share`,
    arguments: [condition],
  })
  return tx
}

/** Create and share an EveryoneCondition (shared object). */
export function buildCreateEveryoneConditionTx(): Transaction {
  const tx = new Transaction()
  const [condition] = tx.moveCall({
    target: `${EFGUARD_PKG}::condition_everyone::new`,
  })
  tx.moveCall({
    target: `${EFGUARD_PKG}::condition_everyone::share`,
    arguments: [condition],
  })
  return tx
}

// ── Rule construction helpers ───────────────────────────────────────────────

function buildEffect(tx: Transaction, effect: RuleEffect) {
  const fn = effect === 'Allow' ? 'allow' : 'deny'
  const [e] = tx.moveCall({ target: `${EFGUARD_PKG}::assembly_binding::${fn}` })
  return e
}

function buildRule(tx: Transaction, conditionId: string, effect: RuleEffect) {
  const eff = buildEffect(tx, effect)
  const [r] = tx.moveCall({
    target: `${EFGUARD_PKG}::assembly_binding::rule`,
    arguments: [tx.pure.id(conditionId), eff],
  })
  return r
}

// ── Binding creation ────────────────────────────────────────────────────────

/**
 * Create a binding, register assemblies, and optionally set policies — all in one PTB.
 * The binding is shared at the end (must be last since it moves the object).
 */
export function buildSetupTx(
  assemblies: Array<{ id: string; type: AssemblyType }>,
  policies?: Array<{ assemblyId: string; rules: Array<{ conditionId: string; effect: RuleEffect }> }>,
): Transaction {
  const tx = new Transaction()

  const [binding] = tx.moveCall({ target: `${EFGUARD_PKG}::assembly_binding::new_binding` })

  // Register assemblies
  for (const { id, type } of assemblies) {
    const fn = type === 'gate' ? 'register_gate' : type === 'turret' ? 'register_turret' : 'register_ssu'
    tx.moveCall({
      target: `${EFGUARD_PKG}::assembly_binding::${fn}`,
      arguments: [binding, tx.pure.id(id)],
    })
  }

  // Set policies
  if (policies) {
    for (const { assemblyId, rules } of policies) {
      if (rules.length === 0) continue
      const ruleVec = tx.makeMoveVec({
        type: `${EFGUARD_PKG}::assembly_binding::Rule`,
        elements: rules.map((r) => buildRule(tx, r.conditionId, r.effect)),
      })
      tx.moveCall({
        target: `${EFGUARD_PKG}::assembly_binding::set_policy`,
        arguments: [binding, tx.pure.id(assemblyId), ruleVec],
      })
    }
  }

  // Share (must be last)
  tx.moveCall({ target: `${EFGUARD_PKG}::assembly_binding::share_binding`, arguments: [binding] })

  return tx
}

// ── Policy management (on existing binding) ─────────────────────────────────

/** Replace the entire rule list for an assembly. */
export function buildSetPolicyTx(
  bindingId: string,
  assemblyId: string,
  rules: Array<{ conditionId: string; effect: RuleEffect }>,
): Transaction {
  const tx = new Transaction()
  const ruleVec = tx.makeMoveVec({
    type: `${EFGUARD_PKG}::assembly_binding::Rule`,
    elements: rules.map((r) => buildRule(tx, r.conditionId, r.effect)),
  })
  tx.moveCall({
    target: `${EFGUARD_PKG}::assembly_binding::set_policy`,
    arguments: [tx.object(bindingId), tx.pure.id(assemblyId), ruleVec],
  })
  return tx
}

/** Append a single rule to an assembly's policy. */
export function buildAddRuleTx(
  bindingId: string,
  assemblyId: string,
  conditionId: string,
  effect: RuleEffect,
): Transaction {
  const tx = new Transaction()
  const eff = buildEffect(tx, effect)
  tx.moveCall({
    target: `${EFGUARD_PKG}::assembly_binding::add_rule`,
    arguments: [tx.object(bindingId), tx.pure.id(assemblyId), tx.pure.id(conditionId), eff],
  })
  return tx
}

/** Remove a rule by index from an assembly's policy. */
export function buildRemoveRuleTx(
  bindingId: string,
  assemblyId: string,
  index: number,
): Transaction {
  const tx = new Transaction()
  tx.moveCall({
    target: `${EFGUARD_PKG}::assembly_binding::remove_rule`,
    arguments: [tx.object(bindingId), tx.pure.id(assemblyId), tx.pure.u64(index)],
  })
  return tx
}

// ── Assembly registration ───────────────────────────────────────────────────

export function buildRegisterAssemblyTx(
  bindingId: string,
  assemblyId: string,
  assemblyType: AssemblyType,
): Transaction {
  const tx = new Transaction()
  const fn = assemblyType === 'gate' ? 'register_gate' : assemblyType === 'turret' ? 'register_turret' : 'register_ssu'
  tx.moveCall({
    target: `${EFGUARD_PKG}::assembly_binding::${fn}`,
    arguments: [tx.object(bindingId), tx.pure.id(assemblyId)],
  })
  return tx
}

export function buildDeregisterAssemblyTx(
  bindingId: string,
  assemblyId: string,
  assemblyType: AssemblyType,
): Transaction {
  const tx = new Transaction()
  const fn = assemblyType === 'gate' ? 'deregister_gate' : assemblyType === 'turret' ? 'deregister_turret' : 'deregister_ssu'
  tx.moveCall({
    target: `${EFGUARD_PKG}::assembly_binding::${fn}`,
    arguments: [tx.object(bindingId), tx.pure.id(assemblyId)],
  })
  return tx
}

// ── Extension installation ───────────────────────────────────────────────────

export function buildInstallExtensionTx(
  assemblyType: AssemblyType,
  assemblyId: string,
  characterId: string,
  ownerCapId: string,
  ownerCapVersion: string,
  ownerCapDigest: string,
  config: ExtensionConfig,
): Transaction {
  const tx = new Transaction()

  const worldTypeMap = {
    gate:   `${WORLD_PKG}::gate::Gate`,
    turret: `${WORLD_PKG}::turret::Turret`,
    ssu:    `${WORLD_PKG}::storage_unit::StorageUnit`,
  }

  const capRef = { objectId: ownerCapId, version: ownerCapVersion, digest: ownerCapDigest }

  const [cap, receipt] = tx.moveCall({
    target: `${WORLD_PKG}::character::borrow_owner_cap`,
    typeArguments: [worldTypeMap[assemblyType]],
    arguments: [tx.object(characterId), tx.receivingRef(capRef)],
  })

  let extensionConfig: ReturnType<Transaction['moveCall']>[0]

  if (assemblyType === 'gate') {
    ;[extensionConfig] = tx.moveCall({
      target: `${EFGUARD_PKG}::gate_extension::authorize_on_gate`,
      arguments: [tx.object(assemblyId), cap, tx.pure.u64(config.permit_ttl_ms ?? 3_600_000)],
    })
    tx.moveCall({ target: `${EFGUARD_PKG}::gate_extension::share_config`, arguments: [extensionConfig] })
  } else if (assemblyType === 'turret') {
    ;[extensionConfig] = tx.moveCall({
      target: `${EFGUARD_PKG}::turret_extension::authorize_on_turret`,
      arguments: [tx.object(assemblyId), cap, tx.pure.u64(config.deny_weight ?? 100), tx.pure.u64(config.allow_weight ?? 0)],
    })
    tx.moveCall({ target: `${EFGUARD_PKG}::turret_extension::share_config`, arguments: [extensionConfig] })
  } else {
    ;[extensionConfig] = tx.moveCall({
      target: `${EFGUARD_PKG}::ssu_extension::authorize_on_ssu`,
      arguments: [tx.object(assemblyId), cap, tx.pure.bool(config.allow_deposit ?? true), tx.pure.bool(config.allow_withdraw ?? false)],
    })
    tx.moveCall({ target: `${EFGUARD_PKG}::ssu_extension::share_config`, arguments: [extensionConfig] })
  }

  // TODO: metadata URL setting removed — requires a separate transaction
  // because the OwnerCap is already borrowed in this PTB and the target
  // function lives in the world package, not ef_guard.

  tx.moveCall({
    target: `${WORLD_PKG}::character::return_owner_cap`,
    typeArguments: [worldTypeMap[assemblyType]],
    arguments: [tx.object(characterId), cap, receipt],
  })

  return tx
}

// ── Threat config ────────────────────────────────────────────────────────────

export function buildSetBlockAggressorsTx(bindingId: string, value: boolean): Transaction {
  const tx = new Transaction()
  tx.moveCall({
    target: `${EFGUARD_PKG}::assembly_binding::set_block_aggressors`,
    arguments: [tx.object(bindingId), tx.pure.bool(value)],
  })
  return tx
}

export function buildAddToBlocklistTx(bindingId: string, charGameId: string): Transaction {
  const tx = new Transaction()
  tx.moveCall({
    target: `${EFGUARD_PKG}::assembly_binding::add_to_blocklist`,
    arguments: [tx.object(bindingId), tx.pure.u64(charGameId)],
  })
  return tx
}

export function buildRemoveFromBlocklistTx(bindingId: string, charGameId: string): Transaction {
  const tx = new Transaction()
  tx.moveCall({
    target: `${EFGUARD_PKG}::assembly_binding::remove_from_blocklist`,
    arguments: [tx.object(bindingId), tx.pure.u64(charGameId)],
  })
  return tx
}
