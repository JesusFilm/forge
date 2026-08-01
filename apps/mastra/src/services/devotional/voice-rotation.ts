import type { DevotionalVoiceName } from "./elevenlabs-voiceover"

/**
 * Narration voice rotation for the daily devotional.
 *
 * Per the audition decision, devotionals rotate through three voices in a fixed
 * order — Voice D → Voice E → Female C → (repeat). The rotation is driven by a
 * monotonic `sequence` number (e.g. the count of devotionals produced so far),
 * so it is deterministic and stateless here: the same sequence always yields the
 * same voice, which keeps runs reproducible and testable.
 */
/**
 * The voice for a given zero-based sequence number. Negative or fractional
 * inputs are normalized (truncated, wrapped) so a bad counter can never throw.
 */
export function rotateVoice(
  sequence: number,
  rotation?: readonly DevotionalVoiceName[],
): DevotionalVoiceName {
  if (!rotation?.length) {
    throw new Error("/inputs/voices/profiles.json: voice rotation is required")
  }
  const n = rotation.length
  const i = ((Math.trunc(sequence) % n) + n) % n
  return rotation[i]!
}

/**
 * Visual filter rotation (owner choice 2026-07-14, option b): rotate the color
 * grade per devotional like the voices — brand consistency comes from the
 * font/logo/graphics, not a single grade. Active filters only (teal/sepia are
 * legacy). splittone first so sequence 0 keeps the originally-approved look.
 */
export type DevotionalFilter = string

export function rotateFilter(
  sequence: number,
  rotation?: readonly DevotionalFilter[],
): DevotionalFilter {
  if (!rotation?.length) {
    throw new Error("/inputs/voices/profiles.json: filter rotation is required")
  }
  const n = rotation.length
  const i = ((Math.trunc(sequence) % n) + n) % n
  return rotation[i]!
}
