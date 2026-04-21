import { Dimensions, Platform } from "react-native"

/**
 * Density-aware scaling for cross-platform TV layouts.
 *
 * Apple TV renders at ~1920×1080 logical points. Android TV devices vary
 * widely — e.g. a 4K panel at 640 dpi yields only ~960×540 logical dp,
 * making every fixed-dp dimension appear twice as large proportionally.
 *
 * `scale()` normalises dimensions against a 1920-wide reference canvas
 * (Apple TV). On tvOS the multiplier is 1.0 (no change). On Android TV
 * it shrinks values so they occupy the same *proportion* of the screen.
 *
 * Font sizes on Android are rounded after scaling to avoid sub-pixel blur.
 */

const REFERENCE_WIDTH = 1920

const { width: SCREEN_WIDTH } = Dimensions.get("window")

const SCALE_FACTOR =
  Platform.OS === "android"
    ? (SCREEN_WIDTH || REFERENCE_WIDTH) / REFERENCE_WIDTH
    : 1

/** Scale a dp value to match the reference 1920-wide TV canvas. */
export function scale(size: number): number {
  if (SCALE_FACTOR === 1) return size
  return Math.round(size * SCALE_FACTOR)
}
