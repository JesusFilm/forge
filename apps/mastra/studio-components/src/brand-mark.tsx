import React from "react"
import { useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion"

// The Jesus Film brand mark from the devotional teaser (AnimatedBrandMark,
// spanSec 3.6, scale 1.15, top 9%): stamps in, holds the lockup, then crops
// down to the symbol. Fades out over the last fadeOutSec of the item.
const PATH =
  "M53,0H2.7A2.7,2.7,0,0,0,0,2.7V23.38A2.71,2.71,0,0,0,2,26L54.36,40.66a1,1,0,0,0,1.29-1V2.7A2.7,2.7,0,0,0,53,0Z"
const LOCKUP = "__LOCKUP__"
const LOCKUP_URI = `data:image/svg+xml;utf8,${encodeURIComponent(LOCKUP)}`

export default function BrandMark({
  spanSec,
  topPercent,
  fadeOutSec,
}: {
  spanSec: number
  topPercent: number
  fadeOutSec: number
}) {
  const frame = useCurrentFrame()
  const { fps, durationInFrames, width, height } = useVideoConfig()
  const u = (Math.min(width, height) / 390) * 1.15
  const span = Math.max(1, Math.round(spanSec * fps))
  const p = Math.max(0, Math.min(1, frame / span))
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const
  const io = { ...clamp, easing: Easing.inOut(Easing.cubic) }
  const symbolW = 34 * u
  const lockupW = 34 * (160.27 / 55.65) * u
  const rowH = 25 * u
  const slow = spanSec > 1.5
  const clipW = interpolate(p, [slow ? 0.3 : 0.16, slow ? 0.82 : 0.35], [lockupW, symbolW], io)
  const swap: [number, number] = [slow ? 0.68 : 0.29, slow ? 0.82 : 0.35]
  const end = durationInFrames / fps
  const out = fadeOutSec > 0 ? interpolate(frame / fps, [end - fadeOutSec, end - 0.02], [1, 0], clamp) : 1
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: `${topPercent}%`,
        display: "flex",
        justifyContent: "center",
        opacity: out,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          position: "relative",
          width: clipW,
          height: rowH,
          opacity: interpolate(p, [0, 0.04], [0, 1], clamp),
          transform: `scale(${interpolate(p, [0, 0.035, 0.06, 0.085], [1.4, 0.93, 1.05, 1.0], clamp)})`,
        }}
      >
        <div style={{ width: clipW, height: rowH, overflow: "hidden", opacity: interpolate(p, swap, [1, 0], io) }}>
          <img src={LOCKUP_URI} alt="" style={{ display: "block", width: lockupW, height: rowH }} />
        </div>
        <div style={{ position: "absolute", top: 0, left: 0, opacity: interpolate(p, swap, [0, 1], io) }}>
          <svg viewBox="0 0 55.65 40.7" width={symbolW} height={rowH}>
            <path d={PATH} fill="#ee3441" />
          </svg>
        </div>
      </div>
    </div>
  )
}
