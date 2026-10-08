import { Fragment, type CSSProperties, type ReactNode } from "react"
import {
  AbsoluteFill,
  Audio,
  Easing,
  OffthreadVideo,
  Sequence,
  interpolate,
  interpolateColors,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion"

import { loadShortFonts, SHORT_FONT_FAMILIES } from "../fonts"
import { loadLiterata, TEASER_FONT_FAMILIES } from "./teaser-fonts"
import { BigStepWord, bigStepFontSize } from "./BigStepWord"
import { FILM_MARK_URIS } from "./film-marks"
import {
  SIDE_BOTTOM,
  SideMarkOverlay,
  sideDrawer,
  useSideMarkLayout,
} from "./SideSourceMark"
import { SourceMarkOverlay, WIDE_TEXT_BOTTOM } from "./SourceMarkOverlay"
import { VerseCalloutOverlay } from "./VerseCalloutOverlay"
import { quoteIntroTimeline } from "./quote-timing"
import { QuoteIntro } from "./QuoteIntro"
import { CalmCallToAction, KineticCaption } from "./KineticCaption"

/** Teaser CTA: how far the music bed rises over the call to action. */
const CTA_MUSIC_SWELL = 2
import { ScrollingScripture } from "./ScrollingScripture"
import { StampLine } from "./StampLine"
import { StepProgressLine } from "./StepProgressLine"
import { StepperStack } from "./Stepper"
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
// Owner rule (2026-09-22): Literata carries the serif text — title, takeaway,
// question, prayer, the film's captions — so the series runs on two faces
// instead of three. The reflection body stays on SANS: it is the longest block
// of reading in the piece.
const SERIF = `'${TEASER_FONT_FAMILIES.literata}', Georgia, 'Times New Roman', serif`
// The ONE exception the owner kept: the Bible verse is set in italic, and
// Source Serif 4's italic is the prettier of the two. It carries the verse and
// the quotation mark above it; everything else on that card is SANS.
const VERSE_SERIF = `'${SHORT_FONT_FAMILIES.sourceSerif}', Georgia, 'Times New Roman', serif`
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

/**
 * The portrait "stable subtitle" anchor: one-sentence reflection-focus cards
 * are pinned at a FIXED upper-middle offset (`stableTopPad`, ~46% of the
 * frame) and grow DOWNWARD, so every card starts at the same Y instead of
 * jumping with line count.
 *
 * Exported and shared because the anchor is read in TWO places — the text
 * layout and the blur region — and when the anchor was introduced only the
 * layout learned about it. The blur kept answering from `style.textBottom`,
 * which no longer describes where the text is, so every portrait reflection
 * card blurred the TOP of the frame while its text sat in the lower half:
 * the ground was above the words instead of behind them.
 */
export function usesStableTopAnchor(
  kind: string,
  style: DevotionalStyle,
  isLandscape: boolean,
): boolean {
  return (
    kind === "reflection-focus" && !isLandscape && !usesPanelFrost(kind, style)
  )
}

/** Where a card's text sits vertically (drives both layout and blur region). */
function textAnchorFor(
  kind: string,
  style: DevotionalStyle,
  isLandscape = false,
): TextAnchor {
  // The stable anchor starts mid-frame and grows DOWN, so the text's ground is
  // the bottom of the frame no matter what the layout's `textBottom` says.
  if (usesStableTopAnchor(kind, style, isLandscape)) return "bottom"

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
export function blurRegionFor(
  kind: string,
  style: DevotionalStyle,
  isLandscape = false,
): "none" | "whole" | "top" | "bottom" {
  if (kind === "video") return "none"
  // The conclusion is the emotional ending: it always lands centered on a fully
  // blurred, calm background (never the sharp/moving footage), so the closing
  // phrase isn't fighting the video. Independent of layout/panel-frost.
  // The stepper is a calm interstitial: it sits on a fully blurred ground so
  // the four words are the only thing to read, the same treatment as the
  // conclusion.
  if (kind === "step") return "whole"
  if (kind === "conclusion") return "whole"
  if (kind === "cta") return "whole" // teaser end-card sits on a calm blurred bg
  if (usesPanelFrost(kind, style)) return "none"
  if (kind === "questions") return "whole"
  const anchor = textAnchorFor(kind, style, isLandscape)
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
              // Highlighted phrases are always italic (owner rule), and since
              // 2026-09-25 they also carry weight: with longer reflections the
              // colour alone stopped reading as emphasis (owner: "write them
              // bolder, keep the gold").
              fontStyle: inHl ? "italic" : undefined,
              fontWeight: inHl ? 600 : undefined,
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
 * Placement: in PORTRAIT the clip plays in a 1:1 window anchored near the TOP
 * of the frame (see the video-card branch of Background) — owner: the old
 * centered window left dead blurred margins above AND below the picture, and
 * captions anchored inside the window's bottom edge sat ON TOP of the film
 * instead of in that space. Now the window sits high, and captions live in
 * the band BELOW it — clear of the picture, using the space that used to be
 * wasted — growing DOWN toward the frame's safe-bottom line instead of up
 * into the video. Owner rules: same typeface as the cards (SANS), and never
 * low enough for a social app's caption/nav chrome to cover them; the right
 * inset clears the action rail.
 */
/** Portrait: top of the 1:1 video window, as a % of frame height — a small
 *  clearance from the very top rather than the old vertical centering. */
const VIDEO_WINDOW_TOP_PCT = 3
/** Bottom of that window (top + the fixed 56.25% square crop height). */
const VIDEO_WINDOW_BOTTOM_PCT = VIDEO_WINDOW_TOP_PCT + 56.25
/**
 * Word timings for a caption line that only has LINE timing (the clip's
 * subtitle cues). Words are placed in proportion to their length across the
 * line's window, minus a short tail so the last word is not still arriving as
 * the line fades. Good enough for slow, clear dialogue; word-level ASR would
 * be the upgrade if a fast line ever reads out of step.
 */
export function spreadWords(
  text: string,
  startSec: number,
  endSec: number,
): { token: string; startSec: number; endSec: number }[] {
  const tokens = text.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return []
  const window = Math.max(0.2, endSec - startSec - 0.25)
  const weights = tokens.map((w) =>
    Math.max(2, w.replace(/[^\p{L}\p{N}]/gu, "").length + 1),
  )
  const total = weights.reduce((a, b) => a + b, 0)
  let acc = 0
  return tokens.map((token, i) => {
    const s = startSec + (acc / total) * window
    acc += weights[i]
    const e = startSec + (acc / total) * window
    return { token, startSec: s, endSec: e }
  })
}

/**
 * A wide stretch of the film shown as two panels (owner's idea, 2026-09-18):
 * the whole 16:9 frame across the top, and under it a close crop that follows
 * the same face path the full-frame crop uses. A 9:16 window through a wide
 * crowd shot throws most of the picture away and lands on whoever happens to
 * be at the chosen x; this keeps the scene readable and the subject large.
 *
 * Drawn OVER the card's own video, which keeps playing underneath and carries
 * the sound, so the audio and the focus path need no special case.
 */
// Tight enough that the close panel is a PERSON, not a group (owner).
const SPLIT_ZOOM = 1.9

function ClipSplitPanels({
  src,
  trimBefore,
  focusX,
  focusY,
  width,
  height,
  opacity,
  grade,
}: {
  src: string
  trimBefore: number
  /** 0-1 across the source frame: where the close panel is centred. */
  focusX: number
  /** 0-1 down the source frame; the face sits a little above centre. */
  focusY: number
  width: number
  height: number
  opacity: number
  grade?: string
}) {
  // The top panel is the whole frame at its own ratio; the bottom takes what
  // is left, so neither is letterboxed.
  const topH = Math.round((width * 9) / 16)
  const bottomH = height - topH
  // The close panel: cover the box, then zoom, and place the face where we
  // want it (a little above the middle, so the body reads under it).
  const coverH = Math.max(bottomH, (width * 9) / 16)
  const imgH = coverH * SPLIT_ZOOM
  const imgW = (imgH * 16) / 9
  const faceAt = 0.42
  const imgLeft = Math.min(0, Math.max(width - imgW, width / 2 - focusX * imgW))
  const imgTop = Math.min(
    0,
    Math.max(bottomH - imgH, bottomH * faceAt - focusY * imgH),
  )
  return (
    <AbsoluteFill style={{ opacity, background: "#0c0805" }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width,
          height: topH,
          overflow: "hidden",
        }}
      >
        <OffthreadVideo
          src={src}
          muted
          trimBefore={trimBefore}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: grade || undefined,
          }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: topH,
          width,
          height: bottomH,
          overflow: "hidden",
        }}
      >
        {/* Positioned by hand rather than with objectPosition: `cover` places
            the image and a transform then scales it about the CONTAINER's
            centre, which pushes the very face we aimed at back out of frame
            (the close panel was filling with a bystander's torso). Sizing the
            image and offsetting it puts the face where we say it is. */}
        <OffthreadVideo
          src={src}
          muted
          trimBefore={trimBefore}
          style={{
            position: "absolute",
            width: imgW,
            height: imgH,
            left: imgLeft,
            top: imgTop,
            maxWidth: "none",
            objectFit: "fill",
            filter: grade || undefined,
          }}
        />
      </div>
      {/* A hairline where the panels meet, the same edge the bands intro uses. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: topH,
          width,
          height: Math.max(1, Math.round(height / 1080)),
          background: "rgba(0,0,0,0.85)",
        }}
      />
    </AbsoluteFill>
  )
}

/**
 * The owner's caption spec for the film (2026-09-18), in her words:
 * uppercase, centred, compact; Literata 500; content words large and the
 * small grammar words small; the phrase builds word by word and then HOLDS,
 * because a line that vanishes as its last word lands cannot be read.
 *
 * Sizes are given for a 1080x1920 frame and converted to design units here
 * (px(1) = 1080/390 px), so the same spec holds in any output size.
 */
const PHRASE_FUNCTION_WORDS = new Set([
  "the",
  "to",
  "is",
  "your",
  "when",
  "it",
  "and",
  "a",
  "of",
  "on",
  "for",
  "than",
  "what",
  "did",
  "say",
  "about",
  "been",
  "very",
  "no",
  "one",
  "can",
])
// Sizes for a 1080x1920 frame. Smaller than the first cut: at 104/70 the block
// covered too much of the picture (owner). Only the STRONG words are set in
// caps and a size up; everything else keeps its own case, so a phrase reads as
// a sentence with two words struck out of it, not as a wall of capitals.
const PHRASE_STRONG_PX = 92
const PHRASE_CONTENT_PX = 74
const PHRASE_FUNCTION_PX = 54
/** Inside the side padding: 130px clear of each edge on a 1080 frame. */
const PHRASE_MAX_WIDTH_PX = 820
const PHRASE_CENTRE_Y_PX = 1060
const PHRASE_FRAME_PX = { w: 1080, h: 1920 }
const PHRASE_MAX_LINES = 3
/** Per-character advance as a share of font size: caps run wider than lowercase. */
const PHRASE_CHAR_W_UPPER = 0.7
const PHRASE_CHAR_W_LOWER = 0.55
const PHRASE_SPACE_W = 0.3
/** How long a word holds the accent before cooling to white. */
const PHRASE_SETTLE_SEC = 0.45

/**
 * Word stems that carry the weight of a devotional line: what the scene is
 * ABOUT rather than what is merely longest. Matched as prefixes, so the
 * inflections come free (mercy/merciful, humble/humbled/humbles).
 *
 * The first cut capitalised the longest content word, which is how "COLLECTOR"
 * came to shout over a line whose point is being made right with God (owner:
 * the emotionally or semantically stronger word should carry it). Emphasis now
 * goes to the strong word or to nothing at all, which is what keeps capitals
 * reading as emphasis.
 */
const PHRASE_STRONG_STEMS = [
  // mercy and sin
  "merc",
  "pity",
  "compassion",
  "sin",
  "guilt",
  "shame",
  "repent",
  "forgiv",
  "forgave",
  "pardon",
  "justif",
  "righteous",
  "grace",
  // the posture of the heart
  "humbl",
  "humili",
  "exalt",
  "proud",
  "pride",
  "boast",
  "heart",
  "honest",
  // God, and speaking to him
  "god",
  "lord",
  "jesus",
  "christ",
  "father",
  "heaven",
  "pray",
  "worship",
  "temple",
  "holy",
  "spirit",
  // life under God
  "love",
  "hope",
  "faith",
  "fear",
  "trust",
  "believ",
  "save",
  "salvation",
  "lost",
  "found",
  "free",
  "peace",
  "joy",
  "light",
  "dark",
  "life",
  "live",
  "death",
  "die",
  "dead",
  "born",
  "heal",
  "bless",
  "curse",
  "weep",
  "cry",
  "mourn",
  "rejoic",
  "kingdom",
  "truth",
] as const

const phraseStrength = (word: string): number => {
  for (const stem of PHRASE_STRONG_STEMS) {
    if (word === stem) return 3
    if (word.startsWith(stem)) return 2
  }
  return 0
}

/**
 * The word a phrase sets in caps: one at most, and only when the line has a
 * word worth the emphasis. The piece's theme word always wins; otherwise the
 * strongest word by meaning, and nothing at all when there is none.
 */
export function phraseStrongWords(
  tokens: readonly string[],
  themeWord?: string,
): Set<string> {
  const key = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "")
  const theme = themeWord ? key(themeWord) : null
  const out = new Set<string>()
  for (const t of tokens) if (theme && key(t) === theme) out.add(key(t))
  if (out.size > 0) return out
  let best: { word: string; score: number } | null = null
  for (const t of tokens) {
    const w = key(t)
    if (w.length < 3 || PHRASE_FUNCTION_WORDS.has(w)) continue
    const score = phraseStrength(w)
    if (score === 0) continue
    if (
      !best ||
      score > best.score ||
      (score === best.score && w.length > best.word.length)
    )
      best = { word: w, score }
  }
  if (best) out.add(best.word)
  return out
}

const phraseWordKey = (w: string) =>
  w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "")

/** When each word lands: fast build from the cue's start, then a long hold. */
export function phraseWordStarts(
  words: readonly string[],
  startSec: number,
): number[] {
  const out: number[] = []
  let t = startSec
  for (const w of words) {
    out.push(t)
    const step = Math.min(0.34, Math.max(0.15, 0.12 + 0.024 * w.length))
    t += step
  }
  return out
}

/**
 * Wrap the sized words into at most `PHRASE_MAX_LINES` lines inside the
 * spec's text width, shrinking both sizes 6% at a time until they fit.
 * Widths are estimated from the glyph advance rather than measured: the
 * render must not depend on a layout pass that Remotion does not give us.
 */
export function phraseLayout(
  words: readonly { token: string; size: number }[],
  maxWidth: number,
  maxLines = PHRASE_MAX_LINES,
): { scale: number; lines: { token: string; size: number }[][] } {
  const advance = (token: string) =>
    token === token.toUpperCase() ? PHRASE_CHAR_W_UPPER : PHRASE_CHAR_W_LOWER
  for (let step = 0; step < 12; step++) {
    const scale = Math.pow(0.94, step)
    const lines: { token: string; size: number }[][] = []
    let line: { token: string; size: number }[] = []
    let width = 0
    for (const w of words) {
      const size = w.size * scale
      const wordW = w.token.length * size * advance(w.token)
      const spaceW = line.length ? size * PHRASE_SPACE_W : 0
      if (line.length && width + spaceW + wordW > maxWidth) {
        lines.push(line)
        line = [{ ...w, size }]
        width = wordW
      } else {
        line.push({ ...w, size })
        width += spaceW + wordW
      }
    }
    if (line.length) lines.push(line)
    if (lines.length <= maxLines) return { scale, lines }
  }
  // Nothing fit in `maxLines` even at the smallest size. Wrapping at that size
  // and letting the block run an extra line is the lesser evil: the previous
  // fallback returned ONE line at FULL size, which ran off both edges of the
  // frame (owner-reported). A caption that is a line taller is still readable;
  // a caption with its ends cut off is not.
  const scale = Math.pow(0.94, 11)
  const lines: { token: string; size: number }[][] = []
  let line: { token: string; size: number }[] = []
  let width = 0
  for (const w of words) {
    const size = w.size * scale
    const wordW = w.token.length * size * advance(w.token)
    const spaceW = line.length ? size * PHRASE_SPACE_W : 0
    if (line.length && width + spaceW + wordW > maxWidth) {
      lines.push(line)
      line = [{ ...w, size }]
      width = wordW
    } else {
      line.push({ ...w, size })
      width += spaceW + wordW
    }
  }
  if (line.length) lines.push(line)
  return { scale, lines }
}

