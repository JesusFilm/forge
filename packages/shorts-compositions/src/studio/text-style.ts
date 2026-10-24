import type { StudioTimelineItem } from "@forge/studio-contracts"

export type TextItem = Extract<StudioTimelineItem, { kind: "text" }>

/** Frame-based motion is identical during playback, seeking and rendering. */
export function textMotion(item: TextItem, frame: number) {
  if (item.durationInFrames < 3) return { opacity: 1, translateY: 0 }
  const p = item.properties
  const limit = Math.max(1, Math.floor(item.durationInFrames / 2))
  const enter = Math.min(p.entranceFrames ?? 9, limit)
  const exit = Math.min(p.exitFrames ?? 9, limit)
  const progress = (value: number) => Math.max(0, Math.min(1, value))
  const incoming =
    p.entrance && p.entrance !== "none" ? progress(frame / enter) : 1
  const outgoing =
    p.exit && p.exit !== "none"
      ? progress((item.durationInFrames - 1 - frame) / exit)
      : 1
  return {
    opacity: incoming * outgoing,
    translateY:
      (p.entrance === "slide" ? 40 * (1 - incoming) ** 2 : 0) -
      (p.exit === "slide" ? 40 * (1 - outgoing) ** 2 : 0),
  }
}
