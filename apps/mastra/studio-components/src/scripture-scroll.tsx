import React, { useLayoutEffect, useRef } from "react"
import { useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion"

// Film narration as numbered Scripture, 9:16 (ScrollingScripture.tsx, Figma
// 411-2366); README has the controls. lines: `verse|t1,t2,...|text` per cue,
// word starts in s from the item start. build.mjs fills __FONT__.
const FONT = "__FONT__"
const FAMILY = "'DBP Literata', Georgia, serif"
const GOLD = "#f2c46b"

function bytes(b64: string) {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}
const g = globalThis as unknown as { __dbpLiterata?: boolean }
if (!g.__dbpLiterata && typeof FontFace !== "undefined" && typeof document !== "undefined") {
  g.__dbpLiterata = true
  const face = new FontFace("DBP Literata", bytes(FONT), { weight: "400" })
  document.fonts.add(face)
  face.load().catch(() => {})
}

type Word = { text: string; start: number }
type Verse = { num: string; words: Word[] }

function parse(lines: string, end: number): Verse[] {
  const cues = lines
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [verse = "", times = "", ...rest] = l.split("|")
      return {
        verse: verse.trim(),
        times: times
          .split(",")
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isFinite(n)),
        words: rest.join("|").split(/\s+/).filter(Boolean),
      }
    })
  const verses: Verse[] = []
  cues.forEach((c, ci) => {
    const from = c.times[0] ?? (ci ? (cues[ci - 1].times.slice(-1)[0] ?? 0) + 0.6 : 0)
    const to = cues[ci + 1]?.times[0] ?? end - 1
    const starts =
      c.times.length === c.words.length
        ? c.times
        : c.words.map((_, i) => c.times[i] ?? from + ((to - from) * i) / Math.max(1, c.words.length))
    let v = verses[verses.length - 1]
    if (!v || (c.verse && c.verse !== v.num)) {
      v = { num: c.verse, words: [] }
      verses.push(v)
    }
    c.words.forEach((text, i) => v!.words.push({ text, start: starts[i] }))
  })
  return verses
}

/** One continuous slow drift: each line reaches the middle halfway through
 *  its own reading (owner: "slow and smooth, not in jerks"). */
function scrollY(words: Word[], centres: number[], t: number, lineH: number) {
  if (!words.length || centres.length !== words.length) return 0
  const keys: { at: number; y: number }[] = []
  let i = 0
  while (i < words.length) {
    let j = i
    while (j + 1 < words.length && Math.abs(centres[j + 1] - centres[i]) < lineH / 2) j++
    const end = j + 1 < words.length ? words[j + 1].start : words[j].start + 0.6
    const at = (words[i].start + end) / 2
    const prev = keys[keys.length - 1]
    keys.push({ at: prev && at <= prev.at ? prev.at + 0.001 : at, y: centres[i] })
    i = j + 1
  }
  return keys.length > 1
    ? interpolate(
        t,
        keys.map((k) => k.at),
        keys.map((k) => k.y),
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
      )
    : keys[0].y
}

type Props = {
  heading: string
  lines: string
  still: boolean
  centerY: number
  dim: number
  fadeOutSec: number
}

