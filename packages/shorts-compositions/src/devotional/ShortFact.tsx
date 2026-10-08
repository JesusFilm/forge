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
import { KineticCaption } from "./KineticCaption"
import { AnimatedBook, AnimatedScroll } from "./SourceEmblems"
import { StampLine } from "./StampLine"
import { type ExplainerSpec, VoxExplainer } from "./VoxExplainer"
import {
  VoxCaption,
  VoxHalftone,
  VoxLanguageLayout,
  VoxTag,
} from "./VoxLanguage"
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
 * `language` (414-2523, revised 425-2722): "A Moment from the Full
 *   Devotional:" on top, then the address, a divider and the verse on screen
 *   from the first frame; when the voice reaches the word, it turns gold
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
/** Text column width in Figma px (of 900): keeps ~156px of a 1080 frame
 *  clear on each side, outside Reels / Shorts / TikTok's right-hand rail. */
const SAFE_COLUMN = 640
/** Reflection text top, Figma px: the design's 614 raised 54 so text plus
 *  credit end above the bottom ~30% that Reels / Facebook cover. */
const REFLECTION_TOP = 560
/** Film grain over the language short's picture: present, never loud. */
const LANGUAGE_GRAIN_OPACITY = 0.45
const SHORT_GRAIN_URL =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.95' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")"
/** A coarser, punchier grain for the black-and-white Vox film (owner,
 *  2026-10-07: "more grain"): the same noise with its contrast stretched. */
const VOX_GRAIN_URL =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/><feComponentTransfer><feFuncR type='linear' slope='2.6' intercept='-0.8'/><feFuncG type='linear' slope='2.6' intercept='-0.8'/><feFuncB type='linear' slope='2.6' intercept='-0.8'/></feComponentTransfer></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")"
/** The reflection short's credit has dissolved by this second at the
 *  latest (owner, 2026-10-06: "after about ten seconds"). */
const REFLECTION_CREDIT_OUT_SEC = 10
/** Inter 61 over the 640 column: about this many characters a line. */
const REFLECTION_CHARS_PER_LINE = 21

/**
 * When the reflection short's credit must be gone: by 10s, or earlier, just
 * before a sentence first reaches a fourth line, which would run into it
 * (Bartimaeus at 8s). Estimated from the word timings and characters per line.
 */
