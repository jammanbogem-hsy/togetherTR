import { auth } from '@/lib/firebase/config'
import { ACCOUNT_DELETE_ENDPOINT, ACCOUNT_DELETION_COPY, type AccountDeletionResult } from './consent'

export async function deleteCurrentAccount(confirm: string): Promise<AccountDeletionResult> {
  if (confirm !== ACCOUNT_DELETION_COPY.confirmWord) throw new Error('confirm-required')
  const user = auth.currentUser
  if (!user) throw new Error('unauthenticated')
  const token = await user.getIdToken(true)
  const response = await fetch(ACCOUNT_DELETE_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm }),
  })
  const result: AccountDeletionResult | null = await response.json().catch(() => null)
  if (!response.ok || result?.ok !== true) throw new Error(result?.error || 'partial-failure')
  return result
}
