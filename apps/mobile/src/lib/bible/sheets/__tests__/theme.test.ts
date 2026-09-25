/**
 * The reader sheets draw in the reader's theme (feat-551 KTD12, R34, R36).
 * Each pair is scored over the ground it really sits on, in all four token
 * sets, per the composited-contrast rule in KTD12.
 */
import { READER_PALETTES } from "../../settings/snapshot"
import { contrastRatio } from "../../theme/contrast"
import { READER_SCHEMES, readerTokens } from "../../theme/palettes"
import { readerSheetColors, readerSheetControlColors } from "../theme"

const SETS = READER_PALETTES.flatMap((palette) =>
  READER_SCHEMES.map((scheme) => ({
    name: `${palette} ${scheme}`,
    tokens: readerTokens(palette, scheme),
  })),
)

describe.each(SETS)("the $name sheet colors", ({ tokens }) => {
  const colors = readerSheetColors(tokens)
  const controls = readerSheetControlColors(tokens)
  const { background } = tokens

  it("come from the reader's tokens", () => {
    expect(colors).toEqual({
      text: tokens.text,
      secondaryText: tokens.secondaryText,
      accent: tokens.icon,
      surface: tokens.buttonSurface,
    })
  })

  it("keep text readable on the page and on a surface (4.5:1)", () => {
    expect(contrastRatio(colors.text, background)).toBeGreaterThanOrEqual(4.5)
    expect(
      contrastRatio(colors.secondaryText, background),
    ).toBeGreaterThanOrEqual(4.5)
    expect(
      contrastRatio(colors.text, colors.surface, background),
    ).toBeGreaterThanOrEqual(4.5)
    expect(
      contrastRatio(colors.secondaryText, colors.surface, background),
    ).toBeGreaterThanOrEqual(4.5)
  })

  it("keep the checkmark visible on a surface (3:1)", () => {
    expect(
      contrastRatio(colors.accent, colors.surface, background),
    ).toBeGreaterThanOrEqual(3)
  })

  it("keep a chosen option readable (4.5:1)", () => {
    expect(
      contrastRatio(controls.selectedText, controls.selectedFill),
    ).toBeGreaterThanOrEqual(4.5)
    expect(
      contrastRatio(controls.text, controls.fill, background),
    ).toBeGreaterThanOrEqual(4.5)
  })

  it("keep a switch's on track visible on the page (3:1)", () => {
    expect(contrastRatio(controls.switchOn, background)).toBeGreaterThanOrEqual(
      3,
    )
  })
})