export function creditGoneBy(
  words: ReadonlyArray<{ word: string; startSec: number; card: number }>,
): number {
  let card = -1
  let chars = 0
  for (const w of words) {
    if (w.card !== card) {
      card = w.card
      chars = 0
    }
    chars += w.word.length + (chars ? 1 : 0)
    if (chars > REFLECTION_CHARS_PER_LINE * 3)
      return Math.min(
        REFLECTION_CREDIT_OUT_SEC,
        Math.max(1.6, w.startSec - 0.15),
      )
  }
  return REFLECTION_CREDIT_OUT_SEC
}
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
  if (fact?.explainer) {
    return (
      <AbsoluteFill>
        <VoxExplainer
          f={f}
          t={t}
          spec={fact.explainer as ExplainerSpec}
          {...(props.bgFile ? { bgFile: props.bgFile } : {})}
          {...(props.bgStartOffsetSec != null
            ? { bgStartOffsetSec: props.bgStartOffsetSec }
            : {})}
          {...(props.musicFile ? { musicFile: props.musicFile } : {})}
        />
        <AbsoluteFill
          style={{
            background: "#000",
            opacity: blackout,
            pointerEvents: "none",
          }}
        />
      </AbsoluteFill>
    )
  }
  const language = fact?.layout === "language"
  const reflection = fact?.layout === "reflection"

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {props.bgFile
        ? (() => {
            const film = (
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
            )
            // The Vox explainer prints the film as a newspaper halftone.
            return fact?.vox ? <VoxHalftone f={f}>{film}</VoxHalftone> : film
          })()
        : null}
      {/* An even dim, then the Figma's soft dark pool behind the text. */}
      <AbsoluteFill style={{ background: "rgba(0,0,0,0.28)" }} />
      <div
        style={{
          // History: the taller pool of Figma 427-2745 (951 high, centred
          // 156.5 above the middle), under the credit and the captions.
          position: "absolute",
          left: width / 2 - f(450),
          top:
            fact?.layout === "history"
              ? height / 2 - f(156.5) - f(475.5)
              : height / 2 +
                f(language || reflection ? -92.5 : 19.5) -
                f(379.5),
          width: f(900),
          height: f(fact?.layout === "history" ? 951 : 759),
          borderRadius: f(100),
          filter: `blur(${f(36.65)}px)`,
          background: `radial-gradient(${f(490.7)}px ${f(413.8)}px at 50% 50%, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0) 100%)`,
        }}
      />
      {language ? (
        // A quiet film grain on the picture only, under the text (owner,
        // 2026-10-06: the language short wanted grain, but it already has a
        // lot on screen, so it must not draw the eye). Fine, low, and moving:
        // the tile jumps every other frame like real grain.
        <AbsoluteFill
          style={{
            backgroundImage: fact?.vox ? VOX_GRAIN_URL : SHORT_GRAIN_URL,
            backgroundSize: fact?.vox
              ? `${f(140)}px ${f(140)}px`
              : `${f(220)}px ${f(220)}px`,
            backgroundPosition: `${(((Math.floor(frame / 2) * 73) % 220) * width) / 900}px ${(((Math.floor(frame / 2) * 131) % 220) * width) / 900}px`,
            mixBlendMode: "overlay",
            // The black-and-white Vox film carries a heavier grain.
            opacity: fact?.vox ? 0.55 : LANGUAGE_GRAIN_OPACITY,
            pointerEvents: "none",
          }}
        />
      ) : null}
      {props.musicFile ? (
        // The devotional's bed under the voice (owner, 2026-10-02): in at
        // once (a quick 0.25s ease, no slow swell), out with the picture.
        <Audio
          src={staticFile(props.musicFile)}
          loop
          volume={(fr) =>
            (props.musicVolume ?? 0.2) *
            interpolate(
              fr,
              [
                0,
                Math.round(0.25 * fps),
                durationInFrames - Math.round(1.2 * fps),
                durationInFrames,
              ],
              [0, 1, 1, 0],
              clamp,
            )
          }
        />
      ) : null}
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
      ) : language && fact?.vox ? (
        <>
          <VoxTag
            f={f}
            t={t}
            text={
              isRussian(words) ? "Из полного видео" : "From the Full Devotional"
            }
          />
          <VoxLanguageLayout
            f={f}
            t={t}
            words={words}
            verse={fact.verse ?? ""}
            highlight={fact.highlight ?? ""}
            reference={fact.reference ?? ""}
            vox={fact.vox}
          />
          <VoxCaption f={f} t={t} tokens={captionTokens(words)} />
        </>
      ) : language ? (
        <LanguageLayout
          f={f}
          t={t}
          words={words}
          verse={fact?.verse ?? ""}
          highlight={fact?.highlight ?? ""}
          reference={fact?.reference ?? ""}
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
          lines={fact?.lines}
          {...(fact?.closeCard && words.length
            ? { captionsEndBy: words[words.length - 1].endSec + 0.5 }
            : {})}
        />
      )}
      {fact?.closeCard && words.length ? (
        // The silent turn after the fact (owner, 2026-10-02), stamped like
        // the film short's closing line, the quiet sub line beneath it.
        <CloseCard
          f={f}
          t={t}
          at={words[words.length - 1].endSec + 0.5}
          text={fact.closeCard}
          {...(fact.closeSub ? { sub: fact.closeSub } : {})}
        />
      ) : null}
      {!fact?.closeCard && fact?.closeSub && words.length ? (
        // A quiet last line once the voice has finished (owner, 2026-10-02),
        // set like the verse address: PT Serif italic 32 at 85%, just under
        // the caption block and well inside the safe zone.
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "64%",
            textAlign: "center",
            fontFamily: PT_SERIF,
            fontStyle: "italic",
            fontSize: f(32),
            lineHeight: `${f(50)}px`,
            color: "rgba(255,255,255,0.92)",
            opacity:
              0.85 *
              interpolate(
                t,
                [
                  words[words.length - 1].endSec + 0.5,
                  words[words.length - 1].endSec + 1.2,
                ],
                [0, 1],
                clamp,
              ),
            textShadow: `0 ${f(2)}px ${f(14)}px rgba(0,0,0,0.55)`,
          }}
        >
          {fact.closeSub}
        </div>
      ) : null}
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

