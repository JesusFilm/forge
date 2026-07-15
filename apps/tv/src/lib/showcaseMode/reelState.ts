/**
 * The reel's sequencing machine (R8/R16/R17). React-free .ts so it is unit-testable —
 * apps/tv has no render harness by convention, and a jest test cannot import `react`.
 * Timers are declarative durations here; the screen owns setTimeout and feeds events back.
 */

import type { ShowcaseChapter, ShowcaseExcerpt, ShowcaseQueue } from "./types"

export type ReelPhase =
  | "resolving"
  | "chapterCard"
  | "excerpt"
  | "interstitial"
  | "stills"
  | "exited"

/**
 * The loop-boundary queue refresh (R17), armed when the final chapter is entered so a
 * CMS edit lands before the last excerpt ends. `pending` is the only status that makes
 * the boundary wait; `failed` keeps the last-good queue.
 */
export type ReelRefresh =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "ready"; queue: ShowcaseQueue }
  | { status: "failed" }

export type ReelState = {
  phase: ReelPhase
  /** Last-good queue — retained through stills and a failed refresh. */
  queue: ShowcaseQueue | null
  chapterIndex: number
  excerptIndex: number
  consecutiveFailures: number
  /** Chapters completed since the last interstitial — drives R9's cadence. */
  chaptersSinceInterstitial: number
  /**
   * Bumps whenever the TARGET excerpt changes — the screen's resolve/prefetch key and
   * U4's source-swap guard. A one-item reel loops onto identical indices and the same
   * excerpt object, so nothing else can tell the screen to play it again.
   */
  excerptToken: number
  refresh: ReelRefresh
}

export type ReelEvent =
  /** A queue resolved: cold start, or a re-resolve that rejoins the reel from stills. */
  | { type: "resolved"; queue: ShowcaseQueue }
  /** Resolution yielded nothing playable. */
  | { type: "resolveFailed" }
  /** The loop-boundary refresh landed. */
  | { type: "queueRefreshed"; queue: ShowcaseQueue }
  /** The loop-boundary refresh failed — the last-good queue loops instead. */
  | { type: "queueRefreshFailed" }
  /** The chapter card's ~5s elapsed. */
  | { type: "cardTimerElapsed" }
  /** The stat interstitial's dwell elapsed. */
  | { type: "interstitialTimerElapsed" }
  /** Playback confirmed for the current excerpt — the breaker's reset signal. */
  | { type: "excerptPlaying" }
  /** playToEnd, or the bounded window's end. */
  | { type: "excerptEnded" }
  /** The current item is unplayable — skip it (R16). */
  | { type: "excerptFailed" }
  /** A deliberate remote press (U6). Terminal from every state. */
  | { type: "exit" }

/** R8: the chapter card names the felt need for about five seconds. */
export const CHAPTER_CARD_DURATION_MS = 5000
export const INTERSTITIAL_DURATION_MS = 6000
/** R16: stills re-attempt resolution periodically rather than fast-skipping. */
export const STILLS_RE_RESOLVE_INTERVAL_MS = 30000
/** R9: "every few chapters". */
export const INTERSTITIAL_EVERY_N_CHAPTERS = 3
/** R16: "several consecutive failures" before the reel stops fast-skipping. */
export const REEL_FAILURE_BREAKER_THRESHOLD = 3

export const INITIAL_REEL_STATE: ReelState = {
  phase: "resolving",
  queue: null,
  chapterIndex: 0,
  excerptIndex: 0,
  consecutiveFailures: 0,
  chaptersSinceInterstitial: 0,
  excerptToken: 0,
  refresh: { status: "idle" },
}

// ── Selectors ───────────────────────────────────────────────────────

export function currentChapter(state: ReelState): ShowcaseChapter | null {
  return state.queue?.chapters[state.chapterIndex] ?? null
}

export function currentExcerpt(state: ReelState): ShowcaseExcerpt | null {
  return currentChapter(state)?.excerpts[state.excerptIndex] ?? null
}

/**
 * R17's prefetch target: the excerpt that plays next if nothing fails. Wraps within the
 * current queue at the loop boundary — the refreshed queue is not knowable yet, and a
 * wrong warm costs one poster.
 */
