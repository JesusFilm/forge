import { AbsoluteFill, Easing, interpolate } from "remotion"

import { SHORT_FONT_FAMILIES } from "../fonts"

/**
 * The language short as a Vox-style explainer (owner, 2026-10-06, on the
 * Bartimaeus word note): paper clippings over a muted film, a marker sweeping
 * the key word, hand annotations (a strike, a ring, the new word written in),
 * and bold labels on our gold. Every beat lands on the voice: the clipping
 * appears with the sentence that quotes the verse, the marker on the spoken
 * word, the strike on "medical", and so on (`vox` spec in the manifest).
 *
 * Coordinates are Figma units of a 900 x 1600 frame, converted by `f`.
 */

const GOLD = "#f2c46b"
const INK = "#191512"
const PAPER = "#f3eee3"
const PEN = "#d9412b"
const SANS = `'${SHORT_FONT_FAMILIES.inter}', -apple-system, system-ui, sans-serif`
const SERIF = `'${SHORT_FONT_FAMILIES.ptSerif}', Georgia, serif`
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const
const OUT = Easing.bezier(0.2, 0.7, 0.2, 1)
const SLAP = Easing.bezier(0.18, 1.4, 0.4, 1)

export type VoxSpec = {
  /** The opening label ("ONE WORD"), on gold, with the first sentence. */
  kicker?: string
  /** A word of the explanation struck out as it is said ("medical"). */
  strike?: string
  /** The dictionary card's lines; the first is ringed when its key word is
   *  said ("to save" / "save"). */
  definition?: string[]
  /** The word the definition ring waits for in the voice. */
  ringOn?: string
  /** Written over the struck highlight when the voice says it ("saved"). */
  swapTo?: string
  /** The last word, big on gold, when it is said ("SALVATION"). */
  finale?: string
}

type TimedWord = {
  word: string
  startSec: number
  endSec: number
  card: number
}

