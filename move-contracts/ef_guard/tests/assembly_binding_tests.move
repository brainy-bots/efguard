#[test_only]
module ef_guard::assembly_binding_tests {
    use ef_guard::assembly_binding;
    use ef_guard::condition_tribe;
    use ef_guard::condition_character;
    use ef_guard::condition_everyone;
    use std::unit_test::destroy;

    const CHAR_A: u64 = 42;
    const CHAR_B: u64 = 99;
    const TRIBE_X: u32 = 7;
    const TRIBE_Y: u32 = 8;
    const OTHER: address = @0xB;
    const GATE_ADDR:   address = @0xA713;
    const TURRET_ADDR: address = @0xB714;
    const SSU_ADDR:    address = @0xC715;

    // ── Constructor ──────────────────────────────────────────────────────────

    #[test]
    fun new_binding_owner_is_sender() {
        let mut ctx = tx_context::dummy();
        let binding = assembly_binding::new_binding(&mut ctx);
        assert!(assembly_binding::owner(&binding) == tx_context::sender(&ctx));
        destroy(binding);
    }

    #[test]
    fun new_binding_contains_no_assemblies() {
        let mut ctx = tx_context::dummy();
        let binding = assembly_binding::new_binding(&mut ctx);
        let fake_id = object::id_from_address(@0x1);
        assert!(!assembly_binding::contains_gate(&binding, fake_id));
        assert!(!assembly_binding::contains_turret(&binding, fake_id));
        assert!(!assembly_binding::contains_ssu(&binding, fake_id));
        destroy(binding);
    }

    // ── resolve_role -- basic cases ─────────────────────────────────────────

    #[test]
    fun resolve_role_tribe_allow() {
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);

