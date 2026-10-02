import { Easing, interpolate } from "remotion"

import { SHORT_FONT_FAMILIES } from "../fonts"

const SANS = `'${SHORT_FONT_FAMILIES.inter}', -apple-system, system-ui, sans-serif`

/**
 * A short line "stamped" in: large caps, out of a blur and a slight
 * horizontal spread, settling over 0.8s. The shorts' one treatment for a
 * short sentence (the reflection's lines of up to four words) and for the
 * film short's silent question cards (owner, 2026-10-02: "the same style as
 * the reflection's short sentences").
 *
 * `f` converts Figma px of a 900-wide frame. `t` is seconds since the line
 * starts arriving.
 */
export function StampLine({
  text,
  t,
  f,
  sharp = false,
}: {
  text: string
  t: number
  f: (n: number) => number
  /** A harder hit (owner, 2026-10-02, the film short's opening question):
   *  lands in ~0.35s from a larger size and overshoots slightly before it
   *  settles, instead of easing in over 0.8s. */
  sharp?: boolean
}) {
  if (sharp) {
    const p = interpolate(t, [-0.02, 0.3], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.2, 0.9, 0.3, 1),
    })
    // 1.16 -> 0.985 at the hit -> 1, the small bounce of a stamp.
    const scale = interpolate(t, [-0.02, 0.3, 0.45], [1.16, 0.985, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
    return (
      <p
        style={{
          margin: 0,
          fontFamily: SANS,
          fontWeight: 600,
          fontSize: f(76),
          lineHeight: 1.2,
          textAlign: "center",
          textTransform: "uppercase",
          letterSpacing: f(3.2),
          color: "#ffffff",
          opacity: p,
          transform: `scale(${scale.toFixed(4)})`,
          filter:
            p < 0.99 ? `blur(${(f(4) * (1 - p)).toFixed(2)}px)` : undefined,
          textShadow: `0 ${f(2)}px ${f(22)}px rgba(0,0,0,0.6)`,
        }}
      >
        {text}
      </p>
    )
  }
  const p = interpolate(t, [-0.02, 0.78], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.4, 0, 0.2, 1),
  })
  return (
    <p
      style={{
        margin: 0,
        fontFamily: SANS,
        fontWeight: 600,
        fontSize: f(76),
        lineHeight: 1.2,
        textAlign: "center",
        textTransform: "uppercase",
        // Fixed tracking: animating it re-wrapped the line mid-stamp
        // ("HIS HANDS / ARE DIRTY." then "HIS HANDS ARE / DIRTY.", owner
        // 2026-10-02). The spread is a horizontal scale instead, which never
        // changes where the line breaks.
        letterSpacing: f(3.2),
        color: "#ffffff",
        opacity: p,
        transform: `scale(${(0.96 + 0.04 * p + 0.1 * (1 - p)).toFixed(4)}, ${(0.96 + 0.04 * p).toFixed(4)})`,
        filter: p < 0.99 ? `blur(${(f(7) * (1 - p)).toFixed(2)}px)` : undefined,
        textShadow: `0 ${f(2)}px ${f(22)}px rgba(0,0,0,0.6)`,
      }}
    >
      {text}
    </p>
  )
}
