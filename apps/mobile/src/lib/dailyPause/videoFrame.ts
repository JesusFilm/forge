// Where a devotional video sits on the screen. The run's top-row controls and
// the part's progress bar and cue sit in the letterboxes around it (R24).

/** The devotional videos are 1080 x 1920. */
const VIDEO_ASPECT = 1080 / 1920

/** Where a contain-fit devotional video sits in a window of this size. */
export function devotionalVideoFrame(
  width: number,
  height: number,
): { top: number; height: number } {
  const videoHeight = Math.min(height, width / VIDEO_ASPECT)
  return { top: (height - videoHeight) / 2, height: videoHeight }
}
