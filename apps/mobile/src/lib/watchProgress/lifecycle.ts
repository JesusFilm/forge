/**
 * Session → progress lifecycle (U6): signing in hydrates the store
 * (snapshot first for instant bars, then the fail-open server read) and
 * flushes the offline queue; signing out empties the store, the snapshot,
 * and the queue so the anonymous experience carries nothing over (R10).
 * Deps injected; the AuthProvider wires the real store/sync/storage.
 */

import { WATCH_PROGRESS_QUEUE_STORAGE_KEY } from "./queue"
import { WATCH_PROGRESS_SNAPSHOT_STORAGE_KEY } from "./snapshot"

export type ProgressLifecycleDeps = {
  getAccountId: () => string | null
  subscribe: (listener: () => void) => () => void
  hydrateFromSnapshot: () => Promise<void>
  hydrateFromServer: () => Promise<void>
  flushQueue: () => Promise<void>
  resetStore: () => void
  removeStorageItem: (key: string) => Promise<void>
}

/**
 * Attach the lifecycle to session transitions. Fires the signed-in path
 * immediately when already signed in at attach time (cold launch with a
 * persisted session). Returns a detach function.
 */
export function attachProgressLifecycle(deps: ProgressLifecycleDeps) {
  let knownAccountId: string | null = null

  async function onSignedIn() {
    await deps.hydrateFromSnapshot()
    await deps.hydrateFromServer()
    await deps.flushQueue()
  }

  async function onSignedOut() {
    deps.resetStore()
    await deps
      .removeStorageItem(WATCH_PROGRESS_SNAPSHOT_STORAGE_KEY)
      .catch(() => {})
    await deps
      .removeStorageItem(WATCH_PROGRESS_QUEUE_STORAGE_KEY)
      .catch(() => {})
  }

  function handleTransition() {
    const accountId = deps.getAccountId()
    if (accountId === knownAccountId) return
    const previous = knownAccountId
    knownAccountId = accountId
    if (accountId != null) {
      // An account SWITCH clears the old account's local artifacts first.
      if (previous != null) {
        void onSignedOut().then(onSignedIn)
      } else {
        void onSignedIn()
      }
    } else {
      void onSignedOut()
    }
  }

  const unsubscribe = deps.subscribe(handleTransition)
  handleTransition()
  return unsubscribe
}
