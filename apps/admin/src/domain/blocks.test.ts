import { describe, expect, it } from "vitest"
import {
  BlockSchema,
  BlocksSchema,
  BibleQuotesCarouselBlockSchema,
  ContainerBlockSchema,
  ContainerSlotBlockSchema,
  QuizButtonBlockSchema,
  SectionBlockSchema,
  SectionContentBlockSchema,
  TextBlockSchema,
  ContainerContentBlockSchema,
  VideoBlockSchema,
  VideoCarouselBlockSchema,
  VideoHeroBlockSchema,
  VideoRecommendationsBlockSchema,
  WatchHomeHeroBlockSchema,
  type Blocks,
} from "@/domain/blocks"

// -----------------------------------------------------------------------------
// Happy-path: each top-level block type validates at minimum-required fields.
// -----------------------------------------------------------------------------

describe("BlockSchema — all top-level types validate", () => {
  const samples: Array<{ name: string; value: unknown }> = [
    {
      name: "adventCountdown",
      value: { t: "adventCountdown", title: "Advent" },
    },
    {
      name: "bibleQuotesCarousel",
      value: {
        t: "bibleQuotesCarousel",
        quotes: [{ reference: "John 3:16", text: "For God..." }],
      },
    },
    { name: "card", value: { t: "card", title: "Hi", description: "World" } },
    {
      name: "cta",
      value: { t: "cta", buttonLabel: "Click" },
    },
    {
      name: "easterDates",
      value: {
        t: "easterDates",
        easterDatesTitle: "Easter",
        westernEasterLabel: "W",
        orthodoxEasterLabel: "O",
        passoverLabel: "P",
      },
    },
    { name: "infoBlocks", value: { t: "infoBlocks" } },
    {
      name: "mediaCollection",
      value: { t: "mediaCollection", variant: "grid" },
    },
    { name: "navigationCarousel", value: { t: "navigationCarousel" } },
    {
      name: "promoBanner",
      value: {
        t: "promoBanner",
        heading: "H",
        description: "D",
        ctaLink: "/x",
      },
    },
    { name: "relatedQuestions", value: { t: "relatedQuestions" } },
    { name: "text", value: { t: "text" } },
    { name: "video", value: { t: "video" } },
    { name: "videoCarousel", value: { t: "videoCarousel" } },
    { name: "videoHero", value: { t: "videoHero" } },
    {
      name: "videoRecommendations",
      value: { t: "videoRecommendations" },
    },
    {
      name: "watchHomeHero",
      value: { t: "watchHomeHero" },
    },
    {
      name: "container",
      value: {
        t: "container",
        backgroundColor: "#151515",
        backgroundImageUrl: "https://example.com/container.jpg",
        content: [{ t: "containerSlot", gridSpan: 6 }],
      },
    },
    {
      name: "section",
      value: {
        t: "section",
        backgroundColor: "#26313f",
        backgroundImageUrl: "https://example.com/section.jpg",
        content: [],
      },
    },
  ]

  for (const { name, value } of samples) {
    it(`accepts ${name}`, () => {
      const parsed = BlockSchema.safeParse(value)
      expect(parsed.success, JSON.stringify(parsed)).toBe(true)
    })
  }

  it("covers all 18 top-level block types listed in the experience schema", () => {
    // 16 legacy cms-sourced blocks + R5's forward-looking
    // videoRecommendations variant (schema only; no cms precedent) +
    // watchHomeHero's homepage-only placeholder.
    expect(samples.length).toBe(18)
  })

  it("accepts watchHomeHero as a placement-only placeholder", () => {
    const result = WatchHomeHeroBlockSchema.safeParse({
      t: "watchHomeHero",
      sectionKey: "watch-home-hero",
    })
    expect(result.success).toBe(true)
  })

  it("accepts promotional Markdown text and rejects unknown variants", () => {
    const promotional = TextBlockSchema.safeParse({
      t: "text",
      sectionKey: "mission-story",
      heading: "A story worth discovering",
      contentParagraphs: [
        "### Why this story matters\n\nA substantial opening paragraph.",
        "- One reason\n- Another reason",
      ],
      variant: "promotional",
    })

    expect(promotional.success).toBe(true)
    expect(
      TextBlockSchema.safeParse({
        t: "text",
        variant: "editorial-but-unknown",
      }).success,
    ).toBe(false)
  })

  it("accepts videoHero metadata source modes", () => {
    const result = VideoHeroBlockSchema.safeParse({
      t: "videoHero",
      ctaEnabled: true,
      headingSource: "videoTitle",
      subheadingSource: "videoDescription",
    })
    expect(result.success).toBe(true)
  })

  it("accepts video metadata source modes", () => {
    const result = VideoBlockSchema.safeParse({
      t: "video",
      titleSource: "videoTitle",
      subtitleSource: "videoDescription",
      autoplay: true,
      muted: true,
      loop: false,
      showControls: true,
    })
    expect(result.success).toBe(true)
  })

  it("accepts videoCarousel route children and item images", () => {
    const result = VideoCarouselBlockSchema.safeParse({
      t: "videoCarousel",
      itemsSource: "routeVideoChildren",
      items: [
        {
          videoId: "video-1",
          titleOverride: "Custom title",
          subtitleOverride: "Custom subtitle",
          imageUrl: "https://example.com/image.jpg",
        },
      ],
    })
    expect(result.success).toBe(true)
  })

  it("accepts explicit media collection thumbnail orientations without changing legacy blocks", () => {
    const legacy = BlockSchema.safeParse({
      t: "mediaCollection",
      variant: "carousel",
    })
    const horizontal = BlockSchema.safeParse({
      t: "mediaCollection",
      variant: "carousel",
      thumbnailOrientation: "horizontal",
    })

    expect(legacy.success).toBe(true)
    if (legacy.success && legacy.data.t === "mediaCollection") {
      expect(legacy.data.thumbnailOrientation).toBeUndefined()
    }
    expect(horizontal.success).toBe(true)
    expect(
      BlockSchema.safeParse({
        t: "mediaCollection",
        variant: "carousel",
        thumbnailOrientation: "square",
      }).success,
    ).toBe(false)
  })

  it("videoRecommendations accepts seed + limit overrides", () => {
    const result = VideoRecommendationsBlockSchema.safeParse({
      t: "videoRecommendations",
      title: "You might like",
      subtitle: "Because you watched…",
      sourceVideoId: "vid-1",
      sourceSceneIndex: 3,
      limit: 8,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.limit).toBe(8)
    }
  })

  it("videoRecommendations applies the default limit when omitted", () => {
    const result = VideoRecommendationsBlockSchema.safeParse({
      t: "videoRecommendations",
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.limit).toBe(10)
    }
  })

  it("videoRecommendations rejects limit outside [1, 50]", () => {
    expect(
      VideoRecommendationsBlockSchema.safeParse({
        t: "videoRecommendations",
        limit: 0,
      }).success,
    ).toBe(false)
    expect(
      VideoRecommendationsBlockSchema.safeParse({
        t: "videoRecommendations",
        limit: 100,
      }).success,
    ).toBe(false)
  })

  it("videoRecommendations rejects unknown keys (strict)", () => {
    const result = VideoRecommendationsBlockSchema.safeParse({
      t: "videoRecommendations",
      unknownKey: "bad",
    })
    expect(result.success).toBe(false)
  })

  it("videoRecommendations is NOT valid inside section.content (top-level only)", () => {
    const result = SectionContentBlockSchema.safeParse({
      t: "videoRecommendations",
    })
    expect(result.success).toBe(false)
  })

  it("accepts Bible quote presentation options", () => {
    const result = BibleQuotesCarouselBlockSchema.safeParse({
      t: "bibleQuotesCarousel",
      heading: "Featured Scripture",
      quotes: [
        {
          reference: "John 3:16",
          text: "For God...",
          attribution: "Jesus",
          backgroundImageUrl: "https://example.com/quote.jpg",
          backgroundColor: "#151515",
          ctaEnabled: true,
          ctaLabel: "Read more",
          ctaLink: "/watch",
        },
      ],
    })
    expect(result.success).toBe(true)
  })

  it("accepts a reference-first quote: structured citation identity and NO verse text", () => {
    // Video-anchored generation stores reference + structured ids; apps/web resolves
    // the verse text at render. The canonical schema must accept a text-less quote.
    const result = BibleQuotesCarouselBlockSchema.safeParse({
      t: "bibleQuotesCarousel",
      heading: "Featured Scripture",
      quotes: [
        {
          reference: "John 20:19-29",
          osisId: "John.20.19",
          chapterStart: 20,
          verseStart: 19,
          verseEnd: 29,
        },
      ],
    })
    expect(result.success).toBe(true)
  })
})