/** "historical context" → "Historical Context" (Figma 427-2756). */
function titleCase(v: string): string {
  return v.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase())
}

type KineticLine = { from: number; to: number; hero: string; accents: string[] }

function HistoryLayout({
  f,
  t,
  total,
  words,
  label,
  source,
  emblem,
  lines,
  captionsEndBy,
}: {
  f: (n: number) => number
  t: number
  total: number
  words: TimedWord[]
  label: string
  source: string
  emblem: "book" | "scroll"
  lines?: KineticLine[] | undefined
  /** Clear the captions by this time (a closing card follows). */
  captionsEndBy?: number
}) {
  const { width } = useVideoConfig()
  // The credit arrives in a short cascade rather than all at once (owner,
  // 2026-10-02: "not just static"): the emblem, then the label closing in
  // from wide tracking, then the source a word at a time, then the divider
  // growing out of its gold dot.
  const ease = (a: number, b: number) =>
    interpolate(t, [a, b], [0, 1], { ...clamp, easing: EASE_OUT })
  const emblemIn = ease(0.1, 0.7)
  const labelIn = ease(0.35, 1.05)
  const sourceIn = ease(0.6, 1.3)
  const fromLabelIn = ease(1.2, 1.9)
  const fromLabelOut =
    captionsEndBy != null
      ? interpolate(t, [captionsEndBy - 0.35, captionsEndBy], [1, 0], clamp)
      : 1
  // The teaser's px unit (short side / 390, times 390/360 as the teaser sets
  // it), so the captions are the approved teaser size.
  const tpx = (n: number) => ((n * 390) / 360) * (width / 390)
  return (
    <>
      {/* The credit at the top left (Figma 427-2744, revised 2026-10-05):
          the emblem tilted, then "Historical Context" over the source. */}
      <div
        style={{
          position: "absolute",
          top: f(251),
          left: f(96),
          display: "flex",
          alignItems: "flex-start",
          gap: f(16),
          // The closing question stands alone (owner, 2026-10-05).
          opacity: fromLabelOut,
        }}
      >
        <div
          style={{
            width: f(95),
            height: f(77),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: f(83),
              height: f(54),
              transform: `rotate(-17.26deg) translateY(${((1 - emblemIn) * f(10)).toFixed(2)}px) scale(${(0.88 + 0.12 * emblemIn).toFixed(4)})`,
              opacity: 0.85 * emblemIn,
            }}
          >
            {emblem === "scroll" ? (
              <AnimatedScroll t={t} />
            ) : (
              <AnimatedBook t={t} />
            )}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: f(4),
            // Clear of the action rail (x 920 of 1080).
            maxWidth: f(767 - 96 - 111),
          }}
        >
          <div
            style={{
              fontFamily: LITERATA,
              fontSize: f(32),
              lineHeight: `${f(50)}px`,
              color: "rgba(255,255,255,0.92)",
              opacity: 0.85 * labelIn,
              transform: `translateY(${((1 - labelIn) * f(8)).toFixed(2)}px)`,
              whiteSpace: "nowrap",
            }}
          >
            {titleCase(label)}
          </div>
          <div
            style={{
              fontFamily: SANS,
              fontWeight: 500,
              fontSize: f(20),
              letterSpacing: f(1.5),
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.6)",
              opacity: sourceIn,
              transform: `translateY(${((1 - sourceIn) * f(8)).toFixed(2)}px)`,
            }}
          >
            <span style={{ fontWeight: 600 }}>Source</span>: {source}
          </div>
        </div>
      </div>
      {/* "From Full Devotional" under the captions (Figma 427-2761), raised
          from the Figma's 1206 so it ends above the bottom UI zone (1208);
          it leaves when the closing card arrives. */}
      {fromLabelOut > 0 ? (
        <div
          style={{
            position: "absolute",
            top: f(1100),
            left: f(96),
            fontFamily: PT_SERIF,
            fontStyle: "italic",
            fontSize: f(32),
            lineHeight: `${f(50)}px`,
            color: "rgba(255,255,255,0.92)",
            opacity: 0.85 * fromLabelIn * fromLabelOut,
            whiteSpace: "nowrap",
            textShadow: `0 ${f(2)}px ${f(14)}px rgba(0,0,0,0.55)`,
          }}
        >
          From Full Devotional
        </div>
      ) : null}
      {lines?.length ? (
        <TeaserCaptions
          t={t}
          total={total}
          words={words}
          lines={lines}
          px={tpx}
          frameWidth={width}
          {...(captionsEndBy != null ? { endBy: captionsEndBy } : {})}
        />
      ) : (
        <div
          style={{
            position: "absolute",
            top: f(640),
            left: "50%",
            width: f(SAFE_COLUMN),
            transform: "translateX(-50%)",
          }}
        >
          <KineticText f={f} t={t} total={total} words={words} />
        </div>
      )}
    </>
  )
}

