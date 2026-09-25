/**
 * The quote card's drop order for the "Read full passage" button (feat-551
 * R1, KTD17): to make room, the card shortens the verse, never the button.
 * The renderer suite pins the rendered result at one device; this suite pins
 * the rule across the geometry the app supports.
 */

import {
  CARD_CONTENT_PADDING,
  fitPassageCardRegions,
  passageCardStackHeight,
  type PassageCardFitInput,
} from "../bibleCardFit"
import { computeTypographyScale } from "../../hooks/useTypography"

/** The watch card is the screen width less its 16 pt side gutters. */
function cardInput(
  screenWidth: number,
  fontScale: number,
  overrides: Partial<PassageCardFitInput> = {},
): PassageCardFitInput {
  const cardWidth = Math.round(screenWidth - 32)
  return {
    contentHeight: cardWidth - CARD_CONTENT_PADDING * 2,
    typography: computeTypographyScale(screenWidth),
    fontScale,
    hasVerse: true,
    hasTranslation: true,
    hasCopyright: true,
    hasLink: true,
    ...overrides,
  }
}

// iPhone SE to iPhone Pro Max, and the common Android widths. 411.43 dp is
// the Pixel 9a: 1080 px at density 2.625.
const SUPPORTED_WIDTHS = [
  320, 360, 375, 390, 393, 402, 411.43, 412, 414, 428, 430, 440,
]
// iOS runs to AX5 (3.12). The Pixel 9a caps its system text size at 2.0.
const SUPPORTED_FONT_SCALES = [1, 1.15, 1.3, 1.35, 1.64, 2, 2.35, 2.76, 3.12]

describe("fitPassageCardRegions — the reader button", () => {
  // Covers R1 at the design-centre Android device. The old order dropped the
  // button here and kept four verse lines.
  it("keeps the button and shortens the verse at the Pixel 9a's 1.3 text scale", () => {
    expect(fitPassageCardRegions(cardInput(411.43, 1.3))).toEqual({
      verseLines: 3,
      translation: true,
      copyright: true,
      link: true,
    })
  })

  it("keeps the button at every supported width and text size", () => {
    let checked = 0
    for (const width of SUPPORTED_WIDTHS) {
      for (const fontScale of SUPPORTED_FONT_SCALES) {
        const input = cardInput(width, fontScale)
        const regions = fitPassageCardRegions(input)
        expect({ width, fontScale, link: regions.link }).toEqual({
          width,
          fontScale,
          link: true,
        })
        expect(passageCardStackHeight(input, regions)).toBeLessThanOrEqual(
          input.contentHeight,
        )
        checked += 1
      }
    }
    // Anti-vacuous: the sweep really ran.
    expect(checked).toBe(SUPPORTED_WIDTHS.length * SUPPORTED_FONT_SCALES.length)
  })

  // The order itself, over the whole reachable space: whenever the button
  // goes, the verse and both credit lines have already gone.
  it("drops every other optional region before the button", () => {
    const typography = computeTypographyScale(375)
    for (let contentHeight = 40; contentHeight <= 600; contentHeight += 5) {
      for (const fontScale of [1, 1.3, 1.5, 2, 2.5, 3, 3.5]) {
        const regions = fitPassageCardRegions({
          contentHeight,
          typography,
          fontScale,
          hasVerse: true,
          hasTranslation: true,
          hasCopyright: true,
          hasLink: true,
        })
        if (!regions.link) {
          expect(regions).toEqual({
            verseLines: 0,
            translation: false,
            copyright: false,
            link: false,
          })
        }
      }
    }
  })

  it("never keeps a verse line that the button needed", () => {
    // One more verse line than the fit chose would overflow with the button in.
    for (const width of SUPPORTED_WIDTHS) {
      for (const fontScale of SUPPORTED_FONT_SCALES) {
        const input = cardInput(width, fontScale)
        const regions = fitPassageCardRegions(input)
        if (regions.verseLines === 0 || regions.verseLines === 4) continue
        const longer = { ...regions, verseLines: regions.verseLines + 1 }
        expect(passageCardStackHeight(input, longer)).toBeGreaterThan(
          input.contentHeight,
        )
      }
    }
  })

  // SYNTHETIC: no geometry in SUPPORTED_WIDTHS x SUPPORTED_FONT_SCALES reaches
  // this; the sweep above proves it. When the reference and the button alone
  // overflow, the reference stays, so the clip cannot take it off the top.
  it("drops the button only when the reference and the button alone overflow", () => {
    const tiny = fitPassageCardRegions({
      ...cardInput(375, 2),
      contentHeight: 90,
    })

    expect(tiny).toEqual({
      verseLines: 0,
      translation: false,
      copyright: false,
      link: false,
    })
  })
})
