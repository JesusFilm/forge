import type { CSSProperties } from "react"
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion"

import { APERCU_FAMILY } from "./apercu"
import type { DevotionalCard } from "./schema"
import type { DevotionalStyle } from "./styles"

const REF = 390 // design reference card width
// A WIDE, soft shadow — a large blur radius so it reads as a diffuse halo that
// just lifts the text off the nearly-sharp footage, never as a hard drop shadow
// (owner ask: increase the shadow's blur, keep it subtle).
const TEXT_SHADOW = "0 2px 28px rgba(0,0,0,0.32)"
// The cover intro animation runs at a FIXED pace (seconds), then holds the
// settled frame. A longer narration (e.g. once the spoken date is added)
// EXTENDS THE HOLD — it never slows the logo/headline/date animation. Owner
// rule: don't stretch the animation to fill the card; just hold the last frame.
const COVER_ANIM_SEC = 7
const SANS = `'${APERCU_FAMILY}', -apple-system, system-ui, sans-serif`
const SERIF = "Georgia, 'Times New Roman', serif"
const BRAND_PATH =
  "M53,0H2.7A2.7,2.7,0,0,0,0,2.7V23.38A2.71,2.71,0,0,0,2,26L54.36,40.66a1,1,0,0,0,1.29-1V2.7A2.7,2.7,0,0,0,53,0Z"
const GRAIN_URL =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")"

