import { useSyncExternalStore } from "react"

import {
  getAccountDeletedNotice,
  subscribeToAccountDeletedNotice,
} from "../../lib/accountDeletedNotice"
import {
  getAuthSession,
  type AuthSessionSnapshot,
  type AuthUser,
} from "../../lib/authSession"
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

/** What the header and the Account screen show for a signed-in viewer. The
 *  name falls back to the email, so every value is PII and renders masked. */
export function accountIdentity(user: AuthUser): {
  name: string | undefined
  displayName: string
  initial: string | undefined
} {
  const name = user.name?.trim() || undefined
  return {
    name,
    displayName: name || user.email || "Signed in",
    initial: name ? Array.from(name)[0]?.toLocaleUpperCase() : undefined,
  }
}

/** True while the R20 account-deleted notice is raised. */
export function useAccountDeletedNotice(): boolean {
  return useSyncExternalStore(
    subscribeToAccountDeletedNotice,
    getAccountDeletedNotice,
  )
}
