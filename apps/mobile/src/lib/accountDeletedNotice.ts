/** R20: the deletion closes the Account screen at once, so its result shows
 *  under the My Watch header. In memory only, like newAccountNotice.ts; the
 *  next completed sign-in clears it. */

type Listener = () => void

let deleted = false
const listeners = new Set<Listener>()

function emit() {
  for (const listener of listeners) listener()
}

export function noteAccountDeleted() {
  if (deleted) return
  deleted = true
  emit()
}

/** Dismissed by the viewer, or cleared by the next completed sign-in. */
export function clearAccountDeletedNotice() {
  if (!deleted) return
  deleted = false
  emit()
}

export function getAccountDeletedNotice(): boolean {
  return deleted
}

export function subscribeToAccountDeletedNotice(
  listener: Listener,
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
