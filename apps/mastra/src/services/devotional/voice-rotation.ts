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
export const VOICE_ROTATION: readonly DevotionalVoiceName[] = [
  "male-d",
  "male-e",
  "female-c",
]

/**
 * The voice for a given zero-based sequence number. Negative or fractional
 * inputs are normalized (truncated, wrapped) so a bad counter can never throw.
 */
export function rotateVoice(sequence: number): DevotionalVoiceName {
  const n = VOICE_ROTATION.length
  const i = ((Math.trunc(sequence) % n) + n) % n
  return VOICE_ROTATION[i]
}

/**
 * The grade no longer rotates (owner, 2026-09-25). Rotating it was a 2026-07-14
 * decision meant to keep the feed from looking samey, but in practice it made
 * the series look inconsistent while the gloom of the old grade was the real
 * problem. One grade now, and it is `restored`: the 1979 film keeps its colour,
 * the blacks are lifted, the midtones are warm, and grain and vignette are a
 * hint rather than a layer.
 *
 * Footage that is already beautiful takes `clean` instead (LUMO), passed
 * explicitly per render. Anything else is a per-render `--style=` override.
 */
export const DEFAULT_FILTER = "restored" as const

export type DevotionalFilter = typeof DEFAULT_FILTER
