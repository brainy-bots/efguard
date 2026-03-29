#[test_only]
#[allow(unused_use, unused_let_mut, unused_trailing_semi)]
module ef_guard::gate_extension_tests {
    use ef_guard::{assembly_binding, gate_extension, condition_character, condition_everyone};
    use std::{bcs, string::utf8, unit_test::destroy};
    use sui::{clock, test_scenario as ts};
    use world::{
        access::{AdminACL, OwnerCap, ServerAddressRegistry},
        character::{Self, Character},
        energy::EnergyConfig,
        gate::{Self, Gate, GateConfig, JumpPermit},
        location,
        network_node::{Self, NetworkNode},
        object_registry::ObjectRegistry,
        test_helpers::{Self, admin, governor, server_admin, tenant, user_a},
    };

    // Character constants
    const CHAR_A_ITEM_ID: u32 = 42;
    const CHAR_A_GAME_ID: u64 = 42;
    const TRIBE_X: u32 = 7;

    // Gate / NWN constants
    const GATE_TYPE_ID: u64 = 8888; // matches ASSEMBLY_TYPE_1 in test_helpers
    const GATE_ITEM_ID_1: u64 = 7001;
    const GATE_ITEM_ID_2: u64 = 7002;
    const NWN_TYPE_ID: u64 = 111000;
    const NWN_ITEM_ID: u64 = 5000;
    const FUEL_MAX_CAPACITY: u64 = 1000;
    const FUEL_BURN_RATE_IN_MS: u64 = 3_600_000;
    const MAX_PRODUCTION: u64 = 100;
    const FUEL_TYPE_ID: u64 = 1;
    const FUEL_VOLUME: u64 = 10;
    const MAX_GATE_DISTANCE: u64 = 1_000_000_000;

    const PERMIT_TTL_MS: u64 = 60_000;

    // ── Setup helpers ─────────────────────────────────────────────────────────

    fun setup(ts: &mut ts::Scenario) {
        test_helpers::setup_world(ts);
        test_helpers::configure_fuel(ts);
        test_helpers::configure_assembly_energy(ts);
        test_helpers::register_server_address(ts);

        // GateConfig shared object required by gate::link_gates / issue_jump_permit
        ts::next_tx(ts, governor());
        gate::init_for_testing(ts.ctx());

        // Configure max distance so gate linking succeeds
        ts::next_tx(ts, admin());
        {
            let admin_acl = ts::take_shared<AdminACL>(ts);
            let mut gate_config = ts::take_shared<GateConfig>(ts);
            gate::set_max_distance(&mut gate_config, &admin_acl, GATE_TYPE_ID, MAX_GATE_DISTANCE, ts.ctx());
            ts::return_shared(gate_config);
            ts::return_shared(admin_acl);
        };
    }

    fun create_character_a(ts: &mut ts::Scenario): ID {
        ts::next_tx(ts, admin());
        let admin_acl = ts::take_shared<AdminACL>(ts);
        let mut registry = ts::take_shared<ObjectRegistry>(ts);
        let character = character::create_character(
            &mut registry, &admin_acl,
            CHAR_A_ITEM_ID, tenant(), TRIBE_X, user_a(), utf8(b"char a"), ts.ctx(),
        );
        let character_id = object::id(&character);
        character.share_character(&admin_acl, ts.ctx());
        ts::return_shared(registry);
        ts::return_shared(admin_acl);
        character_id
    }

    fun create_nwn(ts: &mut ts::Scenario, char_id: ID): ID {
        ts::next_tx(ts, admin());
        let admin_acl = ts::take_shared<AdminACL>(ts);
        let mut registry = ts::take_shared<ObjectRegistry>(ts);
        let character = ts::take_shared_by_id<Character>(ts, char_id);
        let nwn = network_node::anchor(
            &mut registry, &character, &admin_acl,
            NWN_ITEM_ID, NWN_TYPE_ID,
            test_helpers::get_verified_location_hash(),
            FUEL_MAX_CAPACITY, FUEL_BURN_RATE_IN_MS, MAX_PRODUCTION, ts.ctx(),
        );
        let nwn_id = object::id(&nwn);
        nwn.share_network_node(&admin_acl, ts.ctx());
        ts::return_shared(character);
        ts::return_shared(registry);
        ts::return_shared(admin_acl);
        nwn_id
    }

