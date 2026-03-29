/// Threat-level overrides evaluated **before** policy group rules on every access decision.
///
/// `ThreatConfig` is embedded inside `AssemblyBinding` — it is not a standalone shared
/// object. All write access goes through the binding owner's auth check.
///
/// Two override mechanisms:
///   - `blocklist`: a permanent per-base deny list of character game IDs. Checked on
///     all assembly types (gate, turret, SSU). Cannot be bypassed by group membership.
///   - `block_aggressors`: turret-context-only toggle. When enabled, any candidate
///     flagged `is_aggressor=true` by the game server receives deny weight regardless
///     of policy group evaluation.
///
/// Events for blocklist and aggressor-toggle changes are emitted by `assembly_binding`
/// (which has the binding_id and caller context). This module contains no emit calls.
module ef_guard::security_status {
    use sui::vec_set::{Self, VecSet};

    // ── Data model ───────────────────────────────────────────────────────────

    /// Threat override configuration. Stored inside `AssemblyBinding`.
    public struct ThreatConfig has store {
        /// When `true`, any target candidate flagged `is_aggressor=true` by the
        /// game server receives the turret's deny weight regardless of group policy.
        /// Has no effect in gate or SSU contexts (aggressor data not available there).
        block_aggressors: bool,

        /// Permanently denied character game IDs. Checked on every access decision
        /// across all assembly types. Cannot be overridden by group membership.
        blocklist: VecSet<u64>,
    }

    // ── Constructor ──────────────────────────────────────────────────────────

    /// Return a permissive config: aggressors not blocked, empty blocklist.
    public fun default_config(): ThreatConfig {
        ThreatConfig {
            block_aggressors: false,
            blocklist:        vec_set::empty(),
        }
    }

    // ── Aggressor toggle ─────────────────────────────────────────────────────

    public fun set_block_aggressors(config: &mut ThreatConfig, value: bool) {
        config.block_aggressors = value;
    }

    public fun blocks_aggressors(config: &ThreatConfig): bool { config.block_aggressors }

    // ── Blocklist management ─────────────────────────────────────────────────

    /// Add `char_game_id` to the permanent blocklist. No-op if already present.
    public fun add_to_blocklist(config: &mut ThreatConfig, char_game_id: u64) {
        if (!config.blocklist.contains(&char_game_id)) {
            config.blocklist.insert(char_game_id);
        }
    }

    /// Remove `char_game_id` from the blocklist. No-op if not present.
    public fun remove_from_blocklist(config: &mut ThreatConfig, char_game_id: u64) {
        if (config.blocklist.contains(&char_game_id)) {
            config.blocklist.remove(&char_game_id);
        }
    }

    public fun is_blocklisted(config: &ThreatConfig, char_game_id: u64): bool {
        config.blocklist.contains(&char_game_id)
    }

    // ── Override checks ──────────────────────────────────────────────────────

    /// Turret context: returns `false` if blocklisted **or** if the candidate is
    /// flagged as an aggressor while `block_aggressors` is enabled.
    /// Blocklist check takes priority over the aggressor check.
    public fun passes_aggressor_override(
        config:       &ThreatConfig,
        char_game_id: u64,
        is_aggressor: bool,
    ): bool {
        if (is_blocklisted(config, char_game_id)) return false;
        if (config.block_aggressors && is_aggressor) return false;
        true
    }
}
