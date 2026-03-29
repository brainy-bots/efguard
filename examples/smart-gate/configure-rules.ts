import "dotenv/config";
import { Transaction } from "@mysten/sui/transactions";
import { getEnvConfig, handleError, hydrateWorldConfig, initializeContext } from "../utils/helper";
import { resolveSmartGateExtensionIds } from "./extension-ids";
import { ITEM_A_TYPE_ID } from "../utils/constants";
import { MODULE } from "./modules";

async function main() {
    console.log("============= Configure Smart Gate Rules ==============\n");
    console.log("This example uses ef_guard for access control instead of");
    console.log("the scaffold's inline tribe check.\n");

    try {
        const env = getEnvConfig();
        const ctx = initializeContext(env.network, env.adminExportedKey);
        const { client, keypair, address } = ctx;
        await hydrateWorldConfig(ctx);

        const { builderPackageId, adminCapId, extensionConfigId } =
            await resolveSmartGateExtensionIds(client, address);

        const efGuardPkg = process.env.EFGUARD_PACKAGE_ID;
        if (!efGuardPkg) throw new Error("EFGUARD_PACKAGE_ID not set in .env");

        const bindingId = process.env.BINDING_ID;

        const tx = new Transaction();

        // Step 1: Set permit expiry config (replaces the old set_tribe_config)
        tx.moveCall({
            target: `${builderPackageId}::${MODULE.TRIBE_PERMIT}::set_expiry_config`,
            arguments: [
                tx.object(extensionConfigId),
                tx.object(adminCapId),
                tx.pure.u64(3600000), // 1 hour expiry
            ],
        });

        // Step 2: If no binding exists yet, create one and register the gates
        if (!bindingId) {
            console.log("No BINDING_ID set — creating ef_guard binding with rules...\n");

            const [binding] = tx.moveCall({
                target: `${efGuardPkg}::assembly_binding::new_binding`,
            });

            // Register gates (use GATE_ITEM_IDs from test resources)
            // In a real deployment, you'd register your actual gate IDs here

            // Set a policy: Tribe 100 → Allow, Everyone → Deny
            // This replaces the old single-tribe check with a full rule list
            const [tribeTarget] = tx.moveCall({
                target: `${efGuardPkg}::assembly_binding::tribe`,
                arguments: [tx.pure.u32(100)],
            });
            const [allowEffect] = tx.moveCall({
                target: `${efGuardPkg}::assembly_binding::allow`,
            });
            const [rule1] = tx.moveCall({
                target: `${efGuardPkg}::assembly_binding::rule`,
                arguments: [tribeTarget, allowEffect],
            });

            const [everyoneTarget] = tx.moveCall({
                target: `${efGuardPkg}::assembly_binding::everyone`,
            });
            const [denyEffect] = tx.moveCall({
                target: `${efGuardPkg}::assembly_binding::deny`,
            });
            const [rule2] = tx.moveCall({
                target: `${efGuardPkg}::assembly_binding::rule`,
                arguments: [everyoneTarget, denyEffect],
            });

            // You can add more rules here:
            // - assembly_binding::character(char_game_id) for individual players
            // - assembly_binding::tribe(tribe_id) for additional tribes
            // Rules are evaluated top-to-bottom, first match wins.

            // Share the binding
            tx.moveCall({
                target: `${efGuardPkg}::assembly_binding::share_binding`,
                arguments: [binding],
            });

            console.log("Binding will be created with rules:");
            console.log("  1. Tribe 100 → Allow");
            console.log("  2. Everyone  → Deny\n");
        }

        // Set bounty config (unchanged from scaffold)
        tx.moveCall({
            target: `${builderPackageId}::${MODULE.CORPSE_GATE_BOUNTY}::set_bounty_config`,
            arguments: [
                tx.object(extensionConfigId),
                tx.object(adminCapId),
                tx.pure.u64(ITEM_A_TYPE_ID),
                tx.pure.u64(3600000),
            ],
        });

        const result = await client.signAndExecuteTransaction({
            transaction: tx,
            signer: keypair,
            options: { showEffects: true, showObjectChanges: true },
        });

        console.log("Smart gate rules configured!");
        console.log("Transaction digest:", result.digest);

        // Show the created binding ID if we created one
        const createdBinding = result.objectChanges?.find(
            (c: any) => c.type === "created" && c.objectType?.includes("AssemblyBinding"),
        );
        if (createdBinding) {
            console.log(`\nef_guard Binding created: ${(createdBinding as any).objectId}`);
            console.log("Set BINDING_ID in your .env to use it in future runs.");
        }
    } catch (error) {
        handleError(error);
    }
}

main();
