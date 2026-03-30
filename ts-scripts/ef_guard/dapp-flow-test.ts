/**
 * DApp flow test — simulates the EXACT user flow from the DApp.
 *
 * Tests what happens when a user:
 *   1. Installs ef_guard on a turret (creates binding + registers + authorizes extension)
 *   2. Creates condition objects (tribe, character, everyone)
 *   3. Sets a policy on the turret using condition IDs
 *   4. Verifies the policy works (allowed player, denied player, blocklist)
 *   5. Adds player to blocklist
 *   6. Verifies blocklist overrides allow rule
 *
 * This is a two-transaction flow matching the DApp's Apply behavior:
 *   TX1: Create binding + register assembly + create conditions + share all
 *   TX2: Set policy using condition IDs from TX1
 */
import "dotenv/config";
import { Transaction } from "@mysten/sui/transactions";
import {
    getEnvConfig, handleError, hydrateWorldConfig, initializeContext,
    delay, DELAY_MS
} from "../utils/helper";
import { deriveObjectId } from "../utils/derive-object-id";
import { GAME_CHARACTER_ID, GATE_ITEM_ID_1, GATE_ITEM_ID_2 } from "../utils/constants";

let WORLD: string;
let PKG: string;
let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
    if (condition) { console.log(`  ✓ ${message}`); passed++; }
    else { console.error(`  ✗ ${message}`); failed++; }
}

