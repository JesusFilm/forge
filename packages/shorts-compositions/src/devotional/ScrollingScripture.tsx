import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { continueRender, delayRender, Easing, interpolate } from "remotion"

import { SHORT_FONT_FAMILIES } from "../fonts"
import { TEASER_FONT_FAMILIES } from "./teaser-fonts"

/**
 * The film's narration as Scripture (owner's Figma "Video clip · Scrolling",
 * 2026-09-30): the chapter above a hairline, then the words set as numbered
 * verses that scroll slowly upward so the line being read stays in the
 * middle. The word being spoken turns gold and heavier; the text above and
 * below fades out to nothing.
 *
 * Positions come from the DOM, measured once after Literata has loaded: a
 * measurement taken with a fallback font would scroll every line to the
 * wrong place (docs/solutions: fonts load before measuring). The heavier
 * current word is a stroke, not a weight change, so it never reflows the
 * line it sits in.
 */

const SERIF = `'${TEASER_FONT_FAMILIES.literata}', Georgia, serif`
const GOLD = "#f2c46b"
// The chapter heading: PT Serif Italic (owner's Figma 380-2266).
const PT_SERIF = `'${SHORT_FONT_FAMILIES.ptSerif}', Georgia, serif`

export type ScriptureCue = {
  text: string
  startSec: number
  endSec: number
  words?: ReadonlyArray<number>
  verse?: string
}

type Word = { text: string; start: number }
type Verse = { num: number | null; words: Word[] }

/** Cues grouped into verses by their address; a cue with no address stays in
 *  the verse before it. Word times fall back to an even spread. */
export function scriptureVerses(cues: ReadonlyArray<ScriptureCue>): Verse[] {
  const verses: Verse[] = []
  for (const c of cues) {
    const tokens = c.text.split(/\s+/).filter(Boolean)
    const starts =
      c.words && c.words.length === tokens.length
        ? c.words
        : tokens.map(
            (_, i) =>
              c.startSec +
              ((c.endSec - c.startSec) * i) / Math.max(1, tokens.length),
          )
    const num = c.verse ? Number(c.verse.split(":")[1]) || null : null
    let v = verses[verses.length - 1]
    if (!v || (num != null && num !== v.num)) {
      v = { num, words: [] }
      verses.push(v)
    }
    tokens.forEach((text, i) => v.words.push({ text, start: starts[i] }))
  }
  return verses
}