    fun create_gate_obj(ts: &mut ts::Scenario, char_id: ID, nwn_id: ID, item_id: u64): ID {
        ts::next_tx(ts, admin());
        let admin_acl = ts::take_shared<AdminACL>(ts);
        let mut registry = ts::take_shared<ObjectRegistry>(ts);
        let mut nwn = ts::take_shared_by_id<NetworkNode>(ts, nwn_id);
        let character = ts::take_shared_by_id<Character>(ts, char_id);
        let gate_obj = gate::anchor(
            &mut registry, &mut nwn, &character, &admin_acl,
            item_id, GATE_TYPE_ID,
            test_helpers::get_verified_location_hash(), ts.ctx(),
        );
        let gate_id = object::id(&gate_obj);
        gate_obj.share_gate(&admin_acl, ts.ctx());
        ts::return_shared(character);
        ts::return_shared(nwn);
        ts::return_shared(registry);
        ts::return_shared(admin_acl);
        gate_id
    }

    fun bring_nwn_online(ts: &mut ts::Scenario, char_id: ID, nwn_id: ID) {
        ts::next_tx(ts, user_a());
        let mut character = ts::take_shared_by_id<Character>(ts, char_id);
        let cap_id = {
            let nwn = ts::take_shared_by_id<NetworkNode>(ts, nwn_id);
            let id = nwn.owner_cap_id();
            ts::return_shared(nwn);
            id
        };
        let (cap, receipt) = character.borrow_owner_cap<NetworkNode>(
            ts::receiving_ticket_by_id<OwnerCap<NetworkNode>>(cap_id), ts.ctx(),
        );
        let clock = clock::create_for_testing(ts.ctx());

        ts::next_tx(ts, user_a());
        {
            let mut nwn = ts::take_shared_by_id<NetworkNode>(ts, nwn_id);
            nwn.deposit_fuel_test(&cap, FUEL_TYPE_ID, FUEL_VOLUME, 10, &clock);
            nwn.online(&cap, &clock);
            ts::return_shared(nwn);
        };

        clock.destroy_for_testing();
        character.return_owner_cap(cap, receipt);
        ts::return_shared(character);
    }

    /// Links gate_a <-> gate_b using the signed proof from test_helpers, then brings both online.
    /// Both gates must be owned by the same character (char_id).
    fun link_and_online_gates(
        ts: &mut ts::Scenario,
        char_id: ID,
        nwn_id: ID,
        gate_a_id: ID,
        gate_b_id: ID,
    ) {
        ts::next_tx(ts, user_a());
        let mut character = ts::take_shared_by_id<Character>(ts, char_id);

        let cap_a_id = {
            let g = ts::take_shared_by_id<Gate>(ts, gate_a_id);
            let id = g.owner_cap_id();
            ts::return_shared(g);
            id
        };
        let cap_b_id = {
            let g = ts::take_shared_by_id<Gate>(ts, gate_b_id);
            let id = g.owner_cap_id();
            ts::return_shared(g);
            id
        };

        let (cap_a, receipt_a) = character.borrow_owner_cap<Gate>(
            ts::receiving_ticket_by_id<OwnerCap<Gate>>(cap_a_id), ts.ctx(),
        );
        let (cap_b, receipt_b) = character.borrow_owner_cap<Gate>(
            ts::receiving_ticket_by_id<OwnerCap<Gate>>(cap_b_id), ts.ctx(),
        );

        let clock = clock::create_for_testing(ts.ctx());
        let proof = test_helpers::construct_location_proof(test_helpers::get_verified_location_hash());
        let proof_bytes = bcs::to_bytes(&proof);

        ts::next_tx(ts, user_a());
        {
            let mut gate_a = ts::take_shared_by_id<Gate>(ts, gate_a_id);
            let mut gate_b = ts::take_shared_by_id<Gate>(ts, gate_b_id);
            let mut nwn = ts::take_shared_by_id<NetworkNode>(ts, nwn_id);
            let energy_config = ts::take_shared<EnergyConfig>(ts);
            let gate_config = ts::take_shared<GateConfig>(ts);
            let server_registry = ts::take_shared<ServerAddressRegistry>(ts);
            let admin_acl = ts::take_shared<AdminACL>(ts);

            gate_a.link_gates(
                &mut gate_b, &gate_config, &server_registry, &admin_acl,
                &cap_a, &cap_b, proof_bytes, &clock, ts.ctx(),
            );
            gate_a.online(&mut nwn, &energy_config, &cap_a);
            gate_b.online(&mut nwn, &energy_config, &cap_b);

            ts::return_shared(gate_a);
            ts::return_shared(gate_b);
            ts::return_shared(nwn);
            ts::return_shared(energy_config);
            ts::return_shared(gate_config);
            ts::return_shared(server_registry);
            ts::return_shared(admin_acl);
        };

        clock.destroy_for_testing();
        character.return_owner_cap(cap_a, receipt_a);
        character.return_owner_cap(cap_b, receipt_b);
        ts::return_shared(character);
    }

