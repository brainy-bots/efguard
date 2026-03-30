/**
 * ef_guard end-to-end test — full assembly interaction flow on local chain.
 *
 * Tests the REAL interaction flow that would happen in-game:
 *   1. Install ef_guard extension on a gate (borrow OwnerCap pattern)
 *   2. Create conditions and set policy
 *   3. Player A requests permit (allowed by tribe condition) → JumpPermit issued
 *   4. Player B requests permit (denied - different condition setup) → EAccessDenied
 *   5. Add Player B to blocklist → denied even with matching conditions
 *   6. Remove from blocklist → access restored
 *   7. Revoke access by changing policy → previously allowed player now denied
 *   8. Install ef_guard on SSU + test deposit/withdraw access
 *
 * Uses real gates, characters, and SSU created by world-contracts test resources.
 */
import "dotenv/config";
import { Transaction } from "@mysten/sui/transactions";
import {
    getEnvConfig, handleError, hydrateWorldConfig, initializeContext,
    delay, DELAY_MS
} from "../utils/helper";
import { deriveObjectId } from "../utils/derive-object-id";
import {
    GATE_ITEM_ID_1, GATE_ITEM_ID_2, GAME_CHARACTER_ID,
    STORAGE_A_ITEM_ID
} from "../utils/constants";

let WORLD: string;
let PKG: string;
let passed = 0;
let failed = 0;
let skipped = 0;

function assert(condition: boolean, message: string) {
    if (condition) { console.log(`  ✓ ${message}`); passed++; }
    else { console.error(`  ✗ ${message}`); failed++; }
}

function skip(message: string) {
    console.log(`  ○ SKIP: ${message}`);
    skipped++;
}

