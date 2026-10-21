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
  // A zero fade means none, so pieces laid back to back (verse, PRAY step,
  // question) join without a sharp frame between them. v4 floored a zero fade
  // to 0.01 s, which still started every piece at opacity 0.
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const
  const fade =
    (props.fadeInSec > 0 ? interpolate(t, [0, props.fadeInSec], [0, 1], clamp) : 1) *
    (props.fadeOutSec > 0 ? interpolate(t, [end - props.fadeOutSec, end], [1, 0], clamp) : 1)
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
        // Grain without SVG (a feTurbulence filter made the Studio render
        // fail, 2026-10-16): two fine offset dot patterns shifted a step
        // every frame so the dither does not sit still. No mix-blend-mode:
        // an overlay-blended sibling switched the backdrop blur off entirely
        // (render test blur-grain-test-20261021), so the dots are plain and
        // fainter instead.
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: props.grain * 0.22,
            backgroundImage:
              "radial-gradient(rgba(255,255,255,0.5) 0.6px, transparent 1px), radial-gradient(rgba(0,0,0,0.6) 0.6px, transparent 1px)",
            backgroundSize: "3px 3px, 4px 4px",
            backgroundPosition: `${frame % 3}px ${(frame * 2) % 3}px, ${(frame * 3) % 4}px ${frame % 4}px`,
          }}
        />
      ) : null}
    </div>
  )
}
