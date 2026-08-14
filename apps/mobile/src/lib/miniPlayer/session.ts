// Pure admission and identity rules for publishing a watch session to the
// mini player store (U6). No react-native, no router, no store import — the
// route calls these and then calls the store.

export type SessionIdentity = {
  videoId?: string
  videoSlug?: string
  languageSlug?: string | null
}

/**
 * Is this session allowed to survive the route?
 *
 * Keyed on playback having STARTED, never on a source string existing. Seven
 * distinct pre-playback states accept a back press on the watch screen, and
 * three of them — a load that errored, a load that hit the 12s watchdog, and
 * an autostart declined because the app was backgrounded — look identical to a
 * healthy player: chrome up, scrubber at 0:00. A source-existence test admits
 * all three and floats a window over a video that never played.
 *
 * The signal must also be a one-way latch on the FIRST true. Reading the
 * instantaneous playing state at back-press time is wrong in the opposite
 * direction: it is false after any pause, so a viewer who pauses and then
 * backs out — the most common way anyone reaches a mini player — would
 * publish nothing.
 */
export function admitsSession(hasPlaybackStarted: boolean): boolean {
  return hasPlaybackStarted
}

/**
 * A usable identity, or null.
 *
 * An empty-string videoId is rejected rather than passed through: the record
 * builder falls back to `documentId: raw.documentId ?? ""`, and the store only
 * checks presence — so an empty id renders as a valid session while defeating
 * every identity compare below it.
 */
export function normalizeSessionIdentity(
  raw: SessionIdentity | null | undefined,
): SessionIdentity | null {
  if (raw == null) return null
  const videoId = raw.videoId?.trim() ? raw.videoId : undefined
  const videoSlug = raw.videoSlug?.trim() ? raw.videoSlug : undefined
  if (videoId == null && videoSlug == null) return null
  return { videoId, videoSlug, languageSlug: raw.languageSlug ?? null }
}

/**
 * Same video, same audio language?
 *
 * The streaming URL is deliberately NOT part of this. One session legitimately
 * changes URL twice: the downloads manifest hydrates after cold launch, so the
 * first source is the network stream and it later jumps to `file://`; and a
 * seed URL resolves to the canonical one. Treating either jump as a new
 * session emits a bogus `replaced` telemetry record and a swap-triggered
 * progress write per jump.
 *
 * The language IS part of it: it keys the progress recorder, so a mid-playback
 * audio switch must re-key or the departing position is stamped with a
 * language it was never watched in.
 */
export function isSameSession(
  a: SessionIdentity | null,
  b: SessionIdentity | null,
): boolean {
  if (a == null || b == null) return false
  return (
    a.videoId === b.videoId &&
    a.videoSlug === b.videoSlug &&
    (a.languageSlug ?? null) === (b.languageSlug ?? null)
  )
}

export type SessionAction = "start" | "update" | "none"

/**
 * What the publisher should do with the next snapshot: open a new session,
 * update the live one in place, or nothing.
 */
export function sessionActionFor(
  current: SessionIdentity | null,
  next: SessionIdentity | null,
): SessionAction {
  if (next == null) return "none"
  if (current == null) return "start"
  return isSameSession(current, next) ? "update" : "start"
}
