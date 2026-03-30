/// Condition: character matches a specific game ID.
/// Reads char_game_id from EvalContext — no extra proof data needed.
module ef_guard::condition_character {
    use ef_guard::assembly_binding::{Self, EvalContext, ConditionProof};

    /// Shared config object. One per character condition.
    public struct CharacterCondition has key, store {
        id: UID,
        char_game_id: u64,
    }

    /// Create a character condition. Share it after creation.
    public fun new(char_game_id: u64, ctx: &mut TxContext): CharacterCondition {
        CharacterCondition { id: object::new(ctx), char_game_id }
    }

    public fun share(condition: CharacterCondition) {
        transfer::share_object(condition);
    }

    /// Verify: is this the specified character?
    public fun verify(condition: &CharacterCondition, ctx: &EvalContext): ConditionProof {
        let passed = assembly_binding::ctx_char_game_id(ctx) == condition.char_game_id;
        assembly_binding::new_condition_proof(object::id(condition), passed)
    }

    // ── Accessors ────────────────────────────────────────────────────────────

    public fun id(condition: &CharacterCondition): ID { object::id(condition) }

    public fun char_game_id(condition: &CharacterCondition): u64 { condition.char_game_id }
}
