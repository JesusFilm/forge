import React from "react"
import { useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion"

// Kinetic stack caption from the devotional vertical teaser (KineticCaption
// "stack", portrait, sizes hero 1.3 / accent 1.4 / plain 1.6). Fonts are
// Literata 500 caps, Literata 400 italic and Inter 600 caps, subset and
// embedded because Studio components cannot load font files.
const HERO_FONT = "__HERO__"
const ACCENT_FONT = "__ACCENT__"
const PLAIN_FONT = "__PLAIN__"
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
                    color: s.color,
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
