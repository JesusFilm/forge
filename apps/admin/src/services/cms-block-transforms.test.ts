// Tests for the cms → admin block transformers.
//
// Coverage strategy:
//   - For each top-level component: a "happy path" test that builds
//     a representative cms row, transforms it, and asserts the
//     output parses against admin's BlocksSchema.
//   - Required-field-missing throws BlockTransformError with the
//     correct code + componentType.
//   - Video-id lookup integrates correctly (resolves, drops on
//     miss).
//   - Recursion through section + container produces nested blocks
//     that parse against their narrower scopes.

import { describe, expect, it } from "vitest"
import {
  BlocksSchema,
  ContainerContentBlockSchema,
  SectionContentBlockSchema,
} from "@/domain/blocks"
import {
  BlockTransformError,
  transformBlocksTopLevel,
  type VideoIdLookup,
} from "./cms-block-transforms"
import type {
  CmsBibleQuotesCarousel,
  CmsCard,
  CmsContainer,
  CmsCta,
  CmsEasterDates,
  CmsInfoBlocks,
  CmsMediaCollection,
  CmsNavigationCarousel,
  CmsPromoBanner,
  CmsQuizButton,
  CmsRelatedQuestions,
  CmsSection,
  CmsText,
  CmsVideo,
  CmsVideoCarousel,
  CmsVideoHero,
  CmsAdventCountdown,
  CmsContainerSlot,
} from "./cms-experience-source.types"

const noVideos: VideoIdLookup = () => undefined
const fixedVideo: VideoIdLookup = (id) =>
  id === 42 ? "admin-cuid-42" : undefined

