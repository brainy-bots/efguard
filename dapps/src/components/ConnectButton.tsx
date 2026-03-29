import { useConnection } from '@evefrontier/dapp-kit'
import { useCurrentAccount } from '@mysten/dapp-kit-react'

export function ConnectButton() {
  const { handleConnect, handleDisconnect } = useConnection()
  const account = useCurrentAccount()

  if (account?.address) {
    return (
      <button
        onClick={handleDisconnect}
        className="text-sm text-surface-3 border border-surface-3 rounded px-3 py-1 hover:border-accent hover:text-accent transition-colors font-mono"
      >
        {account.address.slice(0, 6)}…{account.address.slice(-4)}
      </button>
    )
  }

  return (
    <button
      onClick={handleConnect}
      className="text-sm bg-accent hover:bg-accent-dim text-white rounded px-4 py-1.5 transition-colors font-semibold"
    >
      Connect Wallet
    </button>
  )
}
