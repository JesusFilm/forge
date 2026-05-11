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
    const vector = Array.from({ length: 2048 }, () => 0.1)
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
      dimensions: 2048,
      embedding: vector,
    })
  })
})

describe("generateExperienceEmbeddings (batched)", () => {
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

  function vectorOf(seed: number): number[] {
    return Array.from({ length: 2048 }, () => seed)
  }

  it("issues exactly ONE fetch per call with body.input deep-equal to the inputs (in order)", async () => {
    // Distinct vectors so an out-of-order response would be detectable.
    const v0 = vectorOf(0.1)
    const v1 = vectorOf(0.2)
    const v2 = vectorOf(0.3)
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ embedding: v0 }, { embedding: v1 }, { embedding: v2 }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )
    vi.stubGlobal("fetch", fetchMock)

    const { generateExperienceEmbeddings, OPENROUTER_EMBEDDING_MODEL } =
      await import("./embeddings.service")

    const result = await generateExperienceEmbeddings([
      "first input",
      "second input",
      "third input",
    ])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]!
    const body = JSON.parse((init as RequestInit).body as string) as {
      input: string[]
      model: string
      encoding_format: string
    }
    expect(body.input).toEqual(["first input", "second input", "third input"])
    expect(body.model).toBe(OPENROUTER_EMBEDDING_MODEL)
    expect(body.encoding_format).toBe("float")

    // Position-stable: embeddings[i] aligns with inputs[i].
    expect(result.embeddings).toEqual([v0, v1, v2])
    expect(result.model).toBe(OPENROUTER_EMBEDDING_MODEL)
    expect(result.dimensions).toBe(2048)
  })

  it("rejects an empty input list with EmbeddingsBatchError(empty_input)", async () => {
    const { generateExperienceEmbeddings, EmbeddingsBatchError } =
      await import("./embeddings.service")
    const thrown = await generateExperienceEmbeddings([]).catch((e) => e)
    expect(thrown).toBeInstanceOf(EmbeddingsBatchError)
    expect((thrown as { code: string }).code).toBe("empty_input")
  })

  it("rejects a whitespace-only input with EmbeddingsBatchError(empty_input)", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const { generateExperienceEmbeddings, EmbeddingsBatchError } =
      await import("./embeddings.service")
    const thrown = await generateExperienceEmbeddings([
      "valid",
      "   ",
      "alsoValid",
    ]).catch((e) => e)
    expect(thrown).toBeInstanceOf(EmbeddingsBatchError)
    expect((thrown as { code: string }).code).toBe("empty_input")
    // No fetch issued — pre-validation runs before the network call.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("surfaces a length mismatch as EmbeddingsBatchError(length_mismatch)", async () => {
    // Provider returns 2 vectors for 3 inputs — fail-fast for the whole
    // target so the caller doesn't write partial state.
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ embedding: vectorOf(0.1) }, { embedding: vectorOf(0.2) }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )
    vi.stubGlobal("fetch", fetchMock)

    const { generateExperienceEmbeddings, EmbeddingsBatchError } =
      await import("./embeddings.service")
    const thrown = await generateExperienceEmbeddings(["a", "b", "c"]).catch(
      (e) => e,
    )
    expect(thrown).toBeInstanceOf(EmbeddingsBatchError)
    expect((thrown as { code: string }).code).toBe("length_mismatch")
  })

  it("surfaces a per-vector dimension mismatch as EmbeddingsBatchError(dimension_mismatch)", async () => {
    // Wrong dimension on the SECOND vector — index reported in the
    // message so an operator can correlate to the input position.
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { embedding: vectorOf(0.1) },
            { embedding: Array.from({ length: 768 }, () => 0.2) },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )
    vi.stubGlobal("fetch", fetchMock)

    const { generateExperienceEmbeddings, EmbeddingsBatchError } =
      await import("./embeddings.service")
    const thrown = await generateExperienceEmbeddings(["a", "b"]).catch(
      (e) => e,
    )
    expect(thrown).toBeInstanceOf(EmbeddingsBatchError)
    expect((thrown as { code: string }).code).toBe("dimension_mismatch")
  })

  it("surfaces a non-2xx response as EmbeddingsBatchError(request_failed)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("server error", { status: 503 }))
    vi.stubGlobal("fetch", fetchMock)

    const { generateExperienceEmbeddings, EmbeddingsBatchError } =
      await import("./embeddings.service")
    const thrown = await generateExperienceEmbeddings(["a"]).catch((e) => e)
    expect(thrown).toBeInstanceOf(EmbeddingsBatchError)
    expect((thrown as { code: string }).code).toBe("request_failed")
  })

  it("surfaces missing credentials with EmbeddingsBatchError(missing_credentials)", async () => {
    delete process.env.OPENROUTER_API_KEY
    delete process.env.OPENAI_API_KEY
    const { generateExperienceEmbeddings, EmbeddingsBatchError } =
      await import("./embeddings.service")
    const thrown = await generateExperienceEmbeddings(["hi"]).catch((e) => e)
    expect(thrown).toBeInstanceOf(EmbeddingsBatchError)
    expect((thrown as { code: string }).code).toBe("missing_credentials")
  })

  it("surfaces an AbortError as EmbeddingsBatchError(request_timed_out)", async () => {
    // Simulate the AbortController firing inside the timeout window.
    // Vitest doesn't ship an easy way to fast-forward the real
    // AbortSignal, so we mock fetch to throw the AbortError directly
    // (matching what the runtime produces when controller.abort() fires).
    const fetchMock = vi.fn().mockImplementation(async () => {
      const err = new Error("aborted")
      err.name = "AbortError"
      throw err
    })
    vi.stubGlobal("fetch", fetchMock)

    const { generateExperienceEmbeddings, EmbeddingsBatchError } =
      await import("./embeddings.service")
    const thrown = await generateExperienceEmbeddings(["hi"]).catch((e) => e)
    expect(thrown).toBeInstanceOf(EmbeddingsBatchError)
    expect((thrown as { code: string }).code).toBe("request_timed_out")
  })

  it("surfaces a malformed provider response as EmbeddingsBatchError(validation_failed)", async () => {
    // Provider returns a 200 with a body that doesn't match the zod
    // schema (missing `data` key). Catches a future provider response
    // shape change before partial reads land in the indexer.
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ unexpected: "shape" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const { generateExperienceEmbeddings, EmbeddingsBatchError } =
      await import("./embeddings.service")
    const thrown = await generateExperienceEmbeddings(["hi"]).catch((e) => e)
    expect(thrown).toBeInstanceOf(EmbeddingsBatchError)
    expect((thrown as { code: string }).code).toBe("validation_failed")
  })
})

describe("generateExperienceEmbedding (singular) — back-compat error contract", () => {
  // The singular wrapper now delegates to the batched form. Back-compat
  // callers (hybrid-search.service.ts, experienceEmbedding.ts,
  // ops-data.ts, search/health/route.ts) catch on the literal message
  // "Embedding input must not be empty" and on the generic Error class
  // (NOT EmbeddingsBatchError). Pin the contract.
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

  it("throws Error('Embedding input must not be empty') for empty input — NOT EmbeddingsBatchError", async () => {
    const { generateExperienceEmbedding, EmbeddingsBatchError } =
      await import("./embeddings.service")
    const thrown = await generateExperienceEmbedding("   ").catch((e) => e)
    expect(thrown).toBeInstanceOf(Error)
    expect(thrown).not.toBeInstanceOf(EmbeddingsBatchError)
    expect((thrown as Error).message).toBe("Embedding input must not be empty")
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