export default function ScriptureScroll(props: Props) {
  const frame = useCurrentFrame()
  const { fps, durationInFrames, width: W } = useVideoConfig()
  const t = frame / fps
  const end = durationInFrames / fps
  // Design units of the Figma frame: 900 across.
  const dp = (n: number) => (n * W) / 900
  const verses = parse(props.lines, end)
  const all = verses.flatMap((v) => v.words)
  const listRef = useRef<HTMLDivElement>(null)
  const lineH = dp(70)
  const windowH = dp(383)
  const still = props.still

  // Read from the laid-out page on every frame, never cached, so nothing
  // measured under the fallback face steers the scroll.
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    if (still) {
      list.style.transform = "none"
      return
    }
    const spans = list.querySelectorAll<HTMLElement>("[data-w]")
    const centres = Array.from(spans).map((el) => el.offsetTop + el.offsetHeight / 2)
    const y = scrollY(all, centres, t, lineH)
    list.style.transform = `translateY(${(windowH / 2 - y).toFixed(2)}px)`
  })

  let k = -1
  for (let i = 0; i < all.length; i++) {
    if (all[i].start <= t) k = i
    else break
  }
  const opacity =
    interpolate(t, [0, 0.5], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) *
    interpolate(t, [end - props.fadeOutSec, end], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
  // 620 wide: the right edge stays at 912 px, clear of the action rail.
  const blockW = dp(620)
  const numW = dp(118)
  const left = W / 2 - blockW / 2
  const top0 = props.centerY - dp(50 + 20 + 2 + 24 + 383) / 2
  let n = 0
  return (
    <div style={{ position: "absolute", inset: 0, opacity, pointerEvents: "none" }}>
      <div style={{ position: "absolute", inset: 0, background: `rgba(0,0,0,${props.dim})` }} />
      <div
        style={{
          position: "absolute",
          left: W / 2 - dp(450),
          top: props.centerY + dp(19.5) - dp(379.5),
          width: dp(900),
          height: dp(759),
          borderRadius: dp(100),
          filter: `blur(${dp(36.65)}px)`,
          background: `radial-gradient(${dp(490.7)}px ${dp(413.8)}px at 50% 50%, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0) 100%)`,
        }}
      />
      <div style={{ position: "absolute", left, top: top0, width: blockW, display: "flex", flexDirection: "column", gap: dp(20) }}>
        <div
          style={{
            fontFamily: FAMILY,
            fontStyle: "italic",
            fontSize: dp(32),
            lineHeight: `${dp(50)}px`,
            color: "rgba(255,255,255,0.92)",
            opacity: 0.85,
          }}
        >
          {props.heading}
        </div>
        <div style={{ height: dp(2), borderRadius: dp(1), background: "rgba(255,255,255,0.35)" }} />
      </div>
      <div
        style={{
          position: "absolute",
          left,
          top: top0 + dp(50 + 20 + 24),
          width: blockW,
          ...(still
            ? {}
            : {
                height: windowH,
                overflow: "hidden",
                WebkitMaskImage: "linear-gradient(180deg, transparent 0%, #000 30%, #000 70%, transparent 100%)",
                maskImage: "linear-gradient(180deg, transparent 0%, #000 30%, #000 70%, transparent 100%)",
              }),
        }}
      >
        <div
          ref={listRef}
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            fontFamily: FAMILY,
            fontSize: still ? dp(48) : dp(56),
            lineHeight: 1.25,
            color: "rgba(255,255,255,0.92)",
            textShadow: `0 ${dp(2)}px ${dp(16)}px rgba(0,0,0,0.55), 0 0 ${dp(3)}px rgba(0,0,0,0.5)`,
          }}
        >
          {verses.map((v, vi) => (
            <div key={vi} style={{ display: "flex" }}>
              <div style={{ width: numW, flex: "none", paddingLeft: dp(20), color: "rgba(255,255,255,0.5)" }}>
                {v.num ? `${v.num}.` : ""}
              </div>
              <div style={{ width: blockW - numW }}>
                {v.words.map((w, wi) => {
                  const idx = n++
                  const on = idx === k
                  const read = idx < k
                  const next = all[idx + 1]?.start ?? w.start + 0.6
                  const settle = Math.min(0.4, Math.max(0.2, next - w.start))
                  const release = Math.max(next, w.start + settle + 0.01)
                  const pump = interpolate(
                    t,
                    [w.start, w.start + 0.12, w.start + settle, release, release + 0.22],
                    [1, 1.08, 1.04, 1.04, 1],
                    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.33, 0, 0.2, 1) },
                  )
                  return (
                    <span key={wi}>
                      <span
                        data-w
                        style={{
                          display: "inline-block",
                          transformOrigin: "50% 60%",
                          transform: `scale(${pump.toFixed(4)})`,
                          color: on ? GOLD : read ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.42)",
                          WebkitTextStroke: on ? `${dp(1.1)}px ${GOLD}` : undefined,
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
