import React from "react"
import { useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion"

// History credit from the devotional fact shorts (Figma 427-2744): a tilted
// line-art book turning a page, then "Historical Context" in Literata over
// "SOURCE: <name>" in Inter caps, top left, arriving as a short cascade.
// Fades out over the last fadeOutSec of the item (the closing question
// stands alone). Fonts are subset and embedded: Studio cannot load files.
const LIT = "__LIT400__"
const INTER = "__INTER600CAPS__"
const toBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
let ready = false
function loadFonts() {
  if (ready || typeof document === "undefined" || typeof FontFace === "undefined") return
  ready = true
  for (const [family, data] of [["JFC Literata", LIT], ["JFC Inter", INTER]] as const) {
    const face = new FontFace(family, toBytes(data), family === "JFC Inter" ? { weight: "600" } : {})
    face.load().then((f) => (document as any).fonts.add(f)).catch(() => {})
    try {
      ;(document as any).fonts.add(face)
    } catch {}
  }
}
loadFonts()

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const
const OUT = Easing.bezier(0.2, 0.7, 0.2, 1)
const TURN = Easing.bezier(0.45, 0, 0.25, 1)
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
  const flips = [ph(0.9, 2.0), ph(2.3, 3.4)]
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

export default function HistoryCredit({
  title,
  source,
  fadeOutSec,
}: {
  title: string
  source: string
  fadeOutSec: number
}) {
  const frame = useCurrentFrame()
  const { fps, durationInFrames, width } = useVideoConfig()
  const f = (n: number) => (n * width) / 900
  const t = frame / fps
  const end = durationInFrames / fps
  const ease = (a: number, b: number) => interpolate(t, [a, b], [0, 1], { ...clamp, easing: OUT })
  const emblemIn = ease(0.1, 0.7)
  const titleIn = ease(0.35, 1.05)
  const sourceIn = ease(0.6, 1.3)
  const out = fadeOutSec > 0 ? interpolate(t, [end - fadeOutSec, end - 0.02], [1, 0], clamp) : 1
  const shadow = `0 ${f(2)}px ${f(12)}px rgba(0,0,0,0.5)`
  return (
    <div style={{ position: "absolute", top: f(251), left: f(96), display: "flex", alignItems: "flex-start", gap: f(16), opacity: out }}>
      <div style={{ width: f(95), height: f(77), display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <div
          style={{
            width: f(83),
            height: f(54),
            opacity: 0.85 * emblemIn,
            transform: `rotate(-17.26deg) translateY(${((1 - emblemIn) * f(10)).toFixed(2)}px) scale(${(0.88 + 0.12 * emblemIn).toFixed(4)})`,
          }}
        >
          <Book t={t} />
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: f(4), maxWidth: f(560) }}>
        <div
          style={{
            fontFamily: "'JFC Literata', Georgia, serif",
            fontSize: f(32),
            lineHeight: `${f(50)}px`,
            color: "rgba(255,255,255,0.92)",
            opacity: 0.85 * titleIn,
            transform: `translateY(${((1 - titleIn) * f(8)).toFixed(2)}px)`,
            whiteSpace: "nowrap",
            textShadow: shadow,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontFamily: "'JFC Inter', -apple-system, system-ui, sans-serif",
            fontWeight: 600,
            fontSize: f(20),
            letterSpacing: f(1.5),
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.6)",
            opacity: sourceIn,
            transform: `translateY(${((1 - sourceIn) * f(8)).toFixed(2)}px)`,
            textShadow: shadow,
          }}
        >
          Source: {source}
        </div>
      </div>
    </div>
  )
}
