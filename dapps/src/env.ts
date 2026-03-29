function requireEnv(name: string): string {
  const val = import.meta.env[name]
  if (!val) throw new Error(`Missing required env var: ${name}`)
  return val as string
}

function optionalEnv(name: string, fallback = ''): string {
  return (import.meta.env[name] as string | undefined) ?? fallback
}

export const SUI_RPC_URL      = optionalEnv('VITE_SUI_RPC_URL', 'https://fullnode.testnet.sui.io')
export const NETWORK           = optionalEnv('VITE_NETWORK', 'testnet')
export const EFGUARD_PKG       = requireEnv('VITE_EFGUARD_PACKAGE_ID')
export const WORLD_PKG         = requireEnv('VITE_WORLD_PACKAGE_ID')
export const DEFAULT_BINDING_ID = optionalEnv('VITE_DEFAULT_BINDING_ID')
export const DATAHUB_API_URL   = optionalEnv('VITE_DATAHUB_API_URL', 'https://datahub.evefrontier.com')