export function ScrollingScripture({
  cues,
  t,
  frameWidth,
  frameHeight,
  bleedX = 0,
}: {
  cues: ReadonlyArray<ScriptureCue>
  t: number
  frameWidth: number
  frameHeight: number
  /** Landscape: the inset of the centred column this layer renders in. */
  bleedX?: number
}) {
  // Design units: the Figma frame is 1920 × 1080.
  const dp = (n: number) => (n * frameHeight) / 1080
  const verses = scriptureVerses(cues)
  const all = verses.flatMap((v) => v.words)
  const listRef = useRef<HTMLDivElement>(null)
  const [centres, setCentres] = useState<number[] | null>(null)
  const [handle] = useState(() => delayRender("Measuring the scripture layout"))

  useLayoutEffect(() => {
    let dead = false
    const font = `400 ${dp(56)}px ${SERIF}`
    document.fonts
      .load(font)
      .then(() => document.fonts.ready)
      .then(() => {
        if (dead || !listRef.current) return
        const spans = listRef.current.querySelectorAll<HTMLElement>("[data-w]")
        setCentres(
          Array.from(spans).map((s) => s.offsetTop + s.offsetHeight / 2),
        )
      })
      .catch(() => setCentres([]))
    return () => {
      dead = true
    }
    // Measured once: the layout does not change from frame to frame.
  }, [])
  // Released only after the measured positions are on screen.
  useEffect(() => {
    if (centres) continueRender(handle)
  }, [centres, handle])

  if (!all.length) return null
  // The word being spoken: the last one whose time has come.
  let k = -1
  for (let i = 0; i < all.length; i++) {
    if (all[i].start <= t) k = i
    else break
  }
  const lineH = dp(70)
  // Three lines on screen (owner's Figma 380-2266): a 224px window.
  const windowH = dp(224)
  // One continuous, slow drift (owner: "slow and smooth, not in jerks"):
  // each line reaches the middle halfway through its own reading, and the
  // text keeps moving between those moments instead of waiting and jumping.
  let y = 0
  if (centres && centres.length === all.length) {
    const keys: { at: number; y: number }[] = []
    let i = 0
    while (i < all.length) {
      let j = i
      while (
        j + 1 < all.length &&
        Math.abs(centres[j + 1] - centres[i]) < lineH / 2
      )
        j++
      const end = j + 1 < all.length ? all[j + 1].start : all[j].start + 0.6
      keys.push({ at: (all[i].start + end) / 2, y: centres[i] })
      i = j + 1
    }
    y =
      keys.length > 1
        ? interpolate(
            t,
            keys.map((k) => k.at),
            keys.map((k) => k.y),
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
          )
        : (keys[0]?.y ?? 0)
  }
  const first = cues[0]
  const last = cues[cues.length - 1]
  const opacity = interpolate(
    t,
    [
      first.startSec - 0.5,
      first.startSec,
      last.endSec + 0.3,
      last.endSec + 0.9,
    ],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  )
  if (opacity <= 0 && centres) return null
  const chapter = first.verse?.split(":")[0] ?? ""
  // The block is centred on the frame, 839 wide; nothing crosses the
  // hairline's ends, verse numbers included.
  const blockW = dp(839)
  const numW = dp(118)
  const left = frameWidth / 2 - blockW / 2 - bleedX
  let n = 0
  return (
    <div
      style={{ position: "absolute", inset: 0, opacity, pointerEvents: "none" }}
    >
      {/* The film behind the verses is softly blurred and darkened, only
          as far as the three lines reach, so it reads as depth rather than
          a smudge. */}
      <div
        style={{
          position: "absolute",
          left: left - dp(140),
          top: dp(640),
          width: blockW + dp(280),
          height: dp(420),
          backdropFilter: `blur(${dp(12)}px)`,
          WebkitBackdropFilter: `blur(${dp(12)}px)`,
          background: "rgba(0,0,0,0.26)",
          WebkitMaskImage:
            "radial-gradient(closest-side, #000 40%, transparent 100%)",
          maskImage:
            "radial-gradient(closest-side, #000 40%, transparent 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left,
          top: dp(657),
          width: blockW,
          display: "flex",
          flexDirection: "column",
          gap: dp(20),
        }}
      >
        <div
          style={{
            fontFamily: PT_SERIF,
            fontStyle: "italic",
            fontSize: dp(32),
            lineHeight: `${dp(50)}px`,
            color: "rgba(255,255,255,0.92)",
            opacity: 0.85,
          }}
        >
          {chapter}
        </div>
        <div
          style={{
            height: dp(2),
            borderRadius: dp(1),
            background: "rgba(255,255,255,0.35)",
          }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          left,
          top: dp(657 + 50 + 20 + 24),
          width: blockW,
          height: windowH,
          overflow: "hidden",
          WebkitMaskImage:
            "linear-gradient(180deg, transparent 0%, #000 30%, #000 70%, transparent 100%)",
          maskImage:
            "linear-gradient(180deg, transparent 0%, #000 30%, #000 70%, transparent 100%)",
        }}
      >
        <div
          ref={listRef}
          style={{
            position: "relative",
            transform: `translateY(${(windowH / 2 - y).toFixed(2)}px)`,
            display: "flex",
            flexDirection: "column",
            fontFamily: SERIF,
            fontSize: dp(56),
            lineHeight: 1.25,
            color: "rgba(255,255,255,0.92)",
            // Bright film (a sunlit field) washed the white verses out.
            textShadow: `0 ${dp(2)}px ${dp(16)}px rgba(0,0,0,0.55), 0 0 ${dp(3)}px rgba(0,0,0,0.5)`,
          }}
        >
          {verses.map((v, vi) => (
            <div key={vi} style={{ display: "flex" }}>
              <div
                style={{
                  width: numW,
                  flex: "none",
                  paddingLeft: dp(20),
                  color: "rgba(255,255,255,0.5)",
                }}
              >
                {v.num != null ? `${v.num}.` : ""}
              </div>
              <div style={{ width: blockW - numW }}>
                {v.words.map((w, wi) => {
                  const idx = n++
                  const on = idx === k
                  const next = all[idx + 1]?.start ?? w.start + 0.6
                  // Words not yet read wait in the background; the word
                  // being read lifts gently and settles (owner: gold on
                  // white alone was too quiet to follow).
                  const read = idx < k
                  // Knots stay strictly increasing however fast the words
                  // come: a quick word settles before the next one begins.
                  const settle = Math.min(0.4, Math.max(0.2, next - w.start))
                  const release = Math.max(next, w.start + settle + 0.01)
                  const pump = interpolate(
                    t,
                    [
                      w.start,
                      w.start + 0.12,
                      w.start + settle,
                      release,
                      release + 0.22,
                    ],
                    // 1.1 made a short word touch its neighbours ("giveme").
                    [1, 1.08, 1.04, 1.04, 1],
                    {
                      extrapolateLeft: "clamp",
                      extrapolateRight: "clamp",
                      easing: Easing.bezier(0.33, 0, 0.2, 1),
                    },
                  )
                  return (
                    <span key={wi}>
                      <span
                        data-w
                        style={{
                          display: "inline-block",
                          transformOrigin: "50% 60%",
                          transform: `scale(${pump.toFixed(4)})`,
                          color: on
                            ? GOLD
                            : read
                              ? "rgba(255,255,255,0.92)"
                              : "rgba(255,255,255,0.42)",
                          WebkitTextStroke: on
                            ? `${dp(1.1)}px ${GOLD}`
                            : undefined,
                        }}
                      >
                        {w.text}
                      </span>{" "}
                    </span>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
