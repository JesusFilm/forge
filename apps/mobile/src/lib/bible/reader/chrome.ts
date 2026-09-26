// The reader's chrome heights (feat-553 KTD11, KTD16, R10). This file is the
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

// U9: the scrubber's touch band, from the footer's top edge to the bottom of
// the progress row. The thumb's target fills it, so it is a full 44 points and
// never covers the translation label below.
export const READER_SCRUBBER_BAND =
  READER_FOOTER_ROWS.paddingTop +
  READER_FOOTER_ROWS.heading +
  READER_FOOTER_ROWS.progress

/** The progress track's center, measured down from the band's top. */
export const READER_SCRUBBER_TRACK_CENTER =
  READER_SCRUBBER_BAND - READER_FOOTER_ROWS.progress / 2

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

/** R11: the arrow pair's row above the footer, one control and a gap. */
export const READER_ARROW_ROW_HEIGHT = READER_TOUCH_TARGET + 8

/** R15: the hint's row, one line of text and room for its bounce. */
export const READER_HINT_ROW_HEIGHT = 32

// The band above the footer that the hint and the arrow pair use (U8). The
// verse box ends above it (KTD16), and U13's bottom corners must clear it.
export function readerMovementBandHeight(input: {
  arrows: boolean
  hint: boolean
}): number {
  return (
    (input.arrows ? READER_ARROW_ROW_HEIGHT : 0) +
    (input.hint ? READER_HINT_ROW_HEIGHT : 0)
  )
}

// U13: the band the reader shows now. Both readers compute it from the same
// settings, so one value serves both. The mini player reads it to rest a
// bottom corner above the band; null until a reader has shown.
let liveMovementBand: number | null = null
const movementBandListeners = new Set<() => void>()

export function publishReaderMovementBand(height: number): void {
  if (liveMovementBand === height) return
  liveMovementBand = height
  for (const listener of movementBandListeners) listener()
}

export function getReaderMovementBand(): number | null {
  return liveMovementBand
}

export function subscribeReaderMovementBand(listener: () => void): () => void {
  movementBandListeners.add(listener)
  return () => {
    movementBandListeners.delete(listener)
  }
}

/** Module state outlives a test file; this clears it between cases. */
export function resetReaderMovementBandForTests(): void {
  liveMovementBand = null
  for (const listener of movementBandListeners) listener()
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
