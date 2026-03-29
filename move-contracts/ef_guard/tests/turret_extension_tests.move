#[test_only]
#[allow(unused_let_mut, unused_trailing_semi)]
module ef_guard::turret_extension_tests {
    use ef_guard::{assembly_binding, turret_extension};
    use std::{bcs, string::utf8, unit_test::destroy};
    use sui::{clock, test_scenario as ts};
    use world::{
        access::{AdminACL, OwnerCap},
        character::{Self, Character},
        energy::EnergyConfig,
        network_node::{Self, NetworkNode},
        object_registry::ObjectRegistry,
        turret::{Self, Turret},
        test_helpers::{Self, admin, governor, user_a, tenant},
    };

    // Character constants
    const CHAR_A_ITEM_ID: u32 = 42;
    const CHAR_A_GAME_ID: u32 = 42; // u32 matches TargetCandidate.character_id
    const TRIBE_X: u32 = 7;  // owner's tribe
    const TRIBE_Y: u32 = 99; // a different tribe

    // NWN / turret constants
    const TURRET_TYPE_ID: u64 = 5555;
    const TURRET_ITEM_ID_1: u64 = 6001;
    const TURRET_ITEM_ID_2: u64 = 6002;
    const NWN_TYPE_ID: u64 = 111000;
    const NWN_ITEM_ID: u64 = 5000;
    const FUEL_MAX_CAPACITY: u64 = 1000;
    const FUEL_BURN_RATE_IN_MS: u64 = 3_600_000;
    const MAX_PRODUCTION: u64 = 100;
    const FUEL_TYPE_ID: u64 = 1;
    const FUEL_VOLUME: u64 = 10;

    const DENY_WEIGHT: u64 = 10_000;
    const ALLOW_WEIGHT: u64 = 0;

    /// BCS layout for TargetCandidate (must match world::turret's deserialization order).
    public struct CandidateBcs has copy, drop {
        item_id:          u64,
        type_id:          u64,
        group_id:         u64,
        character_id:     u32,
        character_tribe:  u32,
        hp_ratio:         u64,
        shield_ratio:     u64,
        armor_ratio:      u64,
        is_aggressor:     bool,
        priority_weight:  u64,
        behaviour_change: u8,
    }

    fun one_candidate(
        item_id:         u64,
        character_id:    u32,
        character_tribe: u32,
        is_aggressor:    bool,
        priority_weight: u64,
    ): vector<u8> {
        bcs::to_bytes(&vector[CandidateBcs {
            item_id,
            type_id:          1,
            group_id:         1,
            character_id,
            character_tribe,
            hp_ratio:         100,
            shield_ratio:     100,
            armor_ratio:      100,
            is_aggressor,
            priority_weight,
            behaviour_change: 0,
        }])
    }

    // ── Setup helpers ─────────────────────────────────────────────────────────

