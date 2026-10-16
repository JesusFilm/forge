import React from "react"
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion"

// The takeaway (DevotionalVideo conclusion card): large Literata 500 in gold,
// revealed letter by letter, centred over a light blur; the `highlight`
// phrase (the owner's rule) is set in italic. Fonts come from the font-pack
// items (font-literata500-*, font-literata500i-*).
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const

type Props = {
  text: string
  highlight: string
  centerY: number
  width: number
  fontSize: number
  color: string
  revealSec: number
  fadeOutSec: number
}

export default function Takeaway(props: Props) {
  const frame = useCurrentFrame()
  const { fps, durationInFrames, width: W } = useVideoConfig()
  const t = frame / fps
  const end = durationInFrames / fps
  const chars = Array.from(props.text)
  const at = props.highlight ? props.text.indexOf(props.highlight) : -1
  const hiEnd = at >= 0 ? at + props.highlight.length : -1
  const start = 0.5
  const per = Math.max(0.01, props.revealSec) / Math.max(1, chars.length)
  const out = interpolate(t, [end - props.fadeOutSec, end], [1, 0], clamp)
  // Code units, not code points, index the highlight: count as we go.
  let pos = 0
  return (
    <p
      style={{
        position: "absolute",
        left: (W - props.width) / 2,
        width: props.width,
        top: props.centerY,
        transform: "translateY(-50%)",
        margin: 0,
        textAlign: "center",
        fontFamily: "'DBP Literata', Georgia, serif",
        fontWeight: 500,
        fontSize: props.fontSize,
        lineHeight: 1.18,
        letterSpacing: -0.01 * props.fontSize,
        color: props.color,
        opacity: out,
        textShadow: "0 2px 22px rgba(0,0,0,0.55), 0 0 3px rgba(0,0,0,0.4)",
      }}
    >
      {chars.map((c, i) => {
        const here = pos
        pos += c.length
        return (
          <span
            key={i}
            style={{
              opacity: interpolate(t, [start + i * per, start + i * per + 0.4], [0, 1], clamp),
              fontStyle: here >= at && here < hiEnd ? "italic" : "normal",
            }}
          >
            {c}
          </span>
        )
      })}
    </p>
  )
}
