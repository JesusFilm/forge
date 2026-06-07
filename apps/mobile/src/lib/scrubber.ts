/**
 * Pure seek/scrubber math for the video controls. No react-native imports, so
 * it is unit-testable without the RN runtime (the Scrubber component's gesture
 * handling is verified in-simulator).
 *
 * Every helper guards on a usable duration: on HLS via expo-video,
 * `player.duration` is 0 / NaN until `sourceLoad`, so an unguarded seek would
 * snap to 0 and progress math would render NaN.
 */

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

export function hasUsableDuration(duration: number): boolean {
  return Number.isFinite(duration) && duration > 0
}

/**
 * Seek target for a ±N second skip, clamped to [0, duration].
 * Returns null when duration is unknown (the caller should no-op the seek).
 */
export function applySkip(
  currentTime: number,
  deltaSeconds: number,
  duration: number,
): number | null {
  if (!hasUsableDuration(duration)) return null
  return clamp(currentTime + deltaSeconds, 0, duration)
}

/**
 * Map a 0..1 track fraction to a time, clamped to [0, duration].
 * Returns null when duration is unknown.
 */
export function fractionToTime(
  fraction: number,
  duration: number,
): number | null {
  if (!hasUsableDuration(duration)) return null
  return clamp(fraction, 0, 1) * duration
}

/**
 * Progress fraction in [0, 1]. Clamped because end-of-stream samples can
 * report currentTime slightly beyond duration. 0 when duration is unknown.
 */
export function progressFraction(
  currentTime: number,
  duration: number,
): number {
  if (!hasUsableDuration(duration)) return 0
  return clamp(currentTime / duration, 0, 1)
}
