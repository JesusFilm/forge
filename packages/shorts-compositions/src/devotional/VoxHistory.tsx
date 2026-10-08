import { Easing, interpolate } from "remotion"

import { SHORT_FONT_FAMILIES } from "../fonts"

import { PAPER_CLIP_JPG, PAPER_CLIP_MASK } from "./paper-assets"
import {
  Arrive,
  Ring,
  Stamp,
  Strike,
  said,
  type TimedWord,
} from "./VoxLanguage"

/**
 * The history short as a Vox explainer, design B "newspaper clipping"
 * (owner, 2026-10-08, Figma 457-2825): a strip of newsprint with the verse
 * and the key word ringed, then a clipping (the owner's sheet with tape and
 * a paper clip) set like a news item: section line, heavy headline, rule,
 * the source's words with one word marked, a struck phrase with the
 * handwritten correction, the source in italics. One accent colour carries
 * every mark (her first pick: orange #ff7f53, near the brand colour), so the
 * history and language shorts do not repeat the same yellow.
 *
 * The insight shorts rotate designs per story (original rough paper, B
 * clipping, C notebook); this file is B. Coordinates are Figma units of a
 * 900 x 1600 frame, converted by `f`.
 */

export type VoxHistorySpec = {
  /** `clipping` (design B). Room for the notebook (C) later. */
  style?: "clipping"
  /** Every mark and the label: ring, marker, strike, stamp. */
  accent?: string
  /** The verse on the strip ("…who sent him into his fields to feed pigs."). */
  verse: string
  reference?: string
  /** The verse word ringed when the voice says it ("pigs"). */
  ringOn?: string
  /** The clipping's section line (default "Historical context"). */
  label?: string
  headline: string
  /** The source's own words, quoted on the clipping. */
  body: string
  /** The body word marked when the voice says it ("unclean"). */
  markOn?: string
  /** A phrase struck after the body ("farm job") with `strikeBefore` ahead
   *  of it ("Not just a"), and the handwritten word over it ("rock bottom"). */
  strike?: string
  strikeBefore?: string
  swapTo?: string
  /** The spoken word the strike waits for; default the last sentence. */
  strikeOn?: string
  /** The credit under the item ("Easton's Bible Dictionary, 1897"). */
  source?: string
  /** The stamp at the end ("Fallen") and the spoken word it waits for. */
  finale?: string
  finaleOn?: string
}

export const VOX_ORANGE = "#ff7f53"
const INK = "#191512"
const NEWSPRINT = "#ece6d8"
const SANS = `'${SHORT_FONT_FAMILIES.inter}', -apple-system, system-ui, sans-serif`
const PT = `'${SHORT_FONT_FAMILIES.ptSerif}', Georgia, serif`
// The heavy headline and the body: Source Serif 4 is variable to 900, so the
// black headline is a real weight (the Figma used Playfair Display Black and
// Libre Caslon, which are not embedded).
const NEWS = `'${SHORT_FONT_FAMILIES.sourceSerif}', Georgia, serif`
const HAND = `'${SHORT_FONT_FAMILIES.caveat}', cursive`
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const
const OUT = Easing.bezier(0.2, 0.7, 0.2, 1)

/** The text split around the first whole-word `word`. */
function splitAt(text: string, word: string | undefined) {
  if (!word) return { before: text, hit: "", after: "" }
  const at = text
    .toLowerCase()
    .search(new RegExp(`(?<!\\p{L})${word.toLowerCase()}(?!\\p{L})`, "u"))
  if (at < 0) return { before: text, hit: "", after: "" }
  return {
    before: text.slice(0, at),
    hit: text.slice(at, at + word.length),
    after: text.slice(at + word.length),
  }
}

/** A brush band low across a word, like a highlighter pen (Figma: the
 *  lower half of the line, 80% of the accent). */
