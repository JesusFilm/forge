import { AbsoluteFill, Easing, interpolate } from "remotion"

import { SHORT_FONT_FAMILIES } from "../fonts"

import { PAPER_ROUGH_JPG, PAPER_ROUGH_MASK } from "./paper-assets"

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
/** Charcoal for the hand marks (owner, 2026-10-07: like charcoal, thicker). */
const CHAR = "#221d1a"
const SANS = `'${SHORT_FONT_FAMILIES.inter}', -apple-system, system-ui, sans-serif`
const SERIF = `'${SHORT_FONT_FAMILIES.ptSerif}', Georgia, serif`
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const
const OUT = Easing.bezier(0.2, 0.7, 0.2, 1)
/** Gentle arrival, no overshoot (owner: the first cut felt a bit harsh). */
const SOFT = Easing.bezier(0.25, 0.9, 0.3, 1)

export type VoxSpec = {
  /** The opening label ("ONE WORD"), on gold, with the first sentence. */
  kicker?: string
  /** A word of the explanation struck out as it is said ("medical"). */
  strike?: string
  /** The glossary box's senses; the first is ringed when its key word is
   *  said ("to save" / "save"). */
  definition?: string[]
  /** The word the definition ring waits for in the voice. */
  ringOn?: string
  /** Written over the struck highlight when the voice says it ("saved"). */
  swapTo?: string
  /** The last word, stamped in the middle of the frame ("SALVATION"). */
  finale?: string
  /** The glossary headword with its syllables ("heal·ed"); else the word. */
  headword?: string
  /** Its part of speech ("verb"). */
  pos?: string
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

/** The charcoal texture: a rough, speckled edge on any SVG stroke. */
function CharcoalDefs({ id, seed }: { id: string; seed: number }) {
  return (
    <defs>
      <filter id={id} x="-20%" y="-60%" width="140%" height="220%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.85"
          numOctaves="2"
          seed={seed}
          result="n"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="n"
          scale="5"
          xChannelSelector="R"
          yChannelSelector="G"
          result="d"
        />
        <feColorMatrix
          in="n"
          type="matrix"
          values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.2 1.75"
          result="grit"
        />
        <feComposite in="d" in2="grit" operator="in" />
      </filter>
    </defs>
  )
}

/** A charcoal stroke drawn through a word as it is said: two rough passes. */
function Strike({
  t,
  at,
  children,
  width = 12,
  id,
  color = CHAR,
}: {
  t: number
  at: number
  children: React.ReactNode
  width?: number
  id: string
  color?: string
}) {
  const p = interpolate(t, [at, at + 0.32], [0, 1], { ...clamp, easing: OUT })
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      {children}
      {p > 0 ? (
        // Revealed left to right by a clip, across the WHOLE word (owner,
        // 2026-10-07: a dash-drawn stroke under non-scaling-stroke stopped
        // after "medi").
        <span
          style={{
            position: "absolute",
            left: "-7%",
            width: `${(114 * p).toFixed(2)}%`,
            top: "26%",
            height: "48%",
            overflow: "hidden",
          }}
        >
          <svg
            viewBox="0 0 100 20"
            preserveAspectRatio="none"
            style={{
              position: "absolute",
              left: 0,
              width: `${(100 / Math.max(p, 0.001)).toFixed(3)}%`,
              top: 0,
              height: "100%",
              overflow: "visible",
              ...(color === GOLD
                ? { filter: "drop-shadow(0 1px 1.5px rgba(70,45,10,0.6))" }
                : {}),
            }}
          >
            <CharcoalDefs id={id} seed={4} />
            <g filter={`url(#${id})`}>
              {["M2,12 C30,8 60,14 98,7", "M4,14 C34,10 62,15 96,10"].map(
                (d, i) => (
                  <path
                    key={i}
                    d={d}
                    fill="none"
                    stroke={color}
                    strokeOpacity={i ? 0.55 : 0.95}
                    strokeWidth={i ? width * 0.6 : width}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                ),
              )}
            </g>
          </svg>
        </span>
      ) : null}
    </span>
  )
}

