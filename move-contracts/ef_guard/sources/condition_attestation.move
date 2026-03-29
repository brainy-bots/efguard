/// Condition: verified by a signed attestation from a trusted server.
///
/// The attestor (an off-chain service) signs a message attesting that a player
/// meets some criteria. The condition verifies the signature on-chain using
/// ed25519. This enables access control based on off-chain data (inventory
/// totals, Discord roles, KYC status, etc.) without passing large objects.
///
/// # Security
/// - Attestation is bound to: character + assembly + condition + timestamp
/// - Expiry: attestation must be younger than `max_age_ms`
/// - Public key: stored on-chain, verifiable by anyone
/// - Replay protection: timestamp + assembly binding prevents cross-use
///
/// # Signed message format
/// BCS-encoded: { char_game_id: u64, assembly_id: address, condition_id: address, timestamp_ms: u64 }
/// The attestor signs this with their ed25519 private key.
///
/// # Future: ZK proof upgrade
/// This condition can be replaced with a ZK proof verifier (groth16) that
/// proves the same claim without trusting an attestor. The ef_guard engine
/// doesn't change — only the condition module and prover service.
module ef_guard::condition_attestation {
    use ef_guard::assembly_binding::{Self, EvalContext, ConditionProof};
    use sui::clock::Clock;
    use sui::ed25519;
    use sui::bcs;

    // ── Error codes ──────────────────────────────────────────────────────────

    const EAttestationExpired: u64 = 0;
    const EInvalidSignature:   u64 = 1;

    // ── Types ────────────────────────────────────────────────────────────────

    /// Shared config object. Stores the attestor's public key and expiry window.
    public struct AttestationCondition has key, store {
        id: UID,
        /// ed25519 public key of the trusted attestor (32 bytes)
        attestor_pubkey: vector<u8>,
        /// Maximum age of an attestation in milliseconds
        max_age_ms: u64,
    }

    // ── Constructor ──────────────────────────────────────────────────────────

    /// Create an attestation condition with the given public key and expiry window.
    public fun new(
        attestor_pubkey: vector<u8>,
        max_age_ms: u64,
        ctx: &mut TxContext,
    ): AttestationCondition {
        AttestationCondition {
            id: object::new(ctx),
            attestor_pubkey,
            max_age_ms,
        }
    }

    public fun share(condition: AttestationCondition) {
        transfer::share_object(condition);
    }

    // ── Verification ─────────────────────────────────────────────────────────

    /// Verify a signed attestation from the trusted server.
    ///
    /// The caller provides:
    /// - `signature`: ed25519 signature (64 bytes)
    /// - `timestamp_ms`: when the attestation was created
    /// - `clock`: Sui Clock object for expiry check
    ///
    /// The signed message is reconstructed from EvalContext + condition ID + timestamp,
    /// ensuring the attestation is bound to this specific access check.
    public fun verify(
        condition: &AttestationCondition,
        ctx: &EvalContext,
        signature: vector<u8>,
        timestamp_ms: u64,
        clock: &Clock,
    ): ConditionProof {
        let condition_id = object::id(condition);

        // Check expiry
        let now = clock.timestamp_ms();
        let expired = timestamp_ms + condition.max_age_ms < now;
        if (expired) {
            return assembly_binding::new_condition_proof(condition_id, false)
        };

        // Reconstruct the signed message:
        // BCS(char_game_id || assembly_id || condition_id || timestamp_ms)
        let mut msg = vector[];
        let char_bytes = bcs::to_bytes(&assembly_binding::ctx_char_game_id(ctx));
        let assembly_bytes = bcs::to_bytes(&assembly_binding::ctx_assembly_id(ctx));
        let condition_bytes = bcs::to_bytes(&condition_id);
        let time_bytes = bcs::to_bytes(&timestamp_ms);
        msg.append(char_bytes);
        msg.append(assembly_bytes);
        msg.append(condition_bytes);
        msg.append(time_bytes);

        // Verify ed25519 signature
        let valid = ed25519::ed25519_verify(
            &signature,
            &condition.attestor_pubkey,
            &msg,
        );

        assembly_binding::new_condition_proof(condition_id, valid)
    }

    // ── Accessors ────────────────────────────────────────────────────────────

    public fun attestor_pubkey(condition: &AttestationCondition): &vector<u8> {
        &condition.attestor_pubkey
    }

    public fun max_age_ms(condition: &AttestationCondition): u64 {
        condition.max_age_ms
    }
}
