import { describe, expect, it } from "vitest"
import { BlockSchema, BlocksSchema } from "@/domain/blocks"
import {
  BLOCK_TEMPLATE_KEYS,
  type BlockTemplateKey,
  createTemplateBlock,
  normalizeEditorBlocks,
  normalizeEditorBlockPayload,
  summarizeBlock,
  type VideoLibraryItem,
} from "./block-helpers"

const videoLibrary: VideoLibraryItem[] = [
  {
    key: "video-1",
    title: "The Story",
    description: "A localized description.",
    id: "core-video-1",
    label: "FEATURE_FILM",
    labelLabel: "Feature Film",
    sourceLabel: "Core",
    sourceTone: "success",
    dubs: "3 dubs",
    updated: "2026-04-16T00:00:00.000Z",
    duration: "12:34",
    durationSeconds: 754,
    previewImageUrl: "https://example.com/image.jpg",
    previewStreamUrl: "https://example.com/video.mp4",
  },
]

describe("experience editor block helpers", () => {
  const nonComposingBlockKeys = BLOCK_TEMPLATE_KEYS.filter(
    (key): key is Exclude<BlockTemplateKey, "section" | "container"> =>
      key !== "section" && key !== "container",
  )

  it("creates schema-valid starter payloads for every block template", () => {
    expect(BLOCK_TEMPLATE_KEYS).toHaveLength(19)

    for (const [index, key] of BLOCK_TEMPLATE_KEYS.entries()) {
      const result = BlockSchema.safeParse(createTemplateBlock(key, index))
      expect(result.success, key).toBe(true)
    }
  })

  it("normalizes empty optional fields before save", () => {
    const result = normalizeEditorBlockPayload({
      t: "videoCarousel",
      sectionKey: "",
      title: "Videos",
      items: [
        {
          videoId: "",
          streamingUrl: "",
          imageOverrideUrl: "",
          titleOverride: "",
          subtitleOverride: "",
        },
      ],
    })

    expect(result).toEqual({
      t: "videoCarousel",
      title: "Videos",
      items: [{}],
    })
  })

  it("keeps required empty strings so schema validation can reject them", () => {
    const result = normalizeEditorBlockPayload({
      t: "promoBanner",
      heading: "",
      description: "",
      ctaLink: "",
    })

    expect(result).toEqual({
      t: "promoBanner",
      heading: "",
      description: "",
    })
    expect(BlockSchema.safeParse(result).success).toBe(false)
  })

  it("serializes starter blocks as a valid BlocksSchema payload", () => {
    const blocks = BLOCK_TEMPLATE_KEYS.map((key, index) =>
      createTemplateBlock(key, index),
    )

    const result = BlocksSchema.safeParse(normalizeEditorBlocks(blocks))

    expect(result.success).toBe(true)
  })

  it("serializes non-composing starter blocks as valid edited payloads", () => {
    const blocks = nonComposingBlockKeys.map((key, index) => {
      const block = createTemplateBlock(key, index)

      if (key === "videoHero" || key === "video") {
        return {
          ...block,
          videoId: "",
          streamingUrl: "",
          clipStartSeconds: null,
          clipEndSeconds: null,
        }
      }

      if (key === "videoCarousel") {
        return {
          ...block,
          items: [
            {
              videoId: "",
              streamingUrl: "",
              imageOverrideUrl: "",
              titleOverride: "",
              subtitleOverride: "",
            },
          ],
        }
      }

      if (key === "mediaCollection") {
        return {
          ...block,
          items: [
            {
              videoId: "",
              imageOverrideUrl: "",
              imageUrl: "",
              titleOverride: "",
              subtitleOverride: "",
              labelOverride: "",
              collectionSize: "",
              linkToSectionKey: "",
            },
          ],
        }
      }

      if (key === "card") {
        return { ...block, mediaUrl: "" }
      }

      if (key === "bibleQuotesCarousel") {
        return {
          ...block,
          quotes: [
            {
              reference: "John 3:16",
              text: "For God so loved the world...",
              backgroundImageUrl: "",
              imageUrl: "",
              backgroundColor: "",
              ctaEnabled: false,
              ctaLabel: "",
              ctaLink: "",
            },
          ],
        }
      }

      if (key === "navigationCarousel") {
        return {
          ...block,
          items: [
            {
              contentId: "destination-1",
              title: "Destination One",
              category: "",
              imageUrl: "",
              backgroundColor: "",
            },
          ],
        }
      }

      if (key === "relatedQuestions") {
        return {
          ...block,
          ctaEnabled: false,
          ctaLabel: "",
          ctaLink: "",
        }
      }

      if (key === "cta") {
        return { ...block, buttonLink: "" }
      }

      return block
    })

    const result = BlocksSchema.safeParse(normalizeEditorBlocks(blocks))

    expect(result.success, JSON.stringify(result)).toBe(true)
  })

  it("summarizes every non-composing block type with usable labels", () => {
    for (const [index, key] of nonComposingBlockKeys.entries()) {
      const summary = summarizeBlock(createTemplateBlock(key, index), index, [])

      expect(summary.typeLabel, key).not.toBe("")
      expect(summary.title, key).not.toBe("")
      expect(summary.body, key).not.toBe("")
    }
  })

  it("summarizes video metadata from the selected library item", () => {
    const summary = summarizeBlock(
      {
        t: "videoHero",
        videoId: "video-1",
        headingSource: "videoTitle",
        subheadingSource: "videoDescription",
      },
      0,
      videoLibrary,
    )

    expect(summary).toMatchObject({
      typeLabel: "Video Hero",
      title: "The Story",
      body: "A localized description.",
      tone: "hero",
    })
  })

  it("creates and summarizes route video templates explicitly", () => {
    expect(createTemplateBlock("routeVideoHero", 0)).toMatchObject({
      t: "videoHero",
      useRouteVideo: true,
      headingSource: "videoTitle",
      subheadingSource: "videoDescription",
    })
    expect(createTemplateBlock("routeVideo", 1)).toMatchObject({
      t: "video",
      useRouteVideo: true,
      titleSource: "videoTitle",
      subtitleSource: "videoDescription",
    })
    expect(createTemplateBlock("routeVideoCarousel", 2)).toMatchObject({
      t: "videoCarousel",
      itemsSource: "routeVideoChildren",
    })

    expect(
      summarizeBlock(createTemplateBlock("routeVideoHero", 0), 0, []),
    ).toMatchObject({
      typeLabel: "Route Video Hero",
      title: "Video Hero",
      body: "Hero block",
      tone: "hero",
    })
    expect(
      summarizeBlock(createTemplateBlock("routeVideoCarousel", 2), 2, []),
    ).toMatchObject({
      typeLabel: "Route Video Carousel",
      title: "Related videos",
      badges: ["ROUTE_VIDEO_CHILDREN"],
    })
  })

  it("summarizes unsupported payloads defensively", () => {
    expect(summarizeBlock(null, 3, [])).toMatchObject({
      key: "block-3",
      typeLabel: "Unknown",
      title: "Unsupported block",
    })
  })
})
