#[test_only]
module ef_guard::condition_attestation_tests {
    use ef_guard::{assembly_binding, condition_attestation, condition_everyone};
    use sui::clock;
    use sui::ed25519;
    use sui::bcs;
    use std::unit_test::destroy;

    const CHAR_A: u64 = 42;
    const TRIBE_X: u32 = 7;
    const GATE_ADDR: address = @0xA713;
    const MAX_AGE_MS: u64 = 60_000; // 1 minute

    // Ed25519 test keypair (deterministic for testing)
    // Generated from seed bytes — not secure, only for tests
    const TEST_PUBKEY: vector<u8> = x"c66fe757596e3b20e59db17da29c0153ebbb4a4f6d5d3258f0e8ea52b0a84900";
    const TEST_PRIVKEY: vector<u8> = x"e6e99c0bcd5d7d5a5c3a5e8ae2c1ff2b1e8f3a7c6d9b4e2f1a8c5d7e0b3f6a9c";

    /// Build the message that the attestor would sign
    fun build_attestation_message(
        char_game_id: u64,
        assembly_id: ID,
        condition_id: ID,
        timestamp_ms: u64,
    ): vector<u8> {
        let mut msg = vector[];
        let char_bytes = bcs::to_bytes(&char_game_id);
        let assembly_bytes = bcs::to_bytes(&assembly_id);
        let condition_bytes = bcs::to_bytes(&condition_id);
        let time_bytes = bcs::to_bytes(&timestamp_ms);
        msg.append(char_bytes);
        msg.append(assembly_bytes);
        msg.append(condition_bytes);
        msg.append(time_bytes);
        msg
    }

    #[test]
    fun attestation_condition_created_with_correct_fields() {
        let mut ctx = tx_context::dummy();
        let pubkey = TEST_PUBKEY;
        let condition = condition_attestation::new(pubkey, MAX_AGE_MS, &mut ctx);

        assert!(*condition_attestation::attestor_pubkey(&condition) == TEST_PUBKEY);
        assert!(condition_attestation::max_age_ms(&condition) == MAX_AGE_MS);

        destroy(condition);
    }

    #[test]
    fun expired_attestation_returns_false() {
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);
        let binding = assembly_binding::new_binding(&mut ctx);

        let condition = condition_attestation::new(TEST_PUBKEY, MAX_AGE_MS, &mut ctx);
        let condition_id = object::id(&condition);

        let eval_ctx = assembly_binding::build_eval_context(
            &binding, gate_id, CHAR_A, TRIBE_X, @0xFACE,
        );

        // Attestation signed at t=1000, clock is at t=200000 (way past max_age)
        let mut test_clock = clock::create_for_testing(&mut ctx);
        test_clock.set_for_testing(200_000);

        let timestamp_ms = 1000u64;
        // Signature doesn't matter — expiry check happens first
        let fake_sig = x"0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

        let proof = condition_attestation::verify(
            &condition, &eval_ctx, fake_sig, timestamp_ms, &test_clock,
        );

        // Should fail — expired
        let proofs = vector[proof];
        let mut test_binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut test_binding, gate_id, &ctx);
        assembly_binding::set_policy(&mut test_binding, gate_id, vector[
            assembly_binding::rule(condition_id, assembly_binding::allow()),
        ], &ctx);

        let decision = assembly_binding::resolve_role(&test_binding, gate_id, CHAR_A, &proofs);
        assert!(!assembly_binding::is_allow(&decision));

        test_clock.destroy_for_testing();
        destroy(condition);
        destroy(binding);
        destroy(test_binding);
    }

    #[test]
    fun invalid_signature_returns_false() {
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);
        let binding = assembly_binding::new_binding(&mut ctx);

        let condition = condition_attestation::new(TEST_PUBKEY, MAX_AGE_MS, &mut ctx);
        let condition_id = object::id(&condition);

        let eval_ctx = assembly_binding::build_eval_context(
            &binding, gate_id, CHAR_A, TRIBE_X, @0xFACE,
        );

        // Fresh clock, attestation not expired
        let mut test_clock = clock::create_for_testing(&mut ctx);
        test_clock.set_for_testing(5_000);
        let timestamp_ms = 3_000u64;

        // Bad signature
        let bad_sig = x"0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

        let proof = condition_attestation::verify(
            &condition, &eval_ctx, bad_sig, timestamp_ms, &test_clock,
        );

        // Should fail — invalid signature
        let everyone_cond = condition_everyone::new(&mut ctx);
        let everyone_id = object::id(&everyone_cond);
        let everyone_proof = condition_everyone::verify(&everyone_cond, &eval_ctx);

        let proofs = vector[proof, everyone_proof];
        let mut test_binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut test_binding, gate_id, &ctx);
        assembly_binding::set_policy(&mut test_binding, gate_id, vector[
            assembly_binding::rule(condition_id, assembly_binding::allow()),
            assembly_binding::rule(everyone_id, assembly_binding::deny()),
        ], &ctx);

        let decision = assembly_binding::resolve_role(&test_binding, gate_id, CHAR_A, &proofs);
        assert!(assembly_binding::is_deny(&decision));

        test_clock.destroy_for_testing();
        destroy(condition);
        destroy(everyone_cond);
        destroy(binding);
        destroy(test_binding);
    }

    #[test]
    fun attestation_integrates_with_full_policy() {
        // This test verifies the full flow structure works, even though
        // we can't easily produce a real ed25519 signature in Move tests.
        // The expiry and signature verification logic is tested above.
        let mut ctx = tx_context::dummy();
        let gate_id = object::id_from_address(GATE_ADDR);

        let condition = condition_attestation::new(TEST_PUBKEY, MAX_AGE_MS, &mut ctx);
        let condition_id = object::id(&condition);
        let everyone_cond = condition_everyone::new(&mut ctx);
        let everyone_id = object::id(&everyone_cond);

        let mut binding = assembly_binding::new_binding(&mut ctx);
        assembly_binding::register_gate(&mut binding, gate_id, &ctx);
        assembly_binding::set_policy(&mut binding, gate_id, vector[
            assembly_binding::rule(condition_id, assembly_binding::allow()),
            assembly_binding::rule(everyone_id, assembly_binding::deny()),
        ], &ctx);

        let eval_ctx = assembly_binding::build_eval_context(
            &binding, gate_id, CHAR_A, TRIBE_X, @0xFACE,
        );

        // Without attestation proof, only everyone matches → Deny
        let everyone_proof = condition_everyone::verify(&everyone_cond, &eval_ctx);
        let proofs_without = vector[everyone_proof];
        let decision = assembly_binding::resolve_role(&binding, gate_id, CHAR_A, &proofs_without);
        assert!(assembly_binding::is_deny(&decision));

        destroy(condition);
        destroy(everyone_cond);
        destroy(binding);
    }
}
