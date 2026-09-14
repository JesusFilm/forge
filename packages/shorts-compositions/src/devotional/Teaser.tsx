import { useEffect, useState } from "react"
import {
  AbsoluteFill,
  Audio,
  Easing,
  interpolate,
  interpolateColors,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion"
import { z } from "zod"

import { SHORT_FONT_FAMILIES } from "../fonts"
import { loadTeaserFonts, TEASER_FONT_FAMILIES } from "./teaser-fonts"

/**
 * Vertical TEASER for one devotional (Good Samaritan first).
 *
 * Arc (owner brief):
 *   words     footage blurred + darkened — something visible, nothing legible;
 *             ONE word at a time, big, centred, each in its own face (Poppins /
 *             Literata, light to semibold, upper / lower / capitalised). The
 *             first three hold a second each, then the beat shrinks steadily.
 *   lines     everything slows. Each prose line is NARRATED (the devotional's
 *             own voice) and revealed the way the devotional reveals its text:
 *             the whole line faint, each word turning gold as the voice reaches
 *             it and settling to white. Music comes in under the first line.
 *             "You're busy." emerges from blur; "You already have *enough*…";
 *             a pause; "And then someone needs you." lands SUDDENLY and the
 *             blur drops on the man on the ground (0:52 of the devotional).
 *   after     the footage breathes, the question sits over it long enough to
 *             connect, then darken + blur again and a calm CTA.
 *
 * Every beat after the words is DERIVED from the narration lengths, so a
 * re-voiced line moves the whole back half with it. The reveal's SOURCE
 * second is a prop; only its position in the teaser moves.
 *
 * FOOTAGE TIMING. The clip plays at a flat 1.0× throughout — never sped up
 * or slowed down (owner: a rushed or crawling intro reads as a mistake, even
 * blurred). So the reveal cannot be pinned to a beat in the narration; the
 * narration is pinned to IT instead. `placeLines` puts the "needs" line at
 * `max(where the natural pacing would put it, revealSourceSec)` — if the
 * words and lines finish before the footage reaches the reveal second, the
 * pause before "needs" simply grows to cover the difference, rather than the
 * clip fast-forwarding to catch up. One continuous video layer, no cut, no
 * rate change: teaser-second N is always source-second N.
 */

export const TEASER_COMPOSITION_ID = "devotional-teaser"
export const TEASER_FPS = 30
export const TEASER_WIDTH = 1080
export const TEASER_HEIGHT = 1920

const spokenWordSchema = z.object({
  word: z.string(),
  startSec: z.number(),
  endSec: z.number(),
})
const lineSchema = z.object({
  id: z.enum(["busy", "enough", "needs", "question", "cta"]),
  text: z.string(),
  /** Narration file in the public dir; omit for a silent, evenly-paced line. */
  file: z.string().optional(),
  durationSec: z.number().positive(),
  words: z.array(spokenWordSchema),
})
export type TeaserLine = z.infer<typeof lineSchema>

export const teaserInputPropsSchema = z.object({
  /** File name inside Remotion's public dir (staged by the render script). */
  clipFile: z.string().min(1),
  /** Source second the reveal must land on. */
  revealSourceSec: z.number().nonnegative().default(17),
  /** Music bed, staged beside the clip. Starts with "You're busy." */
  musicFile: z.string().optional(),
  /** One short sound, played as each word lands. */
  sfxFile: z.string().optional(),
  /** Narrated prose lines with word timings. Omitted → silent fallback. */
  lines: z.array(lineSchema).optional(),
})
export type TeaserInputProps = z.infer<typeof teaserInputPropsSchema>

// --- words -------------------------------------------------------------------

const SLOW_WORDS = ["work"]
const FAST_WORDS = [
  "home",
  "kids",
  "parents",
  "work",
  "ministry",
  "messages",
  "home",
  "deadlines",
  "work",
  "bills",
  "groceries",
  "emails",
  "friends",
  "chores",
  "work",
  "appointments",
  "home",
  "dinner",
  "messages",
  "plans",
  "notifications",
  "work",
]
/** Five more at the very end, so fast they cannot be read — the crowding
 *  tipping over (owner). Repeats are deliberate. */
const BURST_WORDS = ["work", "home", "messages", "work", "kids"]
/** One slow opening word, then the hold drops on an EASE-OUT curve — most
 *  of the acceleration happens in the first handful of words, then it holds
 *  near the floor for the rest, rather than ramping evenly across all twenty
 *  (owner: the first word can stay slow, everything after it should speed up
 *  faster than before) — then the burst at a fixed flicker. */
const SLOW_HOLD = 1.0
const FAST_HOLD_FROM = 0.42
const FAST_HOLD_TO = 0.09
const BURST_HOLD = 0.08

type Face = "poppins" | "literata"
type Case = "upper" | "lower" | "title"
type WordStyle = {
  face: Face
  weight: 300 | 400 | 500 | 600
  italic?: boolean
  textCase: Case
}

/** The owner's reference, then more of the same spirit. Cycled by index so
 *  neighbouring words never share a look. */
const STYLES: WordStyle[] = [
  { face: "poppins", weight: 300, textCase: "upper" }, // WORK
  { face: "poppins", weight: 300, italic: true, textCase: "upper" }, // HOME
  { face: "literata", weight: 400, italic: true, textCase: "lower" }, // kids
  { face: "poppins", weight: 400, textCase: "title" }, // Parents
  { face: "literata", weight: 300, textCase: "upper" }, // WORK
  { face: "poppins", weight: 600, textCase: "lower" }, // ministry
  { face: "literata", weight: 500, italic: true, textCase: "title" }, // Messages
  { face: "poppins", weight: 500, italic: true, textCase: "lower" }, // home
  { face: "literata", weight: 400, textCase: "upper" },
  { face: "poppins", weight: 300, textCase: "lower" },
  { face: "literata", weight: 600, textCase: "lower" },
  { face: "poppins", weight: 400, italic: true, textCase: "upper" },
]

type TimedWord = {
  text: string
  at: number // appears
  until: number // replaced
  style: WordStyle
}

function timeWords(): TimedWord[] {
  const out: TimedWord[] = []
  let t = 0
  SLOW_WORDS.forEach((text, i) => {
    out.push({
      text,
      at: t,
      until: t + SLOW_HOLD,
      style: STYLES[i % STYLES.length],
    })
    t += SLOW_HOLD
  })
  FAST_WORDS.forEach((text, i) => {
    const p = i / (FAST_WORDS.length - 1)
    // A steep ease-out (not the built-in cubic): most of the deceleration
    // happens in the first handful of words, then the pace flattens out near
    // the floor for the rest — a curve genuinely front-loaded acceleration
    // gives rather than a smooth ramp across all twenty words.
    const eased = 1 - Math.pow(1 - p, 5)
    const hold = FAST_HOLD_FROM + (FAST_HOLD_TO - FAST_HOLD_FROM) * eased
    out.push({
      text,
      at: t,
      until: t + hold,
      style: STYLES[(SLOW_WORDS.length + i) % STYLES.length],
    })
    t += hold
  })
  BURST_WORDS.forEach((text, i) => {
    out.push({
      text,
      at: t,
      until: t + BURST_HOLD,
      style:
        STYLES[(SLOW_WORDS.length + FAST_WORDS.length + i) % STYLES.length],
    })
    t += BURST_HOLD
  })
  return out
}

export const WORDS = timeWords()
const T_FAST_START = SLOW_WORDS.length * SLOW_HOLD
const T_WORDS_END = WORDS[WORDS.length - 1].until

// --- lines: timeline derived from narration ---------------------------------

type LineId = TeaserLine["id"]

/** Per-line pacing around its narration. `lead` = voice starts this long after
 *  the line appears; `hold` = line stays this long after the voice ends;
 *  `gap` = silence before the NEXT line appears. */
const PACE: Record<LineId, { lead: number; hold: number; gap: number }> = {
  busy: { lead: 0.45, hold: 0.9, gap: 0.3 },
  enough: { lead: 0.2, hold: 0.9, gap: 0.8 }, // the pause before the turn
  needs: { lead: 0.05, hold: 1.1, gap: 1.5 }, // then the footage breathes
  question: { lead: 0.3, hold: 2.4, gap: 2.4 }, // darken + blur happen in the gap
  // No narration drives this one — `lead` is the fade-in, `hold` is how long
  // it stays up once fully visible (see PlainLine).
  cta: { lead: 0.35, hold: 2.4, gap: 0 },
}

/** Where the line breaks on screen (after this word), by line. */
const BREAK_AFTER: Partial<Record<LineId, string>> = {
  // Set widths so no line ever leaves a lone last word on its own row.
  needs: "someone",
  question: "interruption",
  cta: "devotional",
}
/** Emphasis (bold italic) by line → word. */
const EMPHASIS: Partial<Record<LineId, string>> = { enough: "enough" }

const LINE_TEXT: Record<LineId, string> = {
  busy: "We’re busy.",
  enough: "We already have enough to deal with.",
  needs: "And then someone needs us.",
  question:
    "What if the interruption is exactly what God is asking us to notice?",
  cta: "Watch the full devotional on our page.",
}
const FALLBACK_DURATION: Record<LineId, number> = {
  busy: 1.4,
  enough: 2.6,
  needs: 2.0,
  question: 3.8,
  cta: 2.4,
}

/** Silent stand-in when no narration was staged: same words, evenly paced. */
function fallbackLine(id: LineId): TeaserLine {
  const tokens = LINE_TEXT[id].split(" ")
  const dur = FALLBACK_DURATION[id]
  const per = dur / tokens.length
  return {
    id,
    text: LINE_TEXT[id],
    durationSec: dur,
    words: tokens.map((word, i) => ({
      word,
      startSec: i * per,
      endSec: (i + 1) * per,
    })),
  }
}

type PlacedLine = TeaserLine & {
  appear: number
  voiceAt: number
  out: number // begins fading
}

function placeLines(
  lines: TeaserLine[] | undefined,
  /** Source second the clip must be showing when "needs" appears — the video
   *  never changes speed to hit this, so THIS line waits for it instead. */
  revealSourceSec: number,
): Record<LineId, PlacedLine> {
  const order: LineId[] = ["busy", "enough", "needs", "question", "cta"]
  const byId = new Map((lines ?? []).map((l) => [l.id, l]))
  const placed = {} as Record<LineId, PlacedLine>
  // Owner: after the burst, music fades in and the frame holds EMPTY a
  // moment longer before "You're busy." arrives.
  let t = T_WORDS_END + 1.6
  for (const id of order) {
    const line = byId.get(id) ?? fallbackLine(id)
    const pace = PACE[id]
    // The clip plays at a flat 1.0x (see FOOTAGE TIMING above), so if the
    // words + lines above would land here before the footage itself has
    // reached the reveal second, WAIT for it — the pause before "needs"
    // grows instead of the clip racing to catch up.
    const appear = id === "needs" ? Math.max(t, revealSourceSec) : t
    const voiceAt = appear + pace.lead
    const out = voiceAt + line.durationSec + pace.hold
    placed[id] = { ...line, appear, voiceAt, out }
    t = out + pace.gap
  }
  return placed
}

const wordKey = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "")

