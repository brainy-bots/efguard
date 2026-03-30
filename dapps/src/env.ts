import { TENANT_CONFIG, type TenantId } from '@evefrontier/dapp-kit'

function optionalEnv(name: string, fallback = ''): string {
  return (import.meta.env[name] as string | undefined) ?? fallback
}

// ── Single source of truth: VITE_TENANT ─────────────────────────────────────
// Set to "stillness", "utopia", "testevenet", or "nebula".
// Everything else derives from this.

export const TENANT: TenantId = (optionalEnv('VITE_TENANT', 'stillness') as TenantId)

const tenantConfig = TENANT_CONFIG[TENANT]
if (!tenantConfig) {
  throw new Error(`Unknown tenant "${TENANT}". Valid: stillness, utopia, testevenet, nebula`)
}

// Derived from tenant
export const WORLD_PKG         = tenantConfig.packageId
export const DATAHUB_HOST      = tenantConfig.datahubHost
export const DATAHUB_API_URL   = `https://${DATAHUB_HOST}`

// Still needs to be set per deployment (ef_guard isn't per-tenant)
export const EFGUARD_PKG       = optionalEnv('VITE_EFGUARD_PACKAGE_ID')
export const DEFAULT_BINDING_ID = optionalEnv('VITE_DEFAULT_BINDING_ID')

// Network config
export const SUI_RPC_URL       = optionalEnv('VITE_SUI_RPC_URL', 'https://fullnode.testnet.sui.io')
export const NETWORK            = optionalEnv('VITE_NETWORK', 'testnet')

// VITE_EVE_WORLD_PACKAGE_ID must be set at build time for dapp-kit internals.
// The GitHub Actions workflow and .env file should set it.
// If not set, dapp-kit's getCharacterPlayerProfileType() etc. will throw.