/**
 * The narration in the approved teaser style (docs/handoffs/
 * 2026-10-02-vertical-intro-design.md): each line a poster block of words of
 * three sizes, low in the frame, every word rising out of a blur with the
 * voice; a line fades over its last 0.35s as the next arrives. Without the
 * teaser's gold (owner, 2026-10-02): the accent is white italic. Always on
 * the left, and never wider than the frame minus the right-hand action rail.
 */
function TeaserCaptions({
  t,
  total,
  words,
  lines,
  px,
  frameWidth,
  endBy,
}: {
  t: number
  total: number
  words: TimedWord[]
  lines: KineticLine[]
  px: (n: number) => number
  frameWidth: number
  endBy?: number
}) {
  const inset = px(28)
  // Clear of the rail on the right (x > 940 of 1080).
  const maxWidth = frameWidth * (920 / 1080) - inset
  return (
    <>
      {lines.map((ln, i) => {
        const ws = words.slice(ln.from, ln.to + 1)
        if (!ws.length) return null
        const from = ws[0].startSec
        const next = lines[i + 1]
          ? words[lines[i + 1].from]?.startSec
          : undefined
        const to = next ?? endBy ?? total + 10
        const out =
          next == null && endBy == null
            ? 1
            : interpolate(t, [to - 0.35, to - 0.02], [1, 0], {
                ...clamp,
                easing: EASE_OUT,
              })
        if (t < from - 0.1 || out <= 0) return null
        return (
          <AbsoluteFill key={i} style={{ opacity: out }}>
            <KineticCaption
              line={ws.map((w) => w.word).join(" ")}
              hero={ln.hero}
              accents={ln.accents}
              starts={ws.map((w) => w.startSec - from)}
              time={t - from}
              layout="stack"
              px={px}
              side="left"
              portrait
              maxWidth={maxWidth}
              sizes={{ hero: 1.3, accent: 1.4, plain: 1.6 }}
              accentColor="#f4efe8"
              // Out of the bottom UI zone (Meta: keep the lower ~35% clear);
              // its own dark pool, instead of a band across the frame.
              bottom="38%"
              backdrop
            />
          </AbsoluteFill>
        )
      })}
    </>
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
  mode = "kinetic",
}: {
  f: (n: number) => number
  t: number
  total: number
  words: TimedWord[]
  minLines?: number
  /** `reveal`: the long form's reflection reveal for long sentences (the
   *  whole sentence laid out, each word fading in as it is said, landing in
   *  gold and cooling to the body colour); short lines still stamp. */
  mode?: "kinetic" | "reveal"
}) {
  if (mode === "reveal") {
    return (
      <RevealText f={f} t={t} total={total} words={words} minLines={minLines} />
    )
  }
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
    return (
      <div style={box}>
        <StampLine
          text={sentence.map((w) => w.word).join(" ")}
          t={t - phrase[0].startSec}
          f={f}
        />
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

/** As in the long form (DevotionalVideo WordReveal): a spoken word lands in
 *  the accent and cools to the body colour over this long. */
const ACCENT_SETTLE_SEC = 0.42

function RevealText({
  f,
  t,
  total,
  words,
  minLines,
}: {
  f: (n: number) => number
  t: number
  total: number
  words: TimedWord[]
  minLines: number
}) {
  // One sentence (card) at a time, as the long form shows it.
  const cards = [...new Set(words.map((w) => w.card))]
  const starts = cards.map((c) => words.find((w) => w.card === c)!.startSec)
  const idx = starts.findIndex(
    (s0, i) =>
      t >= s0 - 0.05 && (i + 1 >= starts.length || t < starts[i + 1] - 0.05),
  )
  const box = {
    minHeight: f(89) * minLines,
    width: "100%",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
  } as const
  if (idx < 0) return <div style={box} />
  const sentence = words.filter((w) => w.card === cards[idx])
  if (sentence.length <= STAMP_WORDS) {
    return (
      <KineticText
        f={f}
        t={t}
        total={total}
        words={words}
        minLines={minLines}
      />
    )
  }
  const nextStart = starts[idx + 1] ?? total + 1
  const out = interpolate(
    t,
    [nextStart - 0.16, nextStart - 0.04],
    [1, 0],
    clamp,
  )
  return (
    <div style={{ ...box, opacity: out }}>
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
        {sentence.map((w, i) => {
          const opacity = interpolate(
            t,
            [w.startSec - 0.06, w.startSec + 0.12],
            [0, 1],
            clamp,
          )
          const warm = Math.min(
            interpolate(
              t,
              [w.startSec - 0.06, w.startSec + 0.06],
              [0, 1],
              clamp,
            ),
            interpolate(
              t,
              [w.startSec + 0.06, w.startSec + 0.06 + ACCENT_SETTLE_SEC],
              [1, 0],
              clamp,
            ),
          )
          return (
            <span key={i}>
              <span
                style={{
                  opacity,
                  color: interpolateColors(warm, [0, 1], ["#eae6df", GOLD]),
                }}
              >
                {w.word}
              </span>
              {i < sentence.length - 1 ? " " : ""}
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
  // The credit leaves before the text can grow into it (owner, 2026-10-06:
  // on Bartimaeus a long sentence reached it at 9s): a slow dissolve.
  const outBy = creditGoneBy(words)
  const creditOut = interpolate(t, [outBy - 1.4, outBy], [1, 0], {
    ...clamp,
    easing: Easing.bezier(0.42, 0, 0.58, 1),
  })
  // The portrait floats: a slow bob and the faintest sway, never still.
  const floatY = Math.sin((t * 2 * Math.PI) / 3.4) * f(4)
  const floatR = Math.sin((t * 2 * Math.PI) / 5.1) * 1.4
  return (
    <>
      <FullDevotionalLabel
        f={f}
        t={t}
        text={
          isRussian(words) ? "Из полного видео:" : "From the Full Devotional:"
        }
      />
      <div
        style={{
          position: "absolute",
          // Figma 614, raised so the credit below stays out of the bottom
          // UI zone of Reels / Facebook (owner, 2026-10-02: always safe).
          top: f(REFLECTION_TOP),
          left: "50%",
          width: f(SAFE_COLUMN),
          transform: "translateX(-50%)",
        }}
      >
        <KineticText f={f} t={t} total={total} words={words} mode="reveal" />
      </div>
      {credit?.source ? (
        <div
          style={{
            position: "absolute",
            // Same gap below four lines of text as the Figma keeps below
            // three (1068 - 614 - 89*3 = 187, less the fourth line).
            top: f(REFLECTION_TOP + 89 * 4 + 30),
            left: "50%",
            width: f(SAFE_COLUMN),
            transform: `translateX(-50%) translateY(${(1 - head) * f(10)}px)`,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: f(30),
            opacity: head * creditOut,
          }}
        >
          <Divider f={f} grow={head} />
          {/* Figma 415-2618 (revised 2026-10-02): label, the name with life
              dates on one line in PT Serif italic, then a small round
              portrait, all centred. */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: f(20),
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: f(4),
                textAlign: "center",
                whiteSpace: "nowrap",
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
                  fontFamily: PT_SERIF,
                  fontStyle: "italic",
                  fontSize: f(36),
                  lineHeight: `${f(50)}px`,
                  color: "rgba(255,255,255,0.92)",
                  opacity: 0.85,
                }}
              >
                {credit.source}
              </div>
            </div>
            {uri ? (
              <Img
                src={uri}
                style={{
                  width: f(89),
                  height: f(90),
                  borderRadius: "50%",
                  objectFit: "cover",
                  opacity: 0.85,
                  transform: `translateY(${floatY.toFixed(2)}px) rotate(${floatR.toFixed(2)}deg)`,
                  boxShadow: `0 ${(f(6) - floatY * 0.5).toFixed(2)}px ${f(16)}px rgba(0,0,0,0.35)`,
                }}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  )
}

/** A Russian short (its narration is Cyrillic) says its labels in Russian
 *  (2026-10-07); the labels are the only fixed English on a fact short. */
function isRussian(words: ReadonlyArray<{ word: string }>): boolean {
  return words.some((w) => /\p{Script=Cyrillic}/u.test(w.word))
}

/** "From the Full Devotional:" over a short (Figma 415-2610, 425-2722):
 *  PT Serif italic 36 at 85%, centred at the top of the safe area, so the
 *  viewer knows this is one piece of a longer video. */
function FullDevotionalLabel({
  f,
  t,
  text,
}: {
  f: (n: number) => number
  t: number
  text: string
}) {
  const a = interpolate(t, [0.1, 0.8], [0, 1], { ...clamp, easing: EASE_OUT })
  return (
    <div
      style={{
        position: "absolute",
        top: f(254),
        left: "50%",
        transform: `translateX(-50%) translateY(${((1 - a) * f(8)).toFixed(2)}px)`,
        opacity: 0.85 * a,
        fontFamily: PT_SERIF,
        fontStyle: "italic",
        fontSize: f(36),
        lineHeight: `${f(50)}px`,
        color: "rgba(255,255,255,0.92)",
        whiteSpace: "nowrap",
        textShadow: `0 ${f(2)}px ${f(12)}px rgba(0,0,0,0.5)`,
      }}
    >
      {text}
    </div>
  )
}

/** Two tapering strokes and a small gold dot (Figma 413-2480), growing
 *  out from the dot as `grow` goes 0 to 1. */
function Divider({ f, grow }: { f: (n: number) => number; grow: number }) {
  return (
    <svg
      width={f(323) * grow}
      height={f(4)}
      viewBox="0 0 323 4"
      preserveAspectRatio="none"
      style={{ opacity: 0.85, display: "block" }}
    >
      <path
        d="M0 2L150.347 0C150.981 0 151.5 0.515 151.5 1.16V2.84C151.5 3.49 150.981 4.01 150.347 4L0 2Z"
        fill="#D9D9D9"
      />
      <rect x="159.5" width="4" height="4" rx="2" fill={GOLD} />
      <path
        d="M323 2L172.42 0C171.913 0 171.5 0.515 171.5 1.16V2.84C171.5 3.48 171.913 4.01 172.42 4L323 2Z"
        fill="#D9D9D9"
      />
    </svg>
  )
}

function CloseCard({
  f,
  t,
  at,
  text,
  sub,
}: {
  f: (n: number) => number
  t: number
  at: number
  text: string
  sub?: string
}) {
  if (t < at - 0.05) return null
  const dim = interpolate(t, [at - 0.05, at + 0.4], [0, 1], clamp)
  const ease = (a: number, b: number) =>
    interpolate(t - at, [a, b], [0, 1], { ...clamp, easing: EASE_OUT })
  const textIn = ease(0, 0.6)
  const subIn = ease(0.7, 1.4)
  // Figma 428-2762 (owner, 2026-10-05): the question in Inter SemiBold 36
  // caps, 492 wide, centred at 675, alone: the credit and the Figma's
  // "Watch the Full Devotional" line were taken off (owner, same day).
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill style={{ background: `rgba(0,0,0,${0.35 * dim})` }} />
      <div
        style={{
          position: "absolute",
          top: f(675),
          left: "50%",
          width: f(492),
          transform: "translateX(-50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: f(37),
        }}
      >
        <p
          style={{
            margin: 0,
            fontFamily: SANS,
            fontWeight: 600,
            fontSize: f(36),
            lineHeight: 1.22,
            letterSpacing: f(1.5),
            textTransform: "uppercase",
            textAlign: "center",
            color: "#fff",
            opacity: textIn,
            transform: `translateY(${((1 - textIn) * f(10)).toFixed(2)}px)`,
            textShadow: `0 ${f(2)}px ${f(14)}px rgba(0,0,0,0.55)`,
          }}
        >
          {text}
        </p>
        {sub ? (
          <p
            style={{
              margin: 0,
              fontFamily: PT_SERIF,
              fontStyle: "italic",
              fontSize: f(32),
              lineHeight: `${f(50)}px`,
              textAlign: "center",
              whiteSpace: "nowrap",
              color: "rgba(255,255,255,0.92)",
              opacity: 0.85 * subIn,
              textShadow: `0 ${f(2)}px ${f(14)}px rgba(0,0,0,0.55)`,
            }}
          >
            {sub}
          </p>
        ) : null}
      </div>
    </AbsoluteFill>
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
    const bare = w.word.toLowerCase().replace(/[^\p{L}']/gu, "")
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
function ringPath(w: number, h: number, seed = 0): string {
  const cx = w / 2
  const cy = h / 2
  const rx = w / 2 + h * 0.42
  const ry = h / 2 + h * 0.24
  const pts: string[] = []
  const turns = 1.12
  const n = 64
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI * 0.62 + (i / n) * Math.PI * 2 * turns
    // Each seed is the same ring drawn again by hand: the wobble lands a
    // little differently, never far enough to read as a different shape.
    const wob =
      1 +
      0.035 * Math.sin(a * 3 + 0.7 + seed * 2.1) +
      0.02 * Math.sin(a * 5 + seed * 1.3) +
      0.012 * seed * Math.sin(a * 2 + seed)
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
  reference,
}: {
  f: (n: number) => number
  t: number
  words: TimedWord[]
  verse: string
  highlight: string
  /** "Luke 15:32": says plainly that this is the Bible (Figma 422-2664). */
  reference: string
}) {
  const text = standalone(verse)
  const at = highlight
    ? text.toLowerCase().search(new RegExp(`\\b${highlight.toLowerCase()}\\b`))
    : -1
  const word = at >= 0 ? text.slice(at, at + highlight.length) : ""
  // The ring draws as the voice says the word (its first spoken mention).
  const said = words.find(
    (w) =>
      w.word.toLowerCase().replace(/[^\p{L}']/gu, "") ===
      highlight.toLowerCase(),
  )
  const ringAt = said ? said.startSec : 1.2
  const draw = interpolate(t, [ringAt, ringAt + 0.9], [0, 1], {
    ...clamp,
    easing: Easing.bezier(0.5, 0, 0.3, 1),
  })
  const lit = interpolate(t, [ringAt, ringAt + 0.4], [0, 1], clamp)
  // Once drawn, the ring "boils" like hand-drawn animation (owner,
  // 2026-10-02): three near-identical redraws swapped four times a second
  // (six read a touch fast). Calm, not jumpy.
  const life = Math.max(0, t - ringAt - 0.9)
  const ringSeed = draw < 1 ? 0 : Math.floor(life * 4) % 3
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

  // The rest of the verse sits back at 85% (Figma 414-2550).
  const rest = { opacity: 0.85 }
  return (
    <>
      <FullDevotionalLabel
        f={f}
        t={t}
        text="A Moment from the Full Devotional:"
      />
      <div
        ref={boxRef}
        style={{
          position: "absolute",
          left: "50%",
          // Figma 425-2722 (owner, 2026-10-05): no big gold quote marks;
          // the address, a divider, then the verse, stacked and centred.
          top: f(424),
          width: f(SAFE_COLUMN),
          transform: "translateX(-50%)",
          opacity: verseIn,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: f(28),
        }}
      >
        {reference ? (
          // Inter Medium 25 caps, tracked 5, at 75% (Figma 425-2730).
          <div
            style={{
              textAlign: "center",
              fontFamily: SANS,
              fontWeight: 500,
              fontSize: f(25),
              letterSpacing: f(5),
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.75)",
              whiteSpace: "nowrap",
              textShadow: `0 ${f(2)}px ${f(12)}px rgba(0,0,0,0.5)`,
            }}
          >
            {reference}
          </div>
        ) : null}
        <Divider f={f} grow={verseIn} />
        <p
          style={{
            margin: 0,
            fontFamily: PT_SERIF,
            fontStyle: "italic",
            fontSize: f(56),
            lineHeight: 1.45,
            textAlign: "center",
            color: "rgba(255,255,255,0.85)",
            textShadow: `0 ${f(2)}px ${f(16)}px rgba(0,0,0,0.55)`,
          }}
        >
          <span style={rest}>{"“"}</span>
          {at >= 0 ? (
            <>
              <span style={rest}>{text.slice(0, at)}</span>
              <span
                ref={wordRef}
                style={{
                  color: interpolateColors(
                    lit,
                    [0, 1],
                    ["rgba(255,255,255,0.92)", GOLD],
                  ),
                  // Dimmed with the rest until the voice reaches it.
                  opacity: 0.85 + 0.15 * lit,
                  WebkitTextStroke: `${(f(1.4) * lit).toFixed(2)}px ${GOLD}`,
                }}
              >
                {word}
              </span>
              <span style={rest}>{text.slice(at + word.length)}</span>
            </>
          ) : (
            <span style={rest}>{text}</span>
          )}
          <span style={rest}>{"”"}</span>
        </p>
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
              transform: "rotate(-3deg)",
              transformOrigin: "50% 50%",
            }}
          >
            <path
              d={ringPath(box.w, box.h, ringSeed)}
              fill="none"
              stroke={GOLD}
              strokeWidth={f(4.6)}
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
      {/* The spoken word on a gold tab (Figma 415-2640). */}
      {tok ? (
        <div
          style={{
            position: "absolute",
            top: f(1077),
            left: "50%",
            transform: `translateX(-50%) scale(${(0.9 + 0.1 * pop).toFixed(4)})`,
            opacity: pop,
            background: GOLD,
            borderRadius: f(16),
            padding: `0 ${f(12)}px`,
            // Inter Bold 56 in normal case with no tracking (owner,
            // 2026-10-02: the tracked caps were hard to read; 48 too small).
            fontFamily: SANS,
            fontWeight: 700,
            fontSize: f(56),
            lineHeight: `${f(89)}px`,
            letterSpacing: 0,
            color: "#140b05",
            whiteSpace: "nowrap",
            boxShadow: `0 ${f(4)}px ${f(18)}px rgba(0,0,0,0.35)`,
          }}
        >
          {tok.word.replace(/[,;:.!?”"]+$/, "")}
        </div>
      ) : null}
    </>
  )
}
