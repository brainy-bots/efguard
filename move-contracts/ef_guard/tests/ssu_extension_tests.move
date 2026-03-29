#[test_only]
#[allow(unused_const, unused_let_mut, unused_trailing_semi, duplicate_alias)]
module ef_guard::ssu_extension_tests {
    use ef_guard::{assembly_binding, ssu_extension};
    use std::{string::utf8, unit_test::destroy};
    use sui::{clock, test_scenario as ts, transfer};
    use world::{
        access::{AdminACL, OwnerCap},
        character::{Self, Character},
        energy::EnergyConfig,
        network_node::{Self, NetworkNode},
        object_registry::ObjectRegistry,
        storage_unit::{Self, StorageUnit},
        test_helpers::{Self, admin, governor, user_a, tenant},
    };

    // Character constants
    const CHAR_A_ITEM_ID: u32 = 42;
    const CHAR_A_GAME_ID: u64 = 42;
    const TRIBE_X: u32 = 7;

    // SSU/NWN constants (first SSU)
    const SSU_TYPE_ID: u64 = 5555;
    const SSU_ITEM_ID_1: u64 = 90002;
    const SSU_ITEM_ID_2: u64 = 90003;
    const SSU_MAX_CAPACITY: u64 = 100_000;
    const NWN_TYPE_ID: u64 = 111000;
    const NWN_ITEM_ID_1: u64 = 5000;
    const NWN_ITEM_ID_2: u64 = 5001;
    const FUEL_MAX_CAPACITY: u64 = 1000;
    const FUEL_BURN_RATE_IN_MS: u64 = 3_600_000;
    const MAX_PRODUCTION: u64 = 100;
    const FUEL_TYPE_ID: u64 = 1;
    const FUEL_VOLUME: u64 = 10;

