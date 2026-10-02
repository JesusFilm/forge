import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { continueRender, delayRender, Easing, interpolate } from "remotion"

import { SHORT_FONT_FAMILIES } from "../fonts"
import { loadLiterata, TEASER_FONT_FAMILIES } from "./teaser-fonts"

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
/** Darkness at the centre of the vertical layout's pool: the Figma's 0.6,
 *  raised a step so the verses hold over a bright frame (owner, 2026-10-02:
 *  "darken behind the verse so it reads"). */
const SCRIM_PEAK = 0.8
/** Plus an even dim over the whole film while the verses are up, so the
 *  waiting (grey) lines still read over a bright frame. */
const FRAME_DIM = 0.32
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

/**
 * Where the list should sit at `t`: one continuous, slow drift (owner: "slow
 * and smooth, not in jerks"). Each line reaches the middle halfway through
 * its own reading, and the text keeps moving between those moments instead
 * of waiting and jumping. `centres` are the words' vertical centres as laid
 * out.
 */
export function scriptureScrollY(
  words: ReadonlyArray<{ start: number }>,
  centres: ReadonlyArray<number>,
  t: number,
  lineH: number,
): number {
  if (!words.length || centres.length !== words.length) return 0
  const keys: { at: number; y: number }[] = []
  let i = 0
  while (i < words.length) {
    let j = i
    while (
      j + 1 < words.length &&
      Math.abs(centres[j + 1] - centres[i]) < lineH / 2
    )
      j++
    const end = j + 1 < words.length ? words[j + 1].start : words[j].start + 0.6
    const at = (words[i].start + end) / 2
    // Keep the knots strictly increasing even for a line read in no time.
    const prev = keys[keys.length - 1]
    keys.push({
      at: prev && at <= prev.at ? prev.at + 0.001 : at,
      y: centres[i],
    })
    i = j + 1
  }
  return keys.length > 1
    ? interpolate(
        t,
        keys.map((key) => key.at),
        keys.map((key) => key.y),
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
      )
    : keys[0].y
}

export function ScrollingScripture({
  cues,
  t,
  frameWidth,
  frameHeight,
  bleedX = 0,
  unit,
  topPx,
  layout = "wide",
}: {
  cues: ReadonlyArray<ScriptureCue>
  t: number
  frameWidth: number
  frameHeight: number
  /** Landscape: the inset of the centred column this layer renders in. */
  bleedX?: number
  /** Pixels per design unit. Defaults to the 16:9 frame (height / 1080);
   *  a 9:16 short passes width / 1080 so the 839-wide block still fits. */
  unit?: number
  /** Top of the chapter line, px. Defaults to the 16:9 spot (657 units);
   *  a 9:16 short sets it below the film window. */
  topPx?: number
  /** `vertical`: the 9:16 film short over full-frame film (owner's Figma
   *  "Video clip · Scrolling (vert)", 411-2366, a 900 x 1600 frame): a
   *  660-wide block centred on the frame, five lines visible, a soft dark
   *  pool behind it, and the verse range ("Luke 15:22-24") as its heading. */
  layout?: "wide" | "vertical"
}) {
  const vertical = layout === "vertical"
  // Design units: the Figma frame is 1920 x 1080 (vertical: 900 x 1600).
  const dp = (n: number) =>
    n * (vertical ? frameWidth / 900 : (unit ?? frameHeight / 1080))
  // Vertical: the whole block (heading 50, gap 20, rule 2, gap 24, window
  // 383) is centred on the frame, as drawn.
  const top0 = vertical
    ? frameHeight / 2 - dp(50 + 20 + 2 + 24 + 383) / 2 + dp(0.5)
    : (topPx ?? dp(657))
  const verses = scriptureVerses(cues)
  const all = verses.flatMap((v) => v.words)
  const listRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [handle] = useState(() => delayRender("Loading the scripture face"))

  // Wait for Literata itself, not just for "fonts ready": the face is
  // registered asynchronously, and a layout read before it lands wraps the
  // verses in the narrower fallback. That is how the first render drifted a
  // line behind every minute (owner, 2026-09-30).
  useEffect(() => {
    let dead = false
    loadLiterata()
      .then(() => document.fonts.load(`400 ${dp(56)}px ${SERIF}`))
      .then(() => document.fonts.ready)
      .then(() => {
        if (!dead) setReady(true)
      })
      .catch(() => {
        if (!dead) setReady(true)
      })
    return () => {
      dead = true
    }
    // Once per mount.
  }, [])
  useEffect(() => {
    if (ready) continueRender(handle)
  }, [ready, handle])

  const lineH = dp(70)
  // Three lines on screen (owner's Figma 380-2266): a 224px window.
  const windowH = vertical ? dp(383) : dp(224)

  // Positions are read from the laid-out page on EVERY frame, never cached:
  // nothing measured under another font or width can steer the scroll.
  useLayoutEffect(() => {
    const list = listRef.current
    if (!ready || !list) return
    const spans = list.querySelectorAll<HTMLElement>("[data-w]")
    const centres = Array.from(spans).map(
      (el) => el.offsetTop + el.offsetHeight / 2,
    )
    const y = scriptureScrollY(all, centres, t, lineH)
    list.style.transform = `translateY(${(windowH / 2 - y).toFixed(2)}px)`
  })

  if (!all.length) return null
  // The word being spoken: the last one whose time has come.
  let k = -1
  for (let i = 0; i < all.length; i++) {
    if (all[i].start <= t) k = i
    else break
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
  if (opacity <= 0 && ready) return null
  const chapter = first.verse?.split(":")[0] ?? ""
  // Vertical: the verses actually on screen, "Luke 15:22-24".
  const nums = verses.flatMap((v) => (v.num != null ? [v.num] : []))
  const heading =
    vertical && chapter && nums.length
      ? `${chapter}:${nums[0]}${nums.length > 1 ? `-${nums[nums.length - 1]}` : ""}`
      : chapter
  // The block is centred on the frame, 839 wide (vertical: 660); nothing
  // crosses the hairline's ends, verse numbers included.
  const blockW = vertical ? dp(660) : dp(839)
  const numW = dp(118)
  const left = frameWidth / 2 - blockW / 2 - bleedX
  let n = 0
  return (
    <div
      style={{ position: "absolute", inset: 0, opacity, pointerEvents: "none" }}
    >
      {/* The film behind the verses is softly blurred and darkened, only
          as far as the three lines reach, so it reads as depth rather than
          a smudge. Vertical: the Figma's soft dark pool instead. */}
      {vertical ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `rgba(0,0,0,${FRAME_DIM})`,
          }}
        />
      ) : null}
      {vertical ? (
        <div
          style={{
            position: "absolute",
            left: frameWidth / 2 - dp(450),
            top: frameHeight / 2 + dp(19.5) - dp(379.5),
            width: dp(900),
            height: dp(759),
            borderRadius: dp(100),
            filter: `blur(${dp(36.65)}px)`,
            background: `radial-gradient(${dp(490.7)}px ${dp(413.8)}px at 50% 50%, rgba(0,0,0,${SCRIM_PEAK}) 0%, rgba(0,0,0,0) 100%)`,
          }}
        />
      ) : null}
      <div
        hidden={vertical}
        style={{
          position: "absolute",
          left: left - dp(140),
          top: top0 - dp(17),
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
          top: top0,
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
          {heading}
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
          top: top0 + dp(50 + 20 + 24),
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
