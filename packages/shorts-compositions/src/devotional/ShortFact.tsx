import { useLayoutEffect, useRef, useState } from "react"
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  interpolate,
  interpolateColors,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion"

import { loadShortFonts, SHORT_FONT_FAMILIES } from "../fonts"
import type { DevotionalCard, DevotionalInputProps } from "./schema"
import { AnimatedBook, AnimatedScroll } from "./SourceEmblems"
import { SOURCE_PORTRAIT_URIS, type SourcePortraitId } from "./source-portraits"
import { loadLiterata, TEASER_FONT_FAMILIES } from "./teaser-fonts"
import { CARD_TAIL_FRAMES, framesFromDurations } from "./timing"

/**
 * Fact shorts cut from a devotional (feat-573): one credited thought over the
 * film, about fifteen seconds. Two layouts from the owner's Figma (a 900 x
 * 1600 frame; every number below is a Figma px, converted by `f`):
 *
 * `history` (413-2407): the credit at the top (emblem, label, source), a
 *   hairline, then the narration as kinetic captions in Inter 61.
 * `language` (414-2523): the verse on screen from the first frame between
 *   large gold quote marks; when the voice reaches the word, it turns gold
 *   and a hand-drawn ring draws round it, then breathes. The narration runs
 *   underneath one word at a time in gold Inter Bold caps, short words
 *   riding with the next one. No source on screen: it goes in the caption.
 *
 * Its own small composition rather than another mode of DevotionalVideo, so
 * nothing here can move a long-form devotional.
 */

export const DEVOTIONAL_SHORT_COMPOSITION_ID = "devotional-short"

const SANS = `'${SHORT_FONT_FAMILIES.inter}', -apple-system, system-ui, sans-serif`
const LITERATA = `'${TEASER_FONT_FAMILIES.literata}', Georgia, serif`
const PT_SERIF = `'${SHORT_FONT_FAMILIES.ptSerif}', Georgia, serif`
const GOLD = "#f2c46b"
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const
const EASE_OUT = Easing.bezier(0.2, 0.7, 0.2, 1)

type Word = { word: string; startSec: number; endSec: number }
/** A word on the short's own clock (seconds from frame 0). */
type TimedWord = Word & { card: number }

function wordsOnClock(
  cards: ReadonlyArray<DevotionalCard>,
  fromFrames: ReadonlyArray<number>,
  fps: number,
): TimedWord[] {
  return cards.flatMap((c, i) =>
    ((c.words ?? []) as Word[]).map((w) => ({
      word: w.word,
      startSec: fromFrames[i] / fps + w.startSec,
      endSec: fromFrames[i] / fps + w.endSec,
      card: i,
    })),
  )
}

