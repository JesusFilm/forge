/**
 * R15: a provider sign-in whose email matches no existing account creates a
 * new one — most often Apple's Hide My Email relay, which yields a different
 * address than the person uses on web. Without a word, the app just shows an
 * empty continue-watching row and reads as data loss.
 *
 * A blocking interstitial on every first sign-in was rejected as noise
 * (user-directed, 2026-08-04); this is the non-blocking Profile notice
 * instead. It lives in memory only: it explains the state the user is looking
 * at right now, and surviving a relaunch would turn it into nagging.
 */

/**
 * How fresh the account row must be to count as "just created by this
 * sign-in". `createdAt` is the SERVER's clock and `nowMs` the device's, so
 * this window absorbs ordinary skew. It is deliberately generous: the cost of
 * being wrong either way is one informational line, so no decision more
 * consequential than the notice may key off it.
 */
export const NEW_ACCOUNT_WINDOW_MS = 5 * 60 * 1000

export function wasAccountJustCreated(
  createdAt: string | Date | null | undefined,
  nowMs: number,
): boolean {
  if (createdAt == null) return false
  const createdMs =
    createdAt instanceof Date ? createdAt.getTime() : Date.parse(createdAt)
  if (!Number.isFinite(createdMs)) return false
  // A future createdAt is skew, not a signal from the future — still fresh.
  return Math.abs(nowMs - createdMs) <= NEW_ACCOUNT_WINDOW_MS
}

type Listener = () => void

let accountId: string | null = null
const listeners = new Set<Listener>()

function emit() {
  for (const listener of listeners) listener()
}

/** Raise the notice for an account the sign-in just created. */
export function noteAccountCreated(id: string) {
  if (accountId === id) return
  accountId = id
  emit()
}

/** Dismissed by the user, or cleared on sign-out. */
export function clearNewAccountNotice() {
  if (accountId === null) return
  accountId = null
  emit()
}

/** The account the notice belongs to, or null. Identity-stable per state. */
export function getNewAccountNotice(): string | null {
  return accountId
}

export function subscribeToNewAccountNotice(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