// Official Jesus Film Primary Brandmark (mark + "JESUS FILM" wordmark), viewBox
// 160.27×40.7. The parallelogram mark fills the left ~55.65 units, so when the
// lockup is rendered at the symbol's height the mark lands exactly at the
// standalone symbol's width — the intro clips the wordmark away to reveal it.
const BRAND_LOCKUP_SVG = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160.27 40.7'><g fill='#ee3441'><path d='M20,10.43a1.89,1.89,0,0,0-1.87,1.65H21.9A1.8,1.8,0,0,0,20,10.43Z'/><path d='M64.64,24.27l-2.06,6.09H63.8l.44-1.43h1.93l.45,1.43h1.22l-2.07-6.09Zm-.07,3.61.64-2.11.64,2.11Z'/><path d='M73.36,25.25a1.49,1.49,0,0,1,1.51,1.06l1-.26a2.37,2.37,0,0,0-2.52-1.84,2.85,2.85,0,0,0-2.88,3.11,2.86,2.86,0,0,0,2.88,3.11,2.38,2.38,0,0,0,2.52-1.84l-1-.26a1.5,1.5,0,0,1-1.51,1.06c-.94,0-1.73-.66-1.73-2.07S72.42,25.25,73.36,25.25Z'/><path d='M77.89,26.69V26H76.81v4.38h1.08V28.81c0-1.42.55-1.94,1.17-1.94a.82.82,0,0,1,.45.13l.2-1a1.49,1.49,0,0,0-1.82.69Z'/><path d='M83.13,27.73c0,1.15-.48,1.78-1,1.78-.36,0-.63-.2-.63-.72V26H80.43v3.13a1.22,1.22,0,0,0,1.34,1.32,1.65,1.65,0,0,0,1.36-.77v.7h1.08V26H83.13Z'/><polygon points='90.38 28.07 88.94 24.27 87.67 24.27 87.67 30.36 88.8 30.36 88.8 26.61 89.97 29.81 90.79 29.81 91.95 26.61 91.95 30.36 93.08 30.36 93.08 24.27 91.81 24.27 90.38 28.07'/><path d='M94.93,24a.69.69,0,0,0-.7.7.7.7,0,0,0,1.4,0A.69.69,0,0,0,94.93,24Z'/><rect x='94.39' y='25.98' width='1.08' height='4.38'/><path d='M99.09,25.91a1.65,1.65,0,0,0-1.35.77V26H96.66v4.38h1.08V28.61c0-1.15.48-1.78,1-1.78.36,0,.62.2.62.72v2.81h1.08V27.23A1.23,1.23,0,0,0,99.09,25.91Z'/><rect x='101.63' y='25.98' width='1.08' height='4.38'/><path d='M102.17,24a.68.68,0,0,0-.69.7.67.67,0,0,0,.69.69.68.68,0,0,0,.7-.69A.69.69,0,0,0,102.17,24Z'/><path d='M105.71,27.78c-.74-.27-.89-.43-.89-.62s.2-.33.42-.33a.85.85,0,0,1,.71.38l.64-.59a1.55,1.55,0,0,0-1.37-.71,1.29,1.29,0,0,0-1.39,1.23,1.37,1.37,0,0,0,1,1.28c.46.19.9.37.9.66a.44.44,0,0,1-.5.43.94.94,0,0,1-.87-.72l-.86.46a1.73,1.73,0,0,0,1.73,1.18,1.39,1.39,0,0,0,1.5-1.42C106.78,28.36,106.34,28,105.71,27.78Z'/><path d='M109.56,29.51c-.36,0-.57-.17-.57-.71V26.9h1.16V26H109V24.21l-1.08.67V26h-.68v.92h.68v1.91a1.46,1.46,0,0,0,1.61,1.62,1.68,1.68,0,0,0,.71-.15l-.25-.87A.92.92,0,0,1,109.56,29.51Z'/><path d='M112.06,26.69V26H111v4.38h1.08V28.81c0-1.42.54-1.94,1.17-1.94a.82.82,0,0,1,.45.13l.2-1a1.55,1.55,0,0,0-.53-.09A1.53,1.53,0,0,0,112.06,26.69Z'/><polygon points='116.42 28.68 115.42 25.98 114.33 25.98 115.92 30.07 115.17 32.14 116.21 32.14 118.47 25.98 117.4 25.98 116.42 28.68'/><path d='M53,0H2.7A2.7,2.7,0,0,0,0,2.7V23.38A2.71,2.71,0,0,0,2,26L54.36,40.66a1,1,0,0,0,1.29-1V2.7A2.7,2.7,0,0,0,53,0Zm-39,13.18c0,3.11-1.34,4.37-3.83,4.37A3.43,3.43,0,0,1,6.4,14.44L8.6,14c.18,1,.7,1.52,1.51,1.52,1,0,1.6-.55,1.6-2.07v-8h2.23Zm10.14.59h-6a2,2,0,0,0,2,2,2.36,2.36,0,0,0,2.1-1.34L24,15A4,4,0,0,1,20,17.55c-3,0-4.16-2.41-4.16-4.47S17.07,8.61,20,8.61a3.72,3.72,0,0,1,3.11,1.44,4.84,4.84,0,0,1,.93,2.84ZM31,16.71a3,3,0,0,1-2.21.84,3.39,3.39,0,0,1-2.15-.71,4,4,0,0,1-1.29-1.63L27,14.3a1.83,1.83,0,0,0,1.74,1.43c.7,0,1.06-.31,1.06-.93a.69.69,0,0,0-.46-.65,2.81,2.81,0,0,0-.48-.21c-.3-.14-.9-.33-1.22-.47a2.43,2.43,0,0,1-1-4.12,2.73,2.73,0,0,1,2-.74A3.23,3.23,0,0,1,31.38,10l-1.27,1.17a1.78,1.78,0,0,0-1.44-.76.72.72,0,0,0-.79.72c0,.37.27.64.82.85l.62.22.74.26a5.39,5.39,0,0,1,.62.32,2.11,2.11,0,0,1,.62.45,2.19,2.19,0,0,1,.53,1.41A2.78,2.78,0,0,1,31,16.71Zm10.19.7H39V16a3.17,3.17,0,0,1-2.68,1.53,2.42,2.42,0,0,1-2.66-2.61V8.75h2.13V14.3c0,.95.41,1.43,1.24,1.43,1.1,0,2-1.34,2-3.53V8.75h2.13Zm7.24-.7a3,3,0,0,1-2.22.84A3.43,3.43,0,0,1,44,16.84a3.89,3.89,0,0,1-1.28-1.63l1.7-.91a1.83,1.83,0,0,0,1.73,1.43c.71,0,1.07-.31,1.07-.93a.69.69,0,0,0-.47-.65,2.26,2.26,0,0,0-.48-.21c-.29-.14-.89-.33-1.22-.47a2.36,2.36,0,0,1-1.75-2.33,2.4,2.4,0,0,1,.77-1.79,2.77,2.77,0,0,1,2-.74A3.23,3.23,0,0,1,48.81,10l-1.27,1.17a1.79,1.79,0,0,0-1.44-.76.72.72,0,0,0-.79.72c0,.37.27.64.82.85l.62.22.74.26a6.37,6.37,0,0,1,.62.32,2,2,0,0,1,1.15,1.86A2.78,2.78,0,0,1,48.4,16.71Z'/><polygon points='62.5 17.41 64.73 17.41 64.73 12.25 69.06 12.25 69.06 10.19 64.73 10.19 64.73 7.44 70.11 7.44 70.11 5.38 62.5 5.38 62.5 17.41'/><path d='M73.8,7.12a1.23,1.23,0,1,0-1.74,0A1.24,1.24,0,0,0,73.8,7.12Z'/><rect x='71.86' y='8.75' width='2.13' height='8.66'/><rect x='76.33' y='5.24' width='2.13' height='12.17'/><path d='M87.91,17.41V14c0-2.34.78-3.61,1.88-3.61.7,0,1.06.4,1.06,1.21v5.77H93V11.28a2.42,2.42,0,0,0-2.57-2.67,3,3,0,0,0-2.65,1.79,2.41,2.41,0,0,0-2.42-1.79,3,3,0,0,0-2.49,1.53V8.75H80.71v8.66h2.14V14.23c0-2.47.77-3.8,1.87-3.8.7,0,1.06.4,1.06,1.21v5.77Z'/><path d='M104.37,5.38H99.84v12h2.23V12.7h2.3A3.41,3.41,0,0,0,108.14,9,3.41,3.41,0,0,0,104.37,5.38Zm-.08,5.26h-2.22V7.44h2.22A1.41,1.41,0,0,1,105.87,9,1.41,1.41,0,0,1,104.29,10.64Z'/><path d='M115.49,8.78a3.43,3.43,0,0,0-1-.17,3.06,3.06,0,0,0-2.56,1.55V8.75h-2.13v8.66h2.13V14.33c0-2.63,1-3.81,2.32-3.81a1.71,1.71,0,0,1,.9.24Z'/><path d='M124.12,9.88a4.7,4.7,0,0,0-6.43,0,4.49,4.49,0,0,0-1.18,3.2,4.51,4.51,0,0,0,1.18,3.21,4.73,4.73,0,0,0,6.43,0,4.52,4.52,0,0,0,1.19-3.21A4.49,4.49,0,0,0,124.12,9.88ZM122.49,15a2,2,0,0,1-3.16,0,3,3,0,0,1-.59-1.89,2.89,2.89,0,0,1,.59-1.87,2,2,0,0,1,3.16,0,2.94,2.94,0,0,1,.58,1.87A3.06,3.06,0,0,1,122.49,15Z'/><path d='M127.32,16.67a2.25,2.25,0,0,1-2,2.51l.51,1.87c2.48-.56,3.63-1.94,3.63-4.64V8.75h-2.13Z'/><path d='M135.27,8.61c-3,0-4.16,2.41-4.16,4.47s1.19,4.47,4.16,4.47A3.94,3.94,0,0,0,139.2,15l-1.71-.64a2.36,2.36,0,0,1-2.1,1.35,2,2,0,0,1-2-2h6v-.88a4.84,4.84,0,0,0-.93-2.84A3.74,3.74,0,0,0,135.27,8.61Zm-1.87,3.47a1.89,1.89,0,0,1,1.87-1.65,1.79,1.79,0,0,1,1.85,1.65Z'/><path d='M145,10.43a2.2,2.2,0,0,1,2,1.43l1.91-.77A3.85,3.85,0,0,0,145,8.61a3.94,3.94,0,0,0-3.13,1.27,4.72,4.72,0,0,0-1.09,3.2,4.72,4.72,0,0,0,1.09,3.2A3.94,3.94,0,0,0,145,17.55a3.85,3.85,0,0,0,3.94-2.48L147,14.3a2.22,2.22,0,0,1-2,1.43c-1.3,0-2-1.07-2-2.65S143.68,10.43,145,10.43Z'/><path d='M154.72,15.73c-.75,0-1.13-.38-1.13-1.41V10.57h2.28V8.75h-2.28V5.24l-2.13,1.34V8.75h-1.34v1.82h1.34v3.78a2.88,2.88,0,0,0,3.18,3.2,3.41,3.41,0,0,0,1.41-.31l-.5-1.72A1.71,1.71,0,0,1,154.72,15.73Z'/><path d='M127.52,5.39a1.22,1.22,0,1,0,1.73,1.73,1.22,1.22,0,0,0-1.73-1.73Z'/><path d='M158.57,5.34a1.69,1.69,0,0,0-1.7,1.76,1.7,1.7,0,1,0,3.4,0A1.69,1.69,0,0,0,158.57,5.34Zm0,3.17a1.33,1.33,0,0,1-1.35-1.41,1.35,1.35,0,1,1,2.7,0A1.33,1.33,0,0,1,158.57,8.51Z'/><path d='M159.22,6.69a.53.53,0,0,0-.61-.55h-.68V8h.33v-.8h.2L159,8h.35l-.55-.82A.51.51,0,0,0,159.22,6.69Zm-1,.26V6.42h.34a.25.25,0,0,1,.29.27c0,.17-.1.26-.29.26Z'/></g></svg>`
const BRAND_LOCKUP_URI = `data:image/svg+xml;utf8,${encodeURIComponent(BRAND_LOCKUP_SVG)}`