// -----------------------------------------------------------------------------
// Strictness — .strict() rejects unknown fields.
// -----------------------------------------------------------------------------

describe("strictness", () => {
  it("rejects unknown top-level keys", () => {
    const result = BlockSchema.safeParse({
      t: "card",
      title: "Hi",
      description: "World",
      unknownKey: "nope",
    })
    expect(result.success).toBe(false)
  })

  it("rejects a block with no discriminator", () => {
    const result = BlockSchema.safeParse({ title: "no type" })
    expect(result.success).toBe(false)
  })

  it("rejects an unknown block type", () => {
    const result = BlockSchema.safeParse({ t: "marquee", value: "go" })
    expect(result.success).toBe(false)
  })

  it("accepts the watch home hero discriminator stored on watch home locales", () => {
    const result = BlockSchema.safeParse({
      t: "watchHomeHero",
      sectionKey: "watch-home-hero",
    })

    expect(result.success).toBe(true)
  })
})

// -----------------------------------------------------------------------------
// Scope isolation — quizButton only inside section.content; section is NOT
// valid inside itself; videoHero NOT allowed inside section.content.
// -----------------------------------------------------------------------------

describe("quizButton is scoped to section.content", () => {
  it("is rejected at the top level", () => {
    const result = BlockSchema.safeParse({
      t: "quizButton",
      buttonText: "Start",
      iframeSrc: "https://demo.nextstep.is/q",
    })
    expect(result.success).toBe(false)
  })

  it("is accepted inside section.content", () => {
    const result = SectionBlockSchema.safeParse({
      t: "section",
      content: [
        {
          t: "quizButton",
          buttonText: "Start",
          iframeSrc: "https://demo.nextstep.is/q",
        },
      ],
    })
    expect(result.success).toBe(true)
  })

  it("rejects iframeSrc that is not a nextstep.is URL", () => {
    const result = QuizButtonBlockSchema.safeParse({
      t: "quizButton",
      buttonText: "Start",
      iframeSrc: "https://attacker.example/phishing",
    })
    expect(result.success).toBe(false)
  })
})

