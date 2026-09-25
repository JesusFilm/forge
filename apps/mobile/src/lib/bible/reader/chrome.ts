// The reader's chrome heights (feat-551 KTD11, KTD16, R10). This file is the
// one source for the top bar and the footer: the verse box reads it, and the
// mini player (U13) reads it to rest every corner between the two.

export type ReaderLayout = "phone" | "tablet"

/** The Bible tab, or the reader pushed over the watch screen (R6). */
export type ReaderHost = "tab" | "pushed"

/** Every reader control is at least this wide and tall (R36). */
export const READER_TOUCH_TARGET = 44

/** The drawn glass circle inside a touch target. */
export const READER_GLASS_SIZE = 40

/** Chrome text stops growing here; the fixed rows below fit this scale. */
export const READER_CHROME_MAX_FONT_SCALE = 1.3

/** The space between the safe-area top and the top bar's row. */
export const READER_TOP_BAR_OFFSET = 4

/** The top bar, measured down from the safe-area top: offset, row, gap. */
export const READER_TOP_BAR_HEIGHT =
  READER_TOP_BAR_OFFSET + READER_TOUCH_TARGET + 8

/** Footer rows in points, top to bottom. */
export const READER_FOOTER_ROWS = Object.freeze({
  paddingTop: 6,
  heading: 24,
  progress: 14,
  translation: READER_TOUCH_TARGET,
  /** Phones only: the tablet puts the credit beside the translation label. */
  credit: 22,
  paddingBottom: 4,
})

/** The footer, measured up from the bottom inset. */
export function readerFooterHeight(layout: ReaderLayout): number {
  const rows = READER_FOOTER_ROWS
  const shared =
    rows.paddingTop +
    rows.heading +
    rows.progress +
    rows.translation +
    rows.paddingBottom
  return layout === "phone" ? shared + rows.credit : shared
}

export const READER_CHROME_HEIGHTS = Object.freeze({
  topBar: READER_TOP_BAR_HEIGHT,
  footer: Object.freeze({
    phone: readerFooterHeight("phone"),
    tablet: readerFooterHeight("tablet"),
  }),
})

// The space under the footer. An iOS tab screen's inset already holds the
// native tab bar; Android's tab bar sits below the screen, so that tab takes
// none. A pushed reader clears the home indicator.
export function readerBottomInset(
  host: ReaderHost,
  platform: string,
  safeAreaBottom: number,
): number {
  if (host === "tab" && platform !== "ios") return 0
  return safeAreaBottom
}

/** The band between the top bar and the footer, in reader coordinates. */
export function readerChromeBand(input: {
  layout: ReaderLayout
  safeAreaTop: number
  bottomInset: number
  containerHeight: number
}): { top: number; bottom: number } {
  return {
    top: input.safeAreaTop + READER_TOP_BAR_HEIGHT,
    bottom:
      input.containerHeight -
      input.bottomInset -
      readerFooterHeight(input.layout),
  }
}