    /// Authorizes EfGuardGateAuth on a gate and shares the GateExtensionConfig. Returns config ID.
    fun authorize_ef_guard_gate(ts: &mut ts::Scenario, char_id: ID, gate_id: ID): ID {
        ts::next_tx(ts, user_a());
        let mut gate_obj = ts::take_shared_by_id<Gate>(ts, gate_id);
        let mut character = ts::take_shared_by_id<Character>(ts, char_id);
        let cap_id = gate_obj.owner_cap_id();
        let (cap, receipt) = character.borrow_owner_cap<Gate>(
            ts::receiving_ticket_by_id<OwnerCap<Gate>>(cap_id), ts.ctx(),
        );
        let config = gate_extension::authorize_on_gate(&mut gate_obj, &cap, PERMIT_TTL_MS, ts.ctx());
        let config_id = object::id(&config);
        gate_extension::share_config(config);
        character.return_owner_cap(cap, receipt);
        ts::return_shared(gate_obj);
        ts::return_shared(character);
        config_id
    }

    // ── Condition + Policy helpers ────────────────────────────────────────────

    /// Create a character condition for CHAR_A, share it, return its ID.
    fun create_char_a_condition(ts: &mut ts::Scenario): ID {
        ts::next_tx(ts, user_a());
        let cond = condition_character::new(CHAR_A_GAME_ID, ts.ctx());
        let cond_id = object::id(&cond);
        condition_character::share(cond);
        cond_id
    }

    /// Create an everyone condition, share it, return its ID.
    fun create_everyone_condition(ts: &mut ts::Scenario): ID {
        ts::next_tx(ts, user_a());
        let cond = condition_everyone::new(ts.ctx());
        let cond_id = object::id(&cond);
        condition_everyone::share(cond);
        cond_id
    }

    /// Binding with a policy that allows CHAR_A on the given gate.
    fun make_allow_binding(
        gate_id: ID,
        char_cond_id: ID,
        ctx: &mut TxContext,
    ): assembly_binding::AssemblyBinding {
        let mut b = assembly_binding::new_binding(ctx);
        assembly_binding::register_gate(&mut b, gate_id, ctx);
        assembly_binding::set_policy(
            &mut b, gate_id,
            vector[assembly_binding::rule(char_cond_id, assembly_binding::allow())],
            ctx,
        );
        b
    }

    /// Binding with a policy that denies CHAR_A on the given gate.
    fun make_deny_binding(
        gate_id: ID,
        char_cond_id: ID,
        ctx: &mut TxContext,
    ): assembly_binding::AssemblyBinding {
        let mut b = assembly_binding::new_binding(ctx);
        assembly_binding::register_gate(&mut b, gate_id, ctx);
        assembly_binding::set_policy(
            &mut b, gate_id,
            vector[assembly_binding::rule(char_cond_id, assembly_binding::deny())],
            ctx,
        );
        b
    }

