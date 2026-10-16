import React from "react"
import { useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion"

// The verse the reflection is talking about (VerseCalloutOverlay.tsx, owner's
// Figma variant B, 2026-10-08): the verse in light italic serif, and the one
// phrase it turns on turning white with a gold rule drawn under it, left to
// right, at `litAtSec`; then the rule breathes a soft glow. A long verse
// shrinks to fit `maxHeight` instead of running into the subtitles below.
// Literata 400 italic is subset and embedded; build.mjs fills __FONT__ per
// language (Russian takes «guillemets», English “curly quotes”).
const FONT = "__FONT__"
const FAMILY = "'DBP Literata Italic', Georgia, serif"
const GOLD = "#f2c46b"
const REST = "rgba(255,255,255,0.92)"
const LINE = 1.25
/** A lit phrase is set on one line; longer than this it is not lit. */
const MAX_LIT_CHARS = 24

function bytes(b64: string) {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}
const g = globalThis as unknown as { __dbpLiterataItalic?: boolean }
if (!g.__dbpLiterataItalic && typeof FontFace !== "undefined" && typeof document !== "undefined") {
  g.__dbpLiterataItalic = true
  const face = new FontFace("DBP Literata Italic", bytes(FONT), { weight: "400", style: "italic" })
  document.fonts.add(face)
  face.load().catch(() => {})
}

/** Estimated, not measured (a measurement taken before the face loads is
 *  wrong): light italic Cyrillic runs ~0.66 em a character, Latin ~0.56,
 *  +10% for the slack of a greedy wrap. */
function fitSize(text: string, width: number, maxHeight: number, maxSize: number) {
  const em = /[А-Яа-яЁё]/.test(text) ? 0.66 : 0.56
  for (let size = maxSize; size > 24; size -= 2) {
    const lines = Math.ceil((text.length * em * size * 1.1) / width)
    if (lines * size * LINE <= maxHeight) return size
  }
  return 24
}

/** A verse lifted out of a speech keeps its closing quote mark; drop an
 *  unmatched one, and a pair that wraps the whole verse. */
function standalone(v: string) {
  const opens = (v.match(/[‘“]/g) ?? []).length
  const closes = (v.match(/[’”]/g) ?? []).length
  let out = v.trim()
  for (let k = closes - opens; k > 0; k--) out = out.replace(/[’”](?=[^’”]*$)/, "")
  if (/^[“‘«]/.test(out) && /[”’»]$/.test(out)) out = out.slice(1, -1)
  return out
}

type Props = {
  text: string
  highlight: string
  top: number
  width: number
  maxHeight: number
  maxFontSize: number
  litAtSec: number
  fadeOutSec: number
}

const EASE = Easing.bezier(0.4, 0, 0.2, 1)
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const

export default function VerseCallout(props: Props) {
  const frame = useCurrentFrame()
  const { fps, durationInFrames, width: W } = useVideoConfig()
  const t = frame / fps
  const dur = durationInFrames / fps
  const fade = (a: number, b: number) => interpolate(t, [a, b], [0, 1], { ...clamp, easing: EASE })
  const opacity = fade(0.1, 0.9) * (1 - fade(dur - props.fadeOutSec, dur - 0.05))
  const lit = fade(props.litAtSec, props.litAtSec + 0.7)
  const breath = 0.5 - 0.5 * Math.cos(((t - props.litAtSec - 0.7) / 1.8) * 2 * Math.PI)
  const glow = lit * (t > props.litAtSec + 0.7 ? 0.35 + 0.65 * breath : 0.35 * lit)

  const text = standalone(props.text)
  const hl = (props.highlight || "").trim()
  const at =
    hl && hl.length <= MAX_LIT_CHARS
      ? text
          .toLowerCase()
          .search(new RegExp(`(?<!\\p{L})${hl.toLowerCase().replace(/[^\p{L}' ]/gu, "")}(?!\\p{L})`, "u"))
      : -1
  const word = at >= 0 ? text.slice(at, at + hl.length) : ""
  const cyrillic = /[А-Яа-яЁё]/.test(text)
  const [open, close] = cyrillic ? ["«", "»"] : ["“", "”"]
  const size = fitSize(`${open}${text}${close}`, props.width, props.maxHeight, props.maxFontSize)
  const u = size / 56

  return (
    <div
      style={{
        position: "absolute",
        top: props.top,
        left: (W - props.width) / 2,
        width: props.width,
        opacity,
        transform: `translateY(${(10 * u * (1 - fade(0.1, 0.9))).toFixed(2)}px)`,
        pointerEvents: "none",
      }}
    >
      <p
        style={{
          margin: 0,
          textAlign: "center",
          fontFamily: FAMILY,
          fontStyle: "italic",
          fontWeight: 400,
          fontSize: size,
          lineHeight: LINE,
          color: REST,
          textShadow: "0 2px 18px rgba(0,0,0,0.55), 0 0 3px rgba(0,0,0,0.6)",
        }}
      >
        {open}
        {at >= 0 ? (
          <>
            {text.slice(0, at)}
            <span style={{ position: "relative", display: "inline-block", whiteSpace: "nowrap", color: "#ffffff" }}>
              {word}
              <span
                style={{
                  position: "absolute",
                  left: 0,
                  right: -4 * u,
                  top: "100%",
                  marginTop: -4 * u,
                  height: 5 * u,
                  background: GOLD,
                  transformOrigin: "left center",
                  transform: `rotate(-0.8deg) scaleX(${lit.toFixed(4)})`,
                  boxShadow: `0 0 ${(6 + 12 * glow) * u}px rgba(242,196,107,${(0.2 + 0.45 * glow).toFixed(3)})`,
                }}
              />
            </span>
            {text.slice(at + word.length)}
          </>
        ) : (
          text
        )}
        {close}
      </p>
    </div>
  )
}
