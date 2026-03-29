# Example: Smart Gate with ef_guard

This example shows how to replace the [builder-scaffold](https://github.com/evefrontier/builder-scaffold)'s inline tribe check with ef_guard access control. Only 3 files need to change.

## Before vs After

### Before (scaffold default — `tribe_permit.move`)

```move
// Checks a single hardcoded tribe
assert!(character.tribe() == tribe_cfg.tribe, ENotStarterTribe);
```

### After (with ef_guard)

```move
// Delegates to ef_guard's rule engine
let (char_game_id, tribe_id) = identity_resolver::resolve(character);
let gate_id = object::id(source_gate);
let decision = assembly_binding::resolve_role(binding, gate_id, char_game_id, tribe_id);
assert!(assembly_binding::is_allow(&decision), EAccessDenied);
```

## What this enables

| Feature | Scaffold (before) | ef_guard (after) |
|---------|-------------------|------------------|
| Tribe access | Single tribe only | Multiple tribes with priority |
| Character access | Not supported | Allow/deny individual players |
| Blocklist | Not supported | Permanent deny list |
| Rule updates | Redeploy contract | Update on-chain, no redeploy |
| Rule priority | N/A | First-match-wins, configurable order |
| Default policy | Allow all or deny all | Configurable (deny if no match) |

## Files changed (from scaffold baseline)

| File | Change |
|------|--------|
| `move-contracts/Move.toml` | Added `ef_guard` as a git dependency |
| `move-contracts/sources/tribe_permit.move` | Replaced `assert!(character.tribe() == tribe_cfg.tribe)` with `assembly_binding::resolve_role()` |
| `configure-rules.ts` | Creates ef_guard binding with rules instead of setting a single tribe config |

## Files NOT changed

- `config.move` — still provides `XAuth` witness and `ExtensionConfig`
- `corpse_gate_bounty.move` — bounty logic is independent of access control
- All scaffold infrastructure (Docker, setup-world, zklogin)

## How to use

1. Follow the [builder-scaffold setup](https://github.com/evefrontier/builder-scaffold)
2. Copy these files into your scaffold's `move-contracts/smart_gate_extension/`
3. Add `EFGUARD_PACKAGE_ID` to your `.env`
4. Publish and configure as usual

The full standalone example is also available at [brainy-bots/efguard-gate-example](https://github.com/brainy-bots/efguard-gate-example) with a two-commit history showing the exact diff from the unmodified scaffold.
