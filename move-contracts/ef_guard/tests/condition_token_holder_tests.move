#[test_only]
module ef_guard::condition_token_holder_tests {
    use ef_guard::{assembly_binding, condition_token_holder, condition_everyone};
    use std::unit_test::destroy;

    const CHAR_A: u64 = 42;
    const TRIBE_X: u32 = 7;
    const GATE_ADDR: address = @0xA713;

    /// Test NFT type — simulates a membership card
    public struct MembershipCard has key {
        id: UID,
    }

    /// Different type — should NOT match MembershipCard condition
    public struct DifferentNFT has key {
        id: UID,
    }

    #[test]
    fun verify_passes_with_correct_token_type() {
        let mut ctx = tx_context::dummy();
        let condition = condition_token_holder::new<MembershipCard>(&mut ctx);
        let binding = assembly_binding::new_binding(&mut ctx);
        let gate_id = object::id_from_address(GATE_ADDR);

        let eval_ctx = assembly_binding::build_eval_context(
            &binding, gate_id, CHAR_A, TRIBE_X, @0xFACE,
        );

        let card = MembershipCard { id: object::new(&mut ctx) };
        let proof = condition_token_holder::verify(&condition, &eval_ctx, &card);

        // Should pass — correct type
        let proofs = vector[proof];
        let cond_id = object::id(&condition);
        let mut test_binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut test_binding, gate_id, &ctx);
        assembly_binding::set_policy(&mut test_binding, gate_id, vector[
            assembly_binding::rule(cond_id, assembly_binding::allow()),
        ], &ctx);

        let decision = assembly_binding::resolve_role(&test_binding, gate_id, CHAR_A, &proofs);
        assert!(assembly_binding::is_allow(&decision));

        destroy(card);
        destroy(condition);
        destroy(binding);
        destroy(test_binding);
    }

    #[test]
    fun verify_fails_with_wrong_token_type() {
        let mut ctx = tx_context::dummy();
        let condition = condition_token_holder::new<MembershipCard>(&mut ctx);
        let binding = assembly_binding::new_binding(&mut ctx);
        let gate_id = object::id_from_address(GATE_ADDR);

        let eval_ctx = assembly_binding::build_eval_context(
            &binding, gate_id, CHAR_A, TRIBE_X, @0xFACE,
        );

        // Pass wrong type
        let wrong_nft = DifferentNFT { id: object::new(&mut ctx) };
        let proof = condition_token_holder::verify(&condition, &eval_ctx, &wrong_nft);

        // Should fail — wrong type, proof.passed = false
        let cond_id = object::id(&condition);
        let everyone_cond = condition_everyone::new(&mut ctx);
        let everyone_id = object::id(&everyone_cond);

        let mut test_binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut test_binding, gate_id, &ctx);
        assembly_binding::set_policy(&mut test_binding, gate_id, vector[
            assembly_binding::rule(cond_id, assembly_binding::allow()),
            assembly_binding::rule(everyone_id, assembly_binding::deny()),
        ], &ctx);

        // Build all proofs
        let everyone_eval = assembly_binding::build_eval_context(&test_binding, gate_id, CHAR_A, TRIBE_X, @0xFACE);
        let everyone_proof = condition_everyone::verify(&everyone_cond, &everyone_eval);
        let full_proofs = vector[proof, everyone_proof];

        // Token condition fails → skipped → falls to everyone deny
        let decision = assembly_binding::resolve_role(&test_binding, gate_id, CHAR_A, &full_proofs);
        assert!(assembly_binding::is_deny(&decision));

        destroy(wrong_nft);
        destroy(condition);
        destroy(everyone_cond);
        destroy(binding);
        destroy(test_binding);
    }

    #[test]
    fun token_holder_integrates_with_full_policy() {
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);

        // Create conditions
        let nft_cond = condition_token_holder::new<MembershipCard>(&mut ctx);
        let nft_cond_id = object::id(&nft_cond);
        let everyone_cond = condition_everyone::new(&mut ctx);
        let everyone_id = object::id(&everyone_cond);

        // Policy: NFT holders → Allow, Everyone → Deny
        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);
        assembly_binding::set_policy(&mut binding, gate_id, vector[
            assembly_binding::rule(nft_cond_id, assembly_binding::allow()),
            assembly_binding::rule(everyone_id, assembly_binding::deny()),
        ], &ctx);

        let eval_ctx = assembly_binding::build_eval_context(
            &binding, gate_id, CHAR_A, TRIBE_X, @0xFACE,
        );

        // Player WITH NFT → Allow
        let card = MembershipCard { id: object::new(&mut ctx) };
        let nft_proof = condition_token_holder::verify(&nft_cond, &eval_ctx, &card);
        let everyone_proof = condition_everyone::verify(&everyone_cond, &eval_ctx);
        let proofs_with_nft = vector[nft_proof, everyone_proof];

        let decision = assembly_binding::resolve_role(&binding, gate_id, CHAR_A, &proofs_with_nft);
        assert!(assembly_binding::is_allow(&decision));

        // Player WITHOUT NFT (no nft proof, only everyone) → Deny
        let everyone_proof2 = condition_everyone::verify(&everyone_cond, &eval_ctx);
        let proofs_without_nft = vector[everyone_proof2];

        let decision2 = assembly_binding::resolve_role(&binding, gate_id, CHAR_A, &proofs_without_nft);
        assert!(assembly_binding::is_deny(&decision2));

        destroy(card);
        destroy(nft_cond);
        destroy(everyone_cond);
        destroy(binding);
    }
}