    fun setup(ts: &mut ts::Scenario) {
        test_helpers::setup_world(ts);
        test_helpers::configure_fuel(ts);
        test_helpers::configure_assembly_energy(ts);
        test_helpers::register_server_address(ts);
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

    fun create_turret_obj(ts: &mut ts::Scenario, char_id: ID, nwn_id: ID, item_id: u64): ID {
        ts::next_tx(ts, admin());
        let admin_acl = ts::take_shared<AdminACL>(ts);
        let mut registry = ts::take_shared<ObjectRegistry>(ts);
        let mut nwn = ts::take_shared_by_id<NetworkNode>(ts, nwn_id);
        let character = ts::take_shared_by_id<Character>(ts, char_id);
        let turret_obj = turret::anchor(
            &mut registry, &mut nwn, &character, &admin_acl,
            item_id, TURRET_TYPE_ID,
            test_helpers::get_verified_location_hash(), ts.ctx(),
        );
        let turret_id = object::id(&turret_obj);
        turret_obj.share_turret(&admin_acl, ts.ctx());
        ts::return_shared(character);
        ts::return_shared(nwn);
        ts::return_shared(registry);
        ts::return_shared(admin_acl);
        turret_id
    }

    fun bring_nwn_online(ts: &mut ts::Scenario, char_id: ID, nwn_id: ID) {
        ts::next_tx(ts, user_a());
        let mut character = ts::take_shared_by_id<Character>(ts, char_id);
        let nwn_cap_id = {
            let nwn = ts::take_shared_by_id<NetworkNode>(ts, nwn_id);
            let id = nwn.owner_cap_id();
            ts::return_shared(nwn);
            id
        };
        let (cap, receipt) = character.borrow_owner_cap<NetworkNode>(
            ts::receiving_ticket_by_id<OwnerCap<NetworkNode>>(nwn_cap_id), ts.ctx(),
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

    fun bring_turret_online(ts: &mut ts::Scenario, char_id: ID, turret_id: ID, nwn_id: ID) {
        ts::next_tx(ts, user_a());
        let mut character = ts::take_shared_by_id<Character>(ts, char_id);
        let turret_cap_id = {
            let turret = ts::take_shared_by_id<Turret>(ts, turret_id);
            let id = turret.owner_cap_id();
            ts::return_shared(turret);
            id
        };
        let (cap, receipt) = character.borrow_owner_cap<Turret>(
            ts::receiving_ticket_by_id<OwnerCap<Turret>>(turret_cap_id), ts.ctx(),
        );

        ts::next_tx(ts, user_a());
        {
            let mut turret = ts::take_shared_by_id<Turret>(ts, turret_id);
            let mut nwn = ts::take_shared_by_id<NetworkNode>(ts, nwn_id);
            let energy_config = ts::take_shared<EnergyConfig>(ts);
            turret.online(&mut nwn, &energy_config, &cap);
            ts::return_shared(turret);
            ts::return_shared(nwn);
            ts::return_shared(energy_config);
        };

        character.return_owner_cap(cap, receipt);
        ts::return_shared(character);
    }

    fun authorize_ef_guard_turret(ts: &mut ts::Scenario, char_id: ID, turret_id: ID): ID {
        ts::next_tx(ts, user_a());
        let mut turret = ts::take_shared_by_id<Turret>(ts, turret_id);
        let mut character = ts::take_shared_by_id<Character>(ts, char_id);
        let cap_id = turret.owner_cap_id();
        let (cap, receipt) = character.borrow_owner_cap<Turret>(
            ts::receiving_ticket_by_id<OwnerCap<Turret>>(cap_id), ts.ctx(),
        );
        let config = turret_extension::authorize_on_turret(
            &mut turret, &cap, DENY_WEIGHT, ALLOW_WEIGHT, ts.ctx(),
        );
        let config_id = object::id(&config);
        turret_extension::share_config(config);
        character.return_owner_cap(cap, receipt);
        ts::return_shared(turret);
        ts::return_shared(character);
        config_id
    }

    // ── Policy helpers ────────────────────────────────────────────────────────

    /// Binding with a policy that allows CHAR_A on the given turret.
    fun make_allow_binding(turret_id: ID, ctx: &mut TxContext): assembly_binding::AssemblyBinding {
        let mut b = assembly_binding::new_binding(ctx);
        assembly_binding::register_turret(&mut b, turret_id, ctx);
        assembly_binding::set_policy(
            &mut b, turret_id,
            vector[assembly_binding::rule(
                assembly_binding::character(CHAR_A_GAME_ID as u64),
                assembly_binding::allow(),
            )],
            ctx,
        );
        b
    }

    /// Binding with a policy that denies CHAR_A on the given turret.
    fun make_deny_binding(turret_id: ID, ctx: &mut TxContext): assembly_binding::AssemblyBinding {
        let mut b = assembly_binding::new_binding(ctx);
        assembly_binding::register_turret(&mut b, turret_id, ctx);
        assembly_binding::set_policy(
            &mut b, turret_id,
            vector[assembly_binding::rule(
                assembly_binding::character(CHAR_A_GAME_ID as u64),
                assembly_binding::deny(),
            )],
            ctx,
        );
        b
    }

    fun make_blocklist_binding(ctx: &mut TxContext): assembly_binding::AssemblyBinding {
        let mut b = assembly_binding::new_binding(ctx);
        assembly_binding::add_to_blocklist(&mut b, CHAR_A_GAME_ID as u64, ctx);
        b
    }

    fun make_block_aggressors_binding(ctx: &mut TxContext): assembly_binding::AssemblyBinding {
        let mut b = assembly_binding::new_binding(ctx);
        assembly_binding::set_block_aggressors(&mut b, true, ctx);
        b
    }

    fun make_empty_binding(ctx: &mut TxContext): assembly_binding::AssemblyBinding {
        assembly_binding::new_binding(ctx)
    }

    // ── Tests ─────────────────────────────────────────────────────────────────

    #[test]
    fun authorize_on_turret_creates_config_with_correct_turret_id() {
        let mut ts = ts::begin(governor());
        setup(&mut ts);
        let char_id = create_character_a(&mut ts);
        let nwn_id = create_nwn(&mut ts, char_id);
        let turret_id = create_turret_obj(&mut ts, char_id, nwn_id, TURRET_ITEM_ID_1);
        bring_nwn_online(&mut ts, char_id, nwn_id);
        bring_turret_online(&mut ts, char_id, turret_id, nwn_id);
        let config_id = authorize_ef_guard_turret(&mut ts, char_id, turret_id);

        ts::next_tx(&mut ts, user_a());
        {
            let config = ts::take_shared_by_id<turret_extension::TurretExtensionConfig>(&ts, config_id);
            assert!(turret_extension::turret_id(&config) == turret_id);
            assert!(turret_extension::deny_weight(&config) == DENY_WEIGHT);
            assert!(turret_extension::allow_weight(&config) == ALLOW_WEIGHT);
            ts::return_shared(config);
        };
        ts::end(ts);
    }

    /// Candidate in Allow policy -> excluded from return list (hold fire).
    #[test]
    fun candidate_in_allow_policy_excluded_from_list() {
        let mut ts = ts::begin(governor());
        setup(&mut ts);
        let char_id = create_character_a(&mut ts);
        let nwn_id = create_nwn(&mut ts, char_id);
        let turret_id = create_turret_obj(&mut ts, char_id, nwn_id, TURRET_ITEM_ID_1);
        bring_nwn_online(&mut ts, char_id, nwn_id);
        bring_turret_online(&mut ts, char_id, turret_id, nwn_id);
        let config_id = authorize_ef_guard_turret(&mut ts, char_id, turret_id);

        ts::next_tx(&mut ts, user_a());
        {
            let config = ts::take_shared_by_id<turret_extension::TurretExtensionConfig>(&ts, config_id);
            let turret = ts::take_shared_by_id<Turret>(&ts, turret_id);
            let owner = ts::take_shared_by_id<Character>(&ts, char_id);
            let binding = make_allow_binding(turret_id, ts.ctx());

            let result = turret_extension::get_target_priority_list(
                &config, &binding, &turret, &owner,
                one_candidate(1001, CHAR_A_GAME_ID, TRIBE_X, false, 500),
            );

            let entries = turret::unpack_return_priority_list(result);
            assert!(entries.length() == 0); // excluded -> empty list

            ts::return_shared(config);
            ts::return_shared(turret);
            ts::return_shared(owner);
            destroy(binding);
        };
        ts::end(ts);
    }

    /// Candidate in Deny policy -> included in list with deny_weight.
    #[test]
    fun candidate_in_deny_policy_receives_deny_weight() {
        let mut ts = ts::begin(governor());
        setup(&mut ts);
        let char_id = create_character_a(&mut ts);
        let nwn_id = create_nwn(&mut ts, char_id);
        let turret_id = create_turret_obj(&mut ts, char_id, nwn_id, TURRET_ITEM_ID_1);
        bring_nwn_online(&mut ts, char_id, nwn_id);
        bring_turret_online(&mut ts, char_id, turret_id, nwn_id);
        let config_id = authorize_ef_guard_turret(&mut ts, char_id, turret_id);

        ts::next_tx(&mut ts, user_a());
        {
            let config = ts::take_shared_by_id<turret_extension::TurretExtensionConfig>(&ts, config_id);
            let turret = ts::take_shared_by_id<Turret>(&ts, turret_id);
            let owner = ts::take_shared_by_id<Character>(&ts, char_id);
            let binding = make_deny_binding(turret_id, ts.ctx());

            let result = turret_extension::get_target_priority_list(
                &config, &binding, &turret, &owner,
                one_candidate(1001, CHAR_A_GAME_ID, TRIBE_X, false, 500),
            );

            let entries = turret::unpack_return_priority_list(result);
            assert!(entries.length() == 1);
            assert!(turret::return_priority_weight(&entries[0]) == DENY_WEIGHT);

            ts::return_shared(config);
            ts::return_shared(turret);
            ts::return_shared(owner);
            destroy(binding);
        };
        ts::end(ts);
    }

    /// Candidate with default role (different tribe, no policy, non-aggressor)
    /// passes through with its original priority_weight.
    #[test]
    fun candidate_default_role_preserves_original_weight() {
        let mut ts = ts::begin(governor());
        setup(&mut ts);
        let char_id = create_character_a(&mut ts);
        let nwn_id = create_nwn(&mut ts, char_id);
        let turret_id = create_turret_obj(&mut ts, char_id, nwn_id, TURRET_ITEM_ID_1);
        bring_nwn_online(&mut ts, char_id, nwn_id);
        bring_turret_online(&mut ts, char_id, turret_id, nwn_id);
        let config_id = authorize_ef_guard_turret(&mut ts, char_id, turret_id);

        ts::next_tx(&mut ts, user_a());
        {
            let config = ts::take_shared_by_id<turret_extension::TurretExtensionConfig>(&ts, config_id);
            let turret = ts::take_shared_by_id<Turret>(&ts, turret_id);
            let owner = ts::take_shared_by_id<Character>(&ts, char_id);
            let binding = make_empty_binding(ts.ctx());

            let original_weight: u64 = 42;
            // Candidate from TRIBE_Y, different from owner's TRIBE_X -> pass-through
            let result = turret_extension::get_target_priority_list(
                &config, &binding, &turret, &owner,
                one_candidate(2001, 99, TRIBE_Y, false, original_weight),
            );

            let entries = turret::unpack_return_priority_list(result);
            assert!(entries.length() == 1);
            assert!(turret::return_priority_weight(&entries[0]) == original_weight);

            ts::return_shared(config);
            ts::return_shared(turret);
            ts::return_shared(owner);
            destroy(binding);
        };
        ts::end(ts);
    }

    /// Candidate in same tribe as owner, non-aggressor, no policy -> excluded (friendly fire prevention).
    #[test]
    fun candidate_same_tribe_non_aggressor_excluded_by_default() {
        let mut ts = ts::begin(governor());
        setup(&mut ts);
        let char_id = create_character_a(&mut ts);
        let nwn_id = create_nwn(&mut ts, char_id);
        let turret_id = create_turret_obj(&mut ts, char_id, nwn_id, TURRET_ITEM_ID_1);
        bring_nwn_online(&mut ts, char_id, nwn_id);
        bring_turret_online(&mut ts, char_id, turret_id, nwn_id);
        let config_id = authorize_ef_guard_turret(&mut ts, char_id, turret_id);

        ts::next_tx(&mut ts, user_a());
        {
            let config = ts::take_shared_by_id<turret_extension::TurretExtensionConfig>(&ts, config_id);
            let turret = ts::take_shared_by_id<Turret>(&ts, turret_id);
            let owner = ts::take_shared_by_id<Character>(&ts, char_id);
            let binding = make_empty_binding(ts.ctx());

            // Same tribe as owner, not aggressor -> excluded (friendly)
            let result = turret_extension::get_target_priority_list(
                &config, &binding, &turret, &owner,
                one_candidate(3001, 77, TRIBE_X, false, 100),
            );

            let entries = turret::unpack_return_priority_list(result);
            assert!(entries.length() == 0);

            ts::return_shared(config);
            ts::return_shared(turret);
            ts::return_shared(owner);
            destroy(binding);
        };
        ts::end(ts);
    }

    /// Blocklisted candidate -> included with deny_weight regardless of policy.
    #[test]
    fun blocklisted_candidate_receives_deny_weight() {
        let mut ts = ts::begin(governor());
        setup(&mut ts);
        let char_id = create_character_a(&mut ts);
        let nwn_id = create_nwn(&mut ts, char_id);
        let turret_id = create_turret_obj(&mut ts, char_id, nwn_id, TURRET_ITEM_ID_1);
        bring_nwn_online(&mut ts, char_id, nwn_id);
        bring_turret_online(&mut ts, char_id, turret_id, nwn_id);
        let config_id = authorize_ef_guard_turret(&mut ts, char_id, turret_id);

        ts::next_tx(&mut ts, user_a());
        {
            let config = ts::take_shared_by_id<turret_extension::TurretExtensionConfig>(&ts, config_id);
            let turret = ts::take_shared_by_id<Turret>(&ts, turret_id);
            let owner = ts::take_shared_by_id<Character>(&ts, char_id);
            let binding = make_blocklist_binding(ts.ctx());

            let result = turret_extension::get_target_priority_list(
                &config, &binding, &turret, &owner,
                one_candidate(1001, CHAR_A_GAME_ID, TRIBE_X, false, 50),
            );

            let entries = turret::unpack_return_priority_list(result);
            assert!(entries.length() == 1);
            assert!(turret::return_priority_weight(&entries[0]) == DENY_WEIGHT);

            ts::return_shared(config);
            ts::return_shared(turret);
            ts::return_shared(owner);
            destroy(binding);
        };
        ts::end(ts);
    }

    /// Aggressor with block_aggressors enabled -> included with deny_weight.
    #[test]
    fun aggressor_with_block_aggressors_receives_deny_weight() {
        let mut ts = ts::begin(governor());
        setup(&mut ts);
        let char_id = create_character_a(&mut ts);
        let nwn_id = create_nwn(&mut ts, char_id);
        let turret_id = create_turret_obj(&mut ts, char_id, nwn_id, TURRET_ITEM_ID_1);
        bring_nwn_online(&mut ts, char_id, nwn_id);
        bring_turret_online(&mut ts, char_id, turret_id, nwn_id);
        let config_id = authorize_ef_guard_turret(&mut ts, char_id, turret_id);

        ts::next_tx(&mut ts, user_a());
        {
            let config = ts::take_shared_by_id<turret_extension::TurretExtensionConfig>(&ts, config_id);
            let turret = ts::take_shared_by_id<Turret>(&ts, turret_id);
            let owner = ts::take_shared_by_id<Character>(&ts, char_id);
            let binding = make_block_aggressors_binding(ts.ctx());

            // is_aggressor=true, block_aggressors=true -> deny_weight
            let result = turret_extension::get_target_priority_list(
                &config, &binding, &turret, &owner,
                one_candidate(1001, 88, TRIBE_Y, true, 50),
            );

            let entries = turret::unpack_return_priority_list(result);
            assert!(entries.length() == 1);
            assert!(turret::return_priority_weight(&entries[0]) == DENY_WEIGHT);

            ts::return_shared(config);
            ts::return_shared(turret);
            ts::return_shared(owner);
            destroy(binding);
        };
        ts::end(ts);
    }

    /// Aggressor with block_aggressors disabled -> normal policy (default = pass-through).
    #[test]
    fun aggressor_without_block_aggressors_uses_normal_policy() {
        let mut ts = ts::begin(governor());
        setup(&mut ts);
        let char_id = create_character_a(&mut ts);
        let nwn_id = create_nwn(&mut ts, char_id);
        let turret_id = create_turret_obj(&mut ts, char_id, nwn_id, TURRET_ITEM_ID_1);
        bring_nwn_online(&mut ts, char_id, nwn_id);
        bring_turret_online(&mut ts, char_id, turret_id, nwn_id);
        let config_id = authorize_ef_guard_turret(&mut ts, char_id, turret_id);

        ts::next_tx(&mut ts, user_a());
        {
            let config = ts::take_shared_by_id<turret_extension::TurretExtensionConfig>(&ts, config_id);
            let turret = ts::take_shared_by_id<Turret>(&ts, turret_id);
            let owner = ts::take_shared_by_id<Character>(&ts, char_id);
            // block_aggressors=false (default), no policies -> default role
            let binding = make_empty_binding(ts.ctx());

            let original_weight: u64 = 75;
            // Aggressor from TRIBE_Y; block_aggressors=false -> aggressor check passes
            // -> default role -> passes through with original weight
            let result = turret_extension::get_target_priority_list(
                &config, &binding, &turret, &owner,
                one_candidate(1001, 88, TRIBE_Y, true, original_weight),
            );

            let entries = turret::unpack_return_priority_list(result);
            assert!(entries.length() == 1);
            assert!(turret::return_priority_weight(&entries[0]) == original_weight);

            ts::return_shared(config);
            ts::return_shared(turret);
            ts::return_shared(owner);
            destroy(binding);
        };
        ts::end(ts);
    }

    /// Two candidates: one Allow (excluded), one Deny (deny_weight) -> only deny candidate in result.
    #[test]
    fun multiple_candidates_weighted_independently() {
        let mut ts = ts::begin(governor());
        setup(&mut ts);
        let char_id = create_character_a(&mut ts);
        let nwn_id = create_nwn(&mut ts, char_id);
        let turret_id = create_turret_obj(&mut ts, char_id, nwn_id, TURRET_ITEM_ID_1);
        bring_nwn_online(&mut ts, char_id, nwn_id);
        bring_turret_online(&mut ts, char_id, turret_id, nwn_id);
        let config_id = authorize_ef_guard_turret(&mut ts, char_id, turret_id);

        ts::next_tx(&mut ts, user_a());
        {
            let config = ts::take_shared_by_id<turret_extension::TurretExtensionConfig>(&ts, config_id);
            let turret = ts::take_shared_by_id<Turret>(&ts, turret_id);
            let owner = ts::take_shared_by_id<Character>(&ts, char_id);
            let binding = make_deny_binding(turret_id, ts.ctx());

            // Candidate A (CHAR_A_GAME_ID) -> Deny policy -> deny_weight
            // Candidate B (char 99, TRIBE_Y) -> Default -> pass-through with its weight
            let original_weight: u64 = 77;
            let combined = {
                let a = CandidateBcs {
                    item_id: 1001, type_id: 1, group_id: 1,
                    character_id: CHAR_A_GAME_ID, character_tribe: TRIBE_X,
                    hp_ratio: 100, shield_ratio: 100, armor_ratio: 100,
                    is_aggressor: false, priority_weight: 500, behaviour_change: 0,
                };
                let b = CandidateBcs {
                    item_id: 2002, type_id: 1, group_id: 1,
                    character_id: 99, character_tribe: TRIBE_Y,
                    hp_ratio: 100, shield_ratio: 100, armor_ratio: 100,
                    is_aggressor: false, priority_weight: original_weight, behaviour_change: 0,
                };
                bcs::to_bytes(&vector[a, b])
            };

            let result = turret_extension::get_target_priority_list(
                &config, &binding, &turret, &owner, combined,
            );

            let entries = turret::unpack_return_priority_list(result);
            assert!(entries.length() == 2);
            // First candidate -> deny_weight
            assert!(turret::return_priority_weight(&entries[0]) == DENY_WEIGHT);
            // Second candidate -> original weight (default pass-through)
            assert!(turret::return_priority_weight(&entries[1]) == original_weight);

            ts::return_shared(config);
            ts::return_shared(turret);
            ts::return_shared(owner);
            destroy(binding);
        };
        ts::end(ts);
    }

    /// Passing a turret whose ID differs from config.turret_id aborts with EWrongTurret.
    #[test]
    #[expected_failure(abort_code = ef_guard::turret_extension::EWrongTurret)]
    fun wrong_turret_aborts() {
        let mut ts = ts::begin(governor());
        setup(&mut ts);
        let char_id = create_character_a(&mut ts);
        let nwn_id = create_nwn(&mut ts, char_id);

        // Create two turrets on the same NWN
        let turret1_id = create_turret_obj(&mut ts, char_id, nwn_id, TURRET_ITEM_ID_1);
        let turret2_id = create_turret_obj(&mut ts, char_id, nwn_id, TURRET_ITEM_ID_2);

        bring_nwn_online(&mut ts, char_id, nwn_id);
        bring_turret_online(&mut ts, char_id, turret1_id, nwn_id);
        bring_turret_online(&mut ts, char_id, turret2_id, nwn_id);

        // config1 is bound to turret1_id
        let config1_id = authorize_ef_guard_turret(&mut ts, char_id, turret1_id);
        // Authorize turret2 as well so the world-level extension check passes
        authorize_ef_guard_turret(&mut ts, char_id, turret2_id);

        ts::next_tx(&mut ts, user_a());
        {
            let config1 = ts::take_shared_by_id<turret_extension::TurretExtensionConfig>(&ts, config1_id);
            let turret2 = ts::take_shared_by_id<Turret>(&ts, turret2_id);
            let owner = ts::take_shared_by_id<Character>(&ts, char_id);
            let binding = make_empty_binding(ts.ctx());

            // config1.turret_id == turret1_id, but we pass turret2 -> EWrongTurret
            turret_extension::get_target_priority_list(
                &config1, &binding, &turret2, &owner,
                one_candidate(1001, 99, TRIBE_Y, false, 100),
            );
            abort 999
        };
    }
}