// text density per card kind → grain/vignette weight
const HEAVY = new Set([
  "reflection-full",
  "reflection-focus",
  "conclusion",
  "questions",
  "cta",
])

type TextAnchor = "top" | "center" | "bottom"

/** Where a card's text sits vertically (drives both layout and blur region). */
function textAnchorFor(kind: string, style: DevotionalStyle): TextAnchor {
  switch (kind) {
    case "cover":
      return style.cover === "centered" ? "center" : "bottom"
    case "scripture":
      return style.scripture === "frostedBottom" ? "bottom" : "center"
    case "reflection-full":
    case "reflection-focus":
      // Regular reflection cards: bottom when the layout anchors low, otherwise
      // TOP (never centered — centered-no-panel is reserved for the conclusion,
      // questions, and scripture).
      return style.textBottom ? "bottom" : "top"
    case "conclusion":
      // Emotional ending is always centered on the blurred background.
      return "center"
    case "questions":
      return style.textBottom ? "bottom" : "top"
    default:
      return "center"
  }
}

const PANEL_KINDS = new Set([
  "reflection-full",
  "reflection-focus",
  "conclusion",
])

/**
 * "Panel frost" (currently the b&w layout): text sits in a rounded, frosted
 * rectangle that blurs the video ONLY behind it — the rest of the frame stays
 * clear. When true, Background adds no blur (the panel owns it).
 */
