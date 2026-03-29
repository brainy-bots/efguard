#[test_only]
module ef_guard::condition_min_balance_tests {
    use ef_guard::{assembly_binding, condition_min_balance, condition_everyone};
    use sui::coin;
    use sui::sui::SUI;
    use std::unit_test::destroy;

    const CHAR_A: u64 = 42;
    const TRIBE_X: u32 = 7;
    const GATE_ADDR: address = @0xA713;

    #[test]
    fun verify_passes_with_sufficient_balance() {
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);

        // Require 1000 SUI
        let condition = condition_min_balance::new(1000, &mut ctx);
        let cond_id = object::id(&condition);

        let binding = assembly_binding::new_binding(&mut ctx);
        let eval_ctx = assembly_binding::build_eval_context(
            &binding, gate_id, CHAR_A, TRIBE_X, @0xFACE,
        );

        // Player has 5000 SUI — should pass
        let coin = coin::mint_for_testing<SUI>(5000, &mut ctx);
        let proof = condition_min_balance::verify(&condition, &eval_ctx, &coin);

        // Use in a policy
        let mut test_binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut test_binding, gate_id, &ctx);
        assembly_binding::set_policy(&mut test_binding, gate_id, vector[
            assembly_binding::rule(cond_id, assembly_binding::allow()),
        ], &ctx);

        let decision = assembly_binding::resolve_role(&test_binding, gate_id, CHAR_A, &vector[proof]);
        assert!(assembly_binding::is_allow(&decision));

        coin::burn_for_testing(coin);
        destroy(condition);
        destroy(binding);
        destroy(test_binding);
    }

    #[test]
    fun verify_fails_with_insufficient_balance() {
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);

        // Require 1000 SUI
        let condition = condition_min_balance::new(1000, &mut ctx);
        let cond_id = object::id(&condition);
        let everyone_cond = condition_everyone::new(&mut ctx);
        let everyone_id = object::id(&everyone_cond);

        let binding = assembly_binding::new_binding(&mut ctx);
        let eval_ctx = assembly_binding::build_eval_context(
            &binding, gate_id, CHAR_A, TRIBE_X, @0xFACE,
        );

        // Player has only 500 SUI — should fail
        let coin = coin::mint_for_testing<SUI>(500, &mut ctx);
        let balance_proof = condition_min_balance::verify(&condition, &eval_ctx, &coin);
        let everyone_proof = condition_everyone::verify(&everyone_cond, &eval_ctx);

        let mut test_binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut test_binding, gate_id, &ctx);
        assembly_binding::set_policy(&mut test_binding, gate_id, vector[
            assembly_binding::rule(cond_id, assembly_binding::allow()),
            assembly_binding::rule(everyone_id, assembly_binding::deny()),
        ], &ctx);

        let decision = assembly_binding::resolve_role(
            &test_binding, gate_id, CHAR_A,
            &vector[balance_proof, everyone_proof],
        );
        // Balance too low → skipped → everyone deny
        assert!(assembly_binding::is_deny(&decision));

        coin::burn_for_testing(coin);
        destroy(condition);
        destroy(everyone_cond);
        destroy(binding);
        destroy(test_binding);
    }

    #[test]
    fun verify_passes_at_exact_threshold() {
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);

        let condition = condition_min_balance::new(1000, &mut ctx);
        let cond_id = object::id(&condition);

        let binding = assembly_binding::new_binding(&mut ctx);
        let eval_ctx = assembly_binding::build_eval_context(
            &binding, gate_id, CHAR_A, TRIBE_X, @0xFACE,
        );

        // Exactly 1000 — should pass (>=)
        let coin = coin::mint_for_testing<SUI>(1000, &mut ctx);
        let proof = condition_min_balance::verify(&condition, &eval_ctx, &coin);

        let mut test_binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut test_binding, gate_id, &ctx);
        assembly_binding::set_policy(&mut test_binding, gate_id, vector[
            assembly_binding::rule(cond_id, assembly_binding::allow()),
        ], &ctx);

        let decision = assembly_binding::resolve_role(&test_binding, gate_id, CHAR_A, &vector[proof]);
        assert!(assembly_binding::is_allow(&decision));

        coin::burn_for_testing(coin);
        destroy(condition);
        destroy(binding);
        destroy(test_binding);
    }

    #[test]
    fun zero_balance_fails_nonzero_threshold() {
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);

        let condition = condition_min_balance::new(1, &mut ctx);
        let cond_id = object::id(&condition);
        let everyone_cond = condition_everyone::new(&mut ctx);
        let everyone_id = object::id(&everyone_cond);

        let binding = assembly_binding::new_binding(&mut ctx);
        let eval_ctx = assembly_binding::build_eval_context(
            &binding, gate_id, CHAR_A, TRIBE_X, @0xFACE,
        );

        let coin = coin::mint_for_testing<SUI>(0, &mut ctx);
        let balance_proof = condition_min_balance::verify(&condition, &eval_ctx, &coin);
        let everyone_proof = condition_everyone::verify(&everyone_cond, &eval_ctx);

        let mut test_binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut test_binding, gate_id, &ctx);
        assembly_binding::set_policy(&mut test_binding, gate_id, vector[
            assembly_binding::rule(cond_id, assembly_binding::allow()),
            assembly_binding::rule(everyone_id, assembly_binding::deny()),
        ], &ctx);

        let decision = assembly_binding::resolve_role(
            &test_binding, gate_id, CHAR_A,
            &vector[balance_proof, everyone_proof],
        );
        assert!(assembly_binding::is_deny(&decision));

        coin::burn_for_testing(coin);
        destroy(condition);
        destroy(everyone_cond);
        destroy(binding);
        destroy(test_binding);
    }

    #[test]
    fun accessors_return_correct_values() {
        let mut ctx = tx_context::dummy();
        let condition = condition_min_balance::new(42000, &mut ctx);
        assert!(condition_min_balance::min_balance(&condition) == 42000);
        destroy(condition);
    }
}
