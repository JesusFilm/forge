import {
  ACTION_ROW_PILLS,
  GLIDE_TOP_EPSILON,
  initialGlideState,
  onGlideSettled,
  onPillBlur,
  onPillFocus,
  type GlideState,
} from "./actionRowScrollGlide"

const scrolled = { settledY: 800, liveY: 800 }

describe("onPillFocus", () => {
  it("starts a glide from the settled offset when focus enters a scrolled page", () => {
    const { state, action } = onPillFocus(initialGlideState, "play", scrolled)
    expect(action).toEqual({ kind: "start", fromY: 800 })
    expect(state).toEqual({ focusedPill: "play", gliding: true })
  })

  it("does nothing when the page is already at the top", () => {
    const { state, action } = onPillFocus(initialGlideState, "play", {
      settledY: 0,
      liveY: 0,
    })
    expect(action).toEqual({ kind: "none" })
    expect(state.gliding).toBe(false)
    // Focus is still recorded — a later blur must be able to identify this pill.
    expect(state.focusedPill).toBe("play")
  })

  it("treats a sub-epsilon offset as already at the top", () => {
    const { action } = onPillFocus(initialGlideState, "play", {
      settledY: GLIDE_TOP_EPSILON,
      liveY: GLIDE_TOP_EPSILON,
    })
    expect(action).toEqual({ kind: "none" })
  })

  it("restarts from the LIVE animated value while gliding, not the lagging onScroll mirror", () => {
    // Mid-glide the page is really at 300, but onScroll's throttled echo still
    // reports 500. Seeding from 500 would jerk the page back down 200px.
    const gliding: GlideState = { focusedPill: "play", gliding: true }
    const { action } = onPillFocus(gliding, "language", {
      settledY: 500,
      liveY: 300,
    })
    expect(action).toEqual({ kind: "start", fromY: 300 })
  })

  it("uses the settled offset when NOT gliding, since the animated value is stale then", () => {
    // After a completed glide the animated value rests at 0 while the user may
    // have scrolled away; only onScroll knows where the page actually is.
    const idle: GlideState = { focusedPill: null, gliding: false }
    const { action } = onPillFocus(idle, "play", { settledY: 640, liveY: 0 })
    expect(action).toEqual({ kind: "start", fromY: 640 })
  })
})

describe("onPillBlur", () => {
  it("cancels the glide when the blurring pill is the one on record", () => {
    const focused: GlideState = { focusedPill: "play", gliding: true }
    const { state, action } = onPillBlur(focused, "play")
    expect(action).toEqual({ kind: "cancel" })
    expect(state).toEqual({ focusedPill: null, gliding: false })
  })

  it("ignores the trailing blur of a within-row hop", () => {
    // tvOS fires the NEW pill's focus BEFORE the old pill's blur. By the time
    // blur("play") lands, focus("language") has already restarted the glide —
    // cancelling here would strand the page mid-scroll.
    const afterHop: GlideState = { focusedPill: "language", gliding: true }
    const { state, action } = onPillBlur(afterHop, "play")
    expect(action).toEqual({ kind: "none" })
    expect(state).toEqual(afterHop)
  })
})

describe("focus/blur orderings end to end", () => {
  it("survives the full within-row hop sequence with the glide still running", () => {
    // Below the fold, UP into the row, then RIGHT mid-glide.
    let s = initialGlideState
    const focus = onPillFocus(s, "play", scrolled)
    s = focus.state
    expect(focus.action).toEqual({ kind: "start", fromY: 800 })

    // RIGHT: focus lands first...
    const hopFocus = onPillFocus(s, "language", { settledY: 700, liveY: 420 })
    s = hopFocus.state
    expect(hopFocus.action).toEqual({ kind: "start", fromY: 420 })

    // ...then the stale blur arrives and must NOT cancel.
    const hopBlur = onPillBlur(s, "play")
    expect(hopBlur.action).toEqual({ kind: "none" })
    expect(hopBlur.state.gliding).toBe(true)
  })

  it("cancels when focus genuinely leaves the row", () => {
    // DOWN out of the row: the focused pill blurs with no replacement focus.
    let s = initialGlideState
    s = onPillFocus(s, "play", scrolled).state
    const out = onPillBlur(s, "play")
    expect(out.action).toEqual({ kind: "cancel" })
    expect(out.state.focusedPill).toBeNull()
  })

  it("clears the gliding flag once the timing settles", () => {
    const s = onPillFocus(initialGlideState, "play", scrolled).state
    expect(onGlideSettled(s)).toEqual({ focusedPill: "play", gliding: false })
  })
})

describe("ACTION_ROW_PILLS", () => {
  it("has no duplicates", () => {
    expect(new Set(ACTION_ROW_PILLS).size).toBe(ACTION_ROW_PILLS.length)
  })
})
