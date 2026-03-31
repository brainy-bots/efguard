/**
 * Read on-chain policies from AssemblyBinding objects.
 * Shared between InGameView and Overview.
 */
import { executeGraphQLQuery } from '@evefrontier/dapp-kit'
import { EFGUARD_PKG } from '../env'

export interface OnChainRule {
  conditionId: string
  effect: 'Allow' | 'Deny'
  label: string
}

export interface OnChainAssemblyPolicy {
  assemblyId: string
  rules: OnChainRule[]
}

export interface BindingSummary {
  bindingId: string
  owner: string
  assemblies: string[]
  policies: OnChainAssemblyPolicy[]
}

async function resolveConditionLabels(conditionIds: string[]): Promise<Map<string, string>> {
  const labels = new Map<string, string>()
  if (conditionIds.length === 0) return labels

  for (const id of conditionIds) {
    try {
      const res = await executeGraphQLQuery<{
        object: { asMoveObject: { contents: { json: any; type: { repr: string } } } }
      }>(
        `query ($id: SuiAddress!) { object(address: $id) { asMoveObject { contents { json type { repr } } } } }`,
        { id },
      )
      const typeRepr = res.data?.object?.asMoveObject?.contents?.type?.repr ?? ''
      const json = res.data?.object?.asMoveObject?.contents?.json ?? {}

      if (typeRepr.includes('EveryoneCondition')) {
        labels.set(id, 'Everyone')
      } else if (typeRepr.includes('TribeCondition')) {
        labels.set(id, `Tribe #${json.tribe_id ?? '?'}`)
      } else if (typeRepr.includes('CharacterCondition')) {
        labels.set(id, `Player #${json.char_game_id ?? '?'}`)
      } else if (typeRepr.includes('MinBalanceCondition')) {
        labels.set(id, `Min Balance: ${json.min_amount ?? '?'}`)
      } else if (typeRepr.includes('TokenHolderCondition')) {
        labels.set(id, 'Token Holder')
      } else if (typeRepr.includes('AttestationCondition')) {
        labels.set(id, 'Signed Attestation')
      } else {
        labels.set(id, 'Custom Condition')
      }
    } catch {
      labels.set(id, `Condition ${id.slice(0, 8)}...`)
    }
  }

  return labels
}

function parseRules(rawRules: any[]): { conditionId: string; effectStr: 'Allow' | 'Deny' }[] {
  return rawRules.map((r: any) => ({
    conditionId: r.condition_id,
    effectStr: r.effect?.Allow !== undefined ? 'Allow' as const : 'Deny' as const,
  }))
}

/** Fetch all bindings and their policies from chain. */
export async function fetchAllBindings(): Promise<BindingSummary[]> {
  const bindingType = `${EFGUARD_PKG}::assembly_binding::AssemblyBinding`
  const res = await executeGraphQLQuery<{
    objects: { nodes: Array<{ address: string; asMoveObject: { contents: { json: any } } }> }
  }>(
    `query ($type: String!) { objects(filter: { type: $type }, first: 20) { nodes { address asMoveObject { contents { json } } } } }`,
    { type: bindingType },
  )

  const nodes = res.data?.objects?.nodes ?? []
  const summaries: BindingSummary[] = []

  for (const n of nodes) {
    const json = n.asMoveObject?.contents?.json
    if (!json) continue

    const allIds = [
      ...(json.gates?.contents ?? []),
      ...(json.turrets?.contents ?? []),
      ...(json.storage_units?.contents ?? []),
    ]

    const policyEntries = json.policies?.contents ?? []
    const allConditionIds = new Set<string>()
    for (const p of policyEntries) {
      for (const r of p.value?.rules ?? []) {
        if (r.condition_id) allConditionIds.add(r.condition_id)
      }
    }

    const conditionLabels = await resolveConditionLabels([...allConditionIds])

    const policies: OnChainAssemblyPolicy[] = policyEntries.map((p: any) => {
      const parsed = parseRules(p.value?.rules ?? [])
      return {
        assemblyId: p.key,
        rules: parsed.map((r) => ({
          conditionId: r.conditionId,
          effect: r.effectStr,
          label: conditionLabels.get(r.conditionId) ?? `Condition ${r.conditionId?.slice(0, 8)}...`,
        })),
      }
    })

    summaries.push({
      bindingId: n.address,
      owner: json.owner ?? '',
      assemblies: allIds,
      policies,
    })
  }

  return summaries
}

/** Fetch policies for a single assembly by finding its binding. */
export async function fetchPoliciesForAssembly(assemblyId: string): Promise<OnChainRule[]> {
  const bindings = await fetchAllBindings()
  for (const b of bindings) {
    const policy = b.policies.find((p) => p.assemblyId === assemblyId)
    if (policy) return policy.rules
  }
  return []
}
