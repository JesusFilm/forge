import React from "react"
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion"

// The closing question and prayer on one screen, left-aligned
// (DevotionalVideo questions card): a gold tracked label "FIRST, ASK
// YOURSELF", the question in Literata, a short gold rule, a second label
// "TALK TO GOD ABOUT IT", the prayer in Literata italic, smaller. The question
// unfolds letter by letter from questionAtSec, the prayer block from
// prayerAtSec; both stay up to the end. Fonts come from the font-pack items
// (font-literata400-*, font-literata400i-*, font-inter600caps-*).
const GOLD = "#e6a35c"
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const

type Props = {
  askLabel: string
  question: string
  prayLabel: string
  prayer: string
  questionAtSec: number
  prayerAtSec: number
  left: number
  top: number
  width: number
  fontSize: number
  fadeOutSec: number
}

function Letters({ text, t, at, per }: { text: string; t: number; at: number; per: number }) {
  return (
    <>
      {Array.from(text).map((c, i) => (
        <span key={i} style={{ opacity: interpolate(t, [at + i * per, at + i * per + 0.3], [0, 1], clamp) }}>
          {c}
        </span>
      ))}
    </>
  )
}

export default function PrayBlock(props: Props) {
  const frame = useCurrentFrame()
  const { fps, durationInFrames } = useVideoConfig()
  const t = frame / fps
  const end = durationInFrames / fps
  const out = interpolate(t, [end - props.fadeOutSec, end], [1, 0], clamp)
  const fs = props.fontSize
  const label = (text: string, at: number) => (
    <div
      style={{
        fontFamily: "'DBP Inter Caps', Inter, sans-serif",
        fontWeight: 600,
        fontSize: fs * 0.42,
        letterSpacing: fs * 0.08,
        color: GOLD,
        marginBottom: fs * 0.45,
        opacity: interpolate(t, [at, at + 0.5], [0, 1], clamp),
      }}
    >
      {text}
    </div>
  )
  // The question takes ~55% of the gap before the prayer; the prayer
  // unfolds over its first ~70% of what is left.
  const qPer = Math.max(0.02, ((props.prayerAtSec - props.questionAtSec) * 0.55) / Math.max(1, props.question.length))
  const pPer = Math.max(0.02, ((end - props.prayerAtSec) * 0.7) / Math.max(1, props.prayer.length))
  return (
    <div
      style={{
        position: "absolute",
        left: props.left,
        top: props.top,
        width: props.width,
        opacity: out,
        textAlign: "left",
        textShadow: "0 2px 16px rgba(0,0,0,0.45)",
      }}
    >
      {label(props.askLabel, props.questionAtSec)}
      <div style={{ fontFamily: "'DBP Literata', Georgia, serif", fontWeight: 400, fontSize: fs, lineHeight: 1.28, color: "#f4efe8" }}>
        <Letters text={props.question} t={t} at={props.questionAtSec + 0.3} per={qPer} />
      </div>
      <div
        style={{
          width: fs * 1.1,
          height: Math.max(2, fs * 0.05),
          background: GOLD,
          margin: `${fs * 0.7}px 0 ${fs * 0.55}px`,
          transformOrigin: "left center",
          transform: `scaleX(${interpolate(t, [props.prayerAtSec - 0.3, props.prayerAtSec + 0.3], [0, 1], clamp)})`,
        }}
      />
      {label(props.prayLabel, props.prayerAtSec)}
      <div
        style={{
          fontFamily: "'DBP Literata', Georgia, serif",
          fontStyle: "italic",
          fontWeight: 400,
          fontSize: fs * 0.82,
          lineHeight: 1.4,
          color: "rgba(244,239,232,0.9)",
        }}
      >
        <Letters text={props.prayer} t={t} at={props.prayerAtSec + 0.3} per={pPer} />
      </div>
    </div>
  )
}
