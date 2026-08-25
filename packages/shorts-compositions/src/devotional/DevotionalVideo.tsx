import type { CSSProperties, ReactNode } from "react"
import {
  AbsoluteFill,
  Audio,
  Easing,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion"

import { loadShortFonts, SHORT_FONT_FAMILIES } from "../fonts"
import type { DevotionalCard, DevotionalInputProps } from "./schema"
import { resolveDevotionalStyle, type DevotionalStyle } from "./styles"
import {
  CARD_TAIL_FRAMES,
  INTRO_HOLD_FRAMES,
  OUTRO_HOLD_FRAMES,
  computeCardFrames,
  framesFromDurations,
  hasPerCardAudio,
} from "./timing"

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
// Owner rule: Inter, after comparing mockups against Montserrat.
const SANS = `'${SHORT_FONT_FAMILIES.inter}', -apple-system, system-ui, sans-serif`
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
  | "popUp"

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
    case "popUp":
      // Gentle: a soft scale + tiny rise, both eased with the same cubic-out
      // as everything else (no bounce/overshoot — owner: "не резко"). Reads
      // as the whole block settling into place, not a sharp pop.
      return {
        opacity: t,
        transform: `translateY(${(1 - t) * 10 * scale}px) scale(${0.96 + 0.04 * t})`,
      }
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
 * Captions for the video card, timed against the EDITED clip (the pipeline
 * remaps the film's own subtitle cues through the pause cuts + speed-up — see
 * `mapCuesToEditedTimeline`).
 *
 * Placement: in PORTRAIT the clip plays in a centered 1:1 window spanning
 * 21.9%–78.15% of the frame height (see the video-card branch of Background),
 * so captions sit just INSIDE that window's bottom edge — over the picture,
 * where subtitles belong — and are anchored from the bottom so extra lines
 * grow UP. Owner rules: same typeface as the cards (SANS), and never low
 * enough for a social app's caption/nav chrome to cover them; anchoring above
 * the picture's bottom edge keeps them ~100px clear of the `igSafeBottom`
 * line, and the right inset clears the action rail.
 */
/** Portrait: bottom of the centered 1:1 video window, as a % of frame height. */
const VIDEO_WINDOW_BOTTOM_PCT = 78.15
function VideoSubtitles({
  cues,
  px,
  frame,
  fps,
  isLandscape,
  safeRight,
}: {
  cues: NonNullable<DevotionalCard["subtitles"]>
  style: DevotionalStyle
  px: (n: number) => number
  frame: number
  fps: number
  isLandscape: boolean
  /** Right inset that keeps captions clear of the action rail. */
  safeRight: number
}) {
  const t = frame / fps
  const fade = 0.18
  return (
    <div
      style={{
        position: "absolute",
        left: px(40),
        // Portrait: stop short of the right-hand action rail.
        right: isLandscape ? px(40) : safeRight,
        top: "45%",
        // Portrait: sit just inside the 1:1 video window's bottom edge — over
        // the picture, and ~100px clear of the social UI's safe line (which is
        // `safeBottom`, further down). Landscape: a normal bottom inset.
        bottom: isLandscape
          ? px(28)
          : `calc(${100 - VIDEO_WINDOW_BOTTOM_PCT}% + ${px(16)}px)`,
        display: "flex",
        // Anchored to the bottom: a 3-line cue grows UP toward the picture,
        // never down toward the chrome.
        alignItems: "flex-end",
        justifyContent: "center",
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
        // Every cue is absolutely positioned in the SAME centered box, so
        // adjacent lines cross-fade in place instead of shifting.
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              display: "flex",
              justifyContent: "center",
              opacity,
            }}
          >
            <span
              style={{
                display: "inline-block",
                maxWidth: px(300),
                textAlign: "center",
                fontFamily: SANS,
                fontWeight: 600,
                fontSize: px(20),
                lineHeight: 1.34,
                color: "#f4efe8",
                // No pill/blur: matches the cards' plain-text treatment; the
                // shadow alone carries legibility over moving footage.
                textShadow:
                  "0 2px 12px rgba(0,0,0,0.9), 0 0 3px rgba(0,0,0,0.95)",
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

/**
 * The brand mark, performing the way the cover's does: it slams in oversized,
 * settles, then the full lockup crops down to the standalone symbol.
 *
 * The end card used the STATIC symbol — on the one card whose whole job is to
 * ask for a follow, the mark was the only thing not doing anything. Same
 * keyframes as the cover's logo so the two read as one system, driven by this
 * card's own frame and over a span short enough to finish inside a ~2s card.
 */
function AnimatedBrandMark({
  px,
  frame,
  fps,
}: {
  px: (n: number) => number
  frame: number
  fps: number
}) {
  const span = Math.max(1, Math.round(1.0 * fps))
  const p = Math.max(0, Math.min(1, frame / span))
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const
  const inOutCubic = {
    easing: Easing.inOut(Easing.cubic) as (t: number) => number,
  }
  const symbolW = px(34)
  const lockupW = px(34 * (160.27 / 55.65))
  const rowH = px(25)
  const opacity = interpolate(p, [0, 0.04], [0, 1], clamp)
  const stamp = interpolate(
    p,
    [0, 0.035, 0.06, 0.085],
    [1.4, 0.93, 1.05, 1.0],
    clamp,
  )
  const clipW = interpolate(p, [0.16, 0.35], [lockupW, symbolW], {
    ...clamp,
    ...inOutCubic,
  })
  const lockupOpacity = interpolate(p, [0.29, 0.35], [1, 0], {
    ...clamp,
    ...inOutCubic,
  })
  const symbolOpacity = interpolate(p, [0.29, 0.35], [0, 1], {
    ...clamp,
    ...inOutCubic,
  })
  return (
    <div
      style={{
        position: "relative",
        width: clipW,
        height: rowH,
        opacity,
        transform: `scale(${stamp})`,
      }}
    >
      <div
        style={{
          width: clipW,
          height: rowH,
          overflow: "hidden",
          opacity: lockupOpacity,
        }}
      >
        <img
          src={BRAND_LOCKUP_URI}
          alt=""
          style={{ display: "block", width: lockupW, height: rowH }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          opacity: symbolOpacity,
        }}
      >
        <BrandMark px={px} />
      </div>
    </div>
  )
}

// Jesus Film brand red — matches the official lockup asset so the intro's
// lockup → standalone-symbol crossfade is seamless.
const BRAND_RED = "#ee3441"

/**
 * Width (px) of a single line of Montserrat text as Chrome lays it out, so the
 * date container can be sized to its EXACT content — no trailing empty space, so
 * the centered [symbol · date] row is truly centered for any date string. The
 * font is already loaded (loadShortFonts gates rendering via delayRender), so the canvas
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
  ctx.font = `${weight} ${fontPx}px '${SHORT_FONT_FAMILIES.inter}', sans-serif`
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
  inline = false,
  size: sizeProp,
}: {
  px: (n: number) => number
  fps: number
  frame: number
  startFrame: number
  durationInFrames: number
  bottomPx?: number
  isLandscape: boolean
  /** Inline (questions card): flow in the text column (relative), left-aligned,
   *  small — rendered ABOVE the "Ask yourself" label. Default false = the
   *  original full-frame overlay corner placement (kept for reuse). */
  inline?: boolean
  /** Explicit diameter override (px). Inline mode passes a small size. */
  size?: number
}) {
  // Overlay (default): bigger + placed per aspect — centered along the bottom on
  // mobile, tucked into the bottom-right corner on desktop. Inline mode uses the
  // caller's small `size` and flows left-aligned in the column instead.
  const size = sizeProp ?? px(isLandscape ? 40 : 56)
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
        width: size,
        height: size,
        opacity: appear,
        // Inline → flow in the column, left-aligned (no absolute placement).
        // Overlay → landscape bottom-right corner (right margin EQUAL to the
        // bottom margin); portrait → horizontally centered along the bottom.
        ...(inline
          ? { position: "relative" }
          : {
              position: "absolute",
              bottom: bottomPx,
              ...(isLandscape
                ? { right: bottomPx }
                : { left: "50%", marginLeft: -size / 2 }),
            }),
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
 * The animated cover opening, reproduced from the Claude Design spec (a single
 * ~6.5s scene mapped onto the card's own runtime via a normalized progress p).
 * Beat map (fractions of the 7s scene): lockup stamps in 0→0.085; the wordmark
 * clips away + crossfades to the clean symbol 0.16→0.35; the date clip-wipes in
 * RIGHT of the symbol (container width 0→268, easeInOutCubic — same clip
 * mechanism mirrored, no fade/bounce) 0.42→0.58 → a centered [symbol · date]
 * row; the headline rises below 0.72→0.96. Then everything holds. The Background
 * paints the sharp footage + scrim + vignette behind this.
 */
function CoverIntro({
  px,
  frame,
  fps,
  durationInFrames,
  title,
  date,
  occasion,
  eyebrowColor,
  staticCover,
  isLandscape,
  attribution,
  hideDate,
  hideLogo,
  dateLabel,
  titleFirst,
  textStatic,
  secondaryLine,
}: {
  px: (n: number) => number
  frame: number
  fps: number
  durationInFrames: number
  title: ReactNode
  date: string
  /** Fixed-date occasion tag (e.g. "World Humanitarian Day"); most days none. */
  occasion?: string
  eyebrowColor: string
  staticCover: boolean
  isLandscape: boolean
  attribution?: string
  /** Drop the brand mark entirely. `display: none` rather than opacity, so the
   *  row leaves the flex column and its `gap` with it — otherwise the title
   *  sits a little below centre with nothing above it. */
  hideLogo?: boolean
  /** Skip the date box entirely — logo sits alone in the row. */
  hideDate?: boolean
  /** Shown in the date's slot with the date's type treatment, instead of the
   *  date ("Today's Devotional"). */
  dateLabel?: string
  /** Title animates first from frame 0; the logo sequence starts ~2s in. */
  titleFirst?: boolean
  /** Title + attribution shown from frame 0 while the logo still animates
   *  (unlike `staticCover`, which also freezes the logo). */
  textStatic?: boolean
  /** Short line under the title, same font treatment as the date. Fades in
   *  once the logo settles (needs no date-wipe slot to wait for). */
  secondaryLine?: string
}) {
  // Progress runs over a FIXED span (COVER_ANIM_SEC), not the whole card — so a
  // long narration extends the settled HOLD instead of slowing the animation.
  // Capped to the card length for covers shorter than the animation. staticCover
  // (teasers) pins the settled last frame so the opening is readable instantly.
  const animSpan = Math.max(
    1,
    Math.min(durationInFrames - 1, Math.round(COVER_ANIM_SEC * fps)),
  )
  const p = staticCover ? 1 : Math.max(0, Math.min(1, frame / animSpan))
  // TITLE-FIRST: the headline owns the opening beat and the logo waits. The
  // logo/date keyframes below read `pLogo` instead of `p`, so the whole stamp →
  // morph → date sequence simply starts later without being re-timed.
  const LOGO_DELAY_SEC = 2
  // With no logo there is nothing for the title to wait for, so it MUST lead.
  // Left to the default order (logo → date → title) a logo-less cover sits
  // empty for about two seconds of a three-and-a-half second card: the title is
  // still waiting on an animation that was removed. Deriving this from
  // `hideLogo` rather than asking callers to remember `coverTitleFirst` keeps
  // the two flags from being set inconsistently.
  const titleLeads = titleFirst || Boolean(hideLogo)
  const logoDelay = titleLeads ? Math.round(LOGO_DELAY_SEC * fps) : 0
  const pLogo = staticCover
    ? 1
    : Math.max(0, Math.min(1, (frame - logoDelay) / animSpan))
  // The headline gets its own short span from frame 0 rather than a slice near
  // the end of the shared one.
  const titleSpan = Math.max(1, Math.round(0.9 * fps))
  const pTitle = staticCover ? 1 : Math.max(0, Math.min(1, frame / titleSpan))
  const outCubic = { easing: Easing.out(Easing.cubic) as (t: number) => number }
  const inOutCubic = {
    easing: Easing.inOut(Easing.cubic) as (t: number) => number,
  }
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const

  // The design sizes are tuned for the 16:9 frame. Portrait (9:16) shares the
  // same short side, so the SAME px() would render identical absolute sizes —
  // which read small in the tall/narrow frame. Scale the whole cover up in
  // portrait (≈1.25) so the logo + text match the previous portrait devotionals.
  const coverScale = isLandscape ? 1 : 1.25
  const cpx = (n: number) => px(n * coverScale)
  const symbolWNum = 31.4 * coverScale

  // Sizes (Claude Design spec): symbol 58px wide, full lockup ≈167px at that
  // height, date container measured, 44px column gap — all × coverScale.
  const symbolW = cpx(31.4)
  const lockupW = cpx(31.4 * (160.27 / 55.65)) // ≈ px(90) → 167px at 720
  const rowH = cpx(31.4 * (40.7 / 55.65)) // symbol height ≈ 42px
  // Date container target = the date's EXACT rendered width + its left padding,
  // so the settled [symbol · date] row has no trailing gap and centres cleanly
  // for any date string (measured, not a fixed 268px).
  const dateLeftPad = cpx(9.75) // 18px
  // The slot shows `dateLabel` when given, otherwise the date itself.
  const dateText = dateLabel ?? date
  const dateTargetW = hideDate
    ? 0
    : measureLineWidth(dateText.toUpperCase(), cpx(8.1), cpx(1.625)) +
      dateLeftPad

  // ---- logo: stamp then morph -----------------------------------------------
  const logoOpacity = interpolate(pLogo, [0, 0.04], [0, 1], clamp)
  // Keyframed stamp: slams in oversized, dips under, settles (linear between).
  const stamp = interpolate(
    pLogo,
    [0, 0.035, 0.06, 0.085],
    [1.4, 0.93, 1.05, 1.0],
    clamp,
  )
  // Clip width shrinks full-lockup → symbol, cropping the wordmark from the right.
  const clipW = interpolate(pLogo, [0.16, 0.35], [lockupW, symbolW], {
    ...clamp,
    ...inOutCubic,
  })
  const lockupOpacity = interpolate(pLogo, [0.29, 0.35], [1, 0], {
    ...clamp,
    ...inOutCubic,
  })
  const symbolOpacity = interpolate(pLogo, [0.29, 0.35], [0, 1], {
    ...clamp,
    ...inOutCubic,
  })

  // ---- date: clip-wipes in beside the symbol (container width 0→target, the
  // SAME clip mechanism mirrored; easeInOutCubic, no fade — the text is revealed
  // purely by the expanding clip, constant opacity). Skipped entirely when
  // hideDate (dateTargetW is already 0, so this just stays at 0).
  const dateW = hideDate
    ? 0
    : interpolate(pLogo, [0.42, 0.58], [0, dateTargetW], {
        ...clamp,
        ...inOutCubic,
      })

  // ---- headline: rises in below the row, UNLESS textStatic — social test
  // cards want the title readable from frame 0 while the logo still animates.
  const headOpacity = textStatic
    ? 1
    : titleLeads
      ? interpolate(pTitle, [0, 0.75], [0, 1], { ...clamp, ...outCubic })
      : interpolate(p, [0.72, 0.94], [0, 1], { ...clamp, ...outCubic })
  const headY = textStatic
    ? 0
    : titleLeads
      ? interpolate(pTitle, [0, 1], [cpx(10.8), 0], { ...clamp, ...outCubic })
      : interpolate(p, [0.72, 0.96], [cpx(10.8), 0], { ...clamp, ...outCubic })

  // ---- secondary line: reveals letter-by-letter once the logo settles (no
  // date-wipe slot to wait for, so it can start right after the morph
  // finishes at p≈0.35). Same per-char reveal mechanism as AttributionCredit.
  const secStartSec = (animSpan * 0.42) / fps
  const secFadeFrames = 0.32 * fps
  const secPerCharSec = 0.018

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        gap: cpx(23.8), // 44px
        padding: `0 ${px(30)}px`,
      }}
    >
      {/* logo + date row: symbol on the left, date container grows rightward so
          the centered row widens and the symbol nudges left as the date opens. */}
      <div
        style={{
          display: hideLogo ? "none" : "flex",
          alignItems: "center",
          justifyContent: "center",
          height: rowH,
          opacity: logoOpacity,
          transform: `scale(${stamp})`,
        }}
      >
        {/* logo group: full lockup clipped down to the clean symbol */}
        <div
          style={{
            position: "relative",
            width: clipW,
            height: rowH,
            flex: "none",
          }}
        >
          <div
            style={{
              width: clipW,
              height: rowH,
              overflow: "hidden",
              opacity: lockupOpacity,
            }}
          >
            <img
              src={BRAND_LOCKUP_URI}
              alt=""
              style={{ display: "block", width: lockupW, height: rowH }}
            />
          </div>
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              opacity: symbolOpacity,
            }}
          >
            <BrandSymbol px={px} w={symbolWNum} />
          </div>
        </div>
        {/* date container: width springs 0→268px, cropping the text as it opens */}
        <div
          style={{
            width: dateW,
            height: rowH,
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            flex: "none",
          }}
        >
          <div
            style={{
              paddingLeft: dateLeftPad, // 18px
              whiteSpace: "nowrap",
              fontFamily: SANS,
              fontWeight: 700,
              fontSize: cpx(8.1), // 15px
              letterSpacing: cpx(1.625), // 3px
              textTransform: "uppercase",
              // Muted cool grey (not bright white) so the date sits quietly next
              // to the mark and reads as a kicker, on light or dark footage.
              color: "rgba(214,217,224,0.82)",
            }}
          >
            {dateText}
          </div>
        </div>
      </div>

      {/* occasion tag (e.g. "World Humanitarian Day") — rises in with the
          headline, on the same schedule, only present on configured dates. */}
      {occasion ? (
        <div
          style={{
            fontFamily: SANS,
            fontWeight: 700,
            fontSize: cpx(11), // ≈13px at 720
            letterSpacing: cpx(1.625), // 3px
            textTransform: "uppercase",
            color: eyebrowColor,
            opacity: headOpacity,
            transform: `translateY(${headY}px)`,
          }}
        >
          {occasion}
        </div>
      ) : null}

      {/* headline */}
      <div
        style={{
          fontFamily: SANS,
          fontWeight: 700,
          fontSize: cpx(32.5), // 60px
          lineHeight: 1.04,
          letterSpacing: cpx(-0.758), // −1.4px
          color: "#fff",
          maxWidth: cpx(487), // 900px
          opacity: headOpacity,
          transform: `translateY(${headY}px)`,
        }}
      >
        {title}
      </div>
      {secondaryLine ? (
        <div
          style={{
            // Exactly the date's treatment (owner: "same font style as the
            // date") — same size, weight, letter-spacing, uppercase, color.
            fontFamily: SANS,
            fontWeight: 700,
            fontSize: cpx(8.1), // 15px, matches the date
            letterSpacing: cpx(1.625), // 3px, matches the date
            textTransform: "uppercase",
            color: "rgba(214,217,224,0.82)",
            maxWidth: cpx(420),
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
          }}
        >
          {Array.from(secondaryLine).map((ch, i) => (
            <span
              key={i}
              style={{
                opacity: ease(
                  (frame - (secStartSec + i * secPerCharSec) * fps) /
                    secFadeFrames,
                ),
              }}
            >
              {ch}
            </span>
          ))}
        </div>
      ) : null}
      {attribution ? (
        <AttributionCredit
          px={px}
          text={attribution}
          bottomPx={isLandscape ? px(17.35) : px(28)}
          // Desktop (16:9) is 2px smaller than portrait: px(5.9)≈16px vs
          // px(6.6)≈18px at 1080.
          fontUnits={isLandscape ? 5.9 : 6.6}
          frame={frame}
          fps={fps}
          // Start once the headline has landed (headline finishes at p≈0.96).
          // Static covers (staticCover or textStatic) skip the reveal entirely.
          delaySec={(animSpan * 0.96) / fps}
          animate={!staticCover && !textStatic}
        />
      ) : null}
    </AbsoluteFill>
  )
}