// --- look --------------------------------------------------------------------

const POPPINS = `'${TEASER_FONT_FAMILIES.poppins}', 'Inter', sans-serif`
const LITERATA = `'${TEASER_FONT_FAMILIES.literata}', Georgia, serif`
const SERIF = `'${SHORT_FONT_FAMILIES.sourceSerif}', Georgia, serif`
const TEXT_SHADOW = "0 2px 30px rgba(0,0,0,0.45)"
// The devotional's own reveal treatment: a word warms to the accent as the
// voice reaches it and cools back to white (DevotionalVideo.tsx, "grain").
const ACCENT = "#f2c46b"
const REST = "#ffffff"
const ACCENT_SETTLE_SEC = 0.42
/** Opacity of the line BEFORE the voice reaches a word — readable, faint. */
const PRE_OPACITY = 0.38

function cased(text: string, c: Case): string {
  if (c === "upper") return text.toUpperCase()
  if (c === "title") return text[0].toUpperCase() + text.slice(1)
  return text
}

/** One big word, fitted to the safe width. Glyph-width factors are rough
 *  per face/case; the fit only has to stop APPOINTMENTS from clipping. */
function fitSize(text: string, style: WordStyle): number {
  const upper = style.textCase === "upper"
  const perGlyph =
    style.face === "poppins" ? (upper ? 0.72 : 0.56) : upper ? 0.7 : 0.52
  const tracking = upper ? 0.06 : 0
  const maxPx = (TEASER_WIDTH * 0.86) / (text.length * (perGlyph + tracking))
  return Math.min(168, maxPx)
}

