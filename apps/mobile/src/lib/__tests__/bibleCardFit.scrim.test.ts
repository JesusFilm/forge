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

const CARD = 358

function fitInput(
  overrides: Partial<Parameters<typeof fitPassageCardRegions>[0]> = {},
) {
  return {
    contentHeight: CARD - CARD_CONTENT_PADDING * 2,
    typography: computeTypographyScale(1),
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

  it("grows with the reader's text size", () => {
    const normal = fitInput()
    const large = fitInput({
      typography: computeTypographyScale(1.5),
      fontScale: 1.5,
    })

    expect(
      passageCardStackHeight(large, fitPassageCardRegions(large)),
    ).toBeGreaterThan(
      passageCardStackHeight(normal, fitPassageCardRegions(normal)),
    )
  })
})