const bare = (w: string) => w.toLowerCase().replace(/[^a-z']/g, "")

/** When the voice first says `word` (from card `from` on), else `fallback`. */
function said(
  words: ReadonlyArray<TimedWord>,
  word: string | undefined,
  fallback: number,
  from = 0,
): number {
  if (!word) return fallback
  const target = bare(word)
  const w = words.find((x) => x.card >= from && bare(x.word) === target)
  return w ? w.startSec : fallback
}

/** A torn-paper outline: straight-ish edges with a small irregular tear. */
function tornClip(seed: number): string {
  const pts: string[] = []
  const n = 14
  const jitter = (i: number) =>
    0.6 + 0.6 * Math.abs(Math.sin(i * 12.9898 + seed * 78.233))
  for (let i = 0; i <= n; i++)
    pts.push(`${(i / n) * 100}% ${jitter(i).toFixed(2)}%`)
  for (let i = 0; i <= n; i++)
    pts.push(`${(100 - jitter(i + 31)).toFixed(2)}% ${(i / n) * 100}%`)
  for (let i = n; i >= 0; i--)
    pts.push(`${(i / n) * 100}% ${(100 - jitter(i + 57)).toFixed(2)}%`)
  for (let i = n; i >= 0; i--)
    pts.push(`${jitter(i + 83).toFixed(2)}% ${(i / n) * 100}%`)
  return `polygon(${pts.join(", ")})`
}

/** A paper clipping that slaps in: a touch big and turned, then settles. */
function Clipping({
  f,
  t,
  at,
  top,
  left,
  width,
  rotate,
  seed,
  children,
}: {
  f: (n: number) => number
  t: number
  at: number
  top: number
  left: number
  width: number
  rotate: number
  seed: number
  children: React.ReactNode
}) {
  if (t < at - 0.02) return null
  const p = interpolate(t, [at, at + 0.38], [0, 1], { ...clamp, easing: SLAP })
  const o = interpolate(t, [at, at + 0.12], [0, 1], clamp)
  return (
    <div
      style={{
        position: "absolute",
        top: f(top),
        left: f(left),
        width: f(width),
        opacity: o,
        transform: `scale(${(1.08 - 0.08 * p).toFixed(4)}) rotate(${(rotate + (1 - p) * 3).toFixed(3)}deg)`,
        transformOrigin: "50% 40%",
        filter: `drop-shadow(0 ${f(10)}px ${f(18)}px rgba(0,0,0,0.45))`,
      }}
    >
      <div
        style={{
          background: PAPER,
          clipPath: tornClip(seed),
          padding: `${f(30)}px ${f(34)}px`,
          // A whisper of paper fibre so it does not read as a flat box.
          backgroundImage:
            "radial-gradient(rgba(120,100,70,0.08) 1px, transparent 1.2px)",
          backgroundSize: `${f(7)}px ${f(7)}px`,
        }}
      >
        {children}
      </div>
    </div>
  )
}

/** Our gold, swept behind a word like a marker: left to right in 0.35s. */
function Marker({
  t,
  at,
  children,
}: {
  t: number
  at: number
  children: React.ReactNode
}) {
  const p = interpolate(t, [at, at + 0.35], [0, 1], { ...clamp, easing: OUT })
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <span
        style={{
          position: "absolute",
          left: "-0.08em",
          right: "-0.08em",
          top: "0.12em",
          bottom: "0.02em",
          background: GOLD,
          transform: `scaleX(${p.toFixed(4)}) skewX(-8deg)`,
          transformOrigin: "0 50%",
          borderRadius: "0.12em",
          zIndex: 0,
        }}
      />
      <span style={{ position: "relative", zIndex: 1 }}>{children}</span>
    </span>
  )
}

/** A hand stroke drawn through a word as it is said (pen red). */
function Strike({
  t,
  at,
  children,
  width = 4,
}: {
  t: number
  at: number
  children: React.ReactNode
  width?: number
}) {
  const p = interpolate(t, [at, at + 0.3], [0, 1], { ...clamp, easing: OUT })
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      {children}
      {p > 0 ? (
        <svg
          viewBox="0 0 100 20"
          preserveAspectRatio="none"
          style={{
            position: "absolute",
            left: "-6%",
            width: "112%",
            top: "30%",
            height: "40%",
            overflow: "visible",
          }}
        >
          <path
            d="M2,12 C30,8 60,14 98,7"
            fill="none"
            stroke={PEN}
            strokeWidth={width}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            pathLength={1}
            strokeDasharray="1 1"
            strokeDashoffset={1 - p}
          />
        </svg>
      ) : null}
    </span>
  )
}

/** A loose hand-drawn ring around a phrase, drawn in 0.6s (pen red). */
function Ring({
  t,
  at,
  children,
}: {
  t: number
  at: number
  children: React.ReactNode
}) {
  const p = interpolate(t, [at, at + 0.6], [0, 1], {
    ...clamp,
    easing: Easing.bezier(0.5, 0, 0.3, 1),
  })
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      {children}
      {p > 0 ? (
        <svg
          viewBox="0 0 200 80"
          preserveAspectRatio="none"
          style={{
            position: "absolute",
            left: "-12%",
            width: "124%",
            top: "-28%",
            height: "156%",
            overflow: "visible",
          }}
        >
          <path
            d="M150,10 C190,14 198,48 172,64 C140,82 50,80 18,64 C-6,50 4,18 40,10 C80,2 130,4 168,14"
            fill="none"
            stroke={PEN}
            strokeWidth={3.5}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            pathLength={1}
            strokeDasharray="1 1"
            strokeDashoffset={1 - p}
          />
        </svg>
      ) : null}
    </span>
  )
}

