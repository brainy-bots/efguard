/// Per-base access-control binding. One shared `AssemblyBinding` per base.
///
/// Each registered assembly carries its own `Policy`: an ordered list of `Rule`
/// values evaluated top-to-bottom. The **first matching rule wins**. If no rule
/// matches, access is **denied** (fail-safe default).
///
/// # Minimal transaction design
/// All policy operations accept a single assembly ID so they compose naturally
/// in Sui PTBs — one transaction can register assemblies and set their policies.
///
/// # Middleware
/// Extension modules call `resolve_role(binding, assembly_id, char_game_id, tribe_id)`
/// to get the access decision. No external objects needed — everything is inline.
module ef_guard::assembly_binding {
    use ef_guard::security_status::{Self, ThreatConfig};
    use sui::vec_map::{Self, VecMap};
    use sui::vec_set::{Self, VecSet};
    use sui::event;

    // ── Error codes ──────────────────────────────────────────────────────────

    const ENotBindingOwner:           u64 = 0;
    const EAssemblyAlreadyRegistered: u64 = 1;
    const EAssemblyNotRegistered:     u64 = 4;

    // ── Data model ───────────────────────────────────────────────────────────

    /// Who a rule applies to.
    public enum RuleTarget has copy, drop, store {
        Everyone,
        Tribe     { tribe_id:     u32 },
        Character { char_game_id: u64 },
    }

    /// What happens when a rule matches.
    public enum RuleEffect has copy, drop, store {
        Allow,
        Deny,
    }

    /// A single access-control rule.
    public struct Rule has copy, drop, store {
        target: RuleTarget,
        effect: RuleEffect,
    }

    /// Per-assembly access policy: an ordered rule list.
    /// First matching rule wins. No match = deny.
    public struct Policy has copy, store, drop {
        rules: vector<Rule>,
    }

    /// The role returned by `resolve_role` for extension modules.
    public enum AccessDecision has copy, drop, store {
        Allow,
        Deny,
        Default,
    }

    /// Shared object. One per base.
    public struct AssemblyBinding has key {
        id:            UID,
        owner:         address,
        threat_config: ThreatConfig,
        policies:      VecMap<ID, Policy>,
        gates:         VecSet<ID>,
        turrets:       VecSet<ID>,
        storage_units: VecSet<ID>,
    }

    // ── Events ───────────────────────────────────────────────────────────────

    public struct BindingCreatedEvent has copy, drop {
        binding_id: ID,
        owner:      address,
    }

    public struct AssemblyRegisteredEvent has copy, drop {
        binding_id:    ID,
        assembly_id:   ID,
        assembly_type: u8,   // 0=gate 1=turret 2=ssu
    }

    public struct AssemblyDeregisteredEvent has copy, drop {
        binding_id:    ID,
        assembly_id:   ID,
        assembly_type: u8,
    }

    public struct PolicySetEvent has copy, drop {
        binding_id:  ID,
        assembly_id: ID,
        rule_count:  u64,
        actor:       address,
    }

    public struct BlocklistUpdatedEvent has copy, drop {
        binding_id:   ID,
        char_game_id: u64,
        action:       u8,    // 0=added 1=removed
        actor:        address,
    }

    public struct AggressorBlockToggled has copy, drop {
        binding_id: ID,
        new_value:  bool,
        actor:      address,
    }

    public struct OwnershipTransferredEvent has copy, drop {
        binding_id: ID,
        old_owner:  address,
        new_owner:  address,
    }

    // ── Constructor ──────────────────────────────────────────────────────────

    public fun new_binding(ctx: &mut TxContext): AssemblyBinding {
        let owner = ctx.sender();
        let binding = AssemblyBinding {
            id:            object::new(ctx),
            owner,
            threat_config: security_status::default_config(),
            policies:      vec_map::empty(),
            gates:         vec_set::empty(),
            turrets:       vec_set::empty(),
            storage_units: vec_set::empty(),
        };
        event::emit(BindingCreatedEvent {
            binding_id: object::id(&binding),
            owner,
        });
        binding
    }

    public fun share_binding(binding: AssemblyBinding) {
        transfer::share_object(binding);
    }

    // ── Assembly registration ────────────────────────────────────────────────

    public fun register_gate(binding: &mut AssemblyBinding, gate_id: ID, ctx: &TxContext) {
        assert_owner(binding, ctx);
        assert!(!binding.gates.contains(&gate_id), EAssemblyAlreadyRegistered);
        binding.gates.insert(gate_id);
        vec_map::insert(&mut binding.policies, gate_id, empty_policy());
        event::emit(AssemblyRegisteredEvent {
            binding_id: object::id(binding), assembly_id: gate_id, assembly_type: 0,
        });
    }

