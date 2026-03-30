import { useConnection } from '@evefrontier/dapp-kit'
import { useCurrentAccount } from '@mysten/dapp-kit-react'
import { theme } from '../lib/theme'

export function ConnectButton() {
  const { handleConnect, handleDisconnect } = useConnection()
  const account = useCurrentAccount()

  if (account?.address) {
    return (
      <button
        onClick={handleDisconnect}
        className="text-sm px-3 py-1 font-mono transition-colors"
        style={{
          color: theme.textSecondary,
          border: `1px solid ${theme.border}`,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = theme.orange
          e.currentTarget.style.color = theme.orange
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = theme.border
          e.currentTarget.style.color = theme.textSecondary
        }}
      >
        {account.address.slice(0, 6)}…{account.address.slice(-4)}
      </button>
    )
  }

  return (
    <button
      onClick={handleConnect}
      className="text-sm px-4 py-1.5 transition-colors font-semibold"
      style={{
        background: theme.orange,
        color: '#000',
        border: 'none',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = theme.orangeHover }}
      onMouseLeave={(e) => { e.currentTarget.style.background = theme.orange }}
    >
      Connect Wallet
    </button>
  )
}
