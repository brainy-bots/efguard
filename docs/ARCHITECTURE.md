# ef_guard Architecture

## System Overview

ef_guard is an on-chain access control system for [EVE Frontier](https://evefrontier.com) that lets base owners define per-assembly security policies. It controls who can use Smart Gates (jump between systems), Smart Turrets (automated defense), and Smart Storage Units (item deposit/withdrawal) through a declarative rule-based policy engine deployed as Sui Move smart contracts.

The system has two main components:

1. **Move contracts** (on-chain) -- six modules that store policies and enforce access decisions at transaction time.
2. **React DApp** (off-chain) -- a browser-based management UI that lets owners build, preview, and apply policies without writing code.

### Where ef_guard fits in EVE Frontier

EVE Frontier's world contracts define three assembly types: Gates, Turrets, and Storage Units. Each supports an **extension** mechanism -- a typed-witness pattern that lets third-party contracts hook into assembly operations. ef_guard registers itself as an extension on each assembly type and intercepts access requests to enforce the owner's policy.

```
 EVE Frontier World Contracts          ef_guard
 +--------------------------+         +---------------------------+
 |  Gate                    |  hook   |  gate_extension           |
 |    authorize_extension<T>| ------> |    request_permit()       |
 |    issue_jump_permit<T>  |         |                           |
 +--------------------------+         +---------------------------+
 |  Turret                  |  hook   |  turret_extension         |
 |    authorize_extension<T>| ------> |    get_target_priority_   |
 |    verify_online()       |         |    list()                 |
 +--------------------------+         +---------------------------+
 |  StorageUnit             |  hook   |  ssu_extension            |
 |    authorize_extension<T>| ------> |    deposit() / withdraw() |
 +--------------------------+         +---------------------------+
```

---

## Move Contract Architecture

### Module Overview

| Module | Responsibility |
|--------|---------------|
| `assembly_binding` | Core data model. Stores per-assembly policies, the blocklist, and ownership. Provides `resolve_role()` for access decisions. |
| `security_status` | Threat override layer. Manages the character blocklist and aggressor-blocking toggle. Embedded inside `AssemblyBinding`. |
| `identity_resolver` | Thin adapter that extracts `(char_game_id, tribe_id)` from a `world::character::Character` object. Isolates the world-contracts API surface. |
| `gate_extension` | Smart Gate hook. Checks policy via `resolve_role()`, then issues or denies a `JumpPermit`. |
| `turret_extension` | Smart Turret hook. Evaluates each target candidate against policy and returns a BCS-encoded priority-weight list. |
| `ssu_extension` | Smart Storage Unit hook. Policy-checking proxy for `deposit_item` and `withdraw_item`. |

### Module Dependency Graph

```
                    +---------------------+
                    | identity_resolver   |
                    | (world::character)  |
                    +----------+----------+
                               |
           +-------------------+-------------------+
           |                   |                   |
  +--------v--------+ +-------v--------+ +--------v--------+
  | gate_extension   | | turret_extension| | ssu_extension    |
  +---------+--------+ +-------+--------+ +--------+--------+
            |                  |                    |
            +------------------+--------------------+
                               |
                    +----------v----------+
                    | assembly_binding    |
                    +----------+----------+
                               |
                    +----------v----------+
                    | security_status     |
                    +---------------------+
```

All three extension modules depend on `assembly_binding` for policy evaluation and `identity_resolver` for character identity extraction. `assembly_binding` embeds `security_status::ThreatConfig` directly -- it is not a standalone shared object.

---

## Extension Pattern: Typed-Witness Authorization

EVE Frontier's world contracts use a **typed-witness pattern** to authorize extensions. Each ef_guard extension module defines a zero-size witness struct (e.g., `EfGuardGateAuth has drop`) and a config object that is shared on-chain:

```
1. Owner calls authorize_on_gate(gate, owner_cap, ttl)
   -> calls gate::authorize_extension<EfGuardGateAuth>(gate, owner_cap)
   -> creates & shares GateExtensionConfig { gate_id, permit_ttl_ms }

2. Player calls request_permit(config, binding, source_gate, dest_gate, character, clock)
   -> resolves identity via identity_resolver::resolve(character)
   -> evaluates policy via assembly_binding::resolve_role(binding, gate_id, ...)
   -> on Allow: gate::issue_jump_permit<EfGuardGateAuth>(..., EfGuardGateAuth {}, ...)
   -> on Deny/Default: aborts with EAccessDenied
```

The witness struct (`EfGuardGateAuth {}`) is created inline at the call site and consumed by the world contract function. Since only the ef_guard package can instantiate `EfGuardGateAuth`, the world contract trusts that authorization was performed.

Each extension type follows the same two-phase pattern:
- **Setup phase** (owner): `authorize_on_*()` registers the extension and creates a shared config object.
- **Runtime phase** (player/server): The entry-point function checks policy and delegates to the world contract.

---

## Rule Evaluation

### First-Match-Wins Semantics

Each assembly has an ordered list of `Rule` values. When a character attempts access, rules are evaluated top-to-bottom. The **first matching rule wins**:

```
Policy for Gate 0xABC:
  [0] Character(42)  -> Allow     <-- CHAR_A matches here -> Allow
  [1] Tribe(7)       -> Deny      <-- other tribe-7 members match here -> Deny
  [2] Everyone       -> Deny      <-- everyone else matches here -> Deny
```

### Blocklist Priority

Before any rule evaluation, the `ThreatConfig` blocklist is checked. If a character is blocklisted, access is **always denied**, regardless of any Allow rules:

```
resolve_role(binding, assembly_id, char_game_id, tribe_id):
  1. if char_game_id in blocklist -> Deny (unconditional)
  2. if assembly not registered   -> Default
  3. evaluate rules top-to-bottom -> first match wins
  4. no rule matched              -> Default
```

### AccessDecision Enum

| Variant | Meaning | Gate behavior | Turret behavior | SSU behavior |
|---------|---------|---------------|-----------------|--------------|
| `Allow` | Character is explicitly permitted | Issue `JumpPermit` | Exclude from target list (hold fire) | Allow deposit/withdraw |
| `Deny` | Character is explicitly denied | Abort `EAccessDenied` | Include with `deny_weight` (prioritize targeting) | Abort `EAccessDenied` |
| `Default` | No policy or no matching rule | Abort `EAccessDenied` (fail-safe) | Pass-through with original weight (friendly-fire excluded) | Abort `EAccessDenied` (fail-safe) |

Gates and SSUs are **fail-safe** -- Default means denied. Turrets use Default to apply built-in friendly-fire logic: same-tribe non-aggressors and the owner are excluded from targeting; everyone else passes through with their original weight.

---

## DApp Architecture

The management DApp is a React single-page application built with:

- **React** -- UI framework
- **@evefrontier/dapp-kit** -- wallet connection, character resolution, datahub queries
- **@mysten/sui** -- Sui transaction building (`Transaction` / PTB)
- **localStorage** -- client-side persistence for rules, policies, and building groups

### Key Hooks

| Hook | Storage Key | Purpose |
|------|-------------|---------|
| `useRules()` | `efguard-rules` | CRUD for reusable rule definitions (target + label) |
| `usePolicies()` | `efguard-policies` | Per-building-group policy entries with enable/disable, ordering, dirty tracking |
| `useBuildingGroups()` | `efguard:building-groups` | Named groups of assemblies that share a policy |

### Transaction Builders

`tx-builders.ts` provides composable PTB constructors:

| Function | Purpose |
|----------|---------|
| `buildSetupTx()` | Create binding + register assemblies + set policies in one PTB |
| `buildSetPolicyTx()` | Replace an assembly's entire rule list |
| `buildAddRuleTx()` | Append a single rule |
| `buildRemoveRuleTx()` | Remove a rule by index |
| `buildRegisterAssemblyTx()` | Register a new assembly on an existing binding |
| `buildDeregisterAssemblyTx()` | Remove an assembly from a binding |
| `buildInstallExtensionTx()` | Authorize ef_guard on a world assembly (borrows OwnerCap) |
| `buildSetBlockAggressorsTx()` | Toggle aggressor blocking |
| `buildAddToBlocklistTx()` | Add character to blocklist |
| `buildRemoveFromBlocklistTx()` | Remove character from blocklist |

---

## Data Flow

```
+------------------+     +-------------------+     +------------------+
|  Wallet Connect  |     |  Character Query   |     |  Assembly Query   |
|  (Sui address)   | --> |  (dapp-kit)        | --> |  (owned objects)  |
+------------------+     +-------------------+     +------------------+
                                                           |
                                                           v
+----------------------------------------------------------+----------+
|                        DApp (browser)                               |
|                                                                     |
|  localStorage:                                                      |
|  +------------------+  +------------------+  +-------------------+  |
|  | SavedRule[]      |  | GroupPolicy[]    |  | BuildingGroup[]   |  |
|  | - id, target,    |  | - buildingGroupId|  | - id, name,       |  |
|  |   label          |  | - entries[]      |  |   entries[]       |  |
|  +------------------+  |   - ruleId       |  +-------------------+  |
|                        |   - effect       |                         |
|                        |   - enabled      |                         |
|                        |   - order        |                         |
|                        +------------------+                         |
|                                                                     |
|  On "Apply":                                                        |
|  1. Resolve BuildingGroup -> list of assembly IDs                   |
|  2. For each GroupPolicy:                                           |
|     a. Filter to enabled entries                                    |
|     b. Sort by order                                                |
|     c. Resolve ruleId -> SavedRule -> RuleTarget                    |
|     d. Map to PolicyRule { target, effect }                         |
|  3. For each assembly in group:                                     |
|     -> buildSetPolicyTx(bindingId, assemblyId, rules)               |
|  4. Sign & execute PTB                                              |
+---------------------------------------------------------------------+
                              |
                              v
+---------------------------------------------------------------------+
|                     Sui Blockchain                                   |
|                                                                     |
|  AssemblyBinding (shared object)                                    |
|  +-------------------+                                              |
|  | owner: address    |                                              |
|  | threat_config     |                                              |
|  |   blocklist: []   |                                              |
|  |   block_aggr: F   |                                              |
|  | policies: VecMap  |                                              |
|  |   gate_0x1 -> [Rule{Tribe(7),Allow}, Rule{Everyone,Deny}]       |
|  |   turret_0x2 -> [Rule{Character(42),Allow}]                     |
|  | gates: {0x1}      |                                              |
|  | turrets: {0x2}    |                                              |
|  | storage_units: {} |                                              |
|  +-------------------+                                              |
+---------------------------------------------------------------------+
```
