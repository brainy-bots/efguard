# ef_guard Testing

## Overview

ef_guard has **78 unit tests** across 6 test modules and **12 integration tests** that run against the full EVE Frontier world-contracts stack. All tests are written in Sui Move and execute via `sui move test`.

---

## Move Unit Tests

Unit tests validate the core policy engine and threat config logic without requiring world-contract infrastructure. They use `tx_context::dummy()` and direct struct construction.

### How to Run

```bash
cd move-contracts/ef_guard
sui move test
```

To run a specific test module:

```bash
sui move test --filter assembly_binding_tests
sui move test --filter security_status_tests
```

### What's Covered

The unit tests focus on `assembly_binding` and `security_status` -- the modules that can be tested without world-contract dependencies.

---

## Integration Tests

Integration tests exercise the full extension lifecycle: creating world objects (characters, network nodes, assemblies), registering ef_guard extensions, and executing access checks. They use `sui::test_scenario` to simulate multi-transaction flows with realistic shared objects.

### How to Run

Integration tests require the world-contracts dependency. With the Docker environment:

```bash
cd docker
docker compose run --rm --service-ports sui-dev

# Inside the container:
cd /workspace/builder-scaffold/move-contracts/ef_guard
sui move test
```

Or with a local world-contracts checkout (configured in `Move.toml`):

```bash
cd move-contracts/ef_guard
sui move test
```

### What's Covered

Integration tests validate:
- Extension authorization (typed-witness pattern)
- End-to-end permit issuance and denial
- Turret candidate weighting with real BCS-encoded payloads
- SSU deposit/withdraw with real inventory items
- Config object sharing and accessor correctness
- Wrong-assembly-ID guards (`EWrongGate`, `EWrongTurret`, `EWrongSSU`)

---

## Test Matrix

### assembly_binding_tests -- 34 tests

| # | Test | Category |
|---|------|----------|
| 1 | `new_binding_owner_is_sender` | Constructor |
| 2 | `new_binding_contains_no_assemblies` | Constructor |
| 3 | `resolve_role_tribe_allow` | Basic resolution |
| 4 | `resolve_role_tribe_deny` | Basic resolution |
| 5 | `resolve_role_no_match_returns_default` | Basic resolution |
| 6 | `resolve_role_unregistered_assembly_returns_default` | Basic resolution |
| 7 | `resolve_role_character_match` | Basic resolution |
| 8 | `resolve_role_everyone_match` | Basic resolution |
| 9 | `resolve_role_first_rule_wins` | First-match semantics |
| 10 | `different_assemblies_have_independent_policies` | Per-assembly isolation |
| 11 | `blocklist_overrides_allow_rule` | Blocklist priority |
| 12 | `blocklist_remove_restores_access` | Blocklist priority |
| 13 | `add_rule_appends_to_policy` | Incremental edits |
| 14 | `remove_rule_changes_policy` | Incremental edits |
| 15 | `register_and_deregister_gate` | Registration |
| 16 | `register_gate_twice_aborts` | Registration (expected failure) |
| 17 | `set_policy_on_unregistered_assembly_aborts` | Registration (expected failure) |
| 18 | `deregister_drops_policy` | Registration |
| 19 | `transfer_ownership_changes_owner` | Ownership |
| 20 | `non_owner_cannot_set_policy` | Authorization (expected failure) |
| 21 | `non_owner_cannot_blocklist` | Authorization (expected failure) |
| 22 | `resolve_role_works_for_turret` | Cross-assembly-type |
| 23 | `resolve_role_works_for_ssu` | Cross-assembly-type |
| 24 | `registered_assembly_with_empty_rules_returns_default` | Edge case |
| 25 | `multiple_tribe_rules_iterate_correctly` | Edge case |
| 26 | `non_owner_cannot_register_gate` | Authorization (expected failure) |
| 27 | `non_owner_cannot_deregister_gate` | Authorization (expected failure) |
| 28 | `non_owner_cannot_add_rule` | Authorization (expected failure) |
| 29 | `non_owner_cannot_remove_rule` | Authorization (expected failure) |
| 30 | `non_owner_cannot_transfer_ownership` | Authorization (expected failure) |
| 31 | `old_owner_cannot_write_after_transfer` | Ownership transfer (expected failure) |
| 32 | `new_owner_can_write_after_transfer` | Ownership transfer |
| 33 | `set_policy_replaces_previous_rules` | Policy replacement |
| 34 | `character_rule_takes_precedence_over_tribe_when_first` | First-match semantics |

### security_status_tests -- 13 tests

