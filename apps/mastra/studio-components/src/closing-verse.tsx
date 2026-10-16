import React from "react"
import { useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion"

// The closing verse (DevotionalVideo scripture card): a gold opening quote
// mark, the verse in a light italic serif revealed letter by letter, and the
// citation in gold tracked caps once the verse is read. English sets Source
// Serif 4 italic 300, Russian Literata italic. Fonts come from the font-pack
// items (font-sourceserif300i-latin, font-literata400i-*, font-literata500-*,
// font-inter600caps-*), which must run over the whole video.
const GOLD = "#e6a35c"
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const

type Props = {
  text: string
  citation: string
  centerY: number
  width: number
  fontSize: number
  revealSec: number
  fadeOutSec: number
}

export default function ClosingVerse(props: Props) {
  const frame = useCurrentFrame()
  const { fps, durationInFrames, width: W } = useVideoConfig()
  const t = frame / fps
  const end = durationInFrames / fps
  const cyr = /[А-Яа-яЁё]/.test(props.text)
  const family = cyr ? "'DBP Literata', Georgia, serif" : "'DBP Source Serif', Georgia, serif"
  const chars = Array.from(props.text)
  const start = 0.3
  const per = Math.max(0.01, props.revealSec) / Math.max(1, chars.length)
  const doneAt = start + props.revealSec
  const out = interpolate(t, [end - props.fadeOutSec, end], [1, 0], clamp)
  const mark = interpolate(t, [0.15, 0.9], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) })
  const cite = interpolate(t, [doneAt, doneAt + 0.6], [0, 1], clamp)
  return (
    <div
      style={{
        position: "absolute",
        left: (W - props.width) / 2,
        width: props.width,
        top: props.centerY,
        transform: "translateY(-50%)",
        textAlign: "center",
        opacity: out,
        textShadow: "0 2px 18px rgba(0,0,0,0.5)",
      }}
    >
      <div
        style={{
          fontFamily: "'DBP Literata', Georgia, serif",
          fontWeight: 500,
          fontSize: props.fontSize * 2.4,
          lineHeight: 0.55,
          height: props.fontSize * 1.2,
          color: GOLD,
          opacity: mark,
          transform: `scale(${0.85 + 0.15 * mark})`,
        }}
      >
        {cyr ? "«" : "“"}
      </div>
      <p
        style={{
          margin: 0,
          fontFamily: family,
          fontStyle: "italic",
          fontWeight: cyr ? 400 : 300,
          fontSize: props.fontSize,
          lineHeight: 1.36,
          color: "#ffffff",
        }}
      >
        {chars.map((c, i) => (
          <span key={i} style={{ opacity: interpolate(t, [start + i * per, start + i * per + 0.35], [0, 1], clamp) }}>
            {c}
          </span>
        ))}
      </p>
      <div
        style={{
          marginTop: props.fontSize * 0.9,
          fontFamily: "'DBP Inter Caps', Inter, sans-serif",
          fontWeight: 600,
          fontSize: props.fontSize * 0.5,
          letterSpacing: props.fontSize * 0.09,
          color: GOLD,
          opacity: cite,
        }}
      >
        {props.citation}
      </div>
    </div>
  )
}