function usesPanelFrost(kind: string, style: DevotionalStyle): boolean {
  return style.panelFrost && PANEL_KINDS.has(kind)
}

/**
 * Blur only behind the text: a top/bottom band for top/bottom-aligned cards,
 * the whole frame for centered text. Panel-frost cards blur inside their own
 * rectangle (so Background stays clear). Questions carry dense text spanning the
 * card, so they always blur the whole frame. The video card never blurs.
 */
function blurRegionFor(
  kind: string,
  style: DevotionalStyle,
): "none" | "whole" | "top" | "bottom" {
  if (kind === "video") return "none"
  // The conclusion is the emotional ending: it always lands centered on a fully
  // blurred, calm background (never the sharp/moving footage), so the closing
  // phrase isn't fighting the video. Independent of layout/panel-frost.
  if (kind === "conclusion") return "whole"
  if (kind === "cta") return "whole" // teaser end-card sits on a calm blurred bg
  if (usesPanelFrost(kind, style)) return "none"
  if (kind === "questions") return "whole"
  const anchor = textAnchorFor(kind, style)
  return anchor === "center" ? "whole" : anchor
}

const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3)

type RevealType =
  | "up"
  | "down"
  | "fade"
  | "zoom"
  | "left"
  | "growV"
  | "growLine"

function reveal(
  frame: number,
  fps: number,
  delaySec: number,
  scale: number,
  type: RevealType = "up",
  durSec = 0.9,
): CSSProperties {
  const t = ease((frame - delaySec * fps) / (durSec * fps))
  switch (type) {
    case "fade":
      return { opacity: t }
    case "down":
      return { opacity: t, transform: `translateY(${(1 - t) * -28 * scale}px)` }
    case "zoom":
      return { opacity: t, transform: `scale(${0.84 + 0.16 * t})` }
    case "left":
      return { opacity: t, transform: `translateX(${(1 - t) * -34 * scale}px)` }
    case "growV":
      return { transform: `scaleY(${t})`, transformOrigin: "top" }
    case "growLine":
      return { transform: `scaleX(${t})`, transformOrigin: "left" }
    default:
      return { opacity: t, transform: `translateY(${(1 - t) * 28 * scale}px)` }
  }
}

