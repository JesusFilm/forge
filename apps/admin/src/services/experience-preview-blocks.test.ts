import { describe, expect, it } from "vitest"

import { stampPreviewLocaleOnMediaCollections } from "@/services/experience-preview-blocks"

function mediaCollection(sectionKey: string, itemCount = 1) {
  return {
    t: "mediaCollection",
    sectionKey,
    items: Array.from({ length: itemCount }, (_unused, index) => ({
      videoId: `${sectionKey}-video-${index}`,
      titleOverride: undefined,
    })),
  }
}

function itemsOf(block: unknown): Array<Record<string, unknown>> {
  return (block as { items: Array<Record<string, unknown>> }).items
}

describe("stampPreviewLocaleOnMediaCollections", () => {
  it("stamps a top-level media collection", () => {
    const blocks = [mediaCollection("top")]

    const result = stampPreviewLocaleOnMediaCollections(blocks, "ru") as
      | unknown[]
      | undefined

    expect(itemsOf((result as unknown[])[0])[0]?.previewLocale).toBe("ru")
  })

  it("stamps a media collection inside container.content", () => {
    const blocks = [
      {
        t: "container",
        sectionKey: "wrapper",
        content: [mediaCollection("in-container")],
      },
    ]

    const result = stampPreviewLocaleOnMediaCollections(blocks, "ru") as Array<{
      content: unknown[]
    }>

    expect(itemsOf(result[0].content[0])[0]?.previewLocale).toBe("ru")
  })

  it("stamps a media collection inside section.content", () => {
    const blocks = [
      {
        t: "section",
        sectionKey: "wrapper",
        content: [mediaCollection("in-section")],
      },
    ]

    const result = stampPreviewLocaleOnMediaCollections(blocks, "ru") as Array<{
      content: unknown[]
    }>

    expect(itemsOf(result[0].content[0])[0]?.previewLocale).toBe("ru")
  })

  it("stamps a media collection inside section.content then container.content", () => {
    const blocks = [
      {
        t: "section",
        sectionKey: "outer",
        content: [
          {
            t: "container",
            sectionKey: "inner",
            content: [mediaCollection("deep")],
          },
        ],
      },
    ]

    const result = stampPreviewLocaleOnMediaCollections(blocks, "ru") as Array<{
      content: Array<{ content: unknown[] }>
    }>

    expect(itemsOf(result[0].content[0].content[0])[0]?.previewLocale).toBe(
      "ru",
    )
  })

  it("stamps every item of a multi-item collection", () => {
    const blocks = [mediaCollection("many", 3)]

    const result = stampPreviewLocaleOnMediaCollections(
      blocks,
      "ru",
    ) as unknown[]

    expect(itemsOf(result[0]).map((item) => item.previewLocale)).toEqual([
      "ru",
      "ru",
      "ru",
    ])
  })

  it("leaves non-media-collection sibling blocks byte-identical", () => {
    const text = { t: "text", sectionKey: "intro", body: "hello" }
    const promoBanner = { t: "promoBanner", sectionKey: "promo" }
    const videoHero = { t: "videoHero", sectionKey: "hero" }
    const blocks = [text, promoBanner, videoHero, mediaCollection("tail")]
    const before = JSON.stringify(blocks.slice(0, 3))

    const result = stampPreviewLocaleOnMediaCollections(
      blocks,
      "ru",
    ) as unknown[]

    expect(JSON.stringify(result.slice(0, 3))).toBe(before)
    expect(result[0]).toBe(text)
    expect(result[1]).toBe(promoBanner)
    expect(result[2]).toBe(videoHero)
  })

  it("does not mutate the input blocks", () => {
    const blocks = [mediaCollection("top")]

    stampPreviewLocaleOnMediaCollections(blocks, "ru")

    expect(itemsOf(blocks[0])[0]?.previewLocale).toBeUndefined()
  })

  it.each([
    ["an empty array", []],
    ["blocks with no media collection", [{ t: "text", sectionKey: "intro" }]],
    ["null entries", [null, { t: "text", sectionKey: "intro" }]],
    ["an entry with no recognized kind", [{ sectionKey: "mystery" }]],
    ["a media collection with no items array", [{ t: "mediaCollection" }]],
    ["a container with no content array", [{ t: "container" }]],
    [
      "a media collection with a null item",
      [{ t: "mediaCollection", items: [null] }],
    ],
  ])("returns without throwing for %s", (_label, blocks) => {
    expect(() =>
      stampPreviewLocaleOnMediaCollections(blocks, "ru"),
    ).not.toThrow()
  })

  it.each([
    ["a non-array input", { t: "mediaCollection" }],
    ["null", null],
    ["undefined", undefined],
  ])("passes %s through untouched", (_label, blocks) => {
    expect(stampPreviewLocaleOnMediaCollections(blocks, "ru")).toBe(blocks)
  })

  it("returns the blocks untouched when the locale is blank", () => {
    const blocks = [mediaCollection("top")]

    const result = stampPreviewLocaleOnMediaCollections(blocks, "")

    expect(result).toBe(blocks)
  })
})
