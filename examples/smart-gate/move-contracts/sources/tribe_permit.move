/// Gate extension using ef_guard for access control.
///
/// This is the same smart_gate_extension from the builder-scaffold, but instead of
/// checking a single hardcoded tribe ID, it delegates access control to ef_guard.
///
/// BEFORE (scaffold default):
///   assert!(character.tribe() == tribe_cfg.tribe, ENotStarterTribe);
///
/// AFTER (with ef_guard):
///   let decision = assembly_binding::resolve_role(binding, gate_id, char_game_id, tribe_id);
///   assert!(assembly_binding::is_allow(&decision), EAccessDenied);
///
/// Benefits:
///   - Multiple tribes, not just one
///   - Character-specific allow/deny rules
///   - Blocklist that overrides all rules
///   - Rules can be updated without redeploying the contract
///   - First-match-wins evaluation with configurable priority
#[allow(unused_use)]
module smart_gate_extension::tribe_permit;

use smart_gate_extension::config::{Self, AdminCap, XAuth, ExtensionConfig};
use ef_guard::assembly_binding::{Self, AssemblyBinding};
use ef_guard::identity_resolver;
use sui::clock::Clock;
use world::{character::Character, gate::{Self, Gate}};

// === Errors ===
#[error(code = 0)]
const EAccessDenied: vector<u8> = b"ef_guard denied access to this character";
#[error(code = 1)]
const ENoExpiryConfig: vector<u8> = b"Missing ExpiryConfig on ExtensionConfig";
#[error(code = 2)]
const EExpiryOverflow: vector<u8> = b"Expiry timestamp overflow";

/// Permit expiry configuration. Stored as a dynamic field on ExtensionConfig.
public struct ExpiryConfig has drop, store {
    expiry_duration_ms: u64,
}

/// Dynamic-field key for `ExpiryConfig`.
public struct ExpiryConfigKey has copy, drop, store {}

// === View Functions ===
public fun expiry_duration_ms(extension_config: &ExtensionConfig): u64 {
    assert!(extension_config.has_rule<ExpiryConfigKey>(ExpiryConfigKey {}), ENoExpiryConfig);
    extension_config.borrow_rule<ExpiryConfigKey, ExpiryConfig>(ExpiryConfigKey {}).expiry_duration_ms
}

/// Issue a `JumpPermit` if ef_guard allows the character.
///
/// Instead of checking a single tribe, this calls ef_guard's resolve_role()
/// which evaluates the full rule list configured on the AssemblyBinding.
public fun issue_jump_permit(
    extension_config: &ExtensionConfig,
    binding: &AssemblyBinding,
    source_gate: &Gate,
    destination_gate: &Gate,
    character: &Character,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    // ef_guard access check — replaces the old `character.tribe() == tribe_cfg.tribe`
    let (char_game_id, tribe_id) = identity_resolver::resolve(character);
    let gate_id = object::id(source_gate);
    let decision = assembly_binding::resolve_role(binding, gate_id, char_game_id, tribe_id);
    assert!(assembly_binding::is_allow(&decision), EAccessDenied);

    // Issue the permit
    assert!(extension_config.has_rule<ExpiryConfigKey>(ExpiryConfigKey {}), ENoExpiryConfig);
    let expiry_cfg = extension_config.borrow_rule<ExpiryConfigKey, ExpiryConfig>(ExpiryConfigKey {});
    let expiry_ms = expiry_cfg.expiry_duration_ms;
    let ts = clock.timestamp_ms();
    assert!(ts <= (0xFFFFFFFFFFFFFFFFu64 - expiry_ms), EExpiryOverflow);
    let expires_at_timestamp_ms = ts + expiry_ms;
    gate::issue_jump_permit<XAuth>(
        source_gate,
        destination_gate,
        character,
        config::x_auth(),
        expires_at_timestamp_ms,
        ctx,
    );
}

// === Admin Functions ===

/// Set the permit expiry duration.
/// (Tribe configuration is no longer needed — ef_guard handles access rules.)
public fun set_expiry_config(
    extension_config: &mut ExtensionConfig,
    admin_cap: &AdminCap,
    expiry_duration_ms: u64,
) {
    extension_config.set_rule<ExpiryConfigKey, ExpiryConfig>(
        admin_cap,
        ExpiryConfigKey {},
        ExpiryConfig { expiry_duration_ms },
    );
}
