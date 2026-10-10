/**
 * The clip screen's framing (KTD18), in one module so a reframe is a
 * one-file change and both treatments stay testable.
 */

/**
 * `crop` fills the screen from the centre of the frame (R9). `band` shows the
 * whole frame in the middle, with solid black above and below it.
 */
export type ExploreFraming = "crop" | "band"

type TrackSize = { width: number; height: number } | null | undefined

/**
 * Per clip, from the playing track (owner, 2026-09-27): a portrait clip fills
 * the screen, and a landscape, square, or not-yet-loaded clip sits in the band.
 */
export function clipFraming(size: TrackSize): ExploreFraming {
  if (size == null || !(size.width > 0) || !(size.height > 0)) return "band"
  return size.height > size.width ? "crop" : "band"
}

/** The feed's `VideoView` fit for a treatment. The overlay draws the rest. */
export function clipContentFit(framing: ExploreFraming): "cover" | "contain" {
  return framing === "crop" ? "cover" : "contain"
}

/** Most catalog video is 16:9. The band uses it until the track size loads. */
const BAND_FALLBACK_ASPECT = 16 / 9

/** Width over height of the playing track, or the fallback when it is unknown. */
export function bandAspect(size: TrackSize): number {
  if (size == null || !(size.width > 0) || !(size.height > 0)) {
    return BAND_FALLBACK_ASPECT
  }
  return size.width / size.height
}