export function DevotionalShortFact(props: DevotionalInputProps) {
  loadShortFonts()
  loadLiterata()
  const frame = useCurrentFrame()
  const { fps, width, height, durationInFrames } = useVideoConfig()
  const f = (n: number) => (n * width) / 900
  const fact = props.shortFact
  const frames = framesFromDurations(
    props.cards,
    fps,
    CARD_TAIL_FRAMES,
    Math.round((props.outroHoldSec ?? 1.5) * fps),
    0,
  )
  const words = wordsOnClock(
    props.cards,
    frames.map((x) => x.from),
    fps,
  )
  const t = frame / fps
  const total = durationInFrames / fps
  // Soft in from black, out to black over the last 0.6s.
  const blackout = interpolate(
    frame,
    [
      0,
      Math.round(0.3 * fps),
      durationInFrames - Math.round(0.6 * fps),
      durationInFrames,
    ],
    [1, 0, 0, 1],
    clamp,
  )
  const language = fact?.layout === "language"
  const reflection = fact?.layout === "reflection"

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {props.bgFile ? (
        <AbsoluteFill
          style={{
            transform: `scale(${interpolate(frame, [0, durationInFrames], [1.04, 1.1])})`,
          }}
        >
          <OffthreadVideo
            src={staticFile(props.bgFile)}
            muted
            trimBefore={Math.round((props.bgStartOffsetSec ?? 0) * fps)}
            playbackRate={props.bgPlaybackRate ?? 1}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </AbsoluteFill>
      ) : null}
      {/* An even dim, then the Figma's soft dark pool behind the text. */}
      <AbsoluteFill style={{ background: "rgba(0,0,0,0.28)" }} />
      <div
        style={{
          position: "absolute",
          left: width / 2 - f(450),
          top: height / 2 + f(language || reflection ? -92.5 : 19.5) - f(379.5),
          width: f(900),
          height: f(759),
          borderRadius: f(100),
          filter: `blur(${f(36.65)}px)`,
          background: `radial-gradient(${f(490.7)}px ${f(413.8)}px at 50% 50%, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0) 100%)`,
        }}
      />
      {props.cards.map((c, i) =>
        c.audioFile ? (
          <Sequence
            key={i}
            from={frames[i].from}
            durationInFrames={frames[i].durationInFrames}
          >
            <Audio src={staticFile(c.audioFile)} />
          </Sequence>
        ) : null,
      )}
      {reflection ? (
        <ReflectionLayout
          f={f}
          t={t}
          total={total}
          words={words}
          credit={
            fact?.source
              ? {
                  label: fact.label,
                  source: fact.source,
                  portrait: fact.portrait,
                }
              : undefined
          }
        />
      ) : language ? (
        <LanguageLayout
          f={f}
          t={t}
          words={words}
          verse={fact?.verse ?? ""}
          highlight={fact?.highlight ?? ""}
        />
      ) : (
        <HistoryLayout
          f={f}
          t={t}
          total={total}
          words={words}
          label={fact?.label ?? "Historical context"}
          source={fact?.source ?? ""}
          emblem={fact?.emblem ?? "book"}
        />
      )}
      <AbsoluteFill
        style={{ background: "#000", opacity: blackout, pointerEvents: "none" }}
      />
    </AbsoluteFill>
  )
}

// --- history -------------------------------------------------------------

/**
 * The narration in short phrases, one sentence (card) at a time: a sentence
 * that fits in about two lines stays whole; a longer one is cut into pieces
 * of even length, at a comma where one is close, so no piece is a stranded
 * word ("up."). Each phrase owns the screen until the next one begins.
 */
export function kineticPhrases(
  words: ReadonlyArray<TimedWord>,
  maxChars = 40,
): TimedWord[][] {
  const out: TimedWord[][] = []
  const text = (ws: ReadonlyArray<TimedWord>) => ws.map((w) => w.word).join(" ")
  const byCard: TimedWord[][] = []
  for (const w of words) {
    const last = byCard[byCard.length - 1]
    if (last && last[0].card === w.card) last.push(w)
    else byCard.push([w])
  }
  for (const sentence of byCard) {
    const total = text(sentence).length
    if (total <= maxChars + 8) {
      out.push(sentence)
      continue
    }
    const pieces = Math.ceil(total / maxChars)
    const target = total / pieces
    let cur: TimedWord[] = []
    sentence.forEach((w, i) => {
      cur.push(w)
      const len = text(cur).length
      const rest = sentence.length - i - 1
      const atComma = /[,;:]$/.test(w.word) && len >= target * 0.6
      if (rest > 1 && (atComma || len >= target)) {
        out.push(cur)
        cur = []
      }
    })
    if (cur.length) out.push(cur)
  }
  return out
}

