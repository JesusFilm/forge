import { describe, expect, it } from "vitest"
import { collectVideoRelations } from "./seed-studio"

/**
 * Hand-rolled fixture shaped like the `/watch/easter` experience blocks:
 * a top-level video-hero, a Section wrapper with nested content (including
 * a container with slots), and a video-carousel with two items. Mirrors the
 * real dynamic-zone payload shape so the walker's nested `sections.video`
 * traversal is covered at depths 0 (dynamic zone), 1 (section.content), and
 * 2 (container.slots). Carousel items stay present as a regression guard that
 * they are ignored until the DB patch path supports them.
 */
const EASTER_LIKE_BLOCKS: Record<string, unknown>[] = [
  {
    __component: "sections.video-hero",
    sectionKey: "hero",
    video: 10,
    streamingUrl: "https://example.com/hero.m3u8",
  },
  {
    __component: "sections.section",
    sectionKey: "section-one",
    content: [
      {
        __component: "sections.video",
        sectionKey: "video-top-1",
        video: 11,
        streamingUrl: "https://example.com/v1.m3u8",
      },
      {
        __component: "sections.container",
        slots: [
          {
            gridSpan: 12,
            content: [
              {
                __component: "sections.video",
                sectionKey: "video-nested",
                video: 12,
                streamingUrl: "https://example.com/v2.m3u8",
              },
              {
                __component: "sections.bible-quotes-carousel",
                heading: "Q",
                quotes: [],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    __component: "sections.video-carousel",
    sectionKey: "carousel-one",
    items: [
      {
        sectionKey: "carousel-item-1",
        video: 13,
        streamingUrl: "https://example.com/v3.m3u8",
      },
      {
        sectionKey: "carousel-item-2",
        video: 14,
        streamingUrl: "https://example.com/v4.m3u8",
      },
    ],
  },
]

describe("collectVideoRelations", () => {
  it("returns an empty map for empty blocks", () => {
    const { map, warnings } = collectVideoRelations([])
    expect(map.size).toBe(0)
    expect(warnings).toEqual([])
  })

  it("returns an empty map for null/undefined blocks", () => {
    expect(collectVideoRelations(undefined).map.size).toBe(0)
    expect(collectVideoRelations(null).map.size).toBe(0)
  })

  it("finds nested `sections.video` entries across section/container depths", () => {
    const { map, warnings } = collectVideoRelations(EASTER_LIKE_BLOCKS)

    // Top-level sections.video inside a section.content
    expect(map.get("video-top-1")).toBe(11)
    // Nested inside a container slot
    expect(map.get("video-nested")).toBe(12)

    // The walker only patches `sections.video` components (that's the only
    // table `patchNestedVideoRelations` knows how to look up by section_key),
    // so video-hero and carousel items are intentionally not in the map. Lock
    // that in as a regression test — a change in policy here requires
    // touching the patching helper and the DB as well.
    expect(map.has("hero")).toBe(false)
    expect(map.has("carousel-item-1")).toBe(false)
    expect(map.has("carousel-item-2")).toBe(false)

    expect(map.size).toBe(2)
    expect(warnings).toEqual([])
  })

  it("skips `sections.video` entries that have no sectionKey but warns", () => {
    const blocks: Record<string, unknown>[] = [
      {
        __component: "sections.section",
        content: [
          {
            __component: "sections.video",
            // sectionKey intentionally omitted
            video: 99,
            streamingUrl: "https://example.com/orphan.m3u8",
          },
          {
            __component: "sections.video",
            sectionKey: "with-key",
            video: 100,
            streamingUrl: "https://example.com/keyed.m3u8",
          },
        ],
      },
    ]

    const { map, warnings } = collectVideoRelations(blocks)

    expect(map.get("with-key")).toBe(100)
    expect(map.size).toBe(1)
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toMatch(/missing sectionKey/)
    expect(warnings[0]).toMatch(/video=99/)
  })

  it("ignores carousel items because the patch helper cannot repair them yet", () => {
    const blocks: Record<string, unknown>[] = [
      {
        __component: "sections.video-carousel",
        sectionKey: "carousel",
        items: [
          { video: 200, streamingUrl: "https://example.com/a.m3u8" },
          {
            sectionKey: "item-b",
            video: 201,
            streamingUrl: "https://example.com/b.m3u8",
          },
        ],
      },
    ]

    const { map, warnings } = collectVideoRelations(blocks)

    expect(map.size).toBe(0)
    expect(map.has("item-b")).toBe(false)
    expect(warnings).toEqual([])
  })

  it("does not pick up arrays that are not video-shaped", () => {
    const blocks: Record<string, unknown>[] = [
      {
        __component: "sections.bible-quotes-carousel",
        sectionKey: "quotes-1",
        quotes: [
          { reference: "John 3:16", text: "For God so loved..." },
          { reference: "Rom 8:28", text: "All things work..." },
        ],
      },
    ]

    const { map, warnings } = collectVideoRelations(blocks)
    expect(map.size).toBe(0)
    expect(warnings).toEqual([])
  })

  it("is idempotent: same fixture twice yields the same map", () => {
    const a = collectVideoRelations(EASTER_LIKE_BLOCKS)
    const b = collectVideoRelations(EASTER_LIKE_BLOCKS)
    expect([...a.map.entries()].sort()).toEqual([...b.map.entries()].sort())
  })
})
