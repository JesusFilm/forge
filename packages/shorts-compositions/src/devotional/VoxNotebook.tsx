import { Easing, interpolate } from "remotion"

import {
  arrowHead,
  at,
  clamp,
  Draw,
  HAND,
  handEllipse,
  handLine,
  INK,
  Photo,
  prog,
  RED,
  Written,
} from "./VoxBoard"
import type { TimedWord } from "./VoxLanguage"

/**
 * The history short drawn live in a notebook (design C of the insight
 * rotation; owner, 2026-10-13, the second of two techniques to compare).
 * A lined page; every line of handwriting is written as the voice reaches
 * it, every shape drawn stroke by stroke, film stills taped in. The second
 * idea turns the page. Elements wait for spoken words (`on`, "word#2").
 * Frame units 900 x 1600; text stays left of the phone's right-hand rail.
 */

const BLUE = "rgba(70,110,170,0.35)"

export type NotebookLine = {
  on: string | number
  text: string
  x: number
  y: number
  size?: number
  color?: "ink" | "red"
  /** A red underline under `under` (a substring), drawn when `underOn` is said. */
  under?: string
  underOn?: string
}
export type NotebookShape =
  | {
      kind: "ring"
      on: string | number
      x: number
      y: number
      rx: number
      ry: number
      color?: "ink" | "red"
    }
  | {
      kind: "line"
      on: string | number
      x1: number
      y1: number
      x2: number
      y2: number
      arrow?: "end" | "both"
      color?: "ink" | "red"
      width?: number
      bend?: number
    }
  | { kind: "dots"; on: string | number; x: number; y: number; n: number }
  | { kind: "houses"; on: string | number; x: number; y: number }
  | { kind: "wall"; on: string | number; x: number; y1: number; y2: number }
  | {
      kind: "box"
      on: string | number
      x: number
      y: number
      w: number
      h: number
      color?: "ink" | "red"
    }
export type NotebookPhoto = {
  on: string | number
  file: string
  x: number
  y: number
  w: number
  rot?: number
  caption?: string
  focusX?: number
}
export type NotebookPage = {
  /** The page turns in when this is said (the first page is there at 0). */
  on?: string | number
  lines: NotebookLine[]
  shapes: NotebookShape[]
  photos?: NotebookPhoto[]
}
export type NotebookSpec = { pages: NotebookPage[] }

const color = (c?: "ink" | "red") => (c === "red" ? RED : INK)

function Shape({ s, t, a }: { s: NotebookShape; t: number; a: number }) {
  if (s.kind === "ring")
    return (
      <Draw
        d={handEllipse(s.x, s.y, s.rx, s.ry, s.x % 7)}
        p={prog(t, a, 0.7)}
        color={color(s.color)}
        width={6}
      />
    )
  if (s.kind === "line") {
    const p = prog(t, a, 0.55)
    const ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1)
    const w = s.width ?? 5
    return (
      <>
        <Draw
          d={handLine(s.x1, s.y1, s.x2, s.y2, s.bend ?? 0.06)}
          p={p}
          color={color(s.color)}
          width={w}
        />
        {s.arrow ? (
          <Draw
            d={arrowHead(s.x2, s.y2, ang)}
            p={prog(t, a + 0.5, 0.2)}
            color={color(s.color)}
            width={w}
          />
        ) : null}
        {s.arrow === "both" ? (
          <Draw
            d={arrowHead(s.x1, s.y1, ang + Math.PI)}
            p={prog(t, a + 0.5, 0.2)}
            color={color(s.color)}
            width={w}
          />
        ) : null}
      </>
    )
  }
  if (s.kind === "dots")
    return (
      <>
        {Array.from({ length: s.n }, (_, i) => {
          const k = prog(t, a + i * 0.06, 0.25, Easing.bezier(0.2, 1.6, 0.4, 1))
          // A little stick person: head and body, in rows of five.
          const x = s.x + (i % 5) * 44
          const y = s.y + Math.floor(i / 5) * 70
          return k > 0 ? (
            <g
              key={i}
              opacity={k}
              transform={`translate(${x},${y}) scale(${k})`}
            >
              <circle cx={0} cy={0} r={9} fill={INK} />
              <path
                d="M0,10 L0,36 M-12,22 L12,22 M0,36 L-9,52 M0,36 L9,52"
                stroke={INK}
                strokeWidth={4}
                strokeLinecap="round"
                fill="none"
              />
            </g>
          ) : null
        })}
      </>
    )
  if (s.kind === "houses")
    return (
      <>
        {[
          [-50, -10],
          [20, -40],
          [50, 40],
          [-30, 60],
        ].map(([dx, dy], i) => {
          const x = s.x + dx!
          const y = s.y + dy!
          return (
            <Draw
              key={i}
              d={`M${x - 18},${y} L${x - 18},${y - 24} L${x},${y - 40} L${x + 18},${y - 24} L${x + 18},${y} Z`}
              p={prog(t, a + i * 0.12, 0.35)}
              width={4}
            />
          )
        })}
      </>
    )
  if (s.kind === "wall") {
    // A zigzag hatch: a fence nobody crosses.
    let d = `M${s.x},${s.y1}`
    for (let y = s.y1, k = 0; y < s.y2; y += 28, k++)
      d += ` L${s.x + (k % 2 ? 14 : -14)},${y + 28}`
    return <Draw d={d} p={prog(t, a, 0.6)} color={RED} width={7} />
  }
  return (
    <Draw
      d={`M${s.x},${s.y} L${s.x + s.w},${s.y + 3} L${s.x + s.w - 2},${s.y + s.h} L${s.x + 2},${s.y + s.h - 2} Z`}
      p={prog(t, a, 0.6)}
      color={color(s.color)}
      width={5}
    />
  )
}