async function main() {
    console.log("\n══════════════════════════════════════════════════════════");
    console.log("  DApp flow test (simulates real user actions)");
    console.log("══════════════════════════════════════════════════════════\n");

    try {
        const env = getEnvConfig();
        const adminCtx = initializeContext(env.network, env.adminExportedKey);
        const playerACtx = initializeContext(env.network, process.env.PLAYER_A_PRIVATE_KEY!);
        const playerBCtx = initializeContext(env.network, process.env.PLAYER_B_PRIVATE_KEY!);
        const { client } = adminCtx;
        await hydrateWorldConfig(adminCtx);
        playerACtx.config = { ...adminCtx.config };

        WORLD = adminCtx.config.packageId;
        PKG = process.env.BUILDER_PACKAGE_ID!;
        if (!PKG) throw new Error("BUILDER_PACKAGE_ID not set");

        const registry = adminCtx.config.objectRegistry;
        const charA = deriveObjectId(registry, BigInt(GAME_CHARACTER_ID), WORLD);
        const gate1 = deriveObjectId(registry, GATE_ITEM_ID_1, WORLD);
        const gate2 = deriveObjectId(registry, GATE_ITEM_ID_2, WORLD);

        console.log(`World:    ${WORLD}`);
        console.log(`ef_guard: ${PKG}`);
        console.log(`Player A: ${playerACtx.address}`);
        console.log(`Gate 1:   ${gate1}\n`);

        // ═══════════════════════════════════════════════════════════════
        // TX1: Simulates "Install ef_guard" + first-time setup
        // Creates: binding, tribe condition, everyone condition
        // Registers: gate1, gate2
        // Installs: extension on gate1 (via OwnerCap borrow)
        // Shares: everything
        // ═══════════════════════════════════════════════════════════════
        console.log("TX1: Create binding + conditions + register + install extension");

        const tx1 = new Transaction();

        // Create binding
        const [binding] = tx1.moveCall({ target: `${PKG}::assembly_binding::new_binding` });

        // Register gates
        tx1.moveCall({ target: `${PKG}::assembly_binding::register_gate`, arguments: [binding, tx1.pure.id(gate1)] });
        tx1.moveCall({ target: `${PKG}::assembly_binding::register_gate`, arguments: [binding, tx1.pure.id(gate2)] });

        // Create conditions
        const [tribeCond] = tx1.moveCall({
            target: `${PKG}::condition_tribe::new`,
            arguments: [tx1.pure.u32(100)],
        });
        const [everyoneCond] = tx1.moveCall({
            target: `${PKG}::condition_everyone::new`,
        });

        // Share conditions
        tx1.moveCall({ target: `${PKG}::condition_tribe::share`, arguments: [tribeCond] });
        tx1.moveCall({ target: `${PKG}::condition_everyone::share`, arguments: [everyoneCond] });

        // Install extension on gate1 (borrow OwnerCap)
        const gateOwnerCaps = await client.getOwnedObjects({
            owner: charA,
            filter: { StructType: `${WORLD}::access::OwnerCap<${WORLD}::gate::Gate>` },
            limit: 10,
        });

        let gate1CapId: string | undefined;
        let gate2CapId: string | undefined;
        for (const obj of gateOwnerCaps.data) {
            const detail = await client.getObject({ id: obj.data!.objectId, options: { showContent: true } });
            const fields = (detail.data?.content as any)?.fields;
            if (fields?.authorized_object_id === gate1) gate1CapId = obj.data!.objectId;
            if (fields?.authorized_object_id === gate2) gate2CapId = obj.data!.objectId;
        }

        if (gate1CapId) {
            const capDetail = await client.getObject({ id: gate1CapId, options: { showContent: true } });
            const [cap, receipt] = tx1.moveCall({
                target: `${WORLD}::character::borrow_owner_cap`,
                typeArguments: [`${WORLD}::gate::Gate`],
                arguments: [
                    tx1.object(charA),
                    tx1.receivingRef({
                        objectId: gate1CapId,
                        version: capDetail.data!.version!,
                        digest: capDetail.data!.digest!,
                    }),
                ],
            });
            const [gateConfig] = tx1.moveCall({
                target: `${PKG}::gate_extension::authorize_on_gate`,
                arguments: [tx1.object(gate1), cap, tx1.pure.u64(3600000)],
            });
            tx1.moveCall({ target: `${PKG}::gate_extension::share_config`, arguments: [gateConfig] });
            tx1.moveCall({
                target: `${WORLD}::character::return_owner_cap`,
                typeArguments: [`${WORLD}::gate::Gate`],
                arguments: [tx1.object(charA), cap, receipt],
            });
        }

        // Also install on gate2
        if (gate2CapId) {
            const capDetail = await client.getObject({ id: gate2CapId, options: { showContent: true } });
            const [cap2, receipt2] = tx1.moveCall({
                target: `${WORLD}::character::borrow_owner_cap`,
                typeArguments: [`${WORLD}::gate::Gate`],
                arguments: [
                    tx1.object(charA),
                    tx1.receivingRef({
                        objectId: gate2CapId,
                        version: capDetail.data!.version!,
                        digest: capDetail.data!.digest!,
                    }),
                ],
            });
            const [gateConfig2] = tx1.moveCall({
                target: `${PKG}::gate_extension::authorize_on_gate`,
                arguments: [tx1.object(gate2), cap2, tx1.pure.u64(3600000)],
            });
            tx1.moveCall({ target: `${PKG}::gate_extension::share_config`, arguments: [gateConfig2] });
            tx1.moveCall({
                target: `${WORLD}::character::return_owner_cap`,
                typeArguments: [`${WORLD}::gate::Gate`],
                arguments: [tx1.object(charA), cap2, receipt2],
            });
        }

        // Share binding LAST (moves the object)
        tx1.moveCall({ target: `${PKG}::assembly_binding::share_binding`, arguments: [binding] });

        const result1 = await client.signAndExecuteTransaction({
            transaction: tx1, signer: playerACtx.keypair,
            options: { showEffects: true, showObjectChanges: true },
        });

        assert(result1.effects?.status?.status === "success", "TX1 succeeded: binding + conditions + extensions");

        // Extract created IDs
        const changes = result1.objectChanges ?? [];
        const findCreated = (suffix: string) =>
            (changes.find((c: any) => c.type === "created" && c.objectType?.includes(suffix)) as any)?.objectId;

        const bindingId = findCreated("AssemblyBinding");
        const tribeCondId = findCreated("TribeCondition");
        const everyoneCondId = findCreated("EveryoneCondition");

        assert(!!bindingId, `Binding: ${bindingId}`);
        assert(!!tribeCondId, `TribeCondition: ${tribeCondId}`);
        assert(!!everyoneCondId, `EveryoneCondition: ${everyoneCondId}`);

        await delay(DELAY_MS);

        // ═══════════════════════════════════════════════════════════════
        // TX2: Set policy using condition IDs from TX1
        // This is what the DApp's "Apply" button does
        // ═══════════════════════════════════════════════════════════════
        console.log("\nTX2: Set policy (Tribe 100 → Allow, Everyone → Deny)");

        const tx2 = new Transaction();

        // Build rules using condition IDs
        const [allowEff] = tx2.moveCall({ target: `${PKG}::assembly_binding::allow` });
        const [rule1] = tx2.moveCall({
            target: `${PKG}::assembly_binding::rule`,
            arguments: [tx2.pure.id(tribeCondId!), allowEff],
        });
        const [denyEff] = tx2.moveCall({ target: `${PKG}::assembly_binding::deny` });
        const [rule2] = tx2.moveCall({
            target: `${PKG}::assembly_binding::rule`,
            arguments: [tx2.pure.id(everyoneCondId!), denyEff],
        });

        // Set policy on gate1
        const ruleVec1 = tx2.makeMoveVec({ type: `${PKG}::assembly_binding::Rule`, elements: [rule1, rule2] });
        tx2.moveCall({
            target: `${PKG}::assembly_binding::set_policy`,
            arguments: [tx2.object(bindingId!), tx2.pure.id(gate1), ruleVec1],
        });

        // Also set same policy on gate2
        const [allowEff2] = tx2.moveCall({ target: `${PKG}::assembly_binding::allow` });
        const [rule1b] = tx2.moveCall({
            target: `${PKG}::assembly_binding::rule`,
            arguments: [tx2.pure.id(tribeCondId!), allowEff2],
        });
        const [denyEff2] = tx2.moveCall({ target: `${PKG}::assembly_binding::deny` });
        const [rule2b] = tx2.moveCall({
            target: `${PKG}::assembly_binding::rule`,
            arguments: [tx2.pure.id(everyoneCondId!), denyEff2],
        });
        const ruleVec2 = tx2.makeMoveVec({ type: `${PKG}::assembly_binding::Rule`, elements: [rule1b, rule2b] });
        tx2.moveCall({
            target: `${PKG}::assembly_binding::set_policy`,
            arguments: [tx2.object(bindingId!), tx2.pure.id(gate2), ruleVec2],
        });

        const result2 = await client.signAndExecuteTransaction({
            transaction: tx2, signer: playerACtx.keypair,
            options: { showEffects: true },
        });

        assert(result2.effects?.status?.status === "success", "TX2 succeeded: policies set on both gates");
        await delay(DELAY_MS);

        // ═══════════════════════════════════════════════════════════════
        // Verify: resolve_role for allowed player (tribe 100)
        // ═══════════════════════════════════════════════════════════════
        console.log("\nVerify: resolve_role via devInspect");

        async function checkRole(charGameId: bigint, tribeId: number, gateId: string): Promise<"allow" | "deny" | "error"> {
            const tx = new Transaction();
            const [evalCtx] = tx.moveCall({
                target: `${PKG}::assembly_binding::build_eval_context`,
                arguments: [tx.object(bindingId!), tx.pure.id(gateId), tx.pure.u64(charGameId), tx.pure.u32(tribeId), tx.pure.address(playerACtx.address)],
            });
            const [tribeProof] = tx.moveCall({ target: `${PKG}::condition_tribe::verify`, arguments: [tx.object(tribeCondId!), evalCtx] });
            const [everyoneProof] = tx.moveCall({ target: `${PKG}::condition_everyone::verify`, arguments: [tx.object(everyoneCondId!), evalCtx] });
            const proofs = tx.makeMoveVec({ type: `${PKG}::assembly_binding::ConditionProof`, elements: [tribeProof, everyoneProof] });
            const [decision] = tx.moveCall({
                target: `${PKG}::assembly_binding::resolve_role`,
                arguments: [tx.object(bindingId!), tx.pure.id(gateId), tx.pure.u64(charGameId), proofs],
            });
            tx.moveCall({ target: `${PKG}::assembly_binding::is_allow`, arguments: [decision] });

            const r = await client.devInspectTransactionBlock({ sender: playerACtx.address, transactionBlock: tx });
            if (r.effects?.status?.status !== "success") return "error";
            const lastIdx = (r.results?.length ?? 0) - 1;
            return r.results?.[lastIdx]?.returnValues?.[0]?.[0]?.[0] === 1 ? "allow" : "deny";
        }

        assert(await checkRole(BigInt(GAME_CHARACTER_ID), 100, gate1) === "allow", "Tribe 100 player → Allow on gate1");
        assert(await checkRole(900000001n, 100, gate1) === "allow", "Player B (tribe 100) → Allow on gate1");
        assert(await checkRole(999n, 50, gate1) === "deny", "Unknown player (tribe 50) → Deny on gate1");

        // ═══════════════════════════════════════════════════════════════
        // Request permit: Player A (should succeed)
        // ═══════════════════════════════════════════════════════════════
        console.log("\nRequest permit: Player A");

        // Find gate1's config by querying the object and checking gate_id
        const allConfigs = changes.filter((c: any) => c.type === "created" && c.objectType?.includes("GateExtensionConfig")).map((c: any) => c.objectId);
        let configId: string | undefined;
        for (const cid of allConfigs) {
            const configObj = await client.getObject({ id: cid, options: { showContent: true } });
            const fields = (configObj.data?.content as any)?.fields;
            if (fields?.gate_id === gate1) { configId = cid; break; }
        }
        if (!configId) configId = allConfigs[0]; // fallback
        if (configId) {
            const tx3 = new Transaction();
            const [ec] = tx3.moveCall({
                target: `${PKG}::assembly_binding::build_eval_context`,
                arguments: [tx3.object(bindingId!), tx3.pure.id(gate1), tx3.pure.u64(BigInt(GAME_CHARACTER_ID)), tx3.pure.u32(100), tx3.pure.address(playerACtx.address)],
            });
            const [tp] = tx3.moveCall({ target: `${PKG}::condition_tribe::verify`, arguments: [tx3.object(tribeCondId!), ec] });
            const [ep] = tx3.moveCall({ target: `${PKG}::condition_everyone::verify`, arguments: [tx3.object(everyoneCondId!), ec] });
            const proofs = tx3.makeMoveVec({ type: `${PKG}::assembly_binding::ConditionProof`, elements: [tp, ep] });
            tx3.moveCall({
                target: `${PKG}::gate_extension::request_permit`,
                arguments: [tx3.object(configId), tx3.object(bindingId!), proofs, tx3.object(gate1), tx3.object(gate2), tx3.object(charA), tx3.object("0x6")],
            });
            const r3 = await client.signAndExecuteTransaction({
                transaction: tx3, signer: playerACtx.keypair,
                options: { showEffects: true, showObjectChanges: true, showEvents: true },
            });
            assert(r3.effects?.status?.status === "success", "Player A: JumpPermit issued!");
            const permit = r3.objectChanges?.find((c: any) => c.type === "created" && c.objectType?.includes("JumpPermit"));
            assert(!!permit, `JumpPermit: ${(permit as any)?.objectId}`);
        }

        // ═══════════════════════════════════════════════════════════════
        // Blocklist: add Player A, verify denied
        // ═══════════════════════════════════════════════════════════════
        await delay(DELAY_MS);
        console.log("\nBlocklist test");

        const tx4 = new Transaction();
        tx4.moveCall({
            target: `${PKG}::assembly_binding::add_to_blocklist`,
            arguments: [tx4.object(bindingId!), tx4.pure.u64(BigInt(GAME_CHARACTER_ID))],
        });
        const r4 = await client.signAndExecuteTransaction({ transaction: tx4, signer: playerACtx.keypair, options: { showEffects: true } });
        assert(r4.effects?.status?.status === "success", "Blocklisted Player A");
        await delay(DELAY_MS);

        assert(await checkRole(BigInt(GAME_CHARACTER_ID), 100, gate1) === "deny", "Blocklisted Player A → Deny");

        // Remove from blocklist
        const tx5 = new Transaction();
        tx5.moveCall({
            target: `${PKG}::assembly_binding::remove_from_blocklist`,
            arguments: [tx5.object(bindingId!), tx5.pure.u64(BigInt(GAME_CHARACTER_ID))],
        });
        await client.signAndExecuteTransaction({ transaction: tx5, signer: playerACtx.keypair, options: { showEffects: true } });
        await delay(DELAY_MS);

        assert(await checkRole(BigInt(GAME_CHARACTER_ID), 100, gate1) === "allow", "Unblocklisted → Allow again");

        // ═══════════════════════════════════════════════════════════════
        // Denied player tries request_permit → EAccessDenied
        await delay(DELAY_MS);
        // Change policy: only Character A allowed, everyone else denied
        // ═══════════════════════════════════════════════════════════════
        console.log("\nDenied player interaction test");

        // Create a character condition for Player A only
        const txCharCond = new Transaction();
        const [charCond] = txCharCond.moveCall({
            target: `${PKG}::condition_character::new`,
            arguments: [txCharCond.pure.u64(BigInt(GAME_CHARACTER_ID))],
        });
        txCharCond.moveCall({ target: `${PKG}::condition_character::share`, arguments: [charCond] });
        const rCharCond = await client.signAndExecuteTransaction({
            transaction: txCharCond, signer: playerACtx.keypair,
            options: { showEffects: true, showObjectChanges: true },
        });
        assert(rCharCond.effects?.status?.status === "success", "Character condition created");
        const charCondId = (rCharCond.objectChanges?.find((c: any) =>
            c.type === "created" && c.objectType?.includes("CharacterCondition"),
        ) as any)?.objectId;
        assert(!!charCondId, `CharacterCondition: ${charCondId}`);
        await delay(DELAY_MS);

        // Set policy: Character A → Allow, Everyone → Deny
        const txNewPolicy = new Transaction();
        const [ae1] = txNewPolicy.moveCall({ target: `${PKG}::assembly_binding::allow` });
        const [nr1] = txNewPolicy.moveCall({
            target: `${PKG}::assembly_binding::rule`,
            arguments: [txNewPolicy.pure.id(charCondId!), ae1],
        });
        const [de1] = txNewPolicy.moveCall({ target: `${PKG}::assembly_binding::deny` });
        const [nr2] = txNewPolicy.moveCall({
            target: `${PKG}::assembly_binding::rule`,
            arguments: [txNewPolicy.pure.id(everyoneCondId!), de1],
        });
        const newRules = txNewPolicy.makeMoveVec({ type: `${PKG}::assembly_binding::Rule`, elements: [nr1, nr2] });
        txNewPolicy.moveCall({
            target: `${PKG}::assembly_binding::set_policy`,
            arguments: [txNewPolicy.object(bindingId!), txNewPolicy.pure.id(gate1), newRules],
        });
        const rNewPolicy = await client.signAndExecuteTransaction({
            transaction: txNewPolicy, signer: playerACtx.keypair,
            options: { showEffects: true },
        });
        assert(rNewPolicy.effects?.status?.status === "success", "Policy changed: only Character A allowed");
        await delay(DELAY_MS);

        // Verify: Player A still allowed
        if (configId) {
            const txAllow = new Transaction();
            const [ecA] = txAllow.moveCall({
                target: `${PKG}::assembly_binding::build_eval_context`,
                arguments: [txAllow.object(bindingId!), txAllow.pure.id(gate1), txAllow.pure.u64(BigInt(GAME_CHARACTER_ID)), txAllow.pure.u32(100), txAllow.pure.address(playerACtx.address)],
            });
            const [cpA] = txAllow.moveCall({ target: `${PKG}::condition_character::verify`, arguments: [txAllow.object(charCondId!), ecA] });
            const [epA] = txAllow.moveCall({ target: `${PKG}::condition_everyone::verify`, arguments: [txAllow.object(everyoneCondId!), ecA] });
            const proofsA = txAllow.makeMoveVec({ type: `${PKG}::assembly_binding::ConditionProof`, elements: [cpA, epA] });
            txAllow.moveCall({
                target: `${PKG}::gate_extension::request_permit`,
                arguments: [txAllow.object(configId), txAllow.object(bindingId!), proofsA, txAllow.object(gate1), txAllow.object(gate2), txAllow.object(charA), txAllow.object("0x6")],
            });
            const rAllow = await client.signAndExecuteTransaction({
                transaction: txAllow, signer: playerACtx.keypair,
                options: { showEffects: true },
            });
            assert(rAllow.effects?.status?.status === "success", "Player A: still gets JumpPermit (character rule)");
        }

        // Player B tries to request permit → should be DENIED
        if (configId) {
            const charB = deriveObjectId(registry, 900000001n, WORLD);

            const txDeny = new Transaction();
            const [ecB] = txDeny.moveCall({
                target: `${PKG}::assembly_binding::build_eval_context`,
                arguments: [txDeny.object(bindingId!), txDeny.pure.id(gate1), txDeny.pure.u64(900000001n), txDeny.pure.u32(100), txDeny.pure.address(playerBCtx.address)],
            });
            const [cpB] = txDeny.moveCall({ target: `${PKG}::condition_character::verify`, arguments: [txDeny.object(charCondId!), ecB] });
            const [epB] = txDeny.moveCall({ target: `${PKG}::condition_everyone::verify`, arguments: [txDeny.object(everyoneCondId!), ecB] });
            const proofsB = txDeny.makeMoveVec({ type: `${PKG}::assembly_binding::ConditionProof`, elements: [cpB, epB] });
            txDeny.moveCall({
                target: `${PKG}::gate_extension::request_permit`,
                arguments: [txDeny.object(configId), txDeny.object(bindingId!), proofsB, txDeny.object(gate1), txDeny.object(gate2), txDeny.object(charB), txDeny.object("0x6")],
            });

            try {
                await client.signAndExecuteTransaction({
                    transaction: txDeny, signer: playerBCtx.keypair,
                    options: { showEffects: true },
                });
                assert(false, "Player B should have been DENIED");
            } catch {
                assert(true, "Player B: DENIED — EAccessDenied (correct!)");
            }
        }

        // Blocklist Player A and verify request_permit fails
        if (configId) {
            await delay(DELAY_MS);
            console.log("\nBlocklisted player interaction test");

            const txBL = new Transaction();
            txBL.moveCall({
                target: `${PKG}::assembly_binding::add_to_blocklist`,
                arguments: [txBL.object(bindingId!), txBL.pure.u64(BigInt(GAME_CHARACTER_ID))],
            });
            await client.signAndExecuteTransaction({ transaction: txBL, signer: playerACtx.keypair, options: { showEffects: true } });
            await delay(DELAY_MS);

            const txBLDeny = new Transaction();
            const [ecBL] = txBLDeny.moveCall({
                target: `${PKG}::assembly_binding::build_eval_context`,
                arguments: [txBLDeny.object(bindingId!), txBLDeny.pure.id(gate1), txBLDeny.pure.u64(BigInt(GAME_CHARACTER_ID)), txBLDeny.pure.u32(100), txBLDeny.pure.address(playerACtx.address)],
            });
            const [cpBL] = txBLDeny.moveCall({ target: `${PKG}::condition_character::verify`, arguments: [txBLDeny.object(charCondId!), ecBL] });
            const [epBL] = txBLDeny.moveCall({ target: `${PKG}::condition_everyone::verify`, arguments: [txBLDeny.object(everyoneCondId!), ecBL] });
            const proofsBL = txBLDeny.makeMoveVec({ type: `${PKG}::assembly_binding::ConditionProof`, elements: [cpBL, epBL] });
            txBLDeny.moveCall({
                target: `${PKG}::gate_extension::request_permit`,
                arguments: [txBLDeny.object(configId), txBLDeny.object(bindingId!), proofsBL, txBLDeny.object(gate1), txBLDeny.object(gate2), txBLDeny.object(charA), txBLDeny.object("0x6")],
            });

            try {
                await client.signAndExecuteTransaction({
                    transaction: txBLDeny, signer: playerACtx.keypair,
                    options: { showEffects: true },
                });
                assert(false, "Blocklisted Player A should have been DENIED");
            } catch {
                assert(true, "Blocklisted Player A: DENIED — blocklist overrides character rule");
            }

            // Remove from blocklist, verify access restored
            const txUnBL = new Transaction();
            txUnBL.moveCall({
                target: `${PKG}::assembly_binding::remove_from_blocklist`,
                arguments: [txUnBL.object(bindingId!), txUnBL.pure.u64(BigInt(GAME_CHARACTER_ID))],
            });
            await client.signAndExecuteTransaction({ transaction: txUnBL, signer: playerACtx.keypair, options: { showEffects: true } });
            await delay(DELAY_MS);

            const txRestored = new Transaction();
            const [ecR] = txRestored.moveCall({
                target: `${PKG}::assembly_binding::build_eval_context`,
                arguments: [txRestored.object(bindingId!), txRestored.pure.id(gate1), txRestored.pure.u64(BigInt(GAME_CHARACTER_ID)), txRestored.pure.u32(100), txRestored.pure.address(playerACtx.address)],
            });
            const [cpR] = txRestored.moveCall({ target: `${PKG}::condition_character::verify`, arguments: [txRestored.object(charCondId!), ecR] });
            const [epR] = txRestored.moveCall({ target: `${PKG}::condition_everyone::verify`, arguments: [txRestored.object(everyoneCondId!), ecR] });
            const proofsR = txRestored.makeMoveVec({ type: `${PKG}::assembly_binding::ConditionProof`, elements: [cpR, epR] });
            txRestored.moveCall({
                target: `${PKG}::gate_extension::request_permit`,
                arguments: [txRestored.object(configId), txRestored.object(bindingId!), proofsR, txRestored.object(gate1), txRestored.object(gate2), txRestored.object(charA), txRestored.object("0x6")],
            });
            const rRestored = await client.signAndExecuteTransaction({
                transaction: txRestored, signer: playerACtx.keypair,
                options: { showEffects: true },
            });
            assert(rRestored.effects?.status?.status === "success", "Unblocklisted Player A: access restored, JumpPermit issued");
        }

        // ═══════════════════════════════════════════════════════════════
        console.log("\n══════════════════════════════════════════════════════════");
        console.log(`  Results: ${passed} passed, ${failed} failed`);
        console.log("══════════════════════════════════════════════════════════\n");
        if (failed > 0) process.exit(1);

    } catch (error) {
        handleError(error);
    }
}

main();
