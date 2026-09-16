/**
 * Playback → last-watched record (KTD5). The record is written from a
 * subscriber on the playback request store, never from the player host.
 *
 * The write fires when playback is live and the session slug differs from the
 * last written slug, which covers the first play AND an Up Next swap that
 * keeps playing — a case the host's own started latch never sees. Only the
 * watch screen publishes a session, so "watch screen only" (R10) is
 * structural rather than a call-site convention.
 */

import type { PlaybackRequestSnapshot } from "../miniPlayer/playbackRequest"

export type LastWatchedWriterDeps = {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => PlaybackRequestSnapshot
  write: (videoSlug: string) => void
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

  function handlePlaybackChange() {
    const { request, playing } = deps.getSnapshot()
    if (!playing) return
    const videoSlug = request?.session?.videoSlug
    if (videoSlug == null || videoSlug.length === 0) return
    if (videoSlug === lastWrittenSlug) return
    lastWrittenSlug = videoSlug
    deps.write(videoSlug)
  }

  const unsubscribe = deps.subscribe(handlePlaybackChange)
  handlePlaybackChange()
  return unsubscribe
}