    // Item constants
    const AMMO_TYPE_ID: u64 = 88069;
    const AMMO_ITEM_ID: u64 = 1000004145107;
    const AMMO_VOLUME: u64 = 100;
    const AMMO_QUANTITY: u32 = 10;

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
            &mut registry,
            &admin_acl,
            CHAR_A_ITEM_ID,
            tenant(),
            TRIBE_X,
            user_a(),
            utf8(b"char a"),
            ts.ctx(),
        );
        let character_id = object::id(&character);
        character.share_character(&admin_acl, ts.ctx());
        ts::return_shared(registry);
        ts::return_shared(admin_acl);
        character_id
    }

    /// Creates an NWN (not online) anchored to the character. Returns nwn_id.
    fun create_nwn(ts: &mut ts::Scenario, char_id: ID, nwn_item_id: u64): ID {
        ts::next_tx(ts, admin());
        let admin_acl = ts::take_shared<AdminACL>(ts);
        let mut registry = ts::take_shared<ObjectRegistry>(ts);
        let character = ts::take_shared_by_id<Character>(ts, char_id);
        let nwn = network_node::anchor(
            &mut registry,
            &character,
            &admin_acl,
            nwn_item_id,
            NWN_TYPE_ID,
            test_helpers::get_verified_location_hash(),
            FUEL_MAX_CAPACITY,
            FUEL_BURN_RATE_IN_MS,
            MAX_PRODUCTION,
            ts.ctx(),
        );
        let nwn_id = object::id(&nwn);
        nwn.share_network_node(&admin_acl, ts.ctx());
        ts::return_shared(character);
        ts::return_shared(registry);
        ts::return_shared(admin_acl);
        nwn_id
    }

    /// Creates an SSU (not online) anchored to the character + NWN. Returns ssu_id.
    fun create_ssu(ts: &mut ts::Scenario, char_id: ID, nwn_id: ID, ssu_item_id: u64): ID {
        ts::next_tx(ts, admin());
        let admin_acl = ts::take_shared<AdminACL>(ts);
        let mut registry = ts::take_shared<ObjectRegistry>(ts);
        let mut nwn = ts::take_shared_by_id<NetworkNode>(ts, nwn_id);
        let character = ts::take_shared_by_id<Character>(ts, char_id);
        let ssu = storage_unit::anchor(
            &mut registry,
            &mut nwn,
            &character,
            &admin_acl,
            ssu_item_id,
            SSU_TYPE_ID,
            SSU_MAX_CAPACITY,
            test_helpers::get_verified_location_hash(),
            ts.ctx(),
        );
        let ssu_id = object::id(&ssu);
        ssu.share_storage_unit(&admin_acl, ts.ctx());
        ts::return_shared(character);
        ts::return_shared(registry);
        ts::return_shared(nwn);
        ts::return_shared(admin_acl);
        ssu_id
    }

    /// Deposits fuel, brings NWN online, then brings SSU online.
    /// The character must have both OwnerCap<NetworkNode> and OwnerCap<StorageUnit>.
    fun online_ssu(ts: &mut ts::Scenario, char_id: ID, ssu_id: ID, nwn_id: ID) {
        // Step 1: borrow NWN owner cap, deposit fuel, bring NWN online
        ts::next_tx(ts, user_a());
        let mut character = ts::take_shared_by_id<Character>(ts, char_id);
        let nwn_owner_cap_id = {
            let nwn = ts::take_shared_by_id<NetworkNode>(ts, nwn_id);
            let id = nwn.owner_cap_id();
            ts::return_shared(nwn);
            id
        };
        let (nwn_cap, nwn_receipt) = character.borrow_owner_cap<NetworkNode>(
            ts::receiving_ticket_by_id<OwnerCap<NetworkNode>>(nwn_owner_cap_id),
            ts.ctx(),
        );
        let clock = clock::create_for_testing(ts.ctx());

        ts::next_tx(ts, user_a());
        {
            let mut nwn = ts::take_shared_by_id<NetworkNode>(ts, nwn_id);
            nwn.deposit_fuel_test(&nwn_cap, FUEL_TYPE_ID, FUEL_VOLUME, 10, &clock);
            nwn.online(&nwn_cap, &clock);
            ts::return_shared(nwn);
        };

        character.return_owner_cap(nwn_cap, nwn_receipt);

        // Step 2: borrow SSU owner cap, bring SSU online
        let ssu_owner_cap_id = {
            let ssu = ts::take_shared_by_id<StorageUnit>(ts, ssu_id);
            let id = ssu.owner_cap_id();
            ts::return_shared(ssu);
            id
        };
        let (ssu_cap, ssu_receipt) = character.borrow_owner_cap<StorageUnit>(
            ts::receiving_ticket_by_id<OwnerCap<StorageUnit>>(ssu_owner_cap_id),
            ts.ctx(),
        );

        ts::next_tx(ts, user_a());
        {
            let mut ssu = ts::take_shared_by_id<StorageUnit>(ts, ssu_id);
            let mut nwn = ts::take_shared_by_id<NetworkNode>(ts, nwn_id);
            let energy_config = ts::take_shared<EnergyConfig>(ts);
            ssu.online(&mut nwn, &energy_config, &ssu_cap);
            ts::return_shared(ssu);
            ts::return_shared(nwn);
            ts::return_shared(energy_config);
        };

        character.return_owner_cap(ssu_cap, ssu_receipt);
        ts::return_shared(character);
        clock.destroy_for_testing();
    }

    /// Registers EfGuardSSUAuth on the SSU; shares SSUExtensionConfig; returns its ID.
    fun authorize_ef_guard_ssu(
        ts: &mut ts::Scenario,
        char_id: ID,
        ssu_id: ID,
        allow_deposit: bool,
        allow_withdraw: bool,
    ): ID {
        ts::next_tx(ts, user_a());
        let mut ssu = ts::take_shared_by_id<StorageUnit>(ts, ssu_id);
        let mut character = ts::take_shared_by_id<Character>(ts, char_id);
        let owner_cap_id = ssu.owner_cap_id();
        let (cap, receipt) = character.borrow_owner_cap<StorageUnit>(
            ts::receiving_ticket_by_id<OwnerCap<StorageUnit>>(owner_cap_id),
            ts.ctx(),
        );
        let config = ssu_extension::authorize_on_ssu(&mut ssu, &cap, allow_deposit, allow_withdraw, ts.ctx());
        let config_id = object::id(&config);
        ssu_extension::share_config(config);
        character.return_owner_cap(cap, receipt);
        ts::return_shared(ssu);
        ts::return_shared(character);
        config_id
    }

    /// Mints AMMO_QUANTITY ammo items into the SSU's main inventory via the owner cap.
    fun mint_ammo(ts: &mut ts::Scenario, char_id: ID, ssu_id: ID) {
        ts::next_tx(ts, user_a());
        let mut ssu = ts::take_shared_by_id<StorageUnit>(ts, ssu_id);
        let mut character = ts::take_shared_by_id<Character>(ts, char_id);
        let owner_cap_id = ssu.owner_cap_id();
        let (cap, receipt) = character.borrow_owner_cap<StorageUnit>(
            ts::receiving_ticket_by_id<OwnerCap<StorageUnit>>(owner_cap_id),
            ts.ctx(),
        );
        ssu.game_item_to_chain_inventory_test<StorageUnit>(
            &character, &cap,
            AMMO_ITEM_ID, AMMO_TYPE_ID, AMMO_VOLUME, AMMO_QUANTITY,
            ts.ctx(),
        );
        character.return_owner_cap(cap, receipt);
        ts::return_shared(ssu);
        ts::return_shared(character);
    }

    // ── Policy factory helpers ────────────────────────────────────────────────

    /// Binding where CHAR_A is allowed on the given SSU via inline policy rules.
    fun make_allow_binding_for_char_a(ssu_id: ID, ctx: &mut TxContext): assembly_binding::AssemblyBinding {
        let mut binding = assembly_binding::new_binding(ctx);
        assembly_binding::register_ssu(&mut binding, ssu_id, ctx);
        assembly_binding::set_policy(
            &mut binding, ssu_id,
            vector[assembly_binding::rule(
                assembly_binding::character(CHAR_A_GAME_ID),
                assembly_binding::allow(),
            )],
            ctx,
        );
        binding
    }

    /// Binding where CHAR_A is denied on the given SSU via inline policy rules.
    fun make_deny_binding_for_char_a(ssu_id: ID, ctx: &mut TxContext): assembly_binding::AssemblyBinding {
        let mut binding = assembly_binding::new_binding(ctx);
        assembly_binding::register_ssu(&mut binding, ssu_id, ctx);
        assembly_binding::set_policy(
            &mut binding, ssu_id,
            vector[assembly_binding::rule(
                assembly_binding::character(CHAR_A_GAME_ID),
                assembly_binding::deny(),
            )],
            ctx,
        );
        binding
    }

    /// Binding with CHAR_A on the blocklist.
    fun make_blocklist_binding(ctx: &mut TxContext): assembly_binding::AssemblyBinding {
        let mut binding = assembly_binding::new_binding(ctx);
        assembly_binding::add_to_blocklist(&mut binding, CHAR_A_GAME_ID, ctx);
        binding
    }

    /// Empty binding -- no policies, no blocklist. Any character resolves to Default (denied).
    fun make_empty_binding(ctx: &mut TxContext): assembly_binding::AssemblyBinding {
        assembly_binding::new_binding(ctx)
    }

    // ── Config tests ──────────────────────────────────────────────────────────

    #[test]
    fun authorize_on_ssu_creates_config_with_correct_ssu_id() {
        let mut ts = ts::begin(governor());
        setup(&mut ts);
        let char_id = create_character_a(&mut ts);
        let nwn_id = create_nwn(&mut ts, char_id, NWN_ITEM_ID_1);
        let ssu_id = create_ssu(&mut ts, char_id, nwn_id, SSU_ITEM_ID_1);
        online_ssu(&mut ts, char_id, ssu_id, nwn_id);
        let config_id = authorize_ef_guard_ssu(&mut ts, char_id, ssu_id, true, false);

        ts::next_tx(&mut ts, user_a());
        {
            let config = ts::take_shared_by_id<ssu_extension::SSUExtensionConfig>(&ts, config_id);
            assert!(ssu_extension::ssu_id(&config) == ssu_id);
            assert!(ssu_extension::allow_deposit(&config));
            assert!(!ssu_extension::allow_withdraw(&config));
            ts::return_shared(config);
        };
        ts::end(ts);
    }

    // ── Withdraw tests ────────────────────────────────────────────────────────

    #[test]
    fun withdraw_succeeds_for_allowed_character() {
        let mut ts = ts::begin(governor());
        setup(&mut ts);
        let char_id = create_character_a(&mut ts);
        let nwn_id = create_nwn(&mut ts, char_id, NWN_ITEM_ID_1);
        let ssu_id = create_ssu(&mut ts, char_id, nwn_id, SSU_ITEM_ID_1);
        online_ssu(&mut ts, char_id, ssu_id, nwn_id);
        let config_id = authorize_ef_guard_ssu(&mut ts, char_id, ssu_id, true, true);
        mint_ammo(&mut ts, char_id, ssu_id);

        ts::next_tx(&mut ts, user_a());
        {
            let config = ts::take_shared_by_id<ssu_extension::SSUExtensionConfig>(&ts, config_id);
            let mut ssu = ts::take_shared_by_id<StorageUnit>(&ts, ssu_id);
            let character = ts::take_shared_by_id<Character>(&ts, char_id);
            let binding = make_allow_binding_for_char_a(ssu_id, ts.ctx());

            let item = ssu_extension::withdraw(
                &config, &binding, &mut ssu, &character,
                AMMO_TYPE_ID, AMMO_QUANTITY, ts.ctx(),
            );
            // Item has no drop -- deposit back to clean up
            ssu_extension::deposit(&config, &binding, &mut ssu, &character, item, ts.ctx());

            ts::return_shared(config);
            ts::return_shared(ssu);
            ts::return_shared(character);
            destroy(binding);
        };
        ts::end(ts);
    }

    #[test]
    #[expected_failure(abort_code = ef_guard::ssu_extension::EWithdrawDisabled)]
    fun withdraw_aborts_when_allow_withdraw_false() {
        let mut ts = ts::begin(governor());
        setup(&mut ts);
        let char_id = create_character_a(&mut ts);
        let nwn_id = create_nwn(&mut ts, char_id, NWN_ITEM_ID_1);
        let ssu_id = create_ssu(&mut ts, char_id, nwn_id, SSU_ITEM_ID_1);
        online_ssu(&mut ts, char_id, ssu_id, nwn_id);
        let config_id = authorize_ef_guard_ssu(&mut ts, char_id, ssu_id, true, false);
        mint_ammo(&mut ts, char_id, ssu_id);

        ts::next_tx(&mut ts, user_a());
        {
            let config = ts::take_shared_by_id<ssu_extension::SSUExtensionConfig>(&ts, config_id);
            let mut ssu = ts::take_shared_by_id<StorageUnit>(&ts, ssu_id);
            let character = ts::take_shared_by_id<Character>(&ts, char_id);
            let binding = make_allow_binding_for_char_a(ssu_id, ts.ctx());
            let item = ssu_extension::withdraw(
                &config, &binding, &mut ssu, &character,
                AMMO_TYPE_ID, AMMO_QUANTITY, ts.ctx(),
            );
            transfer::public_transfer(item, @0x0); // unreachable -- abort fires first
            abort 999
        };
    }

    #[test]
    #[expected_failure(abort_code = ef_guard::ssu_extension::EAccessDenied)]
    fun withdraw_denied_for_blocklisted_character() {
        let mut ts = ts::begin(governor());
        setup(&mut ts);
        let char_id = create_character_a(&mut ts);
        let nwn_id = create_nwn(&mut ts, char_id, NWN_ITEM_ID_1);
        let ssu_id = create_ssu(&mut ts, char_id, nwn_id, SSU_ITEM_ID_1);
        online_ssu(&mut ts, char_id, ssu_id, nwn_id);
        let config_id = authorize_ef_guard_ssu(&mut ts, char_id, ssu_id, true, true);
        mint_ammo(&mut ts, char_id, ssu_id);

        ts::next_tx(&mut ts, user_a());
        {
            let config = ts::take_shared_by_id<ssu_extension::SSUExtensionConfig>(&ts, config_id);
            let mut ssu = ts::take_shared_by_id<StorageUnit>(&ts, ssu_id);
            let character = ts::take_shared_by_id<Character>(&ts, char_id);
            let binding = make_blocklist_binding(ts.ctx());
            let item = ssu_extension::withdraw(
                &config, &binding, &mut ssu, &character,
                AMMO_TYPE_ID, AMMO_QUANTITY, ts.ctx(),
            );
            transfer::public_transfer(item, @0x0); // unreachable -- abort fires first
            abort 999
        };
    }

    #[test]
    #[expected_failure(abort_code = ef_guard::ssu_extension::EAccessDenied)]
    fun withdraw_denied_for_default_character_no_policies() {
        let mut ts = ts::begin(governor());
        setup(&mut ts);
        let char_id = create_character_a(&mut ts);
        let nwn_id = create_nwn(&mut ts, char_id, NWN_ITEM_ID_1);
        let ssu_id = create_ssu(&mut ts, char_id, nwn_id, SSU_ITEM_ID_1);
        online_ssu(&mut ts, char_id, ssu_id, nwn_id);
        let config_id = authorize_ef_guard_ssu(&mut ts, char_id, ssu_id, true, true);
        mint_ammo(&mut ts, char_id, ssu_id);

        ts::next_tx(&mut ts, user_a());
        {
            let config = ts::take_shared_by_id<ssu_extension::SSUExtensionConfig>(&ts, config_id);
            let mut ssu = ts::take_shared_by_id<StorageUnit>(&ts, ssu_id);
            let character = ts::take_shared_by_id<Character>(&ts, char_id);
            let binding = make_empty_binding(ts.ctx());
            let item = ssu_extension::withdraw(
                &config, &binding, &mut ssu, &character,
                AMMO_TYPE_ID, AMMO_QUANTITY, ts.ctx(),
            );
            transfer::public_transfer(item, @0x0); // unreachable -- abort fires first
            abort 999
        };
    }

    // ── Deposit tests ─────────────────────────────────────────────────────────

    #[test]
    fun deposit_succeeds_for_allowed_character() {
        let mut ts = ts::begin(governor());
        setup(&mut ts);
        let char_id = create_character_a(&mut ts);
        let nwn_id = create_nwn(&mut ts, char_id, NWN_ITEM_ID_1);
        let ssu_id = create_ssu(&mut ts, char_id, nwn_id, SSU_ITEM_ID_1);
        online_ssu(&mut ts, char_id, ssu_id, nwn_id);
        let config_id = authorize_ef_guard_ssu(&mut ts, char_id, ssu_id, true, true);
        mint_ammo(&mut ts, char_id, ssu_id);

        ts::next_tx(&mut ts, user_a());
        {
            let config = ts::take_shared_by_id<ssu_extension::SSUExtensionConfig>(&ts, config_id);
            let mut ssu = ts::take_shared_by_id<StorageUnit>(&ts, ssu_id);
            let character = ts::take_shared_by_id<Character>(&ts, char_id);
            let binding = make_allow_binding_for_char_a(ssu_id, ts.ctx());

            // Withdraw first to get an Item value to deposit
            let item = ssu_extension::withdraw(
                &config, &binding, &mut ssu, &character,
                AMMO_TYPE_ID, AMMO_QUANTITY, ts.ctx(),
            );
            // Deposit -- the operation under test
            ssu_extension::deposit(&config, &binding, &mut ssu, &character, item, ts.ctx());

            ts::return_shared(config);
            ts::return_shared(ssu);
            ts::return_shared(character);
            destroy(binding);
        };
        ts::end(ts);
    }

    #[test]
    #[expected_failure(abort_code = ef_guard::ssu_extension::EDepositDisabled)]
    fun deposit_aborts_when_allow_deposit_false() {
        let mut ts = ts::begin(governor());
        setup(&mut ts);
        let char_id = create_character_a(&mut ts);
        let nwn_id = create_nwn(&mut ts, char_id, NWN_ITEM_ID_1);
        let ssu_id = create_ssu(&mut ts, char_id, nwn_id, SSU_ITEM_ID_1);
        online_ssu(&mut ts, char_id, ssu_id, nwn_id);
        let config_id = authorize_ef_guard_ssu(&mut ts, char_id, ssu_id, false, true);
        mint_ammo(&mut ts, char_id, ssu_id);

        ts::next_tx(&mut ts, user_a());
        {
            let config = ts::take_shared_by_id<ssu_extension::SSUExtensionConfig>(&ts, config_id);
            let mut ssu = ts::take_shared_by_id<StorageUnit>(&ts, ssu_id);
            let mut character = ts::take_shared_by_id<Character>(&ts, char_id);

            // Get an item via owner access (bypasses extension flag checks)
            let owner_cap_id = ssu.owner_cap_id();
            let (cap, receipt) = character.borrow_owner_cap<StorageUnit>(
                ts::receiving_ticket_by_id<OwnerCap<StorageUnit>>(owner_cap_id),
                ts.ctx(),
            );
            let item = ssu.withdraw_by_owner(&character, &cap, AMMO_TYPE_ID, AMMO_QUANTITY, ts.ctx());
            character.return_owner_cap(cap, receipt);

            let binding = make_allow_binding_for_char_a(ssu_id, ts.ctx());
            // allow_deposit=false -> EDepositDisabled
            ssu_extension::deposit(&config, &binding, &mut ssu, &character, item, ts.ctx());
            abort 999
        };
    }

    #[test]
    #[expected_failure(abort_code = ef_guard::ssu_extension::EAccessDenied)]
    fun deposit_denied_for_blocklisted_character() {
        let mut ts = ts::begin(governor());
        setup(&mut ts);
        let char_id = create_character_a(&mut ts);
        let nwn_id = create_nwn(&mut ts, char_id, NWN_ITEM_ID_1);
        let ssu_id = create_ssu(&mut ts, char_id, nwn_id, SSU_ITEM_ID_1);
        online_ssu(&mut ts, char_id, ssu_id, nwn_id);
        let config_id = authorize_ef_guard_ssu(&mut ts, char_id, ssu_id, true, true);
        mint_ammo(&mut ts, char_id, ssu_id);

        ts::next_tx(&mut ts, user_a());
        {
            let config = ts::take_shared_by_id<ssu_extension::SSUExtensionConfig>(&ts, config_id);
            let mut ssu = ts::take_shared_by_id<StorageUnit>(&ts, ssu_id);
            let mut character = ts::take_shared_by_id<Character>(&ts, char_id);

            let owner_cap_id = ssu.owner_cap_id();
            let (cap, receipt) = character.borrow_owner_cap<StorageUnit>(
                ts::receiving_ticket_by_id<OwnerCap<StorageUnit>>(owner_cap_id),
                ts.ctx(),
            );
            let item = ssu.withdraw_by_owner(&character, &cap, AMMO_TYPE_ID, AMMO_QUANTITY, ts.ctx());
            character.return_owner_cap(cap, receipt);

            let binding = make_blocklist_binding(ts.ctx());
            ssu_extension::deposit(&config, &binding, &mut ssu, &character, item, ts.ctx());
            abort 999
        };
    }

    #[test]
    #[expected_failure(abort_code = ef_guard::ssu_extension::EAccessDenied)]
    fun deposit_denied_by_policy_deny_rule() {
        let mut ts = ts::begin(governor());
        setup(&mut ts);
        let char_id = create_character_a(&mut ts);
        let nwn_id = create_nwn(&mut ts, char_id, NWN_ITEM_ID_1);
        let ssu_id = create_ssu(&mut ts, char_id, nwn_id, SSU_ITEM_ID_1);
        online_ssu(&mut ts, char_id, ssu_id, nwn_id);
        let config_id = authorize_ef_guard_ssu(&mut ts, char_id, ssu_id, true, true);
        mint_ammo(&mut ts, char_id, ssu_id);

        ts::next_tx(&mut ts, user_a());
        {
            let config = ts::take_shared_by_id<ssu_extension::SSUExtensionConfig>(&ts, config_id);
            let mut ssu = ts::take_shared_by_id<StorageUnit>(&ts, ssu_id);
            let mut character = ts::take_shared_by_id<Character>(&ts, char_id);

            let owner_cap_id = ssu.owner_cap_id();
            let (cap, receipt) = character.borrow_owner_cap<StorageUnit>(
                ts::receiving_ticket_by_id<OwnerCap<StorageUnit>>(owner_cap_id),
                ts.ctx(),
            );
            let item = ssu.withdraw_by_owner(&character, &cap, AMMO_TYPE_ID, AMMO_QUANTITY, ts.ctx());
            character.return_owner_cap(cap, receipt);

            // Policy denies char_a -> EAccessDenied
            let binding = make_deny_binding_for_char_a(ssu_id, ts.ctx());
            ssu_extension::deposit(&config, &binding, &mut ssu, &character, item, ts.ctx());
            abort 999
        };
    }

    // ── Wrong SSU test ────────────────────────────────────────────────────────

    #[test]
    #[expected_failure(abort_code = ef_guard::ssu_extension::EWrongSSU)]
    fun deposit_with_wrong_ssu_aborts() {
        let mut ts = ts::begin(governor());
        setup(&mut ts);
        let char_id = create_character_a(&mut ts);

        // Create two SSUs, each with their own NWN
        let nwn1_id = create_nwn(&mut ts, char_id, NWN_ITEM_ID_1);
        let ssu1_id = create_ssu(&mut ts, char_id, nwn1_id, SSU_ITEM_ID_1);
        let nwn2_id = create_nwn(&mut ts, char_id, NWN_ITEM_ID_2);
        let ssu2_id = create_ssu(&mut ts, char_id, nwn2_id, SSU_ITEM_ID_2);

        online_ssu(&mut ts, char_id, ssu1_id, nwn1_id);
        online_ssu(&mut ts, char_id, ssu2_id, nwn2_id);

        // config1 is bound to ssu1_id
        let config1_id = authorize_ef_guard_ssu(&mut ts, char_id, ssu1_id, true, true);
        // Also authorize ssu2 so the world-level extension check passes
        authorize_ef_guard_ssu(&mut ts, char_id, ssu2_id, true, true);
        mint_ammo(&mut ts, char_id, ssu2_id);

        ts::next_tx(&mut ts, user_a());
        {
            // config1 was created for ssu1; passing ssu2 -> EWrongSSU
            let config1 = ts::take_shared_by_id<ssu_extension::SSUExtensionConfig>(&ts, config1_id);
            let mut ssu2 = ts::take_shared_by_id<StorageUnit>(&ts, ssu2_id);
            let character = ts::take_shared_by_id<Character>(&ts, char_id);
            let binding = make_allow_binding_for_char_a(ssu1_id, ts.ctx());
            let item = ssu_extension::withdraw(
                &config1, &binding, &mut ssu2, &character,
                AMMO_TYPE_ID, AMMO_QUANTITY, ts.ctx(),
            );
            transfer::public_transfer(item, @0x0); // unreachable -- EWrongSSU fires first
            abort 999
        };
    }
}
