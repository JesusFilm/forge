import { Easing, interpolate, interpolateColors } from "remotion"

import type { DevotionalCard } from "./schema"
import type { CardFrames } from "./timing"

/**
 * The verse an original-language note is about, at the top of the 16:9 frame
 * with the one word it turns on lit in gold (owner's Figma "Reflection card ·
 * Greek", 2026-09-30): the listener sees where the word sits while the voice
 * explains it. Drawn once across all the consecutive cards that carry the
 * same verse, so it does not blink with each sentence.
 *
 * Figma numbers on a 1920x1080 frame: italic serif 56px, 1.25 line height,
 * 753px measure, top 284; the word bold italic #F2C46B.
 */
const EASE = Easing.bezier(0.4, 0, 0.2, 1)
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const
const GOLD = "#F2C46B"
const REST = "rgba(255,255,255,0.92)"

/** A verse lifted out of a speech keeps its closing quote mark; drop an
 *  unmatched one so the callout does not end on a stray mark. */
function standalone(v: string) {
  const opens = (v.match(/[‘“]/g) ?? []).length
  const closes = (v.match(/[’”]/g) ?? []).length
  let out = v.trim()
  for (let k = closes - opens; k > 0; k--)
    out = out.replace(/[’”](?=[^’”]*$)/, "")
  return out
}

export function VerseCalloutOverlay({
  cards,
  frames,
  frame,
  fps,
  px,
  serif,
}: {
  cards: ReadonlyArray<DevotionalCard>
  frames: ReadonlyArray<CardFrames>
  frame: number
  fps: number
  px: (n: number) => number
  serif: string
}) {
  const u = (n: number) => px((n * 390) / 1080)
  for (let j = 0; j < cards.length; j++) {
    const c = cards[j].verseCallout
    if (!c || cards[j - 1]?.verseCallout?.text === c.text) continue
    let k = j
    while (cards[k + 1]?.verseCallout?.text === c.text) k++
    const start = frames[j].from
    const end = frames[k].from + frames[k].durationInFrames
    if (frame < start || frame >= end) continue
    const t = (frame - start) / fps
    const dur = (end - start) / fps
    const fade = (a: number, b: number) =>
      interpolate(t, [a, b], [0, 1], { ...clamp, easing: EASE })
    const opacity = fade(0.1, 0.9) * (1 - fade(dur - 0.7, dur - 0.1))
    const lit = fade(0.9, 1.6)
    const text = standalone(c.text)
    const at = c.highlight
      ? text
          .toLowerCase()
          .search(
            new RegExp(
              `\\b${c.highlight.toLowerCase().replace(/[^a-z' ]/g, "")}\\b`,
            ),
          )
      : -1
    const word = at >= 0 ? text.slice(at, at + c.highlight.length) : ""
    return (
      <div
        style={{
          position: "absolute",
          top: u(284),
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          pointerEvents: "none",
          opacity,
          transform: `translateY(${(u(10) * (1 - fade(0.1, 0.9))).toFixed(2)}px)`,
        }}
      >
        <p
          style={{
            margin: 0,
            width: u(753),
            textAlign: "center",
            fontFamily: serif,
            fontStyle: "italic",
            fontWeight: 400,
            fontSize: u(56),
            lineHeight: 1.25,
            color: REST,
            textShadow: "0 2px 18px rgba(0,0,0,0.55), 0 0 3px rgba(0,0,0,0.6)",
          }}
        >
          {"“"}
          {at >= 0 ? (
            <>
              {text.slice(0, at)}
              <span
                style={{
                  fontWeight: 700,
                  color: interpolateColors(lit, [0, 1], [REST, GOLD]),
                }}
              >
                {word}
              </span>
              {text.slice(at + word.length)}
            </>
          ) : (
            text
          )}
          {"”"}
        </p>
      </div>
    )
  }
  return null
}
