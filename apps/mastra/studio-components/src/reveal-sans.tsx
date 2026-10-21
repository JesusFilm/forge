import React from "react"
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion"

// The long form's reflection sentence for Studio, as DevotionalVideo draws it
// (reflection-focus card + WordReveal): Inter 400, line height 1.46, each
// word fades in as the voice says it, lands in the accent colour and settles
// to the body colour over 0.42 s; a highlight phrase keeps the accent. Owner
// rule: the reflection body stays on Inter (it is the longest reading in the
// piece); Literata is for the title, takeaway, question and prayer. Inter 400
// is subset and embedded (Studio components cannot load font files);
// build.mjs fills __FONT__ per language.
const FONT = "__FONT__"
const FAMILY = "'DBP Inter', -apple-system, system-ui, sans-serif"
const SETTLE_SEC = 0.42

function bytes(b64: string) {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}
const g = globalThis as unknown as { __dbpInter400?: boolean }
if (!g.__dbpInter400 && typeof FontFace !== "undefined" && typeof document !== "undefined") {
  g.__dbpInter400 = true
  const face = new FontFace("DBP Inter", bytes(FONT), { weight: "400" })
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
  align: string
  color: string
  accentColor: string
  fadeOutSec: number
}

export default function RevealSans(props: Props) {
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
  // A zero-length fade would hand interpolate a non-increasing range and
  // fail the whole Studio render.
  const fade = Math.max(0.01, props.fadeOutSec)
  const out = interpolate(t, [end - fade, end], [1, 0], {
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
        textAlign: props.align === "center" ? "center" : "left",
        fontFamily: FAMILY,
        fontWeight: 400,
        fontSize: props.fontSize,
        lineHeight: 1.46,
        opacity: out,
        textShadow: "0 2px 18px rgba(0,0,0,0.55), 0 0 3px rgba(0,0,0,0.6)",
      }}
    >
      {words.map((w, i) => {
        // No time for this word: spread the rest after the last known one.
        const at = times.length
          ? (times[i] ?? last + (i - times.length + 1) * step)
          : i * step
        const a = interpolate(t, [at - 0.06, at + 0.12], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
        const warm = Math.min(
          interpolate(t, [at - 0.06, at + 0.06], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          interpolate(t, [at + 0.06, at + 0.06 + SETTLE_SEC], [1, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        )
        const color = lit.has(i) ? props.accentColor : mix(props.color, props.accentColor, warm)
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