describe("transformBlocksTopLevel — happy paths parse against admin BlocksSchema", () => {
  it("transforms a CTA into a parseable cta block", () => {
    const cta: CmsCta = {
      componentType: "sections.cta",
      cmp_id: 1,
      section_key: "hero-cta",
      heading: "Hello",
      body: "Body text",
      button_label: "Go",
      button_link: "/go",
      variant: "primary",
    }
    const out = transformBlocksTopLevel([cta], noVideos)
    expect(out).toHaveLength(1)
    expect(BlocksSchema.parse(out)).toBeDefined()
    expect(out[0]).toEqual({
      t: "cta",
      sectionKey: "hero-cta",
      heading: "Hello",
      body: "Body text",
      buttonLabel: "Go",
      buttonLink: "/go",
      variant: "primary",
    })
  })

  it("transforms a videoHero with a resolved videoId", () => {
    const hero: CmsVideoHero = {
      componentType: "sections.video-hero",
      cmp_id: 2,
      section_key: null,
      streaming_url: "https://stream.example/x.m3u8",
      heading: "Welcome",
      subheading: "Watch this",
      cta_link: "/start",
      cta_label: "Start",
      use_route_video: false,
      cms_video_id: 42,
    }
    const out = transformBlocksTopLevel([hero], fixedVideo)
    expect(BlocksSchema.parse(out)).toBeDefined()
    const block = out[0] as Record<string, unknown>
    expect(block.t).toBe("videoHero")
    expect(block.videoId).toBe("admin-cuid-42")
    expect(block.streamingUrl).toBe("https://stream.example/x.m3u8")
  })

  it("drops videoId on hero when lookup misses", () => {
    const hero: CmsVideoHero = {
      componentType: "sections.video-hero",
      cmp_id: 3,
      section_key: null,
      streaming_url: null,
      heading: null,
      subheading: null,
      cta_link: null,
      cta_label: null,
      use_route_video: false,
      cms_video_id: 999, // not in fixedVideo
    }
    const out = transformBlocksTopLevel([hero], fixedVideo)
    expect(BlocksSchema.parse(out)).toBeDefined()
    const block = out[0] as Record<string, unknown>
    expect(block.videoId).toBeUndefined()
  })

  it("transforms a section with nested content", () => {
    const cta: CmsCta = {
      componentType: "sections.cta",
      cmp_id: 5,
      section_key: null,
      heading: null,
      body: null,
      button_label: "Click",
      button_link: null,
      variant: null,
    }
    const section: CmsSection = {
      componentType: "sections.section",
      cmp_id: 4,
      section_key: "hero",
      background_color: "#fff",
      blur_hash: null,
      background_opacity: 0.5,
      dynamic_background_image: false,
      static_overlay: false,
      content: [cta],
    }
    const out = transformBlocksTopLevel([section], noVideos)
    expect(BlocksSchema.parse(out)).toBeDefined()
    const block = out[0] as { t: string; content: unknown[] }
    expect(block.t).toBe("section")
    expect(block.content).toHaveLength(1)
    expect(SectionContentBlockSchema.parse(block.content[0])).toBeDefined()
  })

  it("transforms a container with nested content + container slot", () => {
    const slot: CmsContainerSlot = {
      componentType: "sections.container-slot",
      cmp_id: 7,
      grid_span: 4,
    }
    const container: CmsContainer = {
      componentType: "sections.container",
      cmp_id: 6,
      section_key: "split",
      content: [slot],
    }
    const out = transformBlocksTopLevel([container], noVideos)
    expect(BlocksSchema.parse(out)).toBeDefined()
    const block = out[0] as { t: string; content: unknown[] }
    expect(block.content).toHaveLength(1)
    expect(ContainerContentBlockSchema.parse(block.content[0])).toBeDefined()
  })

  it("transforms a text block with content_paragraphs JSONB array", () => {
    const text: CmsText = {
      componentType: "sections.text",
      cmp_id: 8,
      section_key: null,
      heading: "Hi",
      heading_level: "h2",
      subtitle: null,
      content_paragraphs: ["First.", "Second."],
      variant: "lead",
    }
    const out = transformBlocksTopLevel([text], noVideos)
    expect(BlocksSchema.parse(out)).toBeDefined()
    const block = out[0] as Record<string, unknown>
    expect(block.contentParagraphs).toEqual(["First.", "Second."])
    expect(block.headingLevel).toBe("h2")
    expect(block.variant).toBe("lead")
  })

  it("transforms info-blocks with nested items", () => {
    const ib: CmsInfoBlocks = {
      componentType: "sections.info-blocks",
      cmp_id: 9,
      section_key: null,
      width_percent: 80,
      intro: null,
      heading: "Three things",
      description: null,
      blocks: [
        { cmp_id: 91, icon: "star", title: "T1", description: "D1" },
        { cmp_id: 92, icon: "star", title: "T2", description: "D2" },
      ],
    }
    const out = transformBlocksTopLevel([ib], noVideos)
    expect(BlocksSchema.parse(out)).toBeDefined()
    const block = out[0] as { t: string; blocks: unknown[] }
    expect(block.blocks).toHaveLength(2)
  })

  it("transforms media-collection with item and resolved video", () => {
    const mc: CmsMediaCollection = {
      componentType: "sections.media-collection",
      cmp_id: 10,
      section_key: null,
      category_label: "Films",
      variant: "grid",
      title: "Watch",
      subtitle: null,
      description: null,
      cta_link: null,
      cta_label: null,
      show_item_numbers: false,
      footer_text: null,
      items_source: "manual",
      items: [
        {
          cmp_id: 101,
          title_override: "Override",
          subtitle_override: null,
          label_override: null,
          collection_size: null,
          image_url: null,
          link_to_section_key: null,
          cms_video_id: 42,
        },
      ],
    }
    const out = transformBlocksTopLevel([mc], fixedVideo)
    expect(BlocksSchema.parse(out)).toBeDefined()
    const block = out[0] as { items: { videoId?: string }[] }
    expect(block.items[0]!.videoId).toBe("admin-cuid-42")
  })

  it("transforms navigation-carousel + items", () => {
    const nc: CmsNavigationCarousel = {
      componentType: "sections.navigation-carousel",
      cmp_id: 11,
      section_key: null,
      items: [
        {
          cmp_id: 111,
          content_id: "section-key-foo",
          title: "Foo",
          category: null,
          image_url: null,
          background_color: null,
        },
      ],
    }
    const out = transformBlocksTopLevel([nc], noVideos)
    expect(BlocksSchema.parse(out)).toBeDefined()
  })

  it("transforms promo-banner", () => {
    const pb: CmsPromoBanner = {
      componentType: "sections.promo-banner",
      cmp_id: 12,
      section_key: null,
      width_percent: null,
      intro: null,
      heading: "Heading",
      description: "Desc",
      cta_link: "/cta",
    }
    const out = transformBlocksTopLevel([pb], noVideos)
    expect(BlocksSchema.parse(out)).toBeDefined()
  })

  it("transforms easter-dates", () => {
    const ed: CmsEasterDates = {
      componentType: "sections.easter-dates",
      cmp_id: 13,
      section_key: null,
      easter_dates_title: "Easter",
      western_easter_label: "Western",
      orthodox_easter_label: "Orthodox",
      passover_label: "Passover",
      locale: "en",
    }
    const out = transformBlocksTopLevel([ed], noVideos)
    expect(BlocksSchema.parse(out)).toBeDefined()
  })

  it("transforms advent-countdown", () => {
    const ac: CmsAdventCountdown = {
      componentType: "sections.advent-countdown",
      cmp_id: 14,
      section_key: null,
      title: "Advent",
      scripture: null,
      scripture_reference: null,
      locale: "en",
    }
    const out = transformBlocksTopLevel([ac], noVideos)
    expect(BlocksSchema.parse(out)).toBeDefined()
  })

  it("transforms card", () => {
    const c: CmsCard = {
      componentType: "sections.card",
      cmp_id: 15,
      section_key: null,
      title: "Title",
      description: "Desc",
      link: null,
      variant: "default",
    }
    const out = transformBlocksTopLevel([c], noVideos)
    expect(BlocksSchema.parse(out)).toBeDefined()
  })

  it("transforms bible-quotes-carousel + nested quote items", () => {
    const bqc: CmsBibleQuotesCarousel = {
      componentType: "sections.bible-quotes-carousel",
      cmp_id: 16,
      section_key: null,
      heading: null,
      quotes: [
        {
          cmp_id: 161,
          reference: "John 3:16",
          text: "For God so loved...",
          cta_label: null,
          cta_link: null,
          attribution: null,
          image_url: null,
          background_color: null,
        },
      ],
    }
    const out = transformBlocksTopLevel([bqc], noVideos)
    expect(BlocksSchema.parse(out)).toBeDefined()
  })

  it("transforms related-questions + nested items", () => {
    const rq: CmsRelatedQuestions = {
      componentType: "sections.related-questions",
      cmp_id: 17,
      section_key: null,
      heading: null,
      cta_label: null,
      cta_link: null,
      questions: [{ cmp_id: 171, question: "Why?", answer: "Because." }],
    }
    const out = transformBlocksTopLevel([rq], noVideos)
    expect(BlocksSchema.parse(out)).toBeDefined()
  })

  it("transforms video carousel + items with resolved videoId", () => {
    const vc: CmsVideoCarousel = {
      componentType: "sections.video-carousel",
      cmp_id: 18,
      section_key: null,
      title: null,
      subtitle: null,
      description: null,
      items: [
        {
          cmp_id: 181,
          streaming_url: null,
          image_url: null,
          title_override: null,
          background_color: null,
          cms_video_id: 42,
        },
      ],
    }
    const out = transformBlocksTopLevel([vc], fixedVideo)
    expect(BlocksSchema.parse(out)).toBeDefined()
    const block = out[0] as { items: { videoId?: string }[] }
    expect(block.items[0]!.videoId).toBe("admin-cuid-42")
  })

  it("transforms standalone video block with resolved videoId", () => {
    const v: CmsVideo = {
      componentType: "sections.video",
      cmp_id: 19,
      section_key: null,
      streaming_url: null,
      title: null,
      subtitle: null,
      use_route_video: true,
      cms_video_id: 42,
    }
    const out = transformBlocksTopLevel([v], fixedVideo)
    expect(BlocksSchema.parse(out)).toBeDefined()
    const block = out[0] as Record<string, unknown>
    expect(block.useRouteVideo).toBe(true)
    expect(block.videoId).toBe("admin-cuid-42")
  })

  it("transforms quiz-button as a SectionContentBlock (not top-level)", () => {
    // QuizButton can appear inside a section, never at top level. Build
    // it via a section wrapper to verify scope-correct parsing.
    const qb: CmsQuizButton = {
      componentType: "sections.quiz-button",
      cmp_id: 20,
      button_text: "Quiz",
      iframe_src: "https://x.nextstep.is/quiz",
    }
    const section: CmsSection = {
      componentType: "sections.section",
      cmp_id: 21,
      section_key: null,
      background_color: null,
      blur_hash: null,
      background_opacity: null,
      dynamic_background_image: false,
      static_overlay: false,
      content: [qb],
    }
    const out = transformBlocksTopLevel([section], noVideos)
    expect(BlocksSchema.parse(out)).toBeDefined()
    const sectionOut = out[0] as { content: { t: string }[] }
    expect(sectionOut.content[0]!.t).toBe("quizButton")
  })
})

