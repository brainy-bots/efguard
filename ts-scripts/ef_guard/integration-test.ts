/**
 * ef_guard integration test — runs against a live local Sui node.
 *
 * Tests the full condition-based on-chain flow:
 *   1. Create condition objects (tribe, character, everyone)
 *   2. Create binding + register + set policy with conditions
 *   3. Build EvalContext + verify conditions + resolve role
 *   4. Test blocklist override
 *   5. Test token holder condition
 */
import "dotenv/config";
import { Transaction } from "@mysten/sui/transactions";
import { getEnvConfig, handleError, hydrateWorldConfig, initializeContext, delay, DELAY_MS } from "../utils/helper";
import { deriveObjectId } from "../utils/derive-object-id";
import { GATE_ITEM_ID_1, STORAGE_A_ITEM_ID } from "../utils/constants";

const TRIBE_ALLOWED = 100;
const TRIBE_DENIED = 999;
const CHAR_ALLOWED = 42n;
const CHAR_BLOCKED = 99n;

let PKG: string;
let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
    if (condition) {
        console.log(`  ✓ ${message}`);
        passed++;
    } else {
        console.error(`  ✗ ${message}`);
        failed++;
    }
}

async function main() {
    console.log("\n══════════════════════════════════════════════");
    console.log("  ef_guard condition system integration tests");
    console.log("══════════════════════════════════════════════\n");

    try {
        const env = getEnvConfig();
        const ctx = initializeContext(env.network, env.adminExportedKey);
        const { client, keypair, address } = ctx;
        await hydrateWorldConfig(ctx);

        PKG = process.env.BUILDER_PACKAGE_ID!;
        if (!PKG) throw new Error("BUILDER_PACKAGE_ID not set");

        const WORLD = ctx.config.packageId;
        console.log(`World:    ${WORLD}`);
        console.log(`ef_guard: ${PKG}`);
        console.log(`Admin:    ${address}\n`);

        const gateObjId = deriveObjectId(ctx.config.objectRegistry, GATE_ITEM_ID_1, WORLD);
        const ssuObjId = deriveObjectId(ctx.config.objectRegistry, STORAGE_A_ITEM_ID, WORLD);

        // ── Test 1: Create conditions + binding + policy (one PTB) ──────
        console.log("Test 1: Create conditions, binding, and policy in one PTB");

        const tx1 = new Transaction();

        // Create tribe condition (tribe 100)
        const [tribeCond] = tx1.moveCall({
            target: `${PKG}::condition_tribe::new`,
            arguments: [tx1.pure.u32(TRIBE_ALLOWED)],
        });

        // Create everyone condition
        const [everyoneCond] = tx1.moveCall({
            target: `${PKG}::condition_everyone::new`,
        });

        // Create binding
        const [binding] = tx1.moveCall({
            target: `${PKG}::assembly_binding::new_binding`,
        });

        // Register gate
        tx1.moveCall({
            target: `${PKG}::assembly_binding::register_gate`,
            arguments: [binding, tx1.pure.id(gateObjId)],
        });

        // Register SSU
        tx1.moveCall({
            target: `${PKG}::assembly_binding::register_ssu`,
            arguments: [binding, tx1.pure.id(ssuObjId)],
        });

        // We need condition IDs for rules, but they're not shared yet.
        // In Sui PTB, we can use the object before sharing.
        // But we need the ID — use sui::object::id_from_ref pattern...
        // Actually, the issue is we need the ID as a value in set_policy.
        // Let's share conditions first, get IDs from effects, then set policy in TX2.

        // Share conditions
        tx1.moveCall({ target: `${PKG}::condition_tribe::share`, arguments: [tribeCond] });
        tx1.moveCall({ target: `${PKG}::condition_everyone::share`, arguments: [everyoneCond] });

        // Share binding
        tx1.moveCall({
            target: `${PKG}::assembly_binding::share_binding`,
            arguments: [binding],
        });

        const result1 = await client.signAndExecuteTransaction({
            transaction: tx1,
            signer: keypair,
            options: { showEffects: true, showObjectChanges: true },
        });

        assert(result1.effects?.status?.status === "success", "TX1: conditions + binding created");

        // Extract created object IDs
        const changes = result1.objectChanges ?? [];
        const findCreated = (typeSuffix: string) =>
            (changes.find((c: any) => c.type === "created" && c.objectType?.includes(typeSuffix)) as any)?.objectId;

        const bindingId = findCreated("AssemblyBinding");
        const tribeCondId = findCreated("TribeCondition");
        const everyoneCondId = findCreated("EveryoneCondition");

        assert(!!bindingId, `Binding: ${bindingId}`);
        assert(!!tribeCondId, `TribeCondition: ${tribeCondId}`);
        assert(!!everyoneCondId, `EveryoneCondition: ${everyoneCondId}`);

        await delay(DELAY_MS);

        // ── Test 2: Set policy using condition IDs ──────────────────────
        console.log("\nTest 2: Set policy (Tribe 100 → Allow, Everyone → Deny)");

        const tx2 = new Transaction();

        const [rule1] = tx2.moveCall({
            target: `${PKG}::assembly_binding::rule`,
            arguments: [tx2.pure.id(tribeCondId!), tx2.moveCall({ target: `${PKG}::assembly_binding::allow` })[0]],
        });
        const [rule2] = tx2.moveCall({
            target: `${PKG}::assembly_binding::rule`,
            arguments: [tx2.pure.id(everyoneCondId!), tx2.moveCall({ target: `${PKG}::assembly_binding::deny` })[0]],
        });
        const rules = tx2.makeMoveVec({
            type: `${PKG}::assembly_binding::Rule`,
            elements: [rule1, rule2],
        });
        tx2.moveCall({
            target: `${PKG}::assembly_binding::set_policy`,
            arguments: [tx2.object(bindingId!), tx2.pure.id(gateObjId), rules],
        });

        const result2 = await client.signAndExecuteTransaction({
            transaction: tx2, signer: keypair, options: { showEffects: true },
        });
        assert(result2.effects?.status?.status === "success", "Policy set on gate");
        await delay(DELAY_MS);

        // ── Test 3: Resolve role via devInspect ─────────────────────────
        console.log("\nTest 3: Resolve role with condition proofs (devInspect)");

        // Helper: build a devInspect tx that resolves role
        async function checkRole(charGameId: bigint, tribeId: number): Promise<"allow" | "deny" | "default" | "error"> {
            const tx = new Transaction();

            // Build eval context
            const [evalCtx] = tx.moveCall({
                target: `${PKG}::assembly_binding::build_eval_context`,
                arguments: [
                    tx.object(bindingId!),
                    tx.pure.id(gateObjId),
                    tx.pure.u64(charGameId),
                    tx.pure.u32(tribeId),
                    tx.pure.address(address),
                ],
            });

            // Verify conditions
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

            // Resolve
            const [decision] = tx.moveCall({
                target: `${PKG}::assembly_binding::resolve_role`,
                arguments: [tx.object(bindingId!), tx.pure.id(gateObjId), tx.pure.u64(charGameId), proofs],
            });

            // Check is_allow
            tx.moveCall({
                target: `${PKG}::assembly_binding::is_allow`,
                arguments: [decision],
            });

            const result = await client.devInspectTransactionBlock({
                sender: address,
                transactionBlock: tx,
            });
            if (result.effects?.status?.status !== "success") return "error";

            // Last moveCall result = is_allow
            const lastIdx = (result.results?.length ?? 0) - 1;
            const isAllow = result.results?.[lastIdx]?.returnValues?.[0]?.[0]?.[0] === 1;
            if (isAllow) return "allow";

            // Check is_deny
            const tx2 = new Transaction();
            const [ec2] = tx2.moveCall({
                target: `${PKG}::assembly_binding::build_eval_context`,
                arguments: [tx2.object(bindingId!), tx2.pure.id(gateObjId), tx2.pure.u64(charGameId), tx2.pure.u32(tribeId), tx2.pure.address(address)],
            });
            const [tp2] = tx2.moveCall({ target: `${PKG}::condition_tribe::verify`, arguments: [tx2.object(tribeCondId!), ec2] });
            const [ep2] = tx2.moveCall({ target: `${PKG}::condition_everyone::verify`, arguments: [tx2.object(everyoneCondId!), ec2] });
            const proofs2 = tx2.makeMoveVec({ type: `${PKG}::assembly_binding::ConditionProof`, elements: [tp2, ep2] });
            const [d2] = tx2.moveCall({
                target: `${PKG}::assembly_binding::resolve_role`,
                arguments: [tx2.object(bindingId!), tx2.pure.id(gateObjId), tx2.pure.u64(charGameId), proofs2],
            });
            tx2.moveCall({ target: `${PKG}::assembly_binding::is_deny`, arguments: [d2] });
            const r2 = await client.devInspectTransactionBlock({ sender: address, transactionBlock: tx2 });
            const lastIdx2 = (r2.results?.length ?? 0) - 1;
            const isDeny = r2.results?.[lastIdx2]?.returnValues?.[0]?.[0]?.[0] === 1;
            return isDeny ? "deny" : "default";
        }

        assert(await checkRole(CHAR_ALLOWED, TRIBE_ALLOWED) === "allow",
            "Tribe 100 member → Allow");
        assert(await checkRole(CHAR_BLOCKED, TRIBE_DENIED) === "deny",
            "Non-member → Deny (Everyone condition)");

        // ── Test 4: Blocklist override ──────────────────────────────────
        console.log("\nTest 4: Blocklist overrides condition proofs");

        const tx4 = new Transaction();
        tx4.moveCall({
            target: `${PKG}::assembly_binding::add_to_blocklist`,
            arguments: [tx4.object(bindingId!), tx4.pure.u64(CHAR_ALLOWED)],
        });
        const result4 = await client.signAndExecuteTransaction({
            transaction: tx4, signer: keypair, options: { showEffects: true },
        });
        assert(result4.effects?.status?.status === "success", "Blocklisted char 42");
        await delay(DELAY_MS);

        assert(await checkRole(CHAR_ALLOWED, TRIBE_ALLOWED) === "deny",
            "Blocklisted tribe member → Deny despite passing condition");

        // Remove blocklist
        const tx4b = new Transaction();
        tx4b.moveCall({
            target: `${PKG}::assembly_binding::remove_from_blocklist`,
            arguments: [tx4b.object(bindingId!), tx4b.pure.u64(CHAR_ALLOWED)],
        });
        await client.signAndExecuteTransaction({ transaction: tx4b, signer: keypair, options: { showEffects: true } });
        await delay(DELAY_MS);

        assert(await checkRole(CHAR_ALLOWED, TRIBE_ALLOWED) === "allow",
            "Unblocklisted → Allow again");

        // ── Test 5: Character condition ──────────────────────────────────
        console.log("\nTest 5: Character condition");

        const tx5 = new Transaction();
        const [charCond] = tx5.moveCall({
            target: `${PKG}::condition_character::new`,
            arguments: [tx5.pure.u64(CHAR_ALLOWED)],
        });
        tx5.moveCall({ target: `${PKG}::condition_character::share`, arguments: [charCond] });

        const result5 = await client.signAndExecuteTransaction({
            transaction: tx5, signer: keypair, options: { showEffects: true, showObjectChanges: true },
        });
        const charCondId = (result5.objectChanges?.find(
            (c: any) => c.type === "created" && c.objectType?.includes("CharacterCondition"),
        ) as any)?.objectId;
        assert(!!charCondId, `CharacterCondition created: ${charCondId}`);
        await delay(DELAY_MS);

        // Set SSU policy: Character 42 → Allow, Everyone → Deny
        const tx5b = new Transaction();
        const [r1] = tx5b.moveCall({
            target: `${PKG}::assembly_binding::rule`,
            arguments: [tx5b.pure.id(charCondId!), tx5b.moveCall({ target: `${PKG}::assembly_binding::allow` })[0]],
        });
        const [r2] = tx5b.moveCall({
            target: `${PKG}::assembly_binding::rule`,
            arguments: [tx5b.pure.id(everyoneCondId!), tx5b.moveCall({ target: `${PKG}::assembly_binding::deny` })[0]],
        });
        const ssuRules = tx5b.makeMoveVec({ type: `${PKG}::assembly_binding::Rule`, elements: [r1, r2] });
        tx5b.moveCall({
            target: `${PKG}::assembly_binding::set_policy`,
            arguments: [tx5b.object(bindingId!), tx5b.pure.id(ssuObjId), ssuRules],
        });
        const result5b = await client.signAndExecuteTransaction({
            transaction: tx5b, signer: keypair, options: { showEffects: true },
        });
        assert(result5b.effects?.status?.status === "success", "SSU policy set with character condition");
        await delay(DELAY_MS);

        // Check: character 42 allowed, character 99 denied
        async function checkSsuRole(charGameId: bigint): Promise<"allow" | "deny" | "default" | "error"> {
            const tx = new Transaction();
            const [ec] = tx.moveCall({
                target: `${PKG}::assembly_binding::build_eval_context`,
                arguments: [tx.object(bindingId!), tx.pure.id(ssuObjId), tx.pure.u64(charGameId), tx.pure.u32(TRIBE_DENIED), tx.pure.address(address)],
            });
            const [cp] = tx.moveCall({ target: `${PKG}::condition_character::verify`, arguments: [tx.object(charCondId!), ec] });
            const [ep] = tx.moveCall({ target: `${PKG}::condition_everyone::verify`, arguments: [tx.object(everyoneCondId!), ec] });
            const proofs = tx.makeMoveVec({ type: `${PKG}::assembly_binding::ConditionProof`, elements: [cp, ep] });
            const [d] = tx.moveCall({
                target: `${PKG}::assembly_binding::resolve_role`,
                arguments: [tx.object(bindingId!), tx.pure.id(ssuObjId), tx.pure.u64(charGameId), proofs],
            });
            tx.moveCall({ target: `${PKG}::assembly_binding::is_allow`, arguments: [d] });
            const r = await client.devInspectTransactionBlock({ sender: address, transactionBlock: tx });
            if (r.effects?.status?.status !== "success") return "error";
            const lastIdx = (r.results?.length ?? 0) - 1;
            return r.results?.[lastIdx]?.returnValues?.[0]?.[0]?.[0] === 1 ? "allow" : "deny";
        }

        assert(await checkSsuRole(CHAR_ALLOWED) === "allow", "Character 42 → Allow on SSU");
        assert(await checkSsuRole(CHAR_BLOCKED) === "deny", "Character 99 → Deny on SSU");

        // ── Summary ─────────────────────────────────────────────────────
        console.log("\n══════════════════════════════════════════════");
        console.log(`  Results: ${passed} passed, ${failed} failed`);
        console.log("══════════════════════════════════════════════\n");

        if (failed > 0) process.exit(1);

    } catch (error) {
        handleError(error);
    }
}

main();