export function nextExcerpt(state: ReelState): ShowcaseExcerpt | null {
  const queue = state.queue
  const chapter = currentChapter(state)
  if (queue == null || chapter == null) return null
  const withinChapter = chapter.excerpts[state.excerptIndex + 1]
  if (withinChapter != null) return withinChapter
  const nextIndex =
    playableChapterIndexFrom(queue, state.chapterIndex + 1) ??
    playableChapterIndexFrom(queue, 0)
  if (nextIndex == null) return null
  return queue.chapters[nextIndex].excerpts[0] ?? null
}

/** Poster art for the stills slideshow (R16) — the last-good queue is its source. */
export function stillsPosters(state: ReelState): string[] {
  const posters = (state.queue?.chapters ?? []).flatMap((chapter) =>
    chapter.excerpts
      .map((excerpt) => excerpt.posterUrl)
      .filter((url): url is string => url != null),
  )
  return [...new Set(posters)]
}

// ── Chapter selection ───────────────────────────────────────────────

/**
 * R16: a chapter with no playable items is skipped whole, so its card never shows
 * alone. Returns null when no chapter at or after `from` has excerpts.
 */
function playableChapterIndexFrom(
  queue: ShowcaseQueue,
  from: number,
): number | null {
  for (let index = Math.max(from, 0); index < queue.chapters.length; index++) {
    if (queue.chapters[index].excerpts.length > 0) return index
  }
  return null
}

function enterChapterAt(
  state: ReelState,
  queue: ShowcaseQueue,
  chapterIndex: number,
): ReelState {
  const isFinal = playableChapterIndexFrom(queue, chapterIndex + 1) == null
  return {
    ...state,
    // Fallback reels carry no felt-need labels, so they never render a chapter card.
    phase: queue.kind === "fallback" ? "excerpt" : "chapterCard",
    queue,
    chapterIndex,
    excerptIndex: 0,
    excerptToken: state.excerptToken + 1,
    // Arm the refresh on the final chapter so the next queue is ready before its
    // last excerpt ends (mirrors R17's next-excerpt prefetch).
    refresh:
      isFinal && state.refresh.status === "idle"
        ? { status: "pending" }
        : state.refresh,
  }
}

function enterQueue(
  state: ReelState,
  queue: ShowcaseQueue,
  opts: { keepCadence: boolean },
): ReelState {
  const chapterIndex = playableChapterIndexFrom(queue, 0)
  if (chapterIndex == null) {
    return { ...state, phase: "stills", queue, refresh: { status: "idle" } }
  }
  return enterChapterAt(
    {
      ...state,
      queue,
      // Carrying the count in would re-trip the breaker on the first failure.
      consecutiveFailures: 0,
      chaptersSinceInterstitial: opts.keepCadence
        ? state.chaptersSinceInterstitial
        : 0,
      refresh: { status: "idle" },
    },
    queue,
    chapterIndex,
  )
}

function crossLoopBoundary(state: ReelState, queue: ShowcaseQueue): ReelState {
  const refresh = state.refresh
  if (refresh.status === "ready") {
    return enterQueue(state, refresh.queue, { keepCadence: true })
  }
  if (refresh.status === "pending") {
    // Not back in time: show the loading state and hold the last-good queue until
    // the in-flight refresh settles either way.
    return { ...state, phase: "resolving" }
  }
  return enterQueue(state, queue, { keepCadence: true })
}

function advanceToNextChapter(
  state: ReelState,
  queue: ShowcaseQueue,
): ReelState {
  const nextIndex = playableChapterIndexFrom(queue, state.chapterIndex + 1)
  if (nextIndex == null) return crossLoopBoundary(state, queue)
  return enterChapterAt(state, queue, nextIndex)
}

function isInterstitialDue(queue: ShowcaseQueue, completed: number): boolean {
  // R9: interstitials need authored stats, and the fallback reel skips the branch
  // entirely rather than passing one video's dub count off as the breadth claim.
  if (queue.kind !== "curated" || queue.statLines.length === 0) return false
  return completed >= INTERSTITIAL_EVERY_N_CHAPTERS
}