    fun make_blocklist_binding(ctx: &mut TxContext): assembly_binding::AssemblyBinding {
        let mut b = assembly_binding::new_binding(ctx);
        assembly_binding::add_to_blocklist(&mut b, CHAR_A_GAME_ID, ctx);
        b
    }

    fun make_empty_binding(ctx: &mut TxContext): assembly_binding::AssemblyBinding {
        assembly_binding::new_binding(ctx)
    }

    /// Build condition proofs for CHAR_A given a character condition and eval context.
    fun build_char_a_proofs(
        ts: &mut ts::Scenario,
        char_cond_id: ID,
        binding: &assembly_binding::AssemblyBinding,
        gate_id: ID,
    ): vector<assembly_binding::ConditionProof> {
        let char_cond = ts::take_shared_by_id<condition_character::CharacterCondition>(ts, char_cond_id);
        let eval_ctx = assembly_binding::build_eval_context(binding, gate_id, CHAR_A_GAME_ID, TRIBE_X, user_a());
        let proofs = vector[
            condition_character::verify(&char_cond, &eval_ctx),
        ];
        ts::return_shared(char_cond);
        proofs
    }

    // ── Tests ─────────────────────────────────────────────────────────────────

    #[test]
    fun authorize_on_gate_creates_config_with_correct_gate_id() {
        let mut ts = ts::begin(governor());
        setup(&mut ts);
        let char_id = create_character_a(&mut ts);
        let nwn_id = create_nwn(&mut ts, char_id);
        let gate_a_id = create_gate_obj(&mut ts, char_id, nwn_id, GATE_ITEM_ID_1);
        bring_nwn_online(&mut ts, char_id, nwn_id);
        let config_id = authorize_ef_guard_gate(&mut ts, char_id, gate_a_id);

        ts::next_tx(&mut ts, user_a());
        {
            let config = ts::take_shared_by_id<gate_extension::GateExtensionConfig>(&ts, config_id);
            assert!(gate_extension::gate_id(&config) == gate_a_id);
            assert!(gate_extension::permit_ttl_ms(&config) == PERMIT_TTL_MS);
            ts::return_shared(config);
        };
        ts::end(ts);
    }

    /// Character in Allow policy -> JumpPermit is transferred to their address.
    #[test]
    fun request_permit_issues_permit_for_allowed_character() {
        let mut ts = ts::begin(governor());
        setup(&mut ts);
        let char_id = create_character_a(&mut ts);
        let nwn_id = create_nwn(&mut ts, char_id);
        let gate_a_id = create_gate_obj(&mut ts, char_id, nwn_id, GATE_ITEM_ID_1);
        let gate_b_id = create_gate_obj(&mut ts, char_id, nwn_id, GATE_ITEM_ID_2);
        bring_nwn_online(&mut ts, char_id, nwn_id);
        link_and_online_gates(&mut ts, char_id, nwn_id, gate_a_id, gate_b_id);

        // Both gates need EfGuardGateAuth authorized (world contract requirement)
        let config_a_id = authorize_ef_guard_gate(&mut ts, char_id, gate_a_id);
        authorize_ef_guard_gate(&mut ts, char_id, gate_b_id);

        // Create condition objects
        let char_cond_id = create_char_a_condition(&mut ts);

        ts::next_tx(&mut ts, user_a());
        {
            let config_a = ts::take_shared_by_id<gate_extension::GateExtensionConfig>(&ts, config_a_id);
            let gate_a = ts::take_shared_by_id<Gate>(&ts, gate_a_id);
            let gate_b = ts::take_shared_by_id<Gate>(&ts, gate_b_id);
            let character = ts::take_shared_by_id<Character>(&ts, char_id);
            let binding = make_allow_binding(gate_a_id, char_cond_id, ts.ctx());
            let clock = clock::create_for_testing(ts.ctx());

            // Build proofs
            let char_cond = ts::take_shared_by_id<condition_character::CharacterCondition>(&ts, char_cond_id);
            let eval_ctx = assembly_binding::build_eval_context(&binding, gate_a_id, CHAR_A_GAME_ID, TRIBE_X, user_a());
            let proofs = vector[condition_character::verify(&char_cond, &eval_ctx)];
            ts::return_shared(char_cond);

            gate_extension::request_permit(
                &config_a, &binding, &proofs, &gate_a, &gate_b,
                &character, &clock, ts.ctx(),
            );

            clock.destroy_for_testing();
            ts::return_shared(config_a);
            ts::return_shared(gate_a);
            ts::return_shared(gate_b);
            ts::return_shared(character);
            destroy(binding);
        };

        // JumpPermit should now be at user_a's address
        ts::next_tx(&mut ts, user_a());
        {
            let permit = ts::take_from_sender<JumpPermit>(&ts);
            destroy(permit);
        };
        ts::end(ts);
    }

