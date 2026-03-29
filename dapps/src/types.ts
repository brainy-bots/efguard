// ── On-chain data shapes ────────────────────────────────────────────────────

export type AssemblyType = 'gate' | 'turret' | 'ssu'

export interface ThreatConfig {
  block_aggressors: boolean
  blocklist: string[] // character game IDs (u64 as string)
}

export type RuleTarget =
  | { type: 'tribe'; tribe_id: number }
  | { type: 'character'; char_game_id: string }
  | { type: 'everyone' }

export type RuleEffect = 'Allow' | 'Deny'

export interface PolicyRule {
  target: RuleTarget
  effect: RuleEffect
}

/** Per-assembly policy: ordered rule list, first match wins */
export interface AssemblyPolicy {
  rules: PolicyRule[]
}

export interface AssemblyBinding {
  id: string
  owner: string
  gates: string[]
  turrets: string[]
  storage_units: string[]
  policies: Record<string, AssemblyPolicy>  // assemblyId → AssemblyPolicy
  threat_config: ThreatConfig
}

// ── Building groups (DApp-only, localStorage) ────────────────────────────────

export interface BuildingGroupEntry {
  assemblyId: string
  assemblyType: AssemblyType
}

export interface BuildingGroup {
  id: string
  name: string
  entries: BuildingGroupEntry[]
}

// ── Extension configs ────────────────────────────────────────────────────────

export interface ExtensionConfig {
  // Gate
  permit_ttl_ms?: number
  // Turret
  deny_weight?: number
  allow_weight?: number
  // SSU
  allow_deposit?: boolean
  allow_withdraw?: boolean
}

// ── Indexer ──────────────────────────────────────────────────────────────────

export interface AuditEntry {
  id: string
  timestamp: string
  char_game_id: string
  tribe_id: number
  assembly_id: string
  assembly_type: AssemblyType
  action: string
  result: 'allowed' | 'denied'
  reason: string
}

export interface ThreatAlert {
  id: string
  timestamp: string
  char_game_id: string
  assembly_id: string
  assembly_type: AssemblyType
  reason: 'blocklist' | 'aggressor'
}
