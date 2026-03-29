#[test_only]
module ef_guard::identity_resolver_tests {
    use ef_guard::identity_resolver;
    use std::string::utf8;
    use sui::test_scenario as ts;
    use world::{
        access::AdminACL,
        character,
        object_registry::ObjectRegistry,
        test_helpers::{Self, admin, governor, user_a, user_b},
    };

    // Character A: game_char_id=42, tribe=7
    const CHAR_A_ITEM_ID: u32 = 42;
    const CHAR_A_GAME_ID: u64 = 42; // same value, u64 for policy rules
    const TRIBE_X: u32 = 7;

    // Character B: game_char_id=99, tribe=8
    const CHAR_B_ITEM_ID: u32 = 99;
    const CHAR_B_GAME_ID: u64 = 99;
    const TRIBE_Y: u32 = 8;

    // ── Helpers ───────────────────────────────────────────────────────────────

    fun setup(ts: &mut ts::Scenario) {
        test_helpers::setup_world(ts);
    }

    fun create_character(ts: &mut ts::Scenario, user: address, item_id: u32, tribe_id: u32): ID {
        ts::next_tx(ts, admin());
        let admin_acl = ts::take_shared<AdminACL>(ts);
        let mut registry = ts::take_shared<ObjectRegistry>(ts);
        let character = character::create_character(
            &mut registry,
            &admin_acl,
            item_id,
            test_helpers::tenant(),
            tribe_id,
            user,
            utf8(b"test character"),
            ts.ctx(),
        );
        let character_id = object::id(&character);
        character.share_character(&admin_acl, ts.ctx());
        ts::return_shared(registry);
        ts::return_shared(admin_acl);
        character_id
    }

    // ── Tests ─────────────────────────────────────────────────────────────────

    #[test]
    fun resolve_returns_correct_game_id_and_tribe_id() {
        let mut ts = ts::begin(governor());
        setup(&mut ts);
        let char_id = create_character(&mut ts, user_a(), CHAR_A_ITEM_ID, TRIBE_X);

        ts::next_tx(&mut ts, user_a());
        {
            let character = ts::take_shared_by_id<world::character::Character>(&ts, char_id);
            let (game_id, tribe_id) = identity_resolver::resolve(&character);
            assert!(game_id == CHAR_A_GAME_ID);
            assert!(tribe_id == TRIBE_X);
            ts::return_shared(character);
        };
        ts::end(ts);
    }

    #[test]
    fun char_game_id_accessor_matches_resolve() {
        let mut ts = ts::begin(governor());
        setup(&mut ts);
        let char_id = create_character(&mut ts, user_a(), CHAR_A_ITEM_ID, TRIBE_X);

        ts::next_tx(&mut ts, user_a());
        {
            let character = ts::take_shared_by_id<world::character::Character>(&ts, char_id);
            let (expected, _) = identity_resolver::resolve(&character);
            assert!(identity_resolver::char_game_id(&character) == expected);
            ts::return_shared(character);
        };
        ts::end(ts);
    }

    #[test]
    fun tribe_id_accessor_matches_resolve() {
        let mut ts = ts::begin(governor());
        setup(&mut ts);
        let char_id = create_character(&mut ts, user_a(), CHAR_A_ITEM_ID, TRIBE_X);

        ts::next_tx(&mut ts, user_a());
        {
            let character = ts::take_shared_by_id<world::character::Character>(&ts, char_id);
            let (_, expected) = identity_resolver::resolve(&character);
            assert!(identity_resolver::tribe_id(&character) == expected);
            ts::return_shared(character);
        };
        ts::end(ts);
    }

    #[test]
    fun two_characters_have_distinct_identities() {
        let mut ts = ts::begin(governor());
        setup(&mut ts);
        let char_a_id = create_character(&mut ts, user_a(), CHAR_A_ITEM_ID, TRIBE_X);
        let char_b_id = create_character(&mut ts, user_b(), CHAR_B_ITEM_ID, TRIBE_Y);

        ts::next_tx(&mut ts, user_a());
        {
            let char_a = ts::take_shared_by_id<world::character::Character>(&ts, char_a_id);
            let char_b = ts::take_shared_by_id<world::character::Character>(&ts, char_b_id);

            let (game_id_a, tribe_a) = identity_resolver::resolve(&char_a);
            let (game_id_b, tribe_b) = identity_resolver::resolve(&char_b);

            assert!(game_id_a == CHAR_A_GAME_ID);
            assert!(game_id_b == CHAR_B_GAME_ID);
            assert!(tribe_a == TRIBE_X);
            assert!(tribe_b == TRIBE_Y);
            assert!(game_id_a != game_id_b);
            assert!(tribe_a != tribe_b);

            ts::return_shared(char_a);
            ts::return_shared(char_b);
        };
        ts::end(ts);
    }
}
