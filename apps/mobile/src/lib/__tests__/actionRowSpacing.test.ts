import {
  ACTION_ROW_SPACERS,
  actionRowSpacerWidths,
  type ActionRowSpacerWidths,
} from "../actionRowSpacing"

// Fixtures use the iPhone 17 geometry the extremes were designed against:
// row inner width 378 → roomy column 243, compact column 285, release 42.
const ROW = 378

function released(s: ActionRowSpacerWidths): number {
  const roomy = ACTION_ROW_SPACERS.roomy
  return (
    roomy.dividerIcon -
    s.dividerIcon +
    (roomy.betweenIcons - s.betweenIcons) +
    (roomy.iconEdge - s.iconEdge)
  )
}

describe("actionRowSpacerWidths", () => {
  it("defaults to the roomy extremes before any measurement lands", () => {
    expect(
      actionRowSpacerWidths({
        rowInnerWidth: null,
        langNatural: null,
        subNatural: null,
      }),
    ).toEqual(ACTION_ROW_SPACERS.roomy)
    expect(
      actionRowSpacerWidths({
        rowInnerWidth: ROW,
        langNatural: 150,
        subNatural: null,
      }),
    ).toEqual(ACTION_ROW_SPACERS.roomy)
  })

  it("stays roomy when both pills fit on one line", () => {
    expect(
      actionRowSpacerWidths({
        rowInnerWidth: ROW,
        langNatural: 120,
        subNatural: 80,
      }),
    ).toEqual(ACTION_ROW_SPACERS.roomy)
  })

  it("stays roomy when short pills wrap either way (Cantonese case)", () => {
    // One line needs 314 > compact column 285, and each line fits the roomy
    // column — compression buys the pills nothing.
    expect(
      actionRowSpacerWidths({
        rowInnerWidth: ROW,
        langNatural: 153,
        subNatural: 153,
      }),
    ).toEqual(ACTION_ROW_SPACERS.roomy)
  })

  it("releases exactly the clamped name's deficit (scalar, not binary)", () => {
    // Natural 253 exceeds the roomy column 243 by 10 → release 10 of 42.
    const s = actionRowSpacerWidths({
      rowInnerWidth: ROW,
      langNatural: 253,
      subNatural: 60,
    })
    expect(released(s)).toBeCloseTo(10, 6)
    // Each gap gives up its proportional share of the 10pt.
    expect(s.dividerIcon).toBeCloseTo(21 - (10 * 13) / 42, 6)
    expect(s.betweenIcons).toBeCloseTo(16 - (10 * 16) / 42, 6)
    expect(s.iconEdge).toBeCloseTo(13 - (10 * 13) / 42, 6)
  })

  it("releases exactly the un-wrap deficit when one line becomes possible", () => {
    // One line needs 264: 21 over the roomy column → release half of 42.
    const s = actionRowSpacerWidths({
      rowInnerWidth: ROW,
      langNatural: 163,
      subNatural: 93,
    })
    expect(released(s)).toBeCloseTo(21, 6)
    expect(s.dividerIcon).toBeCloseTo(14.5, 6)
    expect(s.betweenIcons).toBeCloseTo(8, 6)
    expect(s.iconEdge).toBeCloseTo(6.5, 6)
  })

  it("gives no un-wrap release when even full compression cannot fit one line", () => {
    // One line needs 286 (> compact column 285); each pill fits the roomy
    // column alone → wrapped either way → roomy.
    expect(
      actionRowSpacerWidths({
        rowInnerWidth: ROW,
        langNatural: 160,
        subNatural: 118,
      }),
    ).toEqual(ACTION_ROW_SPACERS.roomy)
  })

  it("saturates at the compact floor once the deficit consumes the release", () => {
    // Natural 293 exceeds the roomy column by 50 > 42 → floor.
    const s = actionRowSpacerWidths({
      rowInnerWidth: ROW,
      langNatural: 293,
      subNatural: 60,
    })
    expect(s).toEqual(ACTION_ROW_SPACERS.compact)
  })

  it("holds released == min(deficit, 42) across a deficit sweep", () => {
    // The whitespace the cluster gives up always equals what the clamped
    // name can use, until the floor.
    for (const over of [1, 5, 13, 21, 34, 42, 60, 100]) {
      const s = actionRowSpacerWidths({
        rowInnerWidth: ROW,
        langNatural: 243 + over,
        subNatural: 40,
      })
      expect(released(s)).toBeCloseTo(Math.min(over, 42), 6)
    }
  })

  it("keeps the compact floor equal to the shipped compact spacing", () => {
    // The floor the cluster compresses to is the 2026-08-18 compact layout;
    // retuning must stay deliberate.
    expect(ACTION_ROW_SPACERS.compact).toEqual({
      dividerIcon: 8,
      betweenIcons: 0,
      iconEdge: 0,
    })
  })
})