/** A loose charcoal ring around a phrase, drawn in 0.6s. */
function Ring({
  t,
  at,
  children,
  id,
  color = CHAR,
}: {
  t: number
  at: number
  children: React.ReactNode
  id: string
  color?: string
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
            left: "-14%",
            width: "128%",
            top: "-32%",
            height: "164%",
            overflow: "visible",
            ...(color === GOLD
              ? { filter: "drop-shadow(0 1px 1.5px rgba(70,45,10,0.6))" }
              : {}),
          }}
        >
          <CharcoalDefs id={id} seed={9} />
          <path
            filter={`url(#${id})`}
            d="M150,10 C190,14 198,48 172,64 C140,82 50,80 18,64 C-6,50 4,18 40,10 C80,2 130,4 168,14"
            fill="none"
            stroke={color}
            strokeOpacity={0.95}
            strokeWidth={color === GOLD ? 11 : 9}
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
          top: "0.14em",
          bottom: "0.04em",
          background: GOLD,
          transform: `scaleX(${p.toFixed(4)}) skewX(-8deg)`,
          transformOrigin: "0 50%",
          zIndex: 0,
        }}
      />
      <span style={{ position: "relative", zIndex: 1 }}>{children}</span>
    </span>
  )
}

/** A newspaper element arriving softly: down a few units and in. */
function Arrive({
  f,
  t,
  at,
  style,
  paper,
  pad,
  flip = false,
  from,
  children,
}: {
  f: (n: number) => number
  t: number
  at: number
  /** Placement: top, left, width, transform. */
  style: React.CSSProperties
  /** The owner's real paper (JPEG + alpha mask), stretched to the content. */
  paper: { jpg: string; mask: string }
  /** Turn the sheet over (rotated 180deg) so one paper reads as two. */
  flip?: boolean
  /** Slide in from this side of the frame, Vox style (owner, 2026-10-07). */
  from: "left" | "right"
  /** Inner padding, clear of the torn edges. */
  pad: string
  children: React.ReactNode
}) {
  if (t < at - 0.02) return null
  // In from off the frame's edge in 0.45s, a quick start and a soft landing
  // with the smallest overshoot, and a few degrees of turn that settle.
  const p = interpolate(t, [at, at + 0.45], [0, 1], {
    ...clamp,
    easing: Easing.bezier(0.16, 1.08, 0.3, 1),
  })
  const dir = from === "left" ? -1 : 1
  return (
    <div
      style={{
        position: "absolute",
        ...style,
        opacity: Math.min(1, p * 4),
        transform: `translateX(${((1 - p) * dir * f(900)).toFixed(1)}px) ${style.transform ?? ""} rotate(${((1 - p) * dir * 6).toFixed(2)}deg)`,
        // The shadow follows the paper's own torn outline.
        filter: `drop-shadow(0 ${f(12)}px ${f(16)}px rgba(0,0,0,0.45))`,
      }}
    >
      <div style={{ position: "relative", padding: pad }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `url(${paper.jpg})`,
            backgroundSize: "100% 100%",
            WebkitMaskImage: `url(${paper.mask})`,
            maskImage: `url(${paper.mask})`,
            WebkitMaskSize: "100% 100%",
            maskSize: "100% 100%",
            transform: flip ? "rotate(180deg)" : undefined,
          }}
        />
        <div style={{ position: "relative" }}>{children}</div>
      </div>
    </div>
  )
}

/** A gentle gold label for the opening word. */
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
  const p = interpolate(t, [at, at + 0.45], [0, 1], { ...clamp, easing: SOFT })
  const out =
    until != null ? interpolate(t, [until - 0.3, until], [1, 0], clamp) : 1
  return (
    <div
      style={{
        position: "absolute",
        top: f(top),
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        opacity: p * out,
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
          transform: `scale(${(1.05 - 0.05 * p).toFixed(4)}) rotate(-2deg)`,
          boxShadow: `0 ${f(8)}px ${f(20)}px rgba(0,0,0,0.4)`,
        }}
      >
        {text}
      </div>
    </div>
  )
}

/** The last word as a rubber stamp in the middle of the frame (owner,
 *  2026-10-07): gold ink, a double border, worn texture, a firm press. */
