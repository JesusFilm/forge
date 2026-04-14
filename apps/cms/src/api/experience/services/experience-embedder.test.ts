import { describe, expect, it, vi, beforeEach } from "vitest"
import {
  flattenContentBlocks,
  buildExperienceText,
  indexExperience,
  deleteExperienceEmbedding,
} from "./experience-embedder"

// ---------------------------------------------------------------------------
// flattenContentBlocks
// ---------------------------------------------------------------------------

describe("flattenContentBlocks", () => {
  it("extracts text from sections.text (heading, subtitle, paragraphs)", () => {
    const blocks = [
      {
        __component: "sections.text",
        heading: "Easter Story",
        subtitle: "The resurrection narrative",
        contentParagraphs: ["First paragraph.", "Second paragraph."],
      },
    ]

    expect(flattenContentBlocks(blocks)).toEqual([
      "Easter Story",
      "The resurrection narrative",
      "First paragraph.",
      "Second paragraph.",
    ])
  })

  it("handles contentParagraphs as a JSON string", () => {
    const blocks = [
      {
        __component: "sections.text",
        heading: "Title",
        contentParagraphs: '["Paragraph one.", "Paragraph two."]',
      },
    ]

    expect(flattenContentBlocks(blocks)).toEqual([
      "Title",
      "Paragraph one.",
      "Paragraph two.",
    ])
  })

  it("handles contentParagraphs as a plain string", () => {
    const blocks = [
      {
        __component: "sections.text",
        contentParagraphs: "Just a plain string",
      },
    ]

    expect(flattenContentBlocks(blocks)).toEqual(["Just a plain string"])
  })

  it("extracts text from sections.promo-banner", () => {
    const blocks = [
      {
        __component: "sections.promo-banner",
        intro: "New",
        heading: "Easter Campaign",
        description: "Join the celebration",
      },
    ]

    expect(flattenContentBlocks(blocks)).toEqual([
      "New",
      "Easter Campaign",
      "Join the celebration",
    ])
  })

  it("extracts text from sections.info-blocks with child items", () => {
    const blocks = [
      {
        __component: "sections.info-blocks",
        heading: "Key Facts",
        description: "Important information",
        blocks: [
          { title: "Fact 1", description: "Detail 1" },
          { title: "Fact 2", description: "Detail 2" },
        ],
      },
    ]

    expect(flattenContentBlocks(blocks)).toEqual([
      "Key Facts",
      "Important information",
      "Fact 1",
      "Detail 1",
      "Fact 2",
      "Detail 2",
    ])
  })

  it("extracts text from sections.card", () => {
    const blocks = [
      {
        __component: "sections.card",
        title: "Card Title",
        description: "Card description text",
      },
    ]

    expect(flattenContentBlocks(blocks)).toEqual([
      "Card Title",
      "Card description text",
    ])
  })

  it("extracts text from sections.cta and strips HTML from body", () => {
    const blocks = [
      {
        __component: "sections.cta",
        heading: "Take Action",
        body: "<p>Click <strong>here</strong> to learn more.</p>",
      },
    ]

    expect(flattenContentBlocks(blocks)).toEqual([
      "Take Action",
      "Click here to learn more.",
    ])
  })

  it("extracts text from sections.related-questions and strips HTML from answers", () => {
    const blocks = [
      {
        __component: "sections.related-questions",
        heading: "FAQ",
        questions: [
          {
            question: "What is Easter?",
            answer: "<p>A Christian <em>holiday</em>.</p>",
          },
          {
            question: "When is Easter?",
            answer: "<p>It varies each year.</p>",
          },
        ],
      },
    ]

    expect(flattenContentBlocks(blocks)).toEqual([
      "FAQ",
      "What is Easter?",
      "A Christian holiday.",
      "When is Easter?",
      "It varies each year.",
    ])
  })

  it("extracts text from sections.bible-quotes-carousel", () => {
    const blocks = [
      {
        __component: "sections.bible-quotes-carousel",
        heading: "Scripture",
        quotes: [
          { reference: "John 3:16", text: "For God so loved the world..." },
          {
            reference: "Romans 8:28",
            text: "And we know that in all things...",
          },
        ],
      },
    ]

    expect(flattenContentBlocks(blocks)).toEqual([
      "Scripture",
      "John 3:16",
      "For God so loved the world...",
      "Romans 8:28",
      "And we know that in all things...",
    ])
  })

  it("recurses into sections.section content", () => {
    const blocks = [
      {
        __component: "sections.section",
        content: [
          {
            __component: "sections.text",
            heading: "Nested heading",
          },
          {
            __component: "sections.card",
            title: "Nested card",
            description: "Nested description",
          },
        ],
      },
    ]

    expect(flattenContentBlocks(blocks)).toEqual([
      "Nested heading",
      "Nested card",
      "Nested description",
    ])
  })

  it("recurses into sections.container slots", () => {
    const blocks = [
      {
        __component: "sections.container",
        slots: [
          {
            gridSpan: 6,
            content: [{ __component: "sections.text", heading: "Left column" }],
          },
          {
            gridSpan: 6,
            content: [
              { __component: "sections.text", heading: "Right column" },
            ],
          },
        ],
      },
    ]

    expect(flattenContentBlocks(blocks)).toEqual([
      "Left column",
      "Right column",
    ])
  })

  it("skips non-text components", () => {
    const blocks = [
      { __component: "sections.video", streamingUrl: "https://example.com" },
      {
        __component: "sections.video-hero",
        streamingUrl: "https://example.com",
      },
      { __component: "sections.media-collection" },
      { __component: "sections.easter-dates" },
      { __component: "sections.advent-countdown" },
      { __component: "sections.navigation-carousel" },
      { __component: "sections.video-carousel" },
    ]

    expect(flattenContentBlocks(blocks)).toEqual([])
  })

  it("handles null/undefined/empty blocks gracefully", () => {
    expect(flattenContentBlocks(null)).toEqual([])
    expect(flattenContentBlocks(undefined)).toEqual([])
    expect(flattenContentBlocks([])).toEqual([])
  })

  it("handles mixed blocks with text and non-text components", () => {
    const blocks = [
      { __component: "sections.text", heading: "Visible" },
      { __component: "sections.video" },
      {
        __component: "sections.card",
        title: "Also visible",
        description: "Yes",
      },
    ]

    expect(flattenContentBlocks(blocks)).toEqual([
      "Visible",
      "Also visible",
      "Yes",
    ])
  })
})

