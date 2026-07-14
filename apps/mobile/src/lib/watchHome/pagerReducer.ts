/**
 * Pure state machine for the Home hero pager (plan U4); HomeHeroPager drives the platform pieces from its state +
 * selectors. No-op transitions return the SAME state reference. Pure TS. Rules: advance/skip (AE5), wrap, serialized swaps (AE3),
 * videoReady latch (docs/solutions/runtime-errors/expo-video-backdrop-seamless-loop), suspend/resume (AE6), controlled mute, single-slide chrome (AE2).
 */

import type { WatchHomeSlide } from "./carouselSequence"

/** Dwell for image/mux insert slides before auto-advancing (web parity: 7s). */
export const WATCH_HOME_IMAGE_SLIDE_DWELL_MS = 7000

/**
 * Stuck-slide guard: a video slide not "playing" within this budget is skipped.
 * Playing slides are exempt — PLAY_TO_END advances them.
 */
export const WATCH_HOME_MAX_DWELL_MS = 20000

export type PagerSuspendReason = "blur" | "scroll"

/**
 * Reveal state for the ACTIVE slide. "poster" paints on every slide change;
 * "playing" hides the poster over the VideoView. Handoff rule: the incoming
 * slide's poster stays visible during replaceAsync.
 */
export type PagerPlaybackPhase = "poster" | "resolving" | "playing"

export type PagerState = {
  slides: readonly WatchHomeSlide[]
  currentIndex: number
  phase: PagerPlaybackPhase
  /** Player-level mount latch; never reset by transient idle or advances. */
  videoReady: boolean
  /** A replaceAsync swap is running on the native player. */
  swapInFlight: boolean
  /**
   * A swap was interrupted (slide changed mid-swap, suspended with one in flight,
   * or a stream resolved while suspended). Component re-issues it when
   * shouldReissueSwap turns true.
   */
  pendingSwap: boolean
  /**
   * A skip (STREAM_ERROR / MAX_DWELL_ELAPSED) arrived while suspended and was
   * deferred; RESUME executes the advance and clears it (AE5). Cleared early by
   * SLIDES_SET or by an explicit move to a DIFFERENT index (moveTo).
   */
  pendingSkip: boolean
  suspended: PagerSuspendReason | null
}

export type PagerEvent =
  | { type: "SLIDES_SET"; slides: readonly WatchHomeSlide[] }
  /** Swipe momentum settled on an index. */
  | { type: "SLIDE_SHOWN"; index: number }
  /**
   * User swipe committed. Unlike CHIP_TAPPED it is NOT dropped during an
   * in-flight swap — moveTo records the interrupted swap as pendingSwap.
   */
  | { type: "SWIPED"; index: number }
  | { type: "CHIP_TAPPED"; index: number }
  | { type: "STREAM_RESOLVING" }
  /** The active slide's stream resolved (only meaningful while suspended). */
  | { type: "STREAM_READY" }
  | { type: "SWAP_STARTED" }
  | { type: "SWAP_FINISHED" }
  | { type: "PLAY_STARTED" }
  | { type: "PLAY_TO_END" }
  | { type: "IMAGE_TIMER_ELAPSED" }
  | { type: "STREAM_ERROR" }
  | { type: "MAX_DWELL_ELAPSED" }
  | { type: "SUSPEND"; reason: PagerSuspendReason }
  | { type: "RESUME" }

export function createInitialPagerState(
  slides: readonly WatchHomeSlide[] = [],
): PagerState {
  return {
    slides,
    currentIndex: 0,
    phase: "poster",
    videoReady: false,
    swapInFlight: false,
    pendingSwap: false,
    pendingSkip: false,
    suspended: null,
  }
}

// ── Derived state (what the component reads) ────────────────────────────────

/** Chips and dots render only for multi-slide queues (AE2). */
export function showsPagerChrome(state: PagerState): boolean {
  return state.slides.length > 1
}

/**
 * Whether to keep auto-advance timers (image dwell, max dwell) armed.
 * Suspension and single-slide queues stop them.
 */
export function timersRunning(state: PagerState): boolean {
  return state.suspended === null && state.slides.length > 1
}

/** RESUME/SWAP_FINISHED re-issue rule: pending, not in flight, not suspended. */
export function shouldReissueSwap(state: PagerState): boolean {
  return state.suspended === null && state.pendingSwap && !state.swapInFlight
}

export function activeSlide(state: PagerState): WatchHomeSlide | null {
  return state.slides[state.currentIndex] ?? null
}

// ── Transitions ─────────────────────────────────────────────────────────────

/** User-driven jump (swipe settle or chip tap). */
function moveTo(state: PagerState, rawIndex: number): PagerState {
  if (state.slides.length === 0) return state
  const index = Math.min(Math.max(rawIndex, 0), state.slides.length - 1)
  if (index === state.currentIndex) return state
  return {
    ...state,
    currentIndex: index,
    phase: "poster",
    // A move during an in-flight swap can't cancel the native replaceAsync;
    // it records a pending swap for the new slide instead.
    pendingSwap: state.pendingSwap || state.swapInFlight,
    // Explicit navigation supersedes any deferred skip.
    pendingSkip: false,
  }
}