    public fun deregister_gate(binding: &mut AssemblyBinding, gate_id: ID, ctx: &TxContext) {
        assert_owner(binding, ctx);
        if (binding.gates.contains(&gate_id)) {
            binding.gates.remove(&gate_id);
            drop_policy(&mut binding.policies, gate_id);
            event::emit(AssemblyDeregisteredEvent {
                binding_id: object::id(binding), assembly_id: gate_id, assembly_type: 0,
            });
        }
    }

    public fun register_turret(binding: &mut AssemblyBinding, turret_id: ID, ctx: &TxContext) {
        assert_owner(binding, ctx);
        assert!(!binding.turrets.contains(&turret_id), EAssemblyAlreadyRegistered);
        binding.turrets.insert(turret_id);
        vec_map::insert(&mut binding.policies, turret_id, empty_policy());
        event::emit(AssemblyRegisteredEvent {
            binding_id: object::id(binding), assembly_id: turret_id, assembly_type: 1,
        });
    }

    public fun deregister_turret(binding: &mut AssemblyBinding, turret_id: ID, ctx: &TxContext) {
        assert_owner(binding, ctx);
        if (binding.turrets.contains(&turret_id)) {
            binding.turrets.remove(&turret_id);
            drop_policy(&mut binding.policies, turret_id);
            event::emit(AssemblyDeregisteredEvent {
                binding_id: object::id(binding), assembly_id: turret_id, assembly_type: 1,
            });
        }
    }

    public fun register_ssu(binding: &mut AssemblyBinding, ssu_id: ID, ctx: &TxContext) {
        assert_owner(binding, ctx);
        assert!(!binding.storage_units.contains(&ssu_id), EAssemblyAlreadyRegistered);
        binding.storage_units.insert(ssu_id);
        vec_map::insert(&mut binding.policies, ssu_id, empty_policy());
        event::emit(AssemblyRegisteredEvent {
            binding_id: object::id(binding), assembly_id: ssu_id, assembly_type: 2,
        });
    }

    public fun deregister_ssu(binding: &mut AssemblyBinding, ssu_id: ID, ctx: &TxContext) {
        assert_owner(binding, ctx);
        if (binding.storage_units.contains(&ssu_id)) {
            binding.storage_units.remove(&ssu_id);
            drop_policy(&mut binding.policies, ssu_id);
            event::emit(AssemblyDeregisteredEvent {
                binding_id: object::id(binding), assembly_id: ssu_id, assembly_type: 2,
            });
        }
    }

    // ── Policy management ────────────────────────────────────────────────────

    /// Replace the entire rule list for an assembly. Compose in a PTB to set
    /// policies for many assemblies in one transaction.
    public fun set_policy(
        binding:     &mut AssemblyBinding,
        assembly_id: ID,
        rules:       vector<Rule>,
        ctx:         &TxContext,
    ) {
        assert_owner(binding, ctx);
        assert!(vec_map::contains(&binding.policies, &assembly_id), EAssemblyNotRegistered);
        let policy = vec_map::get_mut(&mut binding.policies, &assembly_id);
        let rule_count = rules.length();
        policy.rules = rules;
        event::emit(PolicySetEvent {
            binding_id: object::id(binding), assembly_id, rule_count, actor: ctx.sender(),
        });
    }

    /// Append a single rule to an assembly's policy. Useful for incremental edits.
    public fun add_rule(
        binding:     &mut AssemblyBinding,
        assembly_id: ID,
        target:      RuleTarget,
        effect:      RuleEffect,
        ctx:         &TxContext,
    ) {
        assert_owner(binding, ctx);
        assert!(vec_map::contains(&binding.policies, &assembly_id), EAssemblyNotRegistered);
        let policy = vec_map::get_mut(&mut binding.policies, &assembly_id);
        policy.rules.push_back(Rule { target, effect });
    }

    /// Remove the rule at `index` from an assembly's policy.
    public fun remove_rule(
        binding:     &mut AssemblyBinding,
        assembly_id: ID,
        index:       u64,
        ctx:         &TxContext,
    ) {
        assert_owner(binding, ctx);
        assert!(vec_map::contains(&binding.policies, &assembly_id), EAssemblyNotRegistered);
        let policy = vec_map::get_mut(&mut binding.policies, &assembly_id);
        policy.rules.remove(index);
    }

    // ── Role resolution (used by extensions) ─────────────────────────────────