/** A bold caps label on our gold, slapped in. */
function GoldBar({
  f,
  t,
  at,
  until,
  text,
  top,
  size,
}: {
  f: (n: number) => number
  t: number
  at: number
  until?: number
  text: string
  top: number
  size: number
}) {
  if (t < at - 0.02) return null
  const p = interpolate(t, [at, at + 0.34], [0, 1], { ...clamp, easing: SLAP })
  const out =
    until != null ? interpolate(t, [until - 0.25, until], [1, 0], clamp) : 1
  return (
    <div
      style={{
        position: "absolute",
        top: f(top),
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        opacity: Math.min(1, p * 3) * out,
      }}
    >
      <div
        style={{
          background: GOLD,
          color: INK,
          fontFamily: SANS,
          fontWeight: 800,
          fontSize: f(size),
          lineHeight: 1.05,
          letterSpacing: f(1),
          textTransform: "uppercase",
          padding: `${f(10)}px ${f(22)}px`,
          transform: `scale(${(1.12 - 0.12 * p).toFixed(4)}) rotate(-2deg)`,
          boxShadow: `0 ${f(8)}px ${f(20)}px rgba(0,0,0,0.4)`,
        }}
      >
        {text}
      </div>
    </div>
  )
}

/** The muted, paper-toned picture under the explainer. */
export function VoxBackdropTint() {
  return (
    <>
      <AbsoluteFill style={{ background: "rgba(20,16,12,0.45)" }} />
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.55) 100%)",
        }}
      />
    </>
  )
}

export function VoxLanguageLayout({
  f,
  t,
  words,
  verse,
  highlight,
  reference,
  vox,
}: {
  f: (n: number) => number
  t: number
  words: TimedWord[]
  verse: string
  highlight: string
  reference: string
  vox: VoxSpec
}) {
  const cardStart = (c: number) =>
    words.find((w) => w.card === c)?.startSec ?? c * 3
  const verseAt = Math.max(0.3, cardStart(1) - 0.1)
  const markAt = said(words, highlight, verseAt + 1.2, 1)
  const defAt = Math.max(verseAt + 2, cardStart(2) - 0.05)
  const strikeAt = said(words, vox.strike, defAt + 2, 2)
  const ringAt = said(words, vox.ringOn, defAt + 4, 3)
  const swapAt = said(words, vox.swapTo, defAt + 8, 4)
  const finaleAt = said(words, vox.finale, swapAt + 3, 5)

  // The verse, split at the highlight so the marker can sit behind it.
  const text = verse.trim()
  const at = highlight
    ? text.toLowerCase().search(new RegExp(`\\b${highlight.toLowerCase()}\\b`))
    : -1
  const before = at >= 0 ? text.slice(0, at) : text
  const word = at >= 0 ? text.slice(at, at + highlight.length) : ""
  const after = at >= 0 ? text.slice(at + highlight.length) : ""
  const swapP = interpolate(t, [swapAt, swapAt + 0.45], [0, 1], {
    ...clamp,
    easing: OUT,
  })

  return (
    <>
      {vox.kicker ? (
        <GoldBar
          f={f}
          t={t}
          at={0.25}
          until={verseAt + 0.2}
          text={vox.kicker}
          top={520}
          size={84}
        />
      ) : null}
      <Clipping
        f={f}
        t={t}
        at={verseAt}
        top={360}
        left={95}
        width={690}
        rotate={-1.8}
        seed={1}
      >
        {reference ? (
          <div
            style={{
              fontFamily: SANS,
              fontWeight: 700,
              fontSize: f(20),
              letterSpacing: f(4),
              textTransform: "uppercase",
              color: "rgba(25,21,18,0.6)",
              marginBottom: f(12),
            }}
          >
            {reference}
          </div>
        ) : null}
        <div
          style={{
            fontFamily: SERIF,
            fontStyle: "italic",
            fontSize: f(46),
            lineHeight: 1.75,
            color: INK,
          }}
        >
          {before}
          {word ? (
            <span style={{ position: "relative", display: "inline-block" }}>
              <Strike t={t} at={swapAt} width={5}>
                <Marker t={t} at={markAt}>
                  <span style={{ fontWeight: 700 }}>{word}</span>
                </Marker>
              </Strike>
              {vox.swapTo && swapP > 0 ? (
                <span
                  style={{
                    position: "absolute",
                    left: "50%",
                    bottom: "72%",
                    transform: `translateX(-50%) rotate(-6deg) scale(${(0.7 + 0.3 * swapP).toFixed(3)})`,
                    opacity: swapP,
                    color: PEN,
                    fontFamily: SERIF,
                    fontStyle: "italic",
                    fontWeight: 700,
                    fontSize: "0.85em",
                    whiteSpace: "nowrap",
                  }}
                >
                  {vox.swapTo}
                </span>
              ) : null}
            </span>
          ) : null}
          {after}
        </div>
      </Clipping>
      {vox.definition?.length ? (
        <Clipping
          f={f}
          t={t}
          at={defAt}
          top={720}
          left={130}
          width={640}
          rotate={1.6}
          seed={2}
        >
          <div
            style={{
              fontFamily: SERIF,
              fontWeight: 700,
              fontSize: f(50),
              color: INK,
              marginBottom: f(8),
            }}
          >
            {highlight}
            <span
              style={{
                fontFamily: SANS,
                fontWeight: 600,
                fontSize: f(20),
                letterSpacing: f(2),
                marginLeft: f(14),
                color: "rgba(25,21,18,0.55)",
                textTransform: "uppercase",
              }}
            >
              means
            </span>
          </div>
          {vox.strike ? (
            <div
              style={{
                fontFamily: SERIF,
                fontSize: f(38),
                color: "rgba(25,21,18,0.75)",
                marginBottom: f(8),
              }}
            >
              not only a{" "}
              <Strike t={t} at={strikeAt}>
                {vox.strike}
              </Strike>{" "}
              word
            </div>
          ) : null}
          {vox.definition.map((line, i) => (
            <div
              key={i}
              style={{
                fontFamily: SERIF,
                fontSize: f(44),
                lineHeight: 1.35,
                color: INK,
              }}
            >
              {i === 0 ? (
                <Ring t={t} at={ringAt}>
                  {line}
                </Ring>
              ) : (
                line
              )}
            </div>
          ))}
        </Clipping>
      ) : null}
      {vox.finale ? (
        <GoldBar
          f={f}
          t={t}
          at={finaleAt}
          text={vox.finale}
          top={905}
          size={92}
        />
      ) : null}
    </>
  )
}

