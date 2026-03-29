# ef_guard

**Access control middleware for EVE Frontier smart assemblies on Sui.**

ef_guard is a reusable on-chain rule engine that controls who can use your Gates, Turrets, and Smart Storage Units in EVE Frontier. Instead of hardcoding access logic into every extension, builders import ef_guard and call one function: `resolve_role()`. The rules — tribes, individual characters, blocklists — are configured on-chain and can be updated without redeploying contracts.

## The Problem

Every EVE Frontier smart assembly extension needs access control. The [builder-scaffold](https://github.com/evefrontier/builder-scaffold) example checks a single tribe:

```move
assert!(character.tribe() == tribe_cfg.tribe, ENotStarterTribe);
```

This works for simple cases, but real bases need more:
- Multiple allied tribes with different access levels
- Individual player access (VIPs, banned players)
- A blocklist that overrides everything
- Rules that can be changed without redeploying the contract
- The same rules applied across gates, turrets, and storage units

Every builder ends up reimplementing the same logic. ef_guard solves this once.

## How it works

1. **Owner creates an `AssemblyBinding`** — one shared object per base
2. **Registers assemblies** — gates, turrets, SSUs they want to protect
3. **Defines rules per assembly** — an ordered list evaluated top-to-bottom:
   - `Tribe(98000007) → Allow` — Algorithmic Warfare members can pass
   - `Character(811880) → Deny` — this specific player is banned
   - `Everyone → Deny` — everyone else is denied
4. **Extension calls `resolve_role()`** — one function, returns Allow/Deny/Default
5. **Blocklist** — permanently deny specific characters, overrides all rules

```move
// Any extension can use ef_guard in 3 lines:
let (char_game_id, tribe_id) = identity_resolver::resolve(character);
let decision = assembly_binding::resolve_role(binding, gate_id, char_game_id, tribe_id);
assert!(assembly_binding::is_allow(&decision), EAccessDenied);
```

## Example: integrating ef_guard

The [`examples/smart-gate/`](./examples/smart-gate/) directory shows how to add ef_guard to the standard builder-scaffold smart gate extension. **Only 3 files change:**

| Feature | Scaffold (before) | ef_guard (after) |
|---------|-------------------|------------------|
| Tribe access | Single tribe only | Multiple tribes with priority |
| Character access | Not supported | Allow/deny individual players |
| Blocklist | Not supported | Permanent deny list |
| Rule updates | Redeploy contract | Update on-chain, no redeploy |
| Rule priority | N/A | First-match-wins, configurable order |

A standalone two-commit version is also available at [brainy-bots/efguard-gate-example](https://github.com/brainy-bots/efguard-gate-example).

## Project structure

Based on the [EVE Frontier builder-scaffold](https://github.com/evefrontier/builder-scaffold).

| Area | Purpose |
|------|---------|
| [move-contracts/ef_guard/](./move-contracts/ef_guard/) | Sui Move contracts (6 modules, 78 unit tests) |
| [examples/smart-gate/](./examples/smart-gate/) | Example: scaffold gate extension using ef_guard |
| [dapps/](./dapps/) | React DApp: wallet connection, assembly discovery, policy management |
| [ts-scripts/](./ts-scripts/) | TypeScript scripts for deployment and on-chain integration tests |
| [docker/](./docker/) | Dev container for local Sui node + PostgreSQL indexer |
| [docs/](./docs/) | Architecture, data model, API reference, testing docs |

## Move contracts

Six modules, each with a focused responsibility:

| Module | Purpose |
|--------|---------|
| `assembly_binding` | Core rule engine: per-assembly policies, rule evaluation, registration |
| `gate_extension` | Typed-witness gate extension: issues `JumpPermit` on Allow |
| `turret_extension` | Targeting priority override: adjusts weights based on rules |
| `ssu_extension` | Deposit/withdraw proxy: gates access to Smart Storage Units |
| `security_status` | Blocklist and aggressor override (checked before rules) |
| `identity_resolver` | Extracts `(char_game_id, tribe_id)` from a `Character` object |

## DApp

React application for managing access policies across many buildings:

- **EVE Vault** wallet connection (zkLogin)
- **Assembly auto-discovery** via the Character ownership chain (Wallet → PlayerProfile → Character → OwnerCaps → Assemblies)
- **Building groups** — organize assemblies into named sets (stored locally)
- **Policy overview** — single page to manage all rules across all building groups
- **Tribe search** — autocomplete from the EVE Frontier datahub API
- **Drag-to-reorder** rules (first match wins on-chain)
- **Enable/disable** rules without removing them
- **Apply** — writes rules to all assemblies in a group with one transaction (Sui PTB)

## Architecture

```
AssemblyBinding (shared object, one per base)
├── owner address
├── threat_config (blocklist, block_aggressors)
├── registered assemblies (gates, turrets, SSUs)
└── policies: per-assembly rule lists
     └── Policy { rules: [Rule { target, effect }] }
         target: Everyone | Tribe(id) | Character(id)
         effect: Allow | Deny

Gate Extension:   resolve_role() → issue JumpPermit or abort
Turret Extension: resolve_role() → set target priority weights
SSU Extension:    resolve_role() → allow deposit/withdraw or abort
```

Rule evaluation: **first matching rule wins**. No match = deny (fail-safe).
Blocklist is checked before any rules.

## Testing

| Suite | Count | What it covers |
|-------|-------|----------------|
| Move unit tests | 78 | Rule evaluation, registration, ownership, blocklist, extensions |
| On-chain integration | 12 | Full PTB flows on local Sui node via Docker |

```bash
# Unit tests (standalone)
cd move-contracts/ef_guard
sui move test

# Integration tests (requires Docker)
cd docker && docker compose up -d
# ... deploy world + ef_guard, then:
pnpm test:integration
```

See [docs/TESTING.md](./docs/TESTING.md) for the full test matrix.

## Quick start

```bash
# Build & test
cd move-contracts/ef_guard
sui move build
sui move test    # 78 tests

# Run the DApp
cd dapps
cp .env.example .env
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
| [docs/MOVE_API.md](./docs/MOVE_API.md) | Full API reference for all 6 modules with PTB examples |
| [docs/TESTING.md](./docs/TESTING.md) | Test coverage matrix and how to run tests |

## Future plans

- **Rule Groups** — named collections of rules with accordion UI ([#1](https://github.com/brainy-bots/efguard/issues/1))
- **Transaction splitting** — auto-batch large policy applies across multiple PTBs ([#2](https://github.com/brainy-bots/efguard/issues/2))
- **Frontier Market** — vending machine SSU extension powered by ef_guard ([brainy-bots/frontier-market](https://github.com/brainy-bots/frontier-market))
- **Character search** — lookup players by name once the datahub API supports it
- **Assembly type support** — extend to generic `Assembly` type when EVE Frontier adds extension hooks
- **gRPC migration** — move from deprecated JSON-RPC to Sui gRPC/GraphQL RPC

## EVE Frontier x Sui Hackathon 2026

Built for the [EVE Frontier x Sui Hackathon 2026](https://deepsurge.xyz/evefrontier2026) — *"A Toolkit for Civilization."*

ef_guard is a toolkit component: it provides the access control layer so that other builders can focus on their game logic — markets, alliances, automated defenses — without reimplementing permissions from scratch.

## License

MIT
