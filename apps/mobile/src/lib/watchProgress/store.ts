/**
 * In-memory watch-progress store (KTD8): a plain module readable from the
 * Apollo link, player callbacks, and card components without a React
 * dependency. Holds the account-tagged entry map bars/resume read, plus the
 * buffered write intents KTD5's 30-second batching drains.
 *
 * Progress is signed-in only (R10): every write path is account-tagged and
 * `resetToSignedOut()` empties the store, so the anonymous experience never
 * renders a bar or buffers an intent.
 */

export type WatchProgressEntry = {
  videoId: string
  languageSlug: string | null
  positionSeconds: number
  durationSeconds: number
  completed: boolean
  /** ISO timestamp of the newest recorded position (server or device). */
  updatedAt: string
}

/**
 * A pending position write. Streaming playback carries the admin video id;
 * offline (downloaded) playback has only the slug on device — admin
 * resolves it server-side (KTD8).
 */
export type ProgressWriteIntent = {
  videoId?: string
  videoSlug?: string
  languageSlug: string | null
  positionSeconds: number
  durationSeconds: number
  /** Device recording time — becomes the server entry's required updatedAt. */
  recordedAt: string
}

export type WatchProgressSnapshot = {
  accountId: string | null
  entries: ReadonlyMap<string, WatchProgressEntry>
}

type Listener = () => void

const EMPTY_SNAPSHOT: WatchProgressSnapshot = {
  accountId: null,
  entries: new Map(),
}

let snapshot: WatchProgressSnapshot = EMPTY_SNAPSHOT
const bufferedIntents = new Map<string, ProgressWriteIntent>()
const listeners = new Set<Listener>()

/** Identity keying shared with the offline queue — must never drift. */
export function progressIntentKey(intent: ProgressWriteIntent): string {
  return intent.videoId ? `id:${intent.videoId}` : `slug:${intent.videoSlug}`
}

function commit(next: WatchProgressSnapshot) {
  snapshot = next
  for (const listener of listeners) listener()
}

/** Cached snapshot — stable identity between commits (useSyncExternalStore). */
export function getProgressSnapshot(): WatchProgressSnapshot {
  return snapshot
}

export function getProgressEntry(
  videoId: string,
): WatchProgressEntry | undefined {
  return snapshot.entries.get(videoId)
}

export function subscribeToProgress(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Replace the store from a server read or a parsed snapshot (account-tagged). */
export function hydrateProgress({
  accountId,
  entries,
}: {
  accountId: string
  entries: readonly WatchProgressEntry[]
}) {
  commit({
    accountId,
    entries: new Map(entries.map((entry) => [entry.videoId, entry])),
  })
}

/**
 * Local echo of a recorded position so bars update immediately. No-ops
 * unless the store is signed in as the recording account (R10).
 */
export function applyLocalProgress(
  accountId: string,
  entry: WatchProgressEntry,
) {
  if (snapshot.accountId !== accountId) return
  const entries = new Map(snapshot.entries)
  entries.set(entry.videoId, entry)
  commit({ accountId: snapshot.accountId, entries })
}

/** Per-video clear (R16) — optimistic; the caller re-hydrates on failure. */
export function clearProgressEntry(videoId: string) {
  if (!snapshot.entries.has(videoId)) return
  const entries = new Map(snapshot.entries)
  entries.delete(videoId)
  commit({ accountId: snapshot.accountId, entries })
}

/** Sign-out / account-switch reset: empties entries AND buffered intents. */
export function resetToSignedOut() {
  bufferedIntents.clear()
  commit(EMPTY_SNAPSHOT)
}

/**
 * Buffer a write intent for the batch sender. Same-identity intents replace
 * older ones (client mirrors server dedupe — keep newest).
 */
export function bufferProgressIntent(intent: ProgressWriteIntent) {
  if (!intent.videoId && !intent.videoSlug) return
  bufferedIntents.set(progressIntentKey(intent), intent)
}

export function peekProgressIntents(): ProgressWriteIntent[] {
  return [...bufferedIntents.values()]
}

/** Hand the buffered intents to a sender and clear the buffer. */
export function drainProgressIntents(): ProgressWriteIntent[] {
  const intents = [...bufferedIntents.values()]
  bufferedIntents.clear()
  return intents
}
