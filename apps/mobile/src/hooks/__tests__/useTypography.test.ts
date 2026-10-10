import { LINE_HEIGHT_REDUCTION } from "../../lib/lineHeight"
import { computeTypographyScale } from "../useTypography"

// [token, fontSize, lineHeight] as rendered. The line heights are the scaled
// base values minus LINE_HEIGHT_REDUCTION, written out so a revert fails here.
type Row = [string, number, number]

function flatten(width: number): Row[] {
  const { headingScale, ...base } = computeTypographyScale(width)
  return [...Object.entries(base), ...Object.entries(headingScale)].map(
    ([name, token]) => [name, token.fontSize, token.lineHeight] as Row,
  )
}

describe("computeTypographyScale", () => {
  it("takes 2 points off every line height", () => {
    expect(LINE_HEIGHT_REDUCTION).toBe(2)
  })

  it("renders the base scale, minus the reduction, on a 375pt screen", () => {
    expect(flatten(375)).toEqual([
      ["caption", 12, 14],
      ["bodySmall", 14, 18],
      ["body", 16, 22],
      ["titleSmall", 18, 22],
      ["titleLarge", 22, 26],
      ["heading", 24, 30],
      ["display", 56, 66],
      ["h1", 32, 38],
      ["h2", 28, 34],
      ["h3", 24, 30],
      ["h4", 20, 26],
      ["h5", 18, 22],
      ["h6", 16, 20],
    ])
  })

  // 440pt (iPhone 17 Pro Max) clamps to 1.15x. The reduction applies after the
  // rounding, so each line is exactly 2 points tighter than the scaled base.
  it("takes the reduction off after scaling on a 440pt screen", () => {
    expect(flatten(440)).toEqual([
      ["caption", 14, 16],
      ["bodySmall", 16, 21],
      ["body", 18, 26],
      ["titleSmall", 21, 26],
      ["titleLarge", 25, 30],
      ["heading", 28, 35],
      ["display", 64, 76],
      ["h1", 37, 44],
      ["h2", 32, 39],
      ["h3", 28, 35],
      ["h4", 23, 30],
      ["h5", 21, 26],
      ["h6", 18, 23],
    ])
  })
})
