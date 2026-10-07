import React from "react"
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion"

// The devotional "restored" film look as an overlay over the clips below it:
// footage grade (saturate 0.92, contrast 1.04, brightness 1.1) via
// backdrop-filter, the warm split tone folded into one tint (Studio layers are
// isolated, so screen/multiply blends cannot reach the video), grain,
// vignette, the teaser's even dim and the fade in/out from black.
const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")"

export default function FilmLook({
  grade,
  warmth,
  grain,
  vignette,
  dim,
  fadeInSec,
  fadeOutSec,
}: {
  grade: boolean
  warmth: number
  grain: number
  vignette: boolean
  dim: number
  fadeInSec: number
  fadeOutSec: number
}) {
  const frame = useCurrentFrame()
  const { fps, durationInFrames } = useVideoConfig()
  const t = frame / fps
  const end = durationInFrames / fps
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const
  const fadeIn = fadeInSec > 0 ? interpolate(t, [0, fadeInSec], [1, 0], clamp) : 0
  const fadeOut = fadeOutSec > 0 ? interpolate(t, [end - fadeOutSec, end], [0, 1], clamp) : 0
  const black = Math.max(fadeIn, fadeOut)
  const fill = { position: "absolute", inset: 0 } as const
  return (
    <div style={{ ...fill, pointerEvents: "none" }}>
      {grade ? (
        <div
          style={{
            ...fill,
            backdropFilter: "saturate(0.92) contrast(1.04) brightness(1.1)",
            WebkitBackdropFilter: "saturate(0.92) contrast(1.04) brightness(1.1)",
          }}
        />
      ) : null}
      {warmth > 0 ? <div style={{ ...fill, background: "rgb(181,133,97)", opacity: warmth }} /> : null}
      {grain > 0 ? (
        <div
          style={{
            ...fill,
            backgroundImage: GRAIN,
            backgroundSize: "260px 260px",
            filter: "sepia(1) saturate(3.2) brightness(0.32) hue-rotate(-6deg)",
            opacity: grain,
          }}
        />
      ) : null}
      {vignette ? <div style={{ ...fill, boxShadow: "inset 0 0 70px 6px rgba(0,0,0,0.26)" }} /> : null}
      {dim > 0 ? <div style={{ ...fill, background: `rgba(0,0,0,${dim})` }} /> : null}
      {black > 0 ? <div style={{ ...fill, background: "#000", opacity: black }} /> : null}
    </div>
  )
}
