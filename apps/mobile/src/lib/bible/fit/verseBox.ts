// The verse area (feat-551 KTD16, R7, R10, KD27). The centered box is
// symmetric about the screen's vertical center, so a centered verse never runs
// under an obstacle. The free box is all the room between the obstacles.

/** Space between the verse and the nearest obstacle. */
export const VERSE_BOX_GAP = 12

/** KD27: content the reader does not measure (loading, a message, the gap
 *  note) uses the free box when the centered box is shorter than this. */
export const MIN_CENTERED_AREA_HEIGHT = 160

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

export type VerseBoxes = {
  /** Symmetric about the screen's center (KD9). */
  centered: VerseBox
  /** KD27: the verse moves here only when it would scroll in `centered`. */
  free: VerseBox
}

export function verseBoxes(input: VerseBoxInput): VerseBoxes {
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
  const freeTop = topLimit + VERSE_BOX_GAP
  return {
    centered: { top: center - half, height: half * 2 },
    free: {
      top: freeTop,
      height: Math.max(0, bottomLimit - VERSE_BOX_GAP - freeTop),
    },
  }
}

/** The box for content that is not measured: centered while it is tall
 *  enough, else the free box when that is taller (KD27). */
export function unmeasuredBox(boxes: VerseBoxes): VerseBox {
  const { centered, free } = boxes
  if (centered.height >= MIN_CENTERED_AREA_HEIGHT) return centered
  return free.height > centered.height ? free : centered
}
