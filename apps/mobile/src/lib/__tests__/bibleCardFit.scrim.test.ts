/**
 * Direct coverage for the scrim geometry the Bible quote card derives from the
 * fit arithmetic. The renderer suite asserts the RENDERED stop, which cannot
 * reach the degenerate-input branch — a card always has a positive width there.
 */

import {
  CARD_CONTENT_PADDING,
  SCRIM_MAX_SOLID_STOP,
  fitPassageCardRegions,
  passageCardStackHeight,
  scrimSolidStop,
} from "../bibleCardFit"
import { computeTypographyScale } from "../../hooks/useTypography"

// The screen width the watch card actually renders at, NOT a scale factor:
// `computeTypographyScale` takes a width, and a small number clamps to the
// minimum type, quietly changing what every expectation below is measuring.
const SCREEN = 390
const CARD = SCREEN - 32

function fitInput(
  overrides: Partial<Parameters<typeof fitPassageCardRegions>[0]> = {},
) {
  return {
    contentHeight: CARD - CARD_CONTENT_PADDING * 2,
    typography: computeTypographyScale(SCREEN),
    fontScale: 1,
    hasVerse: true,
    hasTranslation: true,
    hasCopyright: true,
    hasLink: true,
    ...overrides,
  }
}

describe("scrimSolidStop", () => {
  it("puts the solid stop at the top of the text stack", () => {
    const input = fitInput()
    const stack = passageCardStackHeight(input, fitPassageCardRegions(input))
    const expected = (CARD - CARD_CONTENT_PADDING - stack) / CARD

    expect(scrimSolidStop(CARD, stack)).toBeCloseTo(expected, 10)
  })

  it("never sits lighter than the fixed stop it replaced", () => {
    // A card with almost no text would otherwise push the solid point far down
    // and leave a bright still fighting the reference.
    expect(scrimSolidStop(CARD, 10)).toBe(SCRIM_MAX_SOLID_STOP)
  })

  it("stays above zero when the stack fills the whole card", () => {
    // Gradient stops must increase, so the floor is what keeps the scrim a
    // gradient rather than a rejected pair of identical locations.
    const stop = scrimSolidStop(CARD, CARD * 2)
    expect(stop).toBeGreaterThan(0)
    expect(stop).toBeLessThan(SCRIM_MAX_SOLID_STOP)
  })

  it("falls back to the floor for a card height it cannot divide by", () => {
    // Reached before layout has measured, where a zero or NaN width would
    // otherwise produce Infinity or NaN as a gradient location.
    for (const height of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const stop = scrimSolidStop(height, 100)
      expect(Number.isFinite(stop)).toBe(true)
      expect(stop).toBeGreaterThan(0)
    }
  })
})

describe("passageCardStackHeight", () => {
  it("grows when a region is added", () => {
    const withLink = fitInput()
    const withoutLink = fitInput({ hasLink: false })

    expect(
      passageCardStackHeight(withLink, fitPassageCardRegions(withLink)),
    ).toBeGreaterThan(
      passageCardStackHeight(withoutLink, fitPassageCardRegions(withoutLink)),
    )
  })

  it("never exceeds the card's content box, at any reader text size", () => {
    // The invariant the scrim leans on. A larger reader size does NOT make the
    // stack taller — the fit sheds regions to stay inside the box — so the
    // solid stop can never be pushed off the top of the card.
    for (const fontScale of [1, 1.3, 1.5, 2, 3]) {
      const input = fitInput({ fontScale })
      const stack = passageCardStackHeight(input, fitPassageCardRegions(input))
      expect(stack).toBeLessThanOrEqual(input.contentHeight)
    }
  })

  it("sheds regions rather than overflowing when the text size grows", () => {
    const normal = fitPassageCardRegions(fitInput())
    const huge = fitPassageCardRegions(fitInput({ fontScale: 3 }))

    expect(normal.link).toBe(true)
    // The drop order: the link goes first, then the verse shortens.
    expect(huge.link).toBe(false)
    expect(huge.verseLines).toBeLessThan(normal.verseLines)
  })
})
