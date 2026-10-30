export type TimelineZoomMode = "fit" | "detail" | "custom"
export function timelineZoomPresets(
  frames: number,
  fps: number,
  viewport: number,
) {
  const base = Math.max(700, (frames / fps) * 24)
  const fit = Math.min(20000, Math.max(1, viewport)) / base
  const max = 20000 / base
  return {
    fit,
    detail: Math.min(max, fit * Math.max(1, frames / fps / 10)),
    min: fit / 4,
    max,
  }
}