describe("section cannot contain another section (per legacy CMS)", () => {
  it("rejects a nested section inside section.content", () => {
    const result = SectionBlockSchema.safeParse({
      t: "section",
      content: [{ t: "section", content: [] }],
    })
    expect(result.success).toBe(false)
  })
})

describe("container content rejects the narrower restricted set", () => {
  it("accepts media/text/cta variants", () => {
    expect(
      ContainerContentBlockSchema.safeParse({
        t: "card",
        title: "x",
        description: "y",
      }).success,
    ).toBe(true)
  })

  it("rejects container nested inside container.content", () => {
    const result = ContainerContentBlockSchema.safeParse({
      t: "container",
      content: [],
    })
    expect(result.success).toBe(false)
  })

  it("rejects navigationCarousel which is not in the container allowlist", () => {
    const result = ContainerContentBlockSchema.safeParse({
      t: "navigationCarousel",
    })
    expect(result.success).toBe(false)
  })
})

describe("container slot responsive spans", () => {
  it("accepts gridSpan-only slot divider blocks", () => {
    const result = ContainerSlotBlockSchema.safeParse({
      t: "containerSlot",
      gridSpan: 6,
    })

    expect(result.success, JSON.stringify(result)).toBe(true)
  })

  it("accepts responsive spans for each supported breakpoint", () => {
    const result = ContainerSlotBlockSchema.safeParse({
      t: "containerSlot",
      gridSpan: 6,
      spans: { xs: 12, sm: 12, md: 6, lg: 5, xl: 4 },
    })

    expect(result.success, JSON.stringify(result)).toBe(true)
  })

  it("accepts background color and image metadata on slot dividers", () => {
    const result = ContainerSlotBlockSchema.safeParse({
      t: "containerSlot",
      gridSpan: 6,
      backgroundColor: "#26313f",
      backgroundImageUrl: "https://example.com/slot.jpg",
    })

    expect(result.success, JSON.stringify(result)).toBe(true)
  })

  it.each([
    { spans: { xs: 0 }, label: "zero" },
    { spans: { sm: 13 }, label: "above twelve" },
    { spans: { md: 6.5 }, label: "decimal" },
    { spans: { lg: "6" }, label: "string" },
    { spans: { xxl: 6 }, label: "unknown breakpoint" },
  ])("rejects invalid responsive spans: $label", ({ spans }) => {
    const result = ContainerSlotBlockSchema.safeParse({
      t: "containerSlot",
      gridSpan: 6,
      spans,
    })

    expect(result.success).toBe(false)
  })
})

