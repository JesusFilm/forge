// Pure video Quality-of-Experience accumulator. Dependency- and framework-free
// so it unit-tests without the native Datadog SDK or expo-video: VideoPlayer
// feeds it from EXISTING listeners and emits the summary via datadogLog. PII-free
// by construction — content_id is the Mux playback id, never the title.

/** Why the session ended — "ended" (playToEnd) vs "abandoned" (Back/unmount). */
export type VideoQoeReason = "ended" | "abandoned"

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