    /// Character in Deny policy -> EAccessDenied.
    #[test]
    #[expected_failure(abort_code = ef_guard::gate_extension::EAccessDenied)]
    fun request_permit_denied_for_deny_policy_character() {
        let mut ts = ts::begin(governor());
        setup(&mut ts);
        let char_id = create_character_a(&mut ts);
        let nwn_id = create_nwn(&mut ts, char_id);
        let gate_a_id = create_gate_obj(&mut ts, char_id, nwn_id, GATE_ITEM_ID_1);
        let gate_b_id = create_gate_obj(&mut ts, char_id, nwn_id, GATE_ITEM_ID_2);
        bring_nwn_online(&mut ts, char_id, nwn_id);
        link_and_online_gates(&mut ts, char_id, nwn_id, gate_a_id, gate_b_id);
        let config_a_id = authorize_ef_guard_gate(&mut ts, char_id, gate_a_id);
        authorize_ef_guard_gate(&mut ts, char_id, gate_b_id);

        let char_cond_id = create_char_a_condition(&mut ts);

        ts::next_tx(&mut ts, user_a());
        {
            let config_a = ts::take_shared_by_id<gate_extension::GateExtensionConfig>(&ts, config_a_id);
            let gate_a = ts::take_shared_by_id<Gate>(&ts, gate_a_id);
            let gate_b = ts::take_shared_by_id<Gate>(&ts, gate_b_id);
            let character = ts::take_shared_by_id<Character>(&ts, char_id);
            let binding = make_deny_binding(gate_a_id, char_cond_id, ts.ctx());
            let clock = clock::create_for_testing(ts.ctx());

            let char_cond = ts::take_shared_by_id<condition_character::CharacterCondition>(&ts, char_cond_id);
            let eval_ctx = assembly_binding::build_eval_context(&binding, gate_a_id, CHAR_A_GAME_ID, TRIBE_X, user_a());
            let proofs = vector[condition_character::verify(&char_cond, &eval_ctx)];
            ts::return_shared(char_cond);

            gate_extension::request_permit(
                &config_a, &binding, &proofs, &gate_a, &gate_b,
                &character, &clock, ts.ctx(),
            );
            abort 999
        };
    }

    /// Blocklisted character -> EAccessDenied.
    #[test]
    #[expected_failure(abort_code = ef_guard::gate_extension::EAccessDenied)]
    fun request_permit_denied_for_blocklisted_character() {
        let mut ts = ts::begin(governor());
        setup(&mut ts);
        let char_id = create_character_a(&mut ts);
        let nwn_id = create_nwn(&mut ts, char_id);
        let gate_a_id = create_gate_obj(&mut ts, char_id, nwn_id, GATE_ITEM_ID_1);
        let gate_b_id = create_gate_obj(&mut ts, char_id, nwn_id, GATE_ITEM_ID_2);
        bring_nwn_online(&mut ts, char_id, nwn_id);
        link_and_online_gates(&mut ts, char_id, nwn_id, gate_a_id, gate_b_id);
        let config_a_id = authorize_ef_guard_gate(&mut ts, char_id, gate_a_id);
        authorize_ef_guard_gate(&mut ts, char_id, gate_b_id);

        ts::next_tx(&mut ts, user_a());
        {
            let config_a = ts::take_shared_by_id<gate_extension::GateExtensionConfig>(&ts, config_a_id);
            let gate_a = ts::take_shared_by_id<Gate>(&ts, gate_a_id);
            let gate_b = ts::take_shared_by_id<Gate>(&ts, gate_b_id);
            let character = ts::take_shared_by_id<Character>(&ts, char_id);
            let binding = make_blocklist_binding(ts.ctx());
            let clock = clock::create_for_testing(ts.ctx());
            let proofs = vector[];

            gate_extension::request_permit(
                &config_a, &binding, &proofs, &gate_a, &gate_b,
                &character, &clock, ts.ctx(),
            );
            abort 999
        };
    }

