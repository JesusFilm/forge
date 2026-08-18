import { ACTION_ROW_SPACERS, actionRowSpacingMode } from "../actionRowSpacing"

// Fixtures use the iPhone 17 geometry the modes were designed against:
// row inner width 378 → roomy column 243, compact column 285.
const ROW = 378

describe("actionRowSpacingMode", () => {
  it("defaults to roomy before any measurement lands", () => {
    expect(
      actionRowSpacingMode({
        rowInnerWidth: null,
        langNatural: null,
        subNatural: null,
      }),
    ).toBe("roomy")
    expect(
      actionRowSpacingMode({
        rowInnerWidth: ROW,
        langNatural: 150,
        subNatural: null,
      }),
    ).toBe("roomy")
  })

  it("stays roomy when both pills fit on one line", () => {
    expect(
      actionRowSpacingMode({
        rowInnerWidth: ROW,
        langNatural: 120,
        subNatural: 80,
      }),
    ).toBe("roomy")
  })

  it("stays roomy when short pills wrap either way (Cantonese case)", () => {
    // Two ~153pt pills: one line needs 314 > compact column 285, and each
    // line fits the roomy column — compression buys the pills nothing.
    expect(
      actionRowSpacingMode({
        rowInnerWidth: ROW,
        langNatural: 153,
        subNatural: 153,
      }),
    ).toBe("roomy")
  })

  it("compresses when a long name is clamped at the roomy column", () => {
    // "English, North American Indians" ≈ 293pt natural > roomy column 243.
    expect(
      actionRowSpacingMode({
        rowInnerWidth: ROW,
        langNatural: 293,
        subNatural: 60,
      }),
    ).toBe("compact")
  })

  it("compresses when compact spacing un-wraps the two pills", () => {
    // One line needs 268: over the roomy column 243, within compact 285.
    expect(
      actionRowSpacingMode({
        rowInnerWidth: ROW,
        langNatural: 130,
        subNatural: 130,
      }),
    ).toBe("compact")
  })

  it("treats the column boundaries as exact fits", () => {
    // maxPill exactly at the roomy column: fits, no clamp → roomy. The
    // subtitle width keeps oneLine (311) OUT of the un-wrap window so only
    // the maxPill gate is under test.
    expect(
      actionRowSpacingMode({
        rowInnerWidth: ROW,
        langNatural: 243,
        subNatural: 60,
      }),
    ).toBe("roomy")
    // One line exactly at the compact column: un-wrap benefit → compact.
    expect(
      actionRowSpacingMode({
        rowInnerWidth: ROW,
        langNatural: 152,
        subNatural: 125,
      }),
    ).toBe("compact")
  })

  it("keeps the compact floor equal to the shipped compact spacing", () => {
    // The floor the modes compress to is the 2026-08-18 compact layout;
    // renaming or retuning must stay deliberate.
    expect(ACTION_ROW_SPACERS.compact).toEqual({
      dividerIcon: 8,
      betweenIcons: 0,
      iconEdge: 0,
    })
  })
})