function HistoryLayout({
  f,
  t,
  total,
  words,
  label,
  source,
  emblem,
}: {
  f: (n: number) => number
  t: number
  total: number
  words: TimedWord[]
  label: string
  source: string
  emblem: "book" | "scroll"
}) {
  const head = interpolate(t, [0.1, 0.8], [0, 1], {
    ...clamp,
    easing: EASE_OUT,
  })
  return (
    <div
      style={{
        position: "absolute",
        top: f(353),
        left: "50%",
        width: f(747),
        transform: "translateX(-50%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: f(56),
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: f(36),
          opacity: head,
          transform: `translateY(${(1 - head) * f(12)}px)`,
        }}
      >
        <div
          style={{
            width: f(101.6),
            height: f(66.7) * 1.1,
            transform: "rotate(-10.15deg)",
            opacity: 0.85,
          }}
        >
          {emblem === "scroll" ? (
            <AnimatedScroll t={t} />
          ) : (
            <AnimatedBook t={t} />
          )}
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: f(4),
          }}
        >
          <div
            style={{
              fontFamily: SANS,
              fontWeight: 500,
              fontSize: f(18),
              letterSpacing: f(2),
              color: "rgba(255,255,255,0.5)",
              textTransform: "uppercase",
            }}
          >
            {label}
          </div>
          <div
            style={{
              fontFamily: LITERATA,
              fontSize: f(36),
              lineHeight: `${f(50)}px`,
              color: "rgba(255,255,255,0.92)",
              opacity: 0.85,
              textAlign: "center",
              width: f(520),
            }}
          >
            {source}
          </div>
        </div>
      </div>
      <div
        style={{
          width: f(499) * head,
          height: Math.max(1, f(2)),
          background: "rgba(255,255,255,0.35)",
        }}
      />
      <KineticText f={f} t={t} total={total} words={words} />
    </div>
  )
}

/** Up to this many words, a sentence is a short line: stamped in large caps
 *  (the long form's short-line treatment, owner 2026-09-30 / 10-01). */
const STAMP_WORDS = 4

/**
 * The narration as centred captions. A long sentence arrives word by word,
 * each word rising out of a blur with the voice; only the words already
 * heard are laid out, so every line stays centred as it grows (owner,
 * 2026-10-02: the invisible words used to push the line off-centre). A short
 * sentence lands whole, larger, in capitals, out of a blur and wide tracking.
 */
function KineticText({
  f,
  t,
  total,
  words,
  minLines = 3,
}: {
  f: (n: number) => number
  t: number
  total: number
  words: TimedWord[]
  minLines?: number
}) {
  const phrases = kineticPhrases(words)
  const at = phrases.findIndex((p, i) => {
    const next = phrases[i + 1]
    return t >= p[0].startSec - 0.05 && (!next || t < next[0].startSec - 0.05)
  })
  const phrase = at >= 0 ? phrases[at] : null
  const nextStart = at >= 0 ? (phrases[at + 1]?.[0].startSec ?? total + 1) : 0
  const out = interpolate(
    t,
    [nextStart - 0.16, nextStart - 0.04],
    [1, 0],
    clamp,
  )
  const sentence = phrase ? words.filter((w) => w.card === phrase[0].card) : []
  const stamp = phrase != null && sentence.length <= STAMP_WORDS
  const box = {
    minHeight: f(89) * minLines,
    width: "100%",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    opacity: out,
  } as const
  if (!phrase) return <div style={box} />
  if (stamp) {
    const p = interpolate(
      t,
      [phrase[0].startSec - 0.02, phrase[0].startSec + 0.78],
      [0, 1],
      {
        ...clamp,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
      },
    )
    return (
      <div style={box}>
        <p
          style={{
            margin: 0,
            fontFamily: SANS,
            fontWeight: 600,
            fontSize: f(76),
            lineHeight: 1.2,
            textAlign: "center",
            textTransform: "uppercase",
            letterSpacing: f(3.2 + 7 * (1 - p)),
            color: "#ffffff",
            opacity: p,
            transform: `scale(${(0.96 + 0.04 * p).toFixed(4)})`,
            filter:
              p < 0.99 ? `blur(${(f(7) * (1 - p)).toFixed(2)}px)` : undefined,
            textShadow: `0 ${f(2)}px ${f(22)}px rgba(0,0,0,0.6)`,
          }}
        >
          {sentence.map((w) => w.word).join(" ")}
        </p>
      </div>
    )
  }
  const heard = phrase.filter((w) => t >= w.startSec - 0.04)
  return (
    <div style={box}>
      <p
        style={{
          margin: 0,
          fontFamily: SANS,
          fontSize: f(61),
          lineHeight: `${f(89)}px`,
          color: "#eae6df",
          textAlign: "center",
          textShadow: `0 ${f(2)}px ${f(18)}px rgba(0,0,0,0.5)`,
        }}
      >
        {heard.map((w, i) => {
          const p = interpolate(
            t,
            [w.startSec - 0.04, w.startSec + 0.26],
            [0, 1],
            {
              ...clamp,
              easing: EASE_OUT,
            },
          )
          return (
            <span key={i}>
              {i > 0 ? " " : null}
              <span
                style={{
                  display: "inline-block",
                  opacity: p,
                  filter: `blur(${((1 - p) * f(10)).toFixed(2)}px)`,
                  transform: `translateY(${((1 - p) * f(22)).toFixed(2)}px) scale(${(1.08 - 0.08 * p).toFixed(4)})`,
                }}
              >
                {w.word}
              </span>
            </span>
          )
        })}
      </p>
    </div>
  )
}