describe("required-field violations throw BlockTransformError", () => {
  it("CTA without buttonLabel throws", () => {
    const cta: CmsCta = {
      componentType: "sections.cta",
      cmp_id: 1,
      section_key: null,
      heading: null,
      body: null,
      button_label: null,
      button_link: null,
      variant: null,
    }
    expect(() => transformBlocksTopLevel([cta], noVideos)).toThrow(
      BlockTransformError,
    )
    try {
      transformBlocksTopLevel([cta], noVideos)
    } catch (err) {
      expect(err).toBeInstanceOf(BlockTransformError)
      expect((err as BlockTransformError).code).toBe("required_field_missing")
      expect((err as BlockTransformError).componentType).toBe("sections.cta")
      expect((err as BlockTransformError).cmpId).toBe(1)
    }
  })

  it("card without title throws", () => {
    const c: CmsCard = {
      componentType: "sections.card",
      cmp_id: 2,
      section_key: null,
      title: null,
      description: "ok",
      link: null,
      variant: null,
    }
    expect(() => transformBlocksTopLevel([c], noVideos)).toThrow(
      BlockTransformError,
    )
  })

  it("promo-banner without ctaLink throws", () => {
    const pb: CmsPromoBanner = {
      componentType: "sections.promo-banner",
      cmp_id: 3,
      section_key: null,
      width_percent: null,
      intro: null,
      heading: "h",
      description: "d",
      cta_link: null,
    }
    expect(() => transformBlocksTopLevel([pb], noVideos)).toThrow(
      BlockTransformError,
    )
  })

  it("error message does NOT echo cms row data (no input leakage)", () => {
    const cta: CmsCta = {
      componentType: "sections.cta",
      cmp_id: 99,
      section_key: "secret-key",
      heading: "secret heading",
      body: "secret body",
      button_label: null,
      button_link: "secret-link",
      variant: null,
    }
    try {
      transformBlocksTopLevel([cta], noVideos)
    } catch (err) {
      const msg = (err as Error).message
      // Per zod-validation-errors-must-not-echo-user-controlled-input
      // learning, the error message should NOT contain user-controlled
      // string values from the row. It carries field name + cmpId.
      expect(msg).not.toContain("secret-key")
      expect(msg).not.toContain("secret heading")
      expect(msg).not.toContain("secret body")
      expect(msg).not.toContain("secret-link")
    }
  })

  // Coverage for the remaining 6 transformers that throw on
  // required-field violations. Each asserts (a) BlockTransformError,
  // (b) code='required_field_missing', (c) componentType matches.
  // Without these, a copy-paste regression that checked the wrong
  // field would slip through.

  it("advent-countdown without title throws required_field_missing", () => {
    const ac: CmsAdventCountdown = {
      componentType: "sections.advent-countdown",
      cmp_id: 50,
      section_key: null,
      title: null,
      scripture: null,
      scripture_reference: null,
      locale: null,
    }
    try {
      transformBlocksTopLevel([ac], noVideos)
      expect.fail("expected throw")
    } catch (err) {
      expect(err).toBeInstanceOf(BlockTransformError)
      expect((err as BlockTransformError).code).toBe("required_field_missing")
      expect((err as BlockTransformError).componentType).toBe(
        "sections.advent-countdown",
      )
    }
  })

  it("bible-quote-item without reference throws required_field_missing", () => {
    const bqc: CmsBibleQuotesCarousel = {
      componentType: "sections.bible-quotes-carousel",
      cmp_id: 51,
      section_key: null,
      heading: null,
      quotes: [
        {
          cmp_id: 511,
          reference: null,
          text: "ok",
          cta_label: null,
          cta_link: null,
          attribution: null,
          image_url: null,
          background_color: null,
        },
      ],
    }
    try {
      transformBlocksTopLevel([bqc], noVideos)
      expect.fail("expected throw")
    } catch (err) {
      expect(err).toBeInstanceOf(BlockTransformError)
      expect((err as BlockTransformError).code).toBe("required_field_missing")
      expect((err as BlockTransformError).componentType).toBe(
        "sections.bible-quote-item",
      )
    }
  })

  it("easter-dates without all 4 required fields throws", () => {
    const ed: CmsEasterDates = {
      componentType: "sections.easter-dates",
      cmp_id: 52,
      section_key: null,
      easter_dates_title: null,
      western_easter_label: "W",
      orthodox_easter_label: "O",
      passover_label: "P",
      locale: null,
    }
    try {
      transformBlocksTopLevel([ed], noVideos)
      expect.fail("expected throw")
    } catch (err) {
      expect(err).toBeInstanceOf(BlockTransformError)
      expect((err as BlockTransformError).code).toBe("required_field_missing")
      expect((err as BlockTransformError).componentType).toBe(
        "sections.easter-dates",
      )
    }
  })

  it("info-block-item without icon throws required_field_missing", () => {
    const ib: CmsInfoBlocks = {
      componentType: "sections.info-blocks",
      cmp_id: 53,
      section_key: null,
      width_percent: null,
      intro: null,
      heading: null,
      description: null,
      blocks: [{ cmp_id: 531, icon: null, title: "T", description: "D" }],
    }
    try {
      transformBlocksTopLevel([ib], noVideos)
      expect.fail("expected throw")
    } catch (err) {
      expect(err).toBeInstanceOf(BlockTransformError)
      expect((err as BlockTransformError).code).toBe("required_field_missing")
      expect((err as BlockTransformError).componentType).toBe(
        "sections.info-block-item",
      )
    }
  })

  it("navigation-carousel-item without contentId throws", () => {
    const nc: CmsNavigationCarousel = {
      componentType: "sections.navigation-carousel",
      cmp_id: 54,
      section_key: null,
      items: [
        {
          cmp_id: 541,
          content_id: null,
          title: "T",
          category: null,
          image_url: null,
          background_color: null,
        },
      ],
    }
    try {
      transformBlocksTopLevel([nc], noVideos)
      expect.fail("expected throw")
    } catch (err) {
      expect(err).toBeInstanceOf(BlockTransformError)
      expect((err as BlockTransformError).code).toBe("required_field_missing")
      expect((err as BlockTransformError).componentType).toBe(
        "sections.navigation-carousel-item",
      )
    }
  })

  it("quiz-button without buttonText throws required_field_missing", () => {
    const qb: CmsQuizButton = {
      componentType: "sections.quiz-button",
      cmp_id: 55,
      button_text: null,
      iframe_src: "https://x.nextstep.is/quiz",
    }
    const section: CmsSection = {
      componentType: "sections.section",
      cmp_id: 550,
      section_key: null,
      background_color: null,
      blur_hash: null,
      background_opacity: null,
      dynamic_background_image: false,
      static_overlay: false,
      content: [qb],
    }
    try {
      transformBlocksTopLevel([section], noVideos)
      expect.fail("expected throw")
    } catch (err) {
      expect(err).toBeInstanceOf(BlockTransformError)
      expect((err as BlockTransformError).code).toBe("required_field_missing")
      expect((err as BlockTransformError).componentType).toBe(
        "sections.quiz-button",
      )
    }
  })

  it("related-question-item without question throws required_field_missing", () => {
    const rq: CmsRelatedQuestions = {
      componentType: "sections.related-questions",
      cmp_id: 56,
      section_key: null,
      heading: null,
      cta_label: null,
      cta_link: null,
      questions: [{ cmp_id: 561, question: null, answer: "A" }],
    }
    try {
      transformBlocksTopLevel([rq], noVideos)
      expect.fail("expected throw")
    } catch (err) {
      expect(err).toBeInstanceOf(BlockTransformError)
      expect((err as BlockTransformError).code).toBe("required_field_missing")
      expect((err as BlockTransformError).componentType).toBe(
        "sections.related-question-item",
      )
    }
  })
})
