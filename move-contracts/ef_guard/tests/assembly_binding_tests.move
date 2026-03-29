#[test_only]
module ef_guard::assembly_binding_tests {
    use ef_guard::assembly_binding;
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

    // ── resolve_role — basic cases ───────────────────────────────────────────

    #[test]
    fun resolve_role_tribe_allow() {
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);
        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);
        assembly_binding::set_policy(&mut binding, gate_id, vector[
            assembly_binding::rule(assembly_binding::tribe(TRIBE_X), assembly_binding::allow()),
        ], &ctx);

        let decision = assembly_binding::resolve_role(&binding, gate_id, CHAR_A, TRIBE_X);
        assert!(assembly_binding::is_allow(&decision));

        destroy(binding);
    }

    #[test]
    fun resolve_role_tribe_deny() {
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);
        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);
        assembly_binding::set_policy(&mut binding, gate_id, vector[
            assembly_binding::rule(assembly_binding::tribe(TRIBE_X), assembly_binding::deny()),
        ], &ctx);

        let decision = assembly_binding::resolve_role(&binding, gate_id, CHAR_A, TRIBE_X);
        assert!(assembly_binding::is_deny(&decision));

        destroy(binding);
    }

    #[test]
    fun resolve_role_no_match_returns_default() {
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);
        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);
        assembly_binding::set_policy(&mut binding, gate_id, vector[
            assembly_binding::rule(assembly_binding::tribe(TRIBE_X), assembly_binding::allow()),
        ], &ctx);

        // CHAR_B / TRIBE_Y don't match
        let decision = assembly_binding::resolve_role(&binding, gate_id, CHAR_B, TRIBE_Y);
        assert!(!assembly_binding::is_allow(&decision));
        assert!(!assembly_binding::is_deny(&decision));

        destroy(binding);
    }

    #[test]
    fun resolve_role_unregistered_assembly_returns_default() {
        let mut ctx = tx_context::dummy();
        let binding  = assembly_binding::new_binding(&mut ctx);
        let ghost_id = object::id_from_address(@0xDEAD);

        let decision = assembly_binding::resolve_role(&binding, ghost_id, CHAR_A, TRIBE_X);
        assert!(!assembly_binding::is_allow(&decision));

        destroy(binding);
    }

    #[test]
    fun resolve_role_character_match() {
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);
        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);
        assembly_binding::set_policy(&mut binding, gate_id, vector[
            assembly_binding::rule(assembly_binding::character(CHAR_A), assembly_binding::allow()),
            assembly_binding::rule(assembly_binding::everyone(), assembly_binding::deny()),
        ], &ctx);

        let decision_a = assembly_binding::resolve_role(&binding, gate_id, CHAR_A, TRIBE_Y);
        assert!(assembly_binding::is_allow(&decision_a));

        let decision_b = assembly_binding::resolve_role(&binding, gate_id, CHAR_B, TRIBE_Y);
        assert!(assembly_binding::is_deny(&decision_b));

        destroy(binding);
    }

    #[test]
    fun resolve_role_everyone_match() {
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);
        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);
        assembly_binding::set_policy(&mut binding, gate_id, vector[
            assembly_binding::rule(assembly_binding::everyone(), assembly_binding::allow()),
        ], &ctx);

        let decision = assembly_binding::resolve_role(&binding, gate_id, CHAR_B, TRIBE_Y);
        assert!(assembly_binding::is_allow(&decision));

        destroy(binding);
    }

    // ── First match wins ─────────────────────────────────────────────────────

    #[test]
    fun resolve_role_first_rule_wins() {
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);
        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);
        assembly_binding::set_policy(&mut binding, gate_id, vector[
            assembly_binding::rule(assembly_binding::character(CHAR_A), assembly_binding::allow()),
            assembly_binding::rule(assembly_binding::everyone(), assembly_binding::deny()),
        ], &ctx);

        // CHAR_A matches first rule → Allow
        let d1 = assembly_binding::resolve_role(&binding, gate_id, CHAR_A, TRIBE_X);
        assert!(assembly_binding::is_allow(&d1));

        // CHAR_B skips first rule, matches Everyone → Deny
        let d2 = assembly_binding::resolve_role(&binding, gate_id, CHAR_B, TRIBE_Y);
        assert!(assembly_binding::is_deny(&d2));

        destroy(binding);
    }

    // ── Per-assembly independence ─────────────────────────────────────────────

    #[test]
    fun different_assemblies_have_independent_policies() {
        let mut ctx = tx_context::dummy();
        let gate_a = object::id_from_address(GATE_ADDR);
        let gate_b = object::id_from_address(@0xB999);

        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut binding, gate_a, &ctx);
        assembly_binding::register_gate(&mut binding, gate_b, &ctx);

        assembly_binding::set_policy(&mut binding, gate_a, vector[
            assembly_binding::rule(assembly_binding::tribe(TRIBE_X), assembly_binding::allow()),
        ], &ctx);
        assembly_binding::set_policy(&mut binding, gate_b, vector[
            assembly_binding::rule(assembly_binding::everyone(), assembly_binding::deny()),
        ], &ctx);

        let da = assembly_binding::resolve_role(&binding, gate_a, CHAR_A, TRIBE_X);
        assert!(assembly_binding::is_allow(&da));

        let db = assembly_binding::resolve_role(&binding, gate_b, CHAR_A, TRIBE_X);
        assert!(assembly_binding::is_deny(&db));

        destroy(binding);
    }

    // ── Blocklist overrides rules ────────────────────────────────────────────

    #[test]
    fun blocklist_overrides_allow_rule() {
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);
        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);
        assembly_binding::set_policy(&mut binding, gate_id, vector[
            assembly_binding::rule(assembly_binding::everyone(), assembly_binding::allow()),
        ], &ctx);
        assembly_binding::add_to_blocklist(&mut binding, CHAR_A, &ctx);

        let decision = assembly_binding::resolve_role(&binding, gate_id, CHAR_A, TRIBE_X);
        assert!(assembly_binding::is_deny(&decision));

        destroy(binding);
    }

    #[test]
    fun blocklist_remove_restores_access() {
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);
        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);
        assembly_binding::set_policy(&mut binding, gate_id, vector[
            assembly_binding::rule(assembly_binding::everyone(), assembly_binding::allow()),
        ], &ctx);
        assembly_binding::add_to_blocklist(&mut binding, CHAR_A, &ctx);

        let denied = assembly_binding::resolve_role(&binding, gate_id, CHAR_A, TRIBE_X);
        assert!(assembly_binding::is_deny(&denied));

        assembly_binding::remove_from_blocklist(&mut binding, CHAR_A, &ctx);

        let allowed = assembly_binding::resolve_role(&binding, gate_id, CHAR_A, TRIBE_X);
        assert!(assembly_binding::is_allow(&allowed));

        destroy(binding);
    }

    // ── add_rule / remove_rule ───────────────────────────────────────────────

    #[test]
    fun add_rule_appends_to_policy() {
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);
        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);

        assembly_binding::add_rule(&mut binding, gate_id, assembly_binding::tribe(TRIBE_X), assembly_binding::allow(), &ctx);
        assembly_binding::add_rule(&mut binding, gate_id, assembly_binding::everyone(), assembly_binding::deny(), &ctx);

        let d1 = assembly_binding::resolve_role(&binding, gate_id, CHAR_A, TRIBE_X);
        assert!(assembly_binding::is_allow(&d1));

        let d2 = assembly_binding::resolve_role(&binding, gate_id, CHAR_B, TRIBE_Y);
        assert!(assembly_binding::is_deny(&d2));

        destroy(binding);
    }

    #[test]
    fun remove_rule_changes_policy() {
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);
        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);
        assembly_binding::set_policy(&mut binding, gate_id, vector[
            assembly_binding::rule(assembly_binding::tribe(TRIBE_X), assembly_binding::allow()),
            assembly_binding::rule(assembly_binding::everyone(), assembly_binding::deny()),
        ], &ctx);

        // Remove tribe rule (index 0), now only Everyone→Deny remains
        assembly_binding::remove_rule(&mut binding, gate_id, 0, &ctx);

        let decision = assembly_binding::resolve_role(&binding, gate_id, CHAR_A, TRIBE_X);
        assert!(assembly_binding::is_deny(&decision));

        destroy(binding);
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
        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);
        assembly_binding::set_policy(&mut binding, gate_id, vector[
            assembly_binding::rule(assembly_binding::everyone(), assembly_binding::allow()),
        ], &ctx);

        assembly_binding::deregister_gate(&mut binding, gate_id, &ctx);

        let decision = assembly_binding::resolve_role(&binding, gate_id, CHAR_A, TRIBE_X);
        assert!(!assembly_binding::is_allow(&decision));

        destroy(binding);
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
        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_turret(&mut binding, turret_id, &ctx);
        assembly_binding::set_policy(&mut binding, turret_id, vector[
            assembly_binding::rule(assembly_binding::tribe(TRIBE_X), assembly_binding::allow()),
        ], &ctx);

        let decision = assembly_binding::resolve_role(&binding, turret_id, CHAR_A, TRIBE_X);
        assert!(assembly_binding::is_allow(&decision));

        destroy(binding);
    }

    #[test]
    fun resolve_role_works_for_ssu() {
        let mut ctx = tx_context::dummy();
        let ssu_id = object::id_from_address(SSU_ADDR);
        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_ssu(&mut binding, ssu_id, &ctx);
        assembly_binding::set_policy(&mut binding, ssu_id, vector[
            assembly_binding::rule(assembly_binding::tribe(TRIBE_X), assembly_binding::deny()),
        ], &ctx);

        let decision = assembly_binding::resolve_role(&binding, ssu_id, CHAR_A, TRIBE_X);
        assert!(assembly_binding::is_deny(&decision));

        destroy(binding);
    }

    // ── Edge cases (audit recommendations) ──────────────────────────────────

    #[test]
    fun registered_assembly_with_empty_rules_returns_default() {
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);
        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);
        // Registered but no rules set — should return Default (not Allow, not Deny)
        let decision = assembly_binding::resolve_role(&binding, gate_id, CHAR_A, TRIBE_X);
        assert!(!assembly_binding::is_allow(&decision));
        assert!(!assembly_binding::is_deny(&decision));
        destroy(binding);
    }

    #[test]
    fun multiple_tribe_rules_iterate_correctly() {
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);
        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);
        assembly_binding::set_policy(&mut binding, gate_id, vector[
            assembly_binding::rule(assembly_binding::tribe(TRIBE_X), assembly_binding::allow()),
            assembly_binding::rule(assembly_binding::tribe(TRIBE_Y), assembly_binding::deny()),
            assembly_binding::rule(assembly_binding::everyone(), assembly_binding::deny()),
        ], &ctx);

        // Tribe X → Allow (first rule)
        assert!(assembly_binding::is_allow(
            &assembly_binding::resolve_role(&binding, gate_id, CHAR_A, TRIBE_X),
        ));
        // Tribe Y → Deny (second rule)
        assert!(assembly_binding::is_deny(
            &assembly_binding::resolve_role(&binding, gate_id, CHAR_B, TRIBE_Y),
        ));
        // Other tribe → Deny (everyone catch-all)
        assert!(assembly_binding::is_deny(
            &assembly_binding::resolve_role(&binding, gate_id, CHAR_B, 999),
        ));
        destroy(binding);
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
        let other_ctx = tx_context::new_from_hint(@0xB, 0, 1, 0, 0);
        assembly_binding::add_rule(&mut binding, gate_id, assembly_binding::everyone(), assembly_binding::allow(), &other_ctx);
        destroy(binding);
    }

    #[test]
    #[expected_failure(abort_code = ef_guard::assembly_binding::ENotBindingOwner)]
    fun non_owner_cannot_remove_rule() {
        let mut ctx = tx_context::dummy();
        let mut binding = assembly_binding::new_binding(&mut ctx);
        let gate_id = object::id_from_address(GATE_ADDR);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);
        assembly_binding::add_rule(&mut binding, gate_id, assembly_binding::everyone(), assembly_binding::allow(), &ctx);
        let other_ctx = tx_context::new_from_hint(@0xB, 0, 1, 0, 0);
        assembly_binding::remove_rule(&mut binding, gate_id, 0, &other_ctx);
        destroy(binding);
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
        // Old owner tries to modify — must fail
        assembly_binding::set_policy(&mut binding, gate_id, vector[], &ctx);
        destroy(binding);
    }

    #[test]
    fun new_owner_can_write_after_transfer() {
        let mut ctx = tx_context::dummy();
        let mut binding = assembly_binding::new_binding(&mut ctx);
        let gate_id = object::id_from_address(GATE_ADDR);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);
        assembly_binding::transfer_ownership(&mut binding, OTHER, &ctx);
        let new_ctx = tx_context::new_from_hint(OTHER, 0, 1, 0, 0);
        assembly_binding::set_policy(&mut binding, gate_id, vector[
            assembly_binding::rule(assembly_binding::everyone(), assembly_binding::allow()),
        ], &new_ctx);
        let decision = assembly_binding::resolve_role(&binding, gate_id, CHAR_A, TRIBE_X);
        assert!(assembly_binding::is_allow(&decision));
        destroy(binding);
    }

    #[test]
    fun set_policy_replaces_previous_rules() {
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);
        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);

        // First policy: everyone allow
        assembly_binding::set_policy(&mut binding, gate_id, vector[
            assembly_binding::rule(assembly_binding::everyone(), assembly_binding::allow()),
        ], &ctx);
        assert!(assembly_binding::is_allow(
            &assembly_binding::resolve_role(&binding, gate_id, CHAR_A, TRIBE_X),
        ));

        // Replace with everyone deny
        assembly_binding::set_policy(&mut binding, gate_id, vector[
            assembly_binding::rule(assembly_binding::everyone(), assembly_binding::deny()),
        ], &ctx);
        assert!(assembly_binding::is_deny(
            &assembly_binding::resolve_role(&binding, gate_id, CHAR_A, TRIBE_X),
        ));

        destroy(binding);
    }

    #[test]
    fun character_rule_takes_precedence_over_tribe_when_first() {
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);
        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);
        assembly_binding::set_policy(&mut binding, gate_id, vector[
            assembly_binding::rule(assembly_binding::character(CHAR_A), assembly_binding::deny()),
            assembly_binding::rule(assembly_binding::tribe(TRIBE_X), assembly_binding::allow()),
        ], &ctx);

        // CHAR_A is in TRIBE_X but character rule is first → Deny
        assert!(assembly_binding::is_deny(
            &assembly_binding::resolve_role(&binding, gate_id, CHAR_A, TRIBE_X),
        ));
        // CHAR_B in TRIBE_X → tribe rule matches → Allow
        assert!(assembly_binding::is_allow(
            &assembly_binding::resolve_role(&binding, gate_id, CHAR_B, TRIBE_X),
        ));

        destroy(binding);
    }
}
