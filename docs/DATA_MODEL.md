# ef_guard Data Model

This document describes the on-chain (Move) and off-chain (DApp/TypeScript) data models, explains why they differ, and shows how the DApp model maps to on-chain state when policies are applied.

---

## On-Chain Data Model (Move)

All on-chain data lives in a single shared object per base: `AssemblyBinding`.

### AssemblyBinding

```move
public struct AssemblyBinding has key {
    id:            UID,
    owner:         address,
    threat_config: ThreatConfig,
    policies:      VecMap<ID, Policy>,
    gates:         VecSet<ID>,
    turrets:       VecSet<ID>,
    storage_units: VecSet<ID>,
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `UID` | Sui object identity |
| `owner` | `address` | Only this address can modify the binding |
| `threat_config` | `ThreatConfig` | Blocklist and aggressor-blocking settings |
| `policies` | `VecMap<ID, Policy>` | Assembly ID to its ordered rule list |
| `gates` | `VecSet<ID>` | Registered gate assembly IDs |
| `turrets` | `VecSet<ID>` | Registered turret assembly IDs |
| `storage_units` | `VecSet<ID>` | Registered SSU assembly IDs |

### Policy

```move
public struct Policy has copy, store, drop {
    rules: vector<Rule>,
}
```

A flat, ordered list of rules. First match wins. Empty rules = no match = Default (denied for gates/SSUs).

### Rule

```move
public struct Rule has copy, drop, store {
    target: RuleTarget,
    effect: RuleEffect,
}
```

### RuleTarget

```move
public enum RuleTarget has copy, drop, store {
    Everyone,
    Tribe     { tribe_id:     u32 },
    Character { char_game_id: u64 },
}
```

| Variant | Matches |
|---------|---------|
| `Everyone` | Any character |
| `Tribe { tribe_id }` | Characters whose tribe ID equals `tribe_id` |
| `Character { char_game_id }` | A single character by game ID |

### RuleEffect

```move
public enum RuleEffect has copy, drop, store {
    Allow,
    Deny,
}
```

### AccessDecision

```move
public enum AccessDecision has copy, drop, store {
    Allow,
    Deny,
    Default,
}
```

Returned by `resolve_role()`. Extension modules interpret `Default` according to their context (fail-safe deny for gates/SSUs; friendly-fire logic for turrets).

### ThreatConfig

```move
public struct ThreatConfig has store {
    block_aggressors: bool,
    blocklist:        VecSet<u64>,
}
```

| Field | Type | Description |
|-------|------|-------------|
| `block_aggressors` | `bool` | When true, turret targets flagged `is_aggressor` by the game server receive deny weight |
| `blocklist` | `VecSet<u64>` | Set of character game IDs that are unconditionally denied on all assemblies |

### Extension Config Objects

Each extension type has its own shared config object:

**GateExtensionConfig**
```move
public struct GateExtensionConfig has key {
    id:            UID,
    gate_id:       ID,
    permit_ttl_ms: u64,
}
```

**TurretExtensionConfig**
```move
public struct TurretExtensionConfig has key {
    id:           UID,
    turret_id:    ID,
    deny_weight:  u64,
    allow_weight: u64,
}
```

**SSUExtensionConfig**
```move
public struct SSUExtensionConfig has key {
    id:             UID,
    ssu_id:         ID,
    allow_deposit:  bool,
    allow_withdraw: bool,
}
```

---

## DApp Data Model (TypeScript / localStorage)

The DApp stores three collections in localStorage, each managed by a dedicated React hook.

### SavedRule

```typescript
interface SavedRule {
  id: string          // crypto.randomUUID()
  target: RuleTarget  // { type: 'tribe', tribe_id } | { type: 'character', char_game_id } | { type: 'everyone' }
  label: string       // display name ("Tribe Frontier Corp", "Pilot #42", "Everyone")
}
```

**Storage key:** `efguard-rules`

A reusable rule definition. Defines "who" (the target) with a human-readable label. Does not include the effect -- that is set per-policy-entry so the same rule can be "Allow" on one group and "Deny" on another.

### PolicyEntry

```typescript
interface PolicyEntry {
  id: string        // crypto.randomUUID()
  ruleId: string    // references SavedRule.id
  effect: RuleEffect  // 'Allow' | 'Deny'
  enabled: boolean  // disabled entries are excluded from on-chain transactions
  order: number     // determines evaluation priority (lower = evaluated first)
}
```

### GroupPolicy

```typescript
interface GroupPolicy {
  buildingGroupId: string  // references BuildingGroup.id
  entries: PolicyEntry[]
  dirty: boolean           // true = local changes not yet applied on-chain
}
```

**Storage key:** `efguard-policies`

### BuildingGroup

```typescript
interface BuildingGroup {
  id: string
  name: string                  // user-defined label ("North Gates", "Trade SSUs")
  entries: BuildingGroupEntry[]
}

