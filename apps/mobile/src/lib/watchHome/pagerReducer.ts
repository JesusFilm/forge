/**
 * Pure state machine for the Home hero pager (plan U4); HomeHeroPager drives the platform pieces from its state +
 * selectors. No-op transitions return the SAME state reference. Pure TS. Rules: advance/skip (AE5), wrap, serialized swaps (AE3),
 * videoReady latch (docs/solutions/runtime-errors/expo-video-backdrop-seamless-loop), suspend/resume (AE6), controlled mute, single-slide chrome (AE2).
 */

import type { WatchHomeSlide } from "./carouselSequence"

/**
 * Dwell before auto-advancing image/mux slides AND failed (unavailable) video
 * slides — a dead slide shows its poster for this budget instead of an
 * instant skip, so offline rotation stays calm (web parity: 7s).
 */
export const WATCH_HOME_IMAGE_SLIDE_DWELL_MS = 7000

/**
 * Stuck-slide guard: a video slide not "playing" within this budget is skipped.
 * Playing slides are exempt — PLAY_TO_END advances them.
 */
export const WATCH_HOME_MAX_DWELL_MS = 20000

export type PagerSuspendReason = "blur" | "scroll"

/**
 * Reveal state for the ACTIVE slide. "poster" paints on every slide change;
 * "playing" hides the poster over the VideoView; "unavailable" is a failed
 * slide dwelling on its poster for the image budget before advancing.
 * Handoff rule: the incoming slide's poster stays visible during replaceAsync.
 */
export type PagerPlaybackPhase =
  | "poster"
  | "resolving"
  | "playing"
  | "unavailable"

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
   * A MAX_DWELL skip arrived while suspended and was deferred; RESUME executes
   * the advance and clears it (AE5). Cleared early by SLIDES_SET or by an
   * explicit move to a DIFFERENT index (moveTo). Stream errors no longer skip
   * — they park the slide in the "unavailable" poster dwell instead.
   */
  pendingSkip: boolean
  suspended: PagerSuspendReason | null
  /**
   * Slide that keeps hosting the live video while the scroll animation runs —
   * leaving a PLAYING slide must not snap it back to its poster mid-slide.
   * Set by moveTo/advance, released by the settle (SLIDE_SHOWN), SUSPEND, or
   * SLIDES_SET; the component defers pause + swap until it clears.
   */
  transitionFromId: string | null
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
  /** A marked swap already settled for the desired source; no re-issue owed. */
  | { type: "PENDING_SWAP_SATISFIED" }
  | { type: "PLAY_STARTED" }
  | { type: "PLAY_TO_END" }
  | { type: "IMAGE_TIMER_ELAPSED" }
  | { type: "UNAVAILABLE_TIMER_ELAPSED" }
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
    transitionFromId: null,
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

/**
 * Which page hosts the single VideoView and whether its poster is hidden.
 * Hold-aware: the departing slide keeps hosting through the scroll animation
 * while the incoming page shows its poster (one-decoder discipline).
 */
export function heroPageVideoState(
  state: PagerState,
  slide: WatchHomeSlide,
  index: number,
): { showVideo: boolean; posterHidden: boolean } {
  const holding = state.transitionFromId !== null
  const hostsVideo = holding
    ? slide.id === state.transitionFromId
    : index === state.currentIndex
  const showVideo = hostsVideo && slide.kind === "video" && state.videoReady
  return {
    showVideo,
    posterHidden: showVideo && (holding || state.phase === "playing"),
  }
}

// ── Transitions ─────────────────────────────────────────────────────────────

/**
 * Hold for the departing slide: only a revealed video needs to keep hosting
 * the player through the animation. A mid-flight second jump departs a
 * poster-phase slide, so the original hold survives it.
 */
function transitionHold(state: PagerState): string | null {
  return state.phase === "playing"
    ? (activeSlide(state)?.id ?? null)
    : state.transitionFromId
}

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
    transitionFromId: transitionHold(state),
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
    transitionFromId: transitionHold(state),
  }
}

function suspend(state: PagerState, reason: PagerSuspendReason): PagerState {
  const pendingSwap = state.pendingSwap || state.swapInFlight
  if (
    state.suspended === reason &&
    state.pendingSwap === pendingSwap &&
    state.transitionFromId === null
  ) {
    return state
  }
  // Release the hold: the settle event may never arrive while suspended, and
  // suspension pauses the player anyway.
  return { ...state, suspended: reason, pendingSwap, transitionFromId: null }
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
        // The held slide may not exist in the new queue.
        transitionFromId: null,
      }

    case "SLIDE_SHOWN": {
      // The settle of the scroll animation: release the transition hold so the
      // component pauses the outgoing stream and issues the deferred swap.
      const moved = moveTo(state, event.index)
      if (moved.transitionFromId === null) return moved
      return { ...moved, transitionFromId: null }
    }

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

    case "PENDING_SWAP_SATISFIED":
      // The component starts playback directly for a settled matching source;
      // clearing the marker stops RESUME re-issuing it (expo-video 57 would
      // reload the item at zero).
      return state.pendingSwap ? { ...state, pendingSwap: false } : state

    case "PLAY_STARTED":
      // During a hold the playing edge belongs to the OUTGOING stream (the
      // incoming swap is deferred); latching phase here would hide the
      // incoming slide's poster over the paused outgoing frame at settle.
      if (state.transitionFromId !== null) return state
      // videoReady latches here and is never reset by idle blips or advances.
      if (state.phase === "playing" && state.videoReady) return state
      return { ...state, phase: "playing", videoReady: true }

    case "PLAY_TO_END":
      // During a transition hold the event belongs to the OUTGOING stream —
      // advancing again would leap past the incoming slide.
      if (state.transitionFromId !== null) return state
      return activeSlide(state)?.kind === "video" ? advance(state) : state

    case "IMAGE_TIMER_ELAPSED":
      return activeSlide(state)?.kind === "mux" ? advance(state) : state

    case "STREAM_ERROR": {
      // A failed replaceAsync also lands here: the swap died with its slide,
      // so clear in-flight WITHOUT recording a pending re-issue.
      const cleared = state.swapInFlight
        ? { ...state, swapInFlight: false }
        : state
      // Dead-slide dwell: park on the poster for the image budget
      // (UNAVAILABLE_TIMER_ELAPSED advances) instead of skipping instantly —
      // offline rotation stays calm rather than jumping between live slides.
      return cleared.phase === "unavailable"
        ? cleared
        : { ...cleared, phase: "unavailable" }
    }

    case "UNAVAILABLE_TIMER_ELAPSED":
      if (state.phase !== "unavailable") return state
      return advance(state)

    case "MAX_DWELL_ELAPSED": {
      // Max dwell guards stuck slides; a playing video ends via PLAY_TO_END.
      if (state.phase === "playing") return state
      if (state.suspended !== null && state.slides.length > 1) {
        // Deferred skip: advance cannot run while suspended. Record it for
        // RESUME to execute (AE5) so the stuck slide doesn't dwell needlessly.
        return state.pendingSkip ? state : { ...state, pendingSkip: true }
      }
      const advanced = advance(state)
      // A hold that survived a full max-dwell means the scroll settle was
      // lost — force-release it so the deferred pause/swap machinery runs.
      if (advanced.transitionFromId !== null) {
        return { ...advanced, transitionFromId: null }
      }
      return advanced
    }

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
