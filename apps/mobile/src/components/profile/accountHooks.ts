import { useSyncExternalStore } from "react"

import {
  getAccountDeletedNotice,
  subscribeToAccountDeletedNotice,
} from "../../lib/accountDeletedNotice"
import { getAuthSession, type AuthSessionSnapshot } from "../../lib/authSession"
import {
  getNewAccountNotice,
  subscribeToNewAccountNotice,
} from "../../lib/newAccountNotice"

// Module scope keeps the subscribe identity stable, so React does not
// resubscribe on every render.
function subscribeToAuthSession(onStoreChange: () => void): () => void {
  return getAuthSession().subscribe(onStoreChange)
}

function getAuthSnapshot(): AuthSessionSnapshot {
  return getAuthSession().getSnapshot()
}

export function useAuthSnapshot(): AuthSessionSnapshot {
  return useSyncExternalStore(subscribeToAuthSession, getAuthSnapshot)
}

/** The account id the R15 new-account notice belongs to, or null. */
export function useNewAccountNotice(): string | null {
  return useSyncExternalStore(subscribeToNewAccountNotice, getNewAccountNotice)
}

/** True while the R20 account-deleted notice is raised. */
export function useAccountDeletedNotice(): boolean {
  return useSyncExternalStore(
    subscribeToAccountDeletedNotice,
    getAccountDeletedNotice,
  )
}
