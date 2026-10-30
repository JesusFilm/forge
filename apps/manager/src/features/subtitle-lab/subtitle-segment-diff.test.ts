import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SubtitleSegmentDiff, diffSubtitleText } from "./subtitle-segment-diff"

describe("subtitle segment diff", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("segments CJK and emoji safely and marks differences as neutral", () => {
    const diff = diffSubtitleText("救いの知らせ 👋🏽", "救いのお知らせ 👋🏽", "ja")

    expect(diff.left.map((token) => token.text).join("")).toBe(
      "救いの知らせ 👋🏽",
    )
    expect(diff.right.map((token) => token.text).join("")).toBe(
      "救いのお知らせ 👋🏽",
    )
    expect(diff.left.some((token) => token.changed)).toBe(true)
  })

  it("never splits a joined emoji when Intl segmentation is unavailable", () => {
    vi.spyOn(Intl, "Segmenter").mockImplementation(() => {
      throw new Error("unavailable")
    })
    const family = "Cafe\u0301 👨‍👩‍👧‍👦"
    const diff = diffSubtitleText(family, "Café 👩‍👩‍👧‍👧", "en")

    expect(diff.left).toContainEqual({ text: family, changed: true })
    expect(diff.left.map(({ text }) => text).join("")).toBe(family)
  })

  it("bounds the quadratic word diff for long captions", () => {
    const left = Array.from({ length: 1_100 }, (_, index) => `a${index} `).join(
      "",
    )
    const right = Array.from(
      { length: 1_100 },
      (_, index) => `b${index} `,
    ).join("")
    const diff = diffSubtitleText(left, right, "en")

    expect(diff.left.map(({ text }) => text).join("")).toBe(left)
    expect(diff.right.map(({ text }) => text).join("")).toBe(right)
  })

  it("uses bidi isolation and non-color difference labels without provenance", () => {
    const markup = renderToStaticMarkup(
      React.createElement(SubtitleSegmentDiff, {
        segment: {
          id: "segment-1",
          startSeconds: 1,
          endSeconds: 3,
          sourceText: "He said peace",
          trackAText: "قال سلام",
          trackBText: "قال السلام",
          lexicalDifference: true,
          timingDifference: false,
        },
        locale: "ar",
        selected: true,
        mobileTrack: "A",
        onSelect: () => undefined,
        onAddCorrection: () => undefined,
      }),
    )

    expect(markup).toContain('dir="auto"')
    expect(markup).toContain("Text differs")
    expect(markup).toContain("Track A")
    expect(markup).toContain("Track B")
    expect(markup).not.toContain("human")
    expect(markup).not.toContain("AI")
  })
})
