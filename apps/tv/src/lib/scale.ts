import { Dimensions, Platform } from "react-native"

/**
 * Density-aware scaling for cross-platform TV layouts. Apple TV's logical dp
 * varies from Android TV's, so `scale()` normalises against a 1920-wide Apple TV
 * canvas (1.0 on tvOS, shrunk on Android; fonts rounded to avoid sub-pixel blur).
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
