import React from "react"
import { useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion"

// The compact 9:16 source credit under the reflection sentence (owner's
// Figma "B · compact credit under the card", 2026-10-21): a gold line, then
// the emblem, the tracked label and the source in Literata, centred. Owner's
// animation order: the line draws left to right, then the emblem appears,
// then the label, then the source name comes in from above. `top` is the
// line's y. The owner's revision (same day) made the emblem larger (emblemSize
// 55) with 16 px under it. Emblems as in source-mark-v1: an open book for history (a page
// turns), a scroll for the original language, J. C. Ryle's engraving for
// commentary. Fonts come from the font-pack items (font-literata400-*,
// font-inter600caps-*).
const RYLE = "__RYLE__"
const GOLD = "#f2c46b"
const EASE = Easing.bezier(0.4, 0, 0.2, 1)
const TURN = Easing.bezier(0.45, 0, 0.25, 1)
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const
const STROKE = { fill: "none", stroke: "#fff", strokeWidth: 9, strokeLinecap: "round", strokeLinejoin: "round" } as const
const PAGE = "M0,62 C32,44 72,42 108,50 L108,186 C72,178 32,180 0,198"

const wave = (x0: number, x1: number, y: number) => {
  const step = (x1 - x0) / 3
  let d = `M${x0},${y}`
  for (let i = 0; i < 3; i++) {
    const a = x0 + step * i
    d += ` Q${a + step / 4},${y - 6} ${a + step / 2},${y} T${a + step},${y}`
  }
  return d
}

function Book({ t }: { t: number }) {
  const ph = (a: number, b: number) => interpolate(t, [a, b], [0, 1], { ...clamp, easing: TURN })
  const flips = [ph(1.2, 2.3), ph(2.6, 3.7)]
  return (
    <svg viewBox="0 0 344 252" width="100%" height="100%">
      <path {...STROKE} d="M52,62 L52,200 C100,192 140,196 172,210 C204,196 244,192 292,200 L292,62" />
      <path {...STROKE} d={PAGE} transform="translate(172,0) scale(-1,1)" />
      <path {...STROKE} d={PAGE} transform="translate(172,0)" />
      <path {...STROKE} d="M172,62 L172,198" />
      {[96, 124, 152].map((y) => (
        <g key={y}>
          <path {...STROKE} d={wave(88, 150, y)} />
          <path {...STROKE} d={wave(194, 256, y)} />
        </g>
      ))}
      {flips.map((p, i) =>
        p > 0 && p < 1 ? (
          <path
            key={i}
            {...STROKE}
            fill="rgba(255,255,255,0.32)"
            d={`${PAGE} Z`}
            transform={`translate(172,${(-22 * Math.sin(Math.PI * p)).toFixed(2)}) scale(${Math.cos(Math.PI * p).toFixed(4)},1)`}
          />
        ) : null,
      )}
    </svg>
  )
}

function Scroll({ t }: { t: number }) {
  const ph = (a: number, b: number) => interpolate(t, [a, b], [0, 1], { ...clamp, easing: TURN })
  const half = 102 - 76 * (ph(1.3, 2.2) - ph(2.55, 3.45))
  const xl = 172 - half
  const xr = 172 + half
  const a = xl + 13
  const b = xr - 13
  const roller = (x: number) => (
    <g>
      <rect {...STROKE} x={x - 13} y={60} width={26} height={132} rx={12} />
      <path {...STROKE} d={`M${x},60 L${x},42 M${x},192 L${x},210`} />
      <circle {...STROKE} cx={x} cy={36} r={7} />
      <circle {...STROKE} cx={x} cy={216} r={7} />
    </g>
  )
  const inner = (y: number) => {
    const x0 = Math.max(a, 106)
    const x1 = Math.min(b, 238)
    return x1 - x0 > 12 ? <path key={y} {...STROKE} d={wave(x0, x1, y)} /> : null
  }
  return (
    <svg viewBox="0 0 344 252" width="100%" height="100%">
      {b - a > 4 ? (
        <>
          <path {...STROKE} d={`M${a},78 C${a + (b - a) * 0.35},64 ${a + (b - a) * 0.65},92 ${b},78`} />
          <path {...STROKE} d={`M${a},174 C${a + (b - a) * 0.35},160 ${a + (b - a) * 0.65},188 ${b},174`} />
          {[108, 128, 148].map(inner)}
        </>
      ) : null}
      {roller(xl)}
      {roller(xr)}
    </svg>
  )
}

type Props = {
  kind: "history" | "language" | "commentary"
  label: string
  source: string
  top: number
  ruleWidth: number
  emblemSize: number
  startSec: number
  fadeOutSec: number
}

export default function SourceMarkCompact(props: Props) {
  const frame = useCurrentFrame()
  const { fps, durationInFrames, width: W } = useVideoConfig()
  const t = frame / fps
  const end = durationInFrames / fps
  const s = props.startSec
  const fade = (a: number, b: number) => interpolate(t, [s + a, s + b], [0, 1], { ...clamp, easing: EASE })
  const out = 1 - interpolate(t, [end - Math.max(0.01, props.fadeOutSec), end], [0, 1], { ...clamp, easing: EASE })
  const line = fade(0, 0.6)
  const book = fade(0.5, 0.9)
  const label = fade(0.8, 1.1)
  const source = fade(1.0, 1.5)
  const e = props.emblemSize
  return (
    <div
      style={{
        position: "absolute",
        top: props.top,
        left: 0,
        width: W,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        opacity: out,
        pointerEvents: "none",
        filter: "drop-shadow(0 2px 12px rgba(0,0,0,0.5))",
      }}
    >
      <div
        style={{
          width: props.ruleWidth,
          height: 3,
          background: GOLD,
          transform: `scaleX(${line.toFixed(4)})`,
          transformOrigin: "left center",
          marginBottom: 52,
        }}
      />
      <div
        style={{
          width: props.kind === "commentary" ? e : e * 1.36,
          height: e,
          marginBottom: 16,
          opacity: book * 0.85,
          transform: `translateY(${(-6 * (1 - book)).toFixed(2)}px)`,
        }}
      >
        {props.kind === "commentary" ? (
          <div
            style={{
              width: e,
              height: e,
              borderRadius: "50%",
              backgroundImage: `url(data:image/jpeg;base64,${RYLE})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              border: "1.5px solid rgba(255,255,255,0.7)",
              boxSizing: "border-box",
            }}
          />
        ) : props.kind === "language" ? (
          <Scroll t={t - s} />
        ) : (
          <Book t={t - s} />
        )}
      </div>
      <div
        style={{
          opacity: label,
          fontFamily: "'DBP Inter Caps', Inter, sans-serif",
          fontWeight: 600,
          fontSize: 16,
          letterSpacing: 2.4 + 0.8 * (1 - label),
          color: "rgba(255,255,255,0.85)",
          textTransform: "uppercase",
          marginBottom: 12,
        }}
      >
        {props.label}
      </div>
      <div
        style={{
          opacity: source,
          transform: `translateY(${(-12 * (1 - source)).toFixed(2)}px)`,
          fontFamily: "'DBP Literata', Georgia, serif",
          fontWeight: 400,
          fontSize: 32,
          lineHeight: 1.25,
          color: "#ffffff",
          textAlign: "center",
          maxWidth: 498,
        }}
      >
        {props.source}
      </div>
    </div>
  )
}
