import type { AssemblyBinding } from '../types'

/**
 * Detect the current wallet's role for a binding:
 * - 'owner'   -- walletAddress owns the binding
 * - 'viewer'  -- read-only
 * - 'loading' -- binding not yet loaded
 *
 * With the removal of PolicyGroup / PolicyAdminCap, there is no
 * delegated-admin concept. Only the binding owner can edit policies.
 */
export function useBindingRole(
  binding: AssemblyBinding | null | undefined,
  walletAddress: string | null | undefined,
): 'owner' | 'viewer' | 'loading' {
  if (!binding || !walletAddress) return 'loading'
  if (binding.owner === walletAddress) return 'owner'
  return 'viewer'
}
