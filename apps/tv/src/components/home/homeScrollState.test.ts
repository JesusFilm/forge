import {
  deepScrimOpacity,
  isTopBarHidden,
  resolveBrowseState,
  resolveRowMeasurementEffect,
  resolveRowScrollTarget,
  ROW_ANCHOR_OFFSET,
  trimRowMeasurements,
} from "./homeScrollState"

describe("trimRowMeasurements", () => {
  it("keeps measurements for rows that still exist", () => {
    const ys: (number | undefined)[] = [0, 1200, 1800, 2400]
    trimRowMeasurements(ys, 4)
    expect(ys).toEqual([0, 1200, 1800, 2400])
  })

  it("drops only the rows past the new count", () => {
    const ys: (number | undefined)[] = [0, 1200, 1800, 2400]
    trimRowMeasurements(ys, 2)
    expect(ys).toEqual([0, 1200])
  })

  it("tolerates a zero/negative row count", () => {
    const ys: (number | undefined)[] = [0, 1200]
    trimRowMeasurements(ys, 0)
    expect(ys).toEqual([])
    trimRowMeasurements(ys, -1)
    expect(ys).toEqual([])
  })

  // THE REGRESSION. `sections` is a fresh array on every setModel, so this ran on
  // byte-identical rows; the old `rowYsRef.current = []` then stranded them, since
  // onLayout only re-fires when geometry CHANGES. Focus resolved null forever.
  it("survives a same-shape refetch, so focus can still resolve a scroll target", () => {
    const ys: (number | undefined)[] = [0, 1200, 1800]
    const anchorOffset = 120

    // A refetch lands. Same row count, identical geometry → no onLayout.
    trimRowMeasurements(ys, 3)

    // Down onto the topmost rail must still resolve a target.
    expect(
      resolveRowScrollTarget({ rowIndex: 1, rowLayoutYs: ys, anchorOffset }),
    ).toBe(1080)
  })

  it("a wipe would strand exactly that focus (the bug, stated as a contrast)", () => {
    const wiped: (number | undefined)[] = []
    expect(
      resolveRowScrollTarget({
        rowIndex: 1,
        rowLayoutYs: wiped,
        anchorOffset: 120,
      }),
    ).toBeNull()
  })
})

describe("resolveRowMeasurementEffect", () => {
  const base = {
    rowIndex: 1,
    previousY: 1200,
    nextY: 1200,
    pendingScrollRow: null,
    focusedRow: null,
  }

  it("flushes a deferred scroll for the row that was waiting on a measurement", () => {
    expect(
      resolveRowMeasurementEffect({
        ...base,
        previousY: undefined,
        pendingScrollRow: 1,
      }),
    ).toBe("flush-pending")
  })

  it("re-anchors when the FOCUSED row's y moved under it", () => {
    expect(
      resolveRowMeasurementEffect({ ...base, nextY: 1500, focusedRow: 1 }),
    ).toBe("reanchor")
  })

  it("does nothing when the focused row re-reports the same y", () => {
    expect(resolveRowMeasurementEffect({ ...base, focusedRow: 1 })).toBe("none")
  })

  // Re-scrolling an unfocused row would yank the page away from the viewer.
  it("ignores a moved row that does not hold focus", () => {
    expect(
      resolveRowMeasurementEffect({ ...base, nextY: 1500, focusedRow: 2 }),
    ).toBe("none")
    expect(
      resolveRowMeasurementEffect({ ...base, nextY: 1500, focusedRow: null }),
    ).toBe("none")
  })

  it("prefers the pending flush over a re-anchor", () => {
    expect(
      resolveRowMeasurementEffect({
        ...base,
        nextY: 1500,
        pendingScrollRow: 1,
        focusedRow: 1,
      }),
    ).toBe("flush-pending")
  })
})

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
