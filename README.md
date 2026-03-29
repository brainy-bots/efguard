# ef_guard

Access control middleware for EVE Frontier smart assemblies on Sui.

ef_guard provides a configurable, per-assembly rule engine that controls who can use your Gates, Turrets, and Storage Units. It integrates with the EVE Frontier world contracts via the typed-witness extension pattern.

## How it works

1. **Owner installs ef_guard** on their assemblies (Gate, Turret, SSU) via `authorize_extension`
2. **Owner defines rules** per assembly: allow/deny by tribe, character, or everyone — ordered, first-match-wins
3. **Players interact** — the extension evaluates rules on-chain and issues permits (gates), adjusts targeting (turrets), or gates deposit/withdraw (SSUs)
4. **Blocklist** overrides all rules — permanently deny specific characters across all assemblies

## Project structure

Based on the [EVE Frontier builder-scaffold](https://github.com/evefrontier/builder-scaffold).

| Area | Purpose |
|------|---------|
| [move-contracts/ef_guard/](./move-contracts/ef_guard/) | Sui Move contracts: `assembly_binding`, `gate_extension`, `turret_extension`, `ssu_extension`, `security_status`, `identity_resolver` |
| [dapps/](./dapps/) | React DApp: wallet connection (EVE Vault), assembly discovery, building groups, policy management |
| [ts-scripts/](./ts-scripts/) | TypeScript scripts for deployment and interaction |
| [docker/](./docker/) | Dev container for local Sui node |
| [setup-world/](./setup-world/) | World contract deployment (for local testing) |
| [zklogin/](./zklogin/) | zkLogin CLI for OAuth-based signing |
| [examples/smart-gate/](./examples/smart-gate/) | Example: replacing the scaffold's inline tribe check with ef_guard (3 files changed) |

## Example: integrating ef_guard

The [`examples/smart-gate/`](./examples/smart-gate/) directory shows how to add ef_guard to the standard [builder-scaffold](https://github.com/evefrontier/builder-scaffold) smart gate extension. Only 3 files change:

```move
// BEFORE (scaffold default — one hardcoded tribe)
assert!(character.tribe() == tribe_cfg.tribe, ENotStarterTribe);

// AFTER (ef_guard — full rule engine)
let decision = assembly_binding::resolve_role(binding, gate_id, char_game_id, tribe_id);
assert!(assembly_binding::is_allow(&decision), EAccessDenied);
```

This replaces a single tribe check with support for multiple tribes, individual character rules, a blocklist, and configurable priority — all updatable on-chain without redeploying.

A standalone two-commit version is also available at [brainy-bots/efguard-gate-example](https://github.com/brainy-bots/efguard-gate-example).

## Prerequisites

- [Git](https://git-scm.com/book/en/v2/Getting-Started-Installing-Git)
- [Sui CLI](https://docs.sui.io/guides/developer/getting-started) (via suiup)
- Node.js 22+ and pnpm
- [Docker](https://docs.docker.com/get-docker/) (optional, for local chain testing)

## Quick start

### Build & test Move contracts

```bash
cd move-contracts/ef_guard
sui move build
sui move test
```

### Run the DApp

```bash
cd dapps
cp .env.example .env    # edit with your package IDs
pnpm install
pnpm dev
```

Install the [EVE Vault Chrome extension](https://github.com/evefrontier/evevault/releases) to connect your wallet.

### Deploy to testnet

```bash
cd move-contracts/ef_guard
sui client publish --gas-budget 200000000
```

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

Gate Extension:  request_permit() → resolve_role() → issue JumpPermit or abort
Turret Extension: get_target_priority_list() → resolve_role() → weight targets
SSU Extension:   deposit()/withdraw() → resolve_role() → allow or abort
```

Rule evaluation: first matching rule wins. No match = deny (fail-safe).
Blocklist is checked before any rules.

## EVE Frontier Hackathon 2026

Built for the [EVE Frontier x Sui Hackathon 2026](https://deepsurge.xyz/evefrontier2026) — "A Toolkit for Civilization."

## License

MIT
