import { describe, expect, it } from "vitest"

import type { TopLevelBlock } from "./types"
import { parityDiff } from "./parity"

const HERO_BLOCK = {
  __component: "sections.video-hero",
  sectionKey: "forgiveness-hero",
  streamingUrl: "https://cdn.example.com/hero.m3u8",
  heading: "Forgiveness",
} satisfies TopLevelBlock

const CAROUSEL_WRAPPER = {
  __component: "sections.section",
  sectionKey: "forgiveness-series",
  backgroundColor: "light",
  content: [
    {
      __component: "sections.video-carousel",
      sectionKey: "forgiveness-carousel",
      title: "Keep watching",
      items: [
        {
          sectionKey: "forgiveness-carousel-1",
          video: 11,
          streamingUrl: "https://cdn.example.com/series-1.m3u8",
          title: "Part 1",
        },
      ],
    },
  ],
} satisfies TopLevelBlock

describe("parityDiff", () => {
  it("returns an empty diff for identical trees", () => {
    const report = parityDiff(
      [HERO_BLOCK, CAROUSEL_WRAPPER],
      [HERO_BLOCK, CAROUSEL_WRAPPER],
    )

    expect(report).toEqual({ ok: true, mismatches: [] })
  })

  it("reports missing top-level blocks", () => {
    const report = parityDiff([HERO_BLOCK, CAROUSEL_WRAPPER], [HERO_BLOCK])

    expect(report.ok).toBe(false)
    expect(report.mismatches).toContainEqual(
      expect.objectContaining({
        kind: "block-count",
        path: ["blocks"],
        expected: 2,
        actual: 1,
      }),
    )
  })

  it("reports nested archetype mismatches inside section wrappers", () => {
    const actual = [
      HERO_BLOCK,
      {
        ...CAROUSEL_WRAPPER,
        content: [
          {
            __component: "sections.media-collection",
            variant: "collection",
            title: "Related media",
          },
        ],
      } satisfies TopLevelBlock,
    ]

    const report = parityDiff([HERO_BLOCK, CAROUSEL_WRAPPER], actual)

    expect(report.ok).toBe(false)
    expect(report.mismatches).toContainEqual(
      expect.objectContaining({
        kind: "component-mismatch",
        path: [1, "content", 0],
        expected: "sections.video-carousel",
        actual: "sections.media-collection",
      }),
    )
  })
})