| # | Test | Category |
|---|------|----------|
| 1 | `default_config_does_not_block_aggressors` | Default config |
| 2 | `default_config_has_empty_blocklist` | Default config |
| 3 | `add_to_blocklist_marks_character_blocklisted` | Blocklist |
| 4 | `remove_from_blocklist_clears_character` | Blocklist |
| 5 | `remove_absent_character_from_blocklist_is_noop` | Blocklist (edge case) |
| 6 | `multiple_characters_can_be_blocklisted_independently` | Blocklist |
| 7 | `aggressor_override_not_aggressor_aggressors_blocked_returns_true` | Aggressor override |
| 8 | `aggressor_override_is_aggressor_aggressors_blocked_returns_false` | Aggressor override |
| 9 | `aggressor_override_is_aggressor_aggressors_not_blocked_returns_true` | Aggressor override |
| 10 | `aggressor_override_blocklisted_not_aggressor_returns_false` | Aggressor override |
| 11 | `aggressor_override_blocklisted_and_aggressor_returns_false` | Aggressor override |
| 12 | `aggressor_override_npc_not_blocklisted_returns_true` | Aggressor override (edge case) |
| 13 | `set_block_aggressors_can_be_toggled_on_and_off` | Toggle |

### identity_resolver_tests -- 4 tests (integration)

| # | Test | Category |
|---|------|----------|
| 1 | `resolve_returns_correct_game_id_and_tribe_id` | Identity extraction |
| 2 | `char_game_id_accessor_matches_resolve` | Accessor consistency |
| 3 | `tribe_id_accessor_matches_resolve` | Accessor consistency |
| 4 | `two_characters_have_distinct_identities` | Multi-character |

### gate_extension_tests -- 7 tests (integration)

| # | Test | Category |
|---|------|----------|
| 1 | `authorize_on_gate_creates_config_with_correct_gate_id` | Setup |
| 2 | `request_permit_issues_permit_for_allowed_character` | Allow path |
| 3 | `request_permit_denied_for_deny_policy_character` | Deny path (expected failure) |
| 4 | `request_permit_denied_for_blocklisted_character` | Blocklist (expected failure) |
| 5 | `request_permit_denied_for_default_character` | Default path (expected failure) |
| 6 | `request_permit_wrong_source_gate_aborts` | Guard (expected failure) |
| 7 | `permit_is_valid_within_ttl_window` | TTL validation |

### turret_extension_tests -- 10 tests (integration)

| # | Test | Category |
|---|------|----------|
| 1 | `authorize_on_turret_creates_config_with_correct_turret_id` | Setup |
| 2 | `candidate_in_allow_policy_excluded_from_list` | Allow path |
| 3 | `candidate_in_deny_policy_receives_deny_weight` | Deny path |
| 4 | `candidate_default_role_preserves_original_weight` | Default pass-through |
| 5 | `candidate_same_tribe_non_aggressor_excluded_by_default` | Friendly-fire prevention |
| 6 | `blocklisted_candidate_receives_deny_weight` | Blocklist |
| 7 | `aggressor_with_block_aggressors_receives_deny_weight` | Aggressor override |
| 8 | `aggressor_without_block_aggressors_uses_normal_policy` | Aggressor bypass |
| 9 | `multiple_candidates_weighted_independently` | Multi-candidate |
| 10 | `wrong_turret_aborts` | Guard (expected failure) |

### ssu_extension_tests -- 10 tests (integration)

| # | Test | Category |
|---|------|----------|
| 1 | `authorize_on_ssu_creates_config_with_correct_ssu_id` | Setup |
| 2 | `withdraw_succeeds_for_allowed_character` | Withdraw allow |
| 3 | `withdraw_aborts_when_allow_withdraw_false` | Withdraw flag (expected failure) |
| 4 | `withdraw_denied_for_blocklisted_character` | Withdraw blocklist (expected failure) |
| 5 | `withdraw_denied_for_default_character_no_policies` | Withdraw default (expected failure) |
| 6 | `deposit_succeeds_for_allowed_character` | Deposit allow |
| 7 | `deposit_aborts_when_allow_deposit_false` | Deposit flag (expected failure) |
| 8 | `deposit_denied_for_blocklisted_character` | Deposit blocklist (expected failure) |
| 9 | `deposit_denied_by_policy_deny_rule` | Deposit deny (expected failure) |
| 10 | `deposit_with_wrong_ssu_aborts` | Guard (expected failure) |

---

## Summary

| Module | Tests | Type |
|--------|------:|------|
| `assembly_binding_tests` | 34 | Unit |
| `security_status_tests` | 13 | Unit |
| `identity_resolver_tests` | 4 | Integration |
| `gate_extension_tests` | 7 | Integration |
| `turret_extension_tests` | 10 | Integration |
| `ssu_extension_tests` | 10 | Integration |
| **Total** | **78** | |

All 47 unit tests run without external dependencies. The 31 integration tests require the world-contracts package (available via Docker or local checkout).
