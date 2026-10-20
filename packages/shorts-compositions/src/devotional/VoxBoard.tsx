import { Easing, Img, interpolate, staticFile } from "remotion"

import { SHORT_FONT_FAMILIES } from "../fonts"

import {
  PAPER_CLIP_JPG,
  PAPER_CLIP_MASK,
  PAPER_ROUGH_JPG,
  PAPER_ROUGH_MASK,
} from "./paper-assets"
import type { TimedWord } from "./VoxLanguage"

/**
 * Two more looks for the history short (owner, 2026-10-13: "more interesting
 * than papers replacing each other; show me two different techniques").
 *
 * `board`: one big evidence board the camera travels over, beat by beat:
 * clippings (the law, the dictionary, the historian), a hand-drawn map whose
 * marks appear as the voice names them, film stills pinned as halftone
 * photos, and a last pull back to the whole board.
 *
 * `notebook` (design C of the rotation): a lined page where everything is
 * drawn and written live, line by line, with photos taped in, and a page turn
 * to the second idea.
 *
 * Both are driven by the spoken words: every element names the word it waits
 * for (`on`), "word#2" for its second time. Coordinates are 900 x 1600 frame
 * units, converted by `f`; board items sit on a larger canvas in the same
 * units.
 */

export const INK = "#1d1712"
export const RED = "#c8412f"
export const GREEN = "#2e8b4f"
const NEWSPRINT = "#ece6d8"
export const HAND = `'${SHORT_FONT_FAMILIES.caveat}', cursive`
export const SERIF = `'${SHORT_FONT_FAMILIES.ptSerif}', Georgia, serif`
const SANS = `'${SHORT_FONT_FAMILIES.inter}', -apple-system, system-ui, sans-serif`
export const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const
export const OUT = Easing.bezier(0.2, 0.7, 0.2, 1)

/** When `on` is said: "word" is its first time, "word#2" its second. */
export function at(
  words: ReadonlyArray<TimedWord>,
  on: string | number | undefined,
  fallback: number,
): number {
  if (on == null) return fallback
  if (typeof on === "number") return on
  const [w, nth] = on.split("#")
  const bare = (s: string) => s.toLowerCase().replace(/[^\p{L}']/gu, "")
  const hits = words.filter((x) => bare(x.word) === bare(w ?? ""))
  const hit = hits[Math.max(0, Number(nth ?? 1) - 1)]
  return hit ? hit.startSec : fallback
}

/** 0..1 over `dur` seconds from `start`, eased. */
export const prog = (t: number, start: number, dur = 0.6, easing = OUT) =>
  interpolate(t, [start, start + dur], [0, 1], { ...clamp, easing })

/** A deterministic wobble so hand-drawn lines are not perfect. */
const wob = (i: number, seed: number) =>
  Math.sin(i * 12.9898 + seed * 78.233) * 0.5 + Math.sin(i * 4.1 + seed) * 0.5

/** A hand-drawn ellipse path around (cx, cy). */
export function handEllipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  seed = 1,
): string {
  const pts: string[] = []
  const n = 28
  for (let i = 0; i <= n + 3; i++) {
    const a = (i / n) * Math.PI * 2 - 0.4
    const k = 1 + wob(i, seed) * 0.035 + (i > n ? 0.05 : 0)
    pts.push(
      `${(cx + Math.cos(a) * rx * k).toFixed(1)},${(cy + Math.sin(a) * ry * k).toFixed(1)}`,
    )
  }
  return `M${pts.join(" L")}`
}

/** A slightly bent line from a to b, bent by `bend` (fraction of length). */
export function handLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  bend = 0.08,
): string {
  const mx = (x1 + x2) / 2 - (y2 - y1) * bend
  const my = (y1 + y2) / 2 + (x2 - x1) * bend
  return `M${x1},${y1} Q${mx.toFixed(1)},${my.toFixed(1)} ${x2},${y2}`
}

/** An arrow head at (x, y) pointing along angle `a` (radians). */
export function arrowHead(x: number, y: number, a: number, size = 22): string {
  const l = (d: number) =>
    `${(x - Math.cos(a + d) * size).toFixed(1)},${(y - Math.sin(a + d) * size).toFixed(1)}`
  return `M${l(0.45)} L${x},${y} L${l(-0.45)}`
}

/** An SVG stroke drawn on from 0 to `p`. */
export function Draw({
  d,
  p,
  color = INK,
  width = 5,
  dash,
}: {
  d: string
  p: number
  color?: string
  width?: number
  dash?: string
}) {
  if (p <= 0) return null
  return dash ? (
    <path
      d={d}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      strokeDasharray={dash}
      opacity={p}
    />
  ) : (
    <path
      d={d}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      pathLength={1}
      strokeDasharray="1 1"
      strokeDashoffset={1 - p}
    />
  )
}

/** Handwriting appearing left to right, as if written (`cps` letters/s). */
export function Written({
  t,
  start,
  text,
  cps = 22,
  style,
  children,
}: {
  t: number
  start: number
  text: string
  cps?: number
  style?: React.CSSProperties
  /** What is drawn (marks and all); `text` only sets the writing speed. */
  children?: React.ReactNode
}) {
  const p = interpolate(
    t,
    [start, start + Math.max(0.3, text.length / cps)],
    [0, 1],
    clamp,
  )
  if (p <= 0) return null
  return (
    <span
      style={{
        display: "inline-block",
        whiteSpace: "pre",
        // The last letter's tail hangs past the box: open 10% beyond it.
        clipPath: `inset(-20% ${((1 - p) * 110 - 10).toFixed(2)}% -30% -2%)`,
        ...style,
      }}
    >
      {children ?? text}
    </span>
  )
}

