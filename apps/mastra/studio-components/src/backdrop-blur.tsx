import React from "react"
import { useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion"

// Blurs and darkens whatever plays under it (DevotionalVideo's closing-card
// overlay): the blur eases from fromPx to toPx over rampSec, a dark scrim sits
// on top, and fine grain dithers the smooth blur so dark footage does not band.
// Owner levels (9:16): verse 8 -> 25 px over 1.6 s, scrim 0.46; PRAY step
// 25 -> 44; question and prayer 44 -> 72 over 2.2 s, scrim 0.36; grain 0.5.
type Props = {
  fromPx: number
  toPx: number
  rampSec: number
  scrim: number
  grain: number
  fadeInSec: number
  fadeOutSec: number
}

export default function BackdropBlur(props: Props) {
  const frame = useCurrentFrame()
  const { fps, durationInFrames } = useVideoConfig()
  const t = frame / fps
  const end = durationInFrames / fps
  const blur = interpolate(t, [0, Math.max(0.01, props.rampSec)], [props.fromPx, props.toPx], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  })
  const fade =
    interpolate(t, [0, Math.max(0.01, props.fadeInSec)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) *
    interpolate(t, [end - props.fadeOutSec, end], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
  return (
    <div style={{ position: "absolute", inset: 0, opacity: fade, pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          backdropFilter: `blur(${blur.toFixed(2)}px)`,
          WebkitBackdropFilter: `blur(${blur.toFixed(2)}px)`,
          background: `rgba(6,4,3,${props.scrim})`,
        }}
      />
      {props.grain > 0 ? (
        <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, opacity: props.grain, mixBlendMode: "overlay" }}>
          <filter id="dbp-grain">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={frame % 30} stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <rect width="100%" height="100%" filter="url(#dbp-grain)" />
        </svg>
      ) : null}
    </div>
  )
}