// ---------------------------------------------------------------------------
// buildExperienceText
// ---------------------------------------------------------------------------

describe("buildExperienceText", () => {
  it("concatenates title + meta + blocks in priority order", () => {
    const experience = {
      id: 1,
      locale: "en",
      slug: "easter",
      title: "Easter",
      metaDescription: "Celebrate Easter",
      ogTitle: "Easter OG",
      ogDescription: "OG description",
      publishedAt: "2026-01-01T00:00:00Z",
      blocks: [{ __component: "sections.text", heading: "Story" }],
    }

    const text = buildExperienceText(experience)
    expect(text).toBe(
      "Easter\n\nCelebrate Easter\n\nEaster OG\n\nOG description\n\nStory",
    )
  })

  it("deduplicates ogTitle when it matches title", () => {
    const experience = {
      id: 1,
      locale: "en",
      slug: "easter",
      title: "Easter",
      metaDescription: "Celebrate Easter",
      ogTitle: "Easter",
      ogDescription: "Different OG",
      publishedAt: "2026-01-01T00:00:00Z",
      blocks: null,
    }

    const text = buildExperienceText(experience)
    expect(text).toBe("Easter\n\nCelebrate Easter\n\nDifferent OG")
  })

  it("deduplicates ogDescription when it matches metaDescription", () => {
    const experience = {
      id: 1,
      locale: "en",
      slug: "easter",
      title: "Easter",
      metaDescription: "Celebrate Easter",
      ogTitle: "Different OG Title",
      ogDescription: "Celebrate Easter",
      publishedAt: "2026-01-01T00:00:00Z",
      blocks: null,
    }

    const text = buildExperienceText(experience)
    expect(text).toBe("Easter\n\nCelebrate Easter\n\nDifferent OG Title")
  })

  it("handles null/empty optional fields", () => {
    const experience = {
      id: 1,
      locale: "en",
      slug: "easter",
      title: "Easter",
      metaDescription: null,
      ogTitle: null,
      ogDescription: null,
      publishedAt: "2026-01-01T00:00:00Z",
      blocks: null,
    }

    const text = buildExperienceText(experience)
    expect(text).toBe("Easter")
  })

  it("skips empty strings", () => {
    const experience = {
      id: 1,
      locale: "en",
      slug: "easter",
      title: "Easter",
      metaDescription: "",
      ogTitle: "  ",
      ogDescription: null,
      publishedAt: "2026-01-01T00:00:00Z",
      blocks: [],
    }

    const text = buildExperienceText(experience)
    expect(text).toBe("Easter")
  })
})

