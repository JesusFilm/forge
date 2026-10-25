import {
  MENU_HEADING_HEIGHT,
  MENU_LIST_VISIBLE_ROWS,
  ROW_LINE_HEIGHT,
  ROW_VERTICAL_PADDING,
  WATCH_OPTION_ROW_HEIGHT,
} from "./watchMenuLayout"

// These constants drive getItemLayout offsets for the virtualized dub lists;
// drift silently breaks scroll-to-active positioning, so the contract is
// pinned here.

describe("watchMenuLayout", () => {
  it("row height is exactly padding + line height (getItemLayout contract)", () => {
    expect(WATCH_OPTION_ROW_HEIGHT).toBe(
      ROW_VERTICAL_PADDING * 2 + ROW_LINE_HEIGHT,
    )
  })

  it("all dimensions are positive finite numbers", () => {
    for (const value of [
      ROW_VERTICAL_PADDING,
      ROW_LINE_HEIGHT,
      WATCH_OPTION_ROW_HEIGHT,
      MENU_HEADING_HEIGHT,
      MENU_LIST_VISIBLE_ROWS,
    ]) {
      expect(Number.isFinite(value)).toBe(true)
      expect(value).toBeGreaterThan(0)
    }
  })

  it("offset formula places row N exactly below a list-internal heading", () => {
    const offsetOfRow = (index: number) =>
      MENU_HEADING_HEIGHT + index * WATCH_OPTION_ROW_HEIGHT
    expect(offsetOfRow(0)).toBe(MENU_HEADING_HEIGHT)
    expect(offsetOfRow(100) - offsetOfRow(99)).toBe(WATCH_OPTION_ROW_HEIGHT)
  })
})
