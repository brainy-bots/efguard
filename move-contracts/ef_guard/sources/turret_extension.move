/// Smart Turret extension. Applies ef_guard policy rules to each candidate's
/// priority weight and returns a BCS-encoded target list.
module ef_guard::turret_extension {
    use ef_guard::assembly_binding::{Self, AssemblyBinding};
    use ef_guard::identity_resolver;
    use ef_guard::security_status;
    use world::access::{Self, OwnerCap};
    use world::character::Character;
    use world::turret::{Self, Turret, TargetCandidate, ReturnTargetPriorityList};
    use sui::bcs;
    use sui::event;

    const EWrongTurret: u64 = 0;

    public struct EfGuardTurretAuth has drop {}

    public struct TurretExtensionConfig has key {
        id:           UID,
        turret_id:    ID,
        deny_weight:  u64,
        allow_weight: u64,
    }

    public struct TargetWeightedEvent has copy, drop {
        config_id:       ID,
        turret_id:       ID,
        char_game_id:    u64,
        tribe_id:        u32,
        is_aggressor:    bool,
        assigned_weight: u64,
        excluded:        bool,
        override_reason: u8,
    }

    public fun authorize_on_turret(
        turret:       &mut Turret,
        owner_cap:    &OwnerCap<Turret>,
        deny_weight:  u64,
        allow_weight: u64,
        ctx:          &mut TxContext,
    ): TurretExtensionConfig {
        turret::authorize_extension<EfGuardTurretAuth>(turret, owner_cap);
        TurretExtensionConfig {
            id:           object::new(ctx),
            turret_id:    object::id(turret),
            deny_weight,
            allow_weight,
        }
    }

    public fun get_target_priority_list(
        config:                &TurretExtensionConfig,
        binding:               &AssemblyBinding,
        turret:                &Turret,
        owner_character:       &Character,
        target_candidate_list: vector<u8>,
    ): vector<u8> {
        assert!(object::id(turret) == config.turret_id, EWrongTurret);

        let receipt   = turret::verify_online(turret);
        let config_id = object::id(config);
        let turret_id = object::id(turret);
        let threat    = assembly_binding::threat_config(binding);

        let candidates = turret::unpack_candidate_list(target_candidate_list);
        let mut result: vector<ReturnTargetPriorityList> = vector[];

        let len = candidates.length();
        let mut i = 0;
        while (i < len) {
            let candidate = &candidates[i];
            let (final_weight, excluded, reason) = resolve_candidate(
                config, binding, threat, candidate, owner_character,
            );

            event::emit(TargetWeightedEvent {
                config_id, turret_id,
                char_game_id: (turret::character_id(candidate) as u64),
                tribe_id:     turret::character_tribe(candidate),
                is_aggressor: turret::is_aggressor(candidate),
                assigned_weight: final_weight,
                excluded, override_reason: reason,
            });

            if (!excluded) {
                result.push_back(
                    turret::new_return_target_priority_list(
                        turret::item_id(candidate), final_weight,
                    )
                );
            };
            i = i + 1;
        };

        turret::destroy_online_receipt<EfGuardTurretAuth>(receipt, EfGuardTurretAuth {});
        bcs::to_bytes(&result)
    }

    public fun set_deny_weight(config: &mut TurretExtensionConfig, owner_cap: &OwnerCap<Turret>, weight: u64) {
        assert!(access::is_authorized(owner_cap, config.turret_id), EWrongTurret);
        config.deny_weight = weight;
    }
    public fun set_allow_weight(config: &mut TurretExtensionConfig, owner_cap: &OwnerCap<Turret>, weight: u64) {
        assert!(access::is_authorized(owner_cap, config.turret_id), EWrongTurret);
        config.allow_weight = weight;
    }
    public fun turret_id(config: &TurretExtensionConfig): ID     { config.turret_id }
    public fun deny_weight(config: &TurretExtensionConfig): u64  { config.deny_weight }
    public fun allow_weight(config: &TurretExtensionConfig): u64 { config.allow_weight }
    public fun share_config(config: TurretExtensionConfig) { transfer::share_object(config); }

    fun resolve_candidate(
        config:          &TurretExtensionConfig,
        binding:         &AssemblyBinding,
        threat:          &ef_guard::security_status::ThreatConfig,
        candidate:       &TargetCandidate,
        owner_character: &Character,
    ): (u64, bool, u8) {
        let char_game_id = (turret::character_id(candidate) as u64);
        let tribe_id     = turret::character_tribe(candidate);
        let is_aggressor = turret::is_aggressor(candidate);
        let base_weight  = turret::priority_weight(candidate);

        if (security_status::is_blocklisted(threat, char_game_id)) {
            return (config.deny_weight, false, 1)
        };
        if (!security_status::passes_aggressor_override(threat, char_game_id, is_aggressor)) {
            return (config.deny_weight, false, 2)
        };

        let decision = assembly_binding::resolve_role(binding, config.turret_id, char_game_id, tribe_id);
        if (assembly_binding::is_deny(&decision)) {
            return (config.deny_weight, false, 3)
        };
        if (assembly_binding::is_allow(&decision)) {
            return (config.allow_weight, true, 4)
        };

        // Default — owner and friendly excluded
        let owner_game_id = identity_resolver::char_game_id(owner_character);
        let owner_tribe   = identity_resolver::tribe_id(owner_character);
        let is_owner       = char_game_id != 0 && char_game_id == owner_game_id;
        let same_tribe     = tribe_id == owner_tribe;

        if (is_owner || (same_tribe && !is_aggressor)) {
            return (0, true, 0)
        };

        (base_weight, false, 0)
    }
}