function MuteButton({
  px,
  style,
}: {
  px: (n: number) => number
  style: DevotionalStyle
}) {
  const d = px(42)
  return (
    <div
      style={{
        position: "absolute",
        right: px(18),
        bottom: px(18),
        width: d,
        height: d,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background:
          style.id === "grain"
            ? "rgba(255,255,255,0.2)"
            : "rgba(255,255,255,0.14)",
        backdropFilter: style.id === "grain" ? "blur(8px)" : undefined,
      }}
    >
      <svg width={px(20)} height={px(20)} viewBox="0 0 24 24">
        <path d="M4 9h3l4-3v12l-4-3H4z" fill="#fff" />
        <path
          d="M16 9l5 6M21 9l-5 6"
          stroke="#fff"
          strokeWidth={2}
          fill="none"
        />
      </svg>
    </div>
  )
}

// Currently unrendered (cards draw their own header/date row) — kept for reuse.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function Header({
  style,
  px,
  frame,
  fps,
  date,
  cover,
}: {
  style: DevotionalStyle
  px: (n: number) => number
  frame: number
  fps: number
  date: string
  cover?: boolean
}) {
  const eyebrow: CSSProperties = {
    fontFamily: SANS,
    fontWeight: 700,
    fontSize: px(12),
    letterSpacing: px(2.6),
    color: style.secondary,
    textTransform: "uppercase",
  }
  const dateNode = <div style={eyebrow}>{date}</div>
  const rev = reveal(frame, fps, 0.1, 1, "fade")
  if (style.header === "row" && !cover) {
    return (
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          padding: `${px(26)}px ${px(24)}px 0`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          ...rev,
        }}
      >
        <BrandMark px={px} />
        {dateNode}
      </div>
    )
  }
  // centered column (grain) or brand-only (sepia)
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        padding: `${px(26)}px ${px(24)}px 0`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: px(9),
        ...rev,
      }}
    >
      <BrandMark px={px} />
      {style.header !== "brand" || cover ? dateNode : null}
    </div>
  )
}

