import { useEffect, useState } from "react"
import { continueRender, delayRender, Easing, interpolate } from "remotion"

import { SHORT_FONT_FAMILIES } from "../fonts"
import type { DevotionalCard } from "./schema"
import type { CardFrames } from "./timing"
import { AnimatedBook, AnimatedScroll } from "./SourceEmblems"
import { measureText } from "./SourceMarkOverlay"
import { SOURCE_PORTRAIT_URIS, type SourcePortraitId } from "./source-portraits"
import { loadLiterata, TEASER_FONT_FAMILIES } from "./teaser-fonts"

/**
 * The side source credit for the 16:9 reflection (owner's Figma "test",
 * 2026-09-29):
 *
 *   [emblem]            │  The sentence, left aligned in the
 *   HISTORICAL CONTEXT  │  column beside the rule.
 *   Society of Biblical │
 *   Literature          │
 *
 * It opens like a drawer (owner, 2026-09-29): the rule appears at the left
 * edge right beside the sentence, then slides right and pushes the sentence
 * over, and in the room it opens the emblem, the label and the source drop in
 * one after another, top to bottom. It holds for three sentences (the
 * credit's own and the next two), then closes the same way in reverse, and the
 * fourth sentence is centred again as usual.
 *
 * Nothing may move while it is up, so the group has one height for the whole
 * window: the taller of the credit column and the tallest sentence, measured
 * the way the card sets them. The group's bottom sits 140px above the frame
 * edge (owner). Figma numbers are on a 1920x1080 frame; `u` scales them.
 */
const EASE = Easing.bezier(0.4, 0, 0.2, 1)
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const

/** Sentences a side credit holds for, its own included. */
export const SIDE_MARK_SENTENCES = 3
/** Group bottom above the frame edge, Figma px (also the 16:9 text bottom in
 *  this layout, so the centred sentences after it sit on the same line). */
export const SIDE_BOTTOM = 140
const GROUP_W = 1564
const GAP = 56
const RULE_W = 2
const COL_MAX = 310
const LABEL_PX = 18
const LABEL_TRACK = 2
const SOURCE_PX = 36
const SOURCE_LH = 50

/** The drawer's state `t` seconds into a window `durSec` long: `open` 0..1
 *  (rule at the left edge .. rule at its place), `rule` the rule's draw-in
 *  and fade-out, `items` the icon, label and source (0 hidden .. 1 settled). */
export function sideDrawer(t: number, durSec: number) {
  const ease = (a: number, b: number) =>
    interpolate(t, [a, b], [0, 1], { ...clamp, easing: EASE })
  const end = durSec
  const open = ease(0.7, 1.5) * (1 - ease(end - 1.15, end - 0.4))
  const rule = ease(0, 0.35) * (1 - ease(end - 0.45, end))
  const items = [0, 1, 2].map(
    (k) =>
      ease(1.1 + 0.2 * k, 1.6 + 0.2 * k) *
      (1 - ease(end - 1.55 + 0.12 * (2 - k), end - 1.15 + 0.12 * (2 - k))),
  )
  return { open, rule, items }
}

/** Emblems 15% over the Figma boxes (owner, 2026-09-29: too small beside
 *  the label); the portrait keeps the Figma size. */
const EMBLEM_SCALE = 1.15
const ICON_BOX: Record<SourcePortraitId, [number, number]> = {
  book: [70 * EMBLEM_SCALE, 53 * EMBLEM_SCALE],
  scroll: [66 * EMBLEM_SCALE, 48 * EMBLEM_SCALE],
  ryle: [70, 70],
}

export type SideWindow = {
  /** The card carrying the credit. */
  mark: number
  /** Last card the credit holds over. */
  last: number
  /** Frame px. */
  left: number
  top: number
  colWidth: number
  height: number
  textLeft: number
  textWidth: number
}

const INTER = `'${SHORT_FONT_FAMILIES.inter}', system-ui, sans-serif`
const LITERATA = `'${TEASER_FONT_FAMILIES.literata}', Georgia, serif`

/** Windows for every side credit, or [] until the faces are loaded (the frame
 *  is held meanwhile, so no frame renders with a fallback measurement). */
