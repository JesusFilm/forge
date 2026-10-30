import type { StudioTimelineItem } from "@forge/studio-contracts"
export type AudioItem = Extract<StudioTimelineItem, { kind: "video" | "audio" }>
export function waveformKey(item: AudioItem, fps: number) {
  return item.kind === "video"
    ? JSON.stringify([
        item.source,
        item.durationInFrames,
        item.playbackRate ?? 1,
      ])
    : JSON.stringify([
        item.asset,
        item.sourceStartMs,
        item.durationInFrames,
        fps,
      ])
}
/** Signed little-endian PCM, with a stable full-scale amplitude across clips. */
export function pcmPeaks(bytes: Uint8Array, count = 256) {
  const samples = Math.floor(bytes.byteLength / 2)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return Array.from({ length: count }, (_, bin) => {
    let peak = 0
    for (
      let i = Math.floor((bin * samples) / count);
      i < Math.floor(((bin + 1) * samples) / count);
      i++
    ) {
      peak = Math.max(peak, Math.abs(view.getInt16(i * 2, true)) / 32768)
    }
    return Math.round(peak * 1000) / 1000
  })
}
export function waveformPath(peaks: number[], volume: number) {
  return peaks
    .map((peak, index) => {
      const gain = volume === 0 ? 1 : volume
      const height = Math.max(
        0.3,
        Math.round(Math.sqrt(Math.min(1, peak * gain)) * 140) / 10,
      )
      return `M${index + 0.5},${16 - height}v${height * 2}`
    })
    .join("")
}