// -----------------------------------------------------------------------------
// Recursion — deeply nested section structures survive validation.
// -----------------------------------------------------------------------------

describe("composition depth (no z.lazy needed because legal nesting is acyclic)", () => {
  it("accepts realistic section → container → slot → leaf (max legal depth)", () => {
    // Legal nesting path:
    //   top-level BlockSchema (includes section + container)
    //     -> section.content (SectionContentBlockSchema — includes container,
    //         excludes section-itself per legacy CMS)
    //       -> container.content (ContainerContentBlockSchema — narrower set,
    //           excludes container + section, includes slot dividers)
    //         -> leaf block (text, card, etc.)
    // Anything deeper requires a new recursive path that doesn't exist in
    // the legacy CMS shape; this test proves the z.lazy() wiring works for
    // the full legal composition.
    const tree = {
      t: "section",
      content: [
        {
          t: "container",
          content: [
            { t: "containerSlot", gridSpan: 6 },
            { t: "text", heading: "leaf" },
            {
              t: "card",
              title: "a",
              description: "b",
              variant: "default",
            },
            { t: "containerSlot", gridSpan: 6 },
            { t: "cta", buttonLabel: "Go" },
          ],
        },
        {
          t: "relatedQuestions",
          questions: [{ question: "Why?", answer: "Because." }],
        },
      ],
    }
    const result = BlockSchema.safeParse(tree)
    expect(result.success, JSON.stringify(result)).toBe(true)
  })

  it("accepts multiple top-level sections (BlocksSchema array recursion)", () => {
    // Sibling recursion — many sections at the top level, each with a
    // container-heavy tree. Exercises the z.lazy array path.
    const makeSection = (label: string): unknown => ({
      t: "section",
      content: [
        { t: "text", heading: label },
        {
          t: "container",
          content: [
            { t: "containerSlot", gridSpan: 12 },
            { t: "cta", buttonLabel: label },
          ],
        },
      ],
    })
    const result = BlocksSchema.safeParse([
      makeSection("one"),
      makeSection("two"),
      makeSection("three"),
    ])
    expect(result.success, JSON.stringify(result)).toBe(true)
  })
})

// -----------------------------------------------------------------------------
// BlocksSchema — wraps array validation.
// -----------------------------------------------------------------------------