/** Auto-advance (play-to-end, image timer, or skip). */
function advance(state: PagerState): PagerState {
  if (state.suspended !== null) return state
  if (state.slides.length <= 1) return state
  const next = state.currentIndex + 1
  const wrapped = next >= state.slides.length
  return {
    ...state,
    currentIndex: wrapped ? 0 : next,
    phase: "poster",
    pendingSwap: state.pendingSwap || state.swapInFlight,
  }
}

function suspend(state: PagerState, reason: PagerSuspendReason): PagerState {
  const pendingSwap = state.pendingSwap || state.swapInFlight
  if (state.suspended === reason && state.pendingSwap === pendingSwap) {
    return state
  }
  return { ...state, suspended: reason, pendingSwap }
}

export function pagerReducer(state: PagerState, event: PagerEvent): PagerState {
  switch (event.type) {
    case "SLIDES_SET":
      return {
        ...state,
        slides: event.slides,
        currentIndex: 0,
        phase: "poster",
        pendingSwap: state.pendingSwap || state.swapInFlight,
        // A queue replacement is an explicit move; supersedes any deferred skip.
        pendingSkip: false,
      }

    case "SLIDE_SHOWN":
      return moveTo(state, event.index)

    case "SWIPED":
      return moveTo(state, event.index)

    case "CHIP_TAPPED":
      // Serialized swaps: taps during an in-flight replaceAsync are dropped.
      // moveTo handles the tap-on-current no-op.
      if (state.swapInFlight) return state
      return moveTo(state, event.index)

    case "STREAM_RESOLVING":
      return state.phase === "resolving"
        ? state
        : { ...state, phase: "resolving" }

    case "STREAM_READY":
      // While suspended, remember the waiting stream so RESUME re-issues the
      // swap. When running, the component starts the swap itself
      // (SWAP_STARTED) and this event carries no state change.
      if (state.suspended !== null && !state.pendingSwap) {
        return { ...state, pendingSwap: true }
      }
      return state

    case "SWAP_STARTED":
      return { ...state, swapInFlight: true, pendingSwap: false }

    case "SWAP_FINISHED":
      return state.swapInFlight ? { ...state, swapInFlight: false } : state

    case "PLAY_STARTED":
      // videoReady latches here and is never reset by idle blips or advances.
      if (state.phase === "playing" && state.videoReady) return state
      return { ...state, phase: "playing", videoReady: true }

    case "PLAY_TO_END":
      return activeSlide(state)?.kind === "video" ? advance(state) : state

    case "IMAGE_TIMER_ELAPSED":
      return activeSlide(state)?.kind === "mux" ? advance(state) : state

    case "STREAM_ERROR": {
      // A failed replaceAsync also lands here: the swap died with its slide,
      // so clear in-flight WITHOUT recording a pending re-issue.
      const cleared = state.swapInFlight
        ? { ...state, swapInFlight: false }
        : state
      if (cleared.suspended !== null) {
        // Can't advance while suspended. Record a pendingSkip for multi-slide
        // queues so RESUME executes the skip promptly (AE5) instead of letting
        // the dead slide sit on its poster for the full 20s max-dwell.
        const base =
          cleared.phase === "poster"
            ? cleared
            : { ...cleared, phase: "poster" as const }
        if (cleared.slides.length > 1 && !base.pendingSkip) {
          return { ...base, pendingSkip: true }
        }
        return base
      }
      const advanced = advance(cleared)
      if (advanced !== cleared) return advanced
      // Single-slide queue: nowhere to skip to — fall back to the poster.
      return cleared.phase === "poster"
        ? cleared
        : { ...cleared, phase: "poster" }
    }

    case "MAX_DWELL_ELAPSED":
      // Max dwell guards stuck slides; a playing video ends via PLAY_TO_END.
      if (state.phase === "playing") return state
      if (state.suspended !== null && state.slides.length > 1) {
        // Deferred skip: advance cannot run while suspended. Record it for
        // RESUME to execute (AE5) so the stuck slide doesn't dwell needlessly.
        return state.pendingSkip ? state : { ...state, pendingSkip: true }
      }
      return advance(state)

    case "SUSPEND":
      return suspend(state, event.reason)

    case "RESUME": {
      if (state.suspended === null) return state
      const resumed = { ...state, suspended: null }
      if (resumed.pendingSkip) {
        // Execute the deferred skip now that the pager is running again (AE5).
        // advance() guards on suspended === null, which is satisfied after the
        // field reset above; call it directly on resumed.
        const advanced = advance(resumed)
        // advance() returns the same reference only for single-slide queues;
        // clear pendingSkip regardless so we don't carry stale state.
        return advanced !== resumed
          ? { ...advanced, pendingSkip: false }
          : { ...resumed, pendingSkip: false }
      }
      return resumed
    }
  }
}
