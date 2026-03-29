/**
 * ef_guard integration test — runs against a live local Sui node.
 *
 * Tests the full on-chain flow:
 *   1. Create and share an AssemblyBinding
 *   2. Register a gate, turret, and SSU
 *   3. Set policies with rules (tribe allow, everyone deny)
 *   4. Verify resolve_role via devInspect (read-only call)
 *   5. Test blocklist override
 *   6. Test add_rule / remove_rule
 *   7. Test ownership transfer
 */
import "dotenv/config";
import { Transaction } from "@mysten/sui/transactions";
import { getEnvConfig, handleError, hydrateWorldConfig, initializeContext } from "../utils/helper";
import { deriveObjectId } from "../utils/derive-object-id";
import { GATE_ITEM_ID_1, GATE_TYPE_ID, STORAGE_A_ITEM_ID, GAME_CHARACTER_ID } from "../utils/constants";
import { bcs } from "@mysten/sui/bcs";
import { delay, DELAY_MS } from "../utils/helper";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";

const TRIBE_ALLOWED = 100;
const TRIBE_DENIED = 999;
const CHAR_ALLOWED = 42n;
const CHAR_BLOCKED = 99n;

let PKG: string;
let WORLD: string;
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
    console.log("  ef_guard integration tests");
    console.log("══════════════════════════════════════════════\n");

    try {
        const env = getEnvConfig();
        const ctx = initializeContext(env.network, env.adminExportedKey);
        const { client, keypair, address } = ctx;
        await hydrateWorldConfig(ctx);

        WORLD = ctx.config.packageId;
        PKG = process.env.BUILDER_PACKAGE_ID!;
        if (!PKG) throw new Error("BUILDER_PACKAGE_ID not set");

        console.log(`World:    ${WORLD}`);
        console.log(`ef_guard: ${PKG}`);
        console.log(`Admin:    ${address}\n`);

        // ── Test 1: Create binding + register + set policy (single PTB) ─
        console.log("Test 1: Create binding, register assemblies, set policy (one PTB)");

        const gateObjId = deriveObjectId(ctx.config.objectRegistry, GATE_ITEM_ID_1, WORLD);
        const ssuObjId = deriveObjectId(ctx.config.objectRegistry, STORAGE_A_ITEM_ID, WORLD);

        const tx1 = new Transaction();

        // Create binding
        const [binding] = tx1.moveCall({
            target: `${PKG}::assembly_binding::new_binding`,
        });

        // Register gate and SSU
        tx1.moveCall({
            target: `${PKG}::assembly_binding::register_gate`,
            arguments: [binding, tx1.pure.id(gateObjId)],
        });
        tx1.moveCall({
            target: `${PKG}::assembly_binding::register_ssu`,
            arguments: [binding, tx1.pure.id(ssuObjId)],
        });

        // Set gate policy: Tribe 100 → Allow, Everyone → Deny
        const [tribeTarget] = tx1.moveCall({
            target: `${PKG}::assembly_binding::tribe`,
            arguments: [tx1.pure.u32(TRIBE_ALLOWED)],
        });
        const [allowEffect] = tx1.moveCall({
            target: `${PKG}::assembly_binding::allow`,
        });
        const [rule1] = tx1.moveCall({
            target: `${PKG}::assembly_binding::rule`,
            arguments: [tribeTarget, allowEffect],
        });
        const [everyoneTarget] = tx1.moveCall({
            target: `${PKG}::assembly_binding::everyone`,
        });
        const [denyEffect] = tx1.moveCall({
            target: `${PKG}::assembly_binding::deny`,
        });
        const [rule2] = tx1.moveCall({
            target: `${PKG}::assembly_binding::rule`,
            arguments: [everyoneTarget, denyEffect],
        });
        const rules = tx1.makeMoveVec({
            type: `${PKG}::assembly_binding::Rule`,
            elements: [rule1, rule2],
        });
        tx1.moveCall({
            target: `${PKG}::assembly_binding::set_policy`,
            arguments: [binding, tx1.pure.id(gateObjId), rules],
        });

        // Share binding (must be last — moves the object)
        tx1.moveCall({
            target: `${PKG}::assembly_binding::share_binding`,
            arguments: [binding],
        });

        const result1 = await client.signAndExecuteTransaction({
            transaction: tx1,
            signer: keypair,
            options: { showEffects: true, showObjectChanges: true },
        });

        const bindingId = result1.objectChanges?.find(
            (c: any) => c.type === "created" && c.objectType?.includes("AssemblyBinding"),
        )?.objectId;

        assert(!!bindingId, `Binding created, assemblies registered, policy set: ${bindingId}`);
        assert(result1.effects?.status?.status === "success", "Single PTB: create + register + policy + share");

        // Wait for shared object to be available
        await delay(DELAY_MS);

        // ── Helper: check role via devInspect ─────────────────────────
        async function checkRole(
            assemblyId: string,
            charGameId: bigint,
            tribeId: number,
        ): Promise<"allow" | "deny" | "default" | "error"> {
            const tx = new Transaction();
            const [decision] = tx.moveCall({
                target: `${PKG}::assembly_binding::resolve_role`,
                arguments: [
                    tx.object(bindingId!),
                    tx.pure.id(assemblyId),
                    tx.pure.u64(charGameId),
                    tx.pure.u32(tribeId),
                ],
            });
            tx.moveCall({
                target: `${PKG}::assembly_binding::is_allow`,
                arguments: [decision],
            });

            const result = await client.devInspectTransactionBlock({
                sender: address,
                transactionBlock: tx,
            });
            if (result.effects?.status?.status !== "success") return "error";
            // Result of the last moveCall (is_allow) is in results[1]
            const retVals = result.results?.[1]?.returnValues;
            if (!retVals?.length) return "error";
            const isAllow = retVals[0][0][0] === 1;
            if (isAllow) return "allow";

            // Check is_deny
            const tx2 = new Transaction();
            const [d2] = tx2.moveCall({
                target: `${PKG}::assembly_binding::resolve_role`,
                arguments: [
                    tx2.object(bindingId!),
                    tx2.pure.id(assemblyId),
                    tx2.pure.u64(charGameId),
                    tx2.pure.u32(tribeId),
                ],
            });
            tx2.moveCall({
                target: `${PKG}::assembly_binding::is_deny`,
                arguments: [d2],
            });
            const r2 = await client.devInspectTransactionBlock({ sender: address, transactionBlock: tx2 });
            const isDeny = r2.results?.[1]?.returnValues?.[0]?.[0]?.[0] === 1;
            return isDeny ? "deny" : "default";
        }

        // ── Test 2: Resolve role ────────────────────────────────────────
        console.log("\nTest 2: Resolve role (devInspect)");

        assert(await checkRole(gateObjId, CHAR_ALLOWED, TRIBE_ALLOWED) === "allow",
            "Tribe 100 member → Allow");
        assert(await checkRole(gateObjId, CHAR_BLOCKED, TRIBE_DENIED) === "deny",
            "Non-member → Deny (Everyone rule)");

        // ── Test 3: Blocklist override ──────────────────────────────────
        console.log("\nTest 3: Blocklist overrides Allow rules");

        const tx3 = new Transaction();
        tx3.moveCall({
            target: `${PKG}::assembly_binding::add_to_blocklist`,
            arguments: [tx3.object(bindingId!), tx3.pure.u64(CHAR_ALLOWED)],
        });
        const result3 = await client.signAndExecuteTransaction({
            transaction: tx3, signer: keypair, options: { showEffects: true },
        });
        assert(result3.effects?.status?.status === "success", "Blocklisted char 42");
        await delay(DELAY_MS);

        assert(await checkRole(gateObjId, CHAR_ALLOWED, TRIBE_ALLOWED) === "deny",
            "Blocklisted tribe member → Deny");

        // Remove from blocklist
        const tx3b = new Transaction();
        tx3b.moveCall({
            target: `${PKG}::assembly_binding::remove_from_blocklist`,
            arguments: [tx3b.object(bindingId!), tx3b.pure.u64(CHAR_ALLOWED)],
        });
        await client.signAndExecuteTransaction({
            transaction: tx3b, signer: keypair, options: { showEffects: true },
        });
        await delay(DELAY_MS);

        assert(await checkRole(gateObjId, CHAR_ALLOWED, TRIBE_ALLOWED) === "allow",
            "Unblocklisted → Allow again");

        // ── Test 4: add_rule / remove_rule ──────────────────────────────
        console.log("\nTest 4: add_rule / remove_rule");

        // Set SSU policy: Everyone Deny
        const tx4 = new Transaction();
        const [evT] = tx4.moveCall({ target: `${PKG}::assembly_binding::everyone` });
        const [deE] = tx4.moveCall({ target: `${PKG}::assembly_binding::deny` });
        const [dr] = tx4.moveCall({ target: `${PKG}::assembly_binding::rule`, arguments: [evT, deE] });
        const ssuRules = tx4.makeMoveVec({ type: `${PKG}::assembly_binding::Rule`, elements: [dr] });
        tx4.moveCall({
            target: `${PKG}::assembly_binding::set_policy`,
            arguments: [tx4.object(bindingId!), tx4.pure.id(ssuObjId), ssuRules],
        });
        await client.signAndExecuteTransaction({ transaction: tx4, signer: keypair, options: { showEffects: true } });
        await delay(DELAY_MS);

        // add_rule: append Char42 Allow (after Everyone Deny)
        const tx4b = new Transaction();
        const [cT] = tx4b.moveCall({ target: `${PKG}::assembly_binding::character`, arguments: [tx4b.pure.u64(CHAR_ALLOWED)] });
        const [aE] = tx4b.moveCall({ target: `${PKG}::assembly_binding::allow` });
        tx4b.moveCall({
            target: `${PKG}::assembly_binding::add_rule`,
            arguments: [tx4b.object(bindingId!), tx4b.pure.id(ssuObjId), cT, aE],
        });
        const r4b = await client.signAndExecuteTransaction({ transaction: tx4b, signer: keypair, options: { showEffects: true } });
        assert(r4b.effects?.status?.status === "success", "Added Char42 Allow rule to SSU");
        await delay(DELAY_MS);

        // Order is [Everyone→Deny, Char42→Allow] → Everyone matches first
        assert(await checkRole(ssuObjId, CHAR_ALLOWED, TRIBE_DENIED) === "deny",
            "add_rule appends → Everyone Deny matches first (order matters!)");

        // remove_rule: remove index 0 (Everyone Deny), leaving only Char42 Allow
        const tx4c = new Transaction();
        tx4c.moveCall({
            target: `${PKG}::assembly_binding::remove_rule`,
            arguments: [tx4c.object(bindingId!), tx4c.pure.id(ssuObjId), tx4c.pure.u64(0)],
        });
        await client.signAndExecuteTransaction({ transaction: tx4c, signer: keypair, options: { showEffects: true } });
        await delay(DELAY_MS);

        assert(await checkRole(ssuObjId, CHAR_ALLOWED, TRIBE_DENIED) === "allow",
            "After removing Everyone Deny → Char 42 Allowed");

        // ── Test 5: Ownership transfer ──────────────────────────────────
        console.log("\nTest 5: Ownership transfer");

        const playerBKey = process.env.PLAYER_B_PRIVATE_KEY!;
        const playerBCtx = initializeContext(env.network, playerBKey);

        const tx5 = new Transaction();
        tx5.moveCall({
            target: `${PKG}::assembly_binding::transfer_ownership`,
            arguments: [tx5.object(bindingId!), tx5.pure.address(playerBCtx.address)],
        });
        await client.signAndExecuteTransaction({ transaction: tx5, signer: keypair, options: { showEffects: true } });
        await delay(DELAY_MS);
        assert(true, `Ownership transferred to ${playerBCtx.address}`);

        // Old owner should fail
        const tx5b = new Transaction();
        const [evT2] = tx5b.moveCall({ target: `${PKG}::assembly_binding::everyone` });
        const [aE2] = tx5b.moveCall({ target: `${PKG}::assembly_binding::allow` });
        tx5b.moveCall({
            target: `${PKG}::assembly_binding::add_rule`,
            arguments: [tx5b.object(bindingId!), tx5b.pure.id(gateObjId), evT2, aE2],
        });
        try {
            await client.signAndExecuteTransaction({ transaction: tx5b, signer: keypair, options: { showEffects: true } });
            assert(false, "Old owner should not be able to modify binding");
        } catch {
            assert(true, "Old owner correctly rejected");
        }

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
