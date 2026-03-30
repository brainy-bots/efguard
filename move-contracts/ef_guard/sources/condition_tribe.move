/// Condition: character belongs to a specific tribe.
/// Reads tribe_id from EvalContext — no extra proof data needed from the player.
module ef_guard::condition_tribe {
    use ef_guard::assembly_binding::{Self, EvalContext, ConditionProof};

    /// Shared config object. One per tribe condition.
    public struct TribeCondition has key, store {
        id: UID,
        tribe_id: u32,
    }

    /// Create a tribe condition. Share it after creation.
    public fun new(tribe_id: u32, ctx: &mut TxContext): TribeCondition {
        TribeCondition { id: object::new(ctx), tribe_id }
    }

    public fun share(condition: TribeCondition) {
        transfer::share_object(condition);
    }

    /// Verify: does the character belong to this tribe?
    public fun verify(condition: &TribeCondition, ctx: &EvalContext): ConditionProof {
        let passed = assembly_binding::ctx_tribe_id(ctx) == condition.tribe_id;
        assembly_binding::new_condition_proof(object::id(condition), passed)
    }

    // ── Accessors ────────────────────────────────────────────────────────────

    public fun id(condition: &TribeCondition): ID { object::id(condition) }

    public fun tribe_id(condition: &TribeCondition): u32 { condition.tribe_id }
}
