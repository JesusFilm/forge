import { AbsoluteFill, Easing, interpolate, useVideoConfig } from "remotion"

/**
 * The step's own name written across the frame at a whisper: it arrives out of
 * the blur, comes into focus, and goes back into it.
 *
 * Replaces the centred WATCH · REFLECT · PRAY row on the hand-over screens
 * (owner, 2026-09-23: "no stepper in the middle — the step's name at 15%").
 * The row lives at the top of the frame now and runs continuously, so naming
 * the stage twice on the same screen said the same thing in two places.
 */

const GOLD = "#f2c46b"

/**
 * The big word's size: px(126) for WATCH / REFLECT / PRAY (unchanged), smaller
 * when the label would not fit. Russian labels are seven or eight letters of
 * wide Cyrillic caps (ПОСМОТРИ, ПОДУМАЙ, ПОМОЛИСЬ) and ran off both edges
 * (owner, 2026-10-06). Letter widths are estimates for Literata 600 caps:
 * 0.66em for Latin, 0.78em for Cyrillic; the word keeps to 92% of the frame.
 */
export function bigStepFontSize(
  label: string,
  px: (n: number) => number,
  frameWidth: number,
): number {
  const base = px(126)
  const track = px(7)
  const chars = [...label]
  const em = chars.reduce(
    (n, c) => n + (/\p{Script=Cyrillic}/u.test(c) ? 0.78 : 0.66),
    0,
  )
  const fit = (frameWidth * 0.92 - track * chars.length) / Math.max(em, 0.1)
  return Math.max(px(40), Math.min(base, fit))
}
const ease = Easing.bezier(0.42, 0, 0.58, 1)

export function BigStepWord({
  label,
  frame,
  fps,
  px,
  durationInFrames,
  serif,
  /** Peak opacity — the owner's 15%. */
  peak = 0.15,
}: {
  label: string
  frame: number
  fps: number
  px: (n: number) => number
  durationInFrames: number
  serif: string
  peak?: number
}) {
  const { width } = useVideoConfig()
  const t = frame / fps
  const total = durationInFrames / fps
  // In over a second, hold, and take the same time going back into the blur.
  const inSec = Math.min(1.0, total * 0.3)
  const outSec = Math.min(1.2, total * 0.35)
  const opacity = interpolate(
    t,
    [0, inSec, Math.max(inSec, total - outSec), total],
    [0, peak, peak, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease },
  )
  const blur = interpolate(
    t,
    [0, inSec, Math.max(inSec, total - outSec), total],
    [26, 0, 0, 26],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease },
  )
  const scale = interpolate(t, [0, total], [1.06, 1.0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          fontFamily: serif,
          fontWeight: 600,
          fontSize: bigStepFontSize(label, px, width),
          lineHeight: 1,
          letterSpacing: px(7),
          color: GOLD,
          opacity,
          filter: `blur(${blur.toFixed(2)}px)`,
          // Optically centred: a serif's em box is taller above the caps, so a
          // box-centred word reads as sitting low.
          transform: `translateY(-0.08em) scale(${scale.toFixed(3)})`,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </div>
    </AbsoluteFill>
  )
}
