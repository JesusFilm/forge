// Pure label composition for the fullscreen player's chrome (the U8 redesign
// from the "Forge TV Video Page" handoff). Kept React-free so the design's
// label contract is unit-testable without rendering (same rationale as
// playerSwitch.ts — jest-expo can't load .tsx).

/**
 * The quiet status chip in the player's top bar ("English · CC Español").
 * Mirrors the design's `.pl-status` contract: language always leads; the CC
 * segment appears only while subtitles are on. Null hides the chip entirely
 * (no session, or a session without a resolvable language name).
 */
export function composePlayerStatusChip(
  audioLabel: string | null,
  subtitleLabel: string | null,
): string | null {
  if (audioLabel == null) return null
  return subtitleLabel != null
    ? `${audioLabel} · CC ${subtitleLabel}`
    : audioLabel
}

/**
 * The two-line "Audio & Subtitles" pill's sub-caption ("English · CC Off").
 * Unlike the chip, subtitles-off is stated explicitly — the pill is the
 * affordance for changing it, so "Off" is information, not noise.
 */
export function composeAudioSubsPillSub(
  audioLabel: string | null,
  subtitleLabel: string | null,
): string | null {
  if (audioLabel == null) return null
  return `${audioLabel} · CC ${subtitleLabel ?? "Off"}`
}
