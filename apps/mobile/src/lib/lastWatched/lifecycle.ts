/**
 * Playback → last-watched record (KTD5). The record is written from a
 * subscriber on the playback request store, never from the player host.
 *
 * The write fires when playback is live and the session slug differs from the
 * last written slug, which covers the first play AND an Up Next swap that
 * keeps playing — a case the host's own started latch never sees. Only the
 * watch screen publishes a session, so "watch screen only" (R10) is
 * structural rather than a call-site convention.
 *
 * A title is persisted only when the session says it came from the resolved
 * video record. `displayTitle` also falls back to the deep-link seed, which is
 * attacker-controlled, and this record is read back into a lock-screen body.
 */

import type { PlaybackRequestSnapshot } from "../miniPlayer/playbackRequest"

export type LastWatchedWriterDeps = {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => PlaybackRequestSnapshot
  write: (videoSlug: string, videoTitle: string | null) => void
}

/**
 * Attach the writer to the playback request store. Reads once at attach time
 * so a video already playing is recorded. Returns a detach function.
 */
export function attachLastWatchedWriter(deps: LastWatchedWriterDeps) {
  // Deliberately NOT reset when the record store is cleared. A sign-out does
  // not stop playback, so re-recording the still-playing video would undo the
  // clear and point the reminders back at the previous account (AE9).
  let lastWrittenSlug: string | null = null
  /** Whether the write for `lastWrittenSlug` already carried a title. */
  let titleSettled = false

  function handlePlaybackChange() {
    const { request, playing } = deps.getSnapshot()
    if (!playing) return
    const session = request?.session
    const videoSlug = session?.videoSlug
    if (videoSlug == null || videoSlug.length === 0) return
    // Only a title from the RESOLVED record may persist. The other half of
    // displayTitle is deep-link seed input, and this record is read back into
    // a notification body on a locked device.
    const videoTitle = session?.titleFromRecord ? session.title || null : null
    const isNewSlug = videoSlug !== lastWrittenSlug
    // One corrective upgrade per slug: a downloaded video starts playing before
    // the query supplying its title resolves, so the first write is untitled and
    // a slug-only latch would leave that video unnamed for good.
    const upgradesTitle = !isNewSlug && !titleSettled && videoTitle != null
    if (!isNewSlug && !upgradesTitle) return
    lastWrittenSlug = videoSlug
    titleSettled = videoTitle != null
    deps.write(videoSlug, videoTitle)
  }

  const unsubscribe = deps.subscribe(handlePlaybackChange)
  handlePlaybackChange()
  return unsubscribe
}
