// Pure decision layer for the watch action row's scroll-to-top glide. Kept
// React-free and colocated so the focus-ordering contract is unit-testable
// without a render harness — apps/tv has none by convention (same rationale as
// panelState.ts / videoBackdropGate.ts).
//
// The contract this encodes exists because of ONE tvOS ordering fact: on a
// within-row hop, the NEW pill's onFocus fires BEFORE the old pill's onBlur. A
// bare "blur cancels the glide" rule therefore lets the outgoing pill kill the
// glide the incoming pill just started, stranding the page mid-scroll.

export const ACTION_ROW_PILLS = [
  "play",
  "language",
  "subtitles",
  "share",
] as const

export type ActionRowPill = (typeof ACTION_ROW_PILLS)[number]

export const GLIDE_DURATION_MS = 650

// Sub-pixel offsets read as "already at the top": gliding from one is invisible,
// and starting it would re-run the timing on every within-row hop at the top.
export const GLIDE_TOP_EPSILON = 1

export type GlideState = {
  /** Last pill to receive focus; null once focus has left the row. */
  focusedPill: ActionRowPill | null
  /** True while a glide is in flight (drives which offset a restart trusts). */
  gliding: boolean
}

export const initialGlideState: GlideState = {
  focusedPill: null,
  gliding: false,
}

export type GlideAction =
  | { kind: "start"; fromY: number }
  | { kind: "cancel" }
  | { kind: "none" }

export type GlideOffsets = {
  /** Offset echoed back from native via onScroll — throttled, so it LAGS. */
  settledY: number
  /** The animation's own current value; authoritative while gliding. */
  liveY: number
}

/**
 * A pill took focus. Starts a glide unless the page is already at the top.
 *
 * Offset choice is the subtle part: `settledY` arrives through onScroll under
 * scrollEventThrottle and therefore trails the running animation, always on the
 * high side (the glide runs toward 0). Seeding a restart from it writes the page
 * back DOWN before resuming, a visible backward hitch on every mid-glide hop —
 * so while gliding we trust `liveY` instead.
 */
export function onPillFocus(
  state: GlideState,
  pill: ActionRowPill,
  offsets: GlideOffsets,
): { state: GlideState; action: GlideAction } {
  const fromY = state.gliding ? offsets.liveY : offsets.settledY

  if (fromY <= GLIDE_TOP_EPSILON) {
    return {
      state: { focusedPill: pill, gliding: false },
      action: { kind: "none" },
    }
  }

  return {
    state: { focusedPill: pill, gliding: true },
    action: { kind: "start", fromY },
  }
}

/**
 * A pill lost focus. Cancels the glide ONLY when that pill is still the one on
 * record — otherwise this is the trailing blur of a within-row hop whose new
 * focus has already been handled, and cancelling would undo it.
 */
export function onPillBlur(
  state: GlideState,
  pill: ActionRowPill,
): { state: GlideState; action: GlideAction } {
  if (state.focusedPill !== pill) return { state, action: { kind: "none" } }
  return {
    state: { focusedPill: null, gliding: false },
    action: { kind: "cancel" },
  }
}

/** The glide ran to completion (as opposed to being cancelled). */
export function onGlideSettled(state: GlideState): GlideState {
  return { ...state, gliding: false }
}