function Stamp({
  f,
  t,
  at,
  text,
}: {
  f: (n: number) => number
  t: number
  at: number
  text: string
}) {
  if (t < at - 0.02) return null
  const p = interpolate(t, [at, at + 0.22], [0, 1], {
    ...clamp,
    easing: Easing.bezier(0.3, 0, 0.6, 1),
  })
  const settle = interpolate(t, [at + 0.22, at + 0.42], [0, 1], {
    ...clamp,
    easing: OUT,
  })
  const scale = 1.55 - 0.6 * p + 0.05 * settle
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <svg width={0} height={0} style={{ position: "absolute" }}>
        <filter
          id="vox-stamp-wear"
          x="-10%"
          y="-20%"
          width="120%"
          height="140%"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="1.1"
            numOctaves="2"
            seed="21"
            result="n"
          />
          <feColorMatrix
            in="n"
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.2 1.45"
            result="grit"
          />
          <feComposite in="SourceGraphic" in2="grit" operator="in" />
        </filter>
      </svg>
      <div
        style={{
          transform: `rotate(-8deg) scale(${scale.toFixed(4)})`,
          opacity: Math.min(1, p * 2),
          filter: "url(#vox-stamp-wear)",
          border: `${f(7)}px solid ${GOLD}`,
          outline: `${f(3)}px solid ${GOLD}`,
          outlineOffset: f(6),
          padding: `${f(14)}px ${f(30)}px`,
          color: GOLD,
          fontFamily: SANS,
          fontWeight: 900,
          fontSize: f(104),
          letterSpacing: f(6),
          lineHeight: 1,
          textTransform: "uppercase",
          textShadow: "0 0 1px rgba(0,0,0,0.3)",
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  )
}

/**
 * The film as a newspaper photograph (owner, 2026-10-07): a halftone screen
 * whose dots grow with the shadows, printed in ink on newsprint, then dimmed
 * so the paper elements on top lead. The dot screen comes from the classic
 * contrast trick: a soft grey image screened with a dot gradient, then a hard
 * contrast turns each cell into a dot sized by its darkness.
 */
export function VoxHalftone({
  children,
}: {
  f: (n: number) => number
  children: React.ReactNode
}) {
  // Black and white, soft (owner, 2026-10-07: the halftone was too much):
  // a gentle contrast, blacks lifted to a warm grey, a light dim so the
  // paper still leads. The heavier grain sits on top (LANGUAGE_GRAIN).
  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{ filter: "grayscale(1) contrast(0.88) brightness(1.06)" }}
      >
        {children}
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "rgba(232,226,214,0.12)" }} />
      <AbsoluteFill style={{ background: "rgba(25,21,18,0.22)" }} />
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 50%, rgba(0,0,0,0.32) 100%)",
        }}
      />
    </AbsoluteFill>
  )
}

