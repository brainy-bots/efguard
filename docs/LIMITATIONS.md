# Known Limitations & Suggestions for EVE Frontier Developers

This document describes the limitations we encountered while building ef_guard, an access control middleware for EVE Frontier smart assemblies. Several of these are not bugs in ef_guard but constraints in the current EVE Frontier world contracts and game server architecture. We document them here to help the EVE Frontier team understand what extension developers need.

## 1. Turret Extensions Cannot Enforce Custom Access Control

**The problem:** Turret targeting is controlled by the game server, which calls `get_target_priority_list()` on the turret extension. The game server constructs the transaction with a fixed set of parameters — the turret, the character, and the candidate list. There is no way for the extension to receive additional objects (like an `AssemblyBinding` or `ConditionProof` vector) because the game server doesn't know about them.

This means turret extensions are limited to logic that only reads data already embedded in the turret's on-chain config or in the objects the game server passes. They cannot consult external shared objects at call time.

**What ef_guard does today:** The turret extension module exists and compiles, but is excluded from the DApp because it cannot receive the binding or condition proofs needed for policy evaluation. Only gates and SSUs are supported.

**Suggested solutions:**

- **Allow extensions to declare additional shared objects** that the game server should pass into the targeting call. The extension's config could store a list of object IDs that the server fetches and includes in the PTB.
- **Store access data in the turret config itself.** If the game server always passes the config, the extension could read pre-computed allow/deny lists from a dynamic field on the config object. The owner would update these lists in a separate transaction. This is less dynamic (no real-time condition evaluation) but would work within the current architecture.
- **Pass the full EvalContext data.** If the game server included the candidate's tribe ID and game ID in the call (not just the Character object reference), extensions could at least do tribe/character-based filtering without needing external objects.

**Impact:** High. Turrets are a core defensive building, and being unable to apply access control rules to them significantly limits what extensions can do.

## 2. Smart Storage Units Have Per-Player Inventories

**The problem:** When a player interacts with someone else's SSU, they get their own ephemeral inventory. Items deposited by player A are not visible to player B through the standard game UI. This is the intended SSU design — each character has a separate storage compartment.

This means an SSU cannot function as a "shared chest" or "public warehouse" where multiple players contribute to and draw from the same item pool using only the native game interface.

**What ef_guard does today:** ef_guard correctly controls who can deposit and withdraw (the access control part works). But the underlying per-player inventory model means the DApp's storage view shows each player only their own items.

**Potential approaches:**

- **Extension-mediated transfers.** An extension could implement `transfer_between_inventories()` that moves items from one player's ephemeral inventory to another's, or to/from the main inventory. This would require new world contract functions or creative use of `withdraw_item` + `deposit_to_owned`.
- **Open inventory model.** The world contracts have an "open inventory" concept (`withdraw_from_open_inventory`, `deposit_to_owned`) that extensions can control. A shared-storage extension could route all deposits to the open inventory and allow withdrawals from it. This is a separate extension from ef_guard — ef_guard controls *who* can interact, while a shared-storage extension would control *how* items are stored.
- **This is likely a separate app.** ef_guard's scope is access control. A shared inventory system would be a complementary extension that uses ef_guard for permissions but implements its own storage routing logic.

**Impact:** Medium. The access control works correctly. The limitation is about the storage model, not permissions.

## 3. In-Game Browser Does Not Share State with External Browsers

**The problem:** The EVE Frontier in-game browser (embedded in EVE Vault) has its own localStorage, separate from the player's regular browser. DApp configuration stored in localStorage (building groups, rule labels, UI preferences) is not accessible from the in-game browser.

**What ef_guard does today:** The in-game view reads all policy data directly from the blockchain, so it correctly shows access rules regardless of which browser is used. However, the admin panel (which manages building groups and rule organization) relies on localStorage and only works in the browser where it was configured.

**Potential approaches:**

- **Store DApp configuration on-chain.** Building group metadata could be stored as a JSON blob in a dynamic field on the AssemblyBinding. This would make it accessible from any browser but adds gas costs for configuration changes.
- **Off-chain shared storage.** A lightweight backend (Supabase, IPFS, Walrus) keyed by binding ID could store DApp configuration. This adds infrastructure complexity but keeps gas costs low.
- **Accept the split.** Admin configuration is a power-user feature typically done from a desktop browser. The in-game view is for players interacting with buildings. Keeping them separate may be acceptable.

**Impact:** Low for players (in-game view works from chain data). Medium for owners who want to manage policies from the in-game browser.

## 4. In-Game Browser Limitations

**The problem:** The in-game browser has limited UI capabilities:
- Dropdown menus (`<select>`) don't work reliably
- Complex interactions (drag-and-drop, multi-step modals) are unreliable
- The browser panel is narrow, limiting layout options

**What ef_guard does today:** The in-game view is a read-only display of building status and access rules. All administration is done through the external web panel.

**Suggested improvements:**
- **Document supported HTML/CSS/JS features** for the in-game browser so extension developers can design accordingly.
- **Provide a standard UI component library** optimized for the in-game browser's constraints.

## 5. Multi-Transaction Policy Updates

**The problem:** Creating conditions (shared objects) and referencing them in policies currently requires multiple transactions because newly created shared objects need to be confirmed before they can be referenced by ID in subsequent calls.

**Status:** This has been solved in principle — we can extract condition IDs before sharing them in the same PTB. See [issue #5](https://github.com/brainy-bots/efguard/issues/5) for the implementation plan to collapse the current 2-transaction flow into a single transaction.

**Impact:** Medium. The current workaround works but is fragile and requires users to sign multiple transactions.

## 6. No Social Graph API

**The problem:** The EVE Frontier datahub API does not expose player social connections (friends, contacts, tribe members). This means DApps cannot offer features like "share your building with your friends" or "autocomplete from your tribe members" without an alternative data source.

**Suggested improvements:**
- **Tribe members endpoint.** The `/v2/tribes/{id}/members` endpoint exists but appears non-functional. Making it work would enable tribe-based autocomplete in access control UIs.
- **Social graph endpoints.** Friends lists, contacts, or alliance membership would enable more natural access control workflows — owners are most likely to share buildings with people they already know.

**Impact:** Low for core functionality (players can enter IDs manually). Medium for UX quality.

---

*These limitations were discovered while building ef_guard for the [EVE Frontier x Sui Hackathon 2026](https://deepsurge.xyz/evefrontier2026). We hope this feedback helps the EVE Frontier team prioritize features that will benefit the entire extension developer community.*