        let tribe_cond = condition_tribe::new(TRIBE_X, &mut ctx);
        let tribe_cond_id = object::id(&tribe_cond);

        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);
        assembly_binding::set_policy(&mut binding, gate_id, vector[
            assembly_binding::rule(tribe_cond_id, assembly_binding::allow()),
        ], &ctx);

        let eval_ctx = assembly_binding::build_eval_context(&binding, gate_id, CHAR_A, TRIBE_X, @0x0);
        let proofs = vector[
            condition_tribe::verify(&tribe_cond, &eval_ctx),
        ];
        let decision = assembly_binding::resolve_role(&binding, gate_id, CHAR_A, &proofs);
        assert!(assembly_binding::is_allow(&decision));

        destroy(binding);
        destroy(tribe_cond);
    }

    #[test]
    fun resolve_role_tribe_deny() {
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);

        let tribe_cond = condition_tribe::new(TRIBE_X, &mut ctx);
        let tribe_cond_id = object::id(&tribe_cond);

        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);
        assembly_binding::set_policy(&mut binding, gate_id, vector[
            assembly_binding::rule(tribe_cond_id, assembly_binding::deny()),
        ], &ctx);

        let eval_ctx = assembly_binding::build_eval_context(&binding, gate_id, CHAR_A, TRIBE_X, @0x0);
        let proofs = vector[
            condition_tribe::verify(&tribe_cond, &eval_ctx),
        ];
        let decision = assembly_binding::resolve_role(&binding, gate_id, CHAR_A, &proofs);
        assert!(assembly_binding::is_deny(&decision));

        destroy(binding);
        destroy(tribe_cond);
    }

    #[test]
    fun resolve_role_no_match_returns_default() {
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);

        let tribe_cond = condition_tribe::new(TRIBE_X, &mut ctx);
        let tribe_cond_id = object::id(&tribe_cond);

        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);
        assembly_binding::set_policy(&mut binding, gate_id, vector[
            assembly_binding::rule(tribe_cond_id, assembly_binding::allow()),
        ], &ctx);

        // CHAR_B / TRIBE_Y don't match the tribe condition
        let eval_ctx = assembly_binding::build_eval_context(&binding, gate_id, CHAR_B, TRIBE_Y, @0x0);
        let proofs = vector[
            condition_tribe::verify(&tribe_cond, &eval_ctx),
        ];
        let decision = assembly_binding::resolve_role(&binding, gate_id, CHAR_B, &proofs);
        assert!(!assembly_binding::is_allow(&decision));
        assert!(!assembly_binding::is_deny(&decision));

        destroy(binding);
        destroy(tribe_cond);
    }

    #[test]
    fun resolve_role_unregistered_assembly_returns_default() {
        let mut ctx = tx_context::dummy();
        let binding  = assembly_binding::new_binding(&mut ctx);
        let ghost_id = object::id_from_address(@0xDEAD);

        let proofs = vector[];
        let decision = assembly_binding::resolve_role(&binding, ghost_id, CHAR_A, &proofs);
        assert!(!assembly_binding::is_allow(&decision));

        destroy(binding);
    }

    #[test]
    fun resolve_role_character_match() {
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);

        let char_cond = condition_character::new(CHAR_A, &mut ctx);
        let char_cond_id = object::id(&char_cond);
        let everyone_cond = condition_everyone::new(&mut ctx);
        let everyone_cond_id = object::id(&everyone_cond);

        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);
        assembly_binding::set_policy(&mut binding, gate_id, vector[
            assembly_binding::rule(char_cond_id, assembly_binding::allow()),
            assembly_binding::rule(everyone_cond_id, assembly_binding::deny()),
        ], &ctx);

        // CHAR_A matches character condition
        let eval_ctx_a = assembly_binding::build_eval_context(&binding, gate_id, CHAR_A, TRIBE_Y, @0x0);
        let proofs_a = vector[
            condition_character::verify(&char_cond, &eval_ctx_a),
            condition_everyone::verify(&everyone_cond, &eval_ctx_a),
        ];
        let decision_a = assembly_binding::resolve_role(&binding, gate_id, CHAR_A, &proofs_a);
        assert!(assembly_binding::is_allow(&decision_a));

        // CHAR_B does not match character condition, falls through to everyone
        let eval_ctx_b = assembly_binding::build_eval_context(&binding, gate_id, CHAR_B, TRIBE_Y, @0x0);
        let proofs_b = vector[
            condition_character::verify(&char_cond, &eval_ctx_b),
            condition_everyone::verify(&everyone_cond, &eval_ctx_b),
        ];
        let decision_b = assembly_binding::resolve_role(&binding, gate_id, CHAR_B, &proofs_b);
        assert!(assembly_binding::is_deny(&decision_b));

        destroy(binding);
        destroy(char_cond);
        destroy(everyone_cond);
    }

    #[test]
    fun resolve_role_everyone_match() {
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);

        let everyone_cond = condition_everyone::new(&mut ctx);
        let everyone_cond_id = object::id(&everyone_cond);

        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);
        assembly_binding::set_policy(&mut binding, gate_id, vector[
            assembly_binding::rule(everyone_cond_id, assembly_binding::allow()),
        ], &ctx);

        let eval_ctx = assembly_binding::build_eval_context(&binding, gate_id, CHAR_B, TRIBE_Y, @0x0);
        let proofs = vector[
            condition_everyone::verify(&everyone_cond, &eval_ctx),
        ];
        let decision = assembly_binding::resolve_role(&binding, gate_id, CHAR_B, &proofs);
        assert!(assembly_binding::is_allow(&decision));

        destroy(binding);
        destroy(everyone_cond);
    }

    // ── First match wins ─────────────────────────────────────────────────────

    #[test]
    fun resolve_role_first_rule_wins() {
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);

        let char_cond = condition_character::new(CHAR_A, &mut ctx);
        let char_cond_id = object::id(&char_cond);
        let everyone_cond = condition_everyone::new(&mut ctx);
        let everyone_cond_id = object::id(&everyone_cond);

        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);
        assembly_binding::set_policy(&mut binding, gate_id, vector[
            assembly_binding::rule(char_cond_id, assembly_binding::allow()),
            assembly_binding::rule(everyone_cond_id, assembly_binding::deny()),
        ], &ctx);

        // CHAR_A matches first rule -> Allow
        let eval_ctx_a = assembly_binding::build_eval_context(&binding, gate_id, CHAR_A, TRIBE_X, @0x0);
        let proofs_a = vector[
            condition_character::verify(&char_cond, &eval_ctx_a),
            condition_everyone::verify(&everyone_cond, &eval_ctx_a),
        ];
        let d1 = assembly_binding::resolve_role(&binding, gate_id, CHAR_A, &proofs_a);
        assert!(assembly_binding::is_allow(&d1));

        // CHAR_B skips first rule, matches Everyone -> Deny
        let eval_ctx_b = assembly_binding::build_eval_context(&binding, gate_id, CHAR_B, TRIBE_Y, @0x0);
        let proofs_b = vector[
            condition_character::verify(&char_cond, &eval_ctx_b),
            condition_everyone::verify(&everyone_cond, &eval_ctx_b),
        ];
        let d2 = assembly_binding::resolve_role(&binding, gate_id, CHAR_B, &proofs_b);
        assert!(assembly_binding::is_deny(&d2));

        destroy(binding);
        destroy(char_cond);
        destroy(everyone_cond);
    }

    // ── Per-assembly independence ─────────────────────────────────────────────

    #[test]
    fun different_assemblies_have_independent_policies() {
        let mut ctx = tx_context::dummy();
        let gate_a = object::id_from_address(GATE_ADDR);
        let gate_b = object::id_from_address(@0xB999);

        let tribe_cond = condition_tribe::new(TRIBE_X, &mut ctx);
        let tribe_cond_id = object::id(&tribe_cond);
        let everyone_cond = condition_everyone::new(&mut ctx);
        let everyone_cond_id = object::id(&everyone_cond);

        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut binding, gate_a, &ctx);
        assembly_binding::register_gate(&mut binding, gate_b, &ctx);

        assembly_binding::set_policy(&mut binding, gate_a, vector[
            assembly_binding::rule(tribe_cond_id, assembly_binding::allow()),
        ], &ctx);
        assembly_binding::set_policy(&mut binding, gate_b, vector[
            assembly_binding::rule(everyone_cond_id, assembly_binding::deny()),
        ], &ctx);

        let eval_ctx = assembly_binding::build_eval_context(&binding, gate_a, CHAR_A, TRIBE_X, @0x0);
        let proofs = vector[
            condition_tribe::verify(&tribe_cond, &eval_ctx),
            condition_everyone::verify(&everyone_cond, &eval_ctx),
        ];
        let da = assembly_binding::resolve_role(&binding, gate_a, CHAR_A, &proofs);
        assert!(assembly_binding::is_allow(&da));

        let db = assembly_binding::resolve_role(&binding, gate_b, CHAR_A, &proofs);
        assert!(assembly_binding::is_deny(&db));

        destroy(binding);
        destroy(tribe_cond);
        destroy(everyone_cond);
    }

    // ── Blocklist overrides rules ────────────────────────────────────────────

    #[test]
    fun blocklist_overrides_allow_rule() {
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);

        let everyone_cond = condition_everyone::new(&mut ctx);
        let everyone_cond_id = object::id(&everyone_cond);

        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);
        assembly_binding::set_policy(&mut binding, gate_id, vector[
            assembly_binding::rule(everyone_cond_id, assembly_binding::allow()),
        ], &ctx);
        assembly_binding::add_to_blocklist(&mut binding, CHAR_A, &ctx);

        let eval_ctx = assembly_binding::build_eval_context(&binding, gate_id, CHAR_A, TRIBE_X, @0x0);
        let proofs = vector[
            condition_everyone::verify(&everyone_cond, &eval_ctx),
        ];
        let decision = assembly_binding::resolve_role(&binding, gate_id, CHAR_A, &proofs);
        assert!(assembly_binding::is_deny(&decision));

        destroy(binding);
        destroy(everyone_cond);
    }

    #[test]
    fun blocklist_remove_restores_access() {
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);

        let everyone_cond = condition_everyone::new(&mut ctx);
        let everyone_cond_id = object::id(&everyone_cond);

        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);
        assembly_binding::set_policy(&mut binding, gate_id, vector[
            assembly_binding::rule(everyone_cond_id, assembly_binding::allow()),
        ], &ctx);
        assembly_binding::add_to_blocklist(&mut binding, CHAR_A, &ctx);

        let eval_ctx = assembly_binding::build_eval_context(&binding, gate_id, CHAR_A, TRIBE_X, @0x0);
        let proofs = vector[
            condition_everyone::verify(&everyone_cond, &eval_ctx),
        ];
        let denied = assembly_binding::resolve_role(&binding, gate_id, CHAR_A, &proofs);
        assert!(assembly_binding::is_deny(&denied));

        assembly_binding::remove_from_blocklist(&mut binding, CHAR_A, &ctx);

        let allowed = assembly_binding::resolve_role(&binding, gate_id, CHAR_A, &proofs);
        assert!(assembly_binding::is_allow(&allowed));

        destroy(binding);
        destroy(everyone_cond);
    }

    // ── add_rule / remove_rule ───────────────────────────────────────────────

    #[test]
    fun add_rule_appends_to_policy() {
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);

        let tribe_cond = condition_tribe::new(TRIBE_X, &mut ctx);
        let tribe_cond_id = object::id(&tribe_cond);
        let everyone_cond = condition_everyone::new(&mut ctx);
        let everyone_cond_id = object::id(&everyone_cond);

        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);

        assembly_binding::add_rule(&mut binding, gate_id, tribe_cond_id, assembly_binding::allow(), &ctx);
        assembly_binding::add_rule(&mut binding, gate_id, everyone_cond_id, assembly_binding::deny(), &ctx);

        let eval_ctx_a = assembly_binding::build_eval_context(&binding, gate_id, CHAR_A, TRIBE_X, @0x0);
        let proofs_a = vector[
            condition_tribe::verify(&tribe_cond, &eval_ctx_a),
            condition_everyone::verify(&everyone_cond, &eval_ctx_a),
        ];
        let d1 = assembly_binding::resolve_role(&binding, gate_id, CHAR_A, &proofs_a);
        assert!(assembly_binding::is_allow(&d1));

        let eval_ctx_b = assembly_binding::build_eval_context(&binding, gate_id, CHAR_B, TRIBE_Y, @0x0);
        let proofs_b = vector[
            condition_tribe::verify(&tribe_cond, &eval_ctx_b),
            condition_everyone::verify(&everyone_cond, &eval_ctx_b),
        ];
        let d2 = assembly_binding::resolve_role(&binding, gate_id, CHAR_B, &proofs_b);
        assert!(assembly_binding::is_deny(&d2));

        destroy(binding);
        destroy(tribe_cond);
        destroy(everyone_cond);
    }

    #[test]
    fun remove_rule_changes_policy() {
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);

        let tribe_cond = condition_tribe::new(TRIBE_X, &mut ctx);
        let tribe_cond_id = object::id(&tribe_cond);
        let everyone_cond = condition_everyone::new(&mut ctx);
        let everyone_cond_id = object::id(&everyone_cond);

        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);
        assembly_binding::set_policy(&mut binding, gate_id, vector[
            assembly_binding::rule(tribe_cond_id, assembly_binding::allow()),
            assembly_binding::rule(everyone_cond_id, assembly_binding::deny()),
        ], &ctx);

        // Remove tribe rule (index 0), now only Everyone->Deny remains
        assembly_binding::remove_rule(&mut binding, gate_id, 0, &ctx);

        let eval_ctx = assembly_binding::build_eval_context(&binding, gate_id, CHAR_A, TRIBE_X, @0x0);
        let proofs = vector[
            condition_tribe::verify(&tribe_cond, &eval_ctx),
            condition_everyone::verify(&everyone_cond, &eval_ctx),
        ];
        let decision = assembly_binding::resolve_role(&binding, gate_id, CHAR_A, &proofs);
        assert!(assembly_binding::is_deny(&decision));

        destroy(binding);
        destroy(tribe_cond);
        destroy(everyone_cond);
    }

    // ── Registration ─────────────────────────────────────────────────────────

    #[test]
    fun register_and_deregister_gate() {
        let mut ctx = tx_context::dummy();
        let mut binding = assembly_binding::new_binding(&mut ctx);
        let gate_id = object::id_from_address(GATE_ADDR);

        assembly_binding::register_gate(&mut binding, gate_id, &ctx);
        assert!(assembly_binding::contains_gate(&binding, gate_id));

        assembly_binding::deregister_gate(&mut binding, gate_id, &ctx);
        assert!(!assembly_binding::contains_gate(&binding, gate_id));

        destroy(binding);
    }

    #[test]
    #[expected_failure(abort_code = ef_guard::assembly_binding::EAssemblyAlreadyRegistered)]
    fun register_gate_twice_aborts() {
        let mut ctx = tx_context::dummy();
        let mut binding = assembly_binding::new_binding(&mut ctx);
        let gate_id = object::id_from_address(GATE_ADDR);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);
        destroy(binding);
    }

    #[test]
    #[expected_failure(abort_code = ef_guard::assembly_binding::EAssemblyNotRegistered)]
    fun set_policy_on_unregistered_assembly_aborts() {
        let mut ctx = tx_context::dummy();
        let mut binding = assembly_binding::new_binding(&mut ctx);
        let ghost_id = object::id_from_address(@0xDEAD);
        assembly_binding::set_policy(&mut binding, ghost_id, vector[], &ctx);
        destroy(binding);
    }

    #[test]
    fun deregister_drops_policy() {
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);

        let everyone_cond = condition_everyone::new(&mut ctx);
        let everyone_cond_id = object::id(&everyone_cond);

        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);
        assembly_binding::set_policy(&mut binding, gate_id, vector[
            assembly_binding::rule(everyone_cond_id, assembly_binding::allow()),
        ], &ctx);

        assembly_binding::deregister_gate(&mut binding, gate_id, &ctx);

        let eval_ctx = assembly_binding::build_eval_context(&binding, gate_id, CHAR_A, TRIBE_X, @0x0);
        let proofs = vector[
            condition_everyone::verify(&everyone_cond, &eval_ctx),
        ];
        let decision = assembly_binding::resolve_role(&binding, gate_id, CHAR_A, &proofs);
        assert!(!assembly_binding::is_allow(&decision));

        destroy(binding);
        destroy(everyone_cond);
    }

    // ── Ownership ────────────────────────────────────────────────────────────

    #[test]
    fun transfer_ownership_changes_owner() {
        let mut ctx = tx_context::dummy();
        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::transfer_ownership(&mut binding, OTHER, &ctx);
        assert!(assembly_binding::owner(&binding) == OTHER);
        destroy(binding);
    }

    #[test]
    #[expected_failure(abort_code = ef_guard::assembly_binding::ENotBindingOwner)]
    fun non_owner_cannot_set_policy() {
        let mut ctx = tx_context::dummy();
        let mut binding = assembly_binding::new_binding(&mut ctx);
        let gate_id = object::id_from_address(GATE_ADDR);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);

        let other_ctx = tx_context::new_from_hint(@0xB, 0, 1, 0, 0);
        assembly_binding::set_policy(&mut binding, gate_id, vector[], &other_ctx);
        destroy(binding);
    }

    #[test]
    #[expected_failure(abort_code = ef_guard::assembly_binding::ENotBindingOwner)]
    fun non_owner_cannot_blocklist() {
        let mut ctx = tx_context::dummy();
        let mut binding = assembly_binding::new_binding(&mut ctx);
        let other_ctx = tx_context::new_from_hint(@0xB, 0, 1, 0, 0);
        assembly_binding::add_to_blocklist(&mut binding, CHAR_A, &other_ctx);
        destroy(binding);
    }

    // ── Turret and SSU resolve ───────────────────────────────────────────────

    #[test]
    fun resolve_role_works_for_turret() {
        let mut ctx = tx_context::dummy();
        let turret_id = object::id_from_address(TURRET_ADDR);

        let tribe_cond = condition_tribe::new(TRIBE_X, &mut ctx);
        let tribe_cond_id = object::id(&tribe_cond);

        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_turret(&mut binding, turret_id, &ctx);
        assembly_binding::set_policy(&mut binding, turret_id, vector[
            assembly_binding::rule(tribe_cond_id, assembly_binding::allow()),
        ], &ctx);

        let eval_ctx = assembly_binding::build_eval_context(&binding, turret_id, CHAR_A, TRIBE_X, @0x0);
        let proofs = vector[
            condition_tribe::verify(&tribe_cond, &eval_ctx),
        ];
        let decision = assembly_binding::resolve_role(&binding, turret_id, CHAR_A, &proofs);
        assert!(assembly_binding::is_allow(&decision));

        destroy(binding);
        destroy(tribe_cond);
    }

    #[test]
    fun resolve_role_works_for_ssu() {
        let mut ctx = tx_context::dummy();
        let ssu_id = object::id_from_address(SSU_ADDR);

        let tribe_cond = condition_tribe::new(TRIBE_X, &mut ctx);
        let tribe_cond_id = object::id(&tribe_cond);

        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_ssu(&mut binding, ssu_id, &ctx);
        assembly_binding::set_policy(&mut binding, ssu_id, vector[
            assembly_binding::rule(tribe_cond_id, assembly_binding::deny()),
        ], &ctx);

        let eval_ctx = assembly_binding::build_eval_context(&binding, ssu_id, CHAR_A, TRIBE_X, @0x0);
        let proofs = vector[
            condition_tribe::verify(&tribe_cond, &eval_ctx),
        ];
        let decision = assembly_binding::resolve_role(&binding, ssu_id, CHAR_A, &proofs);
        assert!(assembly_binding::is_deny(&decision));

        destroy(binding);
        destroy(tribe_cond);
    }

    // ── Edge cases (audit recommendations) ──────────────────────────────────

    #[test]
    fun registered_assembly_with_empty_rules_returns_default() {
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);
        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);
        // Registered but no rules set -- should return Default (not Allow, not Deny)
        let proofs = vector[];
        let decision = assembly_binding::resolve_role(&binding, gate_id, CHAR_A, &proofs);
        assert!(!assembly_binding::is_allow(&decision));
        assert!(!assembly_binding::is_deny(&decision));
        destroy(binding);
    }

    #[test]
    fun multiple_tribe_rules_iterate_correctly() {
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);

        let tribe_x_cond = condition_tribe::new(TRIBE_X, &mut ctx);
        let tribe_x_cond_id = object::id(&tribe_x_cond);
        let tribe_y_cond = condition_tribe::new(TRIBE_Y, &mut ctx);
        let tribe_y_cond_id = object::id(&tribe_y_cond);
        let everyone_cond = condition_everyone::new(&mut ctx);
        let everyone_cond_id = object::id(&everyone_cond);

        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);
        assembly_binding::set_policy(&mut binding, gate_id, vector[
            assembly_binding::rule(tribe_x_cond_id, assembly_binding::allow()),
            assembly_binding::rule(tribe_y_cond_id, assembly_binding::deny()),
            assembly_binding::rule(everyone_cond_id, assembly_binding::deny()),
        ], &ctx);

        // Tribe X -> Allow (first rule)
        let eval_ctx_x = assembly_binding::build_eval_context(&binding, gate_id, CHAR_A, TRIBE_X, @0x0);
        let proofs_x = vector[
            condition_tribe::verify(&tribe_x_cond, &eval_ctx_x),
            condition_tribe::verify(&tribe_y_cond, &eval_ctx_x),
            condition_everyone::verify(&everyone_cond, &eval_ctx_x),
        ];
        assert!(assembly_binding::is_allow(
            &assembly_binding::resolve_role(&binding, gate_id, CHAR_A, &proofs_x),
        ));

        // Tribe Y -> Deny (second rule)
        let eval_ctx_y = assembly_binding::build_eval_context(&binding, gate_id, CHAR_B, TRIBE_Y, @0x0);
        let proofs_y = vector[
            condition_tribe::verify(&tribe_x_cond, &eval_ctx_y),
            condition_tribe::verify(&tribe_y_cond, &eval_ctx_y),
            condition_everyone::verify(&everyone_cond, &eval_ctx_y),
        ];
        assert!(assembly_binding::is_deny(
            &assembly_binding::resolve_role(&binding, gate_id, CHAR_B, &proofs_y),
        ));

        // Other tribe -> Deny (everyone catch-all)
        let eval_ctx_other = assembly_binding::build_eval_context(&binding, gate_id, CHAR_B, 999, @0x0);
        let proofs_other = vector[
            condition_tribe::verify(&tribe_x_cond, &eval_ctx_other),
            condition_tribe::verify(&tribe_y_cond, &eval_ctx_other),
            condition_everyone::verify(&everyone_cond, &eval_ctx_other),
        ];
        assert!(assembly_binding::is_deny(
            &assembly_binding::resolve_role(&binding, gate_id, CHAR_B, &proofs_other),
        ));

        destroy(binding);
        destroy(tribe_x_cond);
        destroy(tribe_y_cond);
        destroy(everyone_cond);
    }

    #[test]
    #[expected_failure(abort_code = ef_guard::assembly_binding::ENotBindingOwner)]
    fun non_owner_cannot_register_gate() {
        let mut ctx = tx_context::dummy();
        let mut binding = assembly_binding::new_binding(&mut ctx);
        let gate_id = object::id_from_address(GATE_ADDR);
        let other_ctx = tx_context::new_from_hint(@0xB, 0, 1, 0, 0);
        assembly_binding::register_gate(&mut binding, gate_id, &other_ctx);
        destroy(binding);
    }

    #[test]
    #[expected_failure(abort_code = ef_guard::assembly_binding::ENotBindingOwner)]
    fun non_owner_cannot_deregister_gate() {
        let mut ctx = tx_context::dummy();
        let mut binding = assembly_binding::new_binding(&mut ctx);
        let gate_id = object::id_from_address(GATE_ADDR);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);
        let other_ctx = tx_context::new_from_hint(@0xB, 0, 1, 0, 0);
        assembly_binding::deregister_gate(&mut binding, gate_id, &other_ctx);
        destroy(binding);
    }

    #[test]
    #[expected_failure(abort_code = ef_guard::assembly_binding::ENotBindingOwner)]
    fun non_owner_cannot_add_rule() {
        let mut ctx = tx_context::dummy();
        let mut binding = assembly_binding::new_binding(&mut ctx);
        let gate_id = object::id_from_address(GATE_ADDR);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);

        let everyone_cond = condition_everyone::new(&mut ctx);
        let everyone_cond_id = object::id(&everyone_cond);

        let other_ctx = tx_context::new_from_hint(@0xB, 0, 1, 0, 0);
        assembly_binding::add_rule(&mut binding, gate_id, everyone_cond_id, assembly_binding::allow(), &other_ctx);
        destroy(binding);
        destroy(everyone_cond);
    }

    #[test]
    #[expected_failure(abort_code = ef_guard::assembly_binding::ENotBindingOwner)]
    fun non_owner_cannot_remove_rule() {
        let mut ctx = tx_context::dummy();
        let mut binding = assembly_binding::new_binding(&mut ctx);
        let gate_id = object::id_from_address(GATE_ADDR);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);

        let everyone_cond = condition_everyone::new(&mut ctx);
        let everyone_cond_id = object::id(&everyone_cond);

        assembly_binding::add_rule(&mut binding, gate_id, everyone_cond_id, assembly_binding::allow(), &ctx);
        let other_ctx = tx_context::new_from_hint(@0xB, 0, 1, 0, 0);
        assembly_binding::remove_rule(&mut binding, gate_id, 0, &other_ctx);
        destroy(binding);
        destroy(everyone_cond);
    }

    #[test]
    #[expected_failure(abort_code = ef_guard::assembly_binding::ENotBindingOwner)]
    fun non_owner_cannot_transfer_ownership() {
        let mut ctx = tx_context::dummy();
        let mut binding = assembly_binding::new_binding(&mut ctx);
        let other_ctx = tx_context::new_from_hint(@0xB, 0, 1, 0, 0);
        assembly_binding::transfer_ownership(&mut binding, @0xC, &other_ctx);
        destroy(binding);
    }

    #[test]
    #[expected_failure(abort_code = ef_guard::assembly_binding::ENotBindingOwner)]
    fun old_owner_cannot_write_after_transfer() {
        let mut ctx = tx_context::dummy();
        let mut binding = assembly_binding::new_binding(&mut ctx);
        let gate_id = object::id_from_address(GATE_ADDR);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);
        assembly_binding::transfer_ownership(&mut binding, OTHER, &ctx);
        // Old owner tries to modify -- must fail
        assembly_binding::set_policy(&mut binding, gate_id, vector[], &ctx);
        destroy(binding);
    }

    #[test]
    fun new_owner_can_write_after_transfer() {
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);

        let everyone_cond = condition_everyone::new(&mut ctx);
        let everyone_cond_id = object::id(&everyone_cond);

        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);
        assembly_binding::transfer_ownership(&mut binding, OTHER, &ctx);
        let new_ctx = tx_context::new_from_hint(OTHER, 0, 1, 0, 0);
        assembly_binding::set_policy(&mut binding, gate_id, vector[
            assembly_binding::rule(everyone_cond_id, assembly_binding::allow()),
        ], &new_ctx);

        let eval_ctx = assembly_binding::build_eval_context(&binding, gate_id, CHAR_A, TRIBE_X, @0x0);
        let proofs = vector[
            condition_everyone::verify(&everyone_cond, &eval_ctx),
        ];
        let decision = assembly_binding::resolve_role(&binding, gate_id, CHAR_A, &proofs);
        assert!(assembly_binding::is_allow(&decision));

        destroy(binding);
        destroy(everyone_cond);
    }

    #[test]
    fun set_policy_replaces_previous_rules() {
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);

        let everyone_cond = condition_everyone::new(&mut ctx);
        let everyone_cond_id = object::id(&everyone_cond);

        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);

        // First policy: everyone allow
        assembly_binding::set_policy(&mut binding, gate_id, vector[
            assembly_binding::rule(everyone_cond_id, assembly_binding::allow()),
        ], &ctx);
        let eval_ctx = assembly_binding::build_eval_context(&binding, gate_id, CHAR_A, TRIBE_X, @0x0);
        let proofs = vector[
            condition_everyone::verify(&everyone_cond, &eval_ctx),
        ];
        assert!(assembly_binding::is_allow(
            &assembly_binding::resolve_role(&binding, gate_id, CHAR_A, &proofs),
        ));

        // Replace with everyone deny
        assembly_binding::set_policy(&mut binding, gate_id, vector[
            assembly_binding::rule(everyone_cond_id, assembly_binding::deny()),
        ], &ctx);
        assert!(assembly_binding::is_deny(
            &assembly_binding::resolve_role(&binding, gate_id, CHAR_A, &proofs),
        ));

        destroy(binding);
        destroy(everyone_cond);
    }

    #[test]
    fun character_rule_takes_precedence_over_tribe_when_first() {
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);

        let char_a_cond = condition_character::new(CHAR_A, &mut ctx);
        let char_a_cond_id = object::id(&char_a_cond);
        let tribe_cond = condition_tribe::new(TRIBE_X, &mut ctx);
        let tribe_cond_id = object::id(&tribe_cond);

        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);
        assembly_binding::set_policy(&mut binding, gate_id, vector[
            assembly_binding::rule(char_a_cond_id, assembly_binding::deny()),
            assembly_binding::rule(tribe_cond_id, assembly_binding::allow()),
        ], &ctx);

        // CHAR_A is in TRIBE_X but character rule is first -> Deny
        let eval_ctx_a = assembly_binding::build_eval_context(&binding, gate_id, CHAR_A, TRIBE_X, @0x0);
        let proofs_a = vector[
            condition_character::verify(&char_a_cond, &eval_ctx_a),
            condition_tribe::verify(&tribe_cond, &eval_ctx_a),
        ];
        assert!(assembly_binding::is_deny(
            &assembly_binding::resolve_role(&binding, gate_id, CHAR_A, &proofs_a),
        ));

        // CHAR_B in TRIBE_X -> tribe rule matches -> Allow
        let eval_ctx_b = assembly_binding::build_eval_context(&binding, gate_id, CHAR_B, TRIBE_X, @0x0);
        let proofs_b = vector[
            condition_character::verify(&char_a_cond, &eval_ctx_b),
            condition_tribe::verify(&tribe_cond, &eval_ctx_b),
        ];
        assert!(assembly_binding::is_allow(
            &assembly_binding::resolve_role(&binding, gate_id, CHAR_B, &proofs_b),
        ));

        destroy(binding);
        destroy(char_a_cond);
        destroy(tribe_cond);
    }

    // ── EvalContext tests ────────────────────────────────────────────────────

    #[test]
    fun eval_context_accessors() {
        let mut ctx = tx_context::dummy();
        let binding = assembly_binding::new_binding(&mut ctx);
        let gate_id = object::id_from_address(GATE_ADDR);

        let eval_ctx = assembly_binding::build_eval_context(
            &binding, gate_id, CHAR_A, TRIBE_X, @0xFACE,
        );

        assert!(assembly_binding::ctx_assembly_id(&eval_ctx) == gate_id);
        assert!(assembly_binding::ctx_char_game_id(&eval_ctx) == CHAR_A);
        assert!(assembly_binding::ctx_tribe_id(&eval_ctx) == TRIBE_X);
        assert!(assembly_binding::ctx_char_address(&eval_ctx) == @0xFACE);
        assert!(assembly_binding::ctx_binding_owner(&eval_ctx) == tx_context::sender(&ctx));

        destroy(binding);
    }

    // ── Blocklist overrides condition proofs ─────────────────────────────────

    #[test]
    fun blocklist_overrides_condition_proofs() {
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);

        let tribe_cond = condition_tribe::new(TRIBE_X, &mut ctx);
        let tribe_cond_id = object::id(&tribe_cond);

        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);
        assembly_binding::set_policy(&mut binding, gate_id, vector[
            assembly_binding::rule(tribe_cond_id, assembly_binding::allow()),
        ], &ctx);
        assembly_binding::add_to_blocklist(&mut binding, CHAR_A, &ctx);

        let eval_ctx = assembly_binding::build_eval_context(&binding, gate_id, CHAR_A, TRIBE_X, @0x0);
        let proofs = vector[condition_tribe::verify(&tribe_cond, &eval_ctx)];
        let decision = assembly_binding::resolve_role(
            &binding, gate_id, CHAR_A, &proofs,
        );
        // Blocklist wins even with passing condition
        assert!(assembly_binding::is_deny(&decision));

        destroy(binding);
        destroy(tribe_cond);
    }

    // ── No proofs means no rules match ──────────────────────────────────────

    #[test]
    fun resolve_role_with_empty_proofs_returns_default() {
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);

        let tribe_cond = condition_tribe::new(TRIBE_X, &mut ctx);
        let tribe_cond_id = object::id(&tribe_cond);

        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);
        assembly_binding::set_policy(&mut binding, gate_id, vector[
            assembly_binding::rule(tribe_cond_id, assembly_binding::allow()),
        ], &ctx);

        // No proofs at all -> no rule can match -> Default
        let empty_proofs = vector[];
        let decision = assembly_binding::resolve_role(
            &binding, gate_id, CHAR_A, &empty_proofs,
        );
        assert!(!assembly_binding::is_allow(&decision));
        assert!(!assembly_binding::is_deny(&decision));

        destroy(binding);
        destroy(tribe_cond);
    }

    // ── Mixed condition types ───────────────────────────────────────────────

    #[test]
    fun mixed_condition_types() {
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);

        let char_a_cond = condition_character::new(CHAR_A, &mut ctx);
        let char_a_cond_id = object::id(&char_a_cond);
        let tribe_x_cond = condition_tribe::new(TRIBE_X, &mut ctx);
        let tribe_x_cond_id = object::id(&tribe_x_cond);
        let everyone_cond = condition_everyone::new(&mut ctx);
        let everyone_cond_id = object::id(&everyone_cond);

        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);

        // Rule 1: Character A -> Allow (VIP)
        // Rule 2: Tribe X -> Allow
        // Rule 3: Everyone -> Deny
        assembly_binding::set_policy(&mut binding, gate_id, vector[
            assembly_binding::rule(char_a_cond_id, assembly_binding::allow()),
            assembly_binding::rule(tribe_x_cond_id, assembly_binding::allow()),
            assembly_binding::rule(everyone_cond_id, assembly_binding::deny()),
        ], &ctx);

        // CHAR_A (any tribe) -> matches rule 1 -> Allow
        let eval_ctx_a = assembly_binding::build_eval_context(&binding, gate_id, CHAR_A, TRIBE_Y, @0x0);
        let proofs_a = vector[
            condition_character::verify(&char_a_cond, &eval_ctx_a),
            condition_tribe::verify(&tribe_x_cond, &eval_ctx_a),
            condition_everyone::verify(&everyone_cond, &eval_ctx_a),
        ];
        assert!(assembly_binding::is_allow(
            &assembly_binding::resolve_role(&binding, gate_id, CHAR_A, &proofs_a),
        ));

        // CHAR_B in TRIBE_X with proofs -> matches rule 2 -> Allow
        let eval_ctx_bx = assembly_binding::build_eval_context(&binding, gate_id, CHAR_B, TRIBE_X, @0x0);
        let proofs_bx = vector[
            condition_character::verify(&char_a_cond, &eval_ctx_bx),
            condition_tribe::verify(&tribe_x_cond, &eval_ctx_bx),
            condition_everyone::verify(&everyone_cond, &eval_ctx_bx),
        ];
        assert!(assembly_binding::is_allow(
            &assembly_binding::resolve_role(&binding, gate_id, CHAR_B, &proofs_bx),
        ));

        // CHAR_B in TRIBE_X without proofs -> no rules match -> Default
        let no_proofs = vector[];
        assert!(!assembly_binding::is_allow(
            &assembly_binding::resolve_role(&binding, gate_id, CHAR_B, &no_proofs),
        ));

        // CHAR_B in TRIBE_Y -> doesn't match rule 1 or 2 -> rule 3 -> Deny
        let eval_ctx_by = assembly_binding::build_eval_context(&binding, gate_id, CHAR_B, TRIBE_Y, @0x0);
        let proofs_by = vector[
            condition_character::verify(&char_a_cond, &eval_ctx_by),
            condition_tribe::verify(&tribe_x_cond, &eval_ctx_by),
            condition_everyone::verify(&everyone_cond, &eval_ctx_by),
        ];
        assert!(assembly_binding::is_deny(
            &assembly_binding::resolve_role(&binding, gate_id, CHAR_B, &proofs_by),
        ));

        destroy(binding);
        destroy(char_a_cond);
        destroy(tribe_x_cond);
        destroy(everyone_cond);
    }
}
