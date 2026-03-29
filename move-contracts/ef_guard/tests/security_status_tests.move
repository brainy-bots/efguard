#[test_only]
module ef_guard::security_status_tests {
    use ef_guard::security_status;
    use std::unit_test::destroy;

    const CHAR_A: u64 = 42;
    const CHAR_B: u64 = 99;
    const NPC: u64 = 0;

    // ── Default config ───────────────────────────────────────────────────────

    #[test]
    fun default_config_does_not_block_aggressors() {
        let config = security_status::default_config();

        assert!(!security_status::blocks_aggressors(&config));

        destroy(config);
    }

    #[test]
    fun default_config_has_empty_blocklist() {
        let config = security_status::default_config();

        assert!(!security_status::is_blocklisted(&config, CHAR_A));
        assert!(!security_status::is_blocklisted(&config, CHAR_B));

        destroy(config);
    }

    // ── Blocklist management ─────────────────────────────────────────────────

    #[test]
    fun add_to_blocklist_marks_character_blocklisted() {
        let mut config = security_status::default_config();

        security_status::add_to_blocklist(&mut config, CHAR_A);

        assert!(security_status::is_blocklisted(&config, CHAR_A));
        assert!(!security_status::is_blocklisted(&config, CHAR_B)); // unaffected

        destroy(config);
    }

    #[test]
    fun remove_from_blocklist_clears_character() {
        let mut config = security_status::default_config();
        security_status::add_to_blocklist(&mut config, CHAR_A);

        security_status::remove_from_blocklist(&mut config, CHAR_A);

        assert!(!security_status::is_blocklisted(&config, CHAR_A));

        destroy(config);
    }

    #[test]
    fun remove_absent_character_from_blocklist_is_noop() {
        let mut config = security_status::default_config();

        security_status::remove_from_blocklist(&mut config, CHAR_A); // not present — should not abort

        assert!(!security_status::is_blocklisted(&config, CHAR_A));

        destroy(config);
    }

    #[test]
    fun multiple_characters_can_be_blocklisted_independently() {
        let mut config = security_status::default_config();
        security_status::add_to_blocklist(&mut config, CHAR_A);
        security_status::add_to_blocklist(&mut config, CHAR_B);

        assert!(security_status::is_blocklisted(&config, CHAR_A));
        assert!(security_status::is_blocklisted(&config, CHAR_B));

        security_status::remove_from_blocklist(&mut config, CHAR_A);

        assert!(!security_status::is_blocklisted(&config, CHAR_A));
        assert!(security_status::is_blocklisted(&config, CHAR_B)); // unaffected

        destroy(config);
    }

    // ── passes_aggressor_override (turret context) ────────────────────────────

    #[test]
    fun aggressor_override_not_aggressor_aggressors_blocked_returns_true() {
        let mut config = security_status::default_config();
        security_status::set_block_aggressors(&mut config, true);

        assert!(security_status::passes_aggressor_override(&config, CHAR_A, false));

        destroy(config);
    }

    #[test]
    fun aggressor_override_is_aggressor_aggressors_blocked_returns_false() {
        let mut config = security_status::default_config();
        security_status::set_block_aggressors(&mut config, true);

        assert!(!security_status::passes_aggressor_override(&config, CHAR_A, true));

        destroy(config);
    }

    #[test]
    fun aggressor_override_is_aggressor_aggressors_not_blocked_returns_true() {
        let config = security_status::default_config();
        // block_aggressors defaults to false — aggressors must pass

        assert!(security_status::passes_aggressor_override(&config, CHAR_A, true));

        destroy(config);
    }

    #[test]
    fun aggressor_override_blocklisted_not_aggressor_returns_false() {
        // Blocklist applies even without aggressor flag — blocklist takes priority
        let mut config = security_status::default_config();
        security_status::add_to_blocklist(&mut config, CHAR_A);

        assert!(!security_status::passes_aggressor_override(&config, CHAR_A, false));

        destroy(config);
    }

    #[test]
    fun aggressor_override_blocklisted_and_aggressor_returns_false() {
        let mut config = security_status::default_config();
        security_status::add_to_blocklist(&mut config, CHAR_A);
        security_status::set_block_aggressors(&mut config, true);

        assert!(!security_status::passes_aggressor_override(&config, CHAR_A, true));

        destroy(config);
    }

    #[test]
    fun aggressor_override_npc_not_blocklisted_returns_true() {
        // NPC (character_id = 0) with default config must pass
        let config = security_status::default_config();

        assert!(security_status::passes_aggressor_override(&config, NPC, false));

        destroy(config);
    }

    // ── Toggle ───────────────────────────────────────────────────────────────

    #[test]
    fun set_block_aggressors_can_be_toggled_on_and_off() {
        let mut config = security_status::default_config();

        assert!(!security_status::blocks_aggressors(&config));

        security_status::set_block_aggressors(&mut config, true);
        assert!(security_status::blocks_aggressors(&config));

        security_status::set_block_aggressors(&mut config, false);
        assert!(!security_status::blocks_aggressors(&config));

        destroy(config);
    }
}
