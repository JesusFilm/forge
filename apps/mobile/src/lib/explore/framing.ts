/**
 * The clip screen's framing switch (KTD18), in one module so a reframe is a
 * one-file change and both treatments stay testable.
 */

/**
 * `crop` fills the screen from the centre of the frame (R9). `band` shows the
 * whole frame in the middle, with a blurred copy of the clip's image above and
 * below it.
 */
export type ExploreFraming = "crop" | "band"

export const EXPLORE_FRAMING: ExploreFraming = "crop"

/** The feed's `VideoView` fit for a treatment. The overlay draws the rest. */
export function clipContentFit(framing: ExploreFraming): "cover" | "contain" {
  return framing === "crop" ? "cover" : "contain"
}

/** Most catalog video is 16:9. The band uses it until the track size loads. */
const BAND_FALLBACK_ASPECT = 16 / 9

/** Width over height of the playing track, or the fallback when it is unknown. */
export function bandAspect(
  size: { width: number; height: number } | null | undefined,
): number {
  if (size == null || !(size.width > 0) || !(size.height > 0)) {
    return BAND_FALLBACK_ASPECT
  }
  return size.width / size.height
}

/** iOS and Android both take this radius on expo-image. Purely aesthetic. */
export const BAND_BLUR_RADIUS = 24