/** The spoken words as Vox-style captions: white bold on a black box. */
export function VoxCaption({
  f,
  t,
  tokens,
}: {
  f: (n: number) => number
  t: number
  tokens: ReadonlyArray<{ word: string; startSec: number; endSec: number }>
}) {
  const cur = tokens.findIndex((w, i) => {
    const next = tokens[i + 1]
    const until = next
      ? Math.min(next.startSec, Math.max(w.endSec + 0.35, w.startSec + 0.25))
      : w.endSec + 0.6
    return t >= w.startSec && t < until
  })
  const tok = cur >= 0 ? tokens[cur] : null
  if (!tok) return null
  const pop = interpolate(t, [tok.startSec, tok.startSec + 0.1], [0, 1], {
    ...clamp,
    easing: OUT,
  })
  return (
    <div
      style={{
        position: "absolute",
        top: f(1100),
        left: "50%",
        transform: `translateX(-50%) scale(${(0.92 + 0.08 * pop).toFixed(4)})`,
        opacity: pop,
        background: INK,
        color: "#fff",
        fontFamily: SANS,
        fontWeight: 700,
        fontSize: f(50),
        lineHeight: `${f(76)}px`,
        padding: `0 ${f(14)}px`,
        whiteSpace: "nowrap",
      }}
    >
      {tok.word.replace(/[,;:.!?\u201d"]+$/, "")}
    </div>
  )
}

/** "FROM THE FULL DEVOTIONAL" as a small gold tag at the top. */
export function VoxTag({
  f,
  t,
  text,
}: {
  f: (n: number) => number
  t: number
  text: string
}) {
  const a = interpolate(t, [0.1, 0.6], [0, 1], { ...clamp, easing: OUT })
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
          background: GOLD,
          color: INK,
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
