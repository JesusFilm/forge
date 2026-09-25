// The verse area (feat-551 KTD16, R7, R10, KD27). The box is symmetric about
// the screen's vertical center, so a verse centered on the whole screen never
// runs under an obstacle: its half height is the smaller of the two distances.

/** Space between the verse and the nearest obstacle. */
export const VERSE_BOX_GAP = 12

/** KD27: a centered box below this height (about four lines at the default
 *  size) gives way to the free space between the obstacles. */
export const MIN_CENTERED_VERSE_HEIGHT = 160

/** A band that floats over the reader, such as the mini player window. */
export type ObstacleRect = { y: number; height: number }

export type VerseBoxInput = {
  /** The reader's own height; its center is the screen's center. */
  containerHeight: number
  /** The lowest edge of the chrome at the top (the top bar). */
  topChromeBottom: number
  /** The highest edge of the chrome at the bottom (the footer and its band). */
  bottomChromeTop: number
  /** A rect above the center limits the top; any other rect limits the bottom. */
  floating?: readonly ObstacleRect[]
}

export type VerseBox = { top: number; height: number }

export function verseBox(input: VerseBoxInput): VerseBox {
  const center = input.containerHeight / 2
  let topLimit = input.topChromeBottom
  let bottomLimit = input.bottomChromeTop
  for (const rect of input.floating ?? []) {
    if (rect.y + rect.height / 2 < center) {
      topLimit = Math.max(topLimit, rect.y + rect.height)
    } else {
      bottomLimit = Math.min(bottomLimit, rect.y)
    }
  }
  const half = Math.max(
    0,
    Math.min(
      center - (topLimit + VERSE_BOX_GAP),
      bottomLimit - VERSE_BOX_GAP - center,
    ),
  )
  const centered = { top: center - half, height: half * 2 }
  if (centered.height >= MIN_CENTERED_VERSE_HEIGHT) return centered

  // A short screen with a window near its middle (iPhone SE, Bible tab).
  const freeTop = topLimit + VERSE_BOX_GAP
  const freeHeight = bottomLimit - VERSE_BOX_GAP - freeTop
  return freeHeight > centered.height
    ? { top: freeTop, height: freeHeight }
    : centered
}
