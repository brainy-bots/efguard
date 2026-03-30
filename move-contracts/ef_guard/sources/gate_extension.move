/// Smart Gate extension. Checks access via `AssemblyBinding` condition proofs
/// and issues a `JumpPermit` on Allow, aborts on Deny/Default.
module ef_guard::gate_extension {
    use ef_guard::assembly_binding::{Self, AssemblyBinding, ConditionProof};
    use ef_guard::identity_resolver;
    use world::access::{Self, OwnerCap};
    use world::character::Character;
    use world::gate::{Self, Gate};
    use sui::clock::Clock;
    use sui::event;

    const EAccessDenied: u64 = 0;
    const EWrongGate:    u64 = 1;

    public struct EfGuardGateAuth has drop {}

    public struct GateExtensionConfig has key {
        id:            UID,
        gate_id:       ID,
        permit_ttl_ms: u64,
    }

    public struct PermitIssuedEvent has copy, drop {
        config_id:    ID,
        gate_id:      ID,
        dest_gate_id: ID,
        char_game_id: u64,
        tribe_id:     u32,
        expires_at:   u64,
    }

    public struct PermitDeniedEvent has copy, drop {
        config_id:    ID,
        gate_id:      ID,
        dest_gate_id: ID,
        char_game_id: u64,
        tribe_id:     u32,
        reason:       u8,
    }

    public fun authorize_on_gate(
        gate:          &mut Gate,
        owner_cap:     &OwnerCap<Gate>,
        permit_ttl_ms: u64,
        ctx:           &mut TxContext,
    ): GateExtensionConfig {
        gate::authorize_extension<EfGuardGateAuth>(gate, owner_cap);
        GateExtensionConfig {
            id:            object::new(ctx),
            gate_id:       object::id(gate),
            permit_ttl_ms,
        }
    }

    /// Request a jump permit. Caller builds condition proofs in the PTB.
    public fun request_permit(
        config:           &GateExtensionConfig,
        binding:          &AssemblyBinding,
        condition_proofs: &vector<ConditionProof>,
        source_gate:      &Gate,
        dest_gate:        &Gate,
        character:        &Character,
        clock:            &Clock,
        ctx:              &mut TxContext,
    ) {
        assert!(object::id(source_gate) == config.gate_id, EWrongGate);

        let (char_game_id, tribe_id) = identity_resolver::resolve(character);
        let config_id = object::id(config);
        let gate_id   = object::id(source_gate);
        let dest_id   = object::id(dest_gate);

        let decision = assembly_binding::resolve_role(
            binding, config.gate_id, char_game_id, condition_proofs,
        );

        if (assembly_binding::is_allow(&decision)) {
            let expires_at = clock.timestamp_ms() + config.permit_ttl_ms;
            gate::issue_jump_permit<EfGuardGateAuth>(
                source_gate, dest_gate, character,
                EfGuardGateAuth {}, expires_at, ctx,
            );
            event::emit(PermitIssuedEvent {
                config_id, gate_id, dest_gate_id: dest_id,
                char_game_id, tribe_id, expires_at,
            });
        } else {
            let reason = if (assembly_binding::is_deny(&decision)) { 1 } else { 2 };
            event::emit(PermitDeniedEvent {
                config_id, gate_id, dest_gate_id: dest_id,
                char_game_id, tribe_id, reason,
            });
            abort EAccessDenied
        }
    }

    public fun set_permit_ttl(config: &mut GateExtensionConfig, owner_cap: &OwnerCap<Gate>, ttl_ms: u64) {
        assert!(access::is_authorized(owner_cap, config.gate_id), EWrongGate);
        config.permit_ttl_ms = ttl_ms;
    }

    public fun gate_id(config: &GateExtensionConfig): ID        { config.gate_id }
    public fun permit_ttl_ms(config: &GateExtensionConfig): u64 { config.permit_ttl_ms }

    public fun share_config(config: GateExtensionConfig) {
        transfer::share_object(config);
    }
}
