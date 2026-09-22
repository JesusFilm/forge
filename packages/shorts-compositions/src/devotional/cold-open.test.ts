import { readFileSync } from "node:fs"
import path from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { ColdOpen } from "./cold-open"
import { STAMP_WORD_SEC } from "./cold-open-timing"
import type { ColdOpenLine } from "./schema"
import { devotionalRenderConfigSchema, resolveDevotionalStyle } from "./styles"

const config = devotionalRenderConfigSchema.parse(
  JSON.parse(
    readFileSync(
      path.resolve(
        "../../apps/mastra/devotional-workspace/inputs/render/styles.json",
      ),
      "utf8",
    ),
  ),
)
const style = resolveDevotionalStyle("grain", undefined, config)
const FPS = 30
const px = (n: number) => n * (1080 / 390)

function paint(lines: ColdOpenLine[], frame: number, durationInFrames = 195) {
  return renderToStaticMarkup(
    createElement(ColdOpen, {
      lines,
      style,
      px,
      frame,
      fps: FPS,
      durationInFrames,
    }),
  )
}

const TYPED: ColdOpenLine = {
  text: "Can being right become a trap?",
  anim: "typewriter",
  align: "left",
}
const STAMPED: ColdOpenLine = {
  text: "When does confidence become pride?",
  anim: "stamp",
  align: "center",
  accentWord: "pride",
}
const FOCUSED: ColdOpenLine = {
  text: "What does God call humility?",
  anim: "focus",
  align: "center",
}

describe("cold-open card", () => {
  it("shows nothing once the card's frames are spent", () => {
    expect(paint([TYPED], 200, 195)).toBe("")
  })

  it("reserves the full typed line so the block never reflows", () => {
    const early = paint([TYPED], 3, 195)
    // The whole sentence is present but hidden, holding the layout open.
    expect(early).toContain("visibility:hidden")
    expect(early).toContain("Can being right become a trap?")
  })

  it("types the line out rather than showing it at once", () => {
    const early = paint([TYPED], 3, 195)
    const later = paint([TYPED], 25, 195)
    const visible = (markup: string) =>
      (markup.split("visibility:hidden")[1] ?? "").length
    expect(visible(later)).toBeGreaterThan(visible(early))
  })

  it("paints a cursor while typing", () => {
    // The cursor is the only element carrying the accent colour as a background.
    expect(paint([TYPED], 6, 195)).toContain(style.highlight)
  })

  it("uppercases the hook by default and obeys an opt-out", () => {
    expect(paint([TYPED], 20, 195)).toContain("text-transform:uppercase")
    const asWritten = renderToStaticMarkup(
      createElement(ColdOpen, {
        lines: [TYPED],
        style,
        px,
        frame: 20,
        fps: FPS,
        durationInFrames: 195,
        uppercase: false,
      }),
    )
    expect(asWritten).toContain("text-transform:none")
  })

  it("stamps one word at a time, never the whole line", () => {
    const markup = paint([STAMPED], Math.round(STAMP_WORD_SEC * FPS) + 2, 195)
    expect(markup).toContain("does")
    expect(markup).not.toContain("confidence")
    expect(markup).not.toContain("When does")
  })

  it("keeps the line's accent word in the accent colour", () => {
    // Land on the final word, then wait well past the cooling window.
    const onPride = Math.round(STAMP_WORD_SEC * 4 * FPS) + Math.round(FPS)
    const markup = paint([STAMPED], onPride, 400)
    expect(markup).toContain("pride")
    // A cooled word blends toward the heading colour; a pinned one does not.
    expect(markup).not.toContain("color-mix")
    expect(markup).toContain(style.highlight)
  })

  it("brings focus words in one after another", () => {
    const first = paint([FOCUSED], 1, 195)
    expect(first).toContain("What")
    expect(first).not.toContain("humility")
    const all = paint([FOCUSED], 60, 195)
    expect(all).toContain("humility")
  })

  it("blurs a focus word before it resolves", () => {
    expect(paint([FOCUSED], 1, 195)).toContain("blur(")
  })

  it("plays the lines in order across one card", () => {
    const lines = [TYPED, STAMPED, FOCUSED]
    expect(paint(lines, 2, 300)).toContain("Can being right")
    const end = paint(lines, 295, 300)
    expect(end).toContain("humility")
    expect(end).not.toContain("Can being right")
  })

  it("left-aligns or centres a line as authored", () => {
    expect(paint([TYPED], 20, 195)).toContain("text-align:left")
    expect(paint([FOCUSED], 20, 195)).toContain("text-align:center")
  })
})