// ---------------------------------------------------------------------------
// indexExperience
// ---------------------------------------------------------------------------

describe("indexExperience", () => {
  const mockRaw = vi.fn()
  const mockFindOne = vi.fn()
  const mockStrapi = {
    db: {
      query: vi.fn(() => ({ findOne: mockFindOne })),
      connection: { raw: mockRaw },
    },
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  } as unknown as Core.Strapi

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("upserts embedding for a published experience", async () => {
    const experience = {
      id: 42,
      locale: "en",
      slug: "easter",
      title: "Easter",
      metaDescription: "Celebrate Easter",
      ogTitle: null,
      ogDescription: null,
      publishedAt: "2026-01-01T00:00:00Z",
      blocks: [],
    }
    mockFindOne.mockResolvedValue(experience)

    const openrouter = await import("../../../lib/openrouter")
    vi.spyOn(openrouter, "embedText").mockResolvedValue(
      new Array(1536).fill(0.1),
    )

    await indexExperience(mockStrapi, 42, "en")

    expect(mockRaw).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO experience_embeddings"),
      expect.arrayContaining([42, "en", "easter"]),
    )
  })

  it("deletes embedding when experience is unpublished", async () => {
    mockFindOne.mockResolvedValue({
      id: 42,
      locale: "en",
      slug: "easter",
      title: "Easter",
      publishedAt: null,
      blocks: [],
    })

    await indexExperience(mockStrapi, 42, "en")

    expect(mockRaw).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM experience_embeddings"),
      [42, "en"],
    )
  })

  it("deletes embedding when experience is not found", async () => {
    mockFindOne.mockResolvedValue(null)

    await indexExperience(mockStrapi, 99, "en")

    expect(mockRaw).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM experience_embeddings"),
      [99, "en"],
    )
  })

  it("deletes stale embedding when source text is empty", async () => {
    mockFindOne.mockResolvedValue({
      id: 42,
      locale: "en",
      slug: "empty",
      title: null,
      metaDescription: null,
      ogTitle: null,
      ogDescription: null,
      publishedAt: "2026-01-01T00:00:00Z",
      blocks: [],
    })

    await indexExperience(mockStrapi, 42, "en")

    expect(mockRaw).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM experience_embeddings"),
      [42, "en"],
    )
    expect(mockStrapi.log.warn).toHaveBeenCalledWith(
      expect.stringContaining("No embeddable text"),
    )
  })
})

// ---------------------------------------------------------------------------
// deleteExperienceEmbedding
// ---------------------------------------------------------------------------

describe("deleteExperienceEmbedding", () => {
  it("issues DELETE with correct params", async () => {
    const mockRaw = vi.fn()
    const mockStrapi = {
      db: { connection: { raw: mockRaw } },
    } as unknown as Core.Strapi

    await deleteExperienceEmbedding(mockStrapi, 42, "en")

    expect(mockRaw).toHaveBeenCalledWith(
      "DELETE FROM experience_embeddings WHERE experience_id = ? AND locale = ?",
      [42, "en"],
    )
  })
})