/** Render text with one phrase highlighted in the accent color. */
function withHighlight(
  text: string,
  phrase: string | undefined,
  style: DevotionalStyle,
): ReactNode {
  const idx = phrase ? text.indexOf(phrase) : -1
  if (idx === -1) return text
  // Highlight only the FIRST occurrence; keep the rest intact (a phrase can
  // appear more than once — e.g. "hope … hope." — and split() would drop the tail).
  const before = text.slice(0, idx)
  const after = text.slice(idx + phrase!.length)
  return (
    <>
      {before}
      <span
        style={{
          color: style.highlight,
          // Highlighted phrases are always italic (owner rule).
          fontStyle: "italic",
        }}
      >
        {phrase}
      </span>
      {after}
    </>
  )
}

/** Rounded frosted rectangle: blurs the video only behind the text it wraps. */
function FrostPanel({
  px,
  children,
  extra,
}: {
  px: (n: number) => number
  children: ReactNode
  extra?: CSSProperties
}) {
  return (
    <div
      style={{
        alignSelf: "stretch",
        // Blur only — no dark fill behind the text (per request).
        backdropFilter: `blur(${px(22)}px)`,
        WebkitBackdropFilter: `blur(${px(22)}px)`,
        borderRadius: px(18),
        padding: px(26),
        ...extra,
      }}
    >
      {children}
    </div>
  )
}

function Eyebrow({
  children,
  px,
  color,
  size = 11,
  mb = 24,
}: {
  children: ReactNode
  px: (n: number) => number
  color: string
  size?: number
  mb?: number
}) {
  return (
    <div
      style={{
        fontFamily: SANS,
        fontWeight: 700,
        fontSize: px(size),
        letterSpacing: px(3),
        textTransform: "uppercase",
        color,
        marginBottom: px(mb),
      }}
    >
      {children}
    </div>
  )
}

