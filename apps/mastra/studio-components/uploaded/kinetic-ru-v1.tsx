import React from "react"
import { useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion"

// ru-v1: v3 for Russian (2026-10-09): Cyrillic font subsets (hero and
// small caps: capitals; accent italic: lower case), Cyrillic-aware word
// matching and Russian function words.
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
  "в во на и а но с со к ко по за из у о об от до для что как не ни же ли бы мы ты он она они его её их мой твой это этот тот когда который где всё уже".split(" "),
)
const clean = (w: string) => w.toLowerCase().replace(/[^\p{L}']/gu, "")
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
