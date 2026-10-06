export type PlaybackObservation = {
  sourceGeneration: number
  state: "playing" | "paused" | "buffering" | "ended" | "error"
  positionSeconds: number
  durationSeconds: number | null
  seeking?: boolean
}
export type PlaybackFact = {
  eventId: string
  occurredAt: string
  kind: string
  payload: Record<string, string | number | boolean | null>
}

export function createPlaybackRecorder(deps: {
  generation: number
  now: () => number
  timestamp: () => string
  id: () => string
  emit: (events: PlaybackFact[]) => void
  automatic?: boolean
}) {
  let previous: (PlaybackObservation & { at: number }) | null = null
  let activeMilliseconds = 0
  let lastProgress = deps.now()
  const startedAt = lastProgress
  let started = false
  let ended = false
  let foreground = true
  let events: PlaybackFact[] = []
  let generation = deps.generation
  let activeEndedAt: string | undefined
  const fact = (kind: string, payload: PlaybackFact["payload"]) => {
    events.push({
      kind,
      payload,
      eventId: deps.id(),
      occurredAt:
        kind === "playback_active_visible_playing" && activeEndedAt
          ? activeEndedAt
          : deps.timestamp(),
    })
  }
  const flush = () => {
    if (activeMilliseconds > 0) {
      fact("playback_active_visible_playing", {
        activeMilliseconds: Math.round(activeMilliseconds),
        coverage: "complete",
      })
      activeMilliseconds = 0
      activeEndedAt = undefined
    }
    if (events.length) {
      const batch = events
      events = []
      deps.emit(batch)
    }
  }
  const progress = (sample: PlaybackObservation) => {
    const duration =
      sample.durationSeconds && sample.durationSeconds > 0
        ? sample.durationSeconds
        : null
    fact("playback_progress", {
      positionSeconds: sample.positionSeconds,
      durationSeconds: duration,
      progress: duration
        ? Math.min(1, sample.positionSeconds / duration)
        : null,
      wallElapsedMilliseconds: Math.round(
        Math.min(21600000, deps.now() - startedAt),
      ),
    })
    lastProgress = deps.now()
    flush()
  }
  const stop = (reason: "ended" | "route_exit" | "hidden") => {
    if (ended) return
    const sample = previous
    if (sample) progress(sample)
    fact("playback_end", {
      reason,
      positionSeconds: sample?.positionSeconds ?? 0,
      durationSeconds: sample?.durationSeconds ?? null,
      progress: sample?.durationSeconds
        ? Math.min(1, sample.positionSeconds / sample.durationSeconds)
        : null,
      completed: reason === "ended",
    })
    ended = true
    flush()
  }
  fact("playback_attempt", {
    initiation: deps.automatic ? "automatic" : "manual",
  })
  flush()
  return {
    observe(sample: PlaybackObservation) {
      if (
        ended ||
        sample.sourceGeneration !== generation ||
        !Number.isFinite(sample.positionSeconds) ||
        sample.positionSeconds < 0
      )
        return
      const now = deps.now()
      const stateChanged = previous?.state !== sample.state
      if (
        !started &&
        sample.state === "playing" &&
        foreground &&
        !sample.seeking
      ) {
        started = true
        fact("playback_start", { positionSeconds: sample.positionSeconds })
      }
      if (previous) {
        const elapsed = now - previous.at
        const delta = sample.positionSeconds - previous.positionSeconds
        const seek =
          sample.seeking ||
          previous.seeking ||
          delta < -0.25 ||
          delta > (elapsed / 1000) * 4 + 0.75
        if (seek || elapsed > 1500 || sample.state !== "playing") flush()
        if (seek && !previous.seeking)
          fact("playback_seek", {
            fromSeconds: previous.positionSeconds,
            toSeconds: sample.positionSeconds,
          })
        // Position only detects discontinuity. Watch time comes from the monotonic clock.
        if (
          foreground &&
          elapsed > 0 &&
          elapsed <= 1500 &&
          !seek &&
          previous.state === "playing" &&
          sample.state === "playing"
        ) {
          activeMilliseconds += elapsed
          activeEndedAt = deps.timestamp()
        }
      }
      previous = { ...sample, at: now }
      if (sample.state === "error") {
        fact("playback_error", {
          code: "media_error",
          positionSeconds: sample.positionSeconds,
        })
        stop("route_exit")
      } else if (sample.state === "ended") stop("ended")
      else if (
        (stateChanged && sample.state !== "playing") ||
        sample.seeking ||
        now - lastProgress >= 10000 ||
        events.length >= 12
      )
        progress(sample)
    },
    visibility(visible: boolean) {
      if (foreground === visible) return
      foreground = visible
      if (previous) progress(previous)
      previous = null
    },
    changeSource(nextGeneration: number) {
      if (generation === nextGeneration) return
      if (previous) progress(previous)
      previous = null
      generation = nextGeneration
    },
    stop,
  }
}