/** Smooth letter-by-letter reveal: each character fades in, staggered. Keeps
 *  line-wrapping (pre-wrap) and highlights the given phrase. */
function LetterReveal({
  text,
  highlight,
  style,
  frame,
  fps,
  delaySec = 0.3,
  perChar = 0.026,
}: {
  text: string
  highlight?: string
  style: DevotionalStyle
  frame: number
  fps: number
  delaySec?: number
  perChar?: number
}) {
  const hl = highlight ? text.indexOf(highlight) : -1
  const hlEnd = hl >= 0 ? hl + highlight!.length : -1
  const chars = Array.from(text)
  const fade = 0.4 * fps
  return (
    <span style={{ whiteSpace: "pre-wrap" }}>
      {chars.map((ch, i) => {
        const t = ease((frame - (delaySec + i * perChar) * fps) / fade)
        const inHl = hl >= 0 && i >= hl && i < hlEnd
        return (
          <span
            key={i}
            style={{
              opacity: t,
              color: inHl ? style.highlight : undefined,
              // Highlighted phrases are always italic (owner rule).
              fontStyle: inHl ? "italic" : undefined,
            }}
          >
            {ch}
          </span>
        )
      })}
    </span>
  )
}

/**
 * Experimental subtitle bot: renders the video card's transcribed captions in
 * the dark band just below the fitted (contain) video window. The clip is
 * landscape (~16:9) letterboxed into the portrait frame, so its bottom edge
 * sits near 63% of the height — captions live in the strip beneath it. Each
 * cue whose [startSec, endSec] straddles the current time shows, with a quick
 * cross-fade so lines swap softly rather than snapping.
 */
