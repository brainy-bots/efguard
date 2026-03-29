/// Smart Storage Unit extension. Policy-checking proxy for deposit/withdraw.
module ef_guard::ssu_extension {
    use ef_guard::assembly_binding::{Self, AssemblyBinding};
    use ef_guard::identity_resolver;
    use world::access::{Self, OwnerCap};
    use world::character::Character;
    use world::inventory::Item;
    use world::storage_unit::{Self, StorageUnit};
    use sui::event;

    const EAccessDenied:     u64 = 0;
    const EDepositDisabled:  u64 = 1;
    const EWithdrawDisabled: u64 = 2;
    const EWrongSSU:         u64 = 3;

    public struct EfGuardSSUAuth has drop {}

    public struct SSUExtensionConfig has key {
        id:             UID,
        ssu_id:         ID,
        allow_deposit:  bool,
        allow_withdraw: bool,
    }

    public struct SSUAccessEvent has copy, drop {
        config_id:    ID,
        ssu_id:       ID,
        char_game_id: u64,
        tribe_id:     u32,
        action:       u8,      // 0=deposit 1=withdraw
        allowed:      bool,
        reason:       u8,      // 0=policy_allow 1=policy_deny 2=blocklist 3=flag_disabled
    }

    public fun authorize_on_ssu(
        ssu:            &mut StorageUnit,
        owner_cap:      &OwnerCap<StorageUnit>,
        allow_deposit:  bool,
        allow_withdraw: bool,
        ctx:            &mut TxContext,
    ): SSUExtensionConfig {
        storage_unit::authorize_extension<EfGuardSSUAuth>(ssu, owner_cap);
        SSUExtensionConfig {
            id:             object::new(ctx),
            ssu_id:         object::id(ssu),
            allow_deposit,
            allow_withdraw,
        }
    }

    public fun deposit(
        config:    &SSUExtensionConfig,
        binding:   &AssemblyBinding,
        ssu:       &mut StorageUnit,
        character: &Character,
        item:      Item,
        ctx:       &mut TxContext,
    ) {
        assert!(object::id(ssu) == config.ssu_id, EWrongSSU);
        let (char_game_id, tribe_id) = identity_resolver::resolve(character);

        if (!config.allow_deposit) {
            emit_event(config, char_game_id, tribe_id, 0, false, 3);
            abort EDepositDisabled
        };

        check_access(config, binding, char_game_id, tribe_id, 0);
        storage_unit::deposit_item<EfGuardSSUAuth>(ssu, character, item, EfGuardSSUAuth {}, ctx);
        emit_event(config, char_game_id, tribe_id, 0, true, 0);
    }

    public fun withdraw(
        config:    &SSUExtensionConfig,
        binding:   &AssemblyBinding,
        ssu:       &mut StorageUnit,
        character: &Character,
        type_id:   u64,
        quantity:  u32,
        ctx:       &mut TxContext,
    ): Item {
        assert!(object::id(ssu) == config.ssu_id, EWrongSSU);
        let (char_game_id, tribe_id) = identity_resolver::resolve(character);

        if (!config.allow_withdraw) {
            emit_event(config, char_game_id, tribe_id, 1, false, 3);
            abort EWithdrawDisabled
        };

        check_access(config, binding, char_game_id, tribe_id, 1);
        let item = storage_unit::withdraw_item<EfGuardSSUAuth>(
            ssu, character, EfGuardSSUAuth {}, type_id, quantity, ctx,
        );
        emit_event(config, char_game_id, tribe_id, 1, true, 0);
        item
    }

    public fun set_allow_deposit(config: &mut SSUExtensionConfig, owner_cap: &OwnerCap<StorageUnit>, value: bool) {
        assert!(access::is_authorized(owner_cap, config.ssu_id), EWrongSSU);
        config.allow_deposit = value;
    }
    public fun set_allow_withdraw(config: &mut SSUExtensionConfig, owner_cap: &OwnerCap<StorageUnit>, value: bool) {
        assert!(access::is_authorized(owner_cap, config.ssu_id), EWrongSSU);
        config.allow_withdraw = value;
    }
    public fun ssu_id(config: &SSUExtensionConfig): ID          { config.ssu_id }
    public fun allow_deposit(config: &SSUExtensionConfig): bool  { config.allow_deposit }
    public fun allow_withdraw(config: &SSUExtensionConfig): bool { config.allow_withdraw }
    public fun share_config(config: SSUExtensionConfig) { transfer::share_object(config); }

    fun check_access(
        config:       &SSUExtensionConfig,
        binding:      &AssemblyBinding,
        char_game_id: u64,
        tribe_id:     u32,
        action:       u8,
    ) {
        let decision = assembly_binding::resolve_role(binding, config.ssu_id, char_game_id, tribe_id);
        if (!assembly_binding::is_allow(&decision)) {
            let reason = if (assembly_binding::is_deny(&decision)) { 1 } else { 2 };
            emit_event(config, char_game_id, tribe_id, action, false, reason);
            abort EAccessDenied
        };
    }

    fun emit_event(
        config:       &SSUExtensionConfig,
        char_game_id: u64,
        tribe_id:     u32,
        action:       u8,
        allowed:      bool,
        reason:       u8,
    ) {
        event::emit(SSUAccessEvent {
            config_id: object::id(config),
            ssu_id:    config.ssu_id,
            char_game_id, tribe_id, action, allowed, reason,
        });
    }
}
