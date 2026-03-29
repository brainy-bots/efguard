/// Condition: player holds a specific type of Sui object (NFT, membership card, etc.).
///
/// The player proves ownership by passing a reference to the object in the PTB.
/// Sui runtime guarantees they own it — we just verify the type matches.
///
/// Works with any Sui object that has the `key` ability: NFTs, coins, game items,
/// membership cards, or any custom token.
///
/// # Example PTB flow
/// ```
/// // 1. Build eval context
/// let [ctx] = tx.moveCall({ target: `${PKG}::assembly_binding::build_eval_context`, ... });
/// // 2. Verify token ownership (player passes their NFT)
/// let [proof] = tx.moveCall({
///     target: `${PKG}::condition_token_holder::verify`,
///     typeArguments: [`${NFT_PKG}::membership::Card`],
///     arguments: [tx.object(conditionId), ctx, tx.object(myNftId)],
/// });
/// // 3. Pass proof to resolve_role
/// ```
module ef_guard::condition_token_holder {
    use ef_guard::assembly_binding::{Self, EvalContext, ConditionProof};
    use std::type_name::{Self, TypeName};

    /// Shared config object. Stores the expected type name.
    public struct TokenHolderCondition has key, store {
        id: UID,
        required_type: TypeName,
    }

    /// Create a token holder condition for type `T`.
    /// The type is captured at creation time.
    public fun new<T: key>(ctx: &mut TxContext): TokenHolderCondition {
        TokenHolderCondition {
            id: object::new(ctx),
            required_type: type_name::with_defining_ids<T>(),
        }
    }

    public fun share(condition: TokenHolderCondition) {
        transfer::share_object(condition);
    }

    /// Verify: does the caller hold an object of the required type?
    /// The caller passes `&T` as proof — Sui guarantees they own it.
    /// We check that the type matches the configured requirement.
    public fun verify<T: key>(
        condition: &TokenHolderCondition,
        _ctx: &EvalContext,
        _token: &T,
    ): ConditionProof {
        let actual_type = type_name::with_defining_ids<T>();
        let passed = actual_type == condition.required_type;
        assembly_binding::new_condition_proof(object::id(condition), passed)
    }

    // ── Accessors ────────────────────────────────────────────────────────────

    public fun required_type(condition: &TokenHolderCondition): &TypeName {
        &condition.required_type
    }
}
