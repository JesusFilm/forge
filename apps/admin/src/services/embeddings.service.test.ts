import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("buildExperienceEmbeddingText", () => {
  it("collects semantic text while skipping ids and urls", async () => {
    const { buildExperienceEmbeddingText } =
      await import("./embeddings.service")

    const text = buildExperienceEmbeddingText({
      title: "Hope",
      metaDescription: "A short description",
      ogTitle: null,
      ogDescription: null,
      blocks: [
        {
          t: "text",
          heading: "Main Heading",
          contentParagraphs: ["Paragraph one", "Paragraph two"],
          ctaLabel: "Read more",
          ctaLink: "https://example.com/ignore-me",
        },
        {
          t: "mediaCollection",
          title: "Collection Title",
          items: [
            {
              videoId: "video-123",
              titleOverride: "Video card title",
              imageUrl: "https://cdn.example.com/cover.jpg",
            },
          ],
        },
      ],
    })

    expect(text).toContain("Hope")
    expect(text).toContain("A short description")
    expect(text).toContain("Main Heading")
    expect(text).toContain("Paragraph one")
    expect(text).toContain("Video card title")
    expect(text).not.toContain("video-123")
    expect(text).not.toContain("https://example.com/ignore-me")
  })
})

describe("generateExperienceEmbedding", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
    process.env.OPENROUTER_API_KEY = "test-openrouter-key"
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_BASE_URL
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.OPENROUTER_API_KEY
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_BASE_URL
  })

  it("calls OpenRouter and validates the vector length", async () => {
    const vector = Array.from({ length: 1536 }, () => 0.1)
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: vector }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const { generateExperienceEmbedding, OPENROUTER_EMBEDDING_MODEL } =
      await import("./embeddings.service")

    const result = await generateExperienceEmbedding("hope and peace")

    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer test-openrouter-key",
        }),
      }),
    )
    expect(result).toEqual({
      model: OPENROUTER_EMBEDDING_MODEL,
      dimensions: 1536,
      embedding: vector,
    })
  })
})

describe("writeExperienceLocaleEmbedding", () => {
  it("rejects non-derived callers", async () => {
    const { writeExperienceLocaleEmbedding } =
      await import("./embeddings.service")

    await expect(
      writeExperienceLocaleEmbedding({
        prisma: { $executeRaw: vi.fn() } as never,
        localeId: "loc-1",
        embedding: [0.1, 0.2],
        user: { id: "editor-1", role: "EDITOR" },
      }),
    ).rejects.toThrow("Forbidden")
  })
})