// --- pieces ------------------------------------------------------------------

const Word = ({ w, tSec }: { w: TimedWord; tSec: number }) => {
  const hold = w.until - w.at
  const edge = Math.min(0.18, hold * 0.3)
  if (tSec < w.at || tSec > w.until + edge) return null
  const a =
    interpolate(tSec, [w.at, w.at + edge], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    }) *
    interpolate(tSec, [w.until - edge * 0.4, w.until + edge * 0.6], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
  const scale = interpolate(tSec, [w.at, w.at + edge], [0.97, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  })
  const text = cased(w.text, w.style.textCase)
  const size = fitSize(w.text, w.style)
  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        padding: "0 60px 18% 60px",
      }}
    >
      <div
        style={{
          opacity: a,
          transform: `scale(${scale})`,
          fontFamily: w.style.face === "poppins" ? POPPINS : LITERATA,
          fontWeight: w.style.weight,
          fontStyle: w.style.italic ? "italic" : "normal",
          fontSize: size,
          letterSpacing: w.style.textCase === "upper" ? size * 0.06 : 0,
          color: "#fff",
          whiteSpace: "nowrap",
          textShadow: TEXT_SHADOW,
          lineHeight: 1,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  )
}

/** A plain line, no narration and no per-word reveal — the whole phrase just
 *  fades in and holds (owner: the CTA should simply appear, not be spoken or
 *  built up word by word like the rest). */
