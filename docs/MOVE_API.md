# ef_guard Move API Reference

## Table of Contents

- [assembly_binding](#assembly_binding)
- [gate_extension](#gate_extension)
- [turret_extension](#turret_extension)
- [ssu_extension](#ssu_extension)
- [security_status](#security_status)
- [identity_resolver](#identity_resolver)
- [PTB Examples](#ptb-examples)

---

## assembly_binding

Core access-control module. One shared `AssemblyBinding` per base holds all policies.

### Error Codes

| Code | Name | Meaning |
|------|------|---------|
| 0 | `ENotBindingOwner` | Caller is not the binding owner |
| 1 | `EAssemblyAlreadyRegistered` | Assembly ID is already registered |
| 4 | `EAssemblyNotRegistered` | Assembly ID is not registered (cannot set policy) |

### Events

| Event | Fields | Emitted when |
|-------|--------|-------------|
| `BindingCreatedEvent` | `binding_id: ID, owner: address` | `new_binding()` |
| `AssemblyRegisteredEvent` | `binding_id: ID, assembly_id: ID, assembly_type: u8` | `register_gate/turret/ssu()` |
| `AssemblyDeregisteredEvent` | `binding_id: ID, assembly_id: ID, assembly_type: u8` | `deregister_gate/turret/ssu()` |
| `PolicySetEvent` | `binding_id: ID, assembly_id: ID, rule_count: u64, actor: address` | `set_policy()` |
| `BlocklistUpdatedEvent` | `binding_id: ID, char_game_id: u64, action: u8, actor: address` | `add/remove_from_blocklist()` |
| `AggressorBlockToggled` | `binding_id: ID, new_value: bool, actor: address` | `set_block_aggressors()` |
| `OwnershipTransferredEvent` | `binding_id: ID, old_owner: address, new_owner: address` | `transfer_ownership()` |

Event `assembly_type` values: `0` = gate, `1` = turret, `2` = SSU.
Event `action` values (blocklist): `0` = added, `1` = removed.

### Functions

#### Constructor

```move
public fun new_binding(ctx: &mut TxContext): AssemblyBinding
```
Creates a new binding owned by `ctx.sender()`. Returns the binding (not yet shared).

```move
public fun share_binding(binding: AssemblyBinding)
```
Shares the binding as a Sui shared object. Must be called after creation.

#### Assembly Registration

All registration functions require the caller to be the binding owner.

```move
public fun register_gate(binding: &mut AssemblyBinding, gate_id: ID, ctx: &TxContext)
public fun register_turret(binding: &mut AssemblyBinding, turret_id: ID, ctx: &TxContext)
public fun register_ssu(binding: &mut AssemblyBinding, ssu_id: ID, ctx: &TxContext)
```
Registers an assembly and creates an empty policy for it. Aborts with `EAssemblyAlreadyRegistered` if already registered.

```move
public fun deregister_gate(binding: &mut AssemblyBinding, gate_id: ID, ctx: &TxContext)
public fun deregister_turret(binding: &mut AssemblyBinding, turret_id: ID, ctx: &TxContext)
public fun deregister_ssu(binding: &mut AssemblyBinding, ssu_id: ID, ctx: &TxContext)
```
Removes an assembly and drops its policy. No-op if not registered.

#### Policy Management

```move
public fun set_policy(
    binding: &mut AssemblyBinding,
    assembly_id: ID,
    rules: vector<Rule>,
    ctx: &TxContext,
)
```
Replaces the entire rule list for an assembly. Requires owner. Aborts with `EAssemblyNotRegistered` if the assembly is not registered.

```move
public fun add_rule(
    binding: &mut AssemblyBinding,
    assembly_id: ID,
    target: RuleTarget,
    effect: RuleEffect,
    ctx: &TxContext,
)
```
Appends a single rule to the end of an assembly's policy.

```move
public fun remove_rule(
    binding: &mut AssemblyBinding,
    assembly_id: ID,
    index: u64,
    ctx: &TxContext,
)
```
Removes the rule at `index` from an assembly's policy.

#### Role Resolution

```move
public fun resolve_role(
    binding: &AssemblyBinding,
    assembly_id: ID,
    char_game_id: u64,
    tribe_id: u32,
): AccessDecision
```
Evaluates access for a character. Called by extension modules.

**Evaluation order:**
1. Blocklist check -- if blocklisted, returns `Deny`
2. Assembly lookup -- if not registered, returns `Default`
3. Rule scan -- first matching rule wins (`Allow` or `Deny`)
4. No match -- returns `Default`

#### Threat Config

```move
public fun set_block_aggressors(binding: &mut AssemblyBinding, value: bool, ctx: &TxContext)
public fun add_to_blocklist(binding: &mut AssemblyBinding, char_game_id: u64, ctx: &TxContext)
public fun remove_from_blocklist(binding: &mut AssemblyBinding, char_game_id: u64, ctx: &TxContext)
```
All require owner authorization.

#### Ownership

```move
public fun transfer_ownership(binding: &mut AssemblyBinding, new_owner: address, ctx: &TxContext)
```
Transfers binding ownership. The old owner loses all write access immediately.

#### Read Accessors

```move
public fun owner(binding: &AssemblyBinding): address
public fun threat_config(binding: &AssemblyBinding): &ThreatConfig
public fun contains_gate(binding: &AssemblyBinding, id: ID): bool
public fun contains_turret(binding: &AssemblyBinding, id: ID): bool
public fun contains_ssu(binding: &AssemblyBinding, id: ID): bool
```

#### Value Constructors (for PTB callers)

These functions create enum values that cannot be constructed directly in PTBs:

```move
public fun everyone(): RuleTarget
public fun tribe(tribe_id: u32): RuleTarget
public fun character(char_game_id: u64): RuleTarget
public fun allow(): RuleEffect
public fun deny(): RuleEffect
public fun rule(target: RuleTarget, effect: RuleEffect): Rule
public fun is_allow(decision: &AccessDecision): bool
public fun is_deny(decision: &AccessDecision): bool
```

---

## gate_extension

Smart Gate hook. Issues `JumpPermit` objects for allowed characters, aborts for denied.

### Error Codes

| Code | Name | Meaning |
|------|------|---------|
| 0 | `EAccessDenied` | Character was denied (Deny or Default) |
| 1 | `EWrongGate` | Source gate ID does not match config |

### Structs

```move
public struct EfGuardGateAuth has drop {}  // typed witness

public struct GateExtensionConfig has key {
    id:            UID,
    gate_id:       ID,
    permit_ttl_ms: u64,
}
```

### Events

| Event | Fields |
|-------|--------|
| `PermitIssuedEvent` | `config_id, gate_id, dest_gate_id, char_game_id, tribe_id, expires_at` |
| `PermitDeniedEvent` | `config_id, gate_id, dest_gate_id, char_game_id, tribe_id, reason` |

Denied `reason` values: `1` = policy Deny, `2` = Default (no match).

### Functions

```move
public fun authorize_on_gate(
    gate:          &mut Gate,
    owner_cap:     &OwnerCap<Gate>,
    permit_ttl_ms: u64,
    ctx:           &mut TxContext,
): GateExtensionConfig
```
**Setup.** Registers `EfGuardGateAuth` on the gate and returns a config object. Call `share_config()` after.

```move
public fun request_permit(
    config:      &GateExtensionConfig,
    binding:     &AssemblyBinding,
    source_gate: &Gate,
    dest_gate:   &Gate,
    character:   &Character,
    clock:       &Clock,
    ctx:         &mut TxContext,
)
```
**Player entry point.** Resolves the character's identity, evaluates the policy, and either issues a `JumpPermit` (transferred to the caller) or aborts with `EAccessDenied`.

```move
public fun set_permit_ttl(config: &mut GateExtensionConfig, owner_cap: &OwnerCap<Gate>, ttl_ms: u64)
```
Updates the permit TTL. Requires the gate's `OwnerCap`.

```move
public fun gate_id(config: &GateExtensionConfig): ID
public fun permit_ttl_ms(config: &GateExtensionConfig): u64
public fun share_config(config: GateExtensionConfig)
```

---

## turret_extension

Smart Turret hook. Evaluates each target candidate and returns a BCS-encoded priority list.

### Error Codes

| Code | Name | Meaning |
|------|------|---------|
| 0 | `EWrongTurret` | Turret ID does not match config |

### Structs

```move
public struct EfGuardTurretAuth has drop {}  // typed witness

public struct TurretExtensionConfig has key {
    id:           UID,
    turret_id:    ID,
    deny_weight:  u64,
    allow_weight: u64,
}
```

### Events

| Event | Fields |
|-------|--------|
| `TargetWeightedEvent` | `config_id, turret_id, char_game_id, tribe_id, is_aggressor, assigned_weight, excluded, override_reason` |

`override_reason` values:
| Value | Meaning |
|-------|---------|
| 0 | Default (no override) |
| 1 | Blocklisted |
| 2 | Aggressor blocked |
| 3 | Policy Deny |
| 4 | Policy Allow |

### Functions

```move
public fun authorize_on_turret(
    turret:       &mut Turret,
    owner_cap:    &OwnerCap<Turret>,
    deny_weight:  u64,
    allow_weight: u64,
    ctx:          &mut TxContext,
): TurretExtensionConfig
```
**Setup.** Registers the extension and returns a config object.

```move
public fun get_target_priority_list(
    config:                &TurretExtensionConfig,
    binding:               &AssemblyBinding,
    turret:                &Turret,
    owner_character:       &Character,
    target_candidate_list: vector<u8>,
): vector<u8>
```
**Game-server entry point.** Accepts BCS-encoded target candidates, evaluates each against the policy, and returns a BCS-encoded `vector<ReturnTargetPriorityList>`.

**Per-candidate evaluation order:**
1. Blocklist check -- `deny_weight`, included
2. Aggressor override (if `block_aggressors` enabled) -- `deny_weight`, included
3. Policy Deny -- `deny_weight`, included
4. Policy Allow -- `allow_weight`, **excluded** (hold fire)
5. Default -- owner and same-tribe non-aggressors **excluded**; others pass through with original weight

```move
public fun set_deny_weight(config: &mut TurretExtensionConfig, owner_cap: &OwnerCap<Turret>, weight: u64)
public fun set_allow_weight(config: &mut TurretExtensionConfig, owner_cap: &OwnerCap<Turret>, weight: u64)
public fun turret_id(config: &TurretExtensionConfig): ID
public fun deny_weight(config: &TurretExtensionConfig): u64
public fun allow_weight(config: &TurretExtensionConfig): u64
public fun share_config(config: TurretExtensionConfig)
```

---

## ssu_extension

Smart Storage Unit hook. Policy-checking proxy for deposit and withdraw operations.

### Error Codes

| Code | Name | Meaning |
|------|------|---------|
| 0 | `EAccessDenied` | Character denied by policy or Default |
| 1 | `EDepositDisabled` | `allow_deposit` is false |
| 2 | `EWithdrawDisabled` | `allow_withdraw` is false |
| 3 | `EWrongSSU` | SSU ID does not match config |

### Structs

```move
public struct EfGuardSSUAuth has drop {}  // typed witness

public struct SSUExtensionConfig has key {
    id:             UID,
    ssu_id:         ID,
    allow_deposit:  bool,
    allow_withdraw: bool,
}
```

### Events

| Event | Fields |
|-------|--------|
| `SSUAccessEvent` | `config_id, ssu_id, char_game_id, tribe_id, action, allowed, reason` |

`action` values: `0` = deposit, `1` = withdraw.
`reason` values: `0` = policy allow, `1` = policy deny, `2` = blocklist, `3` = flag disabled.

### Functions

```move
public fun authorize_on_ssu(
    ssu:            &mut StorageUnit,
    owner_cap:      &OwnerCap<StorageUnit>,
    allow_deposit:  bool,
    allow_withdraw: bool,
    ctx:            &mut TxContext,
): SSUExtensionConfig
```
**Setup.** Registers the extension. The `allow_deposit` / `allow_withdraw` flags provide a quick toggle independent of policy rules.

```move
public fun deposit(
    config:    &SSUExtensionConfig,
    binding:   &AssemblyBinding,
    ssu:       &mut StorageUnit,
    character: &Character,
    item:      Item,
    ctx:       &mut TxContext,
)
```
Checks `allow_deposit` flag, then evaluates policy. On `Allow`, calls `storage_unit::deposit_item`. Aborts otherwise.

```move
public fun withdraw(
    config:    &SSUExtensionConfig,
    binding:   &AssemblyBinding,
    ssu:       &mut StorageUnit,
    character: &Character,
    type_id:   u64,
    quantity:  u32,
    ctx:       &mut TxContext,
): Item
```
Checks `allow_withdraw` flag, then evaluates policy. On `Allow`, calls `storage_unit::withdraw_item` and returns the `Item`. Aborts otherwise.

```move
public fun set_allow_deposit(config: &mut SSUExtensionConfig, owner_cap: &OwnerCap<StorageUnit>, value: bool)
public fun set_allow_withdraw(config: &mut SSUExtensionConfig, owner_cap: &OwnerCap<StorageUnit>, value: bool)
public fun ssu_id(config: &SSUExtensionConfig): ID
public fun allow_deposit(config: &SSUExtensionConfig): bool
public fun allow_withdraw(config: &SSUExtensionConfig): bool
public fun share_config(config: SSUExtensionConfig)
```

---

## security_status

Threat-level overrides evaluated before policy rules. Embedded inside `AssemblyBinding` (not a standalone object).

### Functions

```move
public fun default_config(): ThreatConfig
```
Returns a permissive config: `block_aggressors = false`, empty blocklist.

```move
public fun set_block_aggressors(config: &mut ThreatConfig, value: bool)
public fun blocks_aggressors(config: &ThreatConfig): bool
```

```move
public fun add_to_blocklist(config: &mut ThreatConfig, char_game_id: u64)
public fun remove_from_blocklist(config: &mut ThreatConfig, char_game_id: u64)
public fun is_blocklisted(config: &ThreatConfig, char_game_id: u64): bool
```
`add_to_blocklist` is a no-op if already present. `remove_from_blocklist` is a no-op if not present.

```move
public fun passes_aggressor_override(
    config:       &ThreatConfig,
    char_game_id: u64,
    is_aggressor: bool,
): bool
```
Returns `false` if blocklisted OR if `block_aggressors` is enabled and `is_aggressor` is true. Used by turret extension only (aggressor data is not available in gate/SSU contexts).

---

## identity_resolver

Thin adapter between `world::character::Character` and the ef_guard policy engine.

### Functions

```move
public fun resolve(character: &Character): (u64, u32)
```
Returns `(char_game_id, tribe_id)`. This is the primary function used by all extension modules.

```move
public fun char_game_id(character: &Character): u64
```
Returns only the character's in-game ID.

```move
public fun tribe_id(character: &Character): u32
```
Returns only the character's tribe ID.

---

## PTB Examples

### Create a binding, register assemblies, and set a policy

```typescript
import { Transaction } from '@mysten/sui/transactions'

const tx = new Transaction()

// 1. Create binding
const [binding] = tx.moveCall({
  target: `${PKG}::assembly_binding::new_binding`,
})

// 2. Register a gate
tx.moveCall({
  target: `${PKG}::assembly_binding::register_gate`,
  arguments: [binding, tx.pure.id(GATE_ID)],
})

// 3. Build rules using value constructors
const [target] = tx.moveCall({
  target: `${PKG}::assembly_binding::tribe`,
  arguments: [tx.pure.u32(7)],
})
const [effect] = tx.moveCall({
  target: `${PKG}::assembly_binding::allow`,
})
const [rule] = tx.moveCall({
  target: `${PKG}::assembly_binding::rule`,
  arguments: [target, effect],
})

// 4. Set policy
const ruleVec = tx.makeMoveVec({
  type: `${PKG}::assembly_binding::Rule`,
  elements: [rule],
})
tx.moveCall({
  target: `${PKG}::assembly_binding::set_policy`,
  arguments: [binding, tx.pure.id(GATE_ID), ruleVec],
})

// 5. Share (must be last -- moves the object)
tx.moveCall({
  target: `${PKG}::assembly_binding::share_binding`,
  arguments: [binding],
})
```

### Install the gate extension

```typescript
const tx = new Transaction()

// Borrow the OwnerCap from the character
const [cap, receipt] = tx.moveCall({
  target: `${WORLD_PKG}::character::borrow_owner_cap`,
  typeArguments: [`${WORLD_PKG}::gate::Gate`],
  arguments: [tx.object(CHARACTER_ID), tx.receivingRef(ownerCapRef)],
})

// Authorize ef_guard on the gate
const [config] = tx.moveCall({
  target: `${PKG}::gate_extension::authorize_on_gate`,
  arguments: [tx.object(GATE_ID), cap, tx.pure.u64(3_600_000)],
})

// Share the config
tx.moveCall({
  target: `${PKG}::gate_extension::share_config`,
  arguments: [config],
})

// Return the OwnerCap
tx.moveCall({
  target: `${WORLD_PKG}::character::return_owner_cap`,
  typeArguments: [`${WORLD_PKG}::gate::Gate`],
  arguments: [tx.object(CHARACTER_ID), cap, receipt],
})
```

### Add a character to the blocklist

```typescript
const tx = new Transaction()
tx.moveCall({
  target: `${PKG}::assembly_binding::add_to_blocklist`,
  arguments: [tx.object(BINDING_ID), tx.pure.u64('12345')],
})
```

### Update a policy on an existing binding

```typescript
const tx = new Transaction()

// Build rules
const [t1] = tx.moveCall({ target: `${PKG}::assembly_binding::character`, arguments: [tx.pure.u64('42')] })
const [e1] = tx.moveCall({ target: `${PKG}::assembly_binding::allow` })
const [r1] = tx.moveCall({ target: `${PKG}::assembly_binding::rule`, arguments: [t1, e1] })

const [t2] = tx.moveCall({ target: `${PKG}::assembly_binding::everyone` })
const [e2] = tx.moveCall({ target: `${PKG}::assembly_binding::deny` })
const [r2] = tx.moveCall({ target: `${PKG}::assembly_binding::rule`, arguments: [t2, e2] })

const ruleVec = tx.makeMoveVec({
  type: `${PKG}::assembly_binding::Rule`,
  elements: [r1, r2],
})

tx.moveCall({
  target: `${PKG}::assembly_binding::set_policy`,
  arguments: [tx.object(BINDING_ID), tx.pure.id(GATE_ID), ruleVec],
})
```
