// The reader's chrome heights (feat-551 KTD11). The mini player (U13) reads
// the same numbers, so these cases pin the values and the band arithmetic.
import {
  READER_CHROME_HEIGHTS,
  READER_FOOTER_ROWS,
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

  it("gives the phone footer a credit row that the tablet footer does not have", () => {
    expect(readerFooterHeight("phone") - readerFooterHeight("tablet")).toBe(
      READER_FOOTER_ROWS.credit,
    )
  })

  it("exposes one shared constant for the top bar and both footers", () => {
    expect(READER_CHROME_HEIGHTS).toEqual({
      topBar: READER_TOP_BAR_HEIGHT,
      footer: {
        phone: readerFooterHeight("phone"),
        tablet: readerFooterHeight("tablet"),
      },
    })
    expect(Object.isFrozen(READER_CHROME_HEIGHTS)).toBe(true)
  })

  it("keeps the translation label row a full touch target (R36)", () => {
    expect(READER_FOOTER_ROWS.translation).toBe(READER_TOUCH_TARGET)
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
        layout: "phone",
        safeAreaTop: 62,
        bottomInset: 34,
        containerHeight: 956,
      }),
    ).toEqual({
      top: 62 + READER_TOP_BAR_HEIGHT,
      bottom: 956 - 34 - readerFooterHeight("phone"),
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
