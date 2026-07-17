import {
  deepScrimOpacity,
  isTopBarHidden,
  resolveBrowseState,
  resolveRowScrollTarget,
  ROW_ANCHOR_OFFSET,
} from "./homeScrollState"

describe("resolveBrowseState", () => {
  it("maps chrome focus (null row) to top", () => {
    expect(resolveBrowseState(null)).toBe("top")
  })

  it("maps the featured rail (row 0) to browse", () => {
    expect(resolveBrowseState(0)).toBe("browse")
  })

  it("maps every deeper row to deep", () => {
    expect(resolveBrowseState(1)).toBe("deep")
    expect(resolveBrowseState(2)).toBe("deep")
    expect(resolveBrowseState(7)).toBe("deep")
  })
})

describe("resolveRowScrollTarget", () => {
  const rowLayoutYs = [116, 700, 1124, 1548]

  it("anchors the featured rail (row 0) up to reveal it from its peek", () => {
    expect(
      resolveRowScrollTarget({
        rowIndex: 0,
        rowLayoutYs: [840, 1170],
        anchorOffset: 120,
      }),
    ).toBe(720)
  })

  it("anchors a deep row at its layout y minus the anchor offset", () => {
    expect(
      resolveRowScrollTarget({ rowIndex: 1, rowLayoutYs, anchorOffset: 120 }),
    ).toBe(580)
    expect(
      resolveRowScrollTarget({ rowIndex: 3, rowLayoutYs, anchorOffset: 120 }),
    ).toBe(1428)
  })

  it("clamps the target at 0 when the row sits above the anchor", () => {
    expect(
      resolveRowScrollTarget({
        rowIndex: 1,
        rowLayoutYs: [0, 80],
        anchorOffset: 120,
      }),
    ).toBe(0)
  })

  it("returns null for a row whose layout has not been measured", () => {
    expect(
      resolveRowScrollTarget({
        rowIndex: 2,
        rowLayoutYs: [116, 700],
        anchorOffset: 120,
      }),
    ).toBeNull()
    expect(
      resolveRowScrollTarget({
        rowIndex: 1,
        rowLayoutYs: [],
        anchorOffset: 120,
      }),
    ).toBeNull()
  })

  it("uses the exported design anchor by default at call sites", () => {
    // Sanity-pin the design constant: an accidental edit here silently
    // shifts every anchored row.
    expect(ROW_ANCHOR_OFFSET).toBe(120)
  })
})

describe("deepScrimOpacity", () => {
  it("is invisible on chrome", () => {
    expect(deepScrimOpacity("top")).toBe(0)
  })

  it("is a light wash while browsing row 0", () => {
    expect(deepScrimOpacity("browse")).toBe(0.22)
  })

  it("is fully on deep in the feed", () => {
    expect(deepScrimOpacity("deep")).toBe(1)
  })
})

describe("isTopBarHidden", () => {
  it("hides only in the deep state", () => {
    expect(isTopBarHidden("top")).toBe(false)
    expect(isTopBarHidden("browse")).toBe(false)
    expect(isTopBarHidden("deep")).toBe(true)
  })
})
