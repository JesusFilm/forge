/** Zoom controls time scale; the viewport only supplies additional empty grid. */
export function timelineScale(
  durationInFrames: number,
  fps: number,
  zoom: number,
  viewportWidth: number,
) {
  const durationWidth = Math.min(
    20000,
    Math.max(700, (durationInFrames / fps) * 24) * zoom,
  )
  return {
    width: Math.max(viewportWidth, durationWidth),
    px: durationWidth / durationInFrames,
  }
}