function CardBody({
  card,
  style,
  px,
  frame,
  fps,
  durationInFrames,
  headerDate,
  anim,
  staticCover,
  wideText,
  attribution,
  hideCoverDate,
  hideCoverLogo,
  coverDateLabel,
  coverTitleFirst,
  coverTextStatic,
  coverSecondaryLine,
}: {
  card: DevotionalCard
  style: DevotionalStyle
  px: (n: number) => number
  frame: number
  fps: number
  durationInFrames: number
  headerDate: string
  anim: "block" | "letters"
  staticCover: boolean
  wideText?: "bottom" | "right"
  attribution?: string
  hideCoverDate?: boolean
  hideCoverLogo?: boolean
  coverDateLabel?: string
  coverTitleFirst?: boolean
  coverTextStatic?: boolean
  coverSecondaryLine?: string
}) {
  const { width: vw, height: vh } = useVideoConfig()
  const isLandscape = vw > vh
  const pad = `${px(44)}px ${px(34)}px`
  // Breathing room above the bottom edge for bottom-anchored text. Owner rule:
  // bottom text can sit LOWER — landscape 48px (px(17.35)), portrait ~78px
  // (px(28)) from the frame edge (was px(84) ≈ 232px, too high off the bottom).
  const padBottom = isLandscape ? px(17.35) : px(28)
  // Instagram Reels safe-area (PORTRAIT only): keep the reflection/conclusion
  // text clear of the right-edge action rail (~140px) and lift it above the
  // caption block + bottom nav (text ends ~360px above the frame bottom). px()
  // scales by the 1080 short side, so px(50.5)≈140px and px(130)≈360px at 1080w.
  const igSafe = !isLandscape
  const igSafeRight = px(50.5)
  const igSafeBottom = px(130)
  const letters = anim === "letters"

  if (card.kind === "cover") {
    // Unified cover for BOTH orientations, reproduced from the Claude Design
    // spec: the red Jesus Film symbol, headline, and date stacked and centered
    // on the sharp footage (Background paints the dark wash + vignette). The
    // rotation styles still GRADE the footage; only the cover LAYOUT is unified.
    // NOTE: this reintroduces the logo — but ONLY on the cover card.
    const title = withHighlight(card.title ?? "", card.highlight, style)
    return (
      <CoverIntro
        px={px}
        frame={frame}
        fps={fps}
        durationInFrames={durationInFrames}
        title={title}
        date={headerDate}
        occasion={card.occasion}
        eyebrowColor={style.eyebrow}
        staticCover={staticCover}
        isLandscape={isLandscape}
        attribution={attribution}
        hideDate={hideCoverDate}
        hideLogo={hideCoverLogo}
        dateLabel={coverDateLabel}
        titleFirst={coverTitleFirst}
        textStatic={coverTextStatic}
        secondaryLine={coverSecondaryLine}
      />
    )
  }

  if (card.kind === "scripture") {
    // Reverted to the per-style-rotation layout (quoteCenter / grain-left-rule
    // / frostedBottom-bar) — the owner preferred it back after trying the
    // unified left-rule redesign. Font size trimmed a touch (32→27). The
    // `igSafe` protection stays on every branch: the citation must clear the
    // social app's own bottom UI regardless of which layout is showing.
    const verse = (
      <div
        style={{
          fontFamily: SANS,
          fontStyle: "italic",
          fontWeight: 400,
          fontSize: px(27),
          lineHeight: 1.36,
          color: style.heading,
        }}
      >
        {letters ? (
          <LetterReveal
            text={card.verse ?? ""}
            highlight={card.highlight}
            style={style}
            frame={frame}
            fps={fps}
            delaySec={0.4}
          />
        ) : (
          withHighlight(card.verse ?? "", card.highlight, style)
        )}
      </div>
    )
    const citation = card.citation ? (
      <div
        style={{
          marginTop: px(22),
          fontFamily: SANS,
          fontWeight: 700,
          fontSize: px(12),
          letterSpacing: px(2.4),
          color: style.eyebrow,
          ...reveal(frame, fps, 0.8, 1, "fade"),
        }}
      >
        {card.citation.toUpperCase()}
      </div>
    ) : null

    if (style.scripture === "quoteCenter") {
      return (
        <AbsoluteFill
          style={{
            justifyContent: "center",
            alignItems: "center",
            textAlign: "center",
            padding: `${px(40)}px ${px(34)}px`,
            paddingBottom: igSafe ? igSafeBottom : px(40),
            paddingRight: igSafe ? igSafeRight : px(34),
          }}
        >
          <div
            style={{
              fontFamily: SERIF,
              fontSize: px(90),
              lineHeight: 0.6,
              color: style.rule,
              marginBottom: px(10),
              ...reveal(frame, fps, 0.35, 1, "zoom"),
            }}
          >
            &ldquo;
          </div>
          <div style={{ ...reveal(frame, fps, 0.6, 1, "up") }}>{verse}</div>
          {citation}
        </AbsoluteFill>
      )
    }
    // grain: left rule; sepia: bottom accent bar
    const bottom = style.scripture === "frostedBottom"
    return (
      <AbsoluteFill
        style={{
          justifyContent: bottom ? "flex-end" : "center",
          padding: bottom
            ? `${px(48)}px ${px(28)}px ${padBottom}px`
            : `0 ${px(30)}px`,
          paddingBottom: igSafe ? igSafeBottom : bottom ? padBottom : undefined,
          paddingRight: igSafe ? igSafeRight : undefined,
        }}
      >
        {bottom ? (
          <div
            style={{
              width: px(48),
              height: px(4),
              background: style.rule,
              marginBottom: px(22),
              ...reveal(frame, fps, 0.5, 1, "growLine"),
            }}
          />
        ) : null}
        <div style={{ display: "flex", gap: px(18), alignItems: "stretch" }}>
          {!bottom ? (
            <div
              style={{
                width: px(6),
                flex: "0 0 auto",
                background: style.rule,
                ...reveal(frame, fps, 0.5, 1, "growV"),
              }}
            />
          ) : null}
          <div style={{ ...reveal(frame, fps, 0.35, 1, "up") }}>{verse}</div>
        </div>
        {citation}
      </AbsoluteFill>
    )
  }

  if (card.kind === "reflection-full") {
    // Show the paragraphs ONE AFTER ANOTHER — each fades in, holds, fades out
    // as the next arrives (the closing line stays up to the end). Windows are
    // proportional to each chunk's length across the card's narration, so the
    // text on screen tracks the voice. Only one chunk is ever visible, so the
    // card never overflows regardless of frame height.
    const chunks = [
      ...(card.paragraphs ?? []).map((text) => ({ text, closing: false })),
      ...(card.closing ? [{ text: card.closing, closing: true }] : []),
    ]
    const totalChars = chunks.reduce((s, c) => s + c.text.length, 0) || 1
    const fadeF = Math.round(0.6 * fps)
    let acc = 0
    const windows = chunks.map((c) => {
      const start = (acc / totalChars) * durationInFrames
      acc += c.text.length
      const end = (acc / totalChars) * durationInFrames
      return { start, end }
    })
    const anchor = textAnchorFor(card.kind, style)
    const panel = usesPanelFrost(card.kind, style)
    return (
      <AbsoluteFill>
        {chunks.map((c, i) => {
          const w = windows[i]
          const isLast = i === chunks.length - 1
          // Cap the fade so a short chunk's window keeps its four keyframes
          // strictly increasing (interpolate requires monotonic input).
          const win = Math.max(1, w.end - w.start)
          const ff = Math.min(fadeF, win * 0.4)
          // In letters mode the per-character reveal supplies the entrance, so
          // the container appears instantly (letters carry the fade-in) and only
          // fades OUT as the next chunk arrives.
          const opacity = letters
            ? interpolate(
                frame,
                [w.start, w.start + 1, w.end - ff, w.end],
                [0, 1, 1, isLast ? 1 : 0],
                { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
              )
            : interpolate(
                frame,
                [w.start, w.start + ff, w.end - ff, w.end],
                [0, 1, 1, isLast ? 1 : 0],
                { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
              )
          const lift = interpolate(
            frame,
            [w.start, w.start + ff],
            [px(18), 0],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
          )
          const content = (
            <>
              <Eyebrow px={px} color={style.eyebrow}>
                Reflect
              </Eyebrow>
              <p
                style={{
                  margin: 0,
                  fontFamily: SANS,
                  fontStyle: c.closing ? "italic" : "normal",
                  fontWeight: c.closing ? 500 : 400,
                  fontSize: px(c.closing ? 34 : 26),
                  lineHeight: c.closing ? 1.2 : 1.5,
                  color: c.closing ? style.closing : style.body,
                }}
              >
                {letters ? (
                  <LetterReveal
                    text={c.text}
                    style={style}
                    frame={frame}
                    fps={fps}
                    delaySec={w.start / fps + 0.15}
                  />
                ) : (
                  c.text
                )}
              </p>
            </>
          )
          // Panel-frost: text in a frosted rectangle — centered, or anchored to
          // the bottom when the layout is bottom-aligned.
          if (panel) {
            return (
              <AbsoluteFill
                key={i}
                style={{
                  justifyContent: style.textBottom ? "flex-end" : "center",
                  padding: pad,
                  paddingBottom: igSafe
                    ? igSafeBottom
                    : style.textBottom
                      ? padBottom
                      : undefined,
                  paddingRight: igSafe ? igSafeRight : undefined,
                  opacity,
                  transform: `translateY(${lift}px)`,
                }}
              >
                <FrostPanel px={px}>{content}</FrostPanel>
              </AbsoluteFill>
            )
          }
          // Otherwise each paragraph anchors to its band (top grain, bottom sepia).
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: px(34),
                right: igSafe ? igSafeRight : px(34),
                ...(anchor === "bottom"
                  ? { bottom: igSafe ? igSafeBottom : padBottom }
                  : { top: px(120) }),
                opacity,
                transform: `translateY(${lift}px)`,
              }}
            >
              {content}
            </div>
          )
        })}
      </AbsoluteFill>
    )
  }

  if (card.kind === "reflection-focus") {
    const frosted = usesPanelFrost(card.kind, style)
    // When the card has its own title (e.g. "Keep Walking"), show it as a
    // heading above the text; otherwise fall back to the "Reflect" eyebrow.
    const heading = card.title ? (
      <div style={reveal(frame, fps, 0.15, 1, "down")}>
        {card.sectionLabel ? (
          <Eyebrow px={px} color={style.eyebrow} size={11} mb={12}>
            {card.sectionLabel}
          </Eyebrow>
        ) : null}
        <div
          style={{
            fontFamily: SANS,
            fontWeight: 700,
            fontSize: px(24),
            letterSpacing: px(-0.2),
            color: style.heading,
            marginBottom: px(14),
          }}
        >
          {card.title}
        </div>
      </div>
    ) : card.sectionLabel === "" ? null : (
      // sectionLabel "" suppresses the label (used on 2nd+ reflection cards so
      // "Reflect" shows once); undefined falls back to "Reflect" (back-compat).
      <Eyebrow px={px} color={style.eyebrow}>
        <span style={reveal(frame, fps, 0.15, 1, "down")}>
          {card.sectionLabel || "Reflect"}
        </span>
      </Eyebrow>
    )
    const inner = (
      <>
        {heading}
        <p
          style={{
            margin: 0,
            fontFamily: SANS,
            fontWeight: 400,
            // Owner-picked sizes: right panel 55px, bottom band 60px (desktop
            // 16:9); portrait keeps the original 69px (px scales by short side).
            fontSize:
              wideText === "right"
                ? px(20)
                : wideText === "bottom"
                  ? px(22)
                  : px(25),
            lineHeight: 1.46,
            color: style.body,
            // Owner rule: reflection text settles in as ONE gentle block (soft
            // scale + fade + tiny rise) rather than a per-letter cascade —
            // tried independent of the global `letters`/`anim` setting, which
            // still drives every OTHER card kind (scripture, conclusion, cover).
            ...reveal(frame, fps, 0.35, 1, "popUp"),
          }}
        >
          {withHighlight(card.text ?? "", card.highlight, style)}
        </p>
      </>
    )
    // Portrait experiment: the pipeline feeds ONE sentence per reflection card,
    // so read them like stable subtitles — a FIXED TOP anchor (upper-middle of
    // the frame) means every one-sentence card starts at the SAME Y and grows
    // DOWNWARD, instead of the old bottom anchor (where a 1-line vs 3-line
    // sentence jumped up/down). Only portrait, non-frosted; landscape keeps its
    // bottom-band / right-panel behaviour and frosted styles keep their panel.
    const stableTop = igSafe && !frosted
    // Fixed offset from the top of the frame for the stable-subtitle anchor.
    // px scales by the 1080 short side, so px(320) ≈ 886px ≈ 46% of the 1920
    // portrait height — upper-middle: clears the top, and a multi-line sentence
    // still grows down well inside the bottom safe inset (igSafeBottom).
    const stableTopPad = px(320)
    // Landscape: the text sits ON the blur — bottom band → flex-end, right
    // panel → vertically centered (owner rule: never mid-frame off the blur).
    // Portrait: bottom → flex-end; paneled non-bottom → centered; plain
    // non-bottom → TOP (regular reflections never center without a panel).
    const topAnchored = !wideText && !style.textBottom && !frosted
    const justify = stableTop
      ? "flex-start"
      : wideText
        ? wideText === "bottom"
          ? "flex-end"
          : "center"
        : style.textBottom
          ? "flex-end"
          : topAnchored
            ? "flex-start"
            : "center"
    return (
      <AbsoluteFill
        style={{
          justifyContent: justify,
          padding: pad,
          // Stable-subtitle top anchor (portrait): fixed Y; text grows downward.
          paddingTop: stableTop
            ? stableTopPad
            : topAnchored
              ? px(120)
              : undefined,
          // Owner rule (bottom band): 48px from the last line to the frame
          // edge at 1080p — px(17.35) ≈ 48px. Reflection text is LEFT-aligned
          // (owner: centered reflection is hard to read) — ragged right.
          paddingBottom:
            wideText === "bottom"
              ? px(17.35)
              : igSafe
                ? igSafeBottom
                : style.textBottom
                  ? padBottom
                  : undefined,
          paddingRight: igSafe ? igSafeRight : undefined,
          textAlign: wideText === "bottom" ? "left" : undefined,
        }}
      >
        {frosted ? <FrostPanel px={px}>{inner}</FrostPanel> : inner}
      </AbsoluteFill>
    )
  }

  if (card.kind === "conclusion") {
    // The emotional ending: always centered on the blurred background, whatever
    // the layout — a held, highlighted closing beat (not bottom-anchored, not in
    // a frost panel).
    const body = (
      <>
        {style.pullquote === "glyph" ? (
          <div
            style={{
              fontFamily: SERIF,
              fontSize: px(96),
              lineHeight: 0.55,
              color: style.rule,
              height: px(50),
              ...reveal(frame, fps, 0.25, 1, "zoom"),
            }}
          >
            &ldquo;
          </div>
        ) : (
          <div
            style={{
              width: px(48),
              height: px(4),
              background: style.rule,
              marginBottom: px(28),
              ...reveal(frame, fps, 0.3, 1, "growLine"),
            }}
          />
        )}
        <p
          style={{
            margin: 0,
            fontFamily: SANS,
            fontStyle: "italic",
            fontWeight: 400,
            fontSize: px(41),
            lineHeight: 1.18,
            letterSpacing: px(-0.4),
            color: style.body,
            ...(letters ? {} : reveal(frame, fps, 0.45, 1, "up")),
          }}
        >
          {letters ? (
            <LetterReveal
              text={card.text ?? ""}
              highlight={card.highlight}
              style={style}
              frame={frame}
              fps={fps}
              delaySec={0.5}
            />
          ) : (
            withHighlight(card.text ?? "", card.highlight, style)
          )}
        </p>
        {style.pullquote === "glyph" ? (
          <div
            style={{
              marginTop: px(30),
              width: px(48),
              height: px(2),
              background: style.rule,
              ...reveal(frame, fps, 0.9, 1, "fade"),
            }}
          />
        ) : null}
        {style.pullquote === "bars" ? (
          <div
            style={{
              marginTop: px(30),
              width: px(48),
              height: px(4),
              background: style.rule,
              ...reveal(frame, fps, 0.9, 1, "fade"),
            }}
          />
        ) : null}
      </>
    )
    return (
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          textAlign: "center",
          padding: pad,
          // IG Reels safe-area (portrait): shrink the centered box off the
          // right action rail and lift it above the caption/nav block.
          paddingRight: igSafe ? igSafeRight : undefined,
          paddingBottom: igSafe ? igSafeBottom : undefined,
        }}
      >
        {body}
      </AbsoluteFill>
    )
  }

  if (card.kind === "video") {
    // Dedicated Birth-of-Jesus clip plays clear (rendered by Background); no
    // text overlay so the film reads as itself.
    return null
  }

  if (card.kind === "cta") {
    // Teaser end-card: brand mark, a call to watch, the link + handle. Centered
    // on the blurred background, appears smoothly.
    return (
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          textAlign: "center",
          padding: pad,
        }}
      >
        <AnimatedBrandMark px={px} frame={frame} fps={fps} />
        <p
          style={{
            margin: `${px(26)}px 0 ${px(18)}px`,
            fontFamily: SANS,
            fontWeight: 700,
            // Smaller than the cover's headline: this card carries an ask, not
            // the hook, and at px(38) it competed with the title it follows.
            fontSize: px(30),
            lineHeight: 1.18,
            letterSpacing: px(-0.3),
            color: style.heading,
            maxWidth: px(320),
            ...reveal(frame, fps, 0.35, 1, "up"),
          }}
        >
          {card.ctaHeadline ?? "Watch the full devotional"}
        </p>
        {card.ctaUrl ? (
          <div
            style={{
              fontFamily: SANS,
              fontWeight: 700,
              fontSize: px(22),
              color: style.eyebrow,
              ...reveal(frame, fps, 0.55, 1, "fade"),
            }}
          >
            {card.ctaUrl}
          </div>
        ) : null}
        {card.ctaHandle ? (
          <div
            style={{
              marginTop: px(10),
              fontFamily: SANS,
              fontWeight: 500,
              fontSize: px(15),
              letterSpacing: px(0.3),
              color: style.secondary,
              ...reveal(frame, fps, 0.7, 1, "fade"),
            }}
          >
            {/* The handle alone. "· link in bio" was appended here regardless of
                whether a link was actually in the bio, which makes the card
                promise something the account may not be doing; the handle is
                what the viewer needs in order to follow. */}
            {card.ctaHandle}
          </div>
        ) : null}
      </AbsoluteFill>
    )
  }

  // questions + prayer — questions animate in one by one, then the prayer
  const questions = card.questions ?? []
  // Landscape (16:9): the frame is half as tall — scale this text-dense card
  // down a notch so question + prayer clear the header and the bottom edge.
  const q = (n: number) => (isLandscape ? px(n * 0.8) : px(n))
  // Prayer appears well after the questions — a 5s beat to sit with them first.
  const prayerDelay = 5
  // Questions + prayer are text-heavy: always centered on the blurred background
  // (no panel), independent of layout — same treatment as the conclusion.
  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        // Landscape: top padding clears the header logo/date row.
        padding: isLandscape ? `${px(64)}px ${px(34)}px ${px(28)}px` : pad,
      }}
    >
      {/* Star-orbit progress ring: small, left-aligned in the text column,
          sitting ABOVE the "Ask yourself" label (same left inset as the label +
          questions). Same fill/orbit animation + timing as before — it just
          flows inline here instead of the old bottom-corner overlay. */}
      <div style={{ marginBottom: q(14) }}>
        <ProgressRing
          px={px}
          fps={fps}
          frame={frame}
          startFrame={Math.round(3.5 * fps)}
          durationInFrames={durationInFrames}
          isLandscape={isLandscape}
          inline
          // Owner: was almost invisible at 22 — a little bigger, still small
          // enough to read as an inline accent, not a focal element.
          size={q(30)}
        />
      </div>
      <Eyebrow px={px} color={style.eyebrow} size={12}>
        <span style={reveal(frame, fps, 0.15, 1, "down")}>
          {card.askLabel ?? "Ask yourself"}
        </span>
      </Eyebrow>
      <div style={{ display: "flex", flexDirection: "column", gap: q(22) }}>
        {questions.map((text, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              gap: q(14),
              alignItems: "baseline",
              ...reveal(frame, fps, 0.3 + i * 0.35, 1, "up"),
            }}
          >
            {questions.length > 1 ? (
              // Number only when there are multiple questions; a single question
              // shows no "1." prefix.
              <span
                style={{
                  flex: "0 0 auto",
                  fontFamily: SANS,
                  fontWeight: 700,
                  fontSize: q(19),
                  color: style.eyebrow,
                }}
              >
                {i + 1}
              </span>
            ) : null}
            <p
              style={{
                margin: 0,
                fontFamily: SANS,
                fontWeight: 400,
                fontSize: q(26),
                lineHeight: 1.36,
                color: style.body,
              }}
            >
              {text}
            </p>
          </div>
        ))}
      </div>
      {card.prayer ? (
        <div
          style={{
            marginTop: q(32),
            ...reveal(frame, fps, prayerDelay, 1, "fade"),
          }}
        >
          <div
            style={{
              width: q(48),
              height: style.pullquote === "bars" ? px(4) : px(1),
              background: style.rule,
              marginBottom: q(22),
            }}
          />
          <Eyebrow px={px} color={style.eyebrow} size={12} mb={14}>
            {card.prayLabel ?? "Pray"}
          </Eyebrow>
          <p
            style={{
              margin: 0,
              fontFamily: SANS,
              fontStyle: "italic",
              fontWeight: 400,
              fontSize: q(22),
              lineHeight: 1.56,
              color: style.body,
            }}
          >
            {card.prayer}
          </p>
        </div>
      ) : null}
    </AbsoluteFill>
  )
}

