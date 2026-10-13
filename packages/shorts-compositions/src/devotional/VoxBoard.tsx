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
}: {
  f: (n: number) => number
  file: string
  width: number
  ratio?: number
  caption?: string
  focusX?: number
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
            filter: "grayscale(1) sepia(0.55) contrast(1.25) brightness(0.95)",
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
            opacity: 0.45,
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
          backgroundImage: `url(${c.rough ? PAPER_ROUGH_JPG : PAPER_CLIP_JPG})`,
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
}
type BoardPhoto = {
  kind: "photo"
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
/** The map sheet, 1000 x 760 inside; each mark waits for its word. */
type BoardMap = {
  kind: "map"
  id: string
  x: number
  y: number
  w: number
  rot?: number
  on?: string | number
  title?: string
  village: { on: string; label: string }
  edge?: { on: string; label: string }
  dots: { on: string }
  jesus: { on: string; label: string }
  cut?: { on: string; label: string }
  distance?: { on: string; label: string }
  home?: { on: string; label: string }
}
export type BoardItem =
  | BoardClip
  | BoardPhoto
  | BoardStrip
  | BoardNote
  | BoardMap

export type BoardSpec = {
  /** Canvas size in frame units. */
  width: number
  height: number
  items: BoardItem[]
  /** Camera: centre (canvas units) and zoom, from the word `on`. */
  shots: { on: string | number; x: number; y: number; zoom: number }[]
}

function MapSheet({
  f,
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
  const vAt = at(words, m.village.on, 1e9)
  const dAt = at(words, m.dots.on, 1e9)
  const jAt = at(words, m.jesus.on, 1e9)
  const eAt = at(words, m.edge?.on, 1e9)
  const cAt = at(words, m.cut?.on, 1e9)
  const sAt = at(words, m.distance?.on, 1e9)
  const hAt = at(words, m.home?.on, 1e9)
  // The village on the left, the ten outside it on the right, the road
  // coming in from the top right to the village's edge.
  const vx = 300
  const vy = 400
  const dots = Array.from({ length: 10 }, (_, i) => ({
    x: 700 + (i % 4) * 46 + (Math.floor(i / 4) % 2) * 22,
    y: 470 + Math.floor(i / 4) * 52,
  }))
  const jx = 560
  const jy = 250
  const label = (
    x: number,
    y: number,
    s: number,
    text: string,
    size = 40,
    color = INK,
  ) =>
    s > 0 ? (
      <div
        style={{
          position: "absolute",
          left: f(x),
          top: f(y),
          fontFamily: HAND,
          fontWeight: 700,
          fontSize: f(size),
          color,
          whiteSpace: "nowrap",
          opacity: Math.min(1, s * 2),
          clipPath: `inset(-20% ${((1 - s) * 100).toFixed(1)}% -30% 0)`,
        }}
      >
        {text}
      </div>
    ) : null
  return (
    <div
      style={{
        position: "relative",
        width: f(W),
        height: f(H),
        filter: `drop-shadow(0 ${f(12)}px ${f(16)}px rgba(0,0,0,0.45))`,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          WebkitMaskImage: `url(${PAPER_ROUGH_MASK})`,
          WebkitMaskSize: "100% 100%",
          backgroundImage: `url(${PAPER_ROUGH_JPG})`,
          backgroundSize: "100% 100%",
        }}
      />
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
        {/* Contour lines: an old map's hills, faint. */}
        <path
          d="M60,640 C220,600 300,690 470,650 S760,600 940,660"
          fill="none"
          stroke="rgba(29,23,18,0.18)"
          strokeWidth={3}
        />
        <path
          d="M80,690 C240,650 330,730 490,700 S770,650 930,705"
          fill="none"
          stroke="rgba(29,23,18,0.14)"
          strokeWidth={3}
        />
        {/* Village: wall, then houses. */}
        <Draw
          d={handEllipse(vx, vy, 190, 165, 3)}
          p={prog(t, vAt, 0.8)}
          width={6}
        />
        {[
          [250, 360],
          [320, 330],
          [350, 420],
          [255, 450],
          [190, 395],
        ].map(([x, y], i) => (
          <Draw
            key={i}
            d={`M${x - 20},${y} L${x - 20},${y - 26} L${x},${y - 44} L${x + 20},${y - 26} L${x + 20},${y} Z`}
            p={prog(t, vAt + 0.35 + i * 0.08, 0.35)}
            width={4}
          />
        ))}
        {/* The road to the village's edge. */}
        <Draw
          d={`M980,40 C840,120 700,180 ${jx + 10},${jy + 6} S470,330 480,360`}
          p={prog(t, jAt - 0.4, 0.9)}
          width={4}
          dash="14 12"
        />
        {/* The ten. */}
        {dots.map((d, i) => {
          const s = prog(
            t,
            dAt + i * 0.05,
            0.25,
            Easing.bezier(0.2, 1.6, 0.4, 1),
          )
          return s > 0 ? (
            <circle key={i} cx={d.x} cy={d.y} r={13 * s} fill={INK} />
          ) : null
        })}
        {/* Jesus, at the edge. */}
        {prog(t, jAt, 0.3) > 0 ? (
          <g opacity={prog(t, jAt, 0.3)}>
            <circle cx={jx} cy={jy} r={17} fill={RED} />
            <circle
              cx={jx}
              cy={jy}
              r={28}
              fill="none"
              stroke={RED}
              strokeWidth={4}
            />
          </g>
        ) : null}
        {/* Cut off: a red wall between the village and the ten. */}
        <Draw
          d="M560,420 C590,500 540,560 585,640 S560,720 590,750"
          p={prog(t, cAt, 0.6)}
          color={RED}
          width={9}
        />
        {/* The distance they kept: a double arrow to Jesus. */}
        <Draw
          d={handLine(700, 450, jx + 20, jy + 30, 0.06)}
          p={prog(t, sAt, 0.6)}
          color={RED}
          width={5}
        />
        <Draw
          d={arrowHead(
            jx + 20,
            jy + 30,
            Math.atan2(jy + 30 - 450, jx + 20 - 700),
          )}
          p={prog(t, sAt + 0.5, 0.25)}
          color={RED}
          width={5}
        />
        <Draw
          d={arrowHead(700, 450, Math.atan2(450 - (jy + 30), 700 - (jx + 20)))}
          p={prog(t, sAt + 0.5, 0.25)}
          color={RED}
          width={5}
        />
        {/* The way home: from the ten, round the wall, into the village. */}
        <Draw
          d="M760,560 C700,720 420,720 330,520"
          p={prog(t, hAt - 0.6, 0.9)}
          color={RED}
          width={8}
        />
        <Draw
          d={arrowHead(330, 520, Math.atan2(520 - 600, 330 - 380), 30)}
          p={prog(t, hAt + 0.25, 0.25)}
          color={RED}
          width={8}
        />
      </svg>
      {m.title ? (
        <div
          style={{
            position: "absolute",
            left: f(50),
            top: f(40),
            fontFamily: SANS,
            fontWeight: 700,
            fontSize: f(16),
            letterSpacing: f(4),
            textTransform: "uppercase",
            color: "rgba(29,23,18,0.6)",
            opacity: prog(t, vAt - 0.3, 0.4),
          }}
        >
          {m.title}
        </div>
      ) : null}
      {label(205, 545, prog(t, vAt + 0.6, 0.5), m.village.label)}
      {label(605, 165, prog(t, jAt + 0.2, 0.5), m.jesus.label, 40, RED)}
      {m.edge ? label(410, 300, prog(t, eAt, 0.5), m.edge.label, 34) : null}
      {m.cut
        ? label(470, 655, prog(t, cAt + 0.4, 0.5), m.cut.label, 38, RED)
        : null}
      {m.distance
        ? label(660, 320, prog(t, sAt + 0.6, 0.5), m.distance.label, 38, RED)
        : null}
      {m.home
        ? label(440, 690, prog(t, hAt + 0.3, 0.5), m.home.label, 46, RED)
        : null}
      {label(735, 640, prog(t, dAt + 0.6, 0.4), "10", 46)}
    </div>
  )
}

export function VoxBoard({
  f,
  t,
  words,
  spec,
}: {
  f: (n: number) => number
  t: number
  words: ReadonlyArray<TimedWord>
  spec: BoardSpec
}) {
  // Camera: hold each shot, glide to the next in 0.9s starting a beat early.
  const shots = spec.shots
    .map((s) => ({ ...s, at: at(words, s.on, 0) }))
    .sort((a, b) => a.at - b.at)
  let cam = shots[0]!
  let x = cam.x
  let y = cam.y
  let z = cam.zoom
  for (let i = 1; i < shots.length; i++) {
    const s = shots[i]!
    const p = prog(t, s.at - 0.25, 0.9, Easing.bezier(0.45, 0, 0.2, 1))
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
  const fx = 438
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
        {spec.items.map((it) => {
          const a = at(words, it.on, 0)
          const p = prog(t, a, 0.5, Easing.bezier(0.16, 1.08, 0.3, 1))
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
              />
            ) : it.kind === "map" ? (
              <MapSheet f={f} t={t} m={it} words={words} />
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
      </div>
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
