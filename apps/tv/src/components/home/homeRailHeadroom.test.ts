import {
  BASE_ITEM_PADDING,
  HEAD_CARD_GAP,
  focusHeadroomFor,
  railPaddingTopFor,
  railPullUpFor,
} from "./homeRailHeadroom"

// Mirrors HOME_CARD_DIMS (HomeCard.tsx) without importing its JSX graph.
// jest-expo runs as iOS: scale() is identity and the tvOS parallax terms apply.
const LANDSCAPE = { width: 400, thumbHeight: 187.5 }
const PORTRAIT = { width: 260, thumbHeight: 390 }
const TINY = { width: 100, thumbHeight: 50 }

describe("homeRailHeadroom (focus clip geometry)", () => {
  it("pins the design constants", () => {
    expect(BASE_ITEM_PADDING).toBe(24)
    expect(HEAD_CARD_GAP).toBe(32)
  })

  it("pins the worst-case-nudge headroom model for the real card shapes", () => {
    // Static rise + max diagonal parallax (per-effect concatenated
    // perspectives). A drift here means the model or its constants changed —
    // re-verify top-edge clipping in the simulator before accepting.
    expect(focusHeadroomFor(LANDSCAPE)).toBe(36)
    expect(focusHeadroomFor(PORTRAIT)).toBe(53)
  })

  it("headroom grows with card height (the original portrait-only clip)", () => {
    expect(focusHeadroomFor(PORTRAIT)).toBeGreaterThan(
      focusHeadroomFor(LANDSCAPE),
    )
  })

  it("floors the padding at the resting gap for short cards", () => {
    expect(railPaddingTopFor(TINY)).toBe(HEAD_CARD_GAP)
  })

  it("resting-seam invariant: paddingTop + pullUp === HEAD_CARD_GAP", () => {
    for (const dims of [LANDSCAPE, PORTRAIT, TINY]) {
      expect(railPaddingTopFor(dims) + railPullUpFor(dims)).toBe(HEAD_CARD_GAP)
    }
  })
})