export function useSideMarkLayout({
  enabled,
  cards,
  frameW,
  frameH,
  textFamily,
  textPx,
}: {
  enabled: boolean
  cards: ReadonlyArray<DevotionalCard>
  frameW: number
  frameH: number
  textFamily: string
  textPx: number
}): SideWindow[] {
  const specs = [
    `400 ${textPx}px ${textFamily}`,
    `600 ${textPx}px ${textFamily}`,
    `400 36px ${LITERATA}`,
    `500 18px ${INTER}`,
  ]
  // `document.fonts.check` alone is not enough: before a webfont is
  // registered it answers true for the system fallback in the stack, and the
  // credit column was measured in Georgia (too narrow for Literata, so a word
  // overflowed). Wait for the registration itself, then for the faces.
  const [ready, setReady] = useState(
    () => !enabled || typeof document === "undefined",
  )
  useEffect(() => {
    if (ready) return
    const handle = delayRender("side-mark fonts")
    loadLiterata()
      .then(() => Promise.all(specs.map((s) => document.fonts.load(s))))
      .catch(() => undefined)
      .then(() => {
        setReady(true)
        continueRender(handle)
      })
  }, [ready])
  if (!enabled || !ready) return []

  const u = (n: number) => (n * Math.min(frameW, frameH)) / 1080
  const out: SideWindow[] = []
  for (let j = 0; j < cards.length; j++) {
    const mark = cards[j].sourceMark
    if (cards[j].kind !== "reflection-focus" || !mark) continue
    let last = j
    while (
      last + 1 < cards.length &&
      last - j + 1 < SIDE_MARK_SENTENCES &&
      cards[last + 1].kind === "reflection-focus" &&
      !cards[last + 1].sourceMark
    ) {
      last++
    }
    const src = measureText(
      mark.source,
      undefined,
      { family: LITERATA, sizePx: u(SOURCE_PX) },
      u(COL_MAX),
    )
    const label = measureText(
      mark.label.toUpperCase(),
      undefined,
      { family: INTER, sizePx: u(LABEL_PX) },
      1e6,
    )
    const icon = ICON_BOX[mark.portrait ?? "book"]
    const labelW = (label?.widest ?? 0) + mark.label.length * u(LABEL_TRACK)
    const colWidth = Math.min(
      u(COL_MAX),
      Math.max(labelW, src?.widest ?? u(COL_MAX), u(icon[0])),
    )
    const colHeight =
      u(icon[1]) +
      u(24) +
      u(LABEL_PX) * 1.22 +
      u(4) +
      (src?.lines ?? 2) * u(SOURCE_LH)
    const left = (frameW - u(GROUP_W)) / 2
    const textLeft = left + colWidth + u(GAP) * 2 + u(RULE_W)
    const textWidth = left + u(GROUP_W) - textLeft
    let textHeight = 0
    for (let i = j; i <= last; i++) {
      const m = measureText(
        cards[i].text ?? "",
        cards[i].highlight,
        { family: textFamily, sizePx: textPx },
        textWidth,
      )
      textHeight = Math.max(textHeight, (m?.lines ?? 2) * textPx * 1.46)
    }
    const height = Math.max(colHeight, textHeight)
    out.push({
      mark: j,
      last,
      left,
      top: frameH - u(SIDE_BOTTOM) - height,
      colWidth,
      height,
      textLeft,
      textWidth,
    })
  }
  return out
}

export function SideMarkOverlay({
  windows,
  cards,
  frames,
  frame,
  fps,
  frameH,
}: {
  windows: ReadonlyArray<SideWindow>
  cards: ReadonlyArray<DevotionalCard>
  frames: ReadonlyArray<CardFrames>
  frame: number
  fps: number
  frameH: number
}) {
  const u = (n: number) => (n * frameH) / 1080
  for (const w of windows) {
    const start = frames[w.mark].from
    const end = frames[w.last].from + frames[w.last].durationInFrames
    if (frame < start || frame >= end) continue
    const mark = cards[w.mark].sourceMark!
    const t = (frame - start) / fps
    const { open, rule, items } = sideDrawer(t, (end - start) / fps)
    const drop = (p: number) => ({
      opacity: p,
      transform: `translateY(${(u(-14) * (1 - p)).toFixed(2)}px)`,
    })
    const portrait = mark.portrait ?? "book"
    const box = ICON_BOX[portrait]
    const ruleX = w.left + open * (w.colWidth + u(GAP))
    return (
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <div
          style={{
            position: "absolute",
            left: w.left,
            top: w.top,
            width: w.colWidth,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: u(24),
          }}
        >
          <div
            style={{
              width: u(box[0]),
              height: u(box[1]),
              ...drop(items[0]),
              opacity: 0.85 * items[0],
              // Both emblems lean like a book set down on a desk (owner).
              ...(portrait !== "ryle"
                ? { transform: `${drop(items[0]).transform} rotate(-10deg)` }
                : {}),
            }}
          >
            {portrait === "book" ? (
              <AnimatedBook t={t - 1.4} />
            ) : portrait === "scroll" ? (
              <AnimatedScroll t={t - 1.4} />
            ) : (
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  height: "100%",
                  borderRadius: "50%",
                  overflow: "hidden",
                }}
              >
                <img
                  src={SOURCE_PORTRAIT_URIS[portrait]}
                  alt=""
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: "50%",
                    boxShadow: `inset 0 0 0 ${u(1)}px #fff`,
                  }}
                />
              </div>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: u(4) }}>
            <div
              style={{
                fontFamily: INTER,
                fontWeight: 500,
                fontSize: u(LABEL_PX),
                lineHeight: 1.22,
                letterSpacing: u(LABEL_TRACK),
                textTransform: "uppercase",
                whiteSpace: "nowrap",
                color: "rgba(255,255,255,0.5)",
                ...drop(items[1]),
              }}
            >
              {mark.label}
            </div>
            <div
              style={{
                fontFamily: LITERATA,
                fontWeight: 400,
                fontSize: u(SOURCE_PX),
                lineHeight: `${u(SOURCE_LH)}px`,
                color: "rgba(255,255,255,0.92)",
                width: w.colWidth + 2,
                ...drop(items[2]),
                opacity: 0.85 * items[2],
              }}
            >
              {/* Breaks only at spaces, as measured (never after a hyphen). */}
              {mark.source.split(" ").map((word, i, all) => (
                <span key={i}>
                  <span style={{ whiteSpace: "nowrap" }}>{word}</span>
                  {i < all.length - 1 ? " " : ""}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            left: ruleX,
            top: w.top,
            width: u(RULE_W),
            height: w.height,
            background: "rgba(255,255,255,0.6)",
            borderRadius: u(1),
            opacity: Math.min(1, rule * 3),
            transform: `scaleY(${Math.min(1, rule).toFixed(4)})`,
            transformOrigin: "top center",
          }}
        />
      </div>
    )
  }
  return null
}
