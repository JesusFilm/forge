import {
  ACTION_ROW_DIVIDER_BLOCK,
  ACTION_ROW_ICONS_WIDTH,
  ACTION_ROW_PILL_GAP,
  ACTION_ROW_SPACERS,
  DIVIDER_MARGIN_LEFT,
  DIVIDER_WIDTH,
  ICON_BUTTON_COUNT,
  ICON_BUTTON_WIDTH,
  ICON_HIT_SLOP_MAX,
  ROW_PADDING_H,
  ROW_PADDING_LEFT,
  ROW_PADDING_RIGHT,
  actionRowSpacerWidths,
  iconInnerSlop,
  type ActionRowSpacerWidths,
} from "../actionRowSpacing"

declare const __dirname: string

describe("the rendered row consumes the model's geometry", () => {
  const dirName = __dirname
  // Asserting the module against its own definitions is tautological: it
  // cannot see whether ActionButtonRow still hardcodes the widths the model
  // claims to describe. Pin the CONSUMPTION, since that drift is the bug.
  const nodeRequire = require as unknown as (m: string) => {
    readFileSync: (p: string, e: string) => string
    join: (...p: string[]) => string
  }
  const fs = nodeRequire("node:fs")
  const path = nodeRequire("node:path")
  const ROW = fs.readFileSync(
    path.join(
      dirName,
      "..",
      "..",
      "components",
      "watch",
      "ActionButtonRow.tsx",
    ),
    "utf8",
  )

  it("builds the stylesheet from the exported constants", () => {
    expect(ROW).toContain("width: ICON_BUTTON_WIDTH")
    expect(ROW).toContain("paddingLeft: ROW_PADDING_LEFT")
    expect(ROW).toContain("paddingRight: ROW_PADDING_RIGHT")
    expect(ROW).toContain("marginLeft: DIVIDER_MARGIN_LEFT")
    expect(ROW).toContain("width: DIVIDER_WIDTH")
    expect(ROW).toContain("columnGap: ACTION_ROW_PILL_GAP")
  })

  it("measures the row with the model's own padding total", () => {
    expect(ROW).toContain("e.nativeEvent.layout.width - ROW_PADDING_H")
  })

  it("routes the inner hit slop through iconInnerSlop", () => {
    expect(ROW).toContain("iconInnerSlop(spacers.betweenIcons)")
  })
})

describe("geometry is derived, not re-declared", () => {
  // The model used to hardcode 68/17/24 while the real widths lived in
  // ActionButtonRow's StyleSheet. Assert the RELATIONSHIP so a button resize
  // moves both halves together instead of silently mis-sizing the column.
  it("derives the cluster widths from the button geometry", () => {
    expect(ACTION_ROW_ICONS_WIDTH).toBe(ICON_BUTTON_WIDTH * ICON_BUTTON_COUNT)
    expect(ACTION_ROW_DIVIDER_BLOCK).toBe(DIVIDER_MARGIN_LEFT + DIVIDER_WIDTH)
    expect(ROW_PADDING_H).toBe(ROW_PADDING_LEFT + ROW_PADDING_RIGHT)
    expect(ACTION_ROW_PILL_GAP).toBeGreaterThan(0)
  })
})

describe("iconInnerSlop keeps the two tap targets disjoint", () => {
  it("gives up all inner slop when the buttons are flush", () => {
    // At the compact floor an unconditional 5pt let the later Share Pressable
    // claim the visible right edge of Download and fire the wrong action.
    expect(iconInnerSlop(ACTION_ROW_SPACERS.compact.betweenIcons)).toBe(0)
  })

  it("never claims more than half the gap", () => {
    for (const gap of [0, 1, 4, 8, 10, 16, 40]) {
      expect(iconInnerSlop(gap) * 2).toBeLessThanOrEqual(Math.max(gap, 0))
    }
  })

  it("uses the full slop once the gap can afford it", () => {
    expect(iconInnerSlop(ACTION_ROW_SPACERS.roomy.betweenIcons)).toBe(
      ICON_HIT_SLOP_MAX,
    )
  })

  it("is inert on non-finite input", () => {
    expect(iconInnerSlop(Number.NaN)).toBe(0)
  })
})

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