function Band({
  t,
  at,
  color,
  children,
}: {
  t: number
  at: number
  color: string
  children: React.ReactNode
}) {
  const p = interpolate(t, [at, at + 0.35], [0, 1], { ...clamp, easing: OUT })
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <span
        style={{
          position: "absolute",
          left: "-0.06em",
          right: "-0.06em",
          top: "0.8em",
          height: "0.4em",
          background: color,
          opacity: 0.8,
          borderRadius: "40% 18% 35% 22% / 55% 40% 60% 45%",
          transform: `scaleX(${p.toFixed(4)}) rotate(-1deg)`,
          transformOrigin: "0 50%",
          zIndex: 0,
        }}
      />
      <span style={{ position: "relative", zIndex: 1 }}>{children}</span>
    </span>
  )
}

/** "FROM THE FULL DEVOTIONAL" on the accent, a soft diagonal (Figma). */
export function VoxHistoryTag({
  f,
  t,
  text,
  accent,
}: {
  f: (n: number) => number
  t: number
  text: string
  accent: string
}) {
  const a = interpolate(t, [0.1, 0.6], [0, 1], { ...clamp, easing: OUT })
  // The owner's gradient for orange; any other accent stays flat.
  const fill =
    accent === VOX_ORANGE
      ? "linear-gradient(135deg, #ff7544 0%, #c64837 100%)"
      : accent
  return (
    <div
      style={{
        position: "absolute",
        top: f(250),
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        opacity: a,
      }}
    >
      <div
        style={{
          background: fill,
          color: NEWSPRINT,
          fontFamily: SANS,
          fontWeight: 700,
          fontSize: f(20),
          letterSpacing: f(3),
          textTransform: "uppercase",
          padding: `${f(6)}px ${f(12)}px`,
        }}
      >
        {text}
      </div>
    </div>
  )
}

