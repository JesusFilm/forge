import { useEffect, useState } from "react"
import { continueRender, delayRender } from "remotion"

import type { DevotionalCard } from "./schema"
import type { CardFrames } from "./timing"
import { SourceMark } from "./SourceMark"

/**
 * Source credits for the 16:9 reflection, on their own layer above the cards,
 * centred on the frame's axis like the text under them.
 *
 * A credit stays up for at least five seconds (owner, 2026-09-26: "they
 * disappear too quickly"). The reflection is one sentence per card, so five
 * seconds usually spans two or three cards, and every card fades its text out
 * before the next one arrives: drawn inside a card, the credit blinked with
 * each sentence. Here it is drawn once, from the card whose paragraph it opens,
 * and stays put while the sentences change under it.
 *
 * It must not move while it is up, so it sits above the TALLEST sentence in its
 * window: the text is bottom-anchored, and a two-line sentence after a one-line
 * one would otherwise run into it. Line counts come from measuring the words
 * the way the card sets them (greedy wrap, the card's font and measure).
 */

/** 16:9 reflection text's distance from the frame bottom, in px() units
 *  (128px at 1080p). Shared with the reflection card so the credit always
 *  sits on the text it credits. */
export const WIDE_TEXT_BOTTOM = 46.2

/** Seconds the credit holds before it starts to leave (plus a 0.6s fade). */
export const SOURCE_MARK_HOLD_SEC = 5.4
const OUT_SEC = 0.6

type Measured = { lines: number; widest: number }
const lineCache = new Map<string, Measured>()

/** Lines a centred paragraph wraps to (greedy word wrap, as the browser sets
 *  it) and the width of its widest line. */
export function measureText(
  text: string,
  highlight: string | undefined,
  font: { family: string; sizePx: number },
  maxWidth: number,
): Measured | null {
  const key = `${font.family}|${font.sizePx}|${maxWidth}|${highlight ?? ""}|${text}`
  const hit = lineCache.get(key)
  if (hit != null) return hit
  // Only a measurement made with the real face is kept: the first frames can
  // render before the webfont has loaded, and a fallback measurement cached
  // then was reused for the whole render (the credit sat ~80px right of the
  // text it belongs to).
  const cacheable =
    typeof document !== "undefined" &&
    document.fonts.check(`400 ${font.sizePx}px ${font.family}`) &&
    document.fonts.check(`600 ${font.sizePx}px ${font.family}`)
  // Measured in the DOM, with the page's own loaded fonts: a canvas measured
  // with a fallback face (the webfont was not in its font cache) and came out
  // 12% narrow, which put the credit visibly right of the text.
  if (typeof document === "undefined" || !document.body) return null
  const probe = document.createElement("span")
  probe.style.cssText =
    "position:absolute;visibility:hidden;white-space:pre;left:-99999px;top:0"
  probe.style.fontFamily = font.family
  probe.style.fontSize = `${font.sizePx}px`
  document.body.appendChild(probe)
  // Highlighted words are set heavier (600), so they are measured that way.
  const hiStart = highlight ? text.indexOf(highlight) : -1
  const hiEnd = hiStart >= 0 ? hiStart + highlight!.length : -1
  const words: Array<{ w: string; heavy: boolean }> = []
  const re = /\S+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    words.push({ w: m[0], heavy: m.index >= hiStart && m.index < hiEnd })
  }
  const widthOf = (w: string, heavy: boolean) => {
    probe.style.fontWeight = heavy ? "600" : "400"
    probe.textContent = w
    return probe.getBoundingClientRect().width
  }
  const space = widthOf("a a", false) - widthOf("aa", false)
  let lines = 1
  let line = 0
  let widest = 0
  for (const { w, heavy } of words) {
    const ww = widthOf(w, heavy)
    if (line > 0 && line + space + ww > maxWidth) {
      widest = Math.max(widest, line)
      lines += 1
      line = ww
    } else {
      line += (line > 0 ? space : 0) + ww
    }
  }
  widest = Math.max(widest, line)
  probe.remove()
  const out = { lines, widest }
  if (cacheable) lineCache.set(key, out)
  return out
}

export function SourceMarkOverlay({
  cards,
  frames,
  frame,
  fps,
  px,
  textFamily,
  textWidth,
}: {
  cards: ReadonlyArray<DevotionalCard>
  frames: ReadonlyArray<CardFrames>
  frame: number
  fps: number
  px: (n: number) => number
  /** The reflection text's font-family value, as the card sets it. */
  textFamily: string
  /** The reflection column's measure in px. */
  textWidth: number
}) {
  const fontPx = px(22)
  const lineH = fontPx * 1.46
  // Hold the frame until the reflection's face (both weights) is loaded, so
  // the credit is placed against the text as it will actually be set.
  const spec = (w: number) => `${w} ${fontPx}px ${textFamily}`
  const [fontsReady, setFontsReady] = useState(
    () =>
      typeof document === "undefined" ||
      (document.fonts.check(spec(400)) && document.fonts.check(spec(600))),
  )
  useEffect(() => {
    if (fontsReady) return
    const handle = delayRender("source-mark fonts")
    Promise.all([
      document.fonts.load(spec(400)),
      document.fonts.load(spec(600)),
    ])
      .catch(() => undefined)
      .then(() => {
        setFontsReady(true)
        continueRender(handle)
      })
  }, [fontsReady])
  const bottomPad = px(WIDE_TEXT_BOTTOM)

  for (let j = 0; j < cards.length; j++) {
    const card = cards[j]
    if (card.kind !== "reflection-focus" || !card.sourceMark) continue
    const start = frames[j].from
    // It never outlives the reflection it credits, nor overlaps the next one.
    let k = j
    while (k + 1 < cards.length && cards[k + 1].kind === "reflection-focus") {
      if (cards[k + 1].sourceMark) break
      k++
    }
    const end = frames[k].from + frames[k].durationInFrames
    const holdSec = Math.max(
      0.5,
      Math.min(SOURCE_MARK_HOLD_SEC, (end - start) / fps - OUT_SEC),
    )
    const lastFrame = start + Math.round((holdSec + OUT_SEC) * fps)
    if (frame < start || frame >= lastFrame) continue
    if (!fontsReady) return null

    const font = { family: textFamily, sizePx: fontPx }
    let maxLines = 1
    for (let i = j; i <= k && frames[i].from < lastFrame; i++) {
      const c = cards[i]
      const m = measureText(c.text ?? "", c.highlight, font, textWidth)
      maxLines = Math.max(maxLines, m?.lines ?? 2)
    }
    return (
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          bottom: bottomPad + maxLines * lineH,
          pointerEvents: "none",
        }}
      >
        <SourceMark
          label={card.sourceMark.label}
          source={card.sourceMark.source}
          {...(card.sourceMark.portrait
            ? { portrait: card.sourceMark.portrait }
            : {})}
          t={(frame - start) / fps}
          px={px}
          holdUntilSec={holdSec}
        />
      </div>
    )
  }
  return null
}
