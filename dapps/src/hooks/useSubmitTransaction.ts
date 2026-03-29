import { useState, useCallback } from 'react'
import { useDAppKit } from '@mysten/dapp-kit-react'
import type { Transaction } from '@mysten/sui/transactions'

/**
 * Hook for signing and executing a Sui transaction using the connected wallet
 * via the DAppKit instance.
 */
export function useSubmitTransaction() {
  const dAppKit = useDAppKit()
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const submit = useCallback(
    async (tx: Transaction): Promise<string> => {
      setIsPending(true)
      setError(null)
      try {
        const result = await dAppKit.signAndExecuteTransaction({ transaction: tx })
        if (result.$kind === 'FailedTransaction') {
          throw new Error(`Transaction failed: ${result.FailedTransaction.status.error ?? 'unknown error'}`)
        }
        return result.Transaction.digest
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err))
        setError(e)
        throw e
      } finally {
        setIsPending(false)
      }
    },
    [dAppKit],
  )

  return { submit, isPending, error }
}
