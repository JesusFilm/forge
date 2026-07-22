import { describe, expect, it } from "vitest"
import { BlockSchema, BlocksSchema } from "@/domain/blocks"
import {
  BLOCK_TEMPLATE_KEYS,
  asArray,
  asRecord,
  type BlockTemplateKey,
  createContainerSlotLayout,
  createTemplateBlock,
  editorTextFromContentParagraphs,
  defaultContainerSlotSpans,
  normalizeEditorBlocks,
  normalizeEditorBlockPayload,
  contentParagraphsFromEditorText,
  readContainerSlotSpans,
  summarizeBlock,
  type VideoLibraryItem,
  writeContainerSlotSpan,
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
    hasGrounding: true,
  },
]

describe("experience editor block helpers", () => {
  const nonComposingBlockKeys = BLOCK_TEMPLATE_KEYS.filter(
    (
      key,
    ): key is Exclude<
      BlockTemplateKey,
      "section" | "container" | "promotionalText"
    > => key !== "section" && key !== "container" && key !== "promotionalText",
  )

  it("creates schema-valid starter payloads for every block template", () => {
    expect(BLOCK_TEMPLATE_KEYS).toHaveLength(21)

    for (const [index, key] of BLOCK_TEMPLATE_KEYS.entries()) {
      const result = BlockSchema.safeParse(createTemplateBlock(key, index))
      expect(result.success, key).toBe(true)
    }
  })

  it("creates a schema-valid promotional story composition", () => {
    const starter = createTemplateBlock("promotionalText", 4)

    expect(starter).toMatchObject({
      t: "section",
      sectionKey: "promotional-story-4",
      backgroundColor: "purple",
      staticOverlay: true,
      content: [
        {
          t: "text",
          sectionKey: "promotional-copy-4",
          variant: "promotional",
          headingLevel: "h2",
        },
      ],
    })
    expect(BlockSchema.safeParse(starter).success).toBe(true)
  })

  it("leaves public copy unauthored in video carousel starters", () => {
    const manualStarter = createTemplateBlock("videoCarousel", 2)
    const routeStarter = createTemplateBlock("routeVideoCarousel", 3)

    expect(manualStarter).toEqual({
      t: "videoCarousel",
      sectionKey: "video-carousel-2",
      itemsSource: "manual",
      items: [],
    })
    expect(routeStarter).toEqual({
      t: "videoCarousel",
      sectionKey: "route-video-carousel-3",
      itemsSource: "routeVideoChildren",
      items: [],
    })
    expect(BlockSchema.safeParse(manualStarter).success).toBe(true)
    expect(BlockSchema.safeParse(routeStarter).success).toBe(true)
  })

  it("preserves promotional Markdown blocks and legacy line splitting", () => {
    const markdown = [
      "### Why this story matters",
      "A first paragraph.",
      "A second paragraph.",
      "- One reason\n- Another reason",
    ].join("\n\n")

    expect(contentParagraphsFromEditorText(markdown, "promotional")).toEqual([
      "### Why this story matters",
      "A first paragraph.",
      "A second paragraph.",
      "- One reason\n- Another reason",
    ])
    expect(
      editorTextFromContentParagraphs(
        contentParagraphsFromEditorText(markdown, "promotional"),
        "promotional",
      ),
    ).toBe(markdown)
    expect(contentParagraphsFromEditorText("First\nSecond", "lead")).toEqual([
      "First",
      "Second",
    ])
    expect(contentParagraphsFromEditorText("  \n\n ", "promotional")).toEqual(
      [],
    )
  })

  it("normalizes empty optional fields before save", () => {
    const result = normalizeEditorBlockPayload({
      t: "videoCarousel",
      sectionKey: "",
      title: "Videos",
      imageAssetId: "",
      items: [
        {
          videoId: "",
          streamingUrl: "",
          imageOverrideUrl: "",
          imageOverrideAssetId: "",
          imageAssetId: "",
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

  it("drops legacy read-only media item fields before save", () => {
    const result = normalizeEditorBlockPayload({
      t: "mediaCollection",
      sectionKey: "videos",
      variant: "grid",
      items: [
        {
          videoId: "video-1",
          videoSlug: "legacy-slug",
          imageUrl: "https://example.com/image.jpg",
        },
      ],
    })

    expect(result).toEqual({
      t: "mediaCollection",
      sectionKey: "videos",
      variant: "grid",
      items: [
        {
          videoId: "video-1",
          imageUrl: "https://example.com/image.jpg",
        },
      ],
    })
    expect(BlockSchema.safeParse(result).success).toBe(true)
  })

  it("drops stale nested slot payloads from containers before save", () => {
    const result = normalizeEditorBlockPayload({
      t: "container",
      slots: [{ gridSpan: 6, content: [{ t: "text" }] }],
      content: [{ t: "containerSlot", gridSpan: 6 }],
    })

    expect(result).toEqual({
      t: "container",
      content: [{ t: "containerSlot", gridSpan: 6 }],
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

  it("creates responsive default spans for new container slots", () => {
    expect(createTemplateBlock("container", 0)).toMatchObject({
      t: "container",
      content: [
        {
          t: "containerSlot",
          gridSpan: 6,
          spans: { xs: 12, sm: 12, md: 6, lg: 6, xl: 6 },
        },
        {
          t: "containerSlot",
          gridSpan: 6,
          spans: { xs: 12, sm: 12, md: 6, lg: 6, xl: 6 },
        },
      ],
    })
  })

  it("creates preset slot layouts with stacked small viewport spans", () => {
    expect(createContainerSlotLayout([8, 4])).toMatchObject([
      {
        t: "containerSlot",
        gridSpan: 8,
        spans: { xs: 12, sm: 12, md: 8, lg: 8, xl: 8 },
      },
      {
        t: "containerSlot",
        gridSpan: 4,
        spans: { xs: 12, sm: 12, md: 4, lg: 4, xl: 4 },
      },
    ])
  })

  it("resolves responsive span fallbacks from legacy gridSpan values", () => {
    expect(defaultContainerSlotSpans(7)).toEqual({
      xs: 12,
      sm: 12,
      md: 7,
      lg: 7,
      xl: 7,
    })
    expect(readContainerSlotSpans({ gridSpan: 5 })).toEqual({
      xs: 12,
      sm: 12,
      md: 5,
      lg: 5,
      xl: 5,
    })
  })

  it("updates one responsive span without changing gridSpan", () => {
    expect(
      writeContainerSlotSpan(
        {
          gridSpan: 6,
          spans: { xs: 12, sm: 12, md: 6, lg: 6, xl: 6 },
          content: [],
        },
        "md",
        8,
      ),
    ).toEqual({
      gridSpan: 6,
      spans: { xs: 12, sm: 12, md: 8, lg: 6, xl: 6 },
      content: [],
    })
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

  it("creates and summarizes the Watch Home hero placeholder", () => {
    expect(createTemplateBlock("watchHomeHero", 0)).toEqual({
      t: "watchHomeHero",
      sectionKey: "watch-home-hero-0",
    })

    expect(
      summarizeBlock(createTemplateBlock("watchHomeHero", 0), 0, []),
    ).toMatchObject({
      typeLabel: "Watch Home Hero",
      title: "Watch Home Hero",
      body: "Placement only • Web fallback active",
      tone: "hero",
      badges: ["WATCH_HOME", "PLACEMENT_ONLY"],
    })
  })

  it("summarizes programmed Watch Home heroes and normalizes empty promo optionals", () => {
    const blocks = normalizeEditorBlocks([
      {
        t: "watchHomeHero",
        sectionKey: "watch-home-hero",
        program: {
          buckets: [
            {
              kind: "promo",
              id: "campaigns",
              label: "Campaigns",
              items: [
                {
                  id: "join-us",
                  playbackId: "mux-join-us",
                  posterAssetId: "asset-join-us",
                  title: "Join us",
                  description: "",
                },
              ],
            },
          ],
          rotation: ["campaigns"],
        },
      },
    ])

    expect(BlocksSchema.safeParse(blocks).success).toBe(true)
    expect(summarizeBlock(blocks[0], 0, [])).toMatchObject({
      body: "1 bucket • 1 rotation slot",
      badges: ["WATCH_HOME", "PROGRAMMED"],
    })
    expect(
      asRecord(asArray(asRecord(asRecord(blocks[0])?.program)?.buckets)[0])
        ?.items,
    ).toEqual([
      {
        id: "join-us",
        playbackId: "mux-join-us",
        posterAssetId: "asset-join-us",
        title: "Join us",
      },
    ])
  })

  it("summarizes unsupported payloads defensively", () => {
    expect(summarizeBlock(null, 3, [])).toMatchObject({
      key: "block-3",
      typeLabel: "Unknown",
      title: "Unsupported block",
    })
  })
})
