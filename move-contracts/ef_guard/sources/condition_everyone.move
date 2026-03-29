/// Condition: always passes. Use as a catch-all rule.
/// Reads nothing from EvalContext — always returns passed = true.
module ef_guard::condition_everyone {
    use ef_guard::assembly_binding::{Self, EvalContext, ConditionProof};

    /// Shared config object. One per everyone condition (typically one per binding).
    public struct EveryoneCondition has key, store {
        id: UID,
    }

    /// Create an everyone condition. Share it after creation.
    public fun new(ctx: &mut TxContext): EveryoneCondition {
        EveryoneCondition { id: object::new(ctx) }
    }

    public fun share(condition: EveryoneCondition) {
        transfer::share_object(condition);
    }

    /// Verify: always passes.
    public fun verify(condition: &EveryoneCondition, _ctx: &EvalContext): ConditionProof {
        assembly_binding::new_condition_proof(object::id(condition), true)
    }
}