function Background({
  card,
  style,
  props,
  px,
  durationInFrames,
  fromFrame,
  totalFrames,
  bgStartFrame,
  bgRate,
}: {
  card: DevotionalCard
  style: DevotionalStyle
  props: DevotionalInputProps
  px: (n: number) => number
  durationInFrames: number
  fromFrame: number
  totalFrames: number
  bgStartFrame: number
  bgRate: number
}) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  // Landscape (16:9 desktop): the film is natively wide — play it fitted
  // full-frame instead of the portrait square crop.
  const isLandscape = width > height
  const isVideoCard = card.kind === "video" && Boolean(card.videoFile)
  const heavy = HEAVY.has(card.kind)

  // Ken-Burns: ONE continuous slow zoom across the WHOLE video (driven by the
  // absolute frame, not per-card) so consecutive background segments — which are
  // contiguous footage — dissolve seamlessly with no scale "pop" at the cut.
  const absFrame = fromFrame + frame
  const kb = interpolate(absFrame, [0, totalFrames], [1.04, 1.16], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  // Gentle scale for the FITTED (contain) video-card layer — per-card is fine
  // (it's a single standalone beat).
  const kbFit = interpolate(frame, [0, durationInFrames], [1.0, 1.03], {
    extrapolateRight: "clamp",
  })

  const src = isVideoCard ? card.videoFile! : (card.bgFile ?? props.bgFile)
  // Cover (both orientations): centered lockup over CLEAR footage — no blur
  // band. A dark wash + inner vignette (below) keep the text readable, and the
  // footage's own blur eases from soft → sharp over the opening (per the design
  // spec: blur 12px → 0 over the first 60% of the card, easeOutCubic).
  const introCover = card.kind === "cover"
  // Blur behind the text only: a band for top/bottom-aligned cards, the whole
  // frame for centered text; the video card stays clear.
  const region = introCover ? "none" : blurRegionFor(card.kind, style)

  // Grade for the video card's clip: an explicit override wins; otherwise the
  // graded filters (gradeVideoCard) apply their base grade, and plain filters
  // leave the clip in natural color.
  const videoGrade =
    props.videoCardFilter ?? (style.gradeVideoCard ? style.mediaBase : "")
  // Peak volume for the clip's own audio: an explicit teaser level, else muted,
  // else near-full for the standalone full-devo video card.
  const clipAudioLevel =
    props.videoAudioLevel != null
      ? props.videoAudioLevel
      : props.muteVideoAudio
        ? 0
        : 0.95

  // Text-card / cover background video. All non-video cards share ONE continuous
  // clip (props.bgFile); trimBefore={bgStartFrame} makes each card a WINDOW into
  // it at the position where the previous card left off, so adjacent cards show
  // the SAME clip frame during their crossfade → the cut is seamless (no
  // repeated motion). The shared clip is cut long enough to cover the whole
  // background timeline, so no loop/freeze guard is needed.
  const bgTextVideo = (
    <OffthreadVideo
      src={staticFile(src ?? "")}
      trimBefore={Math.max(0, Math.round(bgStartFrame))}
      playbackRate={bgRate}
      // Text-card backgrounds are MUTED (music only) unless bgAudio is on
      // (teasers). Decoupled from videoAudioLevel so a full devo can set the
      // video-card level for balance without un-muting the reflection.
      muted={!props.bgAudio}
      volume={
        props.bgAudio
          ? (f) => {
              const fade = Math.round(0.5 * fps)
              return (
                (props.videoAudioLevel ?? 0.3) *
                0.5 *
                interpolate(
                  f,
                  [0, fade, durationInFrames - fade, durationInFrames],
                  [0, 1, 1, 0],
                  { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
                )
              )
            }
          : undefined
      }
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        // Cover: sharp graded footage at a constant slight zoom (full-bleed,
        // no blur); other text cards dim + Ken-Burns behind the blur band.
        filter: introCover
          ? (props.mediaFilterOverride ?? style.mediaBase) || undefined
          : `${props.mediaFilterOverride ?? style.mediaBase} brightness(0.85)`.trim(),
        transform: introCover ? "scale(1.04)" : `scale(${kb})`,
      }}
    />
  )
  const bgTextLayer = bgTextVideo

  // The video card shows the horizontal clip FITTED (whole frame visible) with a
  // blurred, enlarged copy filling the wings — no dead letterbox bars. Text
  // cards show the footage lightly dimmed; the blur comes from the overlay so
  // only the text region is obscured.
  const media = !src ? null : isVideoCard ? (
    <>
      {/* Blurred wings fill. Natural color by default; an optional
          videoCardFilter cools/tints warm source footage to match the grade. */}
      <OffthreadVideo
        src={staticFile(src)}
        muted
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          filter: `${videoGrade} blur(${px(26)}px) brightness(0.5)`.trim(),
          transform: `scale(${kb * 1.08})`,
        }}
      />
      {/* Fitted sharp clip, in color, with its own audio faded in/out and kept
          quieter so it sits at the narration's level. Teasers mute it so the
          loud clip audio doesn't jump against the music bed. */}
      <OffthreadVideo
        src={staticFile(src)}
        // In continuous mode the clip is a WINDOW into the same take the
        // backdrop has been playing, so it opens where that left off. Without
        // this the file restarts and the viewer sees the last few seconds again.
        {...(props.continuousClip
          ? { trimBefore: Math.max(0, Math.round(bgStartFrame)) }
          : {})}
        muted={clipAudioLevel <= 0}
        volume={(f) => {
          const clipEnd = Math.round((card.durationSec ?? 1) * fps)
          // Full devo: near-full, quick fades (clip plays alone, music ducked).
          // Teaser (videoAudioLevel set): quiet + slow fade in/out so it eases
          // gently under the music bed.
          const slow = props.videoAudioLevel != null
          // The onset and the tail want OPPOSITE curves, and squaring both is
          // what made the clip audio "sit quiet then jump" a second time.
          //
          // A squared ramp is back-loaded: a quarter of the way in it is at
          // 6% gain, inaudible, and nearly all the audible movement happens in
          // the last moments — the jump itself. The film is SPEAKING from its
          // first frame here, so the onset has to be quick and front-loaded
          // (sqrt) to be intelligible immediately, with just enough ramp to
          // avoid a click. The tail is the opposite case: nothing is lost by
          // letting it recede slowly, so it keeps the squared curve.
          const fin = Math.round((slow ? 1.2 : 0.45) * fps)
          const fout = Math.round((slow ? 2 : 1.3) * fps)
          const rise = interpolate(f, [0, fin], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })
          const fall = interpolate(f, [clipEnd - fout, clipEnd], [1, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })
          return clipAudioLevel * Math.sqrt(rise) * fall * fall
        }}
        style={
          isLandscape
            ? {
                // 16:9 frame: the film is natively wide — fitted full-frame.
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "contain",
                filter: videoGrade || undefined,
                transform: `scale(${kbFit})`,
              }
            : {
                // Portrait: squarish crop (owner) — fill a centered 1:1 window
                // (cover); bigger, more immersive, blurred wings above/below.
                position: "absolute",
                left: 0,
                right: 0,
                top: "21.9%", // (1920-1080)/2 / 1920 — centers the 1:1 crop
                width: "100%",
                height: "56.25%", // 1080/1920 → square in the 9:16 frame
                objectFit: "cover",
                filter: videoGrade || undefined,
                transform: `scale(${kbFit})`,
              }
        }
      />
    </>
  ) : (
    bgTextLayer
  )

  // "Don't blur so hard" cards: the grain cover, and the scripture card on the
  // teal-family filters, keep the footage more visible (softer blur + lighter
  // scrim) — so the verse reads over recognizable, continuing footage.
  const soft =
    (style.id === "grain" && card.kind === "cover") ||
    (["teal", "tealorange", "splittone"].includes(style.id) &&
      card.kind === "scripture")
  // The closing questions+prayer card was over-blurred (owner: too strong on the
  // last card) — use a medium blur + lighter scrim so the footage stays legible
  // behind the text without going murky.
  const medium = card.kind === "questions"
  const blurScale = props.blurScale ?? 1
  // Owner-picked levels: reflection + conclusion keep the footage nearly sharp.
  // Desktop (16:9) = "blur 10%" (px2.8); mobile (9:16) = "blur 15%" (px4.2) —
  // the taller frame shows more background, so it wants a touch more blur.
  // Legibility comes from the scrim + a soft, wide text shadow. Scripture (soft)
  // and questions (medium) keep heavier blur.
  const heavyBlurPx = isLandscape ? px(2.8) : px(4.2)
  // A cover asked to stay sharp keeps the footage unblurred and takes only a
  // light scrim — enough for one line of white text, not enough to hide what
  // the shot is. Cover only; every other card still needs its blur to be read.
  const sharpCover = Boolean(props.coverBgSharp) && card.kind === "cover"
  const BLUR = sharpCover
    ? 0
    : (soft ? px(8) : medium ? px(15) : heavyBlurPx) * blurScale
  const wholeScrim = sharpCover
    ? "rgba(6,4,3,0.22)"
    : soft
      ? "rgba(6,4,3,0.3)"
      : medium
        ? "rgba(6,4,3,0.36)"
        : "rgba(6,4,3,0.46)"
  let blurOverlay: ReactNode = null
  if (region === "whole") {
    blurOverlay = (
      <AbsoluteFill
        style={{
          backdropFilter: `blur(${BLUR}px)`,
          WebkitBackdropFilter: `blur(${BLUR}px)`,
          background: wholeScrim,
          pointerEvents: "none",
        }}
      />
    )
  } else if (isLandscape && props.wideText === "right" && region !== "none") {
    // Landscape right-panel variant: a vertical blur panel on the right —
    // the text column sits inside it; footage stays clear on the left.
    blurOverlay = (
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          right: 0,
          width: "44%",
          backdropFilter: `blur(${BLUR}px)`,
          WebkitBackdropFilter: `blur(${BLUR}px)`,
          background:
            "linear-gradient(90deg, transparent, rgba(6,4,2,0.7) 40%)",
          maskImage: "linear-gradient(90deg, transparent 0%, #000 26%)",
          WebkitMaskImage: "linear-gradient(90deg, transparent 0%, #000 26%)",
          pointerEvents: "none",
        }}
      />
    )
  } else if (region === "top" || region === "bottom") {
    const top = region === "top"
    blurOverlay = (
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: top ? 0 : undefined,
          bottom: top ? undefined : 0,
          height: "62%",
          backdropFilter: `blur(${BLUR}px)`,
          WebkitBackdropFilter: `blur(${BLUR}px)`,
          background: top
            ? "linear-gradient(180deg, rgba(6,4,2,0.62), transparent)"
            : "linear-gradient(180deg, transparent, rgba(6,4,2,0.62))",
          maskImage: top
            ? "linear-gradient(180deg, #000 58%, transparent 100%)"
            : "linear-gradient(180deg, transparent 0%, #000 42%)",
          WebkitMaskImage: top
            ? "linear-gradient(180deg, #000 58%, transparent 100%)"
            : "linear-gradient(180deg, transparent 0%, #000 42%)",
          pointerEvents: "none",
        }}
      />
    )
  }

  // Archival film treatment: a highlight-bloom pass (a blurred, brightened copy
  // of the footage, screen-blended so bright areas glow — halation), plus extra
  // grain, a deeper vignette, and a thin film-frame edge. Everything reuses the
  // base grade so the glow matches the chosen look.
  const film = props.filmTreatment === true
  const baseGrade = isVideoCard
    ? videoGrade
    : (props.mediaFilterOverride ?? style.mediaBase)
  const bloom =
    film && src ? (
      <AbsoluteFill
        style={{ mixBlendMode: "screen", opacity: 0.34, pointerEvents: "none" }}
      >
        <OffthreadVideo
          src={staticFile(src)}
          muted
          style={{
            width: "100%",
            height: "100%",
            objectFit: isVideoCard ? "contain" : "cover",
            filter:
              `${baseGrade} blur(${px(15)}px) brightness(1.7) saturate(1.05)`.trim(),
            transform: `scale(${isVideoCard ? kbFit : kb})`,
          }}
        />
      </AbsoluteFill>
    ) : null

  // True teal-orange split-tone: teal lifted into the shadows (screen adds most
  // where the image is dark) and warm orange pressed into the highlights
  // (multiply tints most where the image is bright). Unlike a hue-rotate this
  // manufactures teal-orange on ANY footage. The orange matches the brand accent.
  const splitTone =
    (props.splitTone ?? style.splitTone) === true && Boolean(src)
  const splitToneLayers = splitTone ? (
    <>
      <AbsoluteFill
        style={{
          background: "rgb(10,54,64)",
          mixBlendMode: "screen",
          opacity: 0.6,
          pointerEvents: "none",
        }}
      />
      <AbsoluteFill
        style={{
          background: "rgb(240,176,116)",
          mixBlendMode: "multiply",
          opacity: 0.55,
          pointerEvents: "none",
        }}
      />
    </>
  ) : null

  // Cover treatment (Claude Design spec): a flat rgba(0,0,0,0.28) scrim over the
  // whole frame plus a soft inner vignette darkening the edges/corners.
  const coverScrim = introCover ? (
    <>
      <AbsoluteFill
        style={{ background: "rgba(0,0,0,0.28)", pointerEvents: "none" }}
      />
      <AbsoluteFill
        style={{
          boxShadow: `inset 0 0 ${px(108.3)}px ${px(21.7)}px rgba(0,0,0,0.45)`,
          pointerEvents: "none",
        }}
      />
    </>
  ) : null

  return (
    <AbsoluteFill style={{ backgroundColor: style.mediaBg }}>
      {src ? media : <AbsoluteFill style={{ background: style.textBg }} />}
      {splitToneLayers}
      {bloom}
      {blurOverlay}
      {coverScrim}
      <Grain
        opacity={
          (heavy ? style.grainText : style.grainMedia) + (film ? 0.16 : 0)
        }
      />
      {/* The cover paints its own vignette (above); skip the style vignette. */}
      <AbsoluteFill
        style={{
          boxShadow: introCover
            ? undefined
            : film
              ? "inset 0 0 130px 46px rgba(0,0,0,0.66)"
              : heavy
                ? style.vignetteText
                : style.vignetteMedia,
        }}
      />
      {film ? (
        <AbsoluteFill
          style={{
            boxShadow: `inset 0 0 0 ${px(1.5)}px rgba(255,255,255,0.07), inset 0 0 0 ${px(5)}px rgba(0,0,0,0.5)`,
            pointerEvents: "none",
          }}
        />
      ) : null}
    </AbsoluteFill>
  )
}

