/// Condition: player holds at least a minimum balance of a specific coin type.
///
/// The player passes a reference to their Coin<T> in the PTB. The condition
/// checks that coin::value(coin) >= min_balance. Works with SUI, EVE tokens,
/// or any Sui coin type.
///
/// # Example: "Must hold at least 1000 EVE tokens to use this gate"
/// ```
/// let [proof] = tx.moveCall({
///     target: `${PKG}::condition_min_balance::verify`,
///     typeArguments: [`${EVE_PKG}::EVE::EVE`],
///     arguments: [tx.object(conditionId), ctx, tx.object(myCoinId)],
/// });
/// ```
///
/// # Note on split coins
/// If a player's balance is spread across multiple coin objects, they should
/// merge them first using `sui::coin::join` before passing to verify.
module ef_guard::condition_min_balance {
    use ef_guard::assembly_binding::{Self, EvalContext, ConditionProof};
    use sui::coin::Coin;

    /// Shared config object. Stores the minimum required balance.
    public struct MinBalanceCondition has key, store {
        id: UID,
        /// Minimum coin value required (in the coin's smallest unit)
        min_balance: u64,
    }

    /// Create a min balance condition.
    public fun new(min_balance: u64, ctx: &mut TxContext): MinBalanceCondition {
        MinBalanceCondition {
            id: object::new(ctx),
            min_balance,
        }
    }

    public fun share(condition: MinBalanceCondition) {
        transfer::share_object(condition);
    }

    /// Verify: does the player hold enough of this coin type?
    /// The player passes &Coin<T> — Sui guarantees they own it.
    public fun verify<T>(
        condition: &MinBalanceCondition,
        _ctx: &EvalContext,
        coin: &Coin<T>,
    ): ConditionProof {
        let passed = coin.value() >= condition.min_balance;
        assembly_binding::new_condition_proof(object::id(condition), passed)
    }

    // ── Accessors ────────────────────────────────────────────────────────────

    public fun id(condition: &MinBalanceCondition): ID { object::id(condition) }

    public fun min_balance(condition: &MinBalanceCondition): u64 {
        condition.min_balance
    }
}