/** A marker band under a word, swept left to right. */
export function Band({
  p,
  color,
  children,
}: {
  p: number
  color: string
  children: React.ReactNode
}) {
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <span
        style={{
          position: "absolute",
          left: "-0.06em",
          right: "-0.06em",
          top: "0.62em",
          height: "0.5em",
          background: color,
          opacity: 0.55,
          borderRadius: "40% 18% 35% 22% / 55% 40% 60% 45%",
          transform: `scaleX(${p.toFixed(4)}) rotate(-1deg)`,
          transformOrigin: "0 50%",
        }}
      />
      <span style={{ position: "relative" }}>{children}</span>
    </span>
  )
}

/** Text with `mark` banded once `p` > 0. */
export function Marked({
  text,
  mark,
  p,
  color,
}: {
  text: string
  mark?: string
  p: number
  color: string
}) {
  const i = mark ? text.toLowerCase().indexOf(mark.toLowerCase()) : -1
  if (!mark || i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <Band p={p} color={color}>
        {text.slice(i, i + mark.length)}
      </Band>
      {text.slice(i + mark.length)}
    </>
  )
}

/** A film still printed as a sepia halftone photo with a white border and
 *  a strip of tape. */
export function Photo({
  f,
  file,
  width,
  ratio = 0.62,
  caption,
  focusX = 50,
  clean = false,
  tape = true,
}: {
  f: (n: number) => number
  file: string
  width: number
  ratio?: number
  caption?: string
  focusX?: number
  /** A clear print: lighter, shadows lifted, no coarse halftone (owner,
   *  Paralytic 2026-10-20: the dots read as spots on a face, and the dark
   *  stills were unreadable). */
  clean?: boolean
  /** The strip of tape on top; off when a pin holds the photo. */
  tape?: boolean
}) {
  return (
    <div
      style={{
        position: "relative",
        width: f(width),
        background: "#f4efe4",
        padding: `${f(14)}px ${f(14)}px ${f(caption ? 8 : 14)}px`,
        boxShadow: `0 ${f(10)}px ${f(22)}px rgba(0,0,0,0.45)`,
      }}
    >
      <div
        style={{
          position: "relative",
          height: f(width * ratio),
          overflow: "hidden",
        }}
      >
        <Img
          src={staticFile(file)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: `${focusX}% 50%`,
            filter: clean
              ? "grayscale(0.85) sepia(0.35) brightness(1.35) contrast(0.95) saturate(0.9)"
              : "grayscale(1) sepia(0.55) contrast(1.25) brightness(0.95)",
          }}
        />
        {/* Halftone dots over the print. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `radial-gradient(rgba(40,25,10,0.55) 32%, transparent 36%)`,
            backgroundSize: `${f(7)}px ${f(7)}px`,
            mixBlendMode: "multiply",
            opacity: clean ? 0 : 0.45,
          }}
        />
      </div>
      {caption ? (
        <div
          style={{
            fontFamily: HAND,
            fontWeight: 700,
            fontSize: f(30),
            color: INK,
            paddingTop: f(4),
            textAlign: "center",
          }}
        >
          {caption}
        </div>
      ) : null}
      {tape ? (
        <div
          style={{
            position: "absolute",
            top: -f(18),
            left: "50%",
            width: f(140),
            height: f(36),
            marginLeft: -f(70),
            background: "rgba(232,220,190,0.78)",
            transform: "rotate(-3deg)",
            boxShadow: `0 ${f(1)}px ${f(3)}px rgba(0,0,0,0.15)`,
          }}
        />
      ) : null}
    </div>
  )
}

/** A newspaper clipping on the owner's paper: section line, headline, rule,
 *  body with one word banded, source in italics. */
function Clipping({
  f,
  t,
  c,
  markAt,
}: {
  f: (n: number) => number
  t: number
  c: BoardClip
  markAt: number
}) {
  return (
    <div
      style={{
        position: "relative",
        width: f(c.w),
        padding: `${f(80)}px ${f(64)}px ${f(56)}px ${f(56)}px`,
        filter: `drop-shadow(0 ${f(10)}px ${f(14)}px rgba(0,0,0,0.45))`,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          WebkitMaskImage: `url(${c.rough ? PAPER_ROUGH_MASK : PAPER_CLIP_MASK})`,
          WebkitMaskSize: "100% 100%",
          backgroundImage: c.aged
            ? "radial-gradient(120% 90% at 40% 30%, #efe7d4 0%, #e3d8bd 75%, #d8caa8 100%)"
            : `url(${c.rough ? PAPER_ROUGH_JPG : PAPER_CLIP_JPG})`,
          backgroundSize: "100% 100%",
        }}
      />
      <div style={{ position: "relative" }}>
        <div
          style={{
            fontFamily: SANS,
            fontWeight: 700,
            fontSize: f(15),
            letterSpacing: f(4),
            textTransform: "uppercase",
            color: "rgba(29,23,18,0.65)",
          }}
        >
          {c.label}
        </div>
        <div
          style={{
            fontFamily: SERIF,
            fontWeight: 700,
            fontSize: f(c.headSize ?? 42),
            lineHeight: 1.08,
            color: INK,
            paddingTop: f(8),
          }}
        >
          {c.headline}
        </div>
        <div
          style={{
            height: f(2),
            background: "rgba(29,23,18,0.7)",
            margin: `${f(12)}px 0`,
          }}
        />
        <div
          style={{
            fontFamily: SERIF,
            fontSize: f(28),
            lineHeight: 1.45,
            color: INK,
          }}
        >
          <Marked
            text={c.body}
            mark={c.mark}
            p={prog(t, markAt, 0.4)}
            color={RED}
          />
        </div>
        {c.source ? (
          <div
            style={{
              fontFamily: SERIF,
              fontStyle: "italic",
              fontSize: f(18),
              color: "rgba(29,23,18,0.6)",
              paddingTop: f(10),
            }}
          >
            {c.source}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export type BoardClip = {
  kind: "clip"
  id: string
  x: number
  y: number
  w: number
  rot?: number
  on?: string | number
  label: string
  headline: string
  headSize?: number
  body: string
  mark?: string
  markOn?: string
  source?: string
  rough?: boolean
  /** The charge sheet's warm aged paper instead of the newsprint scan. */
  aged?: boolean
}
type BoardPhoto = {
  kind: "photo"
  clean?: boolean
  tape?: boolean
  id: string
  x: number
  y: number
  w: number
  rot?: number
  on?: string | number
  file: string
  caption?: string
  focusX?: number
}
type BoardStrip = {
  kind: "strip"
  id: string
  x: number
  y: number
  w: number
  rot?: number
  on?: string | number
  text: string
  ring?: string
  ringOn?: string
  reference?: string
}
type BoardNote = {
  kind: "note"
  id: string
  x: number
  y: number
  w: number
  rot?: number
  on?: string | number
  text: string
}
/** The map sheet (1000 x 760 inside, scaled to `w`): the village, Jesus at
 *  its edge, a red fence, the ten beyond it, and the distance the law set.
 *  Each mark waits for its word; labels never sit on a line (owner,
 *  2026-10-13: "text must not be crossed by lines"). */
type BoardMap = {
  kind: "map"
  id: string
  x: number
  y: number
  w: number
  rot?: number
  on?: string | number
  village: { on: string; label: string }
  dots: { on: string; label?: string }
  jesus: { on: string; label: string }
  cut?: { on: string; label: string }
  distance?: { on: string; label: string; lawOn?: string; law?: string }
  /** The distance marks fade when this is said (the story moves on). */
  fadeOn?: string
  /** A small printed header, there from the start so the sheet is never blank. */
  header?: string
}
/** The way home as a chain of boxes drawn on a sheet (700 x 1000 inside,
 *  scaled to `w`), the last one a house and the word, ringed. */
type BoardFlow = {
  kind: "flow"
  id: string
  x: number
  y: number
  w: number
  rot?: number
  on?: string | number
  title: string
  titleOn: string
  /** `ok`: the verdict, green with a tick. */
  steps: { text: string; on: string; ok?: boolean }[]
  home: { text: string; on: string; houseOn?: string }
}
/** A rubber stamp slammed onto the board ("BLASPHEMY"): red caps in a
 *  double frame, landing from large with a small shake. */
type BoardStamp = {
  kind: "stamp"
  id: string
  x: number
  y: number
  w: number
  rot?: number
  on?: string | number
  text: string
  /** A round seal, solid red with white letters, instead of the frame. */
  round?: boolean
}
/** A printed form with fields filled in by hand as the voice reaches them
 *  (the case file's charge sheet): a title, then label / value rows, a value
 *  optionally ringed in red. */
type BoardForm = {
  kind: "form"
  id: string
  x: number
  y: number
  w: number
  rot?: number
  on?: string | number
  title: string
  subtitle?: string
  rows: {
    label: string
    value: string
    on: string | number
    color?: "ink" | "red"
    ring?: boolean
  }[]
}
/** An index card: a red rule on top, a typed heading, ruled lines and a
 *  handwritten line on them. */
type BoardCard = {
  kind: "card"
  id: string
  x: number
  y: number
  w: number
  rot?: number
  on?: string | number
  heading: string
  hand: string
  handOn?: string | number
  ring?: string
  ringOn?: string
  source?: string
}
/** A red thread pinned between evidence (canvas units), drawn when `on`
 *  is said (the case file, owner, Paralytic 2026-10-20). */
export type BoardThread = {
  on: string | number
  points: [number, number][]
}
/** A push pin stuck in an item (canvas units), there once `on` is said or
 *  from the start; with `pins` set, threads draw no pins of their own. */
export type BoardPin = { x: number; y: number; on?: string | number }
export type BoardItem =
  | BoardClip
  | BoardPhoto
  | BoardStrip
  | BoardNote
  | BoardMap
  | BoardFlow
  | BoardStamp
  | BoardForm
  | BoardCard

export type BoardSpec = {
  /** Canvas size in frame units. */
  width: number
  height: number
  /** `cork` (default) or `desk`: dark wood, everything taped down (the
   *  case file, owner, Paralytic 2026-10-20). */
  surface?: "cork" | "desk" | "slate"
  /** A torch: a circle of light on the shot's centre, the rest in shadow;
   *  it opens out on a wide shot (owner, Paralytic 2026-10-20). */
  spotlight?: boolean
  /** Where on the frame the camera puts its target (frame units, default
   *  438); left of centre leaves room before the phone's right rail. */
  focusX?: number
  threads?: BoardThread[]
  pins?: BoardPin[]
  items: BoardItem[]
  /** Camera: centre (canvas units) and zoom, from the word `on`. */
  shots: { on: string | number; x: number; y: number; zoom: number }[]
}

/** A little stick person (head, arms, legs) at (x, y), popping in by `k`. */
export function StickPerson({
  x,
  y,
  k,
  color = INK,
}: {
  x: number
  y: number
  k: number
  color?: string
}) {
  if (k <= 0) return null
  return (
    <g opacity={Math.min(1, k)} transform={`translate(${x},${y}) scale(${k})`}>
      <circle cx={0} cy={0} r={9} fill={color} />
      <path
        d="M0,10 L0,36 M-12,22 L12,22 M0,36 L-9,52 M0,36 L9,52"
        stroke={color}
        strokeWidth={4}
        strokeLinecap="round"
        fill="none"
      />
    </g>
  )
}

/** The fence nobody crosses: a red zigzag. */
export function zigzag(x: number, y1: number, y2: number): string {
  let d = `M${x},${y1}`
  for (let y = y1, k = 0; y < y2; y += 28, k++)
    d += ` L${x + (k % 2 ? 14 : -14)},${y + 28}`
  return d
}

/** A house doodle with its door at (x, y). */
export const house = (x: number, y: number, s = 1) =>
  `M${x - 20 * s},${y} L${x - 20 * s},${y - 26 * s} L${x},${y - 44 * s} L${x + 20 * s},${y - 26 * s} L${x + 20 * s},${y} Z`

function HandLabelText({
  f,
  s,
  text,
  size,
  color,
}: {
  f: (n: number) => number
  s: number
  text: string
  size: number
  color: string
}) {
  return (
    <div
      style={{
        fontFamily: HAND,
        fontWeight: 700,
        fontSize: f(size),
        lineHeight: 1.1,
        color,
        whiteSpace: "nowrap",
        clipPath: `inset(-20% ${((1 - s) * 110 - 10).toFixed(1)}% -30% -2%)`,
      }}
    >
      {text}
    </div>
  )
}

function HandLabel({
  f,
  x,
  y,
  s,
  text,
  size = 40,
  color = INK,
  width,
}: {
  f: (n: number) => number
  x: number
  y: number
  s: number
  text: string
  size?: number
  color?: string
  /** Centre the label in a box this wide (from `x`). */
  width?: number
}) {
  if (s <= 0) return null
  if (width != null)
    return (
      <div
        style={{
          position: "absolute",
          left: f(x),
          top: f(y),
          width: f(width),
          display: "flex",
          justifyContent: "center",
        }}
      >
        <HandLabelText f={f} s={s} text={text} size={size} color={color} />
      </div>
    )
  return (
    <div
      style={{
        position: "absolute",
        left: f(x),
        top: f(y),
        fontFamily: HAND,
        fontWeight: 700,
        fontSize: f(size),
        lineHeight: 1.1,
        color,
        whiteSpace: "nowrap",
        clipPath: `inset(-20% ${((1 - s) * 110 - 10).toFixed(1)}% -30% -2%)`,
      }}
    >
      {text}
    </div>
  )
}

/** The charge sheet: printed title and labels, values written in by hand
 *  when their words are said, a red ring round the ones that matter. */
/** A push pin: a soft shadow down-right, a domed red head lit from the top
 *  left, a glint (owner, Paralytic 2026-10-20: bigger and more real). The
 *  head's gradient is the board's `#pinHead`. */
function PushPin({ x, y, opacity }: { x: number; y: number; opacity: number }) {
  return (
    <g opacity={opacity}>
      <ellipse cx={x + 7} cy={y + 9} rx={17} ry={13} fill="rgba(0,0,0,0.45)" />
      <circle cx={x} cy={y} r={17} fill="url(#pinHead)" />
      <circle
        cx={x}
        cy={y}
        r={17}
        fill="none"
        stroke="rgba(60,8,4,0.55)"
        strokeWidth={1.5}
      />
      <ellipse
        cx={x - 6}
        cy={y - 7}
        rx={5}
        ry={3.5}
        fill="rgba(255,255,255,0.7)"
      />
    </g>
  )
}

function FormSheet({
  f,
  t,
  fm,
  words,
}: {
  f: (n: number) => number
  t: number
  fm: BoardForm
  words: ReadonlyArray<TimedWord>
}) {
  const pad = 40
  const inner = fm.w - pad * 2
  return (
    <div
      style={{
        position: "relative",
        width: f(fm.w),
        background: `radial-gradient(120% 90% at 40% 30%, #efe7d4 0%, #e3d8bd 75%, #d8caa8 100%)`,
        padding: `${f(30)}px ${f(pad)}px ${f(26)}px`,
        boxShadow: `0 ${f(12)}px ${f(24)}px rgba(0,0,0,0.5)`,
      }}
    >
      <div
        style={{
          textAlign: "center",
          fontFamily: SERIF,
          fontWeight: 700,
          fontSize: f(40),
          letterSpacing: f(7),
          textTransform: "uppercase",
          color: INK,
        }}
      >
        {fm.title}
      </div>
      {fm.subtitle ? (
        <div
          style={{
            textAlign: "center",
            fontFamily: SANS,
            fontWeight: 500,
            fontSize: f(16),
            letterSpacing: f(3),
            textTransform: "uppercase",
            color: "#7a6a55",
            paddingTop: f(4),
          }}
        >
          {fm.subtitle}
        </div>
      ) : null}
      <div
        style={{
          margin: `${f(14)}px 0 ${f(6)}px`,
          borderTop: `${f(2)}px solid ${INK}`,
          borderBottom: `${f(1)}px solid ${INK}`,
          height: f(5),
          opacity: 0.7,
        }}
      />
      {fm.rows.map((r, i) => {
        const start = at(words, r.on, Infinity)
        const size = 52
        const textW = Math.min(inner, r.value.length * size * 0.42)
        const ringP = prog(t, start + Math.max(0.3, r.value.length / 22), 0.7)
        return (
          <div key={i} style={{ position: "relative", height: f(104) }}>
            <div
              style={{
                paddingTop: f(10),
                fontFamily: SANS,
                fontWeight: 600,
                fontSize: f(16),
                letterSpacing: f(3),
                textTransform: "uppercase",
                color: "#7a6a55",
              }}
            >
              {r.label}
            </div>
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: f(92),
                borderTop: `${f(2)}px dotted rgba(29,23,18,0.35)`,
              }}
            />
            <div style={{ position: "absolute", left: f(8), top: f(28) }}>
              <Written
                t={t}
                start={start}
                text={r.value}
                style={{
                  fontFamily: HAND,
                  fontWeight: 700,
                  fontSize: f(size),
                  lineHeight: 1.1,
                  color: r.color === "red" ? RED : INK,
                }}
              />
            </div>
            {r.ring ? (
              <svg
                width={f(inner)}
                height={f(124)}
                viewBox={`0 0 ${inner} 124`}
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  overflow: "visible",
                }}
              >
                <Draw
                  d={handEllipse(8 + textW / 2, 60, textW / 2 + 26, 36, i + 3)}
                  p={ringP}
                  color={RED}
                  width={4.5}
                />
              </svg>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

/** An index card: red rule on top, a typed heading, blue ruled lines with
 *  a handwritten line on them, a word of it banded in red. */
function IndexCard({
  f,
  t,
  c,
  words,
  a,
}: {
  f: (n: number) => number
  t: number
  c: BoardCard
  words: ReadonlyArray<TimedWord>
  a: number
}) {
  const handAt = at(words, c.handOn, a + 0.6)
  return (
    <div
      style={{
        position: "relative",
        width: f(c.w),
        background: "#f3ead4",
        padding: `${f(26)}px ${f(34)}px ${f(24)}px`,
        boxShadow: `0 ${f(10)}px ${f(20)}px rgba(0,0,0,0.45)`,
        backgroundImage: `linear-gradient(#d24b3c, #d24b3c), repeating-linear-gradient(transparent 0, transparent ${f(55)}px, rgba(70,110,170,0.32) ${f(55)}px, rgba(70,110,170,0.32) ${f(57)}px)`,
        backgroundSize: `100% ${f(3)}px, 100% 100%`,
        backgroundPosition: `0 ${f(84)}px, 0 ${f(86)}px`,
        backgroundRepeat: "no-repeat, repeat",
      }}
    >
      <div
        style={{
          fontFamily: SERIF,
          fontWeight: 700,
          fontSize: f(40),
          lineHeight: 1.1,
          color: INK,
          height: f(64),
        }}
      >
        {c.heading}
      </div>
      <div
        style={{
          fontFamily: HAND,
          fontWeight: 700,
          fontSize: f(46),
          lineHeight: `${f(57)}px`,
          color: INK,
          paddingTop: f(6),
          whiteSpace: "normal",
        }}
      >
        {/* Word by word, so a wrapped line never shows half a word. */}
        {c.hand.split(" ").map((w, i, all) => {
          const k = prog(t, handAt + i * 0.14, 0.3)
          const ringed =
            c.ring && w.toLowerCase().includes(c.ring.toLowerCase())
          return (
            <span key={i} style={{ opacity: k }}>
              {ringed ? (
                <Band
                  p={prog(t, at(words, c.ringOn ?? c.ring, handAt + 1), 0.4)}
                  color={RED}
                >
                  {w}
                </Band>
              ) : (
                w
              )}
              {i < all.length - 1 ? " " : ""}
            </span>
          )
        })}
      </div>
      {c.source ? (
        <div
          style={{
            fontFamily: SERIF,
            fontStyle: "italic",
            fontSize: f(18),
            color: "rgba(29,23,18,0.6)",
            paddingTop: f(10),
            textAlign: "right",
          }}
        >
          {c.source}
        </div>
      ) : null}
    </div>
  )
}

/** Rough paper behind a sheet. */
function RoughPaper() {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        WebkitMaskImage: `url(${PAPER_ROUGH_MASK})`,
        WebkitMaskSize: "100% 100%",
        maskImage: `url(${PAPER_ROUGH_MASK})`,
        maskSize: "100% 100%",
        backgroundImage: `url(${PAPER_ROUGH_JPG})`,
        backgroundSize: "100% 100%",
      }}
    />
  )
}

function MapSheet({
  f: f0,
  t,
  m,
  words,
}: {
  f: (n: number) => number
  t: number
  m: BoardMap
  words: ReadonlyArray<TimedWord>
}) {
  const W = 1000
  const H = 760
  const f = (n: number) => f0((n * m.w) / W)
  const vAt = at(words, m.village.on, 1e9)
  const dAt = at(words, m.dots.on, 1e9)
  const jAt = at(words, m.jesus.on, 1e9)
  const cAt = at(words, m.cut?.on, 1e9)
  const sAt = at(words, m.distance?.on, 1e9)
  const lAt = at(words, m.distance?.lawOn, 1e9)
  const fade = 1 - prog(t, at(words, m.fadeOn, 1e9), 0.5)
  const houses: [number, number][] = [
    [205, 450],
    [285, 420],
    [335, 505],
    [235, 530],
    [150, 495],
  ]
  return (
    <div
      style={{
        position: "relative",
        width: f(W),
        height: f(H),
        filter: `drop-shadow(0 ${f(12)}px ${f(16)}px rgba(0,0,0,0.45))`,
      }}
    >
      <RoughPaper />
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          overflow: "visible",
        }}
      >
        <Draw
          d={handEllipse(270, 425, 190, 160, 3)}
          p={prog(t, vAt, 0.8)}
          width={6}
        />
        {houses.map(([x, y], i) => (
          <Draw
            key={i}
            d={house(x, y)}
            p={prog(t, vAt + 0.35 + i * 0.08, 0.35)}
            width={4}
          />
        ))}
        <Draw
          d={handEllipse(560, 300, 88, 44, 5)}
          p={prog(t, jAt, 0.6)}
          color={RED}
          width={6}
        />
        <Draw
          d={zigzag(700, 262, 542)}
          p={prog(t, cAt, 0.6)}
          color={RED}
          width={8}
        />
        {Array.from({ length: 10 }, (_, i) => (
          <StickPerson
            key={i}
            x={752 + (i % 5) * 44}
            y={320 + Math.floor(i / 5) * 75}
            k={prog(t, dAt + i * 0.06, 0.25, Easing.bezier(0.2, 1.6, 0.4, 1))}
          />
        ))}
        <g opacity={fade}>
          <Draw
            d={handLine(575, 585, 875, 585, 0.01)}
            p={prog(t, sAt, 0.6)}
            color={RED}
            width={5}
          />
          <Draw
            d={arrowHead(875, 585, 0)}
            p={prog(t, sAt + 0.5, 0.2)}
            color={RED}
            width={5}
          />
          <Draw
            d={arrowHead(575, 585, Math.PI)}
            p={prog(t, sAt + 0.5, 0.2)}
            color={RED}
            width={5}
          />
        </g>
      </svg>
      {m.header ? (
        <div
          style={{
            position: "absolute",
            left: f(60),
            top: f(48),
            fontFamily: SANS,
            fontWeight: 700,
            fontSize: f(20),
            letterSpacing: f(4),
            textTransform: "uppercase",
            color: "rgba(29,23,18,0.55)",
          }}
        >
          {m.header}
        </div>
      ) : null}
      <HandLabel
        f={f}
        x={205}
        y={282}
        s={prog(t, vAt + 0.6, 0.5)}
        text={m.village.label}
      />
      <HandLabel
        f={f}
        x={502}
        y={274}
        s={prog(t, jAt + 0.2, 0.5)}
        text={m.jesus.label}
        size={44}
        color={RED}
      />
      {m.cut ? (
        <HandLabel
          f={f}
          x={640}
          y={196}
          s={prog(t, cAt + 0.4, 0.5)}
          text={m.cut.label}
          size={40}
          color={RED}
        />
      ) : null}
      <HandLabel
        f={f}
        x={728}
        y={480}
        s={prog(t, dAt + 0.6, 0.4)}
        text={m.dots.label ?? "10 прокажённых"}
        size={36}
      />
      {m.distance ? (
        <div style={{ opacity: fade }}>
          <HandLabel
            f={f}
            x={560}
            y={610}
            s={prog(t, sAt + 0.5, 0.5)}
            text={m.distance.label}
            size={40}
            color={RED}
          />
          {m.distance.law ? (
            <HandLabel
              f={f}
              x={758}
              y={610}
              s={prog(t, lAt, 0.4)}
              text={m.distance.law}
              size={40}
              color={RED}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function FlowSheet({
  f: f0,
  t,
  fl,
  words,
}: {
  f: (n: number) => number
  t: number
  fl: BoardFlow
  words: ReadonlyArray<TimedWord>
}) {
  const W = 700
  const H = 1000
  const f = (n: number) => f0((n * fl.w) / W)
  // Everything on the sheet's centre line (owner, 2026-10-13).
  const cx = W / 2
  const top = 190
  const step = 140
  const bw = 500
  const bh = 92
  const bx = cx - bw / 2
  const hAt = at(words, fl.home.on, 1e9)
  const houseAt = at(words, fl.home.houseOn ?? fl.home.on, hAt)
  const homeY = top + fl.steps.length * step + 20
  return (
    <div
      style={{
        position: "relative",
        width: f(W),
        height: f(H),
        filter: `drop-shadow(0 ${f(12)}px ${f(16)}px rgba(0,0,0,0.45))`,
      }}
    >
      <RoughPaper />
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          overflow: "visible",
        }}
      >
        {fl.steps.map((s, i) => {
          const a = at(words, s.on, 1e9)
          const y = top + i * step
          // The verdict is good news: green with a tick, never red
          // (owner, 2026-10-13: red read as a refusal).
          const c = s.ok ? GREEN : INK
          return (
            <g key={i}>
              {i > 0 ? (
                <>
                  <Draw
                    d={handLine(cx, y - step + bh + 6, cx, y - 8, 0.02)}
                    p={prog(t, a - 0.35, 0.3)}
                    width={5}
                  />
                  <Draw
                    d={arrowHead(cx, y - 8, Math.PI / 2, 18)}
                    p={prog(t, a - 0.05, 0.15)}
                    width={5}
                  />
                </>
              ) : null}
              <Draw
                d={`M${bx},${y} L${bx + bw},${y + 3} L${bx + bw - 2},${y + bh} L${bx + 2},${y + bh - 2} Z`}
                p={prog(t, a, 0.5)}
                color={c}
                width={s.ok ? 6 : 5}
              />
              {s.ok ? (
                <Draw
                  d={`M${bx + bw + 22},${y + 46} L${bx + bw + 40},${y + 66} L${bx + bw + 74},${y + 18}`}
                  p={prog(t, a + 0.55, 0.3)}
                  color={GREEN}
                  width={9}
                />
              ) : null}
            </g>
          )
        })}
        <Draw
          d={handLine(
            cx,
            top + (fl.steps.length - 1) * step + bh + 6,
            cx,
            homeY + 30,
            0.02,
          )}
          p={prog(t, hAt - 1.5, 0.5)}
          color={GREEN}
          width={7}
        />
        <Draw
          d={arrowHead(cx, homeY + 30, Math.PI / 2, 22)}
          p={prog(t, hAt - 1, 0.2)}
          color={GREEN}
          width={7}
        />
        {[
          [-60, 0],
          [0, -24],
          [55, 8],
        ].map(([dx, dy], i) => (
          <Draw
            key={i}
            d={house(cx - 130 + dx!, homeY + 160 + dy!)}
            p={prog(t, houseAt - 0.3 + i * 0.1, 0.35)}
            width={5}
          />
        ))}
        <Draw
          d={handEllipse(cx, homeY + 128, 250, 84, 7)}
          p={prog(t, hAt + 0.3, 0.7)}
          color={GREEN}
          width={7}
        />
      </svg>
      <HandLabel
        f={f}
        x={0}
        width={W}
        y={70}
        s={prog(t, at(words, fl.titleOn, 1e9), 0.6)}
        text={fl.title}
        size={66}
      />
      {fl.steps.map((s, i) => (
        <HandLabel
          key={i}
          f={f}
          x={bx}
          width={bw}
          y={top + i * step + 18}
          s={prog(t, at(words, s.on, 1e9) + 0.15, 0.5)}
          text={s.text}
          size={46}
          color={s.ok ? GREEN : INK}
        />
      ))}
      <HandLabel
        f={f}
        x={cx - 40}
        y={homeY + 86}
        s={prog(t, hAt, 0.45)}
        text={fl.home.text}
        size={72}
        color={GREEN}
      />
    </div>
  )
}

export function VoxBoard({
  f,
  t,
  words,
  spec,
  outAt,
}: {
  f: (n: number) => number
  t: number
  words: ReadonlyArray<TimedWord>
  spec: BoardSpec
  /** The closing turn's arrival: the board darkens under it. */
  outAt?: number
}) {
  // Camera: hold each shot, glide to the next in 0.9s starting a beat early.
  const shots = spec.shots
    // `on: "end"`: just after the voice stops (the closing pull-back).
    .map((s) => ({
      ...s,
      at:
        s.on === "end"
          ? (words.at(-1)?.endSec ?? 0) + 0.35
          : at(words, s.on, 0),
    }))
    .sort((a, b) => a.at - b.at)
  let cam = shots[0]!
  let x = cam.x
  let y = cam.y
  let z = cam.zoom
  for (let i = 1; i < shots.length; i++) {
    const s = shots[i]!
    // A longer trip across the board takes longer, up to 1.5s.
    const trip = Math.min(1.5, 0.9 + Math.hypot(s.x - x, s.y - y) / 3500)
    const p = prog(t, s.at - 0.3, trip, Easing.bezier(0.45, 0, 0.2, 1))
    if (p <= 0) break
    // A wide move dips the zoom a little mid-way, like a hand-held pan.
    const dip =
      1 -
      0.12 *
        Math.sin(Math.PI * p) *
        Math.min(1, Math.hypot(s.x - x, s.y - y) / 700)
    x = x + (s.x - x) * p
    y = y + (s.y - y) * p
    z = (z + (s.zoom - z) * p) * dip
    cam = s
  }
  // A slow push while a shot holds.
  z *= 1 + 0.025 * Math.min(1, Math.max(0, t - cam.at) / 6)
  const fx = spec.focusX ?? 438
  const fy = 760
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background: "#3a2a1c",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: f(spec.width),
          height: f(spec.height),
          transformOrigin: "0 0",
          transform: `translate(${f(fx - x * z).toFixed(2)}px, ${f(fy - y * z).toFixed(2)}px) scale(${z.toFixed(4)})`,
        }}
      >
        {spec.surface === "slate" ? (
          <>
            {/* A slate blackboard: green-black, chalk dust wiped in arcs. */}
            <div
              style={{
                position: "absolute",
                inset: -f(1400),
                background: `radial-gradient(ellipse at 50% 45%, #344039 0%, #27302b 50%, #181d1a 100%)`,
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: -f(1400),
                backgroundImage: `radial-gradient(ellipse 60% 18% at 30% 22%, rgba(230,235,225,0.07), transparent 70%), radial-gradient(ellipse 50% 14% at 70% 64%, rgba(230,235,225,0.06), transparent 70%), radial-gradient(ellipse 40% 12% at 40% 86%, rgba(230,235,225,0.05), transparent 70%), radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1.4px)`,
                backgroundSize: `100% 100%, 100% 100%, 100% 100%, ${f(7)}px ${f(7)}px`,
              }}
            />
          </>
        ) : spec.surface === "desk" ? (
          <>
            {/* A dark walnut desk under a lamp: grain, then a warm pool. */}
            <div
              style={{
                position: "absolute",
                inset: -f(400),
                background: `repeating-linear-gradient(92deg, #3b2617 0px, #45301d ${f(14)}px, #36231a ${f(29)}px, #4a321f ${f(47)}px, #3b2617 ${f(63)}px)`,
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: -f(400),
                background: `radial-gradient(ellipse at 50% 42%, rgba(255,214,150,0.28) 0%, rgba(255,200,130,0.08) 40%, rgba(0,0,0,0.45) 100%)`,
              }}
            />
          </>
        ) : (
          <>
            {/* The board: warm cork, darker to the edges. */}
            <div
              style={{
                position: "absolute",
                inset: -f(400),
                background: `radial-gradient(ellipse at 50% 45%, #a4825a 0%, #8a6a45 55%, #5b4129 100%)`,
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: -f(400),
                backgroundImage: `radial-gradient(rgba(40,25,10,0.35) 1px, transparent 1.6px), radial-gradient(rgba(255,240,210,0.12) 1px, transparent 1.6px)`,
                backgroundSize: `${f(9)}px ${f(9)}px, ${f(13)}px ${f(13)}px`,
                backgroundPosition: `0 0, ${f(4)}px ${f(6)}px`,
              }}
            />
          </>
        )}
        {spec.items.map((it) => {
          // On the board from the start unless an item names its word: the
          // camera travels to things already there (owner, 2026-10-13).
          const a = it.on == null ? -1 : at(words, it.on, 0)
          const p =
            it.on == null
              ? 1
              : prog(t, a, 0.5, Easing.bezier(0.16, 1.08, 0.3, 1))
          if (t < a - 0.02) return null
          const drop = (1 - p) * 60
          const body =
            it.kind === "clip" ? (
              <Clipping
                f={f}
                t={t}
                c={it}
                markAt={at(words, it.markOn ?? it.mark, a + 1)}
              />
            ) : it.kind === "photo" ? (
              <Photo
                f={f}
                file={it.file}
                width={it.w}
                {...(it.caption ? { caption: it.caption } : {})}
                {...(it.focusX != null ? { focusX: it.focusX } : {})}
                {...(it.clean ? { clean: true } : {})}
                {...(it.tape === false ? { tape: false } : {})}
              />
            ) : it.kind === "form" ? (
              <FormSheet f={f} t={t} fm={it} words={words} />
            ) : it.kind === "card" ? (
              <IndexCard f={f} t={t} c={it} words={words} a={a} />
            ) : it.kind === "map" ? (
              <MapSheet f={f} t={t} m={it} words={words} />
            ) : it.kind === "flow" ? (
              <FlowSheet f={f} t={t} fl={it} words={words} />
            ) : it.kind === "stamp" && it.round ? (
              <div
                style={{
                  width: f(it.w),
                  height: f(it.w),
                  borderRadius: "50%",
                  background: `radial-gradient(circle at 40% 35%, #d9473a 0%, ${RED} 60%, #9e2c20 100%)`,
                  boxShadow: `0 ${f(6)}px ${f(14)}px rgba(0,0,0,0.45), inset 0 0 0 ${f(7)}px rgba(255,255,255,0.0), inset 0 0 0 ${f(10)}px rgba(255,245,235,0.85), inset 0 0 0 ${f(14)}px ${RED}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: SANS,
                  fontWeight: 800,
                  fontSize: f(it.w / Math.max(5, it.text.length * 0.72)),
                  letterSpacing: f(3),
                  textTransform: "uppercase",
                  color: "#fff6ec",
                  transform: `scale(${(1 + 0.5 * (1 - prog(t, a, 0.22))).toFixed(4)})`,
                }}
              >
                {it.text}
              </div>
            ) : it.kind === "stamp" ? (
              <div
                style={{
                  width: f(it.w),
                  border: `${f(6)}px double ${RED}`,
                  padding: `${f(10)}px ${f(16)}px`,
                  fontFamily: SANS,
                  fontWeight: 800,
                  fontSize: f(it.w / Math.max(6, it.text.length * 0.78)),
                  letterSpacing: f(4),
                  textTransform: "uppercase",
                  color: RED,
                  textAlign: "center",
                  opacity: 0.88,
                  // Ink on paper, not a sticker: a faint mottle.
                  mixBlendMode: "multiply",
                  transform: `scale(${(1 + 0.5 * (1 - prog(t, a, 0.22))).toFixed(4)})`,
                }}
              >
                {it.text}
              </div>
            ) : it.kind === "strip" ? (
              <div
                style={{
                  width: f(it.w),
                  background: NEWSPRINT,
                  padding: `${f(20)}px ${f(30)}px`,
                  boxShadow: `0 ${f(10)}px ${f(16)}px rgba(0,0,0,0.45)`,
                  fontFamily: SERIF,
                  fontSize: f(30),
                  lineHeight: 1.45,
                  color: INK,
                  textAlign: "center",
                }}
              >
                <Marked
                  text={it.text}
                  mark={it.ring}
                  p={prog(t, at(words, it.ringOn ?? it.ring, a + 1), 0.4)}
                  color={RED}
                />
                {it.reference ? (
                  <div
                    style={{
                      fontSize: f(18),
                      letterSpacing: f(4),
                      textTransform: "uppercase",
                      color: "rgba(29,23,18,0.6)",
                      paddingTop: f(6),
                    }}
                  >
                    {it.reference}
                  </div>
                ) : null}
              </div>
            ) : (
              <div
                style={{
                  width: f(it.w),
                  background: "#f6e27a",
                  padding: `${f(22)}px ${f(26)}px`,
                  boxShadow: `0 ${f(8)}px ${f(14)}px rgba(0,0,0,0.4)`,
                  fontFamily: HAND,
                  fontWeight: 700,
                  fontSize: f(44),
                  lineHeight: 1.1,
                  color: INK,
                }}
              >
                <Written t={t} start={a + 0.2} text={it.text} />
              </div>
            )
          return (
            <div
              key={it.id}
              style={{
                position: "absolute",
                left: f(it.x),
                top: f(it.y),
                transform: `translate(-50%, -50%) translateY(${f(-drop).toFixed(1)}px) rotate(${(it.rot ?? 0) + (1 - p) * 4}deg) scale(${(1.08 - 0.08 * p).toFixed(4)})`,
                opacity: Math.min(1, p * 3),
              }}
            >
              {body}
            </div>
          )
        })}
        {spec.threads?.length ? (
          <svg
            width={f(spec.width)}
            height={f(spec.height)}
            viewBox={`0 0 ${spec.width} ${spec.height}`}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              overflow: "visible",
            }}
          >
            <defs>
              <radialGradient id="pinHead" cx="35%" cy="30%" r="75%">
                <stop offset="0%" stopColor="#ff7a66" />
                <stop offset="45%" stopColor="#d2321f" />
                <stop offset="100%" stopColor="#7c140b" />
              </radialGradient>
            </defs>
            {spec.threads.map((th, i) => {
              const k = prog(t, at(words, th.on, Infinity), 0.8)
              if (k <= 0) return null
              const d = th.points
                .map(([px, py], j) => `${j ? "L" : "M"}${px},${py}`)
                .join(" ")
              return (
                <g key={i}>
                  <Draw d={d} p={k} color="#b3261e" width={3.5} />
                  {spec.pins
                    ? null
                    : th.points.map(([px, py], j) => (
                        <PushPin
                          key={j}
                          x={px}
                          y={py}
                          opacity={Math.min(1, k * 2)}
                        />
                      ))}
                </g>
              )
            })}
            {(spec.pins ?? []).map((pn, i) => {
              const k =
                pn.on == null ? 1 : prog(t, at(words, pn.on, Infinity), 0.3)
              return k > 0 ? (
                <PushPin key={`p${i}`} x={pn.x} y={pn.y} opacity={k} />
              ) : null
            })}
          </svg>
        ) : null}
      </div>
      {spec.spotlight ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            // The torch opens out as the camera pulls back past zoom 0.9.
            opacity: interpolate(z, [0.55, 0.95], [0, 1], clamp),
            background: `radial-gradient(circle ${f(470)}px at ${f(fx)}px ${f(fy)}px, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 82%, rgba(0,0,0,0.78) 100%)`,
          }}
        />
      ) : null}
      {outAt != null ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "#000",
            opacity: 0.72 * prog(t, outAt - 0.4, 0.8),
            pointerEvents: "none",
          }}
        />
      ) : null}
      {/* A soft vignette on the frame, like a lens. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.45) 100%)",
          pointerEvents: "none",
        }}
      />
    </div>
  )
}