interface BuildingGroupEntry {
  assemblyId: string
  assemblyType: 'gate' | 'turret' | 'ssu'
}
```

**Storage key:** `efguard:building-groups`

---

## Why the Models Differ

The on-chain and DApp data models serve fundamentally different purposes and operate under different constraints:

| Concern | On-Chain (Move) | DApp (TypeScript) |
|---------|-----------------|-------------------|
| **Storage cost** | Every byte costs gas. Flat `vector<Rule>` is minimal. | localStorage is free. Rich metadata is fine. |
| **Evaluation speed** | Linear scan of a short vector per access check. Must be fast. | No runtime evaluation. Only used at "Apply" time. |
| **Granularity** | One policy per assembly. No grouping concept. | Building groups let owners manage many assemblies as one. |
| **State** | Immutable between transactions. Rules are the source of truth. | Mutable locally. Dirty tracking shows what needs syncing. |
| **UX features** | None -- raw data only. | Named rules with labels, enable/disable toggle, drag-to-reorder, dirty indicators. |

The on-chain model is deliberately simple: a flat list of rules per assembly, evaluated linearly. This makes the Move code auditable and gas-efficient.

The DApp model adds the UX layer that makes policy management practical: reusable named rules, building groups, enable/disable toggles, and ordering controls.

---

## How DApp Data Maps to On-Chain

When the user clicks "Apply", the DApp performs the following transformation for each dirty `GroupPolicy`:

```
DApp State                              On-Chain Calls
+------------------+                    +---------------------------+
| GroupPolicy      |                    |                           |
|  buildingGroupId |---> BuildingGroup  |                           |
|                  |     .entries[]     |                           |
|  entries[]       |                    |                           |
|   [0] ruleId ----+--> SavedRule      |                           |
|       effect     |    .target        |                           |
|       enabled: T |                    |                           |
|       order: 0   |                    |                           |
|   [1] ruleId ----+--> SavedRule      |                           |
|       effect     |    .target        |                           |
|       enabled: F | (skipped)         |                           |
|       order: 1   |                    |                           |
|   [2] ruleId ----+--> SavedRule      |                           |
|       effect     |    .target        |                           |
|       enabled: T |                    |                           |
|       order: 2   |                    |                           |
+------------------+                    |                           |
                                        |                           |
        |                               |                           |
        v                               |                           |
                                        |                           |
  1. Filter: keep enabled entries       |                           |
     -> entries [0], [2]                |                           |
                                        |                           |
  2. Sort by order                      |                           |
     -> [0], [2]                        |                           |
                                        |                           |
  3. Resolve each entry:                |                           |
     entry.ruleId -> SavedRule.target   |                           |
     + entry.effect                     |                           |
     -> PolicyRule[]                    |                           |
                                        |                           |
  4. For each assembly in group:        |                           |
     buildSetPolicyTx(                  | set_policy(binding,       |
       bindingId,                       |   assembly_id,            |
       assembly.assemblyId,             |   [Rule{target,effect},   |
       policyRules                      |    Rule{target,effect}]   |
     )                                  | )                         |
                                        +---------------------------+
```

### Step-by-step

1. **Filter**: Disabled `PolicyEntry` items are excluded. They remain in localStorage for the user to re-enable later but are never sent on-chain.

2. **Sort**: Entries are sorted by their `order` field (set by drag-to-reorder). Order determines evaluation priority on-chain -- lower order values are evaluated first.

3. **Resolve targets**: Each `PolicyEntry.ruleId` is looked up in the `SavedRule[]` array to get the `RuleTarget`. Combined with `PolicyEntry.effect`, this produces a `PolicyRule { target, effect }`.

4. **Fan out to assemblies**: The `BuildingGroup` is resolved to its list of assembly IDs. The same `PolicyRule[]` array is sent to `set_policy()` for each assembly -- one call per assembly, composed into a single Sui PTB.

5. **Mark clean**: After the transaction succeeds, `GroupPolicy.dirty` is set to `false`.

### What is NOT stored on-chain

- Rule names/labels
- Building group names and groupings
- Enable/disable state
- Which rules are "reusable"
- The dirty flag

These are DApp-only concepts that exist purely for user convenience.
