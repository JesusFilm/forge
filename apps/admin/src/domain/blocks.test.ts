import { describe, expect, it } from "vitest"
import {
  BlockSchema,
  BlocksSchema,
  BibleQuotesCarouselBlockSchema,
  ContainerBlockSchema,
  QuizButtonBlockSchema,
  SectionBlockSchema,
  SectionContentBlockSchema,
  ContainerSlotContentBlockSchema,
  VideoBlockSchema,
  VideoCarouselBlockSchema,
  VideoHeroBlockSchema,
  type Blocks,
} from "@/domain/blocks"

// -----------------------------------------------------------------------------
// Happy-path: each top-level block type validates at minimum-required fields.
// -----------------------------------------------------------------------------

describe("BlockSchema — all 16 top-level types validate", () => {
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
      name: "container",
      value: {
        t: "container",
        slots: [{ gridSpan: 6, content: [] }],
      },
    },
    {
      name: "section",
      value: { t: "section", content: [] },
    },
  ]

  for (const { name, value } of samples) {
    it(`accepts ${name}`, () => {
      const parsed = BlockSchema.safeParse(value)
      expect(parsed.success, JSON.stringify(parsed)).toBe(true)
    })
  }

  it("covers all 16 top-level block types listed in the experience schema", () => {
    expect(samples.length).toBe(16)
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

  it("accepts videoCarousel route children and item overrides", () => {
    const result = VideoCarouselBlockSchema.safeParse({
      t: "videoCarousel",
      itemsSource: "routeVideoChildren",
      items: [
        {
          videoId: "video-1",
          titleOverride: "Custom title",
          subtitleOverride: "Custom subtitle",
          imageOverrideUrl: "https://example.com/image.jpg",
        },
      ],
    })
    expect(result.success).toBe(true)
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

describe("containerSlotContent rejects the narrower restricted set", () => {
  it("accepts media/text/cta variants", () => {
    expect(
      ContainerSlotContentBlockSchema.safeParse({
        t: "card",
        title: "x",
        description: "y",
      }).success,
    ).toBe(true)
  })

  it("rejects container nested inside container-slot.content", () => {
    const result = ContainerSlotContentBlockSchema.safeParse({
      t: "container",
      slots: [],
    })
    expect(result.success).toBe(false)
  })

  it("rejects navigationCarousel which is not in the container-slot allowlist", () => {
    const result = ContainerSlotContentBlockSchema.safeParse({
      t: "navigationCarousel",
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
    //       -> container.slots[].content (ContainerSlotContentBlockSchema —
    //           narrower set, excludes container + section)
    //         -> leaf block (text, card, etc.)
    // Anything deeper requires a new recursive path that doesn't exist in
    // the legacy CMS shape; this test proves the z.lazy() wiring works for
    // the full legal composition.
    const tree = {
      t: "section",
      content: [
        {
          t: "container",
          slots: [
            {
              gridSpan: 6,
              content: [
                { t: "text", heading: "leaf" },
                {
                  t: "card",
                  title: "a",
                  description: "b",
                  variant: "default",
                },
              ],
            },
            {
              gridSpan: 6,
              content: [{ t: "cta", buttonLabel: "Go" }],
            },
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
          slots: [
            {
              gridSpan: 12,
              content: [{ t: "cta", buttonLabel: label }],
            },
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
        content: [
          { t: "card", title: "A", description: "B", variant: "default" },
        ],
        dynamicBackgroundImage: false,
        staticOverlay: false,
      },
    ]
    expect(BlocksSchema.safeParse(input).success).toBe(true)
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
