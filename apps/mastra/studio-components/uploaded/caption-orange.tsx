import React from "react"
import { useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion"

// v3: v2 plus an optional per-word colour flash (flashColor).
// Kinetic stack caption from the devotional vertical teaser (KineticCaption
// "stack", portrait, sizes hero 1.3 / accent 1.4 / plain 1.6). Fonts are
// Literata 500 caps, Literata 400 italic and Inter 600 caps, subset and
// embedded because Studio components cannot load font files.
const HERO_FONT = "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"
const ACCENT_FONT = "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"
const PLAIN_FONT = "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"
const SERIF = "'JFT Literata', Georgia, serif"
const SANS = "'JFT Inter', system-ui, sans-serif"

function bytes(b64: string) {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}
const g = globalThis as unknown as { __jftFonts?: boolean }
if (!g.__jftFonts && typeof FontFace !== "undefined" && typeof document !== "undefined") {
  g.__jftFonts = true
  const faces = [
    new FontFace("JFT Literata", bytes(HERO_FONT), { weight: "500" }),
    new FontFace("JFT Literata", bytes(ACCENT_FONT), { weight: "400", style: "italic" }),
    new FontFace("JFT Inter", bytes(PLAIN_FONT), { weight: "600" }),
  ]
  for (const f of faces) {
    document.fonts.add(f)
    void f.load()
  }
}

const FUNCTION = new Set(
  "a an the and or but of to in on at by for with from his her their its it is was were he she they we you i my your our all this that".split(" "),
)
const clean = (w: string) => w.toLowerCase().replace(/[^a-z']/g, "")
type Role = "hero" | "accent" | "plain"
type Token = { word: string; role: Role; at: number }

function tokens(line: string, hero: string, accents: string[], step: number, times: number[]): Token[] {
  const words = line.split(/\s+/).filter(Boolean)
  const heroWords = hero.split(/\s+/).map(clean).filter(Boolean)
  const roles: Role[] = words.map(() => "plain")
  for (let i = 0; heroWords.length && i + heroWords.length <= words.length; i++) {
    if (heroWords.every((h, k) => clean(words[i + k]) === h)) {
      for (let k = 0; k < heroWords.length; k++) roles[i + k] = "hero"
      break
    }
  }
  const acc = new Set(accents.map(clean))
  words.forEach((w, i) => {
    if (roles[i] === "plain" && acc.has(clean(w))) roles[i] = "accent"
  })
  return words.map((word, i) => ({ word, role: roles[i], at: Number.isFinite(times[i]) ? times[i] : i * step }))
}

function phrases(ts: Token[]): Token[][] {
  const out: Token[][] = []
  let run: Token[] = []
  const flush = () => {
    if (run.length) out.push(run)
    run = []
  }
  ts.forEach((t, i) => {
    if (t.role === "hero") {
      if (run.length && run[0].role !== "hero") flush()
      run.push(t)
      if (ts[i + 1]?.role !== "hero") flush()
      return
    }
    run.push(t)
    const content = !FUNCTION.has(clean(t.word))
    if ((content && run.length >= 2) || run.length >= 3 || t.role === "accent") flush()
  })
  flush()
  return out
}

// 1 kinetic unit = 3px at 1080x1920 (px(n*390/360), px = n*min(w,h)/390).
function measureHero(text: string, size: number, tracking: number, gap: number) {
  const words = text.split(/\s+/).filter(Boolean)
  if (typeof document === "undefined" || !document.body) return text.length * size * 0.8
  const probe = document.createElement("span")
  probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;left:-99999px;top:0;text-transform:uppercase"
  probe.style.fontFamily = SERIF
  probe.style.fontSize = `${size}px`
  probe.style.fontWeight = "500"
  probe.style.letterSpacing = `${tracking}px`
  document.body.appendChild(probe)
  let w = 0
  for (const word of words) {
    probe.textContent = word
    w += probe.getBoundingClientRect().width + gap
  }
  probe.remove()
  return w
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "")
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
/** `a` while k <= 0, `b` from k >= 1, linear between. */
function mix(a: string, b: string, k: number): string {
  const t = Math.max(0, Math.min(1, k))
  const x = rgb(a)
  const y = rgb(b)
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * t))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

export default function KineticQuestion({
  text,
  hero,
  accents,
  side,
  wordStepSec,
  startDelaySec,
  fadeOutSec,
  keepPunctuation,
  scrim,
  wordTimes,
  bottomPercent,
  accentColor,
  flashColor,
}: {
  text: string
  hero: string
  accents: string
  side: string
  wordStepSec: number
  startDelaySec: number
  fadeOutSec: number
  keepPunctuation: boolean
  scrim: number
  /** Optional: each word's start in seconds from the item start, comma
   *  separated (voice-synced); falls back to the even wordStepSec. */
  wordTimes?: string
  /** Block bottom edge, % of the frame height (teaser 27, history 38). */
  bottomPercent?: number
  accentColor?: string
  /** v3 (owner, 2026-10-08): each word lights in this colour as it is said,
   *  then cools to its own colour. Empty: no flash. */
  flashColor?: string
}) {
  const frame = useCurrentFrame()
  const { fps, durationInFrames, width, height } = useVideoConfig()
  const u = ((Math.min(width, height) / 390) * 390) / 360
  const time = frame / fps - startDelaySec
  const end = durationInFrames / fps
  const out =
    fadeOutSec > 0
      ? interpolate(frame / fps, [end - fadeOutSec, end - 0.02], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.bezier(0.42, 0, 0.58, 1),
        })
      : 1
  const times = (wordTimes ?? "").split(",").map((v) => v.trim()).filter(Boolean).map(Number)
  const ts = tokens(text, hero, accents.split(",").map((a) => a.trim()).filter(Boolean), wordStepSec, times)
  const lines = phrases(ts)
  const inset = 28 * u
  // Inside the platforms' safe area: blocks end by x = 920 of 1080 (the
  // action rail starts at 940); a right-hand block is anchored there.
  const maxWidth = width * (920 / 1080) - inset
  const rightInset = width * (160 / 1080)
  const heroSize = 46 * u * 1.3
  const heroText = ts.filter((t) => t.role === "hero").map((t) => t.word).join(" ")
  const heroW = heroText ? measureHero(heroText, heroSize, 1.2 * u, heroSize * 0.26) : 0
  const heroFit = heroW > 0 ? Math.min(1, maxWidth / heroW) : 1
  const look = (r: Role) =>
    r === "hero"
      ? { size: heroSize * heroFit, font: SERIF, weight: 500, italic: false, caps: true, tracking: 1.2 * u, color: "#ffffff" }
      : r === "accent"
        ? { size: 24 * u * 1.4, font: SERIF, weight: 400, italic: true, caps: false, tracking: 0, color: accentColor || "#f2c46b" }
        : { size: 10.5 * u * 1.6, font: SANS, weight: 600, italic: false, caps: true, tracking: 2.2 * u, color: "#f4efe8" }
  const left = side !== "right"
  return (
    <div style={{ position: "absolute", inset: 0, opacity: out, pointerEvents: "none" }}>
      {scrim > 0 ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: scrim,
            background: "linear-gradient(0deg, rgba(0,0,0,0.55), rgba(0,0,0,0.12) 45%, rgba(0,0,0,0) 70%)",
          }}
        />
      ) : null}
      <div
        style={{
          position: "absolute",
          ...(left ? { left: inset } : { right: rightInset }),
          bottom: `${bottomPercent && bottomPercent > 0 ? bottomPercent : 27}%`,
          maxWidth,
          display: "flex",
          flexDirection: "column",
          alignItems: left ? "flex-start" : "flex-end",
          gap: 7 * u,
        }}
      >
        {lines.map((ph, i) => (
          <div key={i} style={{ display: "flex", alignItems: "baseline" }}>
            {ph.map((t, k) => {
              const s = look(t.role)
              const p = interpolate(time, [t.at - 0.05, t.at + 0.45], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              })
              return (
                <span
                  key={k}
                  style={{
                    display: "inline-block",
                    fontFamily: s.font,
                    fontSize: s.size,
                    fontWeight: s.weight,
                    fontStyle: s.italic ? "italic" : "normal",
                    textTransform: s.caps ? "uppercase" : "none",
                    letterSpacing: s.tracking,
                    color: flashColor ? mix(flashColor, s.color, (time - t.at - 0.25) / 0.7) : s.color,
                    opacity: p,
                    transform: `translateY(${((1 - p) * s.size * 0.18).toFixed(2)}px)`,
                    filter: p < 0.99 ? `blur(${((1 - p) * s.size * 0.08).toFixed(2)}px)` : undefined,
                    textShadow: "0 2px 18px rgba(0,0,0,0.55)",
                    marginRight: s.size * 0.26,
                    lineHeight: 1,
                    whiteSpace: "nowrap",
                  }}
                >
                  {keepPunctuation ? t.word : t.word.replace(/[.,;:!?]+$/, "")}
                </span>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
