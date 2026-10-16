import React from "react"
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion"

// The clip-first stepper of the 9:16 devotional (Stepper.tsx StepperLine,
// owner's Figma "Steps-animation"): the labels stacked with a thin rail
// between them. The move onto `step` is the rail drawing down from the step
// just done, then the label lighting gold, swelling a little and coming into
// focus; steps passed stay gold, steps ahead are dim and out of focus.
// Inter 600 caps (Latin + Cyrillic) is subset and embedded; build.mjs fills
// the placeholders.
const LATIN = "__INTER600CAPS__"
const CYRILLIC = "__INTER600CAPSCYR__"
const FAMILY = "'DBP Inter Caps', Inter, system-ui, sans-serif"
const GOLD = "#f2c46b"

function bytes(b64: string) {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}
const g = globalThis as unknown as { __dbpInterCaps?: boolean }
if (!g.__dbpInterCaps && typeof FontFace !== "undefined" && typeof document !== "undefined") {
  g.__dbpInterCaps = true
  for (const [data, range] of [
    [LATIN, "U+0020-007F,U+2018-2019"],
    [CYRILLIC, "U+0400-04FF"],
  ]) {
    const face = new FontFace("DBP Inter Caps", bytes(data), { weight: "600", unicodeRange: range })
    document.fonts.add(face)
    face.load().catch(() => {})
  }
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const smooth = (x: number) => {
  const c = clamp01(x)
  return c * c * (3 - 2 * c)
}
function hex(c: string) {
  const n = parseInt(c.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function mix(a: string, b: string, k: number) {
  const x = hex(a)
  const y = hex(b)
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * k)).join(",")})`
}

type Props = {
  steps: string
  step: number
  moveStartSec: number
  moveSec: number
  centerY: number
  fadeInSec: number
  fadeOutSec: number
}

export default function StepLine(props: Props) {
  const frame = useCurrentFrame()
  const { fps, durationInFrames, width: W } = useVideoConfig()
  const t = frame / fps
  const end = durationInFrames / fps
  // Design units of the Figma frame: 390 across.
  const px = (n: number) => (n * W) / 390
  const steps = props.steps
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  const cur = Math.max(0, Math.min(steps.length - 1, Math.round(props.step)))
  const travel = interpolate(t, [props.moveStartSec, props.moveStartSec + Math.max(0.1, props.moveSec)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  // The first step has nothing to travel from: it is simply lit.
  const p = cur <= 0 ? 1 : travel
  const drawn = smooth(p / 0.5)
  const lit = smooth((p - 0.5) / 0.5)
  const fade =
    interpolate(t, [0, Math.max(0.01, props.fadeInSec)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) *
    interpolate(t, [end - props.fadeOutSec, end], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })

  const size = px(20)
  const labelH = size * 1.2
  const railLen = px(72)
  const gap = px(10)
  const stackH = steps.length * labelH + (steps.length - 1) * (railLen + 2 * gap)
  const top0 = props.centerY - stackH / 2
  const labelTop = (i: number) => top0 + i * (labelH + 2 * gap + railLen)

  return (
    <div style={{ position: "absolute", inset: 0, opacity: fade, pointerEvents: "none" }}>
      {lit > 0 ? (
        <div
          style={{
            position: "absolute",
            left: W / 2 - px(120),
            top: labelTop(cur) + labelH / 2 - px(43),
            width: px(240),
            height: px(86),
            borderRadius: "50%",
            background: GOLD,
            opacity: 0.3 * lit,
            filter: `blur(${px(26)}px)`,
            mixBlendMode: "screen",
          }}
        />
      ) : null}
      {steps.map((label, i) => {
        const isCur = i === cur
        const ahead = i > cur
        const gold = isCur ? (cur === 0 ? 1 : lit) : i < cur ? 1 : 0
        const blur = isCur ? 1.9 * (1 - lit) * (cur === 0 ? 0 : 1) : ahead ? 1.9 * (i - cur) : 0
        const opacity = isCur ? 0.55 + 0.45 * (cur === 0 ? 1 : lit) : ahead ? 0.3 : 0.85
        const scale = isCur ? 1 + 0.07 * Math.sin(Math.PI * lit) : 1
        const glow = isCur ? (cur === 0 ? 1 : lit) : 0
        const passed = i < cur - 1
        const drawing = i === cur - 1
        const len = passed ? 1 : drawing ? drawn : 0
        const railGold = drawing ? 1 - lit : 0
        return (
          <React.Fragment key={i}>
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: labelTop(i),
                height: labelH,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity,
                filter: blur > 0.02 ? `blur(${px(blur)}px)` : undefined,
              }}
            >
              <span
                style={{
                  fontFamily: FAMILY,
                  fontWeight: 600,
                  fontSize: size,
                  letterSpacing: size * 0.13,
                  lineHeight: 1,
                  whiteSpace: "nowrap",
                  color: mix("#ffffff", GOLD, gold),
                  display: "inline-block",
                  transform: `scale(${scale})`,
                  textShadow: `0 0 ${px(16) * glow}px rgba(242,196,107,${0.65 * glow})`,
                }}
              >
                {label}
              </span>
            </div>
            {i < steps.length - 1 && len > 0 ? (
              <div
                style={{
                  position: "absolute",
                  left: W / 2 - px(1.7) / 2,
                  top: labelTop(i) + labelH + gap,
                  width: px(1.7),
                  height: railLen * len,
                  borderRadius: px(1.7),
                  // Gold and half-transparent while it draws, white once the
                  // step it leads to has lit.
                  background: mix("#ffffff", GOLD, railGold),
                  opacity: 0.5 + 0.05 * railGold,
                }}
              />
            ) : null}
          </React.Fragment>
        )
      })}
    </div>
  )
}