/** The line with `under` underlined in red as `p` runs 0..1. */
function Underlined({
  text,
  under,
  p,
}: {
  text: string
  under?: string
  p: number
}) {
  const i = under ? text.indexOf(under) : -1
  if (!under || i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <span style={{ position: "relative", display: "inline-block" }}>
        {under}
        <span
          style={{
            position: "absolute",
            left: "-3%",
            width: "106%",
            top: "96%",
            height: "0.09em",
            borderRadius: "0.05em",
            background: RED,
            transform: `scaleX(${p.toFixed(4)}) rotate(-0.8deg)`,
            transformOrigin: "0 50%",
          }}
        />
      </span>
      {text.slice(i + under.length)}
    </>
  )
}

function Page({
  f,
  t,
  words,
  page,
  shift,
}: {
  f: (n: number) => number
  t: number
  words: ReadonlyArray<TimedWord>
  page: NotebookPage
  shift: number
}) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        transform: `translateX(${f(shift).toFixed(1)}px) rotate(${(shift / 900) * 4}deg)`,
        transformOrigin: "0% 100%",
        background: "#f5f0e3",
        boxShadow: shift
          ? `${-f(20)}px 0 ${f(40)}px rgba(0,0,0,0.35)`
          : undefined,
      }}
    >
      {/* Ruled lines and the red margin. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${f(55)}px, ${BLUE} ${f(55)}px, ${BLUE} ${f(57)}px)`,
          backgroundPositionY: f(14),
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: f(78),
          width: f(3),
          background: "rgba(200,65,47,0.45)",
        }}
      />
      {/* Paper grain. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `radial-gradient(rgba(120,90,50,0.10) 1px, transparent 1.5px)`,
          backgroundSize: `${f(6)}px ${f(6)}px`,
        }}
      />
      <svg
        viewBox="0 0 900 1600"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          overflow: "visible",
        }}
      >
        {page.shapes.map((s, i) => (
          <Shape key={i} s={s} t={t} a={at(words, s.on, 1e9)} />
        ))}
      </svg>
      {page.lines.map((l, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: f(l.x),
            top: f(l.y),
            fontFamily: HAND,
            fontWeight: 700,
            fontSize: f(l.size ?? 48),
            lineHeight: 1.1,
            color: color(l.color),
          }}
        >
          <Written t={t} start={at(words, l.on, 1e9)} text={l.text} cps={24}>
            <Underlined
              text={l.text}
              under={l.under}
              p={prog(t, at(words, l.underOn ?? l.under, 1e9), 0.4)}
            />
          </Written>
        </div>
      ))}
      {(page.photos ?? []).map((p, i) => {
        const a = at(words, p.on, 1e9)
        const k = interpolate(t, [a, a + 0.5], [0, 1], {
          ...clamp,
          easing: Easing.bezier(0.16, 1.1, 0.3, 1),
        })
        if (k <= 0) return null
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: f(p.x),
              top: f(p.y),
              transform: `translateY(${f((1 - k) * 80).toFixed(1)}px) rotate(${(p.rot ?? 0) + (1 - k) * 6}deg) scale(${(1.1 - 0.1 * k).toFixed(3)})`,
              opacity: Math.min(1, k * 3),
            }}
          >
            <Photo
              f={f}
              file={p.file}
              width={p.w}
              {...(p.caption ? { caption: p.caption } : {})}
              {...(p.focusX != null ? { focusX: p.focusX } : {})}
            />
          </div>
        )
      })}
    </div>
  )
}

export function VoxNotebook({
  f,
  t,
  words,
  spec,
}: {
  f: (n: number) => number
  t: number
  words: ReadonlyArray<TimedWord>
  spec: NotebookSpec
}) {
  // The newest page that has turned in is on top; the one under it stays put.
  const turns = spec.pages.map((p, i) =>
    i === 0 ? -1 : at(words, p.on, 1e9) - 0.3,
  )
  let top = 0
  for (let i = 1; i < turns.length; i++) if (t >= turns[i]!) top = i
  const shown = top > 0 ? [top - 1, top] : [0]
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background: "#2b2118",
      }}
    >
      {shown.map((i) => {
        const turnAt = turns[i]!
        const shift =
          i === top && i > 0
            ? interpolate(t, [turnAt, turnAt + 0.55], [900, 0], {
                ...clamp,
                easing: Easing.bezier(0.3, 0, 0.2, 1),
              })
            : 0
        return (
          <Page
            key={i}
            f={f}
            t={t}
            words={words}
            page={spec.pages[i]!}
            shift={shift}
          />
        )
      })}
    </div>
  )
}
