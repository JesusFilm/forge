// The reader's chrome heights (feat-553 KTD11). The mini player (U13) reads
// the same numbers, so these cases pin the values and the band arithmetic.
import {
  READER_CHROME_HEIGHTS,
  READER_FOOTER_ROWS,
  READER_SCRUBBER_BAND,
  READER_SCRUBBER_TRACK_CENTER,
  READER_SELECTION_GAP,
  READER_TOP_BAR_HEIGHT,
  READER_TOUCH_TARGET,
  readerBottomInset,
  readerChromeBand,
  readerFooterHeight,
  readerMovementBandHeight,
} from "../chrome"

describe("reader chrome heights", () => {
  it("fits a 44-point control row in the top bar (R36)", () => {
    expect(READER_TOUCH_TARGET).toBe(44)
    expect(READER_TOP_BAR_HEIGHT).toBeGreaterThanOrEqual(READER_TOUCH_TARGET)
  })

  it("keeps room in the footer for the selection bar's buttons (R19, R36)", () => {
    // The bar takes the footer's place: reference, gap, and a 44-point row.
    const selection =
      READER_FOOTER_ROWS.paddingTop +
      READER_FOOTER_ROWS.heading +
      READER_SELECTION_GAP +
      READER_TOUCH_TARGET +
      READER_FOOTER_ROWS.paddingBottom
    expect(readerFooterHeight()).toBe(selection)
    expect(readerFooterHeight()).toBeGreaterThanOrEqual(
      READER_FOOTER_ROWS.paddingTop +
        READER_FOOTER_ROWS.heading +
        READER_FOOTER_ROWS.progress +
        READER_FOOTER_ROWS.credit +
        READER_FOOTER_ROWS.paddingBottom,
    )
  })

  it("has no translation row: the translation pill is in the top bar (owner, 2026-09-27)", () => {
    expect(Object.keys(READER_FOOTER_ROWS)).not.toContain("translation")
    expect(readerFooterHeight()).toBe(86)
  })

  it("exposes one shared constant for the top bar and the footer", () => {
    expect(READER_CHROME_HEIGHTS).toEqual({
      topBar: READER_TOP_BAR_HEIGHT,
      footer: readerFooterHeight(),
    })
    expect(Object.isFrozen(READER_CHROME_HEIGHTS)).toBe(true)
  })

  it("gives the scrubber a full touch target above the credit (U9, R36)", () => {
    // The band runs from the footer's top edge to the progress row's bottom,
    // so the thumb's target never covers the row below.
    expect(READER_SCRUBBER_BAND).toBe(
      READER_FOOTER_ROWS.paddingTop +
        READER_FOOTER_ROWS.heading +
        READER_FOOTER_ROWS.progress,
    )
    expect(READER_SCRUBBER_BAND).toBeGreaterThanOrEqual(READER_TOUCH_TARGET)
    expect(READER_SCRUBBER_TRACK_CENTER).toBe(
      READER_SCRUBBER_BAND - READER_FOOTER_ROWS.progress / 2,
    )
  })
})

describe("readerBottomInset", () => {
  it("clears the home indicator on the pushed reader", () => {
    expect(readerBottomInset("pushed", "ios", 34)).toBe(34)
    expect(readerBottomInset("pushed", "android", 24)).toBe(24)
  })

  it("keeps the iOS tab inset, which already holds the native tab bar", () => {
    expect(readerBottomInset("tab", "ios", 83)).toBe(83)
  })

  it("takes no inset on the Android tab, whose bar sits below the screen", () => {
    expect(readerBottomInset("tab", "android", 24)).toBe(0)
  })
})

describe("readerChromeBand", () => {
  it("runs from under the top bar to over the footer", () => {
    expect(
      readerChromeBand({
        safeAreaTop: 62,
        bottomInset: 34,
        containerHeight: 956,
      }),
    ).toEqual({
      top: 62 + READER_TOP_BAR_HEIGHT,
      bottom: 956 - 34 - readerFooterHeight(),
    })
  })
})

describe("readerMovementBandHeight (U8, KTD16)", () => {
  it("reserves a full touch-target row for the arrows and a row for the hint", () => {
    const arrows = readerMovementBandHeight({ arrows: true, hint: false })
    const hint = readerMovementBandHeight({ arrows: false, hint: true })
    expect(readerMovementBandHeight({ arrows: false, hint: false })).toBe(0)
    expect(arrows).toBeGreaterThanOrEqual(READER_TOUCH_TARGET)
    expect(hint).toBeGreaterThan(0)
    expect(readerMovementBandHeight({ arrows: true, hint: true })).toBe(
      arrows + hint,
    )
  })
})