function VideoSubtitles({
  cues,
  px,
  frame,
  fps,
}: {
  cues: NonNullable<DevotionalCard["subtitles"]>
  style: DevotionalStyle
  px: (n: number) => number
  frame: number
  fps: number
}) {
  const t = frame / fps
  const fade = 0.18
  return (
    <div
      style={{
        position: "absolute",
        left: px(40),
        right: px(40),
        // Anchor just below the letterboxed video band. The band is a 16:9 clip
        // fitted to 1080 wide → ~304px tall each side of centre; sitting the
        // caption ~340px below centre clears it at ANY frame aspect (9:16, 9:19.5).
        top: "calc(50% + 340px)",
        height: px(140),
        pointerEvents: "none",
      }}
    >
      {cues.map((c, i) => {
        // Fade each cue in/out at its edges; clamped so it's 0 outside its window.
        const opacity = interpolate(
          t,
          [c.startSec - fade, c.startSec, c.endSec, c.endSec + fade],
          [0, 1, 1, 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        )
        if (opacity <= 0) return null
        // Each cue is a full-width row centered horizontally, all pinned to the
        // same top — so adjacent cues cross-fade in place.
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 0,
              display: "flex",
              justifyContent: "center",
              opacity,
            }}
          >
            <span
              style={{
                display: "inline-block",
                maxWidth: px(320),
                textAlign: "center",
                fontFamily: SANS,
                fontWeight: 600,
                fontSize: px(21),
                lineHeight: 1.32,
                color: "#f4efe8",
                // Legible over either the dark band or a bright frame edge.
                textShadow:
                  "0 2px 10px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,0.9)",
                padding: `${px(6)}px ${px(14)}px`,
                borderRadius: px(10),
                background: "rgba(8,8,10,0.42)",
                backdropFilter: `blur(${px(6)}px)`,
                WebkitBackdropFilter: `blur(${px(6)}px)`,
              }}
            >
              {c.text}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function Grain({ opacity }: { opacity: number }) {
  return (
    <AbsoluteFill
      style={{
        backgroundImage: GRAIN_URL,
        backgroundSize: "260px 260px",
        mixBlendMode: "overlay",
        opacity,
        pointerEvents: "none",
      }}
    />
  )
}

function BrandMark({ px }: { px: (n: number) => number }) {
  return (
    <svg viewBox="0 0 55.65 40.7" width={px(34)} height={px(25)}>
      <path d={BRAND_PATH} fill="#ee3441" />
    </svg>
  )
}

// Jesus Film brand red — matches the official lockup asset so the intro's
// lockup → standalone-symbol crossfade is seamless.
const BRAND_RED = "#ee3441"

/**
 * Width (px) of a single line of Apercu text as Chrome lays it out, so the date
 * container can be sized to its EXACT content — no trailing empty space, so the
 * centered [symbol · date] row is truly centered for any date string. The font
 * is already loaded (loadApercu gates rendering via delayRender), so the canvas
 * measures the real glyphs; letter-spacing is added per glyph (Chrome includes
 * the trailing one). Runs in the render browser only.
 */
function measureLineWidth(
  text: string,
  fontPx: number,
  letterSpacingPx: number,
  weight = 700,
): number {
  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d")
  if (!ctx) return text.length * fontPx * 0.62 + letterSpacingPx * text.length
  ctx.font = `${weight} ${fontPx}px '${APERCU_FAMILY}', sans-serif`
  return ctx.measureText(text).width + letterSpacingPx * text.length
}

/** The clean standalone symbol (parallelogram only), sized by width. */
function BrandSymbol({
  px,
  w = 34,
}: {
  px: (n: number) => number
  w?: number
}) {
  return (
    <svg
      viewBox="0 0 55.65 40.7"
      width={px(w)}
      height={px(w * (40.7 / 55.65))}
      style={{ display: "block" }}
    >
      <path d={BRAND_PATH} fill={BRAND_RED} />
    </svg>
  )
}

/** Small source credit (e.g. "Adapted from a trusted classic · Matthew Henry"),
 *  pinned near the bottom of the cover. Muted + uppercase so it reads as a quiet
 *  credit, not body copy. Reveals letter-by-letter starting at `delaySec` (set
 *  so it appears AFTER the headline lands); `animate=false` pins it fully shown
 *  (teasers/static). Desktop uses a slightly smaller size (fontUnits). */
function AttributionCredit({
  px,
  text,
  bottomPx,
  fontUnits,
  frame,
  fps,
  delaySec,
  animate,
}: {
  px: (n: number) => number
  text: string
  bottomPx: number
  fontUnits: number
  frame: number
  fps: number
  delaySec: number
  animate: boolean
}) {
  const chars = Array.from(text)
  const fade = 0.42 * fps
  const perChar = 0.018
  return (
    <div
      style={{
        position: "absolute",
        left: px(24),
        right: px(24),
        bottom: bottomPx,
        textAlign: "center",
        fontFamily: SANS,
        // Regular weight (owner: "just text") — a quiet, uniform credit; the
        // author's name is NOT emphasized over the rest of the line.
        fontWeight: 400,
        fontSize: px(fontUnits),
        letterSpacing: px(1.5),
        textTransform: "uppercase",
        color: "rgba(255,255,255,0.5)",
        whiteSpace: "pre-wrap",
      }}
    >
      {chars.map((ch, i) => (
        <span
          key={i}
          style={{
            opacity: animate
              ? ease((frame - (delaySec + i * perChar) * fps) / fade)
              : 1,
          }}
        >
          {ch}
        </span>
      ))}
    </div>
  )
}

/**
 * "Star orbit" progress ring at the foot of the closing card: a soft gold point
 * orbits a ring clockwise while a gold arc fills in behind it, so the point sits
 * at the arc's leading edge. Arc-fill and orbit share ONE linear progress over
 * the remaining card time (from `startFrame`), which keeps the dot locked to the
 * arc. The ring fades in at `startFrame` (after the question is read); a gentle
 * glow pulse on the dot is independent of the progress.
 */
function ProgressRing({
  px,
  fps,
  frame,
  startFrame,
  durationInFrames,
  bottomPx,
  isLandscape,
}: {
  px: (n: number) => number
  fps: number
  frame: number
  startFrame: number
  durationInFrames: number
  bottomPx: number
  isLandscape: boolean
}) {
  // Bigger + placed per aspect (owner): centered along the bottom on mobile
  // (portrait, enlarged), tucked into the bottom-right corner on desktop
  // (landscape) with EQUAL bottom + right margins.
  const size = px(isLandscape ? 40 : 56)
  const R = 27
  const C = 2 * Math.PI * R // ≈ 169.6 (viewBox units)
  const p = Math.max(
    0,
    Math.min(
      1,
      (frame - startFrame) / Math.max(1, durationInFrames - startFrame),
    ),
  )
  const dotOffset = (size * R) / 64 // px onto the ring (matches r=27 in a 64 box)
  const dotSize = (size * 13) / 64
  const appear = Math.max(0, Math.min(1, (frame - startFrame) / (0.5 * fps)))
  // Independent ~4s glow pulse on the dot.
  const pulse = 0.5 + 0.5 * Math.sin((frame / fps) * ((Math.PI * 2) / 4))
  return (
    <div
      style={{
        position: "absolute",
        bottom: bottomPx,
        width: size,
        height: size,
        opacity: appear,
        // Landscape → bottom-right corner with the right margin EQUAL to the
        // bottom margin (bottomPx); portrait → horizontally centered.
        ...(isLandscape
          ? { right: bottomPx }
          : { left: "50%", marginLeft: -size / 2 }),
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        style={{ display: "block" }}
      >
        <circle
          cx="32"
          cy="32"
          r={R}
          fill="none"
          stroke="rgba(255,255,255,0.07)"
          strokeWidth={1.5}
        />
        <circle
          cx="32"
          cy="32"
          r={R}
          fill="none"
          stroke="#d8ad5c"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - p)}
          transform="rotate(-90 32 32)"
        />
      </svg>
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: 0,
          height: 0,
          transform: `rotate(${p * 360}deg)`,
        }}
      >
        <div
          style={{
            position: "absolute",
            width: dotSize,
            height: dotSize,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, #fff, #fbead8 30%, #f4d98f 58%, #e9c477 100%)",
            filter: `blur(${px(0.9)}px)`,
            transform: `translate(-50%, -50%) translateY(-${dotOffset}px)`,
            boxShadow: `0 0 ${px(4) + px(3) * pulse}px ${px(1)}px rgba(232,196,119,0.55)`,
          }}
        />
      </div>
    </div>
  )
}

/**
 * Full-frame overlay host for the progress ring on the questions card. Rendered
 * at the composition level (not inside CardBody) so `right`/`bottom` are relative
 * to the FRAME edges — mobile centers it along the bottom, desktop tucks it into
 * the bottom-right corner with equal bottom + right margins.
 */
function QuestionsProgressRing({
  px,
  fps,
  durationInFrames,
  isLandscape,
}: {
  px: (n: number) => number
  fps: number
  durationInFrames: number
  isLandscape: boolean
}) {
  const frame = useCurrentFrame()
  return (
    <AbsoluteFill>
      <ProgressRing
        px={px}
        fps={fps}
        frame={frame}
        startFrame={Math.round(3.5 * fps)}
        durationInFrames={durationInFrames}
        bottomPx={isLandscape ? px(20) : px(34)}
        isLandscape={isLandscape}
      />
    </AbsoluteFill>
  )
}

/**
 * The animated cover opening, reproduced from the Claude Design spec (a single
 * ~6.5s scene mapped onto the card's own runtime via a normalized progress p).
 * Beat map (fractions of the 7s scene): lockup stamps in 0→0.085; the wordmark
 * clips away + crossfades to the clean symbol 0.16→0.35; the date clip-wipes in
 * RIGHT of the symbol (container width 0→268, easeInOutCubic — same clip
 * mechanism mirrored, no fade/bounce) 0.42→0.58 → a centered [symbol · date]
 * row; the headline rises below 0.72→0.96. Then everything holds. The Background
 * paints the sharp footage + scrim + vignette behind this.
 */
export {
  AttributionCredit,
  BRAND_LOCKUP_URI,
  BrandMark,
  BrandSymbol,
  COVER_ANIM_SEC,
  Grain,
  HEAVY,
  LetterReveal,
  ProgressRing,
  QuestionsProgressRing,
  REF,
  SANS,
  SERIF,
  TEXT_SHADOW,
  VideoSubtitles,
  blurRegionFor,
  measureLineWidth,
  reveal,
  textAnchorFor,
  usesPanelFrost,
}