const PlainLine = ({
  line,
  tSec,
  size = 74,
}: {
  line: PlacedLine
  tSec: number
  size?: number
}) => {
  const fadeIn = 0.3
  const fadeOut = 0.5
  if (tSec < line.appear || tSec > line.out + fadeOut + 0.2) return null
  const a =
    interpolate(tSec, [line.appear, line.appear + fadeIn], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    }) *
    interpolate(tSec, [line.out, line.out + fadeOut], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
  const breakAfter = BREAK_AFTER[line.id]
  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        padding: "0 96px 18% 96px",
      }}
    >
      <div
        style={{
          opacity: a,
          fontFamily: SERIF,
          fontWeight: 400,
          fontSize: size,
          lineHeight: 1.18,
          letterSpacing: -0.8,
          textAlign: "center",
          color: REST,
          maxWidth: 900,
          textShadow: TEXT_SHADOW,
        }}
      >
        {line.words.map((w, i) => {
          const key = wordKey(w.word)
          return (
            <span key={i}>
              {w.word}
              {i < line.words.length - 1 ? (
                breakAfter === key ? (
                  <br />
                ) : (
                  " "
                )
              ) : null}
            </span>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}

/** A narrated prose line in the devotional title face. Fades in (or, for
 *  `emerge`, rises out of blur), then each word warms as it is spoken. */
const SpokenLine = ({
  line,
  tSec,
  emerge,
  size = 74,
}: {
  line: PlacedLine
  tSec: number
  emerge?: boolean
  size?: number
}) => {
  const fadeOut = 0.6
  if (tSec < line.appear || tSec > line.out + fadeOut + 0.2) return null
  const inDur = emerge ? 1.6 : 0.22
  const a =
    interpolate(tSec, [line.appear, line.appear + inDur], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    }) *
    interpolate(tSec, [line.out, line.out + fadeOut], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
  const blur = emerge
    ? interpolate(tSec, [line.appear, line.appear + 1.6], [22, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.out(Easing.cubic),
      })
    : 0
  const t = tSec - line.voiceAt
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const
  const breakAfter = BREAK_AFTER[line.id]
  const emphasis = EMPHASIS[line.id]
  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        // Sits a little above centre: after the reveal the man lies across the
        // lower half of the frame, and the line must not cover him.
        padding: "0 96px 18% 96px",
      }}
    >
      <div
        style={{
          opacity: a,
          filter: blur > 0.05 ? `blur(${blur}px)` : undefined,
          fontFamily: SERIF,
          fontWeight: 400,
          fontSize: size,
          lineHeight: 1.18,
          letterSpacing: -0.8,
          textAlign: "center",
          color: REST,
          maxWidth: 900,
          textShadow: TEXT_SHADOW,
        }}
      >
        {line.words.map((w, i) => {
          const opacity = interpolate(
            t,
            [w.startSec - 0.06, w.startSec + 0.12],
            [PRE_OPACITY, 1],
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
          const key = wordKey(w.word)
          const strong = emphasis !== undefined && key === emphasis
          return (
            <span key={i}>
              <span
                style={{
                  opacity,
                  color: interpolateColors(warm, [0, 1], [REST, ACCENT]),
                  ...(strong ? { fontWeight: 700, fontStyle: "italic" } : {}),
                }}
              >
                {w.word}
              </span>
              {i < line.words.length - 1 ? (
                breakAfter === key ? (
                  <br />
                ) : (
                  " "
                )
              ) : null}
            </span>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}

// --- composition -------------------------------------------------------------

export const teaserDurationSec = (
  lines?: TeaserLine[],
  revealSourceSec = 17,
): number => placeLines(lines, revealSourceSec).cta.out + 0.9

export const Teaser = (props: TeaserInputProps) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const tSec = frame / fps
  const f = (sec: number) => Math.round(sec * fps)

  const [ready, setReady] = useState(false)
  useEffect(() => {
    void loadTeaserFonts().then(() => setReady(true))
  }, [])

  const reveal = props.revealSourceSec
  const L = placeLines(props.lines, reveal)
  const T_NEEDS = L.needs.appear // the turning point — reveal happens here
  const T_QUESTION_OUT = L.question.out
  const T_CTA = L.cta.appear
  const DURATION = teaserDurationSec(props.lines, reveal)

  // Blur (px) and darkness (overlay alpha) on the footage across the arc.
  // Owner: something should stay visible through the blur — figures, light,
  // movement — just nothing you could name. Then a clean cut at the reveal.
  const keys = [
    0,
    T_FAST_START,
    T_WORDS_END,
    T_NEEDS - 0.02,
    T_NEEDS + 0.22,
    T_QUESTION_OUT,
    T_CTA,
  ]
  const blur = interpolate(tSec, keys, [22, 22, 15, 11, 0, 0, 26], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  const dark = interpolate(
    tSec,
    keys,
    [0.56, 0.56, 0.48, 0.42, 0.08, 0.08, 0.7],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  )
  const endFade = interpolate(tSec, [DURATION - 0.7, DURATION], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })

  const src = staticFile(props.clipFile)
  const videoStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    filter: blur > 0.05 ? `blur(${blur}px)` : undefined,
    // Blur bleeds transparent edges; overscan hides them.
    transform: "scale(1.06)",
  }

  // Music: fades in over the pause after the words, out with the picture.
  // Ducked a little while a line is being spoken so the voice sits on top.
  const musicStart = T_WORDS_END
  const musicVolume = (local: number) => {
    const s = local / fps
    const total = DURATION - musicStart
    const fadeIn = interpolate(s, [0, 2.4], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
    const fadeOut = interpolate(s, [total - 2.6, total - 0.1], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
    const abs = musicStart + s
    const speaking = Object.values(L).some(
      (l) =>
        l.file &&
        abs >= l.voiceAt - 0.2 &&
        abs <= l.voiceAt + l.durationSec + 0.3,
    )
    return (speaking ? 0.3 : 0.5) * fadeIn * fadeOut
  }

  return (
    <AbsoluteFill style={{ background: "#000", opacity: ready ? 1 : 0 }}>
      {/* One continuous layer, flat 1.0x — teaser-second N is always
          source-second N, so this is blurred/dark until T_NEEDS and never
          sped up or slowed down to hit it (see FOOTAGE TIMING above). */}
      <AbsoluteFill>
        <OffthreadVideo src={src} muted style={videoStyle} />
      </AbsoluteFill>

      <AbsoluteFill style={{ background: `rgba(0,0,0,${dark})` }} />

      {/* word burst — one word on screen at a time */}
      {tSec < T_WORDS_END + 0.5
        ? WORDS.map((w, i) => <Word key={`${w.text}-${i}`} w={w} tSec={tSec} />)
        : null}

      {/* one soft sound per word; a touch of pitch variation so the fast run
          doesn't turn into a metronome, and quieter as it speeds up */}
      {props.sfxFile
        ? WORDS.map((w, i) => (
            <Sequence key={`sfx-${i}`} from={f(w.at)} layout="none">
              <Audio
                src={staticFile(props.sfxFile ?? "")}
                volume={
                  w.at < T_FAST_START
                    ? 0.7
                    : w.until - w.at <= BURST_HOLD
                      ? 0.3
                      : 0.5
                }
                playbackRate={0.92 + ((i * 7) % 5) * 0.04}
              />
            </Sequence>
          ))
        : null}

      {props.musicFile ? (
        <Sequence from={f(musicStart)} layout="none">
          <Audio src={staticFile(props.musicFile)} volume={musicVolume} />
        </Sequence>
      ) : null}

      {/* narration */}
      {Object.values(L).map((l) =>
        l.file ? (
          <Sequence key={`voice-${l.id}`} from={f(l.voiceAt)} layout="none">
            <Audio src={staticFile(l.file)} volume={1} />
          </Sequence>
        ) : null,
      )}

      <SpokenLine line={L.busy} tSec={tSec} emerge size={84} />
      <SpokenLine line={L.enough} tSec={tSec} />
      <SpokenLine line={L.needs} tSec={tSec} />
      <SpokenLine line={L.question} tSec={tSec} size={70} />
      <PlainLine line={L.cta} tSec={tSec} size={62} />

      <AbsoluteFill style={{ background: "#000", opacity: 1 - endFade }} />
    </AbsoluteFill>
  )
}