/** Kept for the earlier look; the newspaper version uses VoxHalftone. */
export function VoxBackdropTint() {
  return <AbsoluteFill style={{ background: "rgba(20,16,12,0.45)" }} />
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
  // Everything on paper steps back a little while the stamp lands.
  const recede = interpolate(t, [finaleAt, finaleAt + 0.3], [1, 0.3], clamp)
  const rule = (h: number) => ({ height: f(h), background: INK, opacity: 0.85 })

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
      <div style={{ position: "absolute", inset: 0, opacity: recede }}>
        {/* The verse as a newspaper pull quote: rules, a section line, the
            words in a sturdy serif. */}
        <Arrive
          f={f}
          t={t}
          at={verseAt}
          style={{
            top: f(340),
            left: f(95),
            width: f(690),
            transform: "rotate(-0.8deg)",
          }}
          // The same rough sheet as the glossary, turned over (owner,
          // 2026-10-07: the two papers did not go together).
          paper={{ jpg: PAPER_ROUGH_JPG, mask: PAPER_ROUGH_MASK }}
          flip
          from="left"
          pad={`${f(44)}px ${f(50)}px ${f(44)}px`}
        >
          {reference ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: f(14),
                margin: `${f(14)}px 0 ${f(8)}px`,
              }}
            >
              <div style={{ flex: 1, ...rule(1) }} />
              <div
                style={{
                  fontFamily: SERIF,
                  fontWeight: 700,
                  fontSize: f(22),
                  letterSpacing: f(5),
                  textTransform: "uppercase",
                  color: INK,
                }}
              >
                {reference}
              </div>
              <div style={{ flex: 1, ...rule(1) }} />
            </div>
          ) : null}
          <div
            style={{
              fontFamily: SERIF,
              fontSize: f(44),
              lineHeight: 1.62,
              color: INK,
              textAlign: "center",
            }}
          >
            {before}
            {word ? (
              <span style={{ position: "relative", display: "inline-block" }}>
                <Strike t={t} at={swapAt} width={10} id="vox-strike-swap">
                  <Marker t={t} at={markAt}>
                    <span style={{ fontWeight: 700 }}>{word}</span>
                  </Marker>
                </Strike>
                {vox.swapTo && swapP > 0 ? (
                  <span
                    style={{
                      position: "absolute",
                      left: "50%",
                      bottom: "70%",
                      transform: `translateX(-50%) rotate(-6deg) scale(${(0.7 + 0.3 * swapP).toFixed(3)})`,
                      opacity: swapP * 0.95,
                      color: CHAR,
                      fontFamily: SERIF,
                      fontStyle: "italic",
                      fontWeight: 700,
                      fontSize: "0.9em",
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
        </Arrive>
        {/* The meaning as a newspaper glossary box: an ink bar, a headword
            with its syllables and part of speech, numbered senses. */}
        {vox.definition?.length ? (
          <Arrive
            f={f}
            t={t}
            at={defAt}
            style={{
              // Its own space below the verse sheet (owner, 2026-10-07: the
              // sheets look wrong overlapping; no tape).
              top: f(735),
              left: f(150),
              width: f(610),
              transform: "rotate(1.2deg)",
            }}
            paper={{ jpg: PAPER_ROUGH_JPG, mask: PAPER_ROUGH_MASK }}
            from="right"
            pad={`${f(34)}px ${f(44)}px ${f(32)}px`}
          >
            <div
              style={{
                fontFamily: SANS,
                fontWeight: 700,
                fontSize: f(18),
                letterSpacing: f(5),
                textTransform: "uppercase",
                color: "rgba(25,21,18,0.7)",
                paddingBottom: f(6),
                borderBottom: `${f(2)}px solid rgba(25,21,18,0.7)`,
                display: "inline-block",
              }}
            >
              The word
            </div>
            <div style={{ paddingTop: f(10) }}>
              <div
                style={{ display: "flex", alignItems: "baseline", gap: f(14) }}
              >
                <span
                  style={{
                    fontFamily: SERIF,
                    fontWeight: 700,
                    fontSize: f(48),
                    color: INK,
                  }}
                >
                  {vox.headword ?? highlight}
                </span>
                {vox.pos ? (
                  <span
                    style={{
                      fontFamily: SERIF,
                      fontStyle: "italic",
                      fontSize: f(28),
                      color: "rgba(25,21,18,0.65)",
                    }}
                  >
                    {vox.pos}
                  </span>
                ) : null}
              </div>
              <div style={{ ...rule(1), margin: `${f(8)}px 0 ${f(12)}px` }} />
              {vox.strike ? (
                <div
                  style={{
                    fontFamily: SERIF,
                    fontSize: f(32),
                    color: "rgba(25,21,18,0.75)",
                    marginBottom: f(10),
                  }}
                >
                  not only a{" "}
                  <Strike t={t} at={strikeAt} id="vox-strike-def">
                    {vox.strike}
                  </Strike>{" "}
                  word
                </div>
              ) : null}
              {vox.definition.map((line, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: f(14),
                    fontFamily: SERIF,
                    fontSize: f(36),
                    lineHeight: 1.3,
                    color: INK,
                  }}
                >
                  <span
                    style={{
                      fontWeight: 700,
                      color: "rgba(25,21,18,0.55)",
                      fontSize: f(30),
                      paddingTop: f(8),
                    }}
                  >
                    {i + 1}
                  </span>
                  <span>
                    {i === 0 ? (
                      <Ring t={t} at={ringAt} id="vox-ring-def" color={GOLD}>
                        {line}
                      </Ring>
                    ) : (
                      line
                    )}
                  </span>
                </div>
              ))}
            </div>
          </Arrive>
        ) : null}
      </div>
      {vox.finale ? (
        <Stamp f={f} t={t} at={finaleAt} text={vox.finale} />
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
