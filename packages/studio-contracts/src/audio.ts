import type { StudioTimelineItem } from "./index"

export type StudioAudioItem = Extract<
  StudioTimelineItem,
  { kind: "audio" | "video" }
>
export const STUDIO_MAX_AUDIO_DB = 30
export const STUDIO_MIN_AUDIO_DB = -60
export const STUDIO_MAX_AUDIO_VOLUME = 10 ** (STUDIO_MAX_AUDIO_DB / 20)
export function audioDbToVolume(db: number): number {
  return db === -Infinity ? 0 : 10 ** (Math.min(STUDIO_MAX_AUDIO_DB, db) / 20)
}
export function audioVolumeToDb(volume: number): number {
  return volume <= 0 ? -Infinity : 20 * Math.log10(volume)
}
export function audioDbLabel(volume: number): string {
  const db = audioVolumeToDb(volume)
  return db === -Infinity ? "−∞ dB" : `${db > 0 ? "+" : ""}${db.toFixed(1)} dB`
}
export function audioFadeSettings(item: StudioAudioItem) {
  const limit = Math.max(0, item.durationInFrames - 1)
  let fadeInFrames = Math.min(limit, item.audioFade?.fadeInFrames ?? 0)
  let fadeOutFrames = Math.min(limit, item.audioFade?.fadeOutFrames ?? 0)
  if (fadeInFrames + fadeOutFrames > limit) {
    fadeInFrames = Math.floor(
      (limit * fadeInFrames) / (fadeInFrames + fadeOutFrames),
    )
    fadeOutFrames = limit - fadeInFrames
  }
  return {
    fadeInFrames,
    fadeOutFrames,
    fadeInCurve: item.audioFade?.fadeInCurve ?? 0,
    fadeOutCurve: item.audioFade?.fadeOutCurve ?? 0,
    fadeInCurvePosition: item.audioFade?.fadeInCurvePosition ?? 0.5,
    fadeOutCurvePosition: item.audioFade?.fadeOutCurvePosition ?? 0.5,
  }
}
/** Positive curvature rises quickly; negative curvature rises slowly. */
export function audioFadeProgress(
  progress: number,
  curve: number,
  position = 0.5,
): number {
  const t = Math.max(0, Math.min(1, progress))
  const p = Math.max(0.05, Math.min(0.95, position))
  // Smoothly move the curve's midpoint through time without changing its height.
  // At the legacy position (0.5), remapped progress is exactly t.
  const remapped = (t * (1 - p)) / (p + t * (1 - 2 * p))
  return remapped ** (2 ** (-3 * curve))
}
/** Frames are relative to the clip, independent of source-in or playback speed. */
export function studioAudioVolume(
  item: StudioAudioItem,
  frame: number,
): number {
  if (frame < 0 || frame >= item.durationInFrames) return 0
  const fade = audioFadeSettings(item)
  const start = fade.fadeInFrames
    ? audioFadeProgress(
        frame / fade.fadeInFrames,
        fade.fadeInCurve,
        fade.fadeInCurvePosition,
      )
    : 1
  const end = fade.fadeOutFrames
    ? audioFadeProgress(
        (item.durationInFrames - 1 - frame) / fade.fadeOutFrames,
        fade.fadeOutCurve,
        fade.fadeOutCurvePosition,
      )
    : 1
  return item.volume * start * end
}
