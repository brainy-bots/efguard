import { useQuery } from '@tanstack/react-query'
import { getObjectWithJson } from '@evefrontier/dapp-kit'
import type { AssemblyBinding, AssemblyPolicy, PolicyRule, RuleEffect } from '../types'

type JsonScalar = { json: string }
type VecMapNodes<V> = { nodes?: Array<{ key: JsonScalar; value: V }> }

export function useAssemblyBinding(bindingId: string | null) {
  return useQuery({
    queryKey: ['assembly-binding', bindingId],
    enabled: Boolean(bindingId),
    queryFn: async () => {
      const res = await getObjectWithJson(bindingId!)
      const json = res.data?.object?.asMoveObject?.contents?.json
      if (!json) throw new Error('Binding object not found or has no fields')

      const f = json as Record<string, unknown>

      function strArray(v: unknown): string[] {
        const arr = (v as { nodes?: Array<{ address: string }> })?.nodes ?? []
        return arr.map((n) => n.address ?? n)
      }

      // Parse VecMap<ID, AssemblyPolicy> where AssemblyPolicy = { rules: vector<Rule> }
      const policiesRaw = f['policies'] as VecMapNodes<{
        rules?: { nodes?: Array<{ json: Record<string, unknown> }> }
      }> | undefined

      const policies: Record<string, AssemblyPolicy> = {}
      for (const entry of policiesRaw?.nodes ?? []) {
        const assemblyId = entry.key?.json
        if (!assemblyId) continue

        const rulesRaw = entry.value?.rules?.nodes ?? []
        const rules: PolicyRule[] = rulesRaw.map((r) => {
          const rule = r.json
          return {
            condition_id: String(rule['condition_id'] ?? ''),
            effect: (String(rule['effect']) === 'Allow' ? 'Allow' : 'Deny') as RuleEffect,
          }
        })

        policies[assemblyId] = { rules }
      }

      const threatRaw = f['threat_config'] as Record<string, unknown> | undefined
      const blocklist = (
        (threatRaw?.['blocklist'] as { nodes?: Array<{ json: string }> } | undefined)
          ?.nodes ?? []
      ).map((n) => String(n.json ?? n))

      const binding: AssemblyBinding = {
        id: bindingId!,
        owner: String(f['owner'] ?? ''),
        gates: strArray(f['gates']),
        turrets: strArray(f['turrets']),
        storage_units: strArray(f['storage_units']),
        policies,
        threat_config: {
          block_aggressors: Boolean(threatRaw?.['block_aggressors']),
          blocklist,
        },
      }
      return binding
    },
    staleTime: 30_000,
  })
}