    /// Character not matching any rule -> Default -> EAccessDenied (fail-safe).
    #[test]
    #[expected_failure(abort_code = ef_guard::gate_extension::EAccessDenied)]
    fun request_permit_denied_for_default_character() {
        let mut ts = ts::begin(governor());
        setup(&mut ts);
        let char_id = create_character_a(&mut ts);
        let nwn_id = create_nwn(&mut ts, char_id);
        let gate_a_id = create_gate_obj(&mut ts, char_id, nwn_id, GATE_ITEM_ID_1);
        let gate_b_id = create_gate_obj(&mut ts, char_id, nwn_id, GATE_ITEM_ID_2);
        bring_nwn_online(&mut ts, char_id, nwn_id);
        link_and_online_gates(&mut ts, char_id, nwn_id, gate_a_id, gate_b_id);
        let config_a_id = authorize_ef_guard_gate(&mut ts, char_id, gate_a_id);
        authorize_ef_guard_gate(&mut ts, char_id, gate_b_id);

        ts::next_tx(&mut ts, user_a());
        {
            let config_a = ts::take_shared_by_id<gate_extension::GateExtensionConfig>(&ts, config_a_id);
            let gate_a = ts::take_shared_by_id<Gate>(&ts, gate_a_id);
            let gate_b = ts::take_shared_by_id<Gate>(&ts, gate_b_id);
            let character = ts::take_shared_by_id<Character>(&ts, char_id);
            let binding = make_empty_binding(ts.ctx());
            let clock = clock::create_for_testing(ts.ctx());
            let proofs = vector[];

            gate_extension::request_permit(
                &config_a, &binding, &proofs, &gate_a, &gate_b,
                &character, &clock, ts.ctx(),
            );
            abort 999
        };
    }

    /// Passing a gate whose ID != config.gate_id aborts with EWrongGate.
    #[test]
    #[expected_failure(abort_code = ef_guard::gate_extension::EWrongGate)]
    fun request_permit_wrong_source_gate_aborts() {
        let mut ts = ts::begin(governor());
        setup(&mut ts);
        let char_id = create_character_a(&mut ts);
        let nwn_id = create_nwn(&mut ts, char_id);
        let gate_a_id = create_gate_obj(&mut ts, char_id, nwn_id, GATE_ITEM_ID_1);
        let gate_b_id = create_gate_obj(&mut ts, char_id, nwn_id, GATE_ITEM_ID_2);
        bring_nwn_online(&mut ts, char_id, nwn_id);
        link_and_online_gates(&mut ts, char_id, nwn_id, gate_a_id, gate_b_id);

        // config_a is bound to gate_a_id
        let config_a_id = authorize_ef_guard_gate(&mut ts, char_id, gate_a_id);
        authorize_ef_guard_gate(&mut ts, char_id, gate_b_id);

        let char_cond_id = create_char_a_condition(&mut ts);

        ts::next_tx(&mut ts, user_a());
        {
            let config_a = ts::take_shared_by_id<gate_extension::GateExtensionConfig>(&ts, config_a_id);
            let gate_a = ts::take_shared_by_id<Gate>(&ts, gate_a_id);
            let gate_b = ts::take_shared_by_id<Gate>(&ts, gate_b_id);
            let character = ts::take_shared_by_id<Character>(&ts, char_id);
            let binding = make_allow_binding(gate_a_id, char_cond_id, ts.ctx());
            let clock = clock::create_for_testing(ts.ctx());

            let char_cond = ts::take_shared_by_id<condition_character::CharacterCondition>(&ts, char_cond_id);
            let eval_ctx = assembly_binding::build_eval_context(&binding, gate_a_id, CHAR_A_GAME_ID, TRIBE_X, user_a());
            let proofs = vector[condition_character::verify(&char_cond, &eval_ctx)];
            ts::return_shared(char_cond);

            // config_a.gate_id == gate_a_id, but we pass gate_b as source -> EWrongGate
            gate_extension::request_permit(
                &config_a, &binding, &proofs, &gate_b, &gate_a,
                &character, &clock, ts.ctx(),
            );
            abort 999
        };
    }

