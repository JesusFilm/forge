import type { StudioPreview } from "@forge/studio-contracts/preview"

// Browser media runs on its own clock. At pause, keep the visible footage frame
// instead of letting it snap back to the slightly different composition clock.
export function pausedFootageFrame(
  input: StudioPreview,
  frame: number,
  mediaTime: (itemId: string) => number | undefined,
): number {
  const { document } = input
  const layers = document.tracks.flatMap((track) =>
    document.items.filter((item) => item.trackId === track.id),
  )
  for (const item of layers.reverse()) {
    if (
      item.kind !== "video" ||
      item.transform?.opacity === 0 ||
      frame < item.startFrame ||
      frame >= item.startFrame + item.durationInFrames
    )
      continue
    const media = input.media[item.id]
    const time = mediaTime(item.id)
    if (!media || time === undefined || !Number.isFinite(time)) continue
    const rate = item.playbackRate ?? 1
    const sourceIn = (item.source.startMs - media.sourceStartMs) / 1000
    return Math.max(
      item.startFrame,
      Math.min(
        item.startFrame + item.durationInFrames - 1,
        Math.floor(
          item.startFrame + ((time - sourceIn) * document.fps) / rate + 0.0001,
        ),
      ),
    )
  }
  return frame
}
