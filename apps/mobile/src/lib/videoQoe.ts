// Pure video Quality-of-Experience accumulator — framework-free, so it unit-tests
// without the native Datadog SDK or expo-video (VideoPlayer feeds it from existing
// listeners). PII-free by construction: content_id is the Mux id, never the title.

/**
 * Why the session ended (R17). "abandoned" is the residual — it means nobody
 * named a cause, so every deliberate end must pass its own reason or it hides
 * inside that bucket.
 *
 * - `ended`     playback reached the end
 * - `replaced`  a different video took the player over
 * - `dismissed` the viewer closed the mini player
 * - `failed`    an unrecoverable stream error closed it (R22)
 * - `signout`   the signed-in subject changed under it (R25)
 * - `abandoned` teardown with no explicit signal
 *
 * `SessionEndReason` in lib/miniPlayer/types.ts is this list minus
 * `abandoned`, so the two vocabularies cannot drift apart.
 */
export type VideoQoeReason =
  | "ended"
  | "replaced"
  | "dismissed"
  | "failed"
  | "signout"
  | "abandoned"

/** Numbers/strings/bools only — never a title or other high-cardinality PII. */
export type VideoQoeSummary = {
  content_id: string | null
  ttff_ms: number | null
  rebuffer_count: number
  error_count: number
  last_error?: string
  reason: VideoQoeReason
  watched_ms?: number
}

export type VideoQoeSession = {
  /** Records ttff once (firstPlaying − mount); returns it, or null if already recorded. */
  onFirstPlaying: () => number | null
  onRebuffer: () => void
  onError: (message?: string) => void
  onTimeUpdate: (positionSeconds: number) => void
  /** Returns the summary exactly once; later calls no-op and return null. */
  finalize: (reason: VideoQoeReason) => VideoQoeSummary | null
}

const MAX_ERROR_MESSAGE_LEN = 200

// Newlines break the flat log line and could smuggle a body fragment, and a
// native message can embed the failing (signed) Mux URL — so collapse newlines,
// strip URL query strings, then cap. Exported so the RUM error path reuses it.
export function sanitizeVideoErrorMessage(message: string): string {
  return message
    .replace(/[\r\n]+/g, " ")
    .replace(/(https?:\/\/[^\s?]+)\?\S*/gi, "$1?[redacted]")
    .slice(0, MAX_ERROR_MESSAGE_LEN)
}

// Rebuffer gate for a "loading" status: genuine only when playback has started
// and we're not mid dub/source swap. (Seek is handled by the caller's earlier
// seekTargetRef early-return, before this runs.)
export function shouldCountRebuffer(
  hasStarted: boolean,
  isSourceSwapping: boolean,
): boolean {
  return hasStarted && !isSourceSwapping
}

export function createVideoQoeSession({
  contentId,
  now = Date.now,
}: {
  contentId: string | null
  now?: () => number
}): VideoQoeSession {
  const mountAt = now()
  let ttffMs: number | null = null
  let firstPlayingRecorded = false
  let rebufferCount = 0
  let errorCount = 0
  let lastError: string | undefined
  let lastPositionSeconds = 0
  let finalized = false

  return {
    onFirstPlaying() {
      if (firstPlayingRecorded) return null
      firstPlayingRecorded = true
      ttffMs = Math.max(0, Math.round(now() - mountAt))
      return ttffMs
    },
    onRebuffer() {
      rebufferCount += 1
    },
    onError(message) {
      errorCount += 1
      if (message != null && message.length > 0) {
        lastError = sanitizeVideoErrorMessage(message)
      }
    },
    onTimeUpdate(positionSeconds) {
      if (typeof positionSeconds === "number" && positionSeconds >= 0) {
        lastPositionSeconds = positionSeconds
      }
    },
    finalize(reason) {
      if (finalized) return null
      finalized = true
      const summary: VideoQoeSummary = {
        content_id: contentId,
        ttff_ms: ttffMs,
        rebuffer_count: rebufferCount,
        error_count: errorCount,
        reason,
      }
      if (lastError != null) summary.last_error = lastError
      if (lastPositionSeconds > 0) {
        summary.watched_ms = Math.round(lastPositionSeconds * 1000)
      }
      return summary
    },
  }
}
