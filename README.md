# ef_guard

**Pluggable access control middleware for EVE Frontier smart assemblies on Sui.**

ef_guard is a reusable on-chain rule engine with a plugin system for arbitrary access conditions. It controls who can use your Gates, Turrets, and Smart Storage Units — based on tribe membership, individual identity, NFT ownership, signed attestations, or any custom condition a developer can build.

Instead of hardcoding access logic into every extension, builders import ef_guard and call one function: `resolve_role()`. Conditions are pluggable modules — ef_guard doesn't need to know what they check. This means the system can verify anything from simple tribe membership to complex off-chain data (via signed attestations today, zero-knowledge proofs tomorrow) without changing the core engine.

## The Problem

Every EVE Frontier smart assembly extension needs access control. The [builder-scaffold](https://github.com/evefrontier/builder-scaffold) example checks a single tribe:

```move
assert!(character.tribe() == tribe_cfg.tribe, ENotStarterTribe);
```

This works for simple cases. But real infrastructure needs:
- Multiple allied tribes with different access levels
- Individual player access (VIPs, subscribers, banned players)
- Token-gated access (hold an NFT to enter)
- Off-chain data verification (inventory totals, reputation scores)
- Rules that can be updated without redeploying contracts
- The same rules applied across dozens of buildings
- Custom conditions that don't exist yet

Every builder shouldn't have to solve these problems from scratch. ef_guard solves them once, with an extensible architecture that grows with the game.

## How it works

```
┌─────────────────────────────────────────────────────────────┐
│                    Player's PTB                              │
│                                                              │
│  1. Build EvalContext (free — from existing tx data)         │
│  2. Call condition.verify(ctx) → ConditionProof              │
│     (for each condition the rules reference)                 │
│  3. Call resolve_role(binding, assembly, proofs) → decision  │
│  4. Extension acts on decision (permit / deny / weight)      │
└─────────────────────────────────────────────────────────────┘
```

1. **Owner creates an `AssemblyBinding`** — one shared object per base
2. **Registers assemblies** — gates, turrets, SSUs to protect
3. **Creates condition objects** — tribe check, character check, NFT requirement, etc.
4. **Defines rules per assembly** — ordered list of `(condition → effect)` pairs
5. **Players interact** — conditions are evaluated, proofs collected, first matching rule wins
6. **Blocklist** — permanent deny that overrides all conditions and rules

## Pluggable condition system

The core innovation: **conditions are separate modules** that anyone can create. ef_guard defines the interface — condition modules implement it. The engine never imports condition code; it just checks proofs.

### Built-in conditions

| Condition | What it checks | Extra proof from player? |
|-----------|---------------|--------------------------|
| `condition_tribe` | Character belongs to a specific tribe | No — reads EvalContext |
| `condition_character` | Character matches a specific game ID | No — reads EvalContext |
| `condition_everyone` | Always passes (catch-all) | No |
| `condition_min_balance` | Player holds a minimum coin balance | Yes — passes `&Coin<T>` reference |
| `condition_token_holder` | Player's wallet holds a specific NFT/token type | Yes — passes `&T` reference |
| `condition_attestation` | Signed attestation from a trusted server | Yes — passes signature bytes |

### How conditions work

Every condition receives an `EvalContext` containing all available transaction data:

```move
public struct EvalContext has copy, drop {
    assembly_id:   ID,       // which building
    char_game_id:  u64,      // player's game ID
    tribe_id:      u32,      // player's tribe
    char_address:  address,  // player's wallet address
    binding_owner: address,  // building owner's address
}
```

A condition module reads what it needs and returns a `ConditionProof`:

```move
// Tribe condition — reads tribe_id from context, no extra data needed
public fun verify(condition: &TribeCondition, ctx: &EvalContext): ConditionProof {
    let passed = assembly_binding::ctx_tribe_id(ctx) == condition.tribe_id;
    assembly_binding::new_condition_proof(object::id(condition), passed)
}

// Token holder — player passes their NFT as proof of ownership
public fun verify<T: key>(condition: &TokenHolderCondition, ctx: &EvalContext, token: &T): ConditionProof {
    let passed = type_name::get<T>() == condition.required_type;
    assembly_binding::new_condition_proof(object::id(condition), passed)
}
```

### Creating custom conditions

Any developer can create a new condition module without touching ef_guard:

```move
/// Example: only allow players whose game ID is even (silly but concrete)
module my_package::condition_even_id {
    use ef_guard::assembly_binding::{Self, EvalContext, ConditionProof};

    public struct EvenIdCondition has key, store { id: UID }

    public fun new(ctx: &mut TxContext): EvenIdCondition {
        EvenIdCondition { id: object::new(ctx) }
    }

    public fun share(condition: EvenIdCondition) {
        transfer::share_object(condition);
    }

    public fun verify(condition: &EvenIdCondition, ctx: &EvalContext): ConditionProof {
        let passed = assembly_binding::ctx_char_game_id(ctx) % 2 == 0;
        assembly_binding::new_condition_proof(object::id(condition), passed)
    }
}
```

That's it. No registration, no approval, no changes to ef_guard. The owner adds a rule referencing your condition's object ID, and it works.

### Using ef_guard in your own extension

If you're building a gate extension with custom logic (tolls, bounties, etc.), import ef_guard for access control:

```move
module my_package::toll_gate {
    use ef_guard::assembly_binding::{Self, AssemblyBinding, ConditionProof, EvalContext};
    use ef_guard::identity_resolver;
    use world::character::Character;
    use world::gate::{Self, Gate};
    use sui::coin::Coin;
    use sui::sui::SUI;
    use sui::clock::Clock;

    public struct TollGateAuth has drop {}

    /// Player pays a toll AND must pass ef_guard access rules to jump.
    public fun jump_with_toll(
        binding:          &AssemblyBinding,
        condition_proofs: &vector<ConditionProof>,
        source_gate:      &Gate,
        dest_gate:        &Gate,
        character:        &Character,
        payment:          Coin<SUI>,
        clock:            &Clock,
        ctx:              &mut TxContext,
    ) {
        // 1. Check ef_guard access rules
        let (char_game_id, _tribe_id) = identity_resolver::resolve(character);
        let decision = assembly_binding::resolve_role(
            binding, object::id(source_gate), char_game_id, condition_proofs,
        );
        assert!(assembly_binding::is_allow(&decision), 0);

        // 2. Your custom logic — collect the toll
        transfer::public_transfer(payment, @treasury);

        // 3. Issue the jump permit
        let expires_at = clock.timestamp_ms() + 3600000;
        gate::issue_jump_permit<TollGateAuth>(
            source_gate, dest_gate, character,
            TollGateAuth {}, expires_at, ctx,
        );
    }
}
```

Your Move.toml just needs:

```toml
[dependencies]
ef_guard = { git = "https://github.com/brainy-bots/efguard.git", subdir = "move-contracts/ef_guard" }
```

The owner manages access rules through the ef_guard DApp or by calling `set_policy` directly. Your extension focuses on its unique logic — ef_guard handles who gets in.

## Signed attestations & the path to ZK proofs

Some conditions need data that isn't available on-chain — inventory totals across multiple SSUs, off-chain reputation, Discord roles, KYC status. Passing all that data on-chain would be expensive or impossible.

**Today: signed attestations.** A trusted off-chain service reads the data, signs an attestation ("player X has ≥100 ore"), and the player passes the signature on-chain. The `condition_attestation` module verifies it with ed25519. Security: bound to character + assembly + timestamp with configurable expiry.

**Tomorrow: zero-knowledge proofs.** Same pattern, but the attestation is replaced by a mathematical proof that the claim is true — no trust required. Sui has native groth16 support. The ef_guard interface doesn't change; only the condition module and prover service change. ([See issue #3](https://github.com/brainy-bots/efguard/issues/3))

This means ef_guard's condition system can eventually verify **arbitrarily complex claims about arbitrarily large datasets** — player inventory across all SSUs, total net worth, historical activity, cross-game identity — with a single compact proof on-chain.

## Example: integrating ef_guard

The [`examples/smart-gate/`](./examples/smart-gate/) directory shows how to add ef_guard to the standard builder-scaffold smart gate extension. **Only 3 files change.**

A standalone two-commit version is also available at [brainy-bots/efguard-gate-example](https://github.com/brainy-bots/efguard-gate-example).

## Project structure

Based on the [EVE Frontier builder-scaffold](https://github.com/evefrontier/builder-scaffold).

| Area | Purpose |
|------|---------|
| [move-contracts/ef_guard/](./move-contracts/ef_guard/) | Sui Move contracts (11 modules, 89 unit tests) |
| [examples/smart-gate/](./examples/smart-gate/) | Example: scaffold gate extension using ef_guard |
| [dapps/](./dapps/) | React DApp: wallet connection, assembly discovery, policy management |
| [ts-scripts/](./ts-scripts/) | TypeScript scripts for deployment and on-chain integration tests |
| [docker/](./docker/) | Dev container for local Sui node + PostgreSQL indexer |
| [docs/](./docs/) | Architecture, data model, API reference, testing docs |

## Move contracts

Eleven modules:

| Module | Purpose |
|--------|---------|
| `assembly_binding` | Core engine: policies, rule evaluation, EvalContext, ConditionProof |
| `condition_tribe` | Condition: tribe membership check |
| `condition_character` | Condition: specific player check |
| `condition_everyone` | Condition: catch-all (always passes) |
| `condition_min_balance` | Condition: minimum coin balance (generic `<T>`) |
| `condition_token_holder` | Condition: NFT/token ownership (generic `<T: key>`) |
| `condition_attestation` | Condition: signed attestation from trusted server (ed25519) |
| `gate_extension` | Typed-witness gate extension: issues `JumpPermit` on Allow |
| `turret_extension` | Targeting priority override: adjusts weights based on rules |
| `ssu_extension` | Deposit/withdraw proxy: gates access to Smart Storage Units |
| `security_status` | Blocklist and aggressor override (checked before any conditions) |

## DApp

React application for managing access policies across many buildings. **Live on Stillness** at [brainy-bots.github.io/efguard](https://brainy-bots.github.io/efguard/).

### Admin Panel (web browser)
- **EVE Vault** wallet connection (zkLogin)
- **Assembly auto-discovery** via the Character ownership chain
- **Building groups** — organize assemblies into named sets, editable (rename, add/remove buildings)
- **Policy overview** — single page to manage all rules across all building groups
- **Tribe search** — autocomplete from the EVE Frontier datahub API (375+ tribes, multi-word fuzzy matching)
- **Player verification** — look up players by game ID before adding rules
- **Drag-to-reorder** rules (first match wins on-chain)
- **Enable/disable** rules without removing them
- **Apply All** — writes rules to all assemblies across all groups in one batch
- **Blocklist** — direct on-chain add/remove, overrides all rules
- **Install ef_guard** — one-click extension install per building with auto-registration
- **Update URL** — detects outdated DApp URLs and updates without reinstalling
- **Extension detection** — shows current extension name, detects old ef_guard versions
- **Toast notifications** — non-blocking success/error feedback for all transactions
- **Single env var** to switch between game servers (Stillness, Utopia)

### In-Game View (embedded browser)
- **Reads directly from chain** — no localStorage dependency, works for any player
- **Per-building rules** — shows all access rules for the specific building via `?itemId=` URL param
- **Fallback view** — shows all protected buildings and their rules when no specific building is identified
- **Tribe and player name resolution** — displays human-readable names instead of IDs
- **EVE Frontier theme** — dark UI with animated ASCII background matching the game aesthetic

### Custom Conditions (for developers)

Any developer can create new condition types without modifying ef_guard. The DApp shows advanced conditions (min balance, NFT holder, attestation) in the rule creation UI with descriptions of what they do. Currently these require CLI/script setup — DApp configuration is planned.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   AssemblyBinding                        │
│  (shared object, one per base)                          │
│                                                          │
│  owner, threat_config (blocklist)                       │
│  registered assemblies (gates, turrets, SSUs)           │
│                                                          │
│  policies: per-assembly rule lists                      │
│    Rule = { condition_id, effect (Allow/Deny) }         │
│    First matching rule wins. No match = deny.           │
└────────────────────┬────────────────────────────────────┘
                     │ resolve_role(proofs)
    ┌────────────────┼────────────────────┐
    │                │                    │
    ▼                ▼                    ▼
Gate Extension  Turret Extension   SSU Extension
issue permit    weight targets     gate deposit/withdraw

Conditions (pluggable modules):
  ┌──────────────┐ ┌────────────────┐ ┌───────────────┐
  │ Tribe check  │ │ NFT ownership  │ │ Attestation   │
  │ (EvalContext) │ │ (pass &T)      │ │ (ed25519 sig) │
  └──────────────┘ └────────────────┘ └───────────────┘
  ┌──────────────┐ ┌────────────────┐ ┌───────────────┐
  │ Character ID │ │ Your custom    │ │ ZK proof      │
  │ (EvalContext) │ │ condition here │ │ (future)      │
  └──────────────┘ └────────────────┘ └───────────────┘
```

## Testing

| Suite | Count | What it covers |
|-------|-------|----------------|
| Move unit tests | 89 | Conditions, rule evaluation, registration, ownership, blocklist, extensions, token holder, attestation |
| On-chain integration | 14 | Full condition PTB flows on local Sui node via Docker |

```bash
# Unit tests (standalone)
cd move-contracts/ef_guard
sui move build
sui move test    # 89 tests

# Integration tests (requires Docker)
cd docker && docker compose up -d
# ... deploy world + ef_guard, then:
pnpm test:integration    # 14 tests
```

## Quick start

```bash
# Build & test
cd move-contracts/ef_guard
sui move build
sui move test

# Run the DApp
cd dapps
cp .env.example .env    # set VITE_TENANT=stillness or utopia
pnpm install && pnpm dev
# Install EVE Vault: https://github.com/evefrontier/evevault/releases

# Deploy to testnet
cd move-contracts/ef_guard
sui client publish --gas-budget 200000000
```

## Documentation

| Document | Contents |
|----------|----------|
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | System overview, module interactions, extension pattern |
| [docs/DATA_MODEL.md](./docs/DATA_MODEL.md) | On-chain vs DApp data models and why they differ |
| [docs/MOVE_API.md](./docs/MOVE_API.md) | Full API reference with PTB examples |
| [docs/TESTING.md](./docs/TESTING.md) | Test coverage matrix and how to run tests |
| [docs/LIMITATIONS.md](./docs/LIMITATIONS.md) | Known limitations and suggestions for EVE Frontier developers |

## Roadmap

### Implemented
- Pluggable condition system with EvalContext
- 6 condition modules (tribe, character, everyone, min balance, token holder, attestation)
- Per-assembly policies with first-match-wins evaluation
- Blocklist override
- Gate and SSU extensions (turret extension exists but game server limitations prevent full use — [see LIMITATIONS.md](./docs/LIMITATIONS.md))
- React DApp with admin panel + in-game view
- Deployed and working on Stillness testnet
- 103 tests (89 unit + 14 on-chain integration)

### Next
- **Single-transaction Apply** — collapse the 2-TX flow into one PTB ([#5](https://github.com/brainy-bots/efguard/issues/5))
- **ZK proof conditions** — trustless off-chain data verification via groth16 ([#3](https://github.com/brainy-bots/efguard/issues/3))
- **Centralized transaction service** — single source of truth for blockchain operations ([#8](https://github.com/brainy-bots/efguard/issues/8))
- **Optimize attestation encoding** — single BCS tuple instead of 4 separate vectors ([#6](https://github.com/brainy-bots/efguard/issues/6))
- **Optional event emissions** — reduce gas on success path ([#7](https://github.com/brainy-bots/efguard/issues/7))
- **Building group deletion cleanup** — remove on-chain policies when a group is deleted ([#4](https://github.com/brainy-bots/efguard/issues/4))
- **Frontier Market** — vending machine powered by ef_guard ([brainy-bots/frontier-market](https://github.com/brainy-bots/frontier-market))
- **Community conditions** — marketplace for condition modules built by other developers

### Vision

ef_guard + ZK proofs enables a fully programmable, trustless access control layer for EVE Frontier. Any claim about any data — on-chain or off-chain — can be verified in a single compact proof. A streamer can gate their facilities to NFT holders. A tribe leader can require a minimum net worth to access strategic infrastructure. A market operator can verify reputation scores. All without revealing private data, all without trusting a central server, all composable with any other condition.

The condition plugin system means the community builds the conditions. ef_guard is the middleware that ties them together.

## EVE Frontier x Sui Hackathon 2026

Built for the [EVE Frontier x Sui Hackathon 2026](https://deepsurge.xyz/evefrontier2026) — *"A Toolkit for Civilization."*

ef_guard is the access control toolkit that every other toolkit builds on.

**Deployed on Stillness:**
- Package: `0x8cc4acad0cb8355ac6d2bdc810d9bf0b830966a259105e30e0aeee4216a42217`
- DApp: [brainy-bots.github.io/efguard](https://brainy-bots.github.io/efguard/)

## License

AGPL-3.0 — see [LICENSE](./LICENSE). Commercial licensing available on request.
