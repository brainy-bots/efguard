/// Thin adapter between `world::character::Character` and the ef_guard policy engine.
///
/// Extracts the two identity fields that policy evaluation needs — `char_game_id` (u64)
/// and `tribe_id` (u32) — and exposes them as a single `resolve` call. All other
/// ef_guard modules depend on this adapter rather than importing `world::character`
/// directly, so the world-contracts API surface is isolated to one place.
module ef_guard::identity_resolver {
    use world::character::Character;
    use world::in_game_id;

    // ── Public API ───────────────────────────────────────────────────────────

    /// Extract `(char_game_id, tribe_id)` from a `Character` shared object.
    /// Both values are used directly by `assembly_binding::resolve_role`.
    public fun resolve(character: &Character): (u64, u32) {
        (in_game_id::item_id(&character.key()), character.tribe())
    }

    /// Return only the in-game character ID (`TenantItemId.item_id`).
    /// Convenience accessor for contexts that only need the character identity.
    public fun char_game_id(character: &Character): u64 {
        in_game_id::item_id(&character.key())
    }

    /// Return only the tribe ID.
    /// Convenience accessor for contexts that only need tribal affiliation.
    public fun tribe_id(character: &Character): u32 {
        character.tribe()
    }
}
