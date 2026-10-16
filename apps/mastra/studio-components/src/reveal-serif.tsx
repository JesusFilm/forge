import React from "react"
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion"

// The long form's reflection sentence for Studio (DevotionalVideo WordReveal):
// the whole sentence is laid out, each word fades in as the voice says it,
// lands gold and cools to the body colour; a highlight phrase stays gold.
// Literata 400 is subset and embedded (Studio components cannot load font
// files); build.mjs fills __FONT__ per language.
const FONT = "__FONT__"
const FAMILY = "'DBP Literata', Georgia, serif"
const GOLD = "#f2c46b"

function bytes(b64: string) {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}
const g = globalThis as unknown as { __dbpLiterata?: boolean }
if (!g.__dbpLiterata && typeof FontFace !== "undefined" && typeof document !== "undefined") {
  g.__dbpLiterata = true
  const face = new FontFace("DBP Literata", bytes(FONT), { weight: "400" })
  document.fonts.add(face)
  face.load().catch(() => {})
}

function hex(c: string) {
  const n = parseInt(c.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function mix(a: string, b: string, k: number) {
  const x = hex(a)
  const y = hex(b)
  const m = x.map((v, i) => Math.round(v + (y[i] - v) * k))
  return `rgb(${m[0]},${m[1]},${m[2]})`
}

type Props = {
  text: string
  wordTimes: string
  highlight: string
  fontSize: number
  top: number
  width: number
  color: string
  fadeOutSec: number
}

export default function RevealSerif(props: Props) {
  const frame = useCurrentFrame()
  const { fps, durationInFrames, width: W } = useVideoConfig()
  const t = frame / fps
  const words = props.text.split(/\s+/).filter(Boolean)
  const times = props.wordTimes
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n))
  const hl = (props.highlight || "").toLowerCase().split(/\s+/).filter(Boolean)
  // Which words belong to the highlight phrase (first occurrence).
  const lit = new Set<number>()
  if (hl.length) {
    const clean = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "")
    for (let i = 0; i + hl.length <= words.length; i++) {
      if (hl.every((h, k) => clean(words[i + k]) === h.replace(/[^\p{L}\p{N}']/gu, ""))) {
        for (let k = 0; k < hl.length; k++) lit.add(i + k)
        break
      }
    }
  }
  const end = durationInFrames / fps
  const out = interpolate(t, [end - props.fadeOutSec, end], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  const last = times.length ? times[times.length - 1] : 0
  // No word times at all (e.g. Studio narration without alignment): spread
  // the words evenly over the item, leaving its last 0.6 s for the reading.
  const step = times.length ? 0.3 : Math.max(0.12, (end - 0.6) / Math.max(1, words.length))
  return (
    <div
      style={{
        position: "absolute",
        left: (W - props.width) / 2,
        width: props.width,
        top: props.top,
        transform: "translateY(-50%)",
        textAlign: "center",
        fontFamily: FAMILY,
        fontWeight: 400,
        fontSize: props.fontSize,
        lineHeight: 1.3,
        opacity: out,
        textShadow: "0 2px 18px rgba(0,0,0,0.55), 0 0 3px rgba(0,0,0,0.6)",
      }}
    >
      {words.map((w, i) => {
        // No time for this word: spread the rest after the last known one.
        const at = times.length
          ? (times[i] ?? last + (i - times.length + 1) * step)
          : i * step
        const a = interpolate(t, [at - 0.04, at + 0.14], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
        const cool = interpolate(t, [at + 0.14, at + 0.56], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
        const color = lit.has(i) ? GOLD : mix(GOLD, props.color, cool)
        return (
          <span key={i} style={{ opacity: a, color }}>
            {w}
            {i < words.length - 1 ? " " : ""}
          </span>
        )
      })}
    </div>
  )
}
