import { AbsoluteFill } from "remotion"
import type { CSSProperties } from "react"

import type { ColdOpenLine } from "./schema"
import type { DevotionalStyle } from "./styles"
import { SANS, TEXT_SHADOW } from "./visual-primitives"
import {
  accentMix,
  coldOpenTimeline,
  cursorVisible,
  focusWordState,
  mixColour,
  stampScale,
  stampedWordIndex,
  typedCharCount,
} from "./cold-open-timing"

/**
 * The `cold-open` card: a short hook that runs before the devotional proper,
 * to tell a scrolling viewer this is a structured piece rather than a
 * fifteen-second reel.
 *
 * Each line gets its own entrance so the card builds a rhythm — typed, then
 * stamped word by word, then resolving out of blur — and every freshly
 * arrived word lands in the filter's accent colour before cooling to the
 * heading colour, so a warm edge keeps moving through the text.
 *
 * Only one line is on screen at a time; `coldOpenTimeline` owns the split.
 */
export function ColdOpen({
  lines,
  style,
  px,
  frame,
  fps,
  durationInFrames,
  uppercase = true,
}: {
  lines: ColdOpenLine[]
  style: DevotionalStyle
  px: (n: number) => number
  frame: number
  fps: number
  durationInFrames: number
  uppercase?: boolean
}) {
  const windows = coldOpenTimeline(lines, durationInFrames, fps)
  const active = windows.find(
    (w) => frame >= w.startFrame && frame < w.endFrame,
  )
  if (!active) return null

  const line = lines[active.index]
  if (!line) return null

  const elapsedSec = (frame - active.startFrame) / fps
  const warm = style.highlight
  const cool = style.heading
  const align = line.align ?? "center"
  const accentWord = line.accentWord?.toLowerCase()

  const base: CSSProperties = {
    fontFamily: SANS,
    fontWeight: 700,
    fontSize: px(line.sizePx ?? 34),
    lineHeight: 1.1,
    letterSpacing: px(-0.3),
    textShadow: TEXT_SHADOW,
    textTransform: uppercase ? "uppercase" : "none",
    // Side padding: the hook must never touch the frame edge, and must clear
    // the platform's own interface furniture.
    maxWidth: px(320),
    textAlign: align,
  }

  const holder: CSSProperties = {
    justifyContent: "center",
    alignItems: align === "left" ? "flex-start" : "center",
    padding: `0 ${px(36)}px`,
  }

  return (
    <AbsoluteFill style={holder}>
      {line.anim === "typewriter" ? (
        <Typed
          text={line.text}
          elapsedSec={elapsedSec}
          base={base}
          warm={warm}
          cool={cool}
          px={px}
        />
      ) : line.anim === "stamp" ? (
        <Stamped
          text={line.text}
          elapsedSec={elapsedSec}
          base={base}
          warm={warm}
          cool={cool}
          accentWord={accentWord}
        />
      ) : (
        <Focused
          text={line.text}
          elapsedSec={elapsedSec}
          base={base}
          warm={warm}
          cool={cool}
          accentWord={accentWord}
          px={px}
        />
      )}
    </AbsoluteFill>
  )
}

/** Types the line out left to right with a blinking cursor at the insertion point. */
function Typed({
  text,
  elapsedSec,
  base,
  warm,
  cool,
  px,
}: {
  text: string
  elapsedSec: number
  base: CSSProperties
  warm: string
  cool: string
  px: (n: number) => number
}) {
  const shown = typedCharCount(elapsedSec, text.length)
  const typing = shown < text.length
  const chars = [...text.slice(0, shown)]

  return (
    // The full line is reserved invisibly so the block never reflows as it
    // fills; the revealed prefix is painted over the top.
    <div style={{ position: "relative", ...base }}>
      <span aria-hidden style={{ visibility: "hidden" }}>
        {text}
      </span>
      <span style={{ position: "absolute", inset: 0 }}>
        {chars.map((ch, i) => {
          // Each character cools independently, so warmth trails the cursor.
          const ageSec = (shown - 1 - i) / 26
          return (
            <span
              key={i}
              style={{ color: mixColour(warm, cool, accentMix(ageSec)) }}
            >
              {ch}
            </span>
          )
        })}
        {cursorVisible(elapsedSec, typing) ? (
          <span
            style={{
              display: "inline-block",
              width: px(4),
              height: px(30),
              marginLeft: px(3),
              transform: `translateY(${px(3)}px)`,
              background: warm,
            }}
          />
        ) : null}
      </span>
    </div>
  )
}

/** One word at a time, each landing oversized and settling. */
function Stamped({
  text,
  elapsedSec,
  base,
  warm,
  cool,
  accentWord,
}: {
  text: string
  elapsedSec: number
  base: CSSProperties
  warm: string
  cool: string
  accentWord?: string
}) {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const index = stampedWordIndex(elapsedSec, words.length)
  if (index < 0) return null

  const word = words[index] ?? ""
  const ageSec = elapsedSec - index * 0.42
  const pinned =
    accentWord != null &&
    word.toLowerCase().replace(/[^a-z']/g, "") === accentWord

  return (
    <div
      style={{
        ...base,
        transform: `scale(${stampScale(ageSec)})`,
        opacity: Math.min(1, ageSec / 0.06),
        color: mixColour(warm, cool, accentMix(ageSec, pinned)),
      }}
    >
      {word}
    </div>
  )
}

/** Words resolve out of blur one after another, the calmest of the three. */
function Focused({
  text,
  elapsedSec,
  base,
  warm,
  cool,
  accentWord,
  px,
}: {
  text: string
  elapsedSec: number
  base: CSSProperties
  warm: string
  cool: string
  accentWord?: string
  px: (n: number) => number
}) {
  const words = text.trim().split(/\s+/).filter(Boolean)
  return (
    <div style={base}>
      {words.map((word, i) => {
        const { opacity, blurPx, ageSec } = focusWordState(elapsedSec, i)
        if (opacity <= 0) return null
        const pinned =
          accentWord != null &&
          word.toLowerCase().replace(/[^a-z']/g, "") === accentWord
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              marginRight: px(8),
              opacity,
              filter: blurPx > 0.3 ? `blur(${px(blurPx)}px)` : undefined,
              color: mixColour(warm, cool, accentMix(ageSec - 0.1, pinned)),
            }}
          >
            {word}
          </span>
        )
      })}
    </div>
  )
}
