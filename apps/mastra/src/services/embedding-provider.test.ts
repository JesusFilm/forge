import { describe, expect, it, vi } from "vitest"

import {
  EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
  EmbeddingProviderError,
  requestEmbeddingVectors,
  validateEmbeddingProviderResult,
  _internals,
} from "./embedding-provider"

const vector = (
  seed: number,
  dimensions = EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
) => Array.from({ length: dimensions }, (_, index) => seed + index / 1000)

function captureError(fn: () => unknown): unknown {
  try {
    fn()
  } catch (error) {
    return error
  }
  return undefined
}

describe("embedding provider", () => {
  it("posts to the OpenAI embeddings endpoint and aligns response indexes", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        data: [
          { index: 1, embedding: vector(2) },
          { index: 0, embedding: vector(1) },
        ],
        usage: { total_tokens: 12 },
      }),
    )

    const result = await requestEmbeddingVectors(["hello", "world"], {
      apiKey: "secret",
      context: "test batch",
      itemLabel: "chunks",
      expectedDimensions: EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
      fetchImpl,
    })

    expect(result.embeddings).toEqual([vector(1), vector(2)])
    expect(result.dimensions).toBe(EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS)
    expect(result.tokenCount).toBe(12)
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://api.openai.com/v1/embeddings"),
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer secret",
        }),
        body: expect.stringContaining('"model":"text-embedding-3-small"'),
      }),
    )
  })

  it("keeps provider-prefixed model names for non-OpenAI-compatible gateways", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ data: [{ index: 0, embedding: vector(1) }] }),
    )

    await requestEmbeddingVectors(["hello"], {
      apiKey: "secret",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "openai/text-embedding-3-small",
      context: "test batch",
      itemLabel: "chunks",
      expectedDimensions: EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
      fetchImpl,
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://openrouter.ai/api/v1/embeddings"),
      expect.objectContaining({
        body: expect.stringContaining(
          '"model":"openai/text-embedding-3-small"',
        ),
      }),
    )
  })

  it("rejects response length mismatches and dimension drift", async () => {
    const lengthMismatch = vi.fn(async () =>
      Response.json({ data: [{ index: 0, embedding: vector(1) }] }),
    )

    await expect(
      requestEmbeddingVectors(["one", "two"], {
        apiKey: "secret",
        context: "test batch",
        itemLabel: "chunks",
        expectedDimensions: EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
        fetchImpl: lengthMismatch,
      }),
    ).rejects.toMatchObject({
      code: "invalid_response",
      retryable: true,
    } satisfies Partial<EmbeddingProviderError>)

    const dimensionDrift = vi.fn(async () =>
      Response.json({ data: [{ index: 0, embedding: vector(1, 8) }] }),
    )

    await expect(
      requestEmbeddingVectors(["one"], {
        apiKey: "secret",
        context: "test batch",
        itemLabel: "chunks",
        expectedDimensions: EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
        fetchImpl: dimensionDrift,
      }),
    ).rejects.toMatchObject({
      code: "dimension_mismatch",
      retryable: false,
    } satisfies Partial<EmbeddingProviderError>)

    const duplicateIndex = vi.fn(async () =>
      Response.json({
        data: [
          { index: 0, embedding: vector(1) },
          { index: 0, embedding: vector(2) },
        ],
      }),
    )

    await expect(
      requestEmbeddingVectors(["one", "two"], {
        apiKey: "secret",
        context: "test batch",
        itemLabel: "chunks",
        expectedDimensions: EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
        fetchImpl: duplicateIndex,
      }),
    ).rejects.toMatchObject({
      code: "invalid_response",
      retryable: true,
    } satisfies Partial<EmbeddingProviderError>)

    const nonFiniteVector = vi.fn(async () =>
      Response.json({
        data: [{ index: 0, embedding: [Number.POSITIVE_INFINITY] }],
      }),
    )

    await expect(
      requestEmbeddingVectors(["one"], {
        apiKey: "secret",
        context: "test batch",
        itemLabel: "chunks",
        expectedDimensions: 1,
        fetchImpl: nonFiniteVector,
      }),
    ).rejects.toMatchObject({
      code: "invalid_response",
      retryable: true,
    } satisfies Partial<EmbeddingProviderError>)
  })

  it("validates injected provider results with the same count, finite value, and dimension rules", () => {
    expect(() =>
      validateEmbeddingProviderResult(
        {
          embeddings: [vector(1)],
          dimensions: EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
          tokenCount: 1,
          model: "openai/text-embedding-3-small",
          provider: "openai",
          requestModel: "text-embedding-3-small",
        },
        2,
        {
          context: "test batch",
          itemLabel: "chunks",
          expectedDimensions: EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
        },
      ),
    ).toThrowError(EmbeddingProviderError)

    const nonFinite = captureError(() =>
      validateEmbeddingProviderResult(
        {
          embeddings: [[Number.NaN]],
          dimensions: 1,
          tokenCount: 1,
          model: "openai/text-embedding-3-small",
          provider: "openai",
          requestModel: "text-embedding-3-small",
        },
        1,
        {
          context: "test batch",
          itemLabel: "chunks",
          expectedDimensions: 1,
        },
      ),
    )
    expect(nonFinite).toMatchObject({
      code: "invalid_response",
      retryable: true,
    } satisfies Partial<EmbeddingProviderError>)

    const dimensionMismatch = captureError(() =>
      validateEmbeddingProviderResult(
        {
          embeddings: [vector(1, 8)],
          dimensions: 8,
          tokenCount: 1,
          model: "openai/text-embedding-3-small",
          provider: "openai",
          requestModel: "text-embedding-3-small",
        },
        1,
        {
          context: "test batch",
          itemLabel: "chunks",
          expectedDimensions: EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
        },
      ),
    )
    expect(dimensionMismatch).toMatchObject({
      code: "dimension_mismatch",
      retryable: false,
    } satisfies Partial<EmbeddingProviderError>)
  })

  it("returns a typed auth error without echoing request input", async () => {
    const fetchImpl = vi.fn(async () => new Response("no", { status: 401 }))

    await expect(
      requestEmbeddingVectors(["sensitive transcript text"], {
        apiKey: "bad",
        context: "test batch",
        itemLabel: "chunks",
        expectedDimensions: EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "auth_failed" })
  })

  it("builds the endpoint relative to base URL paths", () => {
    expect(
      _internals.embeddingEndpoint("https://provider.example/api/v1").href,
    ).toBe("https://provider.example/api/v1/embeddings")
  })
})
