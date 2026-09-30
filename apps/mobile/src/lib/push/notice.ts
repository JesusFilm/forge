/**
 * The transient in-app message channel for a tap that could not be resolved
 * (R21). Module scope, like the playback request store, because the producer is
 * the router-free tap handler and the host is a `<Stack>` sibling: no prop or
 * context path joins them.
 *
 * The snapshot is the buffer. A notice published before the host mounts is
 * still the current snapshot when it does, so a cold tap never loses it.
 */

export type PushNoticeSnapshot = {
  /** Null means nothing to show. */
  message: string | null
}

const EMPTY: PushNoticeSnapshot = { message: null }

let snapshot: PushNoticeSnapshot = EMPTY
const listeners = new Set<() => void>()

function publish(next: PushNoticeSnapshot): void {
  snapshot = next
  for (const listener of [...listeners]) listener()
}

/** Show one short message. A second notice replaces the first. */
export function publishPushNotice(message: string): void {
  if (message.length === 0) return
  publish({ message })
}

export function clearPushNotice(): void {
  if (snapshot.message == null) return
  publish(EMPTY)
}

export function getPushNoticeSnapshot(): PushNoticeSnapshot {
  return snapshot
}

export function subscribeToPushNotices(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Test seam: drop the buffered notice and every listener. */
export function resetPushNoticesForTests(): void {
  snapshot = EMPTY
  listeners.clear()
}
