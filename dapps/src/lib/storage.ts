import { TENANT } from '../env'

/**
 * Returns a localStorage key namespaced by tenant and wallet address.
 * Call with walletAddress to get per-user storage.
 * Falls back to tenant-only if no wallet.
 */
export function storageKey(name: string, walletAddress?: string): string {
  if (walletAddress) {
    return `efguard:${TENANT}:${walletAddress}:${name}`
  }
  return `efguard:${TENANT}:${name}`
}