    /// Permit is usable within the TTL window: `jump_with_permit` succeeds when clock < expiry.
    #[test]
    fun permit_is_valid_within_ttl_window() {
        let mut ts = ts::begin(governor());
        setup(&mut ts);
        let char_id = create_character_a(&mut ts);
        let nwn_id = create_nwn(&mut ts, char_id);
        let gate_a_id = create_gate_obj(&mut ts, char_id, nwn_id, GATE_ITEM_ID_1);
        let gate_b_id = create_gate_obj(&mut ts, char_id, nwn_id, GATE_ITEM_ID_2);
        bring_nwn_online(&mut ts, char_id, nwn_id);
        link_and_online_gates(&mut ts, char_id, nwn_id, gate_a_id, gate_b_id);
        let config_a_id = authorize_ef_guard_gate(&mut ts, char_id, gate_a_id);
        authorize_ef_guard_gate(&mut ts, char_id, gate_b_id);

        let char_cond_id = create_char_a_condition(&mut ts);

        ts::next_tx(&mut ts, user_a());
        {
            let config_a = ts::take_shared_by_id<gate_extension::GateExtensionConfig>(&ts, config_a_id);
            let gate_a = ts::take_shared_by_id<Gate>(&ts, gate_a_id);
            let gate_b = ts::take_shared_by_id<Gate>(&ts, gate_b_id);
            let character = ts::take_shared_by_id<Character>(&ts, char_id);
            let binding = make_allow_binding(gate_a_id, char_cond_id, ts.ctx());
            let mut clock = clock::create_for_testing(ts.ctx());
            clock.set_for_testing(1_000_000);

            let char_cond = ts::take_shared_by_id<condition_character::CharacterCondition>(&ts, char_cond_id);
            let eval_ctx = assembly_binding::build_eval_context(&binding, gate_a_id, CHAR_A_GAME_ID, TRIBE_X, user_a());
            let proofs = vector[condition_character::verify(&char_cond, &eval_ctx)];
            ts::return_shared(char_cond);

            gate_extension::request_permit(
                &config_a, &binding, &proofs, &gate_a, &gate_b,
                &character, &clock, ts.ctx(),
            );

            clock.destroy_for_testing();
            ts::return_shared(config_a);
            ts::return_shared(gate_a);
            ts::return_shared(gate_b);
            ts::return_shared(character);
            destroy(binding);
        };

        // Permit was issued at clock=1_000_000 with TTL=60_000 -> expires at 1_060_000.
        // Using it at clock=1_059_999 (before expiry) must succeed.
        ts::next_tx(&mut ts, user_a());
        {
            let gate_a = ts::take_shared_by_id<Gate>(&ts, gate_a_id);
            let gate_b = ts::take_shared_by_id<Gate>(&ts, gate_b_id);
            let character = ts::take_shared_by_id<Character>(&ts, char_id);
            let permit = ts::take_from_sender<JumpPermit>(&ts);
            let mut clock = clock::create_for_testing(ts.ctx());
            clock.set_for_testing(1_059_999);

            gate::test_jump_with_permit(&gate_a, &gate_b, &character, permit, &clock);

            clock.destroy_for_testing();
            ts::return_shared(gate_a);
            ts::return_shared(gate_b);
            ts::return_shared(character);
        };
        ts::end(ts);
    }
}