describe("BlocksSchema", () => {
  it("accepts an empty array", () => {
    expect(BlocksSchema.safeParse([]).success).toBe(true)
  })

  it("accepts a mixed array of valid top-level blocks", () => {
    const input: Blocks = [
      { t: "videoHero", useRouteVideo: true },
      { t: "text", heading: "Hi" },
      {
        t: "section",
        backgroundColor: "#26313f",
        backgroundImageUrl: "https://example.com/section.jpg",
        content: [
          { t: "card", title: "A", description: "B", variant: "default" },
        ],
        dynamicBackgroundImage: false,
        staticOverlay: false,
      },
    ]
    expect(BlocksSchema.safeParse(input).success).toBe(true)
  })

  it("accepts canonical media asset ids beside transitional URL fields", () => {
    const input = [
      {
        t: "section",
        backgroundImageUrl: "https://example.com/section.jpg",
        backgroundImageAssetId: "asset-section",
        content: [
          {
            t: "card",
            title: "A",
            description: "B",
            mediaUrl: "https://example.com/card.jpg",
            mediaAssetId: "asset-card",
          },
          {
            t: "mediaCollection",
            variant: "grid",
            itemsSource: "manual",
            imageUrl: "https://example.com/collection.jpg",
            imageAssetId: "asset-collection",
            items: [
              {
                imageUrl: "https://example.com/item.jpg",
                imageAssetId: "asset-item",
              },
            ],
          },
        ],
      },
    ]

    expect(BlocksSchema.safeParse(input).success).toBe(true)
  })

  it("accepts root-relative admin media preview URLs", () => {
    const input = [
      {
        t: "mediaCollection",
        variant: "collection",
        itemsSource: "manual",
        showItemNumbers: false,
        items: [
          {
            videoId: "video-1",
            imageUrl: "/api/media-assets/asset-1/preview",
            imageAssetId: "asset-1",
          },
        ],
      },
    ]

    expect(BlocksSchema.safeParse(input).success).toBe(true)
  })

  it("canonicalizes legacy image override fields before strict validation", () => {
    const result = BlocksSchema.safeParse([
      {
        t: "mediaCollection",
        variant: "carousel",
        itemsSource: "manual",
        items: [
          {
            videoId: "video-1",
            imageOverrideUrl: "https://example.com/poster-1.jpg",
            imageOverrideAssetId: "asset-1",
          },
          {
            videoId: "video-2",
            imageOverrideUrl: "https://example.com/poster-2.jpg",
            imageOverrideAssetId: "asset-2",
          },
        ],
      },
      {
        t: "videoCarousel",
        itemsSource: "manual",
        items: [
          {
            videoId: "video-3",
            imageOverrideUrl: "https://example.com/video-poster.jpg",
            imageOverrideAssetId: "asset-3",
          },
        ],
      },
    ])

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data[0]).toMatchObject({
      thumbnailOrientation: "vertical",
      items: [
        {
          imageUrl: "https://example.com/poster-1.jpg",
          imageAssetId: "asset-1",
        },
        {
          imageUrl: "https://example.com/poster-2.jpg",
          imageAssetId: "asset-2",
        },
      ],
    })
    expect(result.data[1]).toMatchObject({
      items: [
        {
          imageUrl: "https://example.com/video-poster.jpg",
          imageAssetId: "asset-3",
        },
      ],
    })
    expect(JSON.stringify(result.data)).not.toContain("imageOverride")
  })

  it("rejects if any single block is invalid", () => {
    const input = [
      { t: "text", heading: "ok" },
      { t: "card" /* missing title + description */ },
    ]
    expect(BlocksSchema.safeParse(input).success).toBe(false)
  })
})

// -----------------------------------------------------------------------------
// A minor smoke that VideoHeroBlockSchema allows both authored + route-video
// modes. (Legacy field `useRouteVideo` toggles this.)
// -----------------------------------------------------------------------------

describe("videoHero authoring modes", () => {
  it("accepts authored streaming URL", () => {
    const result = VideoHeroBlockSchema.safeParse({
      t: "videoHero",
      videoId: "video-1",
      languageId: "english-language",
      streamingUrl: "https://cdn.example/video.m3u8",
      heading: "Watch",
    })
    expect(result.success).toBe(true)
  })

  it("accepts useRouteVideo=true with no explicit URL", () => {
    const result = VideoHeroBlockSchema.safeParse({
      t: "videoHero",
      useRouteVideo: true,
    })
    expect(result.success).toBe(true)
  })

  it("accepts authored clip and playback settings", () => {
    const result = VideoHeroBlockSchema.safeParse({
      t: "videoHero",
      videoId: "video-123",
      clipStartSeconds: 12,
      clipEndSeconds: 28,
      autoplay: true,
      muted: true,
      loop: false,
      showControls: true,
    })
    expect(result.success).toBe(true)
  })
})

// Silence unused-import lint for helper-exported schemas if the test set shrinks.
void ContainerBlockSchema
void SectionContentBlockSchema