export function VoxHistoryLayout({
  f,
  t,
  words,
  spec,
}: {
  f: (n: number) => number
  t: number
  words: TimedWord[]
  spec: VoxHistorySpec
}) {
  const accent = spec.accent ?? VOX_ORANGE
  const cards = Math.max(1, ...words.map((w) => w.card + 1))
  const cardStart = (c: number) =>
    words.find((w) => w.card === c)?.startSec ?? c * 3
  const verseAt = 0.3
  const ringAt = said(words, spec.ringOn, verseAt + 0.8)
  // The clipping comes in with the sentence that quotes the source.
  const clipAt = Math.max(
    verseAt + 1.2,
    cardStart(Math.min(1, cards - 1)) - 0.1,
  )
  const markAt = said(words, spec.markOn, clipAt + 1.5, 1)
  const lastCard = cards - 1
  const strikeAt = said(
    words,
    spec.strikeOn,
    Math.max(markAt + 1.5, cardStart(lastCard)),
    // A named word is looked for after the mark; the default waits for the
    // last sentence.
    spec.strikeOn ? Math.min(1, lastCard) : lastCard,
  )
  const swapAt = strikeAt + 0.6
  const finaleAt = said(
    words,
    spec.finaleOn ?? spec.finale,
    swapAt + 1.5,
    lastCard,
  )
  const swapP = interpolate(t, [swapAt, swapAt + 0.45], [0, 1], {
    ...clamp,
    easing: OUT,
  })
  const recede = interpolate(t, [finaleAt, finaleAt + 0.3], [1, 0.3], clamp)
  const verse = splitAt(spec.verse.trim(), spec.ringOn)
  const body = splitAt(spec.body.trim(), spec.markOn)

  return (
    <>
      <div style={{ position: "absolute", inset: 0, opacity: recede }}>
        <Arrive
          f={f}
          t={t}
          at={verseAt}
          style={{
            top: f(360),
            left: f(110),
            width: f(680),
            transform: "rotate(-1.5deg)",
          }}
          background={NEWSPRINT}
          from="left"
          pad={`${f(18)}px ${f(30)}px`}
        >
          {/* A strip of the accent as tape across the top (owner's Figma). */}
          <div
            style={{
              position: "absolute",
              top: -f(32),
              left: "50%",
              width: f(130),
              height: f(34),
              marginLeft: -f(65),
              background: accent,
              opacity: 0.3,
              transform: "rotate(-1.5deg)",
            }}
          />
          <div
            style={{
              fontFamily: PT,
              fontSize: f(30),
              lineHeight: 1.45,
              color: INK,
              textAlign: "center",
            }}
          >
            {verse.before}
            {verse.hit ? (
              <Ring
                t={t}
                at={ringAt}
                id="voxh-ring-verse"
                color={accent}
                strokeWidth={4}
              >
                <span
                  style={{
                    fontWeight: 700,
                    fontStyle: "italic",
                    fontSize: f(36),
                  }}
                >
                  {verse.hit}
                </span>
              </Ring>
            ) : null}
            {verse.after}
          </div>
          {spec.reference ? (
            <div
              style={{
                fontFamily: PT,
                fontSize: f(18),
                letterSpacing: f(4),
                textTransform: "uppercase",
                color: "rgba(25,21,18,0.6)",
                textAlign: "center",
                paddingTop: f(4),
              }}
            >
              {spec.reference}
            </div>
          ) : null}
        </Arrive>
        <Arrive
          f={f}
          t={t}
          at={clipAt}
          style={{
            top: f(600),
            left: f(90),
            width: f(720),
            transform: "rotate(1.5deg)",
          }}
          paper={{ jpg: PAPER_CLIP_JPG, mask: PAPER_CLIP_MASK }}
          from="right"
          pad={`${f(96)}px ${f(70)}px 0 ${f(60)}px`}
        >
          {/* The sheet keeps its own proportions (760 x 539). */}
          <div style={{ height: f(511 - 96) }}>
            <div
              style={{
                fontFamily: NEWS,
                fontWeight: 700,
                fontSize: f(16),
                letterSpacing: f(4),
                textTransform: "uppercase",
                color: "rgba(25,21,18,0.7)",
              }}
            >
              {spec.label ?? "Historical context"}
            </div>
            <div
              style={{
                fontFamily: NEWS,
                fontWeight: 900,
                fontSize: f(40),
                lineHeight: 1.05,
                color: INK,
                width: f(530),
                paddingTop: f(8),
              }}
            >
              {spec.headline}
            </div>
            <div
              style={{
                height: f(2),
                background: "rgba(25,21,18,0.7)",
                margin: `${f(10)}px 0 ${f(10)}px`,
              }}
            />
            <div
              style={{
                fontFamily: NEWS,
                fontSize: f(26),
                lineHeight: 1.5,
                color: INK,
              }}
            >
              {body.before}
              {body.hit ? (
                <Band t={t} at={markAt} color={accent}>
                  {body.hit}
                </Band>
              ) : null}
              {body.after}
              {spec.strike ? (
                <div style={{ paddingTop: f(30) }}>
                  {spec.strikeBefore ?? "Not just a"}{" "}
                  <span
                    style={{ position: "relative", display: "inline-block" }}
                  >
                    <Strike
                      t={t}
                      at={strikeAt}
                      width={5}
                      id="voxh-strike"
                      color={accent}
                    >
                      {spec.strike}
                    </Strike>
                    {spec.swapTo && swapP > 0 ? (
                      <span
                        style={{
                          position: "absolute",
                          left: "50%",
                          bottom: "78%",
                          transform: `translateX(-50%) rotate(-6deg) scale(${(0.7 + 0.3 * swapP).toFixed(3)})`,
                          opacity: swapP,
                          color: INK,
                          fontFamily: HAND,
                          fontWeight: 700,
                          fontSize: "1.3em",
                          lineHeight: 1,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {spec.swapTo}
                      </span>
                    ) : null}
                  </span>
                </div>
              ) : null}
            </div>
            {spec.source ? (
              <div
                style={{
                  fontFamily: NEWS,
                  fontStyle: "italic",
                  fontSize: f(18),
                  color: "rgba(25,21,18,0.6)",
                  paddingTop: f(8),
                }}
              >
                {spec.source}
              </div>
            ) : null}
          </div>
        </Arrive>
      </div>
      {spec.finale ? (
        <Stamp f={f} t={t} at={finaleAt} text={spec.finale} color={accent} />
      ) : null}
    </>
  )
}