function PhraseCaption({
  cue,
  t,
  px,
  frameHeight,
  frameWidth,
  themeWord,
  wordStarts,
  strongWords,
  centreY,
}: {
  cue: { text: string; startSec: number; endSec: number }
  t: number
  px: (n: number) => number
  frameHeight: number
  frameWidth: number
  themeWord?: string
  /** Real word times (a narrated line): each word lands as it is SAID,
   *  instead of the paced build used for film captions. */
  wordStarts?: ReadonlyArray<number>
  /** Words to set large and keep gold, overriding the automatic pick. */
  strongWords?: ReadonlyArray<string>
  /** Vertical centre of the block, px of a 1920 frame (default 1060). */
  centreY?: number
}) {
  const tokens = cue.text.split(/\s+/).filter(Boolean)
  const starts =
    wordStarts && wordStarts.length === tokens.length
      ? [...wordStarts]
      : phraseWordStarts(tokens, cue.startSec)
  const unit = (pxOf1080: number) => (pxOf1080 / PHRASE_FRAME_PX.w) * REF
  const strong = strongWords?.length
    ? new Set(strongWords.map((w) => phraseWordKey(w)))
    : phraseStrongWords(tokens, themeWord)
  const sized = tokens.map((token) => {
    const k = phraseWordKey(token)
    if (strong.has(k))
      return { token: token.toUpperCase(), size: unit(PHRASE_STRONG_PX) }
    return {
      token,
      size: PHRASE_FUNCTION_WORDS.has(k)
        ? unit(PHRASE_FUNCTION_PX)
        : unit(PHRASE_CONTENT_PX),
    }
  })
  // The column is the spec's 820px in portrait; in the 16:9 cut the frame is
  // far wider than it is tall, so the same column in DESIGN units would run
  // nearly edge to edge. Cap it at a little over half the width THERE ONLY —
  // applied in portrait too, it cut the column to 605px and pushed long cues
  // into the layout's fallback, which set them as one line off both edges
  // (owner-reported on "I tell you, the tax collector…").
  const wideFrame = frameWidth > frameHeight
  const maxWidthUnits = Math.min(
    unit(PHRASE_MAX_WIDTH_PX),
    wideFrame && frameWidth > 0 ? (frameWidth * 0.56) / (px(1) || 1) : Infinity,
  )
  const { lines } = phraseLayout(sized, maxWidthUnits)
  let i = 0
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top:
          ((centreY ?? PHRASE_CENTRE_Y_PX) / PHRASE_FRAME_PX.h) * frameHeight,
        transform: "translateY(-50%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        pointerEvents: "none",
      }}
    >
      {lines.map((line, li) => {
        const largest = Math.max(...line.map((w) => w.size))
        return (
          <div
            key={li}
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "center",
              gap: px(largest * PHRASE_SPACE_W),
              height: px(largest) * 1.14,
            }}
          >
            {line.map((w) => {
              const start = starts[i++]
              // Words appear one at a time and STAY: already-shown words never
              // move, so the phrase cannot reflow while it is being read.
              const shown = t >= start
              // Each word LANDS in the accent and cools to white behind the
              // voice; the strong words keep the accent for the whole phrase.
              const isStrong = strong.has(phraseWordKey(w.token))
              const warm = isStrong
                ? 1
                : interpolate(t, [start, start + PHRASE_SETTLE_SEC], [1, 0], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                  })
              return (
                <span
                  key={`${li}-${w.token}-${start}`}
                  style={{
                    fontFamily: SERIF,
                    fontWeight: 500,
                    fontSize: px(w.size),
                    lineHeight: 1,
                    color: interpolateColors(
                      warm,
                      [0, 1],
                      ["#ffffff", "#F2C46B"],
                    ),
                    opacity: shown ? 1 : 0,
                    // Tight drop shadow only: no band, no stroke (owner tried
                    // both and rejected them).
                    textShadow: `0 ${px(unit(5))}px ${px(unit(8))}px rgba(0,0,0,0.84)`,
                    whiteSpace: "nowrap",
                  }}
                >
                  {w.token}
                </span>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Full-frame captions (clip-first): the column they live in and the line
 * their top edge hangs from. Both drawn by the owner on a frame: 60 units in
 * from either edge, top edge at 63.5% of the height (the first line's cap
 * height lands a touch under 64% with the leading).
 */
const FULL_BLEED_CAPTION_INSET_UNITS = 60
const FULL_BLEED_CAPTION_TOP = "63.5%"

function VideoSubtitles({
  cues,
  px,
  frame,
  fps,
  isLandscape,
  safeRight,
  safeBottom,
  fullBleed = false,
  style,
  captionStyle = "words",
  themeWord,
  frameHeight,
  frameWidth,
  bleedX = 0,
  hideBeforeSec = 0,
  karaokeMode = "karaoke",
}: {
  karaokeMode?: "karaoke" | "typewriter" | "ghost" | "scroll"
  cues: NonNullable<DevotionalCard["subtitles"]>
  style: DevotionalStyle
  captionStyle?: NonNullable<DevotionalCard["captionStyle"]>
  /** `phrase` captions only: the word held in the accent every time it shows. */
  themeWord?: string
  /** Frame height in px, so the phrase block can sit at the spec's y. */
  frameHeight?: number
  /** Frame width in px: the 16:9 cut keeps the column to part of the width. */
  frameWidth?: number
  /** Landscape: half the gap between the centred text column and the frame
   *  edges, so the caption's dim can bleed back out to the full frame. */
  bleedX?: number
  /** `hook` intro: nothing is on screen while the opening question is spoken,
   *  so the film's own captions start only once the scene is heard. */
  hideBeforeSec?: number
  px: (n: number) => number
  frame: number
  fps: number
  isLandscape: boolean
  /** Right inset that keeps captions clear of the action rail. */
  safeRight: number
  /** Portrait only: bottom inset clearing the social app's own UI chrome. */
  safeBottom: number
  /** Full-frame video (clip-first): captions sit over the lower part of the
   *  picture and grow UP from the safe bottom, instead of below a window. */
  fullBleed?: boolean
}) {
  const t = frame / fps
  const fade = 0.18
  const fullBleedInset = px(FULL_BLEED_CAPTION_INSET_UNITS)
  // A cue that would open mid-question is dropped whole rather than joined
  // late: a phrase arriving already half spoken reads as a glitch.
  const shown =
    hideBeforeSec > 0
      ? cues.filter((c) => c.startSec >= hideBeforeSec - 0.2)
      : cues
  cues = shown
  if (captionStyle === "phrase") {
    // One phrase at a time: the spec clears a phrase completely before the
    // next begins, so the cue whose window we are inside is the only one on
    // screen. Its own fade in/out keeps the change from being a hard pop.
    const cue = cues.find((c) => t >= c.startSec - fade && t <= c.endSec + fade)
    if (!cue) return null
    const opacity = interpolate(
      t,
      [cue.startSec - fade, cue.startSec, cue.endSec, cue.endSec + fade],
      [0, 1, 1, 0],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    )
    return (
      <AbsoluteFill style={{ opacity, pointerEvents: "none" }}>
        {/* A uniform dim of the whole frame for the caption's duration
            (owner's spec: rr=gg=bb=0.75), instead of a band behind the text.
            Landscape renders this inside the centred text column, so bleed it
            back out by the column inset or the dim shows as a rectangle. */}
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: -bleedX,
            right: -bleedX,
            background: "rgba(0,0,0,0.25)",
          }}
        />
        <PhraseCaption
          cue={cue}
          t={t}
          px={px}
          frameHeight={frameHeight ?? 0}
          frameWidth={frameWidth ?? 0}
          {...(themeWord ? { themeWord } : {})}
        />
      </AbsoluteFill>
    )
  }
  // 16:9 with verse addresses (Figma 366-2094): the captions lift to leave
  // room for a hairline and the address beneath them, and a soft dark
  // ellipse sits behind the whole block so the text reads over bright film.
  // The owner's scrolling-Scripture treatment (Figma 373-2235): the
  // narration as numbered verses under the chapter, scrolling upward.
  if (karaokeMode === "scroll" && isLandscape && !fullBleed) {
    return (
      <ScrollingScripture
        cues={cues}
        t={t}
        frameWidth={frameWidth ?? 1920}
        frameHeight={frameHeight ?? 1080}
        bleedX={bleedX}
      />
    )
  }
  // 9:16 (the film short cut from a LUMO devotional, feat-573): the same
  // scrolling verses, sized to the frame's width and hung in the blurred
  // band under the film window, where portrait captions already sit.
  // 9:16 short over full-frame film (owner's Figma 411-2366).
  if (karaokeMode === "scroll" && !isLandscape && fullBleed) {
    return (
      <ScrollingScripture
        cues={cues}
        t={t}
        frameWidth={frameWidth ?? 1080}
        frameHeight={frameHeight ?? 1920}
        layout="vertical"
      />
    )
  }
  if (karaokeMode === "scroll" && !isLandscape && !fullBleed) {
    const w = frameWidth ?? 1080
    const h = frameHeight ?? 1920
    return (
      <ScrollingScripture
        cues={cues}
        t={t}
        frameWidth={w}
        frameHeight={h}
        unit={w / 1080}
        topPx={(h * VIDEO_WINDOW_BOTTOM_PCT) / 100 + px(40)}
      />
    )
  }
  const withVerse =
    isLandscape && !fullBleed && cues.some((c) => c.verse != null)
  const first = cues[0]
  const last = cues[cues.length - 1]
  // The scrim and the address hold across the gaps between cues, so the
  // block never blinks off between two lines; only the verse number changes.
  const blockOpacity =
    withVerse && first && last
      ? interpolate(
          t,
          [
            first.startSec - fade,
            first.startSec,
            last.endSec,
            last.endSec + fade,
          ],
          [0, 1, 1, 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        )
      : 0
  const currentVerse = withVerse
    ? ([...cues].reverse().find((c) => t >= c.startSec - fade && c.verse)
        ?.verse ?? first?.verse)
    : undefined
  const captions = (
    <div
      style={{
        position: "absolute",
        // Full-frame: a symmetric column the owner drew on the frame; the
        // text never crosses it.
        left: fullBleed ? fullBleedInset : px(40),
        // Portrait: stop short of the right-hand action rail.
        right: fullBleed ? fullBleedInset : isLandscape ? px(40) : safeRight,
        // Portrait: start just below the video window's bottom edge — in the
        // space that used to sit empty, not over the picture. Landscape:
        // unchanged, the band sits over the blur in the lower-middle.
        top: isLandscape
          ? "45%"
          : fullBleed
            ? FULL_BLEED_CAPTION_TOP
            : `calc(${VIDEO_WINDOW_BOTTOM_PCT}% + ${px(16)}px)`,
        // 16:9: 40px higher than the old 78px (owner, 2026-09-26), in step
        // with the reflection text. With an address below: 201px at 1080p.
        bottom: isLandscape ? (withVerse ? px(67) : px(42.4)) : safeBottom,
        display: "flex",
        // Landscape keeps growing UP toward the picture above it. Portrait
        // has real space below the video, so cues grow DOWN into it. Full
        // frame: the owner wanted the TOP edge of the text pinned, so every
        // cue hangs from the same line however many lines it runs.
        alignItems: isLandscape ? "flex-end" : "flex-start",
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
        // Every cue is absolutely positioned in the SAME box, so adjacent
        // lines cross-fade in place instead of shifting. Anchored from
        // whichever edge the cues grow from.
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              ...(isLandscape ? { bottom: 0 } : { top: 0 }),
              display: "flex",
              justifyContent: "center",
              opacity,
            }}
          >
            <span
              style={{
                display: "inline-block",
                maxWidth: fullBleed ? "100%" : px(300),
                textAlign: "center",
                // Typewriter captions are set in Literata (owner, 2026-09-29):
                // typed text reads as a page, so it takes the book face.
                fontFamily:
                  karaokeMode === "typewriter" && c.words && !fullBleed
                    ? SERIF
                    : SANS,
                // Full frame: a size up (the film IS the hook), at the same
                // weight as the cards — 700 read as heavy over the picture.
                // Literata runs darker than Inter at the same number, so the
                // typewriter captions sit at the regular weight (owner, 2026-09-29).
                fontWeight:
                  karaokeMode === "typewriter" && c.words && !fullBleed
                    ? 400
                    : 600,
                fontSize: fullBleed ? px(26) : px(20),
                lineHeight: 1.3,
                color: "#f4efe8",
                // No pill/blur: matches the cards' plain-text treatment; the
                // shadow alone carries legibility over moving footage.
                textShadow:
                  "0 2px 12px rgba(0,0,0,0.9), 0 0 3px rgba(0,0,0,0.95)",
              }}
            >
              {fullBleed ? (
                // Word by word, in step with the line, each word flashing the
                // accent as it lands — the same reveal the reflection uses, so
                // the film's dialogue reads as part of the piece rather than
                // as a subtitle track. The clip's cues carry line timing only,
                // so word times are spread across the line by word length.
                <WordReveal
                  timings={spreadWords(c.text, c.startSec, c.endSec)}
                  frame={frame}
                  fps={fps}
                  audioDelaySec={0}
                  style={style}
                  restColor="#f4efe8"
                  {...(captionStyle === "words-lift"
                    ? { liftScale: WORDS_LIFT_SCALE }
                    : {})}
                />
              ) : c.words ? (
                <KaraokeLine
                  text={c.text}
                  starts={c.words}
                  endSec={c.endSec}
                  t={t}
                  restColor="#f4efe8"
                  mode={karaokeMode}
                />
              ) : (
                c.text
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
  if (!withVerse || blockOpacity <= 0) return captions
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "73%",
          width: px(262),
          height: px(158),
          transform: "translate(-50%, -50%)",
          borderRadius: "50%",
          background:
            "radial-gradient(closest-side, rgba(0,0,0,0.6), rgba(0,0,0,0))",
          filter: `blur(${px(13.3)}px)`,
          opacity: blockOpacity,
          pointerEvents: "none",
        }}
      />
      {captions}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: px(29),
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: px(6.67),
          opacity: blockOpacity,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            width: px(42),
            height: px(0.67),
            borderRadius: px(0.34),
            background: "#f2c46b",
            opacity: 0.5,
          }}
        />
        <div
          style={{
            fontFamily: SANS,
            fontWeight: 400,
            fontSize: px(9.33),
            lineHeight: `${px(16.67)}px`,
            color: "rgba(255,255,255,0.92)",
            opacity: 0.85,
            fontVariantNumeric: "tabular-nums",
            textShadow: "0 1px 8px rgba(0,0,0,0.8)",
            whiteSpace: "nowrap",
          }}
        >
          {currentVerse}
        </div>
      </div>
    </>
  )
}

/**
 * A film caption with the spoken word lit (owner, 2026-09-26): the whole line
 * stays up as before, in white, and the word being said turns gold with a
 * faint glow and grows slightly, karaoke style. (A gold pill behind the word
 * was tried first and dropped by the owner.) Word times come from the film's own audio (see the source's
 * `.words.json`); a line whose times do not match its words stays plain.
 */
function KaraokeLine({
  text,
  starts,
  endSec,
  t,
  restColor,
  mode = "karaoke",
}: {
  text: string
  starts: ReadonlyArray<number>
  endSec: number
  t: number
  restColor: string
  mode?: "karaoke" | "typewriter" | "ghost" | "scroll"
}) {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length !== starts.length) return <>{text}</>
  // A letter or word lighting up: in gold over a moment, cooling to white.
  const lightUp = (at: number, inSec: number) => ({
    on: interpolate(t, [at, at + inSec], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
    cool: interpolate(t, [at + inSec, at + inSec + 0.5], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  })
  if (mode === "typewriter") {
    // Each word is typed as it is said: its letters land one by one across
    // the first part of the word's time, each gold, then white. Letters not
    // yet typed keep their place (invisible), so the line never reflows.
    return (
      <>
        {words.map((w, i) => {
          const from = starts[i]
          const to = starts[i + 1] ?? endSec
          const step = Math.min(
            0.055,
            Math.max(0.02, ((to - from) / Math.max(1, w.length)) * 0.8),
          )
          return (
            <span key={i}>
              {[...w].map((ch, k) => {
                const { on, cool } = lightUp(from + k * step, 0.04)
                return (
                  <span
                    key={k}
                    style={{
                      opacity: on,
                      color: interpolateColors(
                        cool,
                        [0, 1],
                        ["#F2C46B", restColor],
                      ),
                    }}
                  >
                    {ch}
                  </span>
                )
              })}
              {i < words.length - 1 ? " " : ""}
            </span>
          )
        })}
      </>
    )
  }
  if (mode === "ghost") {
    // The whole line is there from the start, faint; each word lights gold
    // as it is said, then settles to white and stays white.
    return (
      <>
        {words.map((w, i) => {
          const { on, cool } = lightUp(starts[i] - 0.03, 0.12)
          const color =
            on < 1
              ? interpolateColors(
                  on,
                  [0, 1],
                  ["rgba(244,239,232,0.42)", "#F2C46B"],
                )
              : interpolateColors(cool, [0, 1], ["#F2C46B", restColor])
          return (
            <span key={i}>
              <span
                style={{
                  color,
                  // The caption's dark shadow would turn a faint word grey-black;
                  // an unsaid word keeps only a whisper of it, so it reads light.
                  ...(on < 1
                    ? {
                        textShadow: `0 1px 8px rgba(0,0,0,${(0.25 + 0.65 * on).toFixed(3)})`,
                      }
                    : {}),
                }}
              >
                {w}
              </span>
              {i < words.length - 1 ? " " : ""}
            </span>
          )
        })}
      </>
    )
  }
  // Long enough to read as a glide, short enough to keep up with speech.
  const EDGE = 0.12
  return (
    <>
      {words.map((w, i) => {
        const from = starts[i]
        const to = starts[i + 1] ?? endSec
        // Up quickly as the word begins, down as the next one takes over.
        // Always a glide, never a switch: a short word gets a shorter edge
        // rather than a hard cut (hard cuts read as the word jumping).
        const edge = Math.max(0.03, Math.min(EDGE, (to - from) / 3))
        const lit = interpolate(
          t,
          [from - edge, from, to - edge, to],
          [0, 1, 1, 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        )
        // The word itself turns gold, with a faint glow, and grows a touch
        // (owner, 2026-09-28: no pill behind it, no jumps). The growth is a
        // transform, which never re-lays the line, so neighbours stay put.
        const glow = lit
        return (
          <span key={i}>
            <span
              style={{
                display: "inline-block",
                // A constant side margin keeps the gap visible when the lit
                // word grows; constant, so no word ever reflows.
                margin: "0 0.05em",
                transform: `scale(${(1 + 0.04 * lit).toFixed(4)})`,
                transformOrigin: "50% 70%",
                color: interpolateColors(lit, [0, 1], [restColor, "#F2C46B"]),
                ...(glow > 0.01
                  ? {
                      textShadow:
                        `0 0 0.18em rgba(242,196,107,${(0.45 * glow).toFixed(3)}), ` +
                        "0 2px 12px rgba(0,0,0,0.9), 0 0 3px rgba(0,0,0,0.95)",
                    }
                  : {}),
              }}
            >
              {w}
            </span>
            {i < words.length - 1 ? " " : ""}
          </span>
        )
      })}
    </>
  )
}

type SpokenWord = { word: string; startSec: number; endSec: number }

/** Strip punctuation/case so a spoken word can be matched to an on-screen one. */
const wordKey = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "")

/**
 * Line up the card's VISIBLE text against the narration's spoken words.
 *
 * The two are not the same list: the spoken segment carries connectors the
 * screen never shows ("Reflect on this.", "Here's where we're reading
 * today."), so using the raw alignment would start the reveal several words
 * early and drift for the whole card. This finds where the visible text sits
 * inside the spoken sequence and returns one timing per visible token, or null
 * when it cannot line them up — in which case the caller keeps its old
 * pace-based reveal rather than showing words against wrong times.
 */
function alignWordsToText(
  text: string,
  spoken: SpokenWord[],
): { token: string; startSec: number; endSec: number }[] | null {
  const tokens = text.split(/\s+/).filter(Boolean)
  if (tokens.length === 0 || spoken.length === 0) return null
  const tKeys = tokens.map(wordKey)
  const sKeys = spoken.map((s) => wordKey(s.word))
  const firstReal = tKeys.findIndex((k) => k.length > 0)
  if (firstReal === -1) return null
  for (let offset = 0; offset + tokens.length <= spoken.length; offset++) {
    let ok = true
    for (let i = 0; i < tKeys.length; i++) {
      if (!tKeys[i]) continue // punctuation-only token matches anything
      if (sKeys[offset + i] !== tKeys[i]) {
        ok = false
        break
      }
    }
    if (ok) {
      return tokens.map((token, i) => ({
        token,
        startSec: spoken[offset + i].startSec,
        endSec: spoken[offset + i].endSec,
      }))
    }
  }
  return null
}

/**
 * Reveal a sentence word by word, each word appearing exactly when the voice
 * says it (real ElevenLabs alignment), and staying up so the sentence builds.
 *
 * Each word also lands in the accent colour and cools to `restColor` over
 * ACCENT_SETTLE_SEC, so the word being spoken is the one the eye goes to. The
 * highlight phrase is exempt — it keeps the accent for good, which is the whole
 * point of a highlight.
 */
const ACCENT_SETTLE_SEC = 0.42
/** `words-lift` captions: how much larger the word being spoken lands. */
const WORDS_LIFT_SCALE = 1.1

function WordReveal({
  timings,
  frame,
  fps,
  audioDelaySec,
  highlight,
  style,
  restColor,
  preOpacity = 0,
  liftScale,
}: {
  timings: { token: string; startSec: number; endSec?: number }[]
  frame: number
  fps: number
  audioDelaySec: number
  highlight?: string
  style: DevotionalStyle
  /** Colour a word settles to. Omit to leave the inherited colour alone (no
   *  accent flash) — needed for callers whose text colour is not a plain hex
   *  that `interpolateColors` can read. */
  restColor?: string
  /**
   * Opacity of a word BEFORE the voice reaches it. 0 (default) is the reveal:
   * the sentence builds word by word. Above 0 the whole line is on screen from
   * the start, faint, and the voice fills it in — the treatment the owner
   * asked for on the stepper's opening line, where the line has to be readable
   * before it is read.
   */
  preOpacity?: number
  /**
   * Lift the word being spoken: it lands this many times its size and eases
   * back to 1 on the same curve as the accent, so colour and size settle
   * together. A transform from the word's left edge, so the line never
   * reflows; the extra width lands over the words not yet revealed.
   */
  liftScale?: number
}) {
  const t = frame / fps - audioDelaySec
  const hlKeys = new Set(
    (highlight ?? "").split(/\s+/).map(wordKey).filter(Boolean),
  )
  return (
    <>
      {timings.map((w, i) => {
        const opacity = interpolate(
          t,
          [w.startSec - 0.06, w.startSec + 0.12],
          [preOpacity, 1],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        )
        const inHl = hlKeys.size > 0 && hlKeys.has(wordKey(w.token))
        // How ACCENT-coloured the word is right now: warms as the voice
        // reaches it, cools back to `restColor` over ACCENT_SETTLE_SEC.
        //
        // Expressed as warm-from-rest rather than cool-from-accent because a
        // word that is on screen BEFORE it is spoken (preOpacity > 0) must
        // start in the rest colour — under the old form every unspoken word sat
        // there in dim gold.
        const clampBoth = {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        } as const
        const warm = restColor
          ? Math.min(
              interpolate(
                t,
                [w.startSec - 0.06, w.startSec + 0.06],
                [0, 1],
                clampBoth,
              ),
              interpolate(
                t,
                [w.startSec + 0.06, w.startSec + 0.06 + ACCENT_SETTLE_SEC],
                [1, 0],
                clampBoth,
              ),
            )
          : 0
        const colour = inHl
          ? {
              color: style.highlight,
              fontStyle: style.highlightItalic ? "italic" : undefined,
            }
          : restColor
            ? {
                color: interpolateColors(
                  warm,
                  [0, 1],
                  [restColor, style.eyebrow],
                ),
              }
            : {}
        if (liftScale != null) {
          // The space sits outside the scaled span so the line still wraps
          // there and the lift never stretches a gap.
          return (
            <Fragment key={i}>
              <span
                style={{
                  display: "inline-block",
                  opacity,
                  transform: `scale(${1 + (liftScale - 1) * warm})`,
                  transformOrigin: "left bottom",
                  ...colour,
                }}
              >
                {w.token}
              </span>
              {i < timings.length - 1 ? " " : ""}
            </Fragment>
          )
        }
        return (
          <span key={i} style={{ opacity, ...colour }}>
            {w.token}
            {i < timings.length - 1 ? " " : ""}
          </span>
        )
      })}
    </>
  )
}

/** The film short's opening question types in at this pace (quick). */
const TYPE_CHARS_PER_SEC = 28

/**
 * The film short's silent question cards (owner, 2026-10-02): a question
 * before the scene speaks ("Is this worth celebrating?") and a turn after it
 * ends ("But someone had a good reason to stay outside."), stamped like the
 * reflection's short lines, centred in the safe column over a dimmed film.
 */
function ShortQuestionCards({
  cards,
  t,
  frameWidth,
}: {
  cards: NonNullable<DevotionalInputProps["shortCards"]>
  t: number
  frameWidth: number
}) {
  const f = (n: number) => (n * frameWidth) / 900
  const card = (
    text: string,
    fromSec: number,
    toSec: number | null,
    key: string,
    sharp = false,
    sub?: string,
  ) => {
    if (t < fromSec - 0.05 || (toSec != null && t > toSec + 0.05)) return null
    const fade =
      toSec == null
        ? 1
        : interpolate(t, [toSec - 0.3, toSec], [1, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })
    const dim = interpolate(t, [fromSec - 0.05, fromSec + 0.4], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
    return (
      <AbsoluteFill key={key} style={{ opacity: fade, pointerEvents: "none" }}>
        <AbsoluteFill
          style={{ background: `rgba(0,0,0,${(text ? 0.4 : 0.25) * dim})` }}
        />
        <AbsoluteFill
          style={{ justifyContent: "center", alignItems: "center" }}
        >
          <div style={{ width: f(640) }}>
            {!text ? null : sharp ? (
              // Typed in, letter by letter, quickly (owner, 2026-10-05), and
              // a size down from the stamp so it sits with the verses. The
              // whole line is laid out from the start (unshown letters are
              // transparent), so it never re-centres or re-wraps as it types.
              <p
                style={{
                  margin: 0,
                  fontFamily: `'${SHORT_FONT_FAMILIES.inter}', -apple-system, system-ui, sans-serif`,
                  fontWeight: 600,
                  fontSize: f(56),
                  lineHeight: 1.25,
                  letterSpacing: f(2.4),
                  textTransform: "uppercase",
                  textAlign: "center",
                  color: "#fff",
                  textShadow: `0 ${f(2)}px ${f(16)}px rgba(0,0,0,0.55)`,
                }}
              >
                {[...text].map((ch, i) => (
                  <span
                    key={i}
                    style={{
                      opacity: interpolate(
                        t - fromSec,
                        [i / TYPE_CHARS_PER_SEC, i / TYPE_CHARS_PER_SEC + 0.06],
                        [0, 1],
                        { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
                      ),
                    }}
                  >
                    {ch}
                  </span>
                ))}
              </p>
            ) : (
              <StampLine text={text} t={t - fromSec} f={f} sharp={false} />
            )}
            {sub ? (
              // Set like the scrolling verses' address ("Luke 15:22-24"):
              // PT Serif italic 32, at 85%; it eases in a beat after the
              // turn so the two never arrive together.
              <p
                style={{
                  margin: text ? `${f(28)}px 0 0` : 0,
                  fontFamily: `'${SHORT_FONT_FAMILIES.ptSerif}', Georgia, serif`,
                  fontStyle: "italic",
                  fontSize: f(32),
                  lineHeight: `${f(50)}px`,
                  textAlign: "center",
                  color: "rgba(255,255,255,0.92)",
                  opacity:
                    0.85 *
                    interpolate(
                      t - fromSec,
                      text ? [1.0, 1.8] : [0.1, 0.9],
                      [0, 1],
                      {
                        extrapolateLeft: "clamp",
                        extrapolateRight: "clamp",
                      },
                    ),
                  textShadow: `0 ${f(2)}px ${f(14)}px rgba(0,0,0,0.55)`,
                }}
              >
                {sub}
              </p>
            ) : null}
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
    )
  }
  return (
    <>
      {cards.open
        ? card(
            cards.open.text,
            cards.open.fromSec,
            cards.open.toSec,
            "open",
            // The question hits; the closing turn eases in.
            true,
          )
        : null}
      {cards.close
        ? card(
            cards.close.text,
            cards.close.fromSec,
            null,
            "close",
            false,
            cards.close.sub,
          )
        : null}
    </>
  )
}

/**
 * The series mark over a short (owner's Figma 411-2366, a 900 x 1600 frame):
 * the book mark, 24 below it the name in Inter Medium 25 tracked 5, the pair
 * centred with its top at 230. Figma px are converted through px(), whose
 * unit is the short side / 390 (so 900 Figma px = 390 units).
 */
function ShortBrand({ px }: { px: (n: number) => number }) {
  const f = (n: number) => px((n * 390) / 900)
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: f(230),
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: f(24),
        pointerEvents: "none",
      }}
    >
      <PauseMark size={f(49.338)} />
      <div
        style={{
          fontFamily: SANS,
          fontWeight: 500,
          fontSize: f(25),
          letterSpacing: f(5),
          color: "#fff",
          whiteSpace: "nowrap",
          textShadow: "0 1px 10px rgba(0,0,0,0.45)",
        }}
      >
        DAILY BIBLE PAUSE
      </div>
    </div>
  )
}

/**
 * The Daily Bible Pause mark: two leaves of an open book, as drawn in the
 * owner's Figma (60 x 54 box, 3-unit stroke). Screen-blended like the source.
 */
function PauseMark({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={(size * 54.3229) / 60}
      viewBox="0 0 60 54.3229"
      fill="none"
      style={{ display: "block", mixBlendMode: "screen", opacity: 0.75 }}
    >
      <path
        d="M22.7353 6.69586C22.7353 5.5387 21.9013 4.54996 20.7607 4.35486L4.27543 1.535C2.82479 1.28687 1.5 2.40429 1.5 3.876V50.4456C1.5 52.0221 3.00785 53.1611 4.52433 52.7301L21.0096 48.0445C22.0308 47.7542 22.7353 46.8216 22.7353 45.76V6.69586Z"
        stroke="#FFF6F1"
        strokeWidth={3}
      />
      <path
        d="M37.2646 6.69586C37.2646 5.5387 38.0986 4.54996 39.2392 4.35486L55.7245 1.535C57.1751 1.28687 58.4999 2.40429 58.4999 3.876V50.4456C58.4999 52.0221 56.9921 53.1611 55.4756 52.7301L38.9903 48.0445C37.9691 47.7542 37.2646 46.8216 37.2646 45.76V6.69586Z"
        stroke="#FFF6F1"
        strokeWidth={3}
      />
    </svg>
  )
}

/**
 * The clip-first opening, over the film's silent lead. Two designs from the
 * owner's Figma, both there to say "this is a devotional, not a stray film
 * clip" before the film speaks:
 *
 * `cover`: mark, series name and rounded length at the top, the three steps in
 * a column over the darkened film with WATCH already lit. As the sound comes
 * in, REFLECT, PRAY, the rails and the scrim leave; WATCH, the mark and the
 * length stay a second longer over the speaking film, then fade.
 *
 * `bands`: the frame split into three bands. The top band is the live film
 * in colour with WATCH lit; the two below are the same film, desaturated,
 * carrying REFLECT and PRAY. The WATCH band grows down to take the frame,
 * the others closing under it, then the mark and length fade slowly.
 *
 * Every time is a share of the lead so a different lead keeps the shape.
 */
const INTRO_GOLD = "#f2c46b"
/** How long the intro's header and WATCH stay after the film's silent lead. */
export const INTRO_HEADER_HOLD_SEC = 1.0
export const INTRO_HEADER_FADE_SEC = 0.6
/** WATCH leaves before the header does (owner: take it away a little sooner). */
const INTRO_WATCH_HOLD_SEC = 0.15
const INTRO_WATCH_FADE_SEC = 0.5
/** `hook`: how dark the film sits while the opening question is spoken. Deep
 *  enough that the voice owns the moment, light enough that the scene reads. */
const INTRO_HOOK_SCRIM = 0.45
/** `hook`: how loud the film's own sound is under the spoken question. */
const INTRO_HOOK_FILM_DUCK = 0.12
/** `hook`: the question is set at the cover's title size — it IS the title. */
const HOOK_TITLE_PX = 29.3
/** `hook`: the title starts leaving this long BEFORE the scene speaks, and
 *  takes this long to go — so nothing of the opening is still on screen when
 *  the film's own captions start (owner: the question runs in full first). */
const HOOK_TITLE_OUT_BEFORE_SEC = 1.3
const HOOK_TITLE_FADE_SEC = 0.7

/**
 * When each sentence of the spoken opening starts and ends, taken from the
 * narration's own word times rather than guessed: the logo, the title and the
 * invitation are three beats of one recording, so they have to move with it.
 */
export function introPartTimes(
  parts: ReadonlyArray<string>,
  words: ReadonlyArray<{ word: string; startSec: number; endSec: number }>,
): Array<{ from: number; to: number }> {
  if (parts.length === 0 || words.length === 0) return []
  const out: Array<{ from: number; to: number }> = []
  let i = 0
  for (const part of parts) {
    const count = part.split(/\s+/).filter(Boolean).length
    const slice = words.slice(i, i + count)
    if (slice.length === 0) break
    out.push({
      from: slice[0].startSec,
      to: slice[slice.length - 1].endSec,
    })
    i += count
  }
  return out
}

/**
 * `montage`: when each spoken line starts, from the narration's word times
 * (the pipeline cuts the shots on exactly these instants). Lines are counted
 * in words, as the pipeline counts them.
 */
export function montageLineStarts(
  parts: ReadonlyArray<string>,
  words: ReadonlyArray<{ startSec: number }>,
  leadSec: number,
): number[] {
  const lines = parts.filter(Boolean)
  const out: number[] = []
  let at = 0
  lines.forEach((line, i) => {
    out.push(words[at]?.startSec ?? (leadSec * i) / Math.max(1, lines.length))
    at += line.split(/\s+/).filter(Boolean).length
  })
  return out
}

/** `montage`: the horizontal focus (0..1) of the shot on screen at `t`. After
 *  the last cut (the scene itself) it holds the last value given. */
function montageFocusAt(
  t: number,
  starts: ReadonlyArray<number>,
  focus: ReadonlyArray<number>,
): number {
  const cuts = starts.slice(0, -1)
  let k = 0
  while (k + 1 < cuts.length && t >= cuts[k + 1]) k++
  if (starts.length > 1 && t >= starts[starts.length - 1]) k = focus.length - 1
  return focus[Math.min(k, focus.length - 1)] ?? 0.5
}

/** `montage`: a slow push-in across each shot (1 → 1.045), eased, restarting
 *  on every cut, except the first shot, which breathes out then in. 1 outside
 *  the lead. */
function montagePush(
  t: number,
  starts: ReadonlyArray<number>,
  leadSec: number,
): number {
  if (starts.length < 2 || t >= leadSec) return 1
  // The last line is the scene itself; the shots are the lines before it.
  const cuts = starts.slice(0, -1)
  let k = 0
  while (k + 1 < cuts.length && t >= cuts[k + 1]) k++
  const from = k === 0 ? 0 : cuts[k]
  const to = k + 1 < cuts.length ? cuts[k + 1] : leadSec
  const p = Math.max(0, Math.min(1, (t - from) / Math.max(0.1, to - from)))
  const ease = Easing.bezier(0.33, 0, 0.67, 1)
  // The FIRST shot breathes: it opens a little close, eases back, then eases
  // in again, the way podcast openings move (owner, 2026-10-06, after a Lenny's
  // Podcast intro: "first pulling the video away a little, then bringing it
  // closer"). 1.16 → 1.0 at 45% of the shot → 1.12: at 8% it vanished under
  // the film's own camera move (owner could not see it, 2026-10-06).
  if (k === 0) {
    const turn = 0.45
    return p < turn
      ? 1.16 - 0.16 * ease(p / turn)
      : 1 + 0.12 * ease((p - turn) / (1 - turn))
  }
  return 1 + 0.045 * ease(p)
}

/** `montage`: "Let's watch", WATCH and the passage sit over the last shot
 *  while it is still muted, the picture softly blurred behind them (owner,
 *  2026-09-30); the blur lifts as the film is heard. */
function montageWatchBlur(
  t: number,
  starts: ReadonlyArray<number>,
  leadSec: number,
  maxPx: number,
): number {
  if (starts.length < 2) return 0
  const watchAt = starts[starts.length - 1]
  if (leadSec - watchAt < 1) return 0
  return interpolate(
    t,
    [watchAt - 0.2, watchAt + 0.5, leadSec - 0.2, leadSec + 0.5],
    [0, maxPx, maxPx, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  )
}

/**
 * The passage the scene reads, over the big WATCH as the film begins (owner,
 * 2026-09-28): Literata at 48px on a 1920 frame, a slow push in, and it
 * dissolves a little after WATCH does. `t` is seconds since WATCH began.
 */
function WatchPassage({
  text,
  t,
  watchSec,
  px,
}: {
  text: string
  t: number
  watchSec: number
  px: (n: number) => number
}) {
  const total = watchSec + 0.5
  const opacity = interpolate(
    t,
    [0.15, 1.0, total - 1.0, total],
    [0, 1, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.42, 0, 0.58, 1),
    },
  )
  if (opacity <= 0) return null
  const scale = interpolate(t, [0, total], [1, 1.06], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          fontFamily: SERIF,
          fontWeight: 400,
          fontSize: px(48 / 2.7692),
          color: "#ffffff",
          whiteSpace: "nowrap",
          textShadow: `0 ${px(1)}px ${px(14)}px rgba(0,0,0,0.55)`,
          opacity,
          transform: `scale(${scale.toFixed(4)})`,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  )
}

function ClipIntro({
  variant,
  leadSec,
  frame,
  fps,
  px,
  steps,
  pieceSec,
  clipSrc,
  frameWidth,
  frameHeight,
  bleedX = 0,
  hookText,
  parts = [],
  introWords = [],
  framed = false,
  captions = [],
  passageRef,
  ctaText,
  cta = false,
  ctaCalm = false,
  kinetic = [],
  kicker = "IN THIS DEVOTIONAL",
}: {
  variant: "cover" | "bands" | "hook" | "watch" | "opening" | "montage"
  leadSec: number
  frame: number
  fps: number
  px: (n: number) => number
  style: DevotionalStyle
  steps: ReadonlyArray<string>
  pieceSec: number
  clipSrc: string | null
  /** Frame size in px: the 16:9 cut is short, so the column centres on it. */
  frameWidth: number
  frameHeight: number
  /** Landscape: the inset of the centred text column this intro renders in,
   *  so its scrim and bands can reach the real frame edges. */
  bleedX?: number
  /** `hook`: the question, shown as the piece's title while it is spoken —
   *  a feed preview plays muted, so the hook cannot live in the voice alone. */
  hookText?: string
  /** `watch`: the opening's sentences, and the narration's word times. */
  parts?: ReadonlyArray<string>
  introWords?: ReadonlyArray<{
    word: string
    startSec: number
    endSec: number
  }>
  /** `opening`: the first and last parts are the spoken welcome and "Let's
   *  watch" (see the manifest's `introFrame`). */
  framed?: boolean
  /** `montage`: captions on chosen spoken lines. */
  captions?: ReadonlyArray<{ line: number; text: string; lead?: string }>
  /** The passage the scene reads, drawn over WATCH. */
  passageRef?: string
  /** `montage` teaser: the last line is a call to action, not "Let's watch". */
  /** The call to action shown in place of the last line (silent CTA). */
  ctaText?: string
  cta?: boolean
  /** Teaser: close on one quiet centred line (see CalmCallToAction). */
  ctaCalm?: boolean
  /** `montage`: the words under the Jesus Film mark, in the film's language. */
  kicker?: string
  /** `montage`: kinetic captions per line, the "stack" layout (owner's pick,
   *  2026-09-30). When set, they replace the small line + big caption. */
  kinetic?: ReadonlyArray<{
    line: number
    hero: string
    accents: ReadonlyArray<string>
    side: "left" | "right"
  }>
}) {
  const bleed = {
    position: "absolute" as const,
    top: 0,
    bottom: 0,
    left: -bleedX,
    right: -bleedX,
  }
  const t = frame / fps
  const L = leadSec
  const clampBoth = {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  } as const
  const ease = Easing.bezier(0.42, 0, 0.58, 1)
  const minutes = Math.max(1, Math.round(pieceSec / 60))
  const timeLabel = `- ${minutes} min -`

  // Header: mark, series name, length. Settles into place from a little
  // above (owner) and leaves last, a second after the film has taken over.
  const headerIn = interpolate(t, [0, 0.7], [0, 1], {
    ...clampBoth,
    easing: ease,
  })
  // Settles down from a little above; the length follows the name a beat
  // later, a touch of parallax (owner).
  const timeIn = interpolate(t, [0.18, 0.95], [0, 1], {
    ...clampBoth,
    easing: ease,
  })
  const headerDrop = -px(16) * (1 - headerIn)
  const timeDrop = -px(12) * (1 - timeIn)
  const headerHold = L + INTRO_HEADER_HOLD_SEC
  const headerOutSec = variant === "cover" ? INTRO_HEADER_FADE_SEC : 1.2
  const headerOut = interpolate(
    t,
    [headerHold, headerHold + headerOutSec],
    [1, 0],
    clampBoth,
  )
  const headerOpacity = headerIn * headerOut
  const header =
    headerOpacity > 0 ? (
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: "13.4%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: px(5),
          opacity: headerOpacity,
          transform: `translateY(${headerDrop}px)`,
          pointerEvents: "none",
        }}
      >
        <PauseMark size={px(25)} />
        <div
          style={{
            fontFamily: SANS,
            fontWeight: 400,
            fontSize: px(15.6),
            letterSpacing: px(1.5),
            color: "rgba(255,255,255,0.72)",
            whiteSpace: "nowrap",
          }}
        >
          DAILY BIBLE PAUSE
        </div>
        <div
          style={{
            marginTop: px(8),
            fontFamily: SERIF,
            fontWeight: 500,
            fontSize: px(15.6),
            color: INTRO_GOLD,
            whiteSpace: "nowrap",
            opacity: headerIn > 0 ? timeIn / headerIn : 0,
            transform: `translateY(${timeDrop}px)`,
          }}
        >
          {timeLabel}
        </div>
      </div>
    ) : null

  const label = (gold: boolean, size: number) => ({
    fontFamily: SANS,
    fontWeight: 600,
    fontSize: px(size),
    letterSpacing: px(size * 0.14),
    color: gold ? INTRO_GOLD : "#ffffff",
    whiteSpace: "nowrap" as const,
    textShadow: "0 1px 8px rgba(0,0,0,0.45)",
  })

  if (variant === "montage") {
    // The film's own shots, one per spoken line and cut on its first word
    // (the cuts are in the footage, built by the pipeline from the narration's
    // word times; each shot also pushes in slowly, see montagePush). Over them
    // only what the owner scripted (2026-09-28): the contrast in big caps on
    // the lines that carry it (THEY WORKED ALL DAY / ONE HOUR / THE SAME PAY),
    // nothing big on the question, the whole narration as a subtitle below, and
    // WATCH across the frame at a whisper as the voice says "Let's watch" and
    // the scene begins. No answer is given here.
    const lines = parts.filter(Boolean)
    const starts = montageLineStarts(lines, introWords, L)
    const watchAt = starts.length > 1 ? starts[starts.length - 1] : L
    // The last line ("Let's watch.") is said as the scene begins; its subtitle
    // stays through it, over the film's first quiet seconds.
    const lineEnd = (i: number) =>
      i + 1 < starts.length ? starts[i + 1] : Math.max(L, watchAt + 1.3)
    // Calm and a little mysterious at first: a deeper scrim on the first shot
    // that eases as the contrast begins, and gone once the film has the frame.
    // With WATCH over the muted last shot (not the teaser), a lighter dim
    // holds until the film is heard.
    const scrim =
      !cta && L - watchAt >= 1
        ? interpolate(
            t,
            [0, starts[1] ?? 2, watchAt, L - 0.2, L + 0.5],
            [0.42, 0.26, 0.26, 0.2, 0],
            clampBoth,
          )
        : interpolate(
            t,
            [0, starts[1] ?? 2, watchAt, watchAt + 0.8],
            [0.42, 0.26, 0.26, 0],
            clampBoth,
          )
    const watchFrom = watchAt - 0.15
    const watchFrames = Math.max(1, Math.round(2.6 * fps))
    // The narration as a subtitle, one line at a time, the spoken word lit —
    // the same treatment as the film's own captions that follow, so the two
    // read as one piece.
    const wordStarts = introWords.map((w) => w.startSec)
    let wi = 0
    const subtitles = lines.map((line, i) => {
      const n = line.split(/\s+/).filter(Boolean).length
      const ws = wordStarts.slice(wi, wi + n)
      wi += n
      return { i, line, ws }
    })
    const wide = frameWidth > frameHeight
    // VERTICAL TEASER (owner, 2026-09-29): the same shots and voice, the
    // narration set as the compact phrase captions (words of different sizes,
    // the contrast words large and gold), and the last line is a call to watch
    // the full devotional on YouTube instead of "Let's watch".
    // VERTICAL TEASER with kinetic captions (owner, 2026-09-30): the same
    // opening as the 16:9 cut, the words in the "stack" arrangement set low
    // in the 9:16 frame, and the last line a call to watch the full
    // devotional, which holds to the end.
    if (cta && !wide && kinetic.length) {
      const lastLine = lines.length - 1
      const markOut = interpolate(
        t,
        [starts[lastLine] - 0.8, starts[lastLine] - 0.1],
        [1, 0],
        { ...clampBoth, easing: ease },
      )
      // The mark comes back, settled, over the call to action, so the
      // channel it names is on screen (owner, 2026-10-05).
      const markBack = interpolate(
        t,
        [starts[lastLine] + 0.2, starts[lastLine] + 0.9],
        [0, 1],
        { ...clampBoth, easing: ease },
      )
      const markOn = Math.max(markOut, markBack)
      // "DAILY BIBLE PAUSE" settles under the mark once the long lockup has
      // shrunk into the small symbol (the morph ends at 0.82 of its span).
      const seriesIn =
        markBack > 0
          ? 1
          : interpolate(t, [3.6 * 0.82 + 0.15, 3.6 * 0.82 + 0.75], [0, 1], {
              ...clampBoth,
              easing: ease,
            })
      return (
        <div style={{ ...bleed, pointerEvents: "none" }}>
          <AbsoluteFill style={{ background: "rgba(0,0,0,0.25)" }} />
          {markOn > 0 ? (
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: "9%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: px(8),
                opacity: markOn,
              }}
            >
              {/* A soft dark ellipse so the small mark and its name hold
                  over bright film. */}
              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  top: px(-8),
                  width: px(240),
                  height: px(80),
                  transform: "translateX(-50%)",
                  borderRadius: "50%",
                  background:
                    "radial-gradient(closest-side, rgba(0,0,0,0.5), rgba(0,0,0,0))",
                  filter: `blur(${px(7)}px)`,
                }}
              />
              <AnimatedBrandMark
                px={(n) => px(n * 1.15)}
                frame={
                  markBack > 0 ? Math.max(frame, Math.round(3.6 * fps)) : frame
                }
                fps={fps}
                spanSec={3.6}
              />
              <div
                style={{
                  fontFamily: SANS,
                  fontWeight: 500,
                  fontSize: px(11),
                  letterSpacing: px(2.2 + 1.2 * (1 - seriesIn)),
                  textTransform: "uppercase",
                  color: "rgba(255,255,255,0.8)",
                  whiteSpace: "nowrap",
                  opacity: seriesIn,
                  transform: `translateY(${(-px(5) * (1 - seriesIn)).toFixed(1)}px)`,
                  textShadow: `0 ${px(1)}px ${px(10)}px rgba(0,0,0,0.5)`,
                }}
              >
                Daily Bible Pause
              </div>
            </div>
          ) : null}
          {subtitles.map(({ i, line, ws }) => {
            const from = starts[i]
            const isLast = i === lastLine
            const to = isLast ? L + 600 : lineEnd(i)
            const spec = kinetic.find((k) => k.line === i)
            const out = isLast
              ? 1
              : interpolate(t, [to - 0.35, to - 0.02], [1, 0], {
                  ...clampBoth,
                  easing: ease,
                })
            if (t < from - 0.1 || out <= 0) return null
            const side = spec?.side ?? "left"
            if (isLast && ctaCalm) {
              return (
                <AbsoluteFill key={i}>
                  <AbsoluteFill
                    style={{
                      background:
                        "linear-gradient(0deg, rgba(0,0,0,0.5), rgba(0,0,0,0.15) 50%, rgba(0,0,0,0) 75%)",
                    }}
                  />
                  <CalmCallToAction
                    line={ctaText ?? line}
                    time={t - from}
                    px={px}
                    maxWidth={frameWidth * 0.8}
                  />
                </AbsoluteFill>
              )
            }
            return (
              <AbsoluteFill key={i} style={{ opacity: out }}>
                <AbsoluteFill
                  style={{
                    background:
                      "linear-gradient(0deg, rgba(0,0,0,0.55), rgba(0,0,0,0.12) 45%, rgba(0,0,0,0) 70%)",
                  }}
                />
                <KineticCaption
                  line={line}
                  hero={spec?.hero ?? ""}
                  accents={spec?.accents ?? []}
                  starts={ws.map((w) => w - from)}
                  time={t - from}
                  layout="stack"
                  px={(n) => px((n * 390) / 360)}
                  side={side}
                  portrait
                  // Inside the platforms' safe area (owner, 2026-10-05: right
                  // blocks ran under the action rail, x > 940 of 1080): every
                  // block ends by x = 920, a right-hand one anchored there.
                  maxWidth={frameWidth * (920 / 1080) - px((28 * 390) / 360)}
                  rightInset={frameWidth * (160 / 1080)}
                  sizes={{ hero: 1.3, accent: 1.4, plain: 1.6 }}
                />
              </AbsoluteFill>
            )
          })}
        </div>
      )
    }
    if (cta && !wide) {
      const last = lines.length - 1
      return (
        <div style={{ ...bleed, pointerEvents: "none" }}>
          {/* One even dim for the whole teaser (house style: no band). */}
          <AbsoluteFill style={{ background: "rgba(0,0,0,0.25)" }} />
          {subtitles.map(({ i, line, ws }) => {
            const from = starts[i]
            if (i === last) {
              // The call to action fades up and holds.
              const o = interpolate(t, [from - 0.1, from + 1.2], [0, 1], {
                ...clampBoth,
                easing: ease,
              })
              if (o <= 0) return null
              return (
                <AbsoluteFill key={i} style={{ opacity: o }}>
                  <PhraseCaption
                    cue={{ text: line, startSec: from - 10, endSec: from + 60 }}
                    t={t}
                    px={px}
                    frameHeight={frameHeight}
                    frameWidth={frameWidth}
                    wordStarts={ws.map(() => from - 10)}
                    strongWords={["YouTube"]}
                    centreY={960}
                  />
                </AbsoluteFill>
              )
            }
            const to = lineEnd(i)
            const cap = captions.find((c) => c.line === i)
            // A long line is set as consecutive phrases,
            // each replacing the last as the voice reaches it (at most seven words): the phrase
            // block holds three lines, and a whole question in it was cut off.
            const tokens = line.split(/\s+/).filter(Boolean)
            const n = Math.max(1, Math.ceil(tokens.length / 7))
            const size = Math.ceil(tokens.length / n)
            const chunks = Array.from({ length: n }, (_, c) => ({
              text: tokens.slice(c * size, (c + 1) * size).join(" "),
              ws: ws.slice(c * size, (c + 1) * size),
            })).filter((c) => c.text)
            return chunks.map((c, ci) => {
              const cFrom = ci === 0 ? from : (c.ws[0] ?? from)
              const cTo =
                ci + 1 < chunks.length ? (chunks[ci + 1].ws[0] ?? to) : to
              const o = interpolate(
                t,
                [cFrom - 0.12, cFrom, cTo - 0.15, cTo],
                [0, 1, 1, 0],
                clampBoth,
              )
              if (o <= 0) return null
              return (
                <AbsoluteFill key={`${i}-${ci}`} style={{ opacity: o }}>
                  <PhraseCaption
                    cue={{ text: c.text, startSec: cFrom, endSec: cTo }}
                    t={t}
                    px={px}
                    frameHeight={frameHeight}
                    frameWidth={frameWidth}
                    wordStarts={c.ws}
                    {...(cap
                      ? { strongWords: cap.text.split(/\s+/).filter(Boolean) }
                      : {})}
                  />
                </AbsoluteFill>
              )
            })
          })}
        </div>
      )
    }
    // The Jesus Film mark performs at the top as the piece opens, with
    // IN THIS DEVOTIONAL settling under it (owner, 2026-09-30); both leave
    // before WATCH takes the frame.
    // With kinetic captions the spoken preview says "In this devotional"
    // itself, so the kicker leaves before that line instead of doubling it.
    const previewAt = kinetic.length
      ? starts[
          lines.findIndex((l) =>
            // `\b` is ASCII-only, so it never ends a Cyrillic word: \p{L} instead.
            /^\s*(in this devotional|en este devocional|в этом размышлении|в этом видео)(?!\p{L})/iu.test(
              l,
            ),
          )
        ]
      : undefined
    const brandGone = previewAt ?? watchAt
    const brandOut = interpolate(
      t,
      [brandGone - 0.9, brandGone - 0.2],
      [1, 0],
      {
        ...clampBoth,
        easing: ease,
      },
    )
    const kickerIn = interpolate(t, [0.7, 1.6], [0, 1], {
      ...clampBoth,
      easing: ease,
    })
    const brand =
      !cta && brandOut > 0 ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: wide ? "8%" : "11%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: px(7),
            opacity: brandOut,
          }}
        >
          {/* A soft dark ellipse under the mark: over faces and bright film
              the small red mark all but vanished (owner, 2026-09-30). */}
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: px(-6),
              width: px(230),
              height: px(58),
              transform: "translateX(-50%)",
              borderRadius: "50%",
              background:
                "radial-gradient(closest-side, rgba(0,0,0,0.55), rgba(0,0,0,0))",
              filter: `blur(${px(7)}px)`,
            }}
          />
          <AnimatedBrandMark
            px={(n) => px(n * 1.15)}
            frame={frame}
            fps={fps}
            spanSec={3.6}
          />
          {kicker ? (
            <div
              style={{
                fontFamily: SANS,
                fontWeight: 500,
                fontSize: px(wide ? 8.5 : 11),
                letterSpacing: px(2.2 + 1.2 * (1 - kickerIn)),
                color: "rgba(255,255,255,0.78)",
                whiteSpace: "nowrap",
                opacity: kickerIn,
                transform: `translateY(${(-px(6) * (1 - kickerIn)).toFixed(1)}px)`,
                textShadow: `0 ${px(1)}px ${px(10)}px rgba(0,0,0,0.5)`,
              }}
            >
              {kicker}
            </div>
          ) : null}
        </div>
      ) : null
    return (
      <div style={{ ...bleed, pointerEvents: "none" }}>
        <AbsoluteFill style={{ background: `rgba(0,0,0,${scrim})` }} />
        {brand}
        {/* The narration itself, in the middle of the frame (owner,
            2026-09-28): each line small, half the size of the big captions;
            where a line carries a big caption, only the words before it are
            set small, above it ("The others worked" over ONE HOUR). "Let's
            watch" has WATCH and the passage instead. */}
        {kinetic.length
          ? subtitles.map(({ i, line, ws }) => {
              if (i === lines.length - 1) return null
              const from = starts[i]
              const to = lineEnd(i)
              const spec = kinetic.find((k) => k.line === i)
              const out = interpolate(t, [to - 0.35, to - 0.02], [1, 0], {
                ...clampBoth,
                easing: ease,
              })
              if (t < from - 0.1 || out <= 0) return null
              const side = spec?.side ?? "left"
              return (
                <AbsoluteFill key={i} style={{ opacity: out }}>
                  {/* Darken only the side the words sit on. */}
                  <AbsoluteFill
                    style={{
                      background: `linear-gradient(${side === "left" ? 90 : 270}deg, rgba(0,0,0,0.5), rgba(0,0,0,0.12) 55%, rgba(0,0,0,0) 80%)`,
                    }}
                  />
                  <KineticCaption
                    line={line}
                    hero={spec?.hero ?? ""}
                    accents={spec?.accents ?? []}
                    starts={ws.map((w) => w - from)}
                    time={t - from}
                    layout="stack"
                    // Same sizes as the approved still (KineticPreview uses a
                    // 360 unit, the video 390).
                    px={(n) => px((n * 390) / 360)}
                    side={side}
                    // The hero shrinks to stay inside the frame: «ВСЁ ДЕЛАЛА
                    // ПРАВИЛЬНО» ran off the right edge on the Russian Martha
                    // (2026-10-08); the 16:9 stack had no width limit at all.
                    maxWidth={frameWidth - 2 * px((46 * 390) / 360)}
                  />
                </AbsoluteFill>
              )
            })
          : null}
        {subtitles.map(({ i, line, ws }) => {
          if (kinetic.length) return null
          if (i === lines.length - 1) return null
          const from = starts[i]
          const to = lineEnd(i)
          const cap = captions.find((c) => c.line === i)
          const small = cap ? cap.lead : line
          const inP = interpolate(t, [from - 0.05, from + 0.75], [0, 1], {
            ...clampBoth,
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          })
          const outP = interpolate(t, [to - 0.35, to - 0.02], [1, 0], {
            ...clampBoth,
            easing: ease,
          })
          const o = inP * outP
          if (o <= 0) return null
          const bigPx = px(wide ? 34 : 30)
          const smallWords = small ? small.split(/\s+/).filter(Boolean) : []
          return (
            <AbsoluteFill
              key={i}
              style={{
                alignItems: "center",
                justifyContent: "center",
                opacity: o,
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: px(6),
                  maxWidth: px(430),
                  textAlign: "center",
                }}
              >
                {small ? (
                  <div
                    style={{
                      fontFamily: SERIF,
                      fontWeight: 400,
                      fontSize: bigPx / 2,
                      lineHeight: 1.35,
                      color: "#f4efe8",
                      textWrap: "balance",
                      textShadow: `0 ${px(1)}px ${px(14)}px rgba(0,0,0,0.6)`,
                      filter:
                        inP < 0.99
                          ? `blur(${(px(2) * (1 - inP)).toFixed(2)}px)`
                          : undefined,
                    }}
                  >
                    {ws.length >= smallWords.length ? (
                      <KaraokeLine
                        text={small}
                        starts={ws.slice(0, smallWords.length)}
                        endSec={cap ? (ws[smallWords.length] ?? to) : to}
                        t={t}
                        restColor="#f4efe8"
                      />
                    ) : (
                      small
                    )}
                  </div>
                ) : null}
                {cap ? (
                  <div
                    style={{
                      fontFamily: SERIF,
                      fontWeight: 600,
                      fontSize: bigPx,
                      letterSpacing: px(2.2 + 3.2 * (1 - inP)),
                      textTransform: "uppercase",
                      color: "#ffffff",
                      whiteSpace: "nowrap",
                      textShadow: `0 ${px(2)}px ${px(22)}px rgba(0,0,0,0.6)`,
                      filter:
                        inP < 0.99
                          ? `blur(${(px(3) * (1 - inP)).toFixed(2)}px)`
                          : undefined,
                    }}
                  >
                    {cap.text}
                  </div>
                ) : null}
              </div>
            </AbsoluteFill>
          )
        })}
        {t >= watchFrom ? (
          <Sequence
            from={Math.round(watchFrom * fps)}
            durationInFrames={watchFrames}
            layout="none"
          >
            <BigStepWord
              label={steps[0] ?? "WATCH"}
              frame={frame - Math.round(watchFrom * fps)}
              fps={fps}
              px={px}
              durationInFrames={watchFrames}
              serif={SERIF}
            />
          </Sequence>
        ) : null}
        {passageRef && t >= watchFrom ? (
          <WatchPassage
            text={passageRef}
            t={t - watchFrom}
            watchSec={watchFrames / fps}
            px={px}
          />
        ) : null}
      </div>
    )
  }

  if (variant === "opening") {
    // The opening the owner settled on (2026-09-25, revised 2026-09-26):
    //   * the voice opens with "Welcome to Daily Bible Pause." while the brand
    //     mark performs at the top, slowly, and the series name settles under
    //     it (it said "Today's devotional"; the owner wants the name);
    //   * the TITLE is written word by word as the voice reads it, and so is
    //     each under-line; every word arrives gold with a faint glow, as if it
    //     were being lit, and cools to white;
    //   * the third line REPLACES the second in the same slot, so the eye
    //     stays in one place instead of reading a growing stack;
    //   * "Let's watch": the lines leave and WATCH rises across the frame at a
    //     whisper, the way REFLECT and PRAY do, then the film.
    // Nothing moves except the mark and WATCH. The words only fade.
    const all = parts.filter(Boolean)
    const lines = framed ? all.slice(1, -1) : all
    const title = lines[0] ?? ""
    const unders = lines.slice(1)

    const BRAND_SPAN_SEC = 3.6
    const UNDER_FIRST_SEC = 3.4
    const underSpan = Math.max(
      1.6,
      (L - UNDER_FIRST_SEC - 0.8) / Math.max(1, unders.length),
    )
    // Word times per part, from the narration (spoken opening). A part's words
    // are counted the way introPartTimes counts them, so the two agree.
    const spoken = introWords.length > 0
    const partStarts: number[][] = []
    {
      let at = 0
      for (const part of all) {
        const n = part.split(/\s+/).filter(Boolean).length
        partStarts.push(introWords.slice(at, at + n).map((w) => w.startSec))
        at += n
      }
    }
    const lineIndex = (i: number) => (framed ? i + 1 : i)
    const beats = spoken ? introPartTimes(all, introWords) : []
    // When line i (0 = title) begins: the voice's first word of it, or an even
    // pace for a silent opening.
    const lineStart = (i: number) =>
      beats[lineIndex(i)]?.from ??
      (i === 0 ? 0 : UNDER_FIRST_SEC + (i - 1) * underSpan)
    const wordStart = (i: number, w: number) =>
      partStarts[lineIndex(i)]?.[w] ?? lineStart(i) + w * 0.2

    const watchBeat = framed && spoken ? beats[beats.length - 1] : undefined
    const watchAt = watchBeat?.from ?? null

    // Everything drawn leaves before the film speaks; with "Let's watch" it
    // leaves as the voice says it, to make way for WATCH.
    const allOut =
      watchAt != null
        ? interpolate(t, [watchAt - 0.25, watchAt + 0.35], [1, 0], clampBoth)
        : interpolate(t, [L - 0.8, L - 0.15], [1, 0], clampBoth)
    // The series name settles in once the lockup has collapsed into the small
    // mark (owner, 2026-09-26), not while the long logo is still on screen:
    // the slow morph ends at 0.82 of its span (see AnimatedBrandMark).
    const kickerFrom = BRAND_SPAN_SEC * 0.82 + 0.15
    const kicker = interpolate(t, [kickerFrom, kickerFrom + 0.6], [0, 1], {
      ...clampBoth,
      easing: ease,
    })
    // The picture stays sharp (owner). Only a scrim carries the text, and it
    // lifts before the film speaks. A touch heavier than the first cut: LUMO's
    // vineyard is bright, and white text on sunlit leaves was on the edge.
    const scrim = interpolate(
      t,
      [0, 0.5, L - 0.9, L - 0.15],
      [0.16, 0.44, 0.44, 0],
      clampBoth,
    )
    const wide = frameWidth > frameHeight

    // One word of a line: in over 0.3s as the voice reaches it, gold with a
    // faint glow for a moment, then cooling to white (owner, 2026-09-26: "like
    // it is gently lighting up"; the glow is the step light's, much lighter).
    const litWord = (word: string, at: number, key: number, white: string) => {
      const on = interpolate(t, [at - 0.05, at + 0.3], [0, 1], {
        ...clampBoth,
        easing: ease,
      })
      const cool = interpolate(t, [at + 0.45, at + 1.05], [0, 1], {
        ...clampBoth,
        easing: ease,
      })
      const glow = on * (1 - cool)
      return (
        <span key={key}>
          <span
            style={{
              opacity: on,
              color: interpolateColors(cool, [0, 1], [INTRO_GOLD, white]),
              textShadow:
                `0 0 ${px(5)}px rgba(242,196,107,${(0.32 * glow).toFixed(3)}), ` +
                `0 ${px(2)}px ${px(20)}px rgba(0,0,0,0.58)`,
            }}
          >
            {word}
          </span>{" "}
        </span>
      )
    }
    const writeLine = (i: number, text: string, white: string) =>
      text
        .split(/\s+/)
        .filter(Boolean)
        .map((w, k) => litWord(w, wordStart(i, k), k, white))

    const watchFrom = watchAt != null ? watchAt - 0.2 : null
    const watchFrames =
      watchFrom != null
        ? Math.max(1, Math.round((L + 0.9 - watchFrom) * fps))
        : 0

    return (
      <div style={{ ...bleed, pointerEvents: "none" }}>
        <AbsoluteFill style={{ background: `rgba(0,0,0,${scrim})` }} />

        {/* the mark, performing slowly, at the top and out of the title's way */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: wide ? "14%" : "20%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: px(9),
            opacity: allOut,
          }}
        >
          <AnimatedBrandMark
            px={px}
            frame={frame}
            fps={fps}
            spanSec={BRAND_SPAN_SEC}
          />
          <div
            style={{
              fontFamily: SANS,
              fontWeight: 700,
              fontSize: px(10),
              letterSpacing: px(2.6),
              textTransform: "uppercase",
              color: "rgba(214,217,224,0.8)",
              opacity: kicker,
              whiteSpace: "nowrap",
            }}
          >
            Daily Bible Pause
          </div>
        </div>

        {/* the title, and one under-line at a time beneath it */}
        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
            padding: `0 ${px(34)}px`,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: px(20),
              // Wide enough that the second line sets as TWO lines, not three
              // (owner, 2026-09-25). `width` as well as `maxWidth`: in a
              // centring flex parent this column otherwise shrinks to its
              // widest child — the short title — and the under-line, which is
              // absolutely positioned inside it, wrapped to that width.
              width: wide ? frameWidth * 0.74 : "100%",
              maxWidth: "100%",
              textAlign: "center",
              opacity: allOut,
            }}
          >
            <div
              style={{
                fontFamily: SERIF,
                fontWeight: 600,
                fontSize: px(wide ? 40 : 34),
                lineHeight: 1.18,
                textWrap: "balance",
              }}
            >
              {writeLine(0, title, "#ffffff")}
            </div>
            {/* One slot. Each line clears as the next one begins, so the
                reader's eye never has to move or re-scan. */}
            <div
              style={{
                position: "relative",
                width: "100%",
                height: px(wide ? 58 : 66),
              }}
            >
              {unders.map((line, i) => {
                const isLast = i === unders.length - 1
                const off = isLast
                  ? 1
                  : interpolate(
                      t,
                      [lineStart(i + 2) - 0.45, lineStart(i + 2) - 0.05],
                      [1, 0],
                      clampBoth,
                    )
                return (
                  <div
                    key={i}
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      top: 0,
                      fontFamily: SERIF,
                      fontWeight: 400,
                      fontSize: px(wide ? 22 : 21),
                      lineHeight: 1.35,
                      // NOT `balance`: on this sentence the balancer prefers
                      // three even lines to two full ones, which is exactly
                      // what the owner asked to get rid of (2026-09-25).
                      textWrap: "pretty",
                      opacity: off,
                    }}
                  >
                    {writeLine(i + 1, line, "rgba(255,255,255,0.9)")}
                  </div>
                )
              })}
            </div>
          </div>
        </AbsoluteFill>

        {watchFrom != null && t >= watchFrom ? (
          <Sequence
            from={Math.round(watchFrom * fps)}
            durationInFrames={watchFrames}
            layout="none"
          >
            <BigStepWord
              label={steps[0] ?? "WATCH"}
              frame={frame - Math.round(watchFrom * fps)}
              fps={fps}
              px={px}
              durationInFrames={watchFrames}
              serif={SERIF}
            />
          </Sequence>
        ) : null}
        {passageRef && watchFrom != null && t >= watchFrom ? (
          <WatchPassage
            text={passageRef}
            t={t - watchFrom}
            watchSec={watchFrames / fps}
            px={px}
          />
        ) : null}
      </div>
    )
  }

  if (variant === "watch") {
    // THREE BEATS, each moving with the voice that carries it (owner):
    //   1. the film plays, lightly blurred, and the brand settles in from
    //      above while the voice says the welcome;
    //   2. the second sentence is written across the frame word by word, in
    //      step with the narration, and clears when the sentence ends;
    //   3. the step row lights at the top and WATCH is written across the
    //      frame at a whisper while the voice says "Let's watch".
    const beats = introPartTimes(parts, introWords)
    const welcome = beats[0] ?? { from: 0, to: Math.min(1.6, L * 0.25) }
    const title = beats[1] ?? { from: welcome.to + 0.2, to: L - 2.2 }
    const invite = beats[2] ?? { from: Math.max(title.to + 0.3, L - 2), to: L }
    const titleText = parts[1] ?? ""
    const titleWords = titleText.split(/\s+/).filter(Boolean)
    // Word-by-word, gently: each word fades and lifts into place at the moment
    // the voice reaches it.
    const titleWordStart = (i: number) => {
      const w = introWords.slice(
        parts[0]?.split(/\s+/).filter(Boolean).length ?? 0,
      )
      return w[i]?.startSec ?? title.from + i * 0.22
    }
    const titleOut = interpolate(
      t,
      [title.to + 0.35, title.to + 0.95],
      [1, 0],
      clampBoth,
    )
    const markIn = interpolate(t, [0.15, 1.0], [0, 1], {
      ...clampBoth,
      easing: ease,
    })
    const markOut = interpolate(
      t,
      [title.from - 0.2, title.from + 0.4],
      [1, 0],
      clampBoth,
    )
    const markOpacity = markIn * markOut
    // These four knots must stay in order however the sentences fall: on a long
    // opening the third beat starts after `L - 1.4`, and Remotion throws on a
    // non-monotonic range rather than clamping it.
    const bigIn0 = invite.from - 0.3
    const bigIn1 = Math.min(invite.from + 1.1, L - 0.75)
    const bigOut0 = Math.max(bigIn1 + 0.1, L - 1.4)
    const bigOut1 = Math.max(bigOut0 + 0.2, L - 0.3)
    const wordIn = interpolate(t, [bigIn0, bigIn1], [0, 1], {
      ...clampBoth,
      easing: ease,
    })
    const wordOut = interpolate(t, [bigOut0, bigOut1], [1, 0], clampBoth)
    const bigOpacity = 0.15 * wordIn * wordOut
    const bigBlur = interpolate(
      t,
      [bigIn0, bigIn1, bigOut0, bigOut1],
      [26, 0, 0, 26],
      clampBoth,
    )
    const scrim = interpolate(
      t,
      [0, 0.6, L - 1.0, L - 0.2],
      [0.18, 0.38, 0.38, 0],
      clampBoth,
    )
    return (
      <div style={{ ...bleed, pointerEvents: "none" }}>
        <AbsoluteFill style={{ background: `rgba(0,0,0,${scrim})` }} />
        {/* 1. the brand settles in from above */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "13.4%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: px(5),
            opacity: markOpacity,
            transform: `translateY(${(-px(18) * (1 - markIn)).toFixed(1)}px)`,
          }}
        >
          <PauseMark size={px(25)} />
          <div
            style={{
              fontFamily: SANS,
              fontWeight: 400,
              fontSize: px(13),
              letterSpacing: px(1.5),
              color: "rgba(255,255,255,0.75)",
              whiteSpace: "nowrap",
            }}
          >
            DAILY BIBLE PAUSE
          </div>
        </div>

        {/* 2. the line, written word by word with the voice */}
        {titleText && t >= title.from - 0.4 ? (
          <AbsoluteFill
            style={{
              alignItems: "center",
              justifyContent: "center",
              padding: `0 ${px(34)}px`,
              opacity: titleOut,
            }}
          >
            <div
              style={{
                fontFamily: SERIF,
                fontWeight: 500,
                fontSize: px(26),
                lineHeight: 1.3,
                color: "#ffffff",
                textAlign: "center",
                textWrap: "balance",
                maxWidth: frameWidth > frameHeight ? frameWidth * 0.56 : "86%",
                textShadow: `0 ${px(2)}px ${px(18)}px rgba(0,0,0,0.6)`,
              }}
            >
              {titleWords.map((word, i) => {
                const at = titleWordStart(i)
                const p = interpolate(t, [at - 0.12, at + 0.3], [0, 1], {
                  ...clampBoth,
                  easing: ease,
                })
                return (
                  <span
                    key={`${word}-${i}`}
                    style={{
                      display: "inline-block",
                      opacity: p,
                      transform: `translateY(${((1 - p) * px(7)).toFixed(1)}px)`,
                      marginRight: px(6),
                    }}
                  >
                    {word}
                  </span>
                )
              })}
            </div>
          </AbsoluteFill>
        ) : null}

        {/* 3. the step's own name, at a whisper */}
        <AbsoluteFill
          style={{ alignItems: "center", justifyContent: "center" }}
        >
          <div
            style={{
              fontFamily: SERIF,
              fontWeight: 600,
              fontSize: bigStepFontSize(steps[0] ?? "WATCH", px, frameWidth),
              lineHeight: 1,
              letterSpacing: px(7),
              color: INTRO_GOLD,
              opacity: bigOpacity,
              filter: `blur(${bigBlur.toFixed(2)}px)`,
              transform: "translateY(-0.08em)",
              whiteSpace: "nowrap",
            }}
          >
            {steps[0] ?? "WATCH"}
          </div>
        </AbsoluteFill>
      </div>
    )
  }

  if (variant === "hook") {
    // YouTube opening: the question IS the title. The film runs under a scrim
    // while it is spoken, the brand sits above it, and both leave as the
    // film's sound comes up.
    const on = interpolate(t, [0, 0.5], [0, 1], clampBoth)
    const off = interpolate(t, [L - 1.1, L - 0.4], [1, 0], clampBoth)
    // Everything leaves BEFORE the scene starts speaking: the film's run-up is
    // stretched to cover the whole opening, so there is room for the title to
    // go before the first line and its caption arrive.
    const titleIn = interpolate(t, [0.05, 0.6], [0, 1], {
      ...clampBoth,
      easing: ease,
    })
    const titleOut = interpolate(
      t,
      [
        L - HOOK_TITLE_OUT_BEFORE_SEC,
        L - HOOK_TITLE_OUT_BEFORE_SEC + HOOK_TITLE_FADE_SEC,
      ],
      [1, 0],
      clampBoth,
    )
    const titleOpacity = titleIn * titleOut
    // Settles up from a little below, the cover's motion in reverse.
    const titleRise = px(14) * (1 - titleIn)
    const markIn = interpolate(t, [0.25, 0.9], [0, 1], {
      ...clampBoth,
      easing: ease,
    })
    const wide = frameWidth > frameHeight
    return (
      <div style={{ ...bleed, pointerEvents: "none" }}>
        <AbsoluteFill
          style={{ background: `rgba(0,0,0,${INTRO_HOOK_SCRIM * on * off})` }}
        />
        {/* Brand above the question: the mark and the series name, the same
            lockup the cover intro uses. */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: wide ? "16%" : "24%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: px(5),
            opacity: markIn * titleOut,
            pointerEvents: "none",
          }}
        >
          <PauseMark size={px(25)} />
          <div
            style={{
              fontFamily: SANS,
              fontWeight: 400,
              fontSize: px(13),
              letterSpacing: px(1.5),
              color: "rgba(255,255,255,0.72)",
              whiteSpace: "nowrap",
            }}
          >
            DAILY BIBLE PAUSE
          </div>
        </div>
        {hookText ? (
          <AbsoluteFill
            style={{
              alignItems: "center",
              justifyContent: "center",
              padding: `0 ${px(34)}px`,
            }}
          >
            <div
              style={{
                fontFamily: SERIF,
                fontWeight: 500,
                // The cover's title size: this line IS the devotional's title.
                fontSize: px(HOOK_TITLE_PX),
                lineHeight: 1.2,
                color: "#ffffff",
                textAlign: "center",
                textWrap: "balance",
                maxWidth: wide ? frameWidth * 0.62 : "100%",
                textShadow: `0 ${px(2)}px ${px(18)}px rgba(0,0,0,0.6)`,
                opacity: titleOpacity,
                transform: `translateY(${titleRise}px)`,
              }}
            >
              {hookText}
            </div>
          </AbsoluteFill>
        ) : null}
      </div>
    )
  }

  if (variant === "cover") {
    // The column over a darkened film: WATCH lit and slowly swelling, a pool
    // of light behind it, the other steps faint. They then dissolve from the
    // bottom up, one after another (PRAY, its rail, REFLECT, its rail), the
    // scrim lifting with the last; WATCH and the header stay a second into the
    // speaking film and fade.
    const colIn = interpolate(t, [0.1, 0.6], [0, 1], clampBoth)
    const dissolveStart = L - 1.7
    const step = 0.25
    const fadeLen = 0.55
    const gone = (order: number) =>
      1 -
      interpolate(
        t,
        [dissolveStart + order * step, dissolveStart + order * step + fadeLen],
        [0, 1],
        clampBoth,
      )
    // Bottom up: PRAY (0), lower rail (1), REFLECT (2), upper rail (3).
    const orderOf = (i: number, rail: boolean) => {
      const n = steps.length
      return rail ? (n - 1 - i) * 2 - 1 : (n - 1 - i) * 2
    }
    const scrim =
      0.42 * colIn * interpolate(t, [L - 1.0, L - 0.2], [1, 0], clampBoth)
    // WATCH goes before the header: the film is already speaking by then and
    // the word has done its work (owner).
    const watchOut = interpolate(
      t,
      [
        L + INTRO_WATCH_HOLD_SEC,
        L + INTRO_WATCH_HOLD_SEC + INTRO_WATCH_FADE_SEC,
      ],
      [1, 0],
      clampBoth,
    )
    // WATCH lights up: white to gold, a slight swell and the glow arriving
    // together over a second and a half, the word catching light rather than
    // switching on (owner).
    const lit = interpolate(t, [0.5, 2.0], [0, 1], {
      ...clampBoth,
      easing: ease,
    })
    const watchSwell = 1 + 0.07 * lit
    const glow = lit
    const watchColor = interpolateColors(lit, [0, 1], ["#ffffff", INTRO_GOLD])
    // The 16:9 cut is barely half as tall, so the column is set from the real
    // frame: smaller type, shorter rails, centred on the frame itself (it used
    // to be positioned from the portrait height and fell off the bottom).
    const wide = frameWidth > frameHeight
    const size = wide ? 15 : 19
    const labelH = px(size) * 1.2
    const rail = px(wide ? 30 : 46.8)
    const gap = px(wide ? 8 : 10.4)
    const stackH = steps.length * labelH + (steps.length - 1) * (rail + 2 * gap)
    const top0 = frameHeight * (wide ? 0.54 : 0.508) - stackH / 2
    return (
      <div style={{ ...bleed, pointerEvents: "none" }}>
        <AbsoluteFill style={{ background: `rgba(0,0,0,${scrim})` }} />
        {header}
        {/* Pool of light behind WATCH, the same light the stepper carries. */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: top0 + labelH / 2,
            width: px(240),
            height: px(86),
            marginLeft: -px(120),
            marginTop: -px(43),
            borderRadius: "50%",
            background: INTRO_GOLD,
            // Softer than the stepper's pool: the first cut read as a blot of
            // light behind the word rather than the word lit.
            opacity: 0.16 * glow * colIn * watchOut,
            filter: `blur(${px(30)}px)`,
            mixBlendMode: "screen",
          }}
        />
        {steps.map((stepLabel, i) => {
          const y = top0 + i * (labelH + 2 * gap + rail)
          const isWatch = i === 0
          const opacity = isWatch
            ? colIn * watchOut
            : 0.33 * colIn * gone(orderOf(i, false))
          return (
            <Fragment key={stepLabel}>
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: y,
                  height: labelH,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity,
                }}
              >
                <span
                  style={{
                    ...label(isWatch, size),
                    display: "inline-block",
                    ...(isWatch
                      ? {
                          color: watchColor,
                          transform: `scale(${watchSwell})`,
                          textShadow: `0 0 ${px(14) * glow}px rgba(242,196,107,${0.4 * glow})`,
                        }
                      : {}),
                  }}
                >
                  {stepLabel}
                </span>
              </div>
              {i < steps.length - 1 ? (
                <div
                  style={{
                    position: "absolute",
                    left: "50%",
                    marginLeft: -px(0.85),
                    top: y + labelH + gap,
                    width: px(1.7),
                    height: rail,
                    borderRadius: px(1.7),
                    background: "rgba(242,196,107,0.45)",
                    opacity: colIn * gone(orderOf(i, true)),
                  }}
                />
              ) : null}
            </Fragment>
          )
        })}
      </div>
    )
  }

  // bands
  const bandsIn = interpolate(t, [0, 0.3], [0, 1], clampBoth)
  // The WATCH band grows to the whole frame over the middle of the lead, and
  // takes on colour as it grows (it opens desaturated like the others).
  const grow = interpolate(t, [L - 1.8, L - 0.2], [0, 1], {
    ...clampBoth,
    easing: ease,
  })
  const colour = interpolate(t, [L - 1.8, L - 0.4], [0, 1], {
    ...clampBoth,
    easing: ease,
  })
  const b1 = 49.4 + (100 - 49.4) * grow // % of height: bottom of WATCH band
  const b2 = 69.3 + (100 - 69.3) * grow // % of height: bottom of REFLECT band
  const lowerOpacity =
    bandsIn * (1 - interpolate(t, [L - 1.0, L - 0.3], [0, 1], clampBoth))
  const watchOpacity =
    bandsIn * (1 - interpolate(t, [L - 1.2, L - 0.4], [0, 1], clampBoth))
  const labelSize = 22
  // Label edge to band edge: WATCH's bottom sits this far above its band's
  // bottom, PRAY's top this far below its band's top (owner).
  const edgeGap = 4 // % of height
  const labelHPct = (labelSize * 1.2 * 100) / 693
  const band = (
    topPct: number,
    bottomPct: number,
    trimSec: number,
    position: string,
  ) =>
    bottomPct - topPct > 0.05 && clipSrc ? (
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: `${topPct}%`,
          height: `${bottomPct - topPct}%`,
          overflow: "hidden",
          borderTop: `${px(0.9)}px solid #000`,
          background: "#0c0805",
        }}
      >
        <OffthreadVideo
          src={clipSrc}
          muted
          trimBefore={Math.round(trimSec * fps)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: position,
            // Quieter than the WATCH band: no colour, darker, softer contrast,
            // under a warm sepia wash and film grain (owner's Figma).
            filter: "grayscale(1) brightness(0.42) contrast(0.92)",
          }}
        />
        <AbsoluteFill style={{ background: "rgba(74,52,28,0.38)" }} />
        <Grain opacity={0.5} sizePx={200} />
      </div>
    ) : null
  return (
    <div style={{ ...bleed, pointerEvents: "none", opacity: bandsIn }}>
      {/* The live film under WATCH opens without colour and warms up as the
          band grows; a light scrim keeps it from outshining the labels. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: `${b1}%`,
          background: `rgba(29,14,0,${0.22 * (1 - grow)})`,
          backdropFilter: `grayscale(${1 - colour})`,
          WebkitBackdropFilter: `grayscale(${1 - colour})`,
        }}
      />
      {band(b1, b2, 8, "center 30%")}
      {band(b2, 100, 18, "center bottom")}
      {header}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: `${b1 - edgeGap - labelHPct}%`,
          display: "flex",
          justifyContent: "center",
          opacity: watchOpacity,
        }}
      >
        <span style={label(true, labelSize)}>{steps[0] ?? "WATCH"}</span>
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: `${(b1 + b2) / 2 - labelHPct / 2}%`,
          display: "flex",
          justifyContent: "center",
          opacity: 0.8 * lowerOpacity,
        }}
      >
        <span style={label(false, labelSize)}>{steps[1] ?? "REFLECT"}</span>
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: `${b2 + edgeGap}%`,
          display: "flex",
          justifyContent: "center",
          opacity: 0.8 * lowerOpacity,
        }}
      >
        <span style={label(false, labelSize)}>{steps[2] ?? "PRAY"}</span>
      </div>
    </div>
  )
}

function Grain({
  opacity,
  sizePx,
  tint,
  blend,
}: {
  opacity: number
  /** Tile size. Smaller = finer, crisper grain. See `grainSizePx` in schema. */
  sizePx?: number
  /** Overrides the built-in dark-brown tint; see `grainFilter` in the schema. */
  tint?: string
  blend?: string
}) {
  const size = sizePx ?? 260
  return (
    <AbsoluteFill
      style={{
        backgroundImage: GRAIN_URL,
        backgroundSize: `${size}px ${size}px`,
        // The turbulence noise is colorless on its own — `overlay` blending it
        // straight just darkens/lightens whatever's underneath. Owner rule: no
        // color GRADE on the footage itself, but the grain texture should read
        // as dark brown film grain, not neutral gray. Tint it before blending.
        filter:
          tint ?? "sepia(1) saturate(3.2) brightness(0.32) hue-rotate(-6deg)",
        mixBlendMode: (blend ?? "overlay") as "overlay",
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
  spanSec = 1.0,
}: {
  px: (n: number) => number
  frame: number
  fps: number
  /** How long the whole stamp → morph takes. The end card runs it in a second
   *  because it only has two; the opening takes its time (owner: "there is
   *  nowhere to rush, nothing can be understood at that speed"). */
  spanSec?: number
}) {
  const span = Math.max(1, Math.round(spanSec * fps))
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
  // The collapse used to take 19% of the span whatever the span was: on the
  // two-second opening that is under half a second, and the owner could not
  // see what had happened. On a long span the lockup now HOLDS so it can be
  // read, and then crops down slowly over half the span. The end card (1s)
  // keeps the original quick keyframes — it has no time to spare.
  const slow = spanSec > 1.5
  const cropFrom = slow ? 0.3 : 0.16
  const cropTo = slow ? 0.82 : 0.35
  const swapFrom = slow ? 0.68 : 0.29
  const swapTo = slow ? 0.82 : 0.35
  const clipW = interpolate(p, [cropFrom, cropTo], [lockupW, symbolW], {
    ...clamp,
    ...inOutCubic,
  })
  const lockupOpacity = interpolate(p, [swapFrom, swapTo], [1, 0], {
    ...clamp,
    ...inOutCubic,
  })
  const symbolOpacity = interpolate(p, [swapFrom, swapTo], [0, 1], {
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
  inline = false,
}: {
  px: (n: number) => number
  text: string
  bottomPx: number
  fontUnits: number
  frame: number
  fps: number
  delaySec: number
  animate: boolean
  /** Flow with the cover's stack (under the title) instead of hanging off the
   *  bottom edge. Owner: pinned to the foot it was so faint and so far from
   *  everything else that she read it as missing. */
  inline?: boolean
}) {
  const chars = Array.from(text)
  const fade = 0.42 * fps
  const perChar = 0.018
  return (
    <div
      style={{
        ...(inline
          ? { position: "relative", marginTop: px(22), maxWidth: px(430) }
          : {
              position: "absolute",
              left: px(24),
              right: px(24),
              bottom: bottomPx,
            }),
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
  titleWords,
  settleLine,
  settleWords,
  style,
  textFont,
}: {
  px: (n: number) => number
  frame: number
  fps: number
  durationInFrames: number
  title: ReactNode
  /** Per-word times for the TITLE, so the hook types in with the voice. */
  titleWords?: { token: string; startSec: number }[] | null
  /** The settle line the voice speaks after the hook, shown under it. */
  settleLine?: string
  /** Per-word times for that settle line. */
  settleWords?: { token: string; startSec: number }[] | null
  style?: DevotionalStyle
  /** Typeface for the headline; the date/settle line keep the sans. */
  textFont?: "sans" | "serif"
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
  // Owner: the mark comes in two seconds after the title starts — a fixed
  // beat, not a wait for the spoken hook to finish. Waiting for the voice put
  // the logo in the last second of a short cover, with the credit behind it.
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

  // ---- headline: FADES in, and does not move. It used to rise from below,
  // which the owner rejected (2026-09-25): "words can just appear calmly,
  // without any extra movement". The logo is the only thing that animates in
  // the opening, so the words are read rather than watched.
  const headOpacity = textStatic
    ? 1
    : titleLeads
      ? interpolate(pTitle, [0, 0.75], [0, 1], { ...clamp, ...outCubic })
      : interpolate(p, [0.72, 0.94], [0, 1], { ...clamp, ...outCubic })
  const headY = 0

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

      {/* headline — a step lighter and a touch smaller than the launch size
          (owner: 700/60px read as heavier and larger than intended). */}
      <div
        style={{
          fontFamily: textFont === "serif" ? SERIF : SANS,
          // The serif carries the hook at its regular weight — 600 read as
          // bold in EB Garamond (owner: "don't make it bold").
          fontWeight: textFont === "serif" ? 400 : 600,
          fontSize: cpx(29.3), // 54px
          lineHeight: 1.08,
          letterSpacing: cpx(-0.65), // −1.2px
          color: "#fff",
          maxWidth: cpx(487), // 900px
          // With word timings the hook types itself in, so the block-level
          // rise/fade would double up on it.
          opacity: titleWords ? 1 : headOpacity,
          transform: titleWords ? undefined : `translateY(${headY}px)`,
        }}
      >
        {titleWords && style ? (
          <WordReveal
            timings={titleWords}
            frame={frame}
            fps={fps}
            audioDelaySec={0}
            style={style}
            restColor="#fff"
          />
        ) : (
          title
        )}
      </div>
      {/* The settle line the voice speaks after the hook ("Let's slow down and
          give Scripture our attention."), eased in with a slight zoom so it
          arrives as its own beat rather than appearing with the headline. */}
      {settleLine && settleWords && settleWords.length > 0
        ? (() => {
            const startSec = settleWords[0].startSec
            const t = frame / fps
            const inSpan = 0.7
            const appear = interpolate(
              t,
              [startSec - 0.1, startSec + inSpan],
              [0, 1],
              clamp,
            )
            const zoom = interpolate(
              t,
              [startSec - 0.1, startSec + inSpan + 0.6],
              [0.965, 1],
              { ...clamp, ...inOutCubic },
            )
            return (
              <div
                style={{
                  fontFamily: SANS,
                  fontWeight: 400,
                  fontSize: cpx(13),
                  lineHeight: 1.35,
                  letterSpacing: cpx(-0.2),
                  color: "rgba(255,255,255,0.9)",
                  maxWidth: cpx(430),
                  marginTop: cpx(14),
                  opacity: appear,
                  transform: `scale(${zoom})`,
                }}
              >
                {settleLine}
              </div>
            )
          })()
        : null}
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
      {/* The reflection's credit, in the slot the settle line used to hold —
          directly under the title, in its own quiet uppercase (owner). Pinned
          to the bottom edge it was too faint and too far from everything else
          to register at all. */}
      {attribution ? (
        <AttributionCredit
          px={px}
          inline
          text={attribution}
          bottomPx={isLandscape ? px(17.35) : px(28)}
          // A touch larger than the old bottom-edge credit now that it sits in
          // the middle of the frame with the title: px(7.4)≈20px at 1080.
          fontUnits={isLandscape ? 6.4 : 7.4}
          frame={frame}
          fps={fps}
          // In the flow it belongs to the LOCKUP, so it follows the logo in
          // rather than waiting for the end of the whole cover animation —
          // at p≈0.96 of a short card it had no time left to finish typing.
          // Static covers (staticCover or textStatic) skip the reveal entirely.
          delaySec={(logoDelay + 0.6 * fps) / fps}
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
  weight = 700,
  tracking = 3,
}: {
  children: ReactNode
  px: (n: number) => number
  color: string
  size?: number
  mb?: number
  /** Defaults match what portrait already ships; 16:9 passes the owner's
   *  lighter, tighter label spec. */
  weight?: number
  tracking?: number
}) {
  return (
    <div
      style={{
        fontFamily: SANS,
        fontWeight: weight,
        fontSize: px(size),
        letterSpacing: px(tracking),
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
  hideRing = false,
  pieceSec,
  hideCoverDate,
  hideCoverLogo,
  coverDateLabel,
  coverTitleFirst,
  coverTextStatic,
  coverSecondaryLine,
  textFont,
  bleedX,
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
  /** Closing card: leave out its own progress ring (a corner ring clocks the step). */
  hideRing?: boolean
  /** Whole piece length in seconds (the intro shows it rounded to minutes). */
  pieceSec?: number
  hideCoverDate?: boolean
  hideCoverLogo?: boolean
  coverDateLabel?: string
  coverTitleFirst?: boolean
  coverTextStatic?: boolean
  coverSecondaryLine?: string
  /** Typeface for the spoken-text cards; "serif" is the owner's trial look. */
  textFont?: "sans" | "serif"
  /** Landscape: the inset of the centred text column. */
  bleedX?: number
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

  if (card.kind === "step") {
    /**
     * The stepper screen between stages.
     *
     * The light travels from the PREVIOUS step to this one during the card's
     * lead — the silent head of its own narration — so it has landed by the
     * time the voice names the step. The owner's note was that starting the
     * move and the voice together made the steps "blink".
     */
    const at = card.stepIndex ?? 0
    const leadSec = card.stepLeadSec ?? 0.9
    const MOVE_SEC = 1.1
    const LINE_MOVE_START_SEC = 0.25
    const LINE_MOVE_SEC = 2.1
    const t = frame / fps

    // THE OPENING SCREEN carries a line as well as the stack, and its
    // narration is two sentences: the line, then "here's where we're reading
    // today". Both beats play on this one card (owner: "это всё происходит на
    // одном экране"), so the light waits for the line to be finished rather
    // than for a fixed lead. Word times are reported from the synthesis, which
    // happened BEFORE the silent lead was baked onto the front of the file —
    // hence `+ leadSec` everywhere they are used.
    const headlineTimings =
      card.headline && card.words
        ? alignWordsToText(card.headline, card.words)
        : null
    const lineEndsSec = headlineTimings
      ? headlineTimings[headlineTimings.length - 1].endSec + leadSec
      : null
    // The three-step (clip-first) column moves slowly and evenly: the rail
    // draws for about a second, then the label lights and grows for most of
    // another. Linear here; the stepper eases each of the two phases itself,
    // so neither starts or stops with a jolt (owner: "everything gentle").
    const isLine = !!card.steps
    const lightStart = isLine
      ? LINE_MOVE_START_SEC
      : lineEndsSec != null
        ? lineEndsSec + 0.15
        : 0
    const moveSpan = isLine
      ? LINE_MOVE_SEC
      : lineEndsSec != null
        ? MOVE_SEC * 0.65
        : Math.max(0.1, leadSec)
    const travel = interpolate(t, [lightStart, lightStart + moveSpan], [0, 1], {
      ...(isLine ? {} : { easing: Easing.bezier(0.45, 0, 0.55, 1) }),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
    // The first step has nothing to travel from, so its light simply arrives.
    const from = Math.max(0, at - 1)
    const glowPos = from + (at - from) * travel
    const goldness = (i: number) => {
      if (i < at) return 1
      if (i > at) return 0
      // Trails the light, so the colour reads as the arrival's consequence.
      return interpolate(travel, [0.45, 1], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    }
    // On the opening screen the light does not exist until the line is read:
    // every stage is still ahead, so lighting one would say something untrue
    // about where the viewer is.
    const lightOpacity =
      lineEndsSec != null
        ? interpolate(t, [lightStart, lightStart + 0.35], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })
        : 1
    // Clip-first hand-over screen, 16:9 ONLY: there the top row already says
    // where the viewer is, so the middle carries only the step's NAME, at a
    // whisper, arriving out of the blur (owner, 2026-09-23).
    // In 9:16 the top strip is where every social UI puts its own chrome, so
    // the row is not drawn there and the vertical column stays the stepper:
    // the light travels down onto the next step, which warms and begins
    // (owner, 2026-09-24).
    if (isLine && isLandscape) {
      const labels = card.steps ?? ["WATCH", "REFLECT", "PRAY"]
      return (
        <BigStepWord
          label={labels[at] ?? labels[labels.length - 1]}
          frame={frame}
          fps={fps}
          px={px}
          durationInFrames={durationInFrames}
          serif={SERIF}
        />
      )
    }

    return (
      <StepperStack
        // The three-step (clip-first) stepper uses the owner's Figma design:
        // a rail drawing down from the step just done onto the next one,
        // which then lights, grows a little and comes into focus.
        variant={isLine ? "line" : "glow"}
        stepIndex={at}
        glowPos={glowPos}
        goldness={goldness}
        style={style}
        px={px}
        width={vw}
        height={vh}
        lightOpacity={lightOpacity}
        {...(card.steps ? { steps: card.steps } : {})}
        {...(card.headline
          ? {
              headline: headlineTimings ? (
                // The whole line is on screen from the start, faint; each word
                // warms to the accent as the voice reaches it and settles to
                // white behind it (owner).
                <WordReveal
                  timings={headlineTimings}
                  frame={frame}
                  fps={fps}
                  audioDelaySec={leadSec}
                  style={style}
                  restColor="#ffffff"
                  preOpacity={0.32}
                />
              ) : (
                card.headline
              ),
            }
          : {})}
      />
    )
  }

  if (card.kind === "cover") {
    // Unified cover for BOTH orientations, reproduced from the Claude Design
    // spec: the red Jesus Film symbol, headline, and date stacked and centered
    // on the sharp footage (Background paints the dark wash + vignette). The
    // rotation styles still GRADE the footage; only the cover LAYOUT is unified.
    // NOTE: this reintroduces the logo — but ONLY on the cover card.
    const title = withHighlight(card.title ?? "", card.highlight, style)
    // The cover's narration speaks the hook and THEN the settle line, so both
    // sets of word times come out of the one segment's alignment — each is
    // matched against its own text so they type in at the right moments.
    const titleWords = card.words
      ? alignWordsToText(card.title ?? "", card.words)
      : null
    const settleWords =
      card.words && card.settleLine
        ? alignWordsToText(card.settleLine, card.words)
        : null
    return (
      <CoverIntro
        px={px}
        frame={frame}
        fps={fps}
        durationInFrames={durationInFrames}
        title={title}
        {...(titleWords ? { titleWords } : {})}
        {...(card.settleLine ? { settleLine: card.settleLine } : {})}
        {...(settleWords ? { settleWords } : {})}
        style={style}
        {...(textFont ? { textFont } : {})}
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
    // TRANSITION INTO THE FILM (owner): the verse holds, then clears, and
    // "LET'S WATCH" zooms in centered on the same card at the exact moment the
    // narration says it — then the video card takes over. The moment comes
    // from the segment's own word times; without them the card just holds the
    // verse as before.
    const watchTokens = ["let's", "lets", "watch", "давайте", "посмотрим"]
    const watchStart = (() => {
      if (!card.words || card.words.length === 0) return null
      // The phrase is the TAIL of the spoken scripture segment, so scan back.
      for (let i = card.words.length - 1; i >= 0; i--) {
        if (watchTokens.includes(wordKey(card.words[i].word))) {
          // Walk back over any other tokens of the same phrase.
          let j = i
          while (j > 0 && watchTokens.includes(wordKey(card.words[j - 1].word)))
            j--
          return card.words[j].startSec
        }
      }
      return null
    })()
    // THE VERSE LEADS, THE CITATION CLOSES.
    //
    // The voice opens this card with the reference ("Luke ten, thirty-six")
    // and only then reads the verse, but the owner asked the TEXT not to wait
    // for that — the verse starts unfolding straight away and the citation
    // appears underneath it at the end, once there is something to attribute.
    // Voice and text therefore drift apart by a couple of seconds, which she
    // accepted explicitly ("ничего страшного").
    //
    // Its pace is derived rather than fixed: the reveal should finish around
    // three quarters of the way through whatever card this passage produced,
    // so a two-line verse and a six-line one both read as unhurried instead of
    // one racing and the other stalling.
    const verseChars = (card.verse ?? "").length
    const VERSE_START_SEC = 0.3
    const versePerChar = Math.min(
      0.06,
      Math.max(
        0.022,
        ((durationInFrames / fps) * 0.74 - VERSE_START_SEC) /
          Math.max(1, verseChars),
      ),
    )
    const verseEndsSec = VERSE_START_SEC + verseChars * versePerChar
    const watchLabel = card.leadLabel ?? "Let's watch"
    const tNow = frame / fps
    /** Wraps a verse layout: fades it out just before the phrase, and swaps in
     *  the zooming label. */
    const withWatchSwap = (body: ReactNode): ReactNode => {
      if (watchStart == null) return body
      const clearAt = watchStart - 0.15
      const verseOpacity = interpolate(
        tNow,
        [clearAt - 0.45, clearAt],
        [1, 0],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
      )
      const labelOpacity = interpolate(
        tNow,
        [clearAt, clearAt + 0.35],
        [0, 1],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
      )
      const labelZoom = interpolate(tNow, [clearAt, clearAt + 1.1], [0.86, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.out(Easing.cubic),
      })
      return (
        <>
          {verseOpacity > 0 ? (
            <AbsoluteFill style={{ opacity: verseOpacity }}>
              {body}
            </AbsoluteFill>
          ) : null}
          {labelOpacity > 0 ? (
            <AbsoluteFill
              style={{
                justifyContent: "center",
                alignItems: "center",
                textAlign: "center",
                padding: pad,
                opacity: labelOpacity,
                transform: `scale(${labelZoom})`,
              }}
            >
              {/* Same treatment as the other connector labels ("Ask yourself",
                  "Pray"): sans, uppercase, tracked, in the accent colour. */}
              <div
                style={{
                  fontFamily: SANS,
                  fontWeight: 700,
                  fontSize: px(12),
                  letterSpacing: px(3),
                  textTransform: "uppercase",
                  color: style.eyebrow,
                }}
              >
                {watchLabel}
              </div>
            </AbsoluteFill>
          ) : null}
        </>
      )
    }
    // Reverted to the per-style-rotation layout (quoteCenter / grain-left-rule
    // / frostedBottom-bar) — the owner preferred it back after trying the
    // unified left-rule redesign. Font size trimmed twice now: 32→27 in the
    // desktop preview, then 27→23 after the owner saw it actually playing on
    // a phone in Instagram/Reels — 27 read as too large once the verse ran
    // 5-6 lines on a real screen instead of the preview window. The `igSafe`
    // protection stays on every branch: the citation must clear the social
    // app's own bottom UI regardless of which layout is showing.
    const verse = (
      <div
        style={{
          // Owner: the serif carries the main text (title/scripture/question/
          // prayer); the verse keeps its italic either way — and keeps Source
          // Serif 4, whose italic the owner preferred to Literata's.
          fontFamily: textFont === "serif" ? VERSE_SERIF : SANS,
          fontStyle: "italic",
          // Owner: the verse reads as a quotation, a step lighter than the
          // headings around it. A real weight — Source Serif 4 is registered as
          // a variable face (200-900).
          fontWeight: 300,
          fontSize: px(23),
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
            delaySec={VERSE_START_SEC}
            perChar={versePerChar}
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
          // Last, under the finished verse (owner).
          ...reveal(frame, fps, verseEndsSec + 0.45, 1, "fade"),
        }}
      >
        {card.citation.toUpperCase()}
        {card.translation ? (
          // The translation, quieter than the reference: it is a footnote to
          // the citation, not part of it.
          <span style={{ opacity: 0.6 }}>
            {"\u00a0\u00b7\u00a0"}
            {card.translation.toUpperCase()}
          </span>
        ) : null}
      </div>
    ) : null

    if (style.scripture === "quoteCenter") {
      return withWatchSwap(
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
              // Same face as the verse under it.
              fontFamily: VERSE_SERIF,
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
        </AbsoluteFill>,
      )
    }
    // grain: left rule; sepia: bottom accent bar
    const bottom = style.scripture === "frostedBottom"
    return withWatchSwap(
      <AbsoluteFill
        style={{
          justifyContent: bottom ? "flex-end" : "center",
          padding: bottom
            ? `${px(48)}px ${px(28)}px ${padBottom}px`
            : `0 ${px(30)}px`,
          paddingBottom: igSafe ? igSafeBottom : bottom ? padBottom : undefined,
          // Owner rule: the side paddings must MATCH. The IG safe-area
          // inset used to apply to the right only (to clear the action
          // rail), which read as the text sitting off-centre.
          paddingLeft: igSafe ? igSafeRight : undefined,
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
      </AbsoluteFill>,
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
                  // Owner rule: the side paddings must MATCH. The IG safe-area
                  // inset used to apply to the right only (to clear the action
                  // rail), which read as the text sitting off-centre.
                  paddingLeft: igSafe ? igSafeRight : undefined,
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
                left: igSafe ? igSafeRight : px(34),
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
    // Real per-word times, lined up against the VISIBLE text (the spoken
    // segment also carries the "Reflect on this." connector). null when the
    // manifest has no timings or they cannot be aligned — the card then keeps
    // its original block reveal.
    const wordTimings = card.words
      ? alignWordsToText(card.text ?? "", card.words)
      : null
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
    // A short sentence ("He stayed." "He pleads.") has its own weight: in the
    // wide cut it is set larger and arrives like the opening's big captions,
    // out of a slight blur, letters drawing in from wider tracking, with a
    // gentle zoom (owner, 2026-09-30). Same face as the reflection body, in
    // capitals: the serif here looked like a different text (owner,
    // 2026-10-01).
    const shortLine =
      isLandscape &&
      (card.text ?? "").trim().split(/\s+/).filter(Boolean).length <= 4
    if (shortLine) {
      const inP = interpolate(frame / fps, [0.02, 0.8], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.bezier(0.4, 0, 0.2, 1),
      })
      const big = (
        <p
          style={{
            margin: 0,
            width: "100%",
            textAlign: card.markColumn ? "left" : "center",
            fontFamily: SANS,
            fontWeight: 600,
            fontSize: px(27),
            lineHeight: 1.2,
            textTransform: "uppercase",
            letterSpacing: px(1.4 + 2.6 * (1 - inP)),
            color: "#ffffff",
            opacity: inP,
            transform: `scale(${(0.96 + 0.04 * inP).toFixed(4)})`,
            transformOrigin: card.markColumn ? "left center" : "center",
            textShadow: `0 ${px(2)}px ${px(22)}px rgba(0,0,0,0.6)`,
            filter:
              inP < 0.99
                ? `blur(${(px(3) * (1 - inP)).toFixed(2)}px)`
                : undefined,
          }}
        >
          {card.text}
        </p>
      )
      if (card.markColumn) {
        return (
          <AbsoluteFill>
            <div
              style={{
                position: "absolute",
                top: card.markColumn.top,
                left: card.markColumn.left - (bleedX ?? 0),
                width: card.markColumn.width,
              }}
            >
              {big}
            </div>
          </AbsoluteFill>
        )
      }
      return (
        <AbsoluteFill
          style={{
            justifyContent: "flex-end",
            padding: pad,
            paddingBottom:
              wideText === "bottom"
                ? (card.wideBottomPx ?? px(WIDE_TEXT_BOTTOM))
                : undefined,
          }}
        >
          {big}
        </AbsoluteFill>
      )
    }
    const paragraph = (
      <p
        style={{
          margin: 0,
          // The reflection body stays on Inter even in the serif cut: it is
          // the longest block of reading in the piece and the owner found the
          // sans easier to read at speed. Every other main text element
          // follows `textFont`.
          fontFamily: SANS,
          fontWeight: 400,
          // Owner-picked sizes: right panel 55px, bottom band 60px (desktop
          // 16:9). Portrait was 69px (px(25)) — read fine in the desktop
          // preview but too large once actually viewed on a phone inside
          // Instagram/Reels (owner: screenshots showing 4-6 lines eating
          // most of the screen), so trimmed to 58px (px(21)), then to 52px
          // (px(19)) after the owner asked again on the word-reveal cut.
          fontSize:
            wideText === "right"
              ? px(20)
              : wideText === "bottom"
                ? px(22)
                : px(21),
          lineHeight: 1.46,
          color: style.body,
          // The wide cut centres its reflection (owner, 2026-09-25). Set HERE
          // and not only on the wrapper: the wrapper is a flex column that
          // centres its items, so the paragraph hugs its longest line and a
          // `text-align` up there has nothing to act on — every line still
          // starts at the same left edge.
          // Keyed to the ASPECT, not to `wideText`: the wide cut centres its
          // reflection (owner, 2026-09-25) and the vertical one does not,
          // and that is the whole rule. Keying it to the text-placement mode
          // left it silently off.
          ...(isLandscape
            ? {
                width: "100%",
                // Beside a side credit the sentence is left aligned in its
                // column (owner's Figma, 2026-09-29).
                textAlign: card.markColumn
                  ? ("left" as const)
                  : ("center" as const),
              }
            : {}),
          // With real word timings the card reveals word by word in step
          // with the voice, so the block-level reveal would fight it; the
          // whole-block settle stays for every card without timings.
          ...(wordTimings ? {} : reveal(frame, fps, 0.35, 1, "popUp")),
        }}
      >
        {wordTimings ? (
          <WordReveal
            timings={wordTimings}
            frame={frame}
            fps={fps}
            audioDelaySec={0}
            {...(card.highlight ? { highlight: card.highlight } : {})}
            style={style}
            restColor={style.body}
          />
        ) : (
          withHighlight(card.text ?? "", card.highlight, style)
        )}
      </p>
    )
    // Bible references, shown as a footnote under the sentence rather than
    // read aloud (owner's Figma "Bible Quotes", 2026-09-29): a hairline draws
    // left to right, then the reference fades in under it.
    const u = (n: number) => px((n * 390) / 1080)
    const footT = frame / fps
    const footLine = interpolate(footT, [0.35, 1.05], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.4, 0, 0.2, 1),
    })
    const footRef = interpolate(footT, [0.85, 1.55], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.4, 0, 0.2, 1),
    })
    const footnote =
      isLandscape && card.verseRefs && card.verseRefs.length > 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: u(24),
            marginTop: u(28),
          }}
        >
          <div
            style={{
              width: u(1139),
              height: Math.max(1, u(1)),
              background: "rgba(255,255,255,0.5)",
              transform: `scaleX(${footLine.toFixed(4)})`,
              transformOrigin: "left center",
            }}
          />
          <div
            style={{
              fontFamily: SERIF,
              fontWeight: 400,
              fontSize: u(32),
              lineHeight: `${u(50)}px`,
              color: "rgba(255,255,255,0.92)",
              opacity: 0.85 * footRef,
              whiteSpace: "nowrap",
            }}
          >
            {card.verseRefs.join(", ")}
          </div>
        </div>
      ) : null
    const inner = (
      <>
        {heading}
        {paragraph}
        {footnote}
      </>
    )
    if (card.markColumn) {
      // Beside a side credit: the column's own box, top aligned with the
      // credit group, so the sentence starts where the rule starts.
      return (
        <AbsoluteFill>
          <div
            style={{
              position: "absolute",
              top: card.markColumn.top,
              left: card.markColumn.left - (bleedX ?? 0),
              width: card.markColumn.width,
              textAlign: "left",
            }}
          >
            {paragraph}
          </div>
        </AbsoluteFill>
      )
    }
    // Portrait experiment: the pipeline feeds ONE sentence per reflection card,
    // so read them like stable subtitles — a FIXED TOP anchor (upper-middle of
    // the frame) means every one-sentence card starts at the SAME Y and grows
    // DOWNWARD, instead of the old bottom anchor (where a 1-line vs 3-line
    // sentence jumped up/down). Only portrait, non-frosted; landscape keeps its
    // bottom-band / right-panel behaviour and frosted styles keep their panel.
    const stableTop = usesStableTopAnchor(card.kind, style, isLandscape)
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
          // Owner rule (bottom band): the band used to sit 48px off the frame
          // edge; on 2026-09-25 the owner asked for it about 40px higher (88px
          // at 1080p), and on 2026-09-26 another 40px: 128px. 16:9 ONLY.
          paddingBottom:
            wideText === "bottom"
              ? (card.wideBottomPx ?? px(WIDE_TEXT_BOTTOM))
              : igSafe
                ? igSafeBottom
                : style.textBottom
                  ? padBottom
                  : undefined,
          // Owner rule: the side paddings must MATCH. The IG safe-area
          // inset used to apply to the right only (to clear the action
          // rail), which read as the text sitting off-centre.
          paddingLeft: igSafe ? igSafeRight : undefined,
          paddingRight: igSafe ? igSafeRight : undefined,
          // The wide cut CENTRES its reflection (owner, 2026-09-25). This
          // reverses an older rule of hers — "centered reflection is hard to
          // read" — which still stands for the vertical cut, where the text is
          // longer on screen and the eye has further to travel back.
          textAlign: isLandscape ? "center" : undefined,
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
    // 16:9 sets the takeaway bare, no rules above or below (owner,
    // 2026-09-26: "they feel unnecessary now"). Portrait keeps the styles' own
    // treatment, which the owner has signed off and asked not to touch.
    const body = (
      <>
        {isLandscape ? null : style.pullquote === "glyph" ? (
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
            fontFamily: textFont === "serif" ? SERIF : SANS,
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
        {!isLandscape && style.pullquote === "glyph" ? (
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
        {!isLandscape && style.pullquote === "bars" ? (
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
          // Owner rule: the side paddings must MATCH. The IG safe-area
          // inset used to apply to the right only (to clear the action
          // rail), which read as the text sitting off-centre.
          paddingLeft: igSafe ? igSafeRight : undefined,
          paddingRight: igSafe ? igSafeRight : undefined,
          paddingBottom: igSafe ? igSafeBottom : undefined,
          // Owner: lift the question + prayer block by 8px.
          transform: "translateY(-8px)",
        }}
      >
        {body}
      </AbsoluteFill>
    )
  }

  if (card.kind === "quote-intro") {
    return (
      <QuoteIntro
        quoteA={card.quoteA ?? ""}
        {...(card.quoteAStrong ? { quoteAStrong: card.quoteAStrong } : {})}
        quoteB={card.quoteB ?? ""}
        {...(card.quoteBStrong ? { quoteBStrong: card.quoteBStrong } : {})}
        questions={card.questionsList ?? []}
        watchLabel={card.watchLabel ?? "Let's watch."}
        {...(card.ctaLine ? { cta: card.ctaLine } : {})}
        {...(card.ctaLabel != null ? { ctaLabel: card.ctaLabel } : {})}
        {...(card.keySfx ? { keySfx: card.keySfx } : {})}
        {...(card.transitionSfx ? { transitionSfx: card.transitionSfx } : {})}
        px={px}
        fps={fps}
        durationSec={durationInFrames / fps}
        serif={SERIF}
        sans={SANS}
      />
    )
  }

  if (card.kind === "video") {
    // The film plays clear (rendered by Background) with no text overlay — the
    // one exception is the silent opening: while the clip's own sound is still
    // easing in, the spoken "Let's watch" is also shown, then dissolves out as
    // the film takes over.
    const lead = card.mutedLeadSec ?? 0
    // The film's own mark, small in the top-left for the whole clip: credit for
    // the pictures, at the size of the reflection author's avatar (owner).
    // It waits out the opening — during those seconds the frame belongs to our
    // own brand, and two marks at once would read as a co-production card.
    const filmMark = card.filmMark ? (
      <img
        src={FILM_MARK_URIS[card.filmMark]}
        alt=""
        style={{
          position: "absolute",
          // Owner's numbers, set in Figma on the 1920x1080 frame: 98px tall at
          // x=72 y=56. px() is keyed to the SHORT side (390 reference), so in a
          // 1080-high frame those become 35.4 / 26 / 20.2.
          //
          // `-bleedX`: in 16:9 the card is laid out inside a centred column and
          // a plain `left: 72` lands 261px further right — the frame's corner is
          // OUTSIDE the column (owner: "the LUMO logo is too far right, it
          // should be in the top-left corner"). Same escape the captions and the
          // intro scrim use.
          left: px(26) - (bleedX ?? 0),
          top: px(20.2),
          height: px(35.4),
          width: "auto",
          opacity:
            0.82 *
            interpolate(
              frame / fps,
              [Math.max(0, lead - 0.2), Math.max(0.3, lead + 0.6)],
              [0, 1],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            ),
          filter: `drop-shadow(0 ${px(1)}px ${px(5)}px rgba(0,0,0,0.55))`,
          pointerEvents: "none",
        }}
      />
    ) : null
    if (card.intro && lead > 0) {
      return (
        <>
          {filmMark}
          <ClipIntro
            variant={card.intro}
            leadSec={lead}
            frame={frame}
            fps={fps}
            px={px}
            style={style}
            steps={card.steps ?? ["WATCH", "REFLECT", "PRAY"]}
            pieceSec={pieceSec ?? durationInFrames / fps}
            clipSrc={card.videoFile ? staticFile(card.videoFile) : null}
            frameWidth={vw}
            frameHeight={vh}
            bleedX={bleedX ?? 0}
            {...(card.hookText ? { hookText: card.hookText } : {})}
            {...(card.introParts ? { parts: card.introParts } : {})}
            {...(card.words ? { introWords: card.words } : {})}
            framed={card.introFrame === true}
            {...(card.introCaptions ? { captions: card.introCaptions } : {})}
            {...(card.introKinetic ? { kinetic: card.introKinetic } : {})}
            {...(card.introKicker != null ? { kicker: card.introKicker } : {})}
            {...(card.passageRef ? { passageRef: card.passageRef } : {})}
            cta={card.introCta === true}
            ctaCalm={card.introCtaStyle === "calm"}
            {...(card.introCtaText ? { ctaText: card.introCtaText } : {})}
          />
        </>
      )
    }
    if (!card.leadLabel || lead <= 0) return filmMark

    const t = frame / fps
    // Build the hold from a knot that is already past the fade-in, then put the
    // fade-out after it. Writing the last knot as `lead + 0.35` against a third
    // knot of `Math.max(1, lead - 0.35)` silently required lead > 0.65: any
    // shorter lead produced a non-monotonic range and Remotion throws on the
    // card's first frame. Nothing upstream enforced that — the schema takes any
    // number and the CLI clamps only to [0, 4].
    const opacity = interpolate(t, leadLabelKnots(lead), [0, 1, 1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
    if (opacity <= 0) return null
    return (
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          textAlign: "center",
          padding: pad,
        }}
      >
        <div
          style={{
            fontFamily: SANS,
            fontWeight: 600,
            fontSize: px(24),
            letterSpacing: px(0.4),
            color: "#fff",
            textShadow: "0 2px 18px rgba(0,0,0,0.8)",
            opacity,
          }}
        >
          {card.leadLabel}
        </div>
      </AbsoluteFill>
    )
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
  // Prayer appears well after the questions — a 5s beat to sit with them first
  // — or, with word times, as the voice says "Talk to God about it:".
  const prayerDelay = card.prayerAtSec ?? 5
  /**
   * 16:9 numbers taken straight off the owner's Figma frame, converted to
   * px() units (px(n) = n * height / 390, so these hold at any 16:9 size):
   *   column left edge 420/1920, top 205/1080, width 1080
   *   one uniform 34px gap between every block
   *   labels 20px Semi Bold, 5px tracking
   *
   * The left inset is 57.4, not 151.7, because in landscape every card is
   * ALREADY inside a centred column of width px(505) — that wrapper supplies
   * 261px of the 420, and adding the full figure on top is what pushed the
   * block ~260px right of the design.
   */
  const L_LEFT = px(57.4)
  const L_TOP = px(74)
  const L_COL = px(390)
  const L_GAP = px(12.28)
  const L_LABEL = 7.22
  const L_TRACK = 1.81
  // SAME TREATMENT AS THE VERSE (owner): the question and the prayer unfold
  // character by character rather than sliding in as finished blocks, so the
  // closing card reads like the scripture card it answers.
  //
  // Both paces are DERIVED, the way the verse's is: a long question and a
  // short one should both feel unhurried instead of one racing. The questions
  // have until the prayer arrives; the prayer has the rest of the card.
  // On the voice's cue when the narration has word times (the question after
  // "First, ask yourself:"), else the fixed opening beat.
  const Q_START_SEC = card.questionAtSec ?? 0.3
  const questionChars = questions.reduce((n, t) => n + t.length, 0)
  const questionPerChar = Math.min(
    0.06,
    Math.max(
      0.022,
      (prayerDelay - 0.8 - Q_START_SEC) / Math.max(1, questionChars),
    ),
  )
  // The prayer BLOCK (rule + "Pray" label) fades in at `prayerDelay`; its text
  // starts unfolding just after, so the two entrances don't stack into one
  // compounded fade — the same 0.45s beat the verse leaves before its citation.
  const prayerTextStart = card.prayerTextAtSec ?? prayerDelay + 0.45
  const prayerChars = (card.prayer ?? "").length
  const prayerPerChar = Math.min(
    0.06,
    Math.max(
      0.022,
      ((durationInFrames / fps) * 0.88 - prayerTextStart) /
        Math.max(1, prayerChars),
    ),
  )
  // Questions + prayer are text-heavy: always centered on the blurred background
  // (no panel), independent of layout — same treatment as the conclusion.
  return (
    <AbsoluteFill
      style={{
        // 16:9 (owner's design): one LEFT-aligned column set in from the edge,
        // rather than a centred block. The ring, the labels and both texts
        // share that one left edge — in the earlier cut the ring was centred
        // on the FRAME while the text was left-aligned, which in a wide frame
        // put them ~700px apart. Portrait keeps its own padding.
        alignItems: isLandscape ? "flex-start" : undefined,
        // Owner's frame sits the column high rather than centred, so landscape
        // anchors from the top instead of centring.
        justifyContent: isLandscape ? "flex-start" : "center",
        padding: isLandscape
          ? `${L_TOP}px ${px(34)}px ${px(28)}px ${L_LEFT}px`
          : pad,
      }}
    >
      {/* Star-orbit progress ring: small, left-aligned in the text column,
          sitting ABOVE the "Ask yourself" label (same left inset as the label +
          questions). Same fill/orbit animation + timing as before — it just
          flows inline here instead of the old bottom-corner overlay. Left out
          when the corner ring clocks the whole PRAY step instead. */}
      {hideRing || isLandscape ? null : (
        <div
          style={{
            // Owner widened the gap under the ring in 16:9 and left-aligned it
            // with the column.
            marginBottom: isLandscape ? px(23.8) : q(34),
            alignSelf: isLandscape ? "flex-start" : "center",
          }}
        >
          <ProgressRing
            px={px}
            fps={fps}
            frame={frame}
            startFrame={Math.round(3.5 * fps)}
            durationInFrames={durationInFrames}
            isLandscape={isLandscape}
            inline
            // Grown twice on the owner's word: 22 was almost invisible, 30
            // still read as a footnote. At 48, centered above the question, the
            // ring is the card's clock — the thing that says how long there is
            // to sit with what it asks.
            size={isLandscape ? px(30) : q(48)}
          />
        </div>
      )}
      <Eyebrow
        px={px}
        color={style.eyebrow}
        size={isLandscape ? L_LABEL : 12}
        mb={isLandscape ? 12.28 : 24}
        weight={isLandscape ? 600 : 700}
        tracking={isLandscape ? L_TRACK : 3}
      >
        <span style={reveal(frame, fps, 0.15, 1, "down")}>
          {card.askLabel ?? "Ask yourself"}
        </span>
      </Eyebrow>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: isLandscape ? L_GAP : q(22),
          // The owner's 16:9 column is 1080 of 1920; without a cap the lines
          // run most of the frame's width and stop being readable.
          maxWidth: isLandscape ? L_COL : undefined,
        }}
      >
        {questions.map((text, i) => {
          // Where THIS question's letters start: after every earlier question
          // has finished unfolding, so a two-question card still reads in
          // order instead of both running at once.
          const startSec =
            Q_START_SEC +
            questions
              .slice(0, i)
              .reduce((n, t) => n + t.length * questionPerChar + 0.4, 0)
          return (
            <div
              key={i}
              style={{
                display: "flex",
                gap: q(14),
                alignItems: "baseline",
                // The block itself no longer slides: the letters carry the
                // entrance (owner — same as the verse). The number still fades
                // in with its question.
                ...(letters
                  ? reveal(frame, fps, startSec, 1, "fade")
                  : reveal(frame, fps, 0.3 + i * 0.35, 1, "up")),
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
                  fontFamily: textFont === "serif" ? SERIF : SANS,
                  fontWeight: 400,
                  // Trimmed 26 → 22 (owner: the closing card took too much
                  // room). Now a step BELOW the verse's 23 rather than above it,
                  // which also lets a long question breathe on a phone.
                  // 16:9 size taken from the owner's frame (46 of 1920);
                  // portrait keeps the size she already approved.
                  fontSize: isLandscape ? px(16.6) : q(22),
                  lineHeight: 1.36,
                  color: style.body,
                }}
              >
                {letters ? (
                  <LetterReveal
                    text={text}
                    style={style}
                    frame={frame}
                    fps={fps}
                    delaySec={startSec}
                    perChar={questionPerChar}
                  />
                ) : (
                  text
                )}
              </p>
            </div>
          )
        })}
      </div>
      {card.prayer ? (
        <div
          style={{
            maxWidth: isLandscape ? L_COL : undefined,
            // 16:9 keeps ONE rhythm — the owner's frame has the same 34px gap
            // between every block on this card.
            marginTop: isLandscape ? L_GAP : q(32),
            ...reveal(frame, fps, prayerDelay, 1, "fade"),
          }}
        >
          <div
            style={{
              width: q(48),
              height: style.pullquote === "bars" ? px(4) : px(1),
              background: style.rule,
              marginBottom: isLandscape ? L_GAP : q(22),
            }}
          />
          <Eyebrow
            px={px}
            color={style.eyebrow}
            size={isLandscape ? L_LABEL : 12}
            mb={isLandscape ? 12.28 : 14}
            weight={isLandscape ? 600 : 700}
            tracking={isLandscape ? L_TRACK : 3}
          >
            {card.prayLabel ?? "Pray"}
          </Eyebrow>
          <p
            style={{
              margin: 0,
              fontFamily: textFont === "serif" ? SERIF : SANS,
              fontStyle: "italic",
              // Owner: the prayer sits a weight below the question above it, so
              // the card reads as ask-then-pray rather than two equal blocks.
              // Real weight — Source Serif 4 is registered as a variable face.
              fontWeight: 300,
              // Trimmed 22 → 19 alongside the question above it, keeping the
              // one-step drop between them that makes the card read
              // ask-then-pray.
              fontSize: isLandscape ? px(13) : q(19),
              lineHeight: 1.56,
              color: style.body,
            }}
          >
            {letters ? (
              <LetterReveal
                text={card.prayer}
                style={style}
                frame={frame}
                fps={fps}
                delaySec={prayerTextStart}
                perChar={prayerPerChar}
              />
            ) : (
              card.prayer
            )}
          </p>
        </div>
      ) : null}
      {/* 16:9: the ring comes AFTER the prayer (owner, 2026-09-26), under the
          text and on the column's left edge, once the voice has finished: it
          is the clock for the silence the card leaves to pray in. Shown even
          when the step ring is on, since the wide cut has no corner ring. */}
      {isLandscape ? (
        <div style={{ marginTop: L_GAP * 2, alignSelf: "flex-start" }}>
          <ProgressRing
            px={px}
            fps={fps}
            frame={frame}
            startFrame={Math.round(
              (card.durationSec ?? prayerTextStart + 2) * fps,
            )}
            durationInFrames={durationInFrames}
            isLandscape
            inline
            size={px(30)}
          />
        </div>
      ) : null}
      {card.attribution ? (
        // Source credit. Only set on this card when the structure has no
        // cover to carry it. Small and quiet: a footnote, not a fourth block.
        <div
          style={{
            position: "absolute",
            left: isLandscape ? undefined : q(40),
            right: isLandscape ? undefined : q(40),
            bottom: isLandscape ? px(36) : px(118),
            textAlign: isLandscape ? "left" : "center",
            fontFamily: textFont === "serif" ? SERIF : SANS,
            fontStyle: "italic",
            fontWeight: 300,
            fontSize: isLandscape ? px(10) : q(12.5),
            letterSpacing: 0.2,
            color: style.body,
            opacity: 0.55,
            ...reveal(frame, fps, 1.2, 1, "fade"),
          }}
        >
          {card.attribution}
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
  /** Clip-first structure: the film fills the portrait frame instead of
   *  sitting in the square window (landscape is always fitted full-frame). */
  const fullBleedVideo = isVideoCard && card.videoFill === "full"
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
  // The social opening lands IN the scene: a fast, strong push in over the
  // first second, easing out into the slow drift the rest of the piece uses
  // (owner: "as if we landed there quickly"). Never close enough to crop into
  // faces — it settles at 1.06, the same neighbourhood as everything else.
  // `watch` opening: the film is blurred behind the step's name, and the blur
  // lifts as the opening line finishes — the same move the hand-over screens
  // make, so the piece opens and hands over in one visual language.
  const watchIntroBlurPx =
    card.intro === "watch" && card.mutedLeadSec
      ? interpolate(
          frame,
          [
            0,
            Math.round(fps * 0.4),
            Math.round((card.mutedLeadSec - 1.1) * fps),
            Math.round(card.mutedLeadSec * fps),
          ],
          [px(3), px(6), px(6), 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        )
      : card.intro === "montage" && card.mutedLeadSec && !card.introCta
        ? montageWatchBlur(
            frame / fps,
            montageLineStarts(
              card.introParts ?? [],
              card.words ?? [],
              card.mutedLeadSec,
            ),
            card.mutedLeadSec,
            px(2.5),
          )
        : 0

  const kbLanding =
    card.kind === "quote-intro"
      ? // Starts after the opening fade from black (0.6s) — a push-in nobody
        // can see because the frame is still black is a push-in wasted.
        interpolate(
          frame,
          [Math.round(fps * 0.3), Math.round(fps * 1.5)],
          // Owner asked for a zoom IN: we arrive at the scene, fast and hard,
          // and settle — so the scale GROWS, and stops short of cropping into
          // anybody's face.
          [1.0, 1.22],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.out(Easing.cubic),
          },
        )
      : null

  const src = isVideoCard ? card.videoFile! : (card.bgFile ?? props.bgFile)
  // Cover (both orientations): centered lockup over CLEAR footage — no blur
  // band. A dark wash + inner vignette (below) keep the text readable, and the
  // footage's own blur eases from soft → sharp over the opening (per the design
  // spec: blur 12px → 0 over the first 60% of the card, easeOutCubic).
  const introCover = card.kind === "cover"
  // Blur behind the text only: a band for top/bottom-aligned cards, the whole
  // frame for centered text; the video card stays clear.
  const region = introCover
    ? "none"
    : blurRegionFor(card.kind, style, isLandscape)

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

  // The crop anchor in force at this instant: the last step whose time has
  // arrived. `undefined` when the manifest carries no anchors, which keeps the
  // pre-feature centre crop exactly as it was.
  const bgFocusX = (() => {
    const steps = card.bgFocus
    if (!steps || steps.length === 0) return undefined
    return focusAt(steps, frame / fps)
  })()

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
      // The social opening may slow its shot a touch so one unbroken take
      // covers the whole read (see `bgRate` in the card schema).
      playbackRate={card.bgRate ?? bgRate}
      // Text-card backgrounds are MUTED (music only) unless bgAudio is on
      // (teasers). Decoupled from videoAudioLevel so a full devo can set the
      // video-card level for balance without un-muting the reflection.
      muted={!props.bgAudio}
      volume={
        props.bgAudio
          ? (f) => {
              const fade = Math.round(0.5 * fps)
              // Teaser CTA: the film goes quiet under the call to action.
              const hush =
                props.ctaMusicAtSec != null
                  ? interpolate(
                      f,
                      [
                        Math.round((props.ctaMusicAtSec - 0.4) * fps),
                        Math.round(props.ctaMusicAtSec * fps),
                      ],
                      [1, 0],
                      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
                    )
                  : 1
              return (
                (props.videoAudioLevel ?? 0.3) *
                0.5 *
                hush *
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
        // Crop toward the face the current shot is about, when the manifest
        // carries anchors. Stepped, not eased: each step lands on a cut in the
        // footage, so the crop moves only where the picture already moves.
        ...(bgFocusX != null
          ? {
              objectPosition: `${(
                coverObjectPositionX(
                  bgFocusX,
                  { width, height },
                  { width: 16, height: 9 },
                ) * 100
              ).toFixed(2)}% 50%`,
            }
          : {}),
        // Cover: sharp graded footage at a constant slight zoom (full-bleed,
        // no blur); other text cards dim + Ken-Burns behind the blur band.
        filter: introCover
          ? (props.mediaFilterOverride ?? style.mediaBase) || undefined
          : `${props.mediaFilterOverride ?? style.mediaBase} brightness(0.85)`.trim(),
        // The social opening arrives with a hard push in (kbLanding); the
        // cover holds a constant slight zoom; everything else drifts.
        transform: kbLanding
          ? `scale(${kbLanding})`
          : introCover
            ? "scale(1.04)"
            : `scale(${kb})`,
      }}
    />
  )
  const bgTextLayer = bgTextVideo
  // `montage` opening: each borrowed shot pushes in slowly, cut to cut.
  const montageScale =
    isVideoCard && card.intro === "montage"
      ? montagePush(
          frame / fps,
          montageLineStarts(
            card.introParts ?? [],
            card.words ?? [],
            card.mutedLeadSec ?? 0,
          ),
          card.mutedLeadSec ?? 0,
        )
      : 1

  // The video card shows the horizontal clip FITTED (whole frame visible) with a
  // blurred, enlarged copy filling the wings — no dead letterbox bars. Text
  // cards show the footage lightly dimmed; the blur comes from the overlay so
  // only the text region is obscured.
  const media = !src ? null : isVideoCard ? (
    <>
      {/* Blurred wings fill. Natural color by default; an optional
          videoCardFilter cools/tints warm source footage to match the grade. */}
      {fullBleedVideo ? null : (
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
      )}
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
          // Full-frame (clip-first): the film's sound carries through the
          // card's breath tail up to the cut, instead of fading half a second
          // before the tail begins — that left 1.7s of near-silence between
          // the last line and the stepper's music.
          // A short (feat-573) ends on the film itself: its sound runs to
          // the last frames, past the closing words (owner, 2026-10-02: the
          // fade took the important last words down with it).
          const clipEnd = props.shortForm
            ? durationInFrames
            : Math.round(
                ((card.durationSec ?? 1) +
                  (fullBleedVideo ? CARD_TAIL_FRAMES / fps : 0)) *
                  fps,
              )
          // Owner rule: open the clip SILENT while "Let's watch" is on screen,
          // then ease its sound in — so the cut into the film lands as a beat
          // rather than a jump in volume.
          // With an intro overlay the lead is silent footage only in name:
          // the owner wants the film heard from the first frame, the overlay
          // sitting over a speaking film rather than a muted one.
          const lead = card.intro
            ? 0
            : Math.round((card.mutedLeadSec ?? 0) * fps)
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
          // The tail used to start 1.3s before the card ended AND square the
          // curve, so it was already well down while the film was still
          // speaking — the owner could not hear Jesus' last words. The card's
          // own duration ends about where the dialogue does (the extra margin
          // footage sits past it), so the fade is now short and linear, and
          // rides the crossfade into the next card instead of pre-empting it.
          // Full-frame film (clip-first): the fade used to start half a second
          // before the cut and took the closing words down with it (owner:
          // "the last important words are muted"). It now happens in the last
          // quarter second, after the line has finished.
          // Full-frame film: 0.25s still took the tail of the closing word
          // when the scene ends on it, which is exactly what chapter 7 does.
          const fout = Math.round(
            (props.shortForm ? 0.5 : slow ? 2 : fullBleedVideo ? 0.12 : 0.5) *
              fps,
          )
          const rise = interpolate(f, [lead, lead + fin], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })
          const fall = interpolate(f, [clipEnd - fout, clipEnd], [1, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })
          // `hook` intro: the film keeps playing under the spoken question but
          // well down, and comes up over the last second of the lead — the
          // question has to be the thing being listened to.
          const hookLead =
            card.intro === "hook" || card.intro === "watch"
              ? Math.round((card.mutedLeadSec ?? 0) * fps)
              : 0
          const duck =
            hookLead > 0
              ? interpolate(
                  f,
                  [hookLead - Math.round(1.0 * fps), hookLead],
                  [INTRO_HOOK_FILM_DUCK, 1],
                  { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
                )
              : 1
          // Teaser CTA: the film goes quiet and the bed takes over (owner,
          // 2026-10-05: the scene's voices under the call to action
          // distracted). The teaser is one card, so `f` is the piece's frame.
          const ctaAt =
            props.ctaMusicAtSec != null
              ? Math.round(props.ctaMusicAtSec * fps)
              : null
          const ctaHush =
            ctaAt != null
              ? interpolate(f, [ctaAt - Math.round(0.4 * fps), ctaAt], [1, 0], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                })
              : 1
          return (
            clipAudioLevel *
            Math.sqrt(rise) *
            (slow ? fall * fall : fall) *
            duck *
            ctaHush
          )
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
                filter:
                  `${videoGrade ?? ""} ${watchIntroBlurPx > 0.05 ? `blur(${watchIntroBlurPx.toFixed(2)}px)` : ""}`.trim() ||
                  undefined,
                transform: `scale(${(kbFit * montageScale).toFixed(5)})`,
              }
            : fullBleedVideo
              ? {
                  // Clip-first: the film owns the whole 9:16 frame. A 16:9
                  // source loses 34% either side here, so the crop follows the
                  // faces via `clipFocus` when the manifest carries a path.
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  ...(card.intro === "montage" && card.introFocus?.length
                    ? {
                        // Each borrowed shot is framed on its own subject.
                        objectPosition: `${(
                          coverObjectPositionX(
                            montageFocusAt(
                              frame / fps,
                              montageLineStarts(
                                card.introParts ?? [],
                                card.words ?? [],
                                card.mutedLeadSec ?? 0,
                              ),
                              card.introFocus,
                            ),
                            { width, height },
                            { width: 16, height: 9 },
                          ) * 100
                        ).toFixed(2)}% 50%`,
                      }
                    : card.clipFocus && card.clipFocus.length > 0
                      ? {
                          objectPosition: `${(
                            coverObjectPositionX(
                              pathAt(
                                card.clipFocus,
                                (frame +
                                  (props.continuousClip
                                    ? Math.max(0, Math.round(bgStartFrame))
                                    : 0)) /
                                  fps,
                              ),
                              { width, height },
                              { width: 16, height: 9 },
                            ) * 100
                          ).toFixed(2)}% 50%`,
                        }
                      : {}),
                  filter: videoGrade || undefined,
                  transform: `scale(${(kbFit * montageScale).toFixed(5)})`,
                }
              : {
                  // Portrait: squarish crop (owner), anchored near the TOP of
                  // the frame — the space below is for captions, not a mirror
                  // margin of blurred wings.
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: `${VIDEO_WINDOW_TOP_PCT}%`,
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
  // Desktop (16:9) was "blur 10%" (px2.8) and mobile (9:16) "blur 15%" (px4.2).
  // Owner asked for roughly 7% instead of 10% now that a reflection card shows
  // ONE sentence: less text on screen means the footage behind it can be more
  // legible. 0.7x of the old values, which is exactly that. Legibility comes
  // from the scrim + a soft, wide text shadow, not from the blur.
  //
  // Scripture (soft) and questions (medium) are NOT reduced: both were tuned
  // separately, and the questions card had its own "too strong" correction
  // already. Only the two cards the owner named move.
  const heavyBlurPx = isLandscape ? px(2) : px(2.9)
  /** The cover carries one line of title over the footage; same 0.7x. */
  const coverBlurPx = px(5.6)
  // A cover asked to stay sharp keeps the footage unblurred and takes only a
  // light scrim — enough for one line of white text, not enough to hide what
  // the shot is. Cover only; every other card still needs its blur to be read.
  const sharpCover = Boolean(props.coverBgSharp) && card.kind === "cover"
  const BLUR = sharpCover
    ? 0
    : // The social opening carries its reading over a moving picture: a light
      // blur keeps the film present without pulling the eye off the words
      // (owner: "the video distracts me from reading"). It LIFTS across the
      // card — by the time the last line is read the picture is sharp again,
      // so the opening hands over to a clear scene rather than cutting to one.
      card.kind === "quote-intro"
      ? interpolate(
          frame,
          [0, Math.round(durationInFrames * 0.82)],
          [px(6.5) * blurScale, 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        )
      : (card.kind === "cover"
          ? coverBlurPx
          : soft
            ? px(8)
            : medium
              ? px(15)
              : heavyBlurPx) * blurScale
  const wholeScrim =
    card.kind === "quote-intro"
      ? "rgba(6,4,3,0.42)"
      : sharpCover
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
            transform: `scale(${kbLanding ?? (isVideoCard ? kbFit : kb)})`,
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
          background: style.splitToneShadow ?? "rgb(10,54,64)",
          mixBlendMode: "screen",
          opacity: style.splitToneShadowOpacity ?? 0.6,
          pointerEvents: "none",
        }}
      />
      <AbsoluteFill
        style={{
          background: style.splitToneHighlight ?? "rgb(240,176,116)",
          mixBlendMode: "multiply",
          opacity: style.splitToneHighlightOpacity ?? 0.55,
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

  // Two-panel stretches (clip-first, wide shots). Rendered over the card's own
  // video, which keeps playing underneath and carries the sound.
  const splitFade = 0.35
  const splitRange =
    fullBleedVideo && src && card.clipSplits
      ? card.clipSplits.find(
          (w) =>
            frame / fps >= w.fromSec - splitFade &&
            frame / fps <= w.toSec + splitFade,
        )
      : undefined
  const splitPanels =
    splitRange && src ? (
      <ClipSplitPanels
        src={staticFile(src)}
        trimBefore={
          props.continuousClip ? Math.max(0, Math.round(bgStartFrame)) : 0
        }
        focusX={
          splitRange.path && splitRange.path.length > 0
            ? pathAt(
                splitRange.path.map((p) => ({ atSec: p.atSec, x: p.x })),
                frame / fps,
              )
            : card.clipFocus && card.clipFocus.length > 0
              ? pathAt(card.clipFocus, frame / fps)
              : 0.5
        }
        focusY={
          splitRange.path && splitRange.path.length > 0
            ? pathAt(
                splitRange.path.map((p) => ({ atSec: p.atSec, x: p.y })),
                frame / fps,
              )
            : 0.42
        }
        width={width}
        height={height}
        opacity={interpolate(
          frame / fps,
          [
            splitRange.fromSec - splitFade,
            splitRange.fromSec,
            splitRange.toSec,
            splitRange.toSec + splitFade,
          ],
          [0, 1, 1, 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        )}
        {...(videoGrade ? { grade: videoGrade } : {})}
      />
    ) : null

  return (
    <AbsoluteFill style={{ backgroundColor: style.mediaBg }}>
      {src ? media : <AbsoluteFill style={{ background: style.textBg }} />}
      {splitPanels}
      {splitToneLayers}
      {bloom}
      {blurOverlay}
      {coverScrim}
      <Grain
        opacity={
          (heavy ? style.grainText : style.grainMedia) + (film ? 0.16 : 0)
        }
        sizePx={props.grainSizePx}
        tint={props.grainFilter}
        blend={props.grainBlend}
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
/**
 * Opacity knots for the muted-lead label ("Let's watch") over a video card:
 * fade in, hold, fade out. Exported for the test, because the monotonicity
 * Remotion's `interpolate` requires used to be an unwritten consequence of two
 * Math calls — the range was `[0.15, 0.75, Math.max(1, lead - 0.35), lead +
 * 0.35]`, which is only increasing while lead > 0.65. A shorter lead threw on
 * the card's first frame, and nothing upstream ruled one out.
 */
/**
 * `object-position` X for a cover-fitted frame, so that the point at `focusX`
 * of the SOURCE lands in the middle of the card.
 *
 * Not the identity: `object-position: 60%` does not put source-x 0.6 in the
 * centre, it distributes the OVERFLOW. Fitting 16:9 into a 9:16 card overflows
 * by more than twice the visible width, so treating the focus point as the
 * percentage directly under-corrects badly — a face at 0.8 would still be cut.
 *
 * Returns 0.5 when the source does not overflow (the 16:9 cut), where
 * object-position has nothing to distribute and the value is inert anyway.
 */
/**
 * Crop-move speed, in fractions of the SOURCE width per second.
 *
 * The smart-crop planner in this repo caps its pans at 240 px/s on a 1920-wide
 * source — 0.125 of the width per second. A fixed DURATION, which is what this
 * used to be, ignores distance: a short hop crawled and a long one flew, and
 * the long ones are the moves that read as sharp. Tying time to distance is
 * the rule that planner already encodes.
 *
 * Their number, adopted: the owner has seen footage cropped by that planner
 * and said it looked right. A typical move here is around 0.4 of the width, so
 * it now takes about three seconds — slow enough that the eye follows it
 * rather than catching it.
 */
export const FOCUS_SPEED_PER_SEC = 0.125
/** No move is snappier than this, however short. */
export const FOCUS_EASE_MIN_SEC = 0.8
/** ...or slower than this, however far. */
export const FOCUS_EASE_MAX_SEC = 3.5

/** How long the move from `from` to `to` takes. */
export function focusEaseSec(from: number, to: number): number {
  const d = Math.abs(to - from)
  return Math.min(
    FOCUS_EASE_MAX_SEC,
    Math.max(FOCUS_EASE_MIN_SEC, d / FOCUS_SPEED_PER_SEC),
  )
}

/**
 * The crop anchor in force at `tSec`, given the card's steps.
 *
 * A step that landed on a cut in the footage takes effect instantly — the
 * picture is changing anyway, so the crop changing with it cannot be seen. A
 * step marked `ease` could NOT be put on a cut, and cutting the crop inside a
 * held shot is exactly the lurch the owner objected to; those glide instead.
 */
export function focusAt(
  steps: ReadonlyArray<{ atSec: number; x: number; ease?: boolean }>,
  tSec: number,
): number {
  const eased = (from: number, to: number, at: number, t: number) => {
    const p = Math.max(0, Math.min(1, (t - at) / focusEaseSec(from, to)))
    // easeInOutSine: the gentlest of the standard curves at both ends.
    return from + (to - from) * (-(Math.cos(Math.PI * p) - 1) / 2)
  }
  // Glide from where the crop ACTUALLY is, not from the last step's target. If
  // a move begins while an earlier glide is still running, starting from that
  // glide's destination teleports the crop to a place it never reached — a
  // snap in the middle of what should be smooth. The planner also spaces moves
  // so this should not arise; this makes it harmless when it does.
  let prev = steps[0].x
  let current = steps[0].x
  let currentAt = steps[0].atSec
  let currentEase = false
  for (const step of steps) {
    if (step.atSec > tSec) break
    prev =
      currentEase && step.atSec < currentAt + focusEaseSec(prev, current)
        ? eased(prev, current, currentAt, step.atSec)
        : current
    current = step.x
    currentAt = step.atSec
    currentEase = step.ease === true
  }
  if (!currentEase || tSec >= currentAt + focusEaseSec(prev, current))
    return current
  return eased(prev, current, currentAt, tSec)
}

/**
 * Value of a piecewise-linear path at `tSec`. Holds the first point before the
 * path starts and the last after it ends. Two points a frame apart make an
 * effectively instant jump — how a cut in the footage is followed.
 */
export function pathAt(
  points: ReadonlyArray<{ atSec: number; x: number }>,
  tSec: number,
): number {
  if (points.length === 0) return 0.5
  if (tSec <= points[0].atSec) return points[0].x
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (tSec <= b.atSec) {
      const span = b.atSec - a.atSec
      if (span <= 0) return b.x
      return a.x + (b.x - a.x) * ((tSec - a.atSec) / span)
    }
  }
  return points[points.length - 1].x
}

export function coverObjectPositionX(
  focusX: number,
  box: { width: number; height: number },
  source: { width: number; height: number },
): number {
  const scaled = (source.width / source.height) * box.height
  const overflow = scaled - box.width
  if (overflow <= 0) return 0.5
  const p = (focusX * scaled - box.width / 2) / overflow
  return Math.min(1, Math.max(0, p))
}

export function leadLabelKnots(
  leadSec: number,
): [number, number, number, number] {
  const holdUntil = Math.max(0.9, leadSec - 0.35)
  return [0.15, 0.75, holdUntil, holdUntil + 0.35]
}

const TEXT_FADE_OUT_SEC = 0.55

/** Fades a card in over its first `xfade` frames — with overlapping sequences
 * this dissolves the previous card into the next (a slow crossfade). */
/**
 * A card's opacity `f` frames in, over an `xfade`-frame dissolve.
 *
 * A zero-length fade is a HARD CUT, and it has to short-circuit: interpolate
 * over [0, 0] is not a strictly increasing range and Remotion throws on it,
 * on every frame of the card.
 */
export function cardFadeOpacity(f: number, xfade: number): number {
  if (xfade <= 0) return 1
  return interpolate(f, [0, xfade], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
}

/**
 * Corner progress ring for the clip-first structure: one ring per STEP, not
 * per card. The film is WATCH; everything between the two stepper screens is
 * REFLECT (reflection, takeaway, verse); everything after the second is PRAY.
 * The dot completes its circle exactly as the step's last card ends, and the
 * ring is absent on the stepper screens themselves, which announce the step.
 *
 * Placed inside the safe area of every phone the piece is posted to: 70 units
 * from the top clears the Reels / TikTok headers, 48 from the right clears the
 * edge without hugging it.
 */
const STEP_RING_TOP = 74
const STEP_RING_RIGHT = 48
const STEP_RING_SIZE = 48

export function stepGroups(
  cards: ReadonlyArray<{ kind: string; intro?: string; mutedLeadSec?: number }>,
  frames: ReadonlyArray<{ from: number; durationInFrames: number }>,
  fps = 30,
): Array<{ from: number; to: number }> {
  const groups: Array<{ from: number; to: number }> = []
  let open: { from: number; to: number } | null = null
  cards.forEach((c, i) => {
    const f = frames[i]
    if (!f) return
    if (c.kind === "step") {
      if (open) groups.push(open)
      open = null
      return
    }
    // The social opening runs before the piece has started — no clock on it.
    if (c.kind === "quote-intro") {
      if (open) groups.push(open)
      open = null
      return
    }
    // A film card with an intro overlay clocks from where the film proper
    // begins, after the intro's lead: the ring belongs to the clip, not to
    // the title over it (owner).
    // The step clock waits for the intro to clear: while the mark and the
    // series name are on screen the ring is a second thing to read (owner).
    // `hook` puts nothing on screen, so the ring only waits for the spoken
    // question to finish; `cover`/`bands` also wait out the header.
    const introLead =
      c.intro && c.mutedLeadSec
        ? Math.round(
            (c.mutedLeadSec +
              (c.intro === "hook" || c.intro === "watch"
                ? 0
                : INTRO_HEADER_HOLD_SEC + INTRO_HEADER_FADE_SEC)) *
              fps,
          )
        : 0
    if (!open)
      open = { from: f.from + introLead, to: f.from + f.durationInFrames }
    else open.to = f.from + f.durationInFrames
  })
  if (open) groups.push(open)
  return groups
}

/**
 * The stage clock as a row across the top: WATCH - REFLECT - PRAY, the live one
 * gold, the ones behind it white, the ones ahead held at a third opacity, and
 * the hairline between two names filling across the stage it belongs to.
 *
 * The stage boundaries come from the STEP cards themselves: a step card is the
 * screen that hands one stage to the next, so its first frame is exactly when
 * the new stage begins. The opening (a quote card, or a film card's intro lead)
 * is not part of any stage, so the row waits for it.
 */
function StepRowOverlay({
  cards,
  frames,
  frame,
  fps,
  px,
  stepLabels,
}: {
  cards: ReadonlyArray<{
    kind: string
    intro?: string
    mutedLeadSec?: number
    steps?: ReadonlyArray<string>
    introParts?: ReadonlyArray<string>
    words?: ReadonlyArray<{ word: string; startSec: number; endSec: number }>
  }>
  frames: ReadonlyArray<{ from: number; durationInFrames: number }>
  frame: number
  fps: number
  px: (n: number) => number
  stepLabels?: ReadonlyArray<string>
}) {
  const labels = stepLabels ?? ["WATCH", "REFLECT", "PRAY"]
  // The first stage starts where the film does — after a quote opening, and
  // after an intro lead on the film card itself.
  const filmIndex = cards.findIndex((c) => c.kind === "video")
  const film = filmIndex >= 0 ? frames[filmIndex] : undefined
  const introLead =
    filmIndex >= 0 && cards[filmIndex].intro && cards[filmIndex].mutedLeadSec
      ? Math.round(
          ((cards[filmIndex].mutedLeadSec ?? 0) +
            (cards[filmIndex].intro === "hook" ||
            cards[filmIndex].intro === "watch"
              ? 0
              : INTRO_HEADER_HOLD_SEC + INTRO_HEADER_FADE_SEC)) *
            fps,
        )
      : 0
  const stageStarts = cards
    .map((c, i) => (c.kind === "step" ? frames[i]?.from : undefined))
    .filter((f): f is number => f != null)
  const watchIntro = filmIndex >= 0 && cards[filmIndex].intro === "watch"
  // `watch`: the row appears with the THIRD beat of the opening, when the
  // voice says "Let's watch" — not before (owner).
  const watchRowAt = watchIntro
    ? Math.round(
        (introPartTimes(
          cards[filmIndex].introParts ?? [],
          cards[filmIndex].words ?? [],
        )[2]?.from ?? 0) * fps,
      )
    : 0
  const starts = [
    (film?.from ?? 0) + (watchIntro ? watchRowAt : introLead),
    ...stageStarts.slice(0, labels.length - 1),
  ]
  if (starts.length < labels.length) return null
  const last = frames[frames.length - 1]
  const endFrame = last ? last.from + last.durationInFrames : starts[0]
  // Nothing before the first stage: the opening is its own thing.
  const on = interpolate(
    frame,
    [starts[0] - 0.3 * fps, starts[0] + 0.5 * fps],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  )
  if (on <= 0.01) return null
  return (
    <>
      {/* A soft dark ellipse behind the row so the labels read over bright
          film (Figma 366-2094: 868×126 at 1080p, black 60% → 0, blur 40,
          85% opacity). */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: px(27.7),
          width: px(289.3),
          height: px(42),
          transform: "translate(-50%, -50%)",
          borderRadius: px(33),
          background:
            "radial-gradient(closest-side, rgba(0,0,0,0.6), rgba(0,0,0,0))",
          // Figma's layer blur 40 is about half that as a CSS radius.
          filter: `blur(${px(6.7)}px)`,
          opacity: 0.85 * on,
          pointerEvents: "none",
        }}
      />
      <div style={{ position: "absolute", top: px(24), left: 0, right: 0 }}>
        <StepProgressLine
          steps={labels}
          starts={starts}
          endFrame={endFrame}
          frame={frame}
          fps={fps}
          px={px}
          widthPx={px(287)}
          opacity={on}
        />
      </div>
    </>
  )
}

function StepRingOverlay({
  cards,
  frames,
  frame,
  fps,
  px,
  shape,
}: {
  cards: ReadonlyArray<{ kind: string; intro?: string; mutedLeadSec?: number }>
  frames: ReadonlyArray<{ from: number; durationInFrames: number }>
  frame: number
  fps: number
  px: (n: number) => number
  shape: "ring" | "bar"
}) {
  const group = stepGroups(cards, frames, fps).find(
    (g) => frame >= g.from && frame < g.to,
  )
  if (!group) return null
  if (shape === "bar") {
    return (
      <StepBar
        px={px}
        fps={fps}
        frame={frame - group.from}
        durationInFrames={group.to - group.from}
      />
    )
  }
  return (
    <div
      style={{
        position: "absolute",
        top: px(STEP_RING_TOP),
        right: px(STEP_RING_RIGHT),
        pointerEvents: "none",
      }}
    >
      <ProgressRing
        px={px}
        fps={fps}
        frame={frame - group.from}
        startFrame={0}
        durationInFrames={group.to - group.from}
        isLandscape={false}
        inline
        size={px(STEP_RING_SIZE)}
      />
    </div>
  )
}

/**
 * The step clock as a line: the ring's glowing point travelling left to right
 * along a thin track across the top of the frame, a gold trail filling behind
 * it. Inside the social safe area: 60 units in from either side (the caption
 * column's insets) and 70 from the top, under the Reels / TikTok headers.
 */
const STEP_BAR_INSET = 60
const STEP_BAR_TOP = 72

function StepBar({
  px,
  fps,
  frame,
  durationInFrames,
}: {
  px: (n: number) => number
  fps: number
  frame: number
  durationInFrames: number
}) {
  const p = Math.max(0, Math.min(1, frame / Math.max(1, durationInFrames)))
  const appear = Math.max(0, Math.min(1, frame / (0.5 * fps)))
  const pulse = 0.5 + 0.5 * Math.sin((frame / fps) * ((Math.PI * 2) / 4))
  const dot = px(9.5)
  return (
    <div
      style={{
        position: "absolute",
        left: px(STEP_BAR_INSET),
        right: px(STEP_BAR_INSET),
        top: px(STEP_BAR_TOP),
        height: dot,
        opacity: appear,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: "50%",
          height: px(1.1),
          marginTop: -px(0.55),
          borderRadius: px(1),
          background: "rgba(255,255,255,0.10)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          width: `${p * 100}%`,
          top: "50%",
          height: px(1.1),
          marginTop: -px(0.55),
          borderRadius: px(1),
          background: "#d8ad5c",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: `${p * 100}%`,
          top: "50%",
          width: dot,
          height: dot,
          borderRadius: "50%",
          transform: "translate(-50%, -50%)",
          background:
            "radial-gradient(circle, #fff, #fbead8 30%, #f4d98f 58%, #e9c477 100%)",
          filter: `blur(${px(0.9)}px)`,
          boxShadow: `0 0 ${px(4) + px(3) * pulse}px ${px(1)}px rgba(232,196,119,0.55)`,
        }}
      />
    </div>
  )
}

function CardFade({ xfade, children }: { xfade: number; children: ReactNode }) {
  const f = useCurrentFrame()
  return (
    <AbsoluteFill style={{ opacity: cardFadeOpacity(f, xfade) }}>
      {children}
    </AbsoluteFill>
  )
}

export function DevotionalVideo(props: DevotionalInputProps) {
  loadShortFonts()
  loadLiterata()
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
  // `xfadeSec: 0` means hard cuts EVERYWHERE, the video card's own dissolves
  // included — asked for so the picture switches in one frame rather than two
  // cards sharing the screen for the better part of a second. The verse hold
  // into the clip is a deliberate overlap of TEXT, not a dissolve, so it is the
  // one thing a hard cut keeps.
  const hardCuts = XFADE <= 0
  const boundaryXfade = (i: number) =>
    holdsIntoVideo(i)
      ? verseHoldFrames
      : hardCuts
        ? 0
        : props.cards[i]?.kind === "video" ||
            props.cards[i + 1]?.kind === "video"
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
                  // `hook`: the bed plays UNDER the spoken question and ducks
                  // only when the film's own sound arrives. Muting it from the
                  // card's first frame left the opening on dead air — the lead
                  // is silent footage, so there was nothing else to hear.
                  // `opening` likewise (owner-reported on the vineyard cut:
                  // three seconds of digital silence after the spoken title,
                  // because the bed was muted for the whole film card and the
                  // borrowed lead footage is silent by design).
                  // For `opening` the bed hands over to the NARRATOR, not to the
                  // cut: a scene can open on seconds of near-silent picture
                  // (LUMO's vineyard does, ~2.4s at -45 dB), and ducking at the
                  // cut left exactly that as dead air after the title.
                  start:
                    c.intro === "hook"
                      ? frames[i].from + Math.round((c.mutedLeadSec ?? 0) * fps)
                      : c.intro === "opening" || c.intro === "montage"
                        ? frames[i].from +
                          Math.round(
                            Math.max(
                              c.mutedLeadSec ?? 0,
                              c.subtitles?.[0]?.startSec ?? 0,
                            ) * fps,
                          )
                        : frames[i].from,
                  // Keep the music muted through the trailing crossfade too —
                  // the clip's own audio plays until the video card fully
                  // dissolves into the next. Must match the ACTUAL transition
                  // length at this boundary (boundaryXfade), not the generic
                  // XFADE — the video→reflection dissolve runs at VIDEO_XFADE
                  // (1.3s), longer than the 0.85s default. Using the shorter
                  // generic value here let the music swell back in ~0.45s
                  // before the clip's own dialogue actually finished dissolving
                  // out, drowning the last words (owner-reported).
                  end:
                    frames[i].from +
                    frames[i].durationInFrames +
                    (i < lastIndex ? boundaryXfade(i) : 0) -
                    // Full-frame film (clip-first): the bed starts rising a
                    // second BEFORE the cut, under the film's last, quiet
                    // beat, and is at level as the stepper lands. Held to the
                    // cut, the join measured 0.9s at -60dB: the last line ends
                    // early and the film's own tail there is near-silent.
                    (c.videoFill === "full" ? Math.round(1.0 * fps) : 0),
                  fade:
                    c.videoFill === "full"
                      ? Math.round(1.0 * fps)
                      : Math.round(0.4 * fps),
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
  // Skip the take's fade-in when asked (clip-first): the first card on the
  // take is the stepper, right after a hard cut from the film, and a black
  // frame there is a flash rather than an opening.
  let bgAcc = Math.round((props.bgStartOffsetSec ?? 0) * fps)
  // Where the bed is allowed in when the piece opens on a quote card.
  const quoteIntroIndex = props.cards.findIndex((c) => c.kind === "quote-intro")
  const quoteIntroMusicAt =
    quoteIntroIndex >= 0 && frames[quoteIntroIndex]
      ? frames[quoteIntroIndex].from +
        Math.round(
          quoteIntroTimeline({
            quoteA: props.cards[quoteIntroIndex].quoteA ?? "",
            quoteB: props.cards[quoteIntroIndex].quoteB ?? "",
            questions: props.cards[quoteIntroIndex].questionsList ?? [],
          }).watchAt * fps,
        )
      : null

  const bgStartFrames = props.cards.map((c, i) => {
    // A video card normally shows its OWN window, so it starts at frame 0 and
    // does not consume any of the shared take. `continuousClip` makes it part
    // of the same take instead — it starts where the backdrop left off and
    // advances the accumulator like any other card, so nothing is replayed.
    if (c.kind === "video" && !props.continuousClip) return 0
    // The social opening picks its OWN shot out of the take (owner chose the
    // wide of Jesus with his back to the crowd) and does not consume the
    // take's timeline: the cards after it start where they always did.
    if (c.kind === "quote-intro" && c.bgStartSec != null)
      // `bgStartSec` is a time in the TAKE itself, so it converts with the
      // take's own frame rate — the playback-rate scaling applies to how fast
      // cards walk the take, not to a fixed point inside it.
      return Math.round(c.bgStartSec * fps)
    const start = bgAcc
    // Advance by the card's frames scaled by the playback rate — the clip
    // advances `bgRate` film-frames per composition frame, so the window
    // offsets stay aligned to the (slightly slowed) shared take.
    bgAcc += frames[i].durationInFrames * bgRate
    return start
  })

  // Side credits (owner's Figma "test", 2026-09-29): the credit in a column
  // left of the text for three sentences; see SideSourceMark.
  const sideMarks =
    isLandscape && wideText === "bottom" && props.markLayout === "side"
  const sideWindows = useSideMarkLayout({
    enabled: sideMarks,
    cards: props.cards,
    frameW: width,
    frameH: height,
    textFamily: SANS,
    textPx: px(22),
  })
  const layoutCard = (card: DevotionalCard, i: number): DevotionalCard => {
    if (!sideMarks || card.kind !== "reflection-focus") return card
    const w = sideWindows.find((x) => i >= x.mark && i <= x.last)
    // The sentence rides the drawer: beside the rule at the left edge while
    // it is closed, pushed to its column as it opens. Its width never changes,
    // so the words do not rewrap while it moves.
    const shift = (() => {
      if (!w) return 0
      const from = frames[w.mark].from
      const to = frames[w.last].from + frames[w.last].durationInFrames
      const { open } = sideDrawer((frame - from) / fps, (to - from) / fps)
      return (1 - open) * (w.textLeft - w.left - px(((2 + 56) * 390) / 1080))
    })()
    return {
      ...card,
      wideBottomPx: (SIDE_BOTTOM * Math.min(width, height)) / 1080,
      ...(w
        ? {
            markColumn: {
              top: w.top,
              left: w.textLeft - shift,
              width: w.textWidth,
            },
          }
        : {}),
    }
  }

  return (
    <AbsoluteFill style={{ backgroundColor: "#0c0805" }}>
      {props.cards.map((rawCard, i) => {
        const card = layoutCard(rawCard, i)
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
          // A short breath fades the text within it, not over the last word.
          card.tailSec != null
            ? Math.max(4, Math.round((card.tailSec + 0.1) * fps))
            : Infinity,
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
                  {...(props.filmCaptionStyle
                    ? { filmCaptionStyle: props.filmCaptionStyle }
                    : {})}
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
                  hideRing={props.stepRing === true}
                  pieceSec={durationInFrames / fps}
                  hideCoverDate={props.hideCoverDate === true}
                  hideCoverLogo={props.hideCoverLogo === true}
                  coverDateLabel={props.coverDateLabel}
                  coverTitleFirst={props.coverTitleFirst === true}
                  coverTextStatic={props.coverTextStatic === true}
                  coverSecondaryLine={props.coverSecondaryLine}
                  bleedX={columnInset}
                  {...(props.textFont ? { textFont: props.textFont } : {})}
                />
              </div>
            </CardFade>
            {card.audioFile ? (
              <Sequence from={audioDelay}>
                <Audio
                  src={staticFile(card.audioFile)}
                  volume={props.voiceVolume ?? 1}
                />
              </Sequence>
            ) : null}
          </Sequence>
        )
      })}
      {/* Source credits (16:9): their own layer, so a credit can outlast
          the one-sentence card it opens. See SourceMarkOverlay. */}
      {isLandscape || props.portraitMarks ? (
        <VerseCalloutOverlay
          cards={props.cards}
          frames={frames}
          frame={frame}
          fps={fps}
          px={px}
          serif={VERSE_SERIF}
        />
      ) : null}
      {sideMarks ? (
        <SideMarkOverlay
          windows={sideWindows}
          cards={props.cards}
          frames={frames}
          frame={frame}
          fps={fps}
          frameH={Math.min(width, height)}
        />
      ) : isLandscape && wideText === "bottom" ? (
        <SourceMarkOverlay
          cards={props.cards}
          frames={frames}
          frame={frame}
          fps={fps}
          px={px}
          textFamily={SANS}
          textWidth={columnWidth}
        />
      ) : !isLandscape && props.portraitMarks ? (
        // Just above the line the portrait sentence hangs from (the stable
        // top anchor, px(320)).
        <SourceMarkOverlay
          cards={props.cards}
          frames={frames}
          frame={frame}
          fps={fps}
          px={px}
          textFamily={SANS}
          textWidth={columnWidth}
          fixedBottomPx={height - px(320) + px(6)}
        />
      ) : null}
      {props.shortForm && !isLandscape ? <ShortBrand px={px} /> : null}
      {props.shortCards && !isLandscape ? (
        <ShortQuestionCards
          cards={props.shortCards}
          t={frame / fps}
          frameWidth={width}
        />
      ) : null}
      {props.stepRing ? (
        props.stepProgress === "ring" || props.stepProgress === "bar" ? (
          <StepRingOverlay
            cards={props.cards}
            frames={frames}
            frame={frame}
            fps={fps}
            px={px}
            shape={props.stepProgress}
          />
        ) : width > height ? (
          // Default since 2026-09-22 (owner) in 16:9 ONLY: the named row
          // across the top, each hairline filling as its own stage runs.
          <StepRowOverlay
            cards={props.cards}
            frames={frames}
            frame={frame}
            fps={fps}
            px={px}
            stepLabels={props.cards.find((c) => c.steps)?.steps}
          />
        ) : (
          // 9:16 keeps the corner progress ring it has always had. The named
          // row is a 16:9 device: in a feed that top strip belongs to the
          // app's own chrome, but the corner ring sits clear of it and is how
          // a vertical viewer knows how far through the stage they are
          // (owner, 2026-09-24).
          <StepRingOverlay
            cards={props.cards}
            frames={frames}
            frame={frame}
            fps={fps}
            px={px}
            shape="ring"
          />
        )
      ) : null}
      {/* Soft instrumental bed under everything: loops to fill the runtime.
          Starts from the VERY FIRST frame (short ~0.4s ramp so it's present
          under the opening, not a slow swell) and fades down under the close. */}
      {props.musicFile ? (
        <Audio
          src={staticFile(props.musicFile)}
          loop
          volume={(f) => {
            // A quote opening runs on its own sounds — typing and transitions.
            // The bed waits for "LET'S WATCH", where the piece proper begins
            // (owner: start the music after the questions).
            if (quoteIntroMusicAt != null && f < quoteIntroMusicAt) return 0
            const ctaAt =
              props.ctaMusicAtSec != null
                ? Math.round(props.ctaMusicAtSec * fps)
                : null
            const base = interpolate(
              f,
              [
                0,
                Math.round(0.4 * fps),
                // Teaser CTA: the bed carries the close, so it leaves late.
                durationInFrames -
                  Math.round((ctaAt != null ? 0.9 : 2.5) * fps),
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
            // Teaser CTA: the bed comes up to carry the call to action.
            const swell =
              ctaAt != null
                ? interpolate(
                    f,
                    [
                      ctaAt - Math.round(0.4 * fps),
                      ctaAt + Math.round(0.6 * fps),
                    ],
                    [1, CTA_MUSIC_SWELL],
                    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
                  )
                : 1
            if (videoWindows.length === 0 || (ctaAt != null && f >= ctaAt))
              return Math.min(1, base * swell)
            // 1 everywhere except 0 across EACH video card (short edge fades).
            // Take the lowest duck across all windows so overlapping fades
            // never let the bed swell back up between adjacent acts.
            const duck = videoWindows.reduce((lowest, w) => {
              const d = interpolate(
                f,
                [w.start - duckFade, w.start, w.end, w.end + w.fade],
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
  hideRing = false,
  pieceSec,
  hideCoverDate,
  hideCoverLogo,
  coverDateLabel,
  coverTitleFirst,
  coverTextStatic,
  coverSecondaryLine,
  textFont,
  bleedX,
  filmCaptionStyle,
}: {
  filmCaptionStyle?: "karaoke" | "typewriter" | "ghost" | "scroll"
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
  /** Closing card: leave out its own progress ring (a corner ring clocks the step). */
  hideRing?: boolean
  /** Whole piece length in seconds (the intro shows it rounded to minutes). */
  pieceSec?: number
  hideCoverDate?: boolean
  hideCoverLogo?: boolean
  coverDateLabel?: string
  coverTitleFirst?: boolean
  coverTextStatic?: boolean
  coverSecondaryLine?: string
  /** Typeface for the spoken-text cards; "serif" is the owner's trial look. */
  textFont?: "sans" | "serif"
  /** Landscape: the inset of the centred text column this card sits in. */
  bleedX?: number
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
        hideRing={hideRing}
        bleedX={bleedX ?? 0}
        {...(pieceSec != null ? { pieceSec } : {})}
        hideCoverDate={hideCoverDate}
        hideCoverLogo={hideCoverLogo}
        coverDateLabel={coverDateLabel}
        coverTitleFirst={coverTitleFirst}
        coverTextStatic={coverTextStatic}
        coverSecondaryLine={coverSecondaryLine}
        {...(textFont ? { textFont } : {})}
      />
      {card.kind === "video" && card.subtitles?.length ? (
        <VideoSubtitles
          {...(filmCaptionStyle ? { karaokeMode: filmCaptionStyle } : {})}
          cues={card.subtitles}
          style={style}
          px={px}
          frame={frame}
          fps={fps}
          isLandscape={layerIsLandscape}
          // Same Instagram Reels insets the text cards use, so captions
          // clear the action rail and the app's own bottom UI chrome.
          safeRight={px(50.5)}
          safeBottom={px(130)}
          fullBleed={card.videoFill === "full" && !layerIsLandscape}
          {...(card.captionStyle ? { captionStyle: card.captionStyle } : {})}
          {...(card.themeWord ? { themeWord: card.themeWord } : {})}
          frameHeight={layerH}
          frameWidth={layerW}
          bleedX={bleedX ?? 0}
          hideBeforeSec={
            // The scene's own dialogue starts exactly at the lead's end.
            card.intro === "hook" ||
            card.intro === "watch" ||
            card.intro === "opening" ||
            card.intro === "montage"
              ? (card.mutedLeadSec ?? 0)
              : 0
          }
        />
      ) : null}
      {showMuteButton ? <MuteButton px={px} style={style} /> : null}
    </AbsoluteFill>
  )
}
