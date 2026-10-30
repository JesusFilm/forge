import type { TimelineRow } from "./timeline-layout"
export function timelineRowHeight(row: TimelineRow) {
  return row.group === "Audio"
    ? 72
    : row.items.some((item) => item.kind === "video")
      ? 104
      : 48
}
export function timelineTimecode(frame: number, fps: number) {
  const frames = Math.max(0, Math.floor(frame))
  const seconds = Math.floor(frames / fps)
  return [
    Math.floor(seconds / 3600),
    Math.floor(seconds / 60) % 60,
    seconds % 60,
    frames % fps,
  ]
    .map((value) => String(value).padStart(2, "0"))
    .join(":")
}
