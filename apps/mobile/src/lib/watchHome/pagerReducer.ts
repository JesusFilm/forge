/**
 * Pure state machine for the Home hero pager (plan U4, HTD "Hero pager
 * advance rules"). The component (HomeHeroPager) owns the platform pieces —
 * the FlatList, the single expo-video player, and the actual setTimeout
 * timers — and drives them from this reducer's state plus the derived
 * selectors below. Encoded rules:
 *
 *   - advance: video slide on PLAY_TO_END; image/mux slide on the 7s image
 *     timer; STREAM_ERROR or MAX_DWELL_ELAPSED skips a stuck slide so one bad
 *     stream can't freeze the pager (AE5)
 *   - end of queue wraps to index 0 (wrapCount lets the caller reset its
 *     played set / rebuild the queue)
 *   - chip tap on the current index is a no-op; taps during an in-flight
 *     replaceAsync are dropped entirely (serialized swaps, AE3)
 *   - videoReady latches true once and never un-latches on transient idle
 *     (see docs/solutions/runtime-errors/expo-video-backdrop-seamless-loop)
 *   - SUSPEND stops timers (timersRunning selector) and records an
 *     interrupted swap as pendingSwap; RESUME restores the current slide and
 *     shouldReissueSwap tells the component to re-issue it (AE6)
 *   - mute is a CONTROLLED prop owned by the screen, not reducer state: the
 *     session rules (unmute persists across advances, reset to muted on tab
 *     blur) are implemented in HomeScreen
 *   - single-slide queue: no auto-advance, chips/dots hidden
 *     (showsPagerChrome, AE2)
 *
 * No-op transitions return the SAME state reference so useReducer bails out
 * of re-renders and component effects keyed on state identity stay quiet.
 *
 * Pure TypeScript only — no React/React Native imports.
 */

import type { WatchHomeSlide } from "./carouselSequence"

/** Dwell for image/mux insert slides before auto-advancing (web parity: 7s). */
export const WATCH_HOME_IMAGE_SLIDE_DWELL_MS = 7000

/**
 * Stuck-slide guard: a video slide that has not reached "playing" within this
 * budget is skipped. Playing slides are exempt — PLAY_TO_END advances them.
 */
export const WATCH_HOME_MAX_DWELL_MS = 20000

export type PagerSuspendReason = "blur" | "scroll"

/**
 * Reveal state for the ACTIVE slide. "poster" paints immediately on every
 * slide change; "playing" is what hides the poster over the VideoView (the
 * handoff rule: the incoming slide's poster stays visible during
 * replaceAsync).
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
   * A swap was interrupted (slide changed mid-swap, or suspended with one in
   * flight, or a stream resolved while suspended). The component re-issues it
   * when shouldReissueSwap turns true.
   */
  pendingSwap: boolean
  suspended: PagerSuspendReason | null
  /** Slides the pager has left, fed back into queue rebuilds on wrap. */
  playedIds: ReadonlySet<string>
  /** Times the queue wrapped past its end back to index 0. */
  wrapCount: number
}

export type PagerEvent =
  | { type: "SLIDES_SET"; slides: readonly WatchHomeSlide[] }
  /** Swipe momentum settled on an index. */
  | { type: "SLIDE_SHOWN"; index: number }
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
    suspended: null,
    playedIds: new Set<string>(),
    wrapCount: 0,
  }
}

// ── Derived state (what the component reads) ────────────────────────────────

/** Chips and dots render only for multi-slide queues (AE2). */
export function showsPagerChrome(state: PagerState): boolean {
  return state.slides.length > 1
}

/**
 * Whether the component should keep its auto-advance timers (image dwell,
 * max dwell) armed. Suspension and single-slide queues stop them.
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

function withPlayed(
  playedIds: ReadonlySet<string>,
  id: string | undefined,
): ReadonlySet<string> {
  if (!id || playedIds.has(id)) return playedIds
  const next = new Set(playedIds)
  next.add(id)
  return next
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
    playedIds: withPlayed(state.playedIds, activeSlide(state)?.id),
    // A move during an in-flight swap can't cancel the native replaceAsync;
    // it records a pending swap for the new slide instead.
    pendingSwap: state.pendingSwap || state.swapInFlight,
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
    wrapCount: wrapped ? state.wrapCount + 1 : state.wrapCount,
    phase: "poster",
    playedIds: withPlayed(state.playedIds, activeSlide(state)?.id),
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
      }

    case "SLIDE_SHOWN":
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
        // Skip-on-error waits for resume; just settle back on the poster.
        return cleared.phase === "poster"
          ? cleared
          : { ...cleared, phase: "poster" }
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
      return state.phase === "playing" ? state : advance(state)

    case "SUSPEND":
      return suspend(state, event.reason)

    case "RESUME":
      return state.suspended === null ? state : { ...state, suspended: null }
  }
}