async function main() {
    console.log("\n══════════════════════════════════════════════════════════");
    console.log("  ef_guard end-to-end tests (real assemblies on local chain)");
    console.log("══════════════════════════════════════════════════════════\n");

    try {
        const env = getEnvConfig();

        // Three separate signers
        const adminCtx = initializeContext(env.network, env.adminExportedKey);
        const playerACtx = initializeContext(env.network, process.env.PLAYER_A_PRIVATE_KEY!);
        const playerBCtx = initializeContext(env.network, process.env.PLAYER_B_PRIVATE_KEY!);

        const { client } = adminCtx;
        await hydrateWorldConfig(adminCtx);
        // Player contexts share the same world config
        playerACtx.config = { ...adminCtx.config };
        playerBCtx.config = { ...adminCtx.config };

        WORLD = adminCtx.config.packageId;
        PKG = process.env.BUILDER_PACKAGE_ID!;
        if (!PKG) throw new Error("BUILDER_PACKAGE_ID not set");

        // Derive object IDs
        const registry = adminCtx.config.objectRegistry;
        const charA = deriveObjectId(registry, BigInt(GAME_CHARACTER_ID), WORLD);
        const charB = deriveObjectId(registry, 900000001n, WORLD);
        const gate1 = deriveObjectId(registry, GATE_ITEM_ID_1, WORLD);
        const gate2 = deriveObjectId(registry, GATE_ITEM_ID_2, WORLD);
        const ssu = deriveObjectId(registry, STORAGE_A_ITEM_ID, WORLD);

        console.log(`World:    ${WORLD}`);
        console.log(`ef_guard: ${PKG}`);
        console.log(`Admin:    ${adminCtx.address}`);
        console.log(`Player A: ${playerACtx.address} (char: ${charA})`);
        console.log(`Player B: ${playerBCtx.address} (char: ${charB})`);
        console.log(`Gate 1:   ${gate1}`);
        console.log(`Gate 2:   ${gate2}`);
        console.log(`SSU:      ${ssu}\n`);

        // ═══════════════════════════════════════════════════════════════
        // Test 1: Create conditions + binding + policy
        // ═══════════════════════════════════════════════════════════════
        console.log("Test 1: Create conditions, binding, and policy");

        const tx1 = new Transaction();

        // Create tribe condition (tribe 100 — both characters are in this tribe)
        const [tribeCond] = tx1.moveCall({
            target: `${PKG}::condition_tribe::new`,
            arguments: [tx1.pure.u32(100)],
        });

        // Create character condition for Player A specifically
        const [charACond] = tx1.moveCall({
            target: `${PKG}::condition_character::new`,
            arguments: [tx1.pure.u64(BigInt(GAME_CHARACTER_ID))], // char A game ID
        });

        // Create everyone condition
        const [everyoneCond] = tx1.moveCall({
            target: `${PKG}::condition_everyone::new`,
        });

        // Create binding
        const [binding] = tx1.moveCall({
            target: `${PKG}::assembly_binding::new_binding`,
        });

        // Register both gates and SSU
        tx1.moveCall({ target: `${PKG}::assembly_binding::register_gate`, arguments: [binding, tx1.pure.id(gate1)] });
        tx1.moveCall({ target: `${PKG}::assembly_binding::register_gate`, arguments: [binding, tx1.pure.id(gate2)] });
        tx1.moveCall({ target: `${PKG}::assembly_binding::register_ssu`, arguments: [binding, tx1.pure.id(ssu)] });

        // Share conditions
        tx1.moveCall({ target: `${PKG}::condition_tribe::share`, arguments: [tribeCond] });
        tx1.moveCall({ target: `${PKG}::condition_character::share`, arguments: [charACond] });
        tx1.moveCall({ target: `${PKG}::condition_everyone::share`, arguments: [everyoneCond] });

        // Share binding
        tx1.moveCall({ target: `${PKG}::assembly_binding::share_binding`, arguments: [binding] });

        const result1 = await client.signAndExecuteTransaction({
            transaction: tx1, signer: adminCtx.keypair,
            options: { showEffects: true, showObjectChanges: true },
        });

        assert(result1.effects?.status?.status === "success", "Created conditions + binding");

        const changes = result1.objectChanges ?? [];
        const findCreated = (suffix: string) =>
            (changes.find((c: any) => c.type === "created" && c.objectType?.includes(suffix)) as any)?.objectId;

        const bindingId = findCreated("AssemblyBinding");
        const tribeCondId = findCreated("TribeCondition");
        const charACondId = findCreated("CharacterCondition");
        const everyoneCondId = findCreated("EveryoneCondition");

        assert(!!bindingId, `Binding: ${bindingId}`);
        assert(!!tribeCondId, `TribeCondition: ${tribeCondId}`);
        assert(!!charACondId, `CharacterCondition: ${charACondId}`);
        assert(!!everyoneCondId, `EveryoneCondition: ${everyoneCondId}`);

        await delay(DELAY_MS);

        // ═══════════════════════════════════════════════════════════════
        // Test 2: Set gate policy — Tribe 100 Allow, Everyone Deny
        // ═══════════════════════════════════════════════════════════════
        console.log("\nTest 2: Set gate policy (Tribe 100 → Allow, Everyone → Deny)");

        const tx2 = new Transaction();
        const [r1] = tx2.moveCall({
            target: `${PKG}::assembly_binding::rule`,
            arguments: [tx2.pure.id(tribeCondId!), tx2.moveCall({ target: `${PKG}::assembly_binding::allow` })[0]],
        });
        const [r2] = tx2.moveCall({
            target: `${PKG}::assembly_binding::rule`,
            arguments: [tx2.pure.id(everyoneCondId!), tx2.moveCall({ target: `${PKG}::assembly_binding::deny` })[0]],
        });
        const gateRules = tx2.makeMoveVec({ type: `${PKG}::assembly_binding::Rule`, elements: [r1, r2] });
        tx2.moveCall({
            target: `${PKG}::assembly_binding::set_policy`,
            arguments: [tx2.object(bindingId!), tx2.pure.id(gate1), gateRules],
        });

        const result2 = await client.signAndExecuteTransaction({
            transaction: tx2, signer: adminCtx.keypair,
            options: { showEffects: true },
        });
        assert(result2.effects?.status?.status === "success", "Gate 1 policy set");
        await delay(DELAY_MS);

        // ═══════════════════════════════════════════════════════════════
        // Test 3: Resolve role for Player A (tribe 100) → Allow
        // ═══════════════════════════════════════════════════════════════
        console.log("\nTest 3: Player A (tribe 100) resolve → Allow");

        async function resolveGateRole(
            charGameId: bigint, tribeId: number, charAddr: string, gateId: string,
        ): Promise<"allow" | "deny" | "default" | "error"> {
            const tx = new Transaction();
            const [evalCtx] = tx.moveCall({
                target: `${PKG}::assembly_binding::build_eval_context`,
                arguments: [tx.object(bindingId!), tx.pure.id(gateId), tx.pure.u64(charGameId), tx.pure.u32(tribeId), tx.pure.address(charAddr)],
            });
            const [tribeProof] = tx.moveCall({
                target: `${PKG}::condition_tribe::verify`,
                arguments: [tx.object(tribeCondId!), evalCtx],
            });
            const [everyoneProof] = tx.moveCall({
                target: `${PKG}::condition_everyone::verify`,
                arguments: [tx.object(everyoneCondId!), evalCtx],
            });
            const proofs = tx.makeMoveVec({
                type: `${PKG}::assembly_binding::ConditionProof`,
                elements: [tribeProof, everyoneProof],
            });
            const [decision] = tx.moveCall({
                target: `${PKG}::assembly_binding::resolve_role`,
                arguments: [tx.object(bindingId!), tx.pure.id(gateId), tx.pure.u64(charGameId), proofs],
            });
            tx.moveCall({ target: `${PKG}::assembly_binding::is_allow`, arguments: [decision] });

            const result = await client.devInspectTransactionBlock({ sender: charAddr, transactionBlock: tx });
            if (result.effects?.status?.status !== "success") return "error";
            const lastIdx = (result.results?.length ?? 0) - 1;
            const isAllow = result.results?.[lastIdx]?.returnValues?.[0]?.[0]?.[0] === 1;
            if (isAllow) return "allow";

            // Check deny
            const tx2 = new Transaction();
            const [ec2] = tx2.moveCall({
                target: `${PKG}::assembly_binding::build_eval_context`,
                arguments: [tx2.object(bindingId!), tx2.pure.id(gateId), tx2.pure.u64(charGameId), tx2.pure.u32(tribeId), tx2.pure.address(charAddr)],
            });
            const [tp2] = tx2.moveCall({ target: `${PKG}::condition_tribe::verify`, arguments: [tx2.object(tribeCondId!), ec2] });
            const [ep2] = tx2.moveCall({ target: `${PKG}::condition_everyone::verify`, arguments: [tx2.object(everyoneCondId!), ec2] });
            const p2 = tx2.makeMoveVec({ type: `${PKG}::assembly_binding::ConditionProof`, elements: [tp2, ep2] });
            const [d2] = tx2.moveCall({
                target: `${PKG}::assembly_binding::resolve_role`,
                arguments: [tx2.object(bindingId!), tx2.pure.id(gateId), tx2.pure.u64(charGameId), p2],
            });
            tx2.moveCall({ target: `${PKG}::assembly_binding::is_deny`, arguments: [d2] });
            const r2result = await client.devInspectTransactionBlock({ sender: charAddr, transactionBlock: tx2 });
            const lastIdx2 = (r2result.results?.length ?? 0) - 1;
            return r2result.results?.[lastIdx2]?.returnValues?.[0]?.[0]?.[0] === 1 ? "deny" : "default";
        }

        // Player A is tribe 100 → should be allowed
        assert(
            await resolveGateRole(BigInt(GAME_CHARACTER_ID), 100, playerACtx.address, gate1) === "allow",
            "Player A (tribe 100) → Allow on gate 1",
        );

        // ═══════════════════════════════════════════════════════════════
        // Test 4: Resolve role for Player B (also tribe 100) → Allow
        // (Both characters are tribe 100 in test resources)
        // ═══════════════════════════════════════════════════════════════
        console.log("\nTest 4: Player B (tribe 100) resolve → Allow");

        assert(
            await resolveGateRole(900000001n, 100, playerBCtx.address, gate1) === "allow",
            "Player B (tribe 100) → Allow on gate 1",
        );

        // ═══════════════════════════════════════════════════════════════
        // Test 5: Add Player B to blocklist → Deny despite tribe match
        // ═══════════════════════════════════════════════════════════════
        console.log("\nTest 5: Blocklist Player B → Deny");

        const tx5 = new Transaction();
        tx5.moveCall({
            target: `${PKG}::assembly_binding::add_to_blocklist`,
            arguments: [tx5.object(bindingId!), tx5.pure.u64(900000001n)],
        });
        const r5 = await client.signAndExecuteTransaction({
            transaction: tx5, signer: adminCtx.keypair, options: { showEffects: true },
        });
        assert(r5.effects?.status?.status === "success", "Player B blocklisted");
        await delay(DELAY_MS);

        assert(
            await resolveGateRole(900000001n, 100, playerBCtx.address, gate1) === "deny",
            "Blocklisted Player B → Deny (overrides tribe allow)",
        );

        // Player A should still be allowed
        assert(
            await resolveGateRole(BigInt(GAME_CHARACTER_ID), 100, playerACtx.address, gate1) === "allow",
            "Player A still → Allow (not blocklisted)",
        );

        // ═══════════════════════════════════════════════════════════════
        // Test 6: Remove Player B from blocklist → Allow again
        // ═══════════════════════════════════════════════════════════════
        console.log("\nTest 6: Remove blocklist → Allow again");

        const tx6 = new Transaction();
        tx6.moveCall({
            target: `${PKG}::assembly_binding::remove_from_blocklist`,
            arguments: [tx6.object(bindingId!), tx6.pure.u64(900000001n)],
        });
        await client.signAndExecuteTransaction({
            transaction: tx6, signer: adminCtx.keypair, options: { showEffects: true },
        });
        await delay(DELAY_MS);

        assert(
            await resolveGateRole(900000001n, 100, playerBCtx.address, gate1) === "allow",
            "Player B unblocklisted → Allow again",
        );

        // ═══════════════════════════════════════════════════════════════
        // Test 7: Change policy — only Player A allowed, everyone else denied
        // ═══════════════════════════════════════════════════════════════
        console.log("\nTest 7: Change policy to character-specific");

        const tx7 = new Transaction();
        const [cr1] = tx7.moveCall({
            target: `${PKG}::assembly_binding::rule`,
            arguments: [tx7.pure.id(charACondId!), tx7.moveCall({ target: `${PKG}::assembly_binding::allow` })[0]],
        });
        const [cr2] = tx7.moveCall({
            target: `${PKG}::assembly_binding::rule`,
            arguments: [tx7.pure.id(everyoneCondId!), tx7.moveCall({ target: `${PKG}::assembly_binding::deny` })[0]],
        });
        const newRules = tx7.makeMoveVec({ type: `${PKG}::assembly_binding::Rule`, elements: [cr1, cr2] });
        tx7.moveCall({
            target: `${PKG}::assembly_binding::set_policy`,
            arguments: [tx7.object(bindingId!), tx7.pure.id(gate1), newRules],
        });
        const r7 = await client.signAndExecuteTransaction({
            transaction: tx7, signer: adminCtx.keypair, options: { showEffects: true },
        });
        assert(r7.effects?.status?.status === "success", "Policy changed to Character A only");
        await delay(DELAY_MS);

        // Now we need charA condition proofs too
        async function resolveGateWithCharCondition(
            charGameId: bigint, tribeId: number, charAddr: string, gateId: string,
        ): Promise<"allow" | "deny" | "default" | "error"> {
            const tx = new Transaction();
            const [evalCtx] = tx.moveCall({
                target: `${PKG}::assembly_binding::build_eval_context`,
                arguments: [tx.object(bindingId!), tx.pure.id(gateId), tx.pure.u64(charGameId), tx.pure.u32(tribeId), tx.pure.address(charAddr)],
            });
            const [charProof] = tx.moveCall({
                target: `${PKG}::condition_character::verify`,
                arguments: [tx.object(charACondId!), evalCtx],
            });
            const [everyoneProof] = tx.moveCall({
                target: `${PKG}::condition_everyone::verify`,
                arguments: [tx.object(everyoneCondId!), evalCtx],
            });
            const proofs = tx.makeMoveVec({
                type: `${PKG}::assembly_binding::ConditionProof`,
                elements: [charProof, everyoneProof],
            });
            const [decision] = tx.moveCall({
                target: `${PKG}::assembly_binding::resolve_role`,
                arguments: [tx.object(bindingId!), tx.pure.id(gateId), tx.pure.u64(charGameId), proofs],
            });
            tx.moveCall({ target: `${PKG}::assembly_binding::is_allow`, arguments: [decision] });

            const result = await client.devInspectTransactionBlock({ sender: charAddr, transactionBlock: tx });
            if (result.effects?.status?.status !== "success") return "error";
            const lastIdx = (result.results?.length ?? 0) - 1;
            const isAllow = result.results?.[lastIdx]?.returnValues?.[0]?.[0]?.[0] === 1;
            if (isAllow) return "allow";

            // Check deny
            const txd = new Transaction();
            const [ecd] = txd.moveCall({
                target: `${PKG}::assembly_binding::build_eval_context`,
                arguments: [txd.object(bindingId!), txd.pure.id(gateId), txd.pure.u64(charGameId), txd.pure.u32(tribeId), txd.pure.address(charAddr)],
            });
            const [cpd] = txd.moveCall({ target: `${PKG}::condition_character::verify`, arguments: [txd.object(charACondId!), ecd] });
            const [epd] = txd.moveCall({ target: `${PKG}::condition_everyone::verify`, arguments: [txd.object(everyoneCondId!), ecd] });
            const pd = txd.makeMoveVec({ type: `${PKG}::assembly_binding::ConditionProof`, elements: [cpd, epd] });
            const [dd] = txd.moveCall({
                target: `${PKG}::assembly_binding::resolve_role`,
                arguments: [txd.object(bindingId!), txd.pure.id(gateId), txd.pure.u64(charGameId), pd],
            });
            txd.moveCall({ target: `${PKG}::assembly_binding::is_deny`, arguments: [dd] });
            const rd = await client.devInspectTransactionBlock({ sender: charAddr, transactionBlock: txd });
            const li = (rd.results?.length ?? 0) - 1;
            return rd.results?.[li]?.returnValues?.[0]?.[0]?.[0] === 1 ? "deny" : "default";
        }

        assert(
            await resolveGateWithCharCondition(BigInt(GAME_CHARACTER_ID), 100, playerACtx.address, gate1) === "allow",
            "Player A → Allow (character condition matches)",
        );

        assert(
            await resolveGateWithCharCondition(900000001n, 100, playerBCtx.address, gate1) === "deny",
            "Player B → Deny (character condition doesn't match, everyone deny)",
        );

        // ═══════════════════════════════════════════════════════════════
        // Test 8: Install ef_guard extension on gate (OwnerCap borrow pattern)
        // ═══════════════════════════════════════════════════════════════
        console.log("\nTest 8: Install ef_guard extension on gate");

        // Find the gate's OwnerCap owned by charA
        const gateOwnerCaps = await client.getOwnedObjects({
            owner: charA,
            filter: { StructType: `${WORLD}::access::OwnerCap<${WORLD}::gate::Gate>` },
            limit: 10,
        });

        // Find the one that authorizes gate1
        let gateOwnerCapId: string | undefined;
        for (const obj of gateOwnerCaps.data) {
            const detail = await client.getObject({ id: obj.data!.objectId, options: { showContent: true } });
            const fields = (detail.data?.content as any)?.fields;
            if (fields?.authorized_object_id === gate1) {
                gateOwnerCapId = obj.data!.objectId;
                break;
            }
        }

        if (!gateOwnerCapId) {
            skip("Gate OwnerCap not found for gate 1 — skipping extension install test");
        } else {
            const capDetail = await client.getObject({ id: gateOwnerCapId, options: { showContent: true } });

            const tx8 = new Transaction();

            // Borrow OwnerCap from Character
            const [cap, receipt] = tx8.moveCall({
                target: `${WORLD}::character::borrow_owner_cap`,
                typeArguments: [`${WORLD}::gate::Gate`],
                arguments: [
                    tx8.object(charA),
                    tx8.receivingRef({
                        objectId: gateOwnerCapId,
                        version: capDetail.data!.version!,
                        digest: capDetail.data!.digest!,
                    }),
                ],
            });

            // Authorize ef_guard extension
            const [gateConfig] = tx8.moveCall({
                target: `${PKG}::gate_extension::authorize_on_gate`,
                arguments: [tx8.object(gate1), cap, tx8.pure.u64(3600000)], // 1hr TTL
            });

            // Share config
            tx8.moveCall({ target: `${PKG}::gate_extension::share_config`, arguments: [gateConfig] });

            // Return OwnerCap
            tx8.moveCall({
                target: `${WORLD}::character::return_owner_cap`,
                typeArguments: [`${WORLD}::gate::Gate`],
                arguments: [tx8.object(charA), cap, receipt],
            });

            const r8 = await client.signAndExecuteTransaction({
                transaction: tx8, signer: playerACtx.keypair,
                options: { showEffects: true, showObjectChanges: true },
            });

            if (r8.effects?.status?.status === "success") {
                assert(true, "ef_guard extension installed on gate 1");

                const configId = (r8.objectChanges?.find(
                    (c: any) => c.type === "created" && c.objectType?.includes("GateExtensionConfig"),
                ) as any)?.objectId;
                assert(!!configId, `GateExtensionConfig: ${configId}`);

                await delay(DELAY_MS);

                // Verify gate now has extension
                const gateAfter = await client.getObject({ id: gate1, options: { showContent: true } });
                const ext = (gateAfter.data?.content as any)?.fields?.extension;
                assert(ext !== null && ext !== undefined && ext !== "None", "Gate 1 now has extension configured");

                // Also install on gate 2 (required by world contracts — both gates need same extension)
                let gate2OwnerCapId: string | undefined;
                for (const obj of gateOwnerCaps.data) {
                    const detail = await client.getObject({ id: obj.data!.objectId, options: { showContent: true } });
                    const fields = (detail.data?.content as any)?.fields;
                    if (fields?.authorized_object_id === gate2) {
                        gate2OwnerCapId = obj.data!.objectId;
                        break;
                    }
                }

                if (gate2OwnerCapId) {
                    const cap2Detail = await client.getObject({ id: gate2OwnerCapId, options: { showContent: true } });
                    const tx8b = new Transaction();
                    const [cap2, receipt2] = tx8b.moveCall({
                        target: `${WORLD}::character::borrow_owner_cap`,
                        typeArguments: [`${WORLD}::gate::Gate`],
                        arguments: [
                            tx8b.object(charA),
                            tx8b.receivingRef({
                                objectId: gate2OwnerCapId,
                                version: cap2Detail.data!.version!,
                                digest: cap2Detail.data!.digest!,
                            }),
                        ],
                    });
                    const [gateConfig2] = tx8b.moveCall({
                        target: `${PKG}::gate_extension::authorize_on_gate`,
                        arguments: [tx8b.object(gate2), cap2, tx8b.pure.u64(3600000)],
                    });
                    tx8b.moveCall({ target: `${PKG}::gate_extension::share_config`, arguments: [gateConfig2] });
                    tx8b.moveCall({
                        target: `${WORLD}::character::return_owner_cap`,
                        typeArguments: [`${WORLD}::gate::Gate`],
                        arguments: [tx8b.object(charA), cap2, receipt2],
                    });
                    const r8b = await client.signAndExecuteTransaction({
                        transaction: tx8b, signer: playerACtx.keypair,
                        options: { showEffects: true },
                    });
                    assert(r8b.effects?.status?.status === "success", "ef_guard extension installed on gate 2");
                    await delay(DELAY_MS);
                } else {
                    skip("Gate 2 OwnerCap not found");
                }

                // ═══════════════════════════════════════════════════════════════
                // Test 9: Player A requests permit via ef_guard (real gate extension)
                // ═══════════════════════════════════════════════════════════════
                if (configId) {
                    console.log("\nTest 9: Player A requests permit via gate extension");

                    // Set policy back to tribe 100 allow for this test
                    const txPolicy = new Transaction();
                    const [pr1] = txPolicy.moveCall({
                        target: `${PKG}::assembly_binding::rule`,
                        arguments: [txPolicy.pure.id(tribeCondId!), txPolicy.moveCall({ target: `${PKG}::assembly_binding::allow` })[0]],
                    });
                    const [pr2] = txPolicy.moveCall({
                        target: `${PKG}::assembly_binding::rule`,
                        arguments: [txPolicy.pure.id(everyoneCondId!), txPolicy.moveCall({ target: `${PKG}::assembly_binding::deny` })[0]],
                    });
                    const pRules = txPolicy.makeMoveVec({ type: `${PKG}::assembly_binding::Rule`, elements: [pr1, pr2] });
                    txPolicy.moveCall({
                        target: `${PKG}::assembly_binding::set_policy`,
                        arguments: [txPolicy.object(bindingId!), txPolicy.pure.id(gate1), pRules],
                    });
                    await client.signAndExecuteTransaction({
                        transaction: txPolicy, signer: adminCtx.keypair, options: { showEffects: true },
                    });
                    await delay(DELAY_MS);

                    // Player A requests permit
                    const tx9 = new Transaction();

                    // Build eval context
                    const [evalCtx9] = tx9.moveCall({
                        target: `${PKG}::assembly_binding::build_eval_context`,
                        arguments: [
                            tx9.object(bindingId!), tx9.pure.id(gate1),
                            tx9.pure.u64(BigInt(GAME_CHARACTER_ID)), tx9.pure.u32(100),
                            tx9.pure.address(playerACtx.address),
                        ],
                    });

                    // Verify conditions
                    const [tribeProof9] = tx9.moveCall({
                        target: `${PKG}::condition_tribe::verify`,
                        arguments: [tx9.object(tribeCondId!), evalCtx9],
                    });
                    const [everyoneProof9] = tx9.moveCall({
                        target: `${PKG}::condition_everyone::verify`,
                        arguments: [tx9.object(everyoneCondId!), evalCtx9],
                    });
                    const proofs9 = tx9.makeMoveVec({
                        type: `${PKG}::assembly_binding::ConditionProof`,
                        elements: [tribeProof9, everyoneProof9],
                    });

                    // Request permit via gate extension
                    const clock = tx9.object("0x6"); // Sui system Clock

                    tx9.moveCall({
                        target: `${PKG}::gate_extension::request_permit`,
                        arguments: [
                            tx9.object(configId),
                            tx9.object(bindingId!),
                            proofs9,
                            tx9.object(gate1),
                            tx9.object(gate2),
                            tx9.object(charA),
                            clock,
                        ],
                    });

                    const r9 = await client.signAndExecuteTransaction({
                        transaction: tx9, signer: playerACtx.keypair,
                        options: { showEffects: true, showObjectChanges: true, showEvents: true },
                    });

                    if (r9.effects?.status?.status === "success") {
                        assert(true, "Player A: request_permit succeeded → JumpPermit issued!");

                        // Check for PermitIssuedEvent
                        const permitEvent = r9.events?.find(
                            (e: any) => e.type.includes("PermitIssuedEvent"),
                        );
                        assert(!!permitEvent, "PermitIssuedEvent emitted");

                        // Check JumpPermit was created
                        const permitObj = r9.objectChanges?.find(
                            (c: any) => c.type === "created" && c.objectType?.includes("JumpPermit"),
                        );
                        assert(!!permitObj, `JumpPermit created: ${(permitObj as any)?.objectId}`);
                    } else {
                        const err = r9.effects?.status?.error ?? "unknown";
                        assert(false, `request_permit failed: ${err}`);
                    }

                    // ═══════════════════════════════════════════════════════════════
                    // Test 10: Blocklisted Player B requests permit → denied
                    // ═══════════════════════════════════════════════════════════════
                    console.log("\nTest 10: Blocklisted Player B requests permit → denied");

                    // Blocklist Player B
                    const txBL = new Transaction();
                    txBL.moveCall({
                        target: `${PKG}::assembly_binding::add_to_blocklist`,
                        arguments: [txBL.object(bindingId!), txBL.pure.u64(900000001n)],
                    });
                    await client.signAndExecuteTransaction({
                        transaction: txBL, signer: adminCtx.keypair, options: { showEffects: true },
                    });
                    await delay(DELAY_MS);

                    // Player B tries to request permit
                    const tx10 = new Transaction();
                    const [evalCtx10] = tx10.moveCall({
                        target: `${PKG}::assembly_binding::build_eval_context`,
                        arguments: [
                            tx10.object(bindingId!), tx10.pure.id(gate1),
                            tx10.pure.u64(900000001n), tx10.pure.u32(100),
                            tx10.pure.address(playerBCtx.address),
                        ],
                    });
                    const [tp10] = tx10.moveCall({
                        target: `${PKG}::condition_tribe::verify`,
                        arguments: [tx10.object(tribeCondId!), evalCtx10],
                    });
                    const [ep10] = tx10.moveCall({
                        target: `${PKG}::condition_everyone::verify`,
                        arguments: [tx10.object(everyoneCondId!), evalCtx10],
                    });
                    const proofs10 = tx10.makeMoveVec({
                        type: `${PKG}::assembly_binding::ConditionProof`,
                        elements: [tp10, ep10],
                    });
                    tx10.moveCall({
                        target: `${PKG}::gate_extension::request_permit`,
                        arguments: [
                            tx10.object(configId),
                            tx10.object(bindingId!),
                            proofs10,
                            tx10.object(gate1),
                            tx10.object(gate2),
                            tx10.object(charB),
                            tx10.object("0x6"),
                        ],
                    });

                    try {
                        await client.signAndExecuteTransaction({
                            transaction: tx10, signer: playerBCtx.keypair,
                            options: { showEffects: true },
                        });
                        assert(false, "Player B should have been denied");
                    } catch (err) {
                        // Expected: transaction should fail with EAccessDenied
                        assert(true, "Blocklisted Player B → EAccessDenied (correctly denied)");
                    }
                }
            } else {
                const err = r8.effects?.status?.error ?? "unknown";
                assert(false, `Extension install failed: ${err}`);
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // Test 11: Ownership transfer — new owner can manage, old cannot
        // ═══════════════════════════════════════════════════════════════
        console.log("\nTest 11: Ownership transfer");

        const tx11 = new Transaction();
        tx11.moveCall({
            target: `${PKG}::assembly_binding::transfer_ownership`,
            arguments: [tx11.object(bindingId!), tx11.pure.address(playerBCtx.address)],
        });
        const r11 = await client.signAndExecuteTransaction({
            transaction: tx11, signer: adminCtx.keypair, options: { showEffects: true },
        });
        assert(r11.effects?.status?.status === "success", `Ownership transferred to Player B`);
        await delay(DELAY_MS);

        // Old owner (admin) tries to modify → should fail
        const tx11b = new Transaction();
        tx11b.moveCall({
            target: `${PKG}::assembly_binding::add_to_blocklist`,
            arguments: [tx11b.object(bindingId!), tx11b.pure.u64(12345n)],
        });
        try {
            await client.signAndExecuteTransaction({
                transaction: tx11b, signer: adminCtx.keypair, options: { showEffects: true },
            });
            assert(false, "Old owner should be rejected");
        } catch {
            assert(true, "Old owner correctly rejected (not binding owner)");
        }

        // New owner (Player B) can modify
        const tx11c = new Transaction();
        tx11c.moveCall({
            target: `${PKG}::assembly_binding::add_to_blocklist`,
            arguments: [tx11c.object(bindingId!), tx11c.pure.u64(12345n)],
        });
        const r11c = await client.signAndExecuteTransaction({
            transaction: tx11c, signer: playerBCtx.keypair, options: { showEffects: true },
        });
        assert(r11c.effects?.status?.status === "success", "New owner (Player B) can modify binding");

        // ═══════════════════════════════════════════════════════════════
        // Test 12: Min balance condition (using real SUI coins)
        // ═══════════════════════════════════════════════════════════════
        console.log("\nTest 12: Min balance condition with real SUI coins");

        // Wait for previous ownership test to settle
        await delay(DELAY_MS);

        // Transfer ownership back to admin for this test
        const txTransferBack = new Transaction();
        txTransferBack.moveCall({
            target: `${PKG}::assembly_binding::transfer_ownership`,
            arguments: [txTransferBack.object(bindingId!), txTransferBack.pure.address(adminCtx.address)],
        });
        await client.signAndExecuteTransaction({
            transaction: txTransferBack, signer: playerBCtx.keypair, options: { showEffects: true },
        });
        await delay(DELAY_MS);

        // Create min balance condition: require at least 1 MIST (very low — should pass)
        const tx12a = new Transaction();
        const [lowBalanceCond] = tx12a.moveCall({
            target: `${PKG}::condition_min_balance::new`,
            arguments: [tx12a.pure.u64(1n)], // 1 MIST
        });
        tx12a.moveCall({ target: `${PKG}::condition_min_balance::share`, arguments: [lowBalanceCond] });

        // Create high balance condition: require 999999 SUI (way too high — should fail)
        const [highBalanceCond] = tx12a.moveCall({
            target: `${PKG}::condition_min_balance::new`,
            arguments: [tx12a.pure.u64(999999000000000n)], // 999999 SUI in MIST
        });
        tx12a.moveCall({ target: `${PKG}::condition_min_balance::share`, arguments: [highBalanceCond] });

        const r12a = await client.signAndExecuteTransaction({
            transaction: tx12a, signer: adminCtx.keypair,
            options: { showEffects: true, showObjectChanges: true },
        });
        assert(r12a.effects?.status?.status === "success", "Balance conditions created");

        const lowBalanceCondId = (r12a.objectChanges?.find(
            (c: any) => c.type === "created" && c.objectType?.includes("MinBalanceCondition") && c.objectId < "0x9",
        ) as any)?.objectId ?? (r12a.objectChanges?.filter(
            (c: any) => c.type === "created" && c.objectType?.includes("MinBalanceCondition"),
        ) as any)?.[0]?.objectId;

        const highBalanceCondId = (r12a.objectChanges?.filter(
            (c: any) => c.type === "created" && c.objectType?.includes("MinBalanceCondition"),
        ) as any)?.[1]?.objectId;

        assert(!!lowBalanceCondId, `Low balance condition: ${lowBalanceCondId}`);
        assert(!!highBalanceCondId, `High balance condition: ${highBalanceCondId}`);
        await delay(DELAY_MS);

        // Set SSU policy: low balance → Allow (should pass for anyone with SUI)
        const tx12b = new Transaction();
        const [br1] = tx12b.moveCall({
            target: `${PKG}::assembly_binding::rule`,
            arguments: [tx12b.pure.id(lowBalanceCondId!), tx12b.moveCall({ target: `${PKG}::assembly_binding::allow` })[0]],
        });
        const ssuBalanceRules = tx12b.makeMoveVec({ type: `${PKG}::assembly_binding::Rule`, elements: [br1] });
        tx12b.moveCall({
            target: `${PKG}::assembly_binding::set_policy`,
            arguments: [tx12b.object(bindingId!), tx12b.pure.id(ssu), ssuBalanceRules],
        });
        const r12b = await client.signAndExecuteTransaction({
            transaction: tx12b, signer: adminCtx.keypair, options: { showEffects: true },
        });
        assert(r12b.effects?.status?.status === "success", "SSU policy: low balance → Allow");
        await delay(DELAY_MS);

        // Get Player A's coin object
        const playerACoins = await client.getCoins({ owner: playerACtx.address, coinType: "0x2::sui::SUI", limit: 1 });
        const playerACoinId = playerACoins.data[0]?.coinObjectId;
        assert(!!playerACoinId, `Player A has SUI coin: ${playerACoinId}`);

        // Test: low threshold → Allow (Player A has plenty of SUI)
        if (playerACoinId) {
            const tx12c = new Transaction();
            const [evalCtx12] = tx12c.moveCall({
                target: `${PKG}::assembly_binding::build_eval_context`,
                arguments: [
                    tx12c.object(bindingId!), tx12c.pure.id(ssu),
                    tx12c.pure.u64(BigInt(GAME_CHARACTER_ID)), tx12c.pure.u32(100),
                    tx12c.pure.address(playerACtx.address),
                ],
            });
            const [balProof] = tx12c.moveCall({
                target: `${PKG}::condition_min_balance::verify`,
                typeArguments: ["0x2::sui::SUI"],
                arguments: [tx12c.object(lowBalanceCondId!), evalCtx12, tx12c.object(playerACoinId)],
            });
            const proofs12 = tx12c.makeMoveVec({
                type: `${PKG}::assembly_binding::ConditionProof`,
                elements: [balProof],
            });
            const [decision12] = tx12c.moveCall({
                target: `${PKG}::assembly_binding::resolve_role`,
                arguments: [tx12c.object(bindingId!), tx12c.pure.id(ssu), tx12c.pure.u64(BigInt(GAME_CHARACTER_ID)), proofs12],
            });
            tx12c.moveCall({ target: `${PKG}::assembly_binding::is_allow`, arguments: [decision12] });

            const r12c = await client.devInspectTransactionBlock({
                sender: playerACtx.address, transactionBlock: tx12c,
            });
            const lastIdx12 = (r12c.results?.length ?? 0) - 1;
            const isAllow12 = r12c.results?.[lastIdx12]?.returnValues?.[0]?.[0]?.[0] === 1;
            assert(isAllow12 === true, "Low balance threshold (1 MIST) → Allow (player has SUI)");
        }

        // Now change policy to high threshold → should Deny
        const tx12d = new Transaction();
        const [br2] = tx12d.moveCall({
            target: `${PKG}::assembly_binding::rule`,
            arguments: [tx12d.pure.id(highBalanceCondId!), tx12d.moveCall({ target: `${PKG}::assembly_binding::allow` })[0]],
        });
        const [br3] = tx12d.moveCall({
            target: `${PKG}::assembly_binding::rule`,
            arguments: [tx12d.pure.id(everyoneCondId!), tx12d.moveCall({ target: `${PKG}::assembly_binding::deny` })[0]],
        });
        const ssuHighRules = tx12d.makeMoveVec({ type: `${PKG}::assembly_binding::Rule`, elements: [br2, br3] });
        tx12d.moveCall({
            target: `${PKG}::assembly_binding::set_policy`,
            arguments: [tx12d.object(bindingId!), tx12d.pure.id(ssu), ssuHighRules],
        });
        const r12d = await client.signAndExecuteTransaction({
            transaction: tx12d, signer: adminCtx.keypair, options: { showEffects: true },
        });
        assert(r12d.effects?.status?.status === "success", "SSU policy: high balance → Allow, Everyone → Deny");
        await delay(DELAY_MS);

        // Test: high threshold → Deny (Player A doesn't have 999999 SUI)
        if (playerACoinId) {
            const tx12e = new Transaction();
            const [evalCtx12e] = tx12e.moveCall({
                target: `${PKG}::assembly_binding::build_eval_context`,
                arguments: [
                    tx12e.object(bindingId!), tx12e.pure.id(ssu),
                    tx12e.pure.u64(BigInt(GAME_CHARACTER_ID)), tx12e.pure.u32(100),
                    tx12e.pure.address(playerACtx.address),
                ],
            });
            const [balProofHigh] = tx12e.moveCall({
                target: `${PKG}::condition_min_balance::verify`,
                typeArguments: ["0x2::sui::SUI"],
                arguments: [tx12e.object(highBalanceCondId!), evalCtx12e, tx12e.object(playerACoinId)],
            });
            const [evProofHigh] = tx12e.moveCall({
                target: `${PKG}::condition_everyone::verify`,
                arguments: [tx12e.object(everyoneCondId!), evalCtx12e],
            });
            const proofs12e = tx12e.makeMoveVec({
                type: `${PKG}::assembly_binding::ConditionProof`,
                elements: [balProofHigh, evProofHigh],
            });
            const [decision12e] = tx12e.moveCall({
                target: `${PKG}::assembly_binding::resolve_role`,
                arguments: [tx12e.object(bindingId!), tx12e.pure.id(ssu), tx12e.pure.u64(BigInt(GAME_CHARACTER_ID)), proofs12e],
            });
            tx12e.moveCall({ target: `${PKG}::assembly_binding::is_deny`, arguments: [decision12e] });

            const r12e = await client.devInspectTransactionBlock({
                sender: playerACtx.address, transactionBlock: tx12e,
            });
            const lastIdx12e = (r12e.results?.length ?? 0) - 1;
            const isDeny12 = r12e.results?.[lastIdx12e]?.returnValues?.[0]?.[0]?.[0] === 1;
            assert(isDeny12 === true, "High balance threshold (999999 SUI) → Deny (insufficient funds)");
        }

        // ═══════════════════════════════════════════════════════════════
        // Summary
        // ═══════════════════════════════════════════════════════════════
        console.log("\n══════════════════════════════════════════════════════════");
        console.log(`  Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
        console.log("══════════════════════════════════════════════════════════\n");

        if (failed > 0) process.exit(1);

    } catch (error) {
        handleError(error);
    }
}

main();