    /// Evaluate access for a character on any assembly type.
    /// Returns `Allow`, `Deny`, or `Default` (no policy / no match).
    public fun resolve_role(
        binding:      &AssemblyBinding,
        assembly_id:  ID,
        char_game_id: u64,
        tribe_id:     u32,
    ): AccessDecision {
        // Blocklist always wins
        if (security_status::is_blocklisted(&binding.threat_config, char_game_id)) {
            return AccessDecision::Deny
        };

        if (!vec_map::contains(&binding.policies, &assembly_id)) {
            return AccessDecision::Default
        };

        let policy = vec_map::get(&binding.policies, &assembly_id);
        let len = policy.rules.length();
        let mut i = 0;
        while (i < len) {
            let rule = &policy.rules[i];
            let matches = match (&rule.target) {
                RuleTarget::Everyone                     => true,
                RuleTarget::Tribe     { tribe_id: t }    => *t == tribe_id,
                RuleTarget::Character { char_game_id: c } => *c == char_game_id,
            };
            if (matches) {
                return match (&rule.effect) {
                    RuleEffect::Allow => AccessDecision::Allow,
                    RuleEffect::Deny  => AccessDecision::Deny,
                }
            };
            i = i + 1;
        };

        AccessDecision::Default // no rule matched
    }

    // ── Threat config ────────────────────────────────────────────────────────

    public fun set_block_aggressors(binding: &mut AssemblyBinding, value: bool, ctx: &TxContext) {
        assert_owner(binding, ctx);
        security_status::set_block_aggressors(&mut binding.threat_config, value);
        event::emit(AggressorBlockToggled {
            binding_id: object::id(binding), new_value: value, actor: ctx.sender(),
        });
    }

    public fun add_to_blocklist(binding: &mut AssemblyBinding, char_game_id: u64, ctx: &TxContext) {
        assert_owner(binding, ctx);
        security_status::add_to_blocklist(&mut binding.threat_config, char_game_id);
        event::emit(BlocklistUpdatedEvent {
            binding_id: object::id(binding), char_game_id, action: 0, actor: ctx.sender(),
        });
    }

    public fun remove_from_blocklist(binding: &mut AssemblyBinding, char_game_id: u64, ctx: &TxContext) {
        assert_owner(binding, ctx);
        security_status::remove_from_blocklist(&mut binding.threat_config, char_game_id);
        event::emit(BlocklistUpdatedEvent {
            binding_id: object::id(binding), char_game_id, action: 1, actor: ctx.sender(),
        });
    }

    // ── Ownership transfer ───────────────────────────────────────────────────

    public fun transfer_ownership(binding: &mut AssemblyBinding, new_owner: address, ctx: &TxContext) {
        assert_owner(binding, ctx);
        let old_owner = binding.owner;
        binding.owner = new_owner;
        event::emit(OwnershipTransferredEvent {
            binding_id: object::id(binding), old_owner, new_owner,
        });
    }

    // ── Read accessors ───────────────────────────────────────────────────────

    public fun owner(binding: &AssemblyBinding): address               { binding.owner }
    public fun threat_config(binding: &AssemblyBinding): &ThreatConfig { &binding.threat_config }
    public fun contains_gate(binding: &AssemblyBinding, id: ID): bool  { binding.gates.contains(&id) }
    public fun contains_turret(binding: &AssemblyBinding, id: ID): bool { binding.turrets.contains(&id) }
    public fun contains_ssu(binding: &AssemblyBinding, id: ID): bool   { binding.storage_units.contains(&id) }

    // ── Value constructors (for PTB callers) ─────────────────────────────────

    public fun everyone(): RuleTarget                   { RuleTarget::Everyone }
    public fun tribe(tribe_id: u32): RuleTarget         { RuleTarget::Tribe { tribe_id } }
    public fun character(char_game_id: u64): RuleTarget { RuleTarget::Character { char_game_id } }
    public fun allow(): RuleEffect                      { RuleEffect::Allow }
    public fun deny(): RuleEffect                       { RuleEffect::Deny }
    public fun rule(target: RuleTarget, effect: RuleEffect): Rule { Rule { target, effect } }

    public fun is_allow(decision: &AccessDecision): bool  { *decision == AccessDecision::Allow }
    public fun is_deny(decision: &AccessDecision): bool   { *decision == AccessDecision::Deny }

    // ── Internal helpers ─────────────────────────────────────────────────────

    fun assert_owner(binding: &AssemblyBinding, ctx: &TxContext) {
        assert!(binding.owner == ctx.sender(), ENotBindingOwner);
    }

    fun empty_policy(): Policy {
        Policy { rules: vector[] }
    }

    fun drop_policy(policies: &mut VecMap<ID, Policy>, assembly_id: ID) {
        if (vec_map::contains(policies, &assembly_id)) {
            vec_map::remove(policies, &assembly_id);
        }
    }
}