// --- reflection ------------------------------------------------------------

/**
 * Figma 415-2610: the narration centred, and, only when the run quotes a
 * credited source, the credit beneath it (round portrait, label, name with
 * life dates).
 */
function ReflectionLayout({
  f,
  t,
  total,
  words,
  credit,
}: {
  f: (n: number) => number
  t: number
  total: number
  words: TimedWord[]
  credit?: { label?: string; source?: string; portrait?: string } | undefined
}) {
  const uri =
    credit?.portrait && credit.portrait in SOURCE_PORTRAIT_URIS
      ? SOURCE_PORTRAIT_URIS[credit.portrait as SourcePortraitId]
      : null
  const head = interpolate(t, [0.2, 0.9], [0, 1], {
    ...clamp,
    easing: EASE_OUT,
  })
  return (
    <>
      <div
        style={{
          position: "absolute",
          top: f(614),
          left: "50%",
          width: f(705),
          transform: "translateX(-50%)",
        }}
      >
        <KineticText f={f} t={t} total={total} words={words} />
      </div>
      {credit?.source ? (
        <div
          style={{
            position: "absolute",
            top: f(614 + 89 * 3 + 145),
            left: "50%",
            width: f(705),
            transform: `translateX(-50%) translateY(${(1 - head) * f(10)}px)`,
            display: "flex",
            gap: f(20),
            alignItems: "center",
            opacity: head,
          }}
        >
          {uri ? (
            <Img
              src={uri}
              style={{
                width: f(124),
                height: f(124),
                borderRadius: "50%",
                objectFit: "cover",
                opacity: 0.85,
              }}
            />
          ) : null}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: f(4),
              width: f(320),
            }}
          >
            <div
              style={{
                fontFamily: SANS,
                fontWeight: 500,
                fontSize: f(18),
                letterSpacing: f(3.5),
                color: "rgba(255,255,255,0.46)",
                textTransform: "uppercase",
              }}
            >
              {credit.label ?? "Commentary"}
            </div>
            <div
              style={{
                fontFamily: LITERATA,
                fontSize: f(36),
                lineHeight: `${f(50)}px`,
                color: "rgba(255,255,255,0.92)",
                opacity: 0.85,
              }}
            >
              {credit.source}
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

// --- language ------------------------------------------------------------

const JOIN = new Set(
  "a an the to of in on at by for and but or is it as be so if my his her our its".split(
    " ",
  ),
)

/** The narration as caption tokens: one word each, a short function word
 *  riding with the word after it ("THE WORD", "TO CELEBRATE"). */
export function captionTokens(words: ReadonlyArray<TimedWord>): TimedWord[] {
  const out: TimedWord[] = []
  let pending: TimedWord | null = null
  for (const w of words) {
    const bare = w.word.toLowerCase().replace(/[^a-z']/g, "")
    if (pending && pending.card === w.card) {
      out.push({
        ...w,
        word: `${pending.word} ${w.word}`,
        startSec: pending.startSec,
      })
      pending = null
      continue
    }
    if (pending) out.push(pending)
    pending = JOIN.has(bare) && !/[,;:.!?]$/.test(w.word) ? w : null
    if (!pending) out.push(w)
  }
  if (pending) out.push(pending)
  return out
}

/** A loose hand-drawn ring round a w x h box: an ellipse that overshoots its
 *  start, wobbling a little in radius like a pen stroke. */
function ringPath(w: number, h: number): string {
  const cx = w / 2
  const cy = h / 2
  const rx = w / 2 + h * 0.42
  const ry = h / 2 + h * 0.24
  const pts: string[] = []
  const turns = 1.12
  const n = 64
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI * 0.62 + (i / n) * Math.PI * 2 * turns
    const wob = 1 + 0.035 * Math.sin(a * 3 + 0.7) + 0.02 * Math.sin(a * 5)
    // The overshoot drifts inward a touch, as a quick hand does.
    const drift = 1 - 0.05 * (i / n)
    const x = cx + Math.cos(a) * rx * wob * drift
    const y = cy + Math.sin(a) * ry * wob * drift - (i / n) * h * 0.06
    pts.push(`${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`)
  }
  return pts.join(" ")
}

function standalone(v: string) {
  let out = v.trim().replace(/[’”]+$/, "")
  if (/^[“‘]/.test(out)) out = out.slice(1)
  return out
}

function LanguageLayout({
  f,
  t,
  words,
  verse,
  highlight,
}: {
  f: (n: number) => number
  t: number
  words: TimedWord[]
  verse: string
  highlight: string
}) {
  const text = standalone(verse)
  const at = highlight
    ? text.toLowerCase().search(new RegExp(`\\b${highlight.toLowerCase()}\\b`))
    : -1
  const word = at >= 0 ? text.slice(at, at + highlight.length) : ""
  // The ring draws as the voice says the word (its first spoken mention).
  const said = words.find(
    (w) =>
      w.word.toLowerCase().replace(/[^a-z']/g, "") === highlight.toLowerCase(),
  )
  const ringAt = said ? said.startSec : 1.2
  const draw = interpolate(t, [ringAt, ringAt + 0.75], [0, 1], {
    ...clamp,
    easing: Easing.bezier(0.5, 0, 0.3, 1),
  })
  const lit = interpolate(t, [ringAt, ringAt + 0.4], [0, 1], clamp)
  // After it is drawn the ring breathes: a slow small sway, never still.
  const life = Math.max(0, t - ringAt - 0.75)
  const sway = Math.sin(life * 2.2) * 1.4
  const breathe = 1 + Math.sin(life * 1.6 + 1) * 0.018
  const verseIn = interpolate(t, [0.05, 0.6], [0, 1], {
    ...clamp,
    easing: EASE_OUT,
  })

  const wordRef = useRef<HTMLSpanElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<{
    x: number
    y: number
    w: number
    h: number
  } | null>(null)
  useLayoutEffect(() => {
    const el = wordRef.current
    const root = boxRef.current
    if (!el || !root) return
    const a = el.getBoundingClientRect()
    const b = root.getBoundingClientRect()
    // Measured unscaled: the layout is never transformed.
    const next = {
      x: a.left - b.left,
      y: a.top - b.top,
      w: a.width,
      h: a.height,
    }
    if (
      !box ||
      Math.abs(box.x - next.x) +
        Math.abs(box.y - next.y) +
        Math.abs(box.w - next.w) >
        0.5
    )
      setBox(next)
  })

  const tokens = captionTokens(words)
  const cur = tokens.findIndex((w, i) => {
    const next = tokens[i + 1]
    const until = next
      ? Math.min(next.startSec, Math.max(w.endSec + 0.35, w.startSec + 0.25))
      : w.endSec + 0.6
    return t >= w.startSec && t < until
  })
  const tok = cur >= 0 ? tokens[cur] : null
  const pop = tok
    ? interpolate(t, [tok.startSec, tok.startSec + 0.12], [0, 1], {
        ...clamp,
        easing: EASE_OUT,
      })
    : 0

  const quote = {
    fontFamily: LITERATA,
    fontStyle: "italic" as const,
    fontSize: f(300),
    lineHeight: 1,
    color: GOLD,
    opacity: 0.85,
    position: "absolute" as const,
    height: f(130),
    overflow: "visible" as const,
  }
  return (
    <>
      <div
        ref={boxRef}
        style={{
          position: "absolute",
          left: "50%",
          top: f(470),
          width: f(651),
          transform: `translateX(calc(-50% + ${f(20.5)}px))`,
          opacity: verseIn,
        }}
      >
        <div style={{ ...quote, left: f(-20), top: f(-150) }}>“</div>
        <p
          style={{
            margin: 0,
            fontFamily: PT_SERIF,
            fontStyle: "italic",
            fontSize: f(54),
            lineHeight: 1.45,
            textAlign: "center",
            color: "rgba(255,255,255,0.92)",
            textShadow: `0 ${f(2)}px ${f(16)}px rgba(0,0,0,0.55)`,
          }}
        >
          {"“"}
          {at >= 0 ? (
            <>
              {text.slice(0, at)}
              <span
                ref={wordRef}
                style={{
                  color: interpolateColors(
                    lit,
                    [0, 1],
                    ["rgba(255,255,255,0.92)", GOLD],
                  ),
                  WebkitTextStroke: `${(f(1.4) * lit).toFixed(2)}px ${GOLD}`,
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
        {/* The closing mark is the opening one turned over, at the block's
            lower right (Figma 414-2603). */}
        <div
          style={{
            ...quote,
            right: f(-24),
            bottom: f(-150),
            transform: "rotate(180deg)",
          }}
        >
          “
        </div>
        {box && draw > 0 ? (
          <svg
            width={box.w + box.h * 1.2}
            height={box.h * 1.6}
            viewBox={`${-box.h * 0.6} ${-box.h * 0.3} ${box.w + box.h * 1.2} ${box.h * 1.6}`}
            style={{
              position: "absolute",
              left: box.x - box.h * 0.6,
              top: box.y - box.h * 0.3,
              overflow: "visible",
              transform: `rotate(${(-3 + sway).toFixed(3)}deg) scale(${breathe.toFixed(4)})`,
              transformOrigin: "50% 50%",
            }}
          >
            <path
              d={ringPath(box.w, box.h)}
              fill="none"
              stroke={GOLD}
              strokeWidth={f(3.2)}
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={1}
              strokeDasharray="1 1"
              strokeDashoffset={1 - draw}
              style={{ filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.45))" }}
            />
          </svg>
        ) : null}
      </div>
      <div
        style={{
          position: "absolute",
          top: f(1087),
          left: "50%",
          width: f(747),
          transform: `translateX(-50%) scale(${(0.94 + 0.06 * pop).toFixed(4)})`,
          textAlign: "center",
          fontFamily: SANS,
          fontWeight: 700,
          fontSize: f(48),
          lineHeight: `${f(89)}px`,
          letterSpacing: f(1.44),
          textTransform: "uppercase",
          color: GOLD,
          opacity: pop,
          textShadow: `0 ${f(2)}px ${f(14)}px rgba(0,0,0,0.55)`,
        }}
      >
        {tok ? tok.word.replace(/[,;:.!?”"]+$/, "") : ""}
      </div>
    </>
  )
}