/**
 * How long the outgoing card's TEXT takes to fade away, inside that card's own
 * trailing breath pad (CARD_TAIL_FRAMES) — i.e. BEFORE the next card's
 * sequence starts. Owner: consecutive reflection sentences were visible at the
 * same time during the cross-dissolve; clearing the text early leaves a real
 * gap between blocks while the BACKGROUND still dissolves seamlessly.
 */
const TEXT_FADE_OUT_SEC = 0.55

/** Fades a card in over its first `xfade` frames — with overlapping sequences
 * this dissolves the previous card into the next (a slow crossfade). */
function CardFade({ xfade, children }: { xfade: number; children: ReactNode }) {
  const f = useCurrentFrame()
  const opacity = interpolate(f, [0, xfade], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>
}

export function DevotionalVideo(props: DevotionalInputProps) {
  loadShortFonts()
  const { durationInFrames, fps, width, height } = useVideoConfig()
  const frame = useCurrentFrame()
  const style = resolveDevotionalStyle(props.style, props.layout)
  // Scale by the SHORT side: portrait (1080×1920) and landscape (1920×1080)
  // get identical absolute type/spacing sizes, so one design serves both.
  const px = (n: number) => (n * Math.min(width, height)) / REF
  const isLandscape = width > height
  // Landscape: the TEXT lives in a centered column a bit wider than the
  // portrait measure (fewer, longer lines — the frame is half as tall);
  // backgrounds stay full-bleed.
  const wideText = isLandscape ? (props.wideText ?? "bottom") : undefined
  // "right": a narrower column pinned to the right panel; "bottom": centered.
  const columnWidth =
    wideText === "right" ? Math.min(width, px(240)) : Math.min(width, px(505))
  const columnInset = isLandscape ? Math.max(0, (width - columnWidth) / 2) : 0
  const columnLeft =
    wideText === "right" ? width - columnWidth - px(24) : columnInset
  const columnRight = wideText === "right" ? px(24) : columnInset
  // Owner rule (landscape): edge-anchored text sits exactly 48px from the top
  // and bottom frame edges. The column wrapper spans the full height and each
  // card's own padding (padBottom / columnHeader) supplies the 48px — no extra
  // wrapper inset that would push blocks off the edge.
  const showMuteButton = props.showMuteButton !== false

  const perCardAudio = hasPerCardAudio(props.cards)
  const outroFrames =
    props.outroHoldSec != null
      ? Math.round(props.outroHoldSec * fps)
      : OUTRO_HOLD_FRAMES
  // Opening pause before the narration (drives both the cover's on-screen
  // length and the first card's audio delay). Overridable per render.
  const introFrames =
    props.introHoldSec != null
      ? Math.round(props.introHoldSec * fps)
      : INTRO_HOLD_FRAMES
  const frames = perCardAudio
    ? framesFromDurations(
        props.cards,
        fps,
        CARD_TAIL_FRAMES,
        outroFrames,
        introFrames,
      )
    : computeCardFrames(props.cards, durationInFrames, Math.round(2.5 * fps))

  // Soft fade from black at the open and to black at the close. noEndFade holds
  // the last frame clean instead (cover-only samples, or any clip that will be
  // seam-spliced into a following shot rather than ending on black).
  const fadeIn = Math.round(0.6 * fps)
  const fadeOut = Math.round(0.9 * fps)
  const endLevel = props.noEndFade ? 0 : 1
  const blackout = interpolate(
    frame,
    [0, fadeIn, durationInFrames - fadeOut, durationInFrames],
    [1, 0, 0, endLevel],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  )

  // Slow crossfade between cards: each card (except the last) lingers XFADE
  // frames into the next card's start, and the next card fades in over the
  // overlap — so one card dissolves into the next instead of hard-cutting.
  // Teasers raise this (props.xfadeSec) so the opening dissolves slowly and the
  // verse blur ramps in gently.
  const XFADE =
    props.xfadeSec != null
      ? Math.round(props.xfadeSec * fps)
      : Math.round(0.85 * fps)
  // Both dissolves touching the video card are slower — scripture melts INTO the
  // clip, and the clip melts OUT into the reflection (no abrupt cut either end).
  const VIDEO_XFADE = Math.round(1.3 * fps)
  /** Frames of the requested verse hold, if any. */
  const verseHoldFrames = Math.round((props.verseHoldIntoVideoSec ?? 0) * fps)
  /** Card `i` is the one whose text should stay up as the video arrives. */
  const holdsIntoVideo = (i: number) =>
    verseHoldFrames > 0 &&
    props.cards[i]?.kind !== "video" &&
    props.cards[i + 1]?.kind === "video"
  const boundaryXfade = (i: number) =>
    holdsIntoVideo(i)
      ? verseHoldFrames
      : props.cards[i]?.kind === "video" || props.cards[i + 1]?.kind === "video"
        ? VIDEO_XFADE
        : XFADE
  const lastIndex = props.cards.length - 1

  // Duck the music to silence across the video card (it plays the film's own
  // sound). Short fades at the edges so the drop isn't abrupt. When the clip is
  // muted (teasers), don't duck — let the music bed play straight through.
  // Don't duck the music when the clip is muted OR quiet (teasers) — the bed
  // plays straight through and the soft clip audio just sits under it.
  // Duck the music to silence across the video card so it doesn't overlap the
  // clip's own audio. Skip ducking only when the clip is muted, or in teasers
  // (bgAudio) where the bed plays straight through. A quiet video-card level
  // (videoAudioLevel) no longer disables the duck.
  // EVERY video card, not just the first. The two-act layout plays a second
  // clip later in the timeline; with `findIndex` the bed ducked only for act 1
  // and then played straight through act 2, over the film's own dialogue
  // (owner-reported).
  const videoWindows =
    props.muteVideoAudio || props.bgAudio
      ? []
      : props.cards.flatMap((c, i) =>
          c.kind === "video"
            ? [
                {
                  start: frames[i].from,
                  // Keep the music muted through the trailing crossfade too —
                  // the clip's own audio plays until the video card fully
                  // dissolves into the next.
                  end:
                    frames[i].from +
                    frames[i].durationInFrames +
                    (i < lastIndex ? XFADE : 0),
                },
              ]
            : [],
        )
  const duckFade = Math.round(0.4 * fps)

  // Seamless background: every non-video card is a WINDOW into ONE shared,
  // continuous clip (props.bgFile). Each card's window starts where the previous
  // non-video card's window ended (the running offset advances by the card's OWN
  // frame count, INCLUDING its crossfade tail) so that during a crossfade both
  // the outgoing and incoming cards show the EXACT SAME clip frame — the cut is
  // invisible (no repeated motion, no scale pop). The video card plays its own
  // curated clip and does not consume the background timeline.
  const bgRate = props.bgPlaybackRate ?? 1
  let bgAcc = 0
  const bgStartFrames = props.cards.map((c, i) => {
    // A video card normally shows its OWN window, so it starts at frame 0 and
    // does not consume any of the shared take. `continuousClip` makes it part
    // of the same take instead — it starts where the backdrop left off and
    // advances the accumulator like any other card, so nothing is replayed.
    if (c.kind === "video" && !props.continuousClip) return 0
    const start = bgAcc
    // Advance by the card's frames scaled by the playback rate — the clip
    // advances `bgRate` film-frames per composition frame, so the window
    // offsets stay aligned to the (slightly slowed) shared take.
    bgAcc += frames[i].durationInFrames * bgRate
    return start
  })

  return (
    <AbsoluteFill style={{ backgroundColor: "#0c0805" }}>
      {props.cards.map((card, i) => {
        // Delay the FIRST card's narration by the intro hold so the video
        // opens on a calm, silent beat before the voice begins.
        const audioDelay = perCardAudio && i === 0 ? introFrames : 0
        const seqDuration =
          frames[i].durationInFrames + (i < lastIndex ? boundaryXfade(i) : 0)
        // Clear this card's TEXT before the next card's text arrives. The fade
        // runs inside the card's OWN duration (its trailing breath pad), so by
        // the time the cross-dissolve starts the screen holds only background —
        // no two sentences on screen at once. The LAST card never fades (it
        // holds through the outro).
        const textFadeFrames = Math.min(
          Math.round(TEXT_FADE_OUT_SEC * fps),
          Math.max(1, Math.round(frames[i].durationInFrames * 0.3)),
        )
        const textFadeStart =
          frames[i].from + frames[i].durationInFrames - textFadeFrames
        const textOpacity =
          // The card holding its verse into the video keeps the text up for the
          // whole dissolve; the fade that normally clears it early would defeat
          // the point of the hold.
          holdsIntoVideo(i)
            ? 1
            : i < lastIndex
              ? interpolate(
                  frame,
                  [textFadeStart, textFadeStart + textFadeFrames],
                  [1, 0],
                  { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
                )
              : 1
        return (
          <Sequence
            key={i}
            from={frames[i].from}
            durationInFrames={seqDuration}
          >
            <CardFade xfade={i === 0 ? 1 : boundaryXfade(i - 1)}>
              <Background
                card={card}
                style={style}
                props={props}
                px={px}
                durationInFrames={seqDuration}
                fromFrame={frames[i].from}
                totalFrames={durationInFrames}
                bgStartFrame={bgStartFrames[i]}
                bgRate={bgRate}
              />
              {/* Landscape: text in a centered portrait-width column; the
                  background above stays full-bleed. */}
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: columnLeft,
                  right: columnRight,
                  // Slight shadow on all card text (inherited) for legibility
                  // over the lightly-blurred footage.
                  textShadow: TEXT_SHADOW,
                  // Text clears before the next card's text fades in (the
                  // background keeps cross-dissolving underneath).
                  opacity: textOpacity,
                }}
              >
                <CardLayer
                  card={card}
                  style={style}
                  px={px}
                  fps={fps}
                  headerDate={props.headerDate}
                  durationInFrames={frames[i].durationInFrames}
                  showMuteButton={showMuteButton}
                  anim={props.textAnim}
                  staticCover={props.staticCover === true}
                  wideText={wideText}
                  attribution={props.attribution}
                  hideCoverDate={props.hideCoverDate === true}
                  hideCoverLogo={props.hideCoverLogo === true}
                  coverDateLabel={props.coverDateLabel}
                  coverTitleFirst={props.coverTitleFirst === true}
                  coverTextStatic={props.coverTextStatic === true}
                  coverSecondaryLine={props.coverSecondaryLine}
                />
              </div>
            </CardFade>
            {card.audioFile ? (
              <Sequence from={audioDelay}>
                <Audio src={staticFile(card.audioFile)} />
              </Sequence>
            ) : null}
          </Sequence>
        )
      })}
      {/* Soft instrumental bed under everything: loops to fill the runtime.
          Starts from the VERY FIRST frame (short ~0.4s ramp so it's present
          under the opening, not a slow swell) and fades down under the close. */}
      {props.musicFile ? (
        <Audio
          src={staticFile(props.musicFile)}
          loop
          volume={(f) => {
            const base = interpolate(
              f,
              [
                0,
                Math.round(0.4 * fps),
                durationInFrames - Math.round(2.5 * fps),
                durationInFrames,
              ],
              [
                props.musicVolume * 0.7,
                props.musicVolume,
                props.musicVolume,
                0,
              ],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            )
            if (videoWindows.length === 0) return base
            // 1 everywhere except 0 across EACH video card (short edge fades).
            // Take the lowest duck across all windows so overlapping fades
            // never let the bed swell back up between adjacent acts.
            const duck = videoWindows.reduce((lowest, w) => {
              const d = interpolate(
                f,
                [w.start - duckFade, w.start, w.end, w.end + duckFade],
                [1, 0, 0, 1],
                { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
              )
              return Math.min(lowest, d)
            }, 1)
            return base * duck
          }}
        />
      ) : null}
      <AbsoluteFill
        style={{
          backgroundColor: "#000",
          opacity: blackout,
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  )
}

function CardLayer({
  card,
  style,
  px,
  fps,
  headerDate,
  durationInFrames,
  showMuteButton,
  anim,
  staticCover,
  wideText,
  attribution,
  hideCoverDate,
  hideCoverLogo,
  coverDateLabel,
  coverTitleFirst,
  coverTextStatic,
  coverSecondaryLine,
}: {
  card: DevotionalCard
  style: DevotionalStyle
  px: (n: number) => number
  fps: number
  headerDate: string
  durationInFrames: number
  showMuteButton: boolean
  anim: "block" | "letters"
  staticCover: boolean
  wideText?: "bottom" | "right"
  attribution?: string
  hideCoverDate?: boolean
  hideCoverLogo?: boolean
  coverDateLabel?: string
  coverTitleFirst?: boolean
  coverTextStatic?: boolean
  coverSecondaryLine?: string
}) {
  const frame = useCurrentFrame()
  const { width: layerW, height: layerH } = useVideoConfig()
  const layerIsLandscape = layerW > layerH
  // Owner rules: NO logo anywhere; the date appears ONLY on the cover (above
  // the title) — so non-cover cards render no header at all.
  return (
    <AbsoluteFill>
      <CardBody
        card={card}
        style={style}
        px={px}
        wideText={wideText}
        frame={frame}
        fps={fps}
        durationInFrames={durationInFrames}
        headerDate={headerDate}
        anim={anim}
        staticCover={staticCover}
        attribution={attribution}
        hideCoverDate={hideCoverDate}
        hideCoverLogo={hideCoverLogo}
        coverDateLabel={coverDateLabel}
        coverTitleFirst={coverTitleFirst}
        coverTextStatic={coverTextStatic}
        coverSecondaryLine={coverSecondaryLine}
      />
      {card.kind === "video" && card.subtitles?.length ? (
        <VideoSubtitles
          cues={card.subtitles}
          style={style}
          px={px}
          frame={frame}
          fps={fps}
          isLandscape={layerIsLandscape}
          // Same Instagram Reels right inset the text cards use, so captions
          // clear the action rail. (The bottom is handled by anchoring inside
          // the video window, which already sits well above the chrome.)
          safeRight={px(50.5)}
        />
      ) : null}
      {showMuteButton ? <MuteButton px={px} style={style} /> : null}
    </AbsoluteFill>
  )
}
