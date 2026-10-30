import type { StudioTimelineItem } from "@forge/studio-contracts"
export type FootagePresentation = { name: string; frames: string[] }
export type FootageVideo = Extract<StudioTimelineItem, { kind: "video" }>
export function footageKey(item: FootageVideo) {
  return JSON.stringify([
    item.source.videoId,
    item.source.dubId,
    item.source.editionId,
    item.source.language,
    item.source.preview,
    item.source.startMs,
    item.source.endMs,
  ])
}
/** Sample the admitted source range, excluding the out point. */
export function footageSampleTimes(startMs: number, endMs: number) {
  return Array.from(
    { length: 16 },
    (_, index) => Math.round(startMs + ((endMs - startMs) * index) / 16) / 1000,
  )
}
export function footageFrames(frames: string[], width: number) {
  const count = Math.max(1, Math.min(16, Math.ceil(width / 128)))
  return Array.from(
    { length: count },
    (_, index) =>
      frames[
        Math.min(frames.length - 1, Math.floor((index * frames.length) / count))
      ]!,
  ).filter(Boolean)
}