function advanceExcerpt(state: ReelState, queue: ShowcaseQueue): ReelState {
  const chapter = queue.chapters[state.chapterIndex]
  if (chapter == null) return crossLoopBoundary(state, queue)

  const nextWithin = state.excerptIndex + 1
  if (nextWithin < chapter.excerpts.length) {
    return {
      ...state,
      phase: "excerpt",
      excerptIndex: nextWithin,
      excerptToken: state.excerptToken + 1,
    }
  }

  const completed = state.chaptersSinceInterstitial + 1
  if (isInterstitialDue(queue, completed)) {
    return { ...state, phase: "interstitial", chaptersSinceInterstitial: 0 }
  }
  return advanceToNextChapter(
    { ...state, chaptersSinceInterstitial: completed },
    queue,
  )
}

// ── Reducer ─────────────────────────────────────────────────────────

export function reelReducer(state: ReelState, event: ReelEvent): ReelState {
  // Exit is terminal, which also makes it idempotent — Android TV delivers select
  // both globally and through U6's Pressable.
  if (state.phase === "exited") return state

  switch (event.type) {
    case "exit":
      return { ...state, phase: "exited" }

    case "resolved":
      // Cold start, or a re-resolve rejoining from stills — both start the reel over.
      if (state.phase !== "resolving" && state.phase !== "stills") return state
      return enterQueue(state, event.queue, { keepCadence: false })

    case "resolveFailed":
      // Same reference in stills: no re-render, so no fast-skip strobe (AE7).
      if (state.phase !== "resolving") return state
      return { ...state, phase: "stills" }

    case "queueRefreshed":
      if (state.phase === "resolving") {
        return enterQueue(state, event.queue, { keepCadence: true })
      }
      // A refresh landing in stills is dropped; the stills re-resolve owns recovery.
      if (state.phase === "stills") return state
      return { ...state, refresh: { status: "ready", queue: event.queue } }

    case "queueRefreshFailed":
      if (state.phase === "resolving") {
        // The boundary was waiting on this. A last-good queue is content, and
        // stills is the floor — reached only with nothing to play at all.
        return state.queue == null
          ? { ...state, phase: "stills" }
          : enterQueue(state, state.queue, { keepCadence: true })
      }
      if (state.phase === "stills") return state
      return { ...state, refresh: { status: "failed" } }

    case "cardTimerElapsed":
      if (state.phase !== "chapterCard") return state
      return { ...state, phase: "excerpt" }

    case "interstitialTimerElapsed": {
      if (state.phase !== "interstitial" || state.queue == null) return state
      return advanceToNextChapter(state, state.queue)
    }

    case "excerptPlaying":
      if (state.phase !== "excerpt" || state.consecutiveFailures === 0) {
        return state
      }
      return { ...state, consecutiveFailures: 0 }

    case "excerptEnded":
      if (state.phase !== "excerpt" || state.queue == null) return state
      return advanceExcerpt(state, state.queue)

    case "excerptFailed": {
      // A curated chapter enters on its card while the token already armed the
      // resolve, so the excerpt can fail BEFORE its phase — dropping that here
      // wedged the reel on the card's poster with nothing left to re-arm it.
      const canFail = state.phase === "excerpt" || state.phase === "chapterCard"
      if (!canFail || state.queue == null) return state
      const consecutiveFailures = state.consecutiveFailures + 1
      if (consecutiveFailures >= REEL_FAILURE_BREAKER_THRESHOLD) {
        return { ...state, phase: "stills", consecutiveFailures }
      }
      const advanced = advanceExcerpt(
        { ...state, consecutiveFailures },
        state.queue,
      )
      // Stay on the card while retrying behind it: the card IS the resolve window
      // (KTD-2/R17), and its timer keys on phase+chapterIndex, so holding both
      // lets it run its full 5s instead of flashing past a dead first item.
      return state.phase === "chapterCard" &&
        advanced.phase === "excerpt" &&
        advanced.chapterIndex === state.chapterIndex
        ? { ...advanced, phase: "chapterCard" }
        : advanced
    }
  }
}
