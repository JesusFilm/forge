import { describe, expect, it, vi } from "vitest"

import {
  EmbeddingProviderError,
  EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
  type EmbeddingProviderResult,
} from "../../services/embedding-provider"
import {
  handleTranscriptEmbeddingRouteRequest,
  planTranscriptEmbeddingRun,
  runTranscriptEmbeddingWorkflow,
  transcriptEmbeddingWorkflow,
  type TranscriptEmbeddingWorkflowInput,
  _internals,
} from "./transcript-embedding"

const vector = (seed: number) =>
  Array.from(
    { length: EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS },
    (_, index) => seed + index / 1000,
  )

function input(
  overrides: Partial<TranscriptEmbeddingWorkflowInput> = {},
): TranscriptEmbeddingWorkflowInput {
  const base: TranscriptEmbeddingWorkflowInput = {
    target: { external: { assetId: "asset-1", muxAssetId: "mux-1" } },
    language: "en",
    transcript: {
      text: "Hello there. This is a transcript.",
      segments: [
        { start: 0, end: 2, text: "Hello there." },
        { start: 2, end: 4, text: "This is a transcript." },
      ],
      artifactKey: "asset-1/transcript.json",
      provider: "mux",
      generatedAt: "2026-05-25T00:00:00.000Z",
    },
    model: {
      name: "embeddings",
      provider: "jesus-film-ai-gateway",
    },
    mode: "idempotent",
  }

  return { ...base, ...overrides } as TranscriptEmbeddingWorkflowInput
}

function embeddingResult(inputs: string[]): EmbeddingProviderResult {
  return {
    embeddings: inputs.map((_, index) => vector(index + 1)),
    dimensions: EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
    tokenCount: inputs.length * 3,
    model: "embeddings",
    provider: "jesus-film-ai-gateway",
    requestModel: "embeddings",
    nativeDimensions: 4096,
    transformVersion: "matryoshka-truncate-1536-v1",
  }
}

function seededEmbeddingResult(inputs: string[]): EmbeddingProviderResult {
  const seedForInput = (value: string) => {
    if (value.includes("Transcript: one two three")) return 1
    if (value.includes("Transcript: four five six")) return 2
    if (value.includes("Transcript: seven eight nine")) return 3
    if (value.includes("Transcript: ten eleven twelve")) return 4
    return 9
  }

  return {
    embeddings: inputs.map((value) => vector(seedForInput(value))),
    dimensions: EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
    tokenCount: inputs.length * 3,
    model: "embeddings",
    provider: "jesus-film-ai-gateway",
    requestModel: "embeddings",
    nativeDimensions: 4096,
    transformVersion: "matryoshka-truncate-1536-v1",
  }
}

describe("transcript embedding workflow", () => {
  it("plans segment-aware chunks and submits aligned vectors to Admin ingest", async () => {
    const embeddingRequester = vi.fn(async (items: string[]) =>
      embeddingResult(items),
    )
    const adminIngestClient = vi.fn(async (payload) => ({
      ok: true as const,
      result: {
        status: "created" as const,
        target: {
          videoId: "video-1",
          videoEditionId: "edition-1",
          coreId: "core-1",
          language: payload.language,
        },
        chunks: payload.chunks.length,
        model: payload.model.name,
        dimensions: payload.model.dimensions,
        mastraRunId: payload.generation.mastraRunId,
      },
    }))

    const result = await runTranscriptEmbeddingWorkflow(input(), {
      runId: "run-segment",
      generatedAt: "2026-05-25T01:00:00.000Z",
      embeddingRequester,
      adminIngestClient,
    })

    expect(result).toMatchObject({
      ok: true,
      status: "created",
      chunks: 1,
      totalTokens: expect.any(Number),
      mastraRunId: "run-segment",
      nativeDimensions: 4096,
      transformVersion: "matryoshka-truncate-1536-v1",
    })
    expect(embeddingRequester).toHaveBeenCalledWith(
      [expect.stringContaining("Time range: 00:00-00:04") as unknown as string],
      expect.objectContaining({
        expectedDimensions: EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
      }),
    )
    expect(adminIngestClient).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { external: { assetId: "asset-1", muxAssetId: "mux-1" } },
        language: "en",
        source: expect.objectContaining({
          artifactKey: "asset-1/transcript.json",
          contentHash: expect.stringMatching(/^sha256:/),
        }),
        model: {
          name: "embeddings",
          provider: "jesus-film-ai-gateway",
          dimensions: EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
          nativeDimensions: 4096,
          transformVersion: "matryoshka-truncate-1536-v1",
        },
        chunking: expect.objectContaining({
          type: "segment-aware",
          version: _internals.CHUNKING_VERSION,
        }),
        generation: {
          mode: "idempotent",
          generatedAt: "2026-05-25T01:00:00.000Z",
          mastraRunId: "run-segment",
        },
        chunks: [
          expect.objectContaining({
            chunkIndex: 0,
            chunkId: "chunk-0",
            text: "Hello there. This is a transcript.",
            rawSourceText: "Hello there. This is a transcript.",
            embeddingInputText: expect.stringContaining(
              "Transcript: Hello there. This is a transcript.",
            ),
            feltNeeds: [],
            bibleVerses: [],
            contentSummary: "Hello there. This is a transcript.",
            tone: "reflective",
            demographics: [],
            startSeconds: 0,
            endSeconds: 4,
            embedding: vector(1),
          }),
        ],
      }),
    )
  })

  it("falls back to plain-text chunking when segments are unavailable", async () => {
    const embeddingRequester = vi.fn(async (items: string[]) =>
      embeddingResult(items),
    )
    const adminIngestClient = vi.fn(async (payload) => ({
      ok: true as const,
      result: {
        status: "unchanged" as const,
        target: {
          videoId: "video-1",
          videoEditionId: "edition-1",
          coreId: "core-1",
          language: payload.language,
        },
        chunks: payload.chunks.length,
        model: payload.model.name,
        dimensions: payload.model.dimensions,
        mastraRunId: payload.generation.mastraRunId,
      },
    }))

    const result = await runTranscriptEmbeddingWorkflow(
      input({
        transcript: {
          text: "one two three four five six seven",
          artifactKey: "asset-1/transcript.json",
        },
        chunking: {
          maxChunkTokens: 4,
          overlapTokens: 0,
          maxBatchChunks: 2,
        },
      }),
      {
        runId: "run-plain",
        embeddingRequester,
        adminIngestClient,
      },
    )

    expect(result).toMatchObject({
      ok: true,
      status: "unchanged",
      chunks: 3,
      totalTokens: expect.any(Number),
    })
    expect(embeddingRequester).toHaveBeenCalledTimes(2)
    expect(adminIngestClient).toHaveBeenCalledWith(
      expect.objectContaining({
        chunking: expect.objectContaining({ type: "plain-text" }),
        chunks: [
          expect.objectContaining({
            text: "one two three",
            embeddingInputText: expect.stringContaining("Time range: unknown"),
          }),
          expect.objectContaining({ text: "four five six" }),
          expect.objectContaining({ text: "seven" }),
        ],
      }),
    )
  })

  it("recursively splits non-retryable provider batch rejections and preserves chunk order", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const embeddingRequester = vi.fn(async (items: string[]) => {
      if (items.length > 1) {
        throw new EmbeddingProviderError(
          "upstream_failed",
          "provider rejected oversized batch",
          false,
        )
      }
      return seededEmbeddingResult(items)
    })
    const adminIngestClient = vi.fn(async (payload) => ({
      ok: true as const,
      result: {
        status: "created" as const,
        target: {
          videoId: "video-1",
          videoEditionId: "edition-1",
          coreId: "core-1",
          language: payload.language,
        },
        chunks: payload.chunks.length,
        model: payload.model.name,
        dimensions: payload.model.dimensions,
        mastraRunId: payload.generation.mastraRunId,
      },
    }))

    const result = await runTranscriptEmbeddingWorkflow(
      input({
        transcript: {
          text: "one two three four five six seven eight nine ten eleven twelve",
          artifactKey: "asset-1/transcript.json",
        },
        chunking: {
          maxChunkTokens: 4,
          overlapTokens: 0,
          maxBatchChunks: 4,
          maxBatchTokens: 100_000,
        },
      }),
      {
        runId: "run-split-batch",
        embeddingRequester,
        adminIngestClient,
      },
    )

    expect(result).toMatchObject({
      ok: true,
      status: "created",
      chunks: 4,
      mastraRunId: "run-split-batch",
    })
    expect(
      embeddingRequester.mock.calls.map(([items]) => items.length),
    ).toEqual([4, 2, 1, 1, 2, 1, 1])
    const splitWarnings = warnSpy.mock.calls.map(([message]) =>
      JSON.parse(String(message)),
    )
    expect(splitWarnings).toEqual([
      expect.objectContaining({
        event: "transcript_embedding_batch_split_retry",
        mastraRunId: "run-split-batch",
        language: "en",
        model: "embeddings",
        provider: "jesus-film-ai-gateway",
        requestModel: "embeddings",
        errorCode: "upstream_failed",
        retryable: false,
        splitDepth: 0,
        splitPath: "root",
        chunkCount: 4,
      }),
      expect.objectContaining({
        splitDepth: 1,
        splitPath: "root.1",
        chunkCount: 2,
      }),
      expect.objectContaining({
        splitDepth: 1,
        splitPath: "root.2",
        chunkCount: 2,
      }),
    ])
    const serializedWarnings = JSON.stringify(splitWarnings)
    expect(serializedWarnings).not.toContain("one two three")
    expect(serializedWarnings).not.toContain("Transcript:")
    expect(serializedWarnings).not.toContain("embeddingInputText")
    expect(serializedWarnings).not.toContain('"embeddings":')
    expect(serializedWarnings).not.toContain('"embedding":')
    expect(serializedWarnings).not.toContain("apiKey")
    expect(serializedWarnings).not.toContain(
      "provider rejected oversized batch",
    )
    warnSpy.mockRestore()
    expect(adminIngestClient).toHaveBeenCalledWith(
      expect.objectContaining({
        chunks: [
          expect.objectContaining({
            text: "one two three",
            embedding: vector(1),
          }),
          expect.objectContaining({
            text: "four five six",
            embedding: vector(2),
          }),
          expect.objectContaining({
            text: "seven eight nine",
            embedding: vector(3),
          }),
          expect.objectContaining({
            text: "ten eleven twelve",
            embedding: vector(4),
          }),
        ],
      }),
    )
  })

  it("splits non-retryable invalid provider responses and preserves chunk order", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const embeddingRequester = vi.fn(async (items: string[]) => {
      if (items.length > 1) {
        throw new EmbeddingProviderError(
          "invalid_response",
          "provider returned an error envelope without data",
          false,
        )
      }
      return seededEmbeddingResult(items)
    })
    const adminIngestClient = vi.fn(async (payload) => ({
      ok: true as const,
      result: {
        status: "created" as const,
        target: {
          videoId: "video-1",
          videoEditionId: "edition-1",
          coreId: "core-1",
          language: payload.language,
        },
        chunks: payload.chunks.length,
        model: payload.model.name,
        dimensions: payload.model.dimensions,
        mastraRunId: payload.generation.mastraRunId,
      },
    }))

    const result = await runTranscriptEmbeddingWorkflow(
      input({
        transcript: {
          text: "one two three four five six seven eight nine ten eleven twelve",
          artifactKey: "asset-1/transcript.json",
        },
        chunking: {
          maxChunkTokens: 4,
          overlapTokens: 0,
          maxBatchChunks: 4,
          maxBatchTokens: 100_000,
        },
      }),
      {
        runId: "run-split-invalid-response",
        embeddingRequester,
        adminIngestClient,
      },
    )

    expect(result).toMatchObject({
      ok: true,
      status: "created",
      chunks: 4,
      mastraRunId: "run-split-invalid-response",
    })
    expect(
      embeddingRequester.mock.calls.map(([items]) => items.length),
    ).toEqual([4, 2, 1, 1, 2, 1, 1])
    const splitWarnings = warnSpy.mock.calls.map(([message]) =>
      JSON.parse(String(message)),
    )
    expect(splitWarnings).toEqual([
      expect.objectContaining({
        event: "transcript_embedding_batch_split_retry",
        mastraRunId: "run-split-invalid-response",
        errorCode: "invalid_response",
        retryable: false,
        splitDepth: 0,
        splitPath: "root",
        chunkCount: 4,
      }),
      expect.objectContaining({
        splitDepth: 1,
        splitPath: "root.1",
        chunkCount: 2,
      }),
      expect.objectContaining({
        splitDepth: 1,
        splitPath: "root.2",
        chunkCount: 2,
      }),
    ])
    const serializedWarnings = JSON.stringify(splitWarnings)
    expect(serializedWarnings).not.toContain("one two three")
    expect(serializedWarnings).not.toContain("Transcript:")
    expect(serializedWarnings).not.toContain("embeddingInputText")
    expect(serializedWarnings).not.toContain("provider returned")
    warnSpy.mockRestore()
    expect(adminIngestClient).toHaveBeenCalledWith(
      expect.objectContaining({
        chunks: [
          expect.objectContaining({
            text: "one two three",
            embedding: vector(1),
          }),
          expect.objectContaining({
            text: "four five six",
            embedding: vector(2),
          }),
          expect.objectContaining({
            text: "seven eight nine",
            embedding: vector(3),
          }),
          expect.objectContaining({
            text: "ten eleven twelve",
            embedding: vector(4),
          }),
        ],
      }),
    )
  })

  it("retries unsplittable gateway provider responses with scrubbed telemetry", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const embeddingRequester = vi.fn(async (items: string[]) => {
      if (embeddingRequester.mock.calls.length < 3) {
        throw new EmbeddingProviderError(
          "invalid_response",
          "gateway returned an empty response body",
          false,
        )
      }
      return seededEmbeddingResult(items)
    })
    const adminIngestClient = vi.fn(async (payload) => ({
      ok: true as const,
      result: {
        status: "created" as const,
        target: {
          videoId: "video-1",
          videoEditionId: "edition-1",
          coreId: "core-1",
          language: payload.language,
        },
        chunks: payload.chunks.length,
        model: payload.model.name,
        dimensions: payload.model.dimensions,
        mastraRunId: payload.generation.mastraRunId,
      },
    }))

    const result = await runTranscriptEmbeddingWorkflow(input(), {
      runId: "run-singleton-retry",
      embeddingRequester,
      adminIngestClient,
      providerRetryDelayMs: 0,
    })

    expect(result).toMatchObject({
      ok: true,
      status: "created",
      chunks: 1,
      mastraRunId: "run-singleton-retry",
    })
    expect(embeddingRequester).toHaveBeenCalledTimes(3)
    const retryWarnings = warnSpy.mock.calls.map(([message]) =>
      JSON.parse(String(message)),
    )
    expect(retryWarnings).toEqual([
      expect.objectContaining({
        event: "transcript_embedding_batch_provider_retry",
        mastraRunId: "run-singleton-retry",
        errorCode: "invalid_response",
        retryable: false,
        attempt: 1,
        maxAttempts: 3,
        delayMs: 0,
        chunkCount: 1,
      }),
      expect.objectContaining({
        event: "transcript_embedding_batch_provider_retry",
        attempt: 2,
        maxAttempts: 3,
        delayMs: 0,
        chunkCount: 1,
      }),
    ])
    const serializedWarnings = JSON.stringify(retryWarnings)
    expect(serializedWarnings).not.toContain("Jesus teaches hope")
    expect(serializedWarnings).not.toContain("Transcript:")
    expect(serializedWarnings).not.toContain("embeddingInputText")
    expect(serializedWarnings).not.toContain("gateway returned")
    warnSpy.mockRestore()
    expect(adminIngestClient).toHaveBeenCalledOnce()
  })

  it("rejects malformed split child results before Admin ingest", async () => {
    const embeddingRequester = vi.fn(async (items: string[]) => {
      if (items.length > 2) {
        throw new EmbeddingProviderError(
          "upstream_failed",
          "provider rejected oversized batch",
          false,
        )
      }
      if (items.length === 2) return seededEmbeddingResult(items.slice(0, 1))
      return seededEmbeddingResult(items)
    })
    const adminIngestClient = vi.fn()

    await expect(
      runTranscriptEmbeddingWorkflow(
        input({
          transcript: {
            text: "one two three four five six seven eight nine ten eleven twelve",
            artifactKey: "asset-1/transcript.json",
          },
          chunking: {
            maxChunkTokens: 4,
            overlapTokens: 0,
            maxBatchChunks: 4,
            maxBatchTokens: 100_000,
          },
        }),
        {
          runId: "run-split-count-mismatch",
          embeddingRequester,
          adminIngestClient,
        },
      ),
    ).resolves.toEqual({
      ok: false,
      reason: "provider_failed",
      retryable: true,
      mastraRunId: "run-split-count-mismatch",
      adminStatus: undefined,
      adminReason: undefined,
    })
    expect(
      embeddingRequester.mock.calls.map(([items]) => items.length),
    ).toEqual([4, 2])
    expect(adminIngestClient).not.toHaveBeenCalled()
  })

  it("rejects inconsistent split child provenance before Admin ingest", async () => {
    const embeddingRequester = vi.fn(async (items: string[]) => {
      if (items.length > 2) {
        throw new EmbeddingProviderError(
          "upstream_failed",
          "provider rejected oversized batch",
          false,
        )
      }
      const result = seededEmbeddingResult(items)
      if (items[0]?.includes("Transcript: one two three")) {
        return { ...result, transformVersion: undefined }
      }
      return result
    })
    const adminIngestClient = vi.fn()

    await expect(
      runTranscriptEmbeddingWorkflow(
        input({
          transcript: {
            text: "one two three four five six seven eight nine ten eleven twelve",
            artifactKey: "asset-1/transcript.json",
          },
          chunking: {
            maxChunkTokens: 4,
            overlapTokens: 0,
            maxBatchChunks: 4,
            maxBatchTokens: 100_000,
          },
        }),
        {
          runId: "run-split-provenance-mismatch",
          embeddingRequester,
          adminIngestClient,
        },
      ),
    ).resolves.toEqual({
      ok: false,
      reason: "provider_dimension_mismatch",
      retryable: false,
      mastraRunId: "run-split-provenance-mismatch",
    })
    expect(
      embeddingRequester.mock.calls.map(([items]) => items.length),
    ).toEqual([4, 2, 2])
    expect(adminIngestClient).not.toHaveBeenCalled()
  })

  it("returns safe failures for empty sources, provider failures, and Admin rejects", async () => {
    await expect(
      runTranscriptEmbeddingWorkflow(
        input({ transcript: { text: "   ", segments: [] } }),
        { runId: "run-empty" },
      ),
    ).resolves.toEqual({
      ok: false,
      reason: "invalid_input",
      retryable: false,
      mastraRunId: "run-empty",
    })

    await expect(
      runTranscriptEmbeddingWorkflow(input(), {
        runId: "run-provider",
        embeddingRequester: async () => {
          throw new EmbeddingProviderError(
            "dimension_mismatch",
            "provider dimensions changed",
          )
        },
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "provider_dimension_mismatch",
      retryable: false,
      mastraRunId: "run-provider",
    })

    await expect(
      runTranscriptEmbeddingWorkflow(input(), {
        runId: "run-admin",
        embeddingRequester: async (items) => embeddingResult(items),
        adminIngestClient: async () => ({
          ok: false,
          reason: "rejected",
          retryable: false,
          status: 409,
          result: {
            status: "rejected",
            reason: "existing_transcript_differs",
            target: {
              videoId: "video-1",
              videoEditionId: "edition-1",
              coreId: "core-1",
              language: "en",
            },
            chunks: 1,
            model: "embeddings",
            dimensions: EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
            mastraRunId: "run-admin",
          },
        }),
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "admin_ingest_rejected",
      retryable: false,
      mastraRunId: "run-admin",
      adminStatus: "rejected",
      adminReason: "existing_transcript_differs",
    })
  })

  it("keeps the route authenticated and response payload scrubbed", async () => {
    const unauthorized = await handleTranscriptEmbeddingRouteRequest({
      authHeader: "Bearer wrong",
      serviceKeys: ["secret"],
      readJson: async () => input(),
    })

    expect(unauthorized).toEqual({
      status: 401,
      body: { error: "Service bearer required" },
    })

    const authorized = await handleTranscriptEmbeddingRouteRequest({
      authHeader: "Bearer secret",
      serviceKeys: ["secret"],
      readJson: async () => input(),
      launch: async (_body, { runId }) => ({
        ok: true,
        status: "created",
        target: {
          videoId: "video-1",
          videoEditionId: "edition-1",
          coreId: "core-1",
          language: "en",
        },
        chunks: 1,
        totalTokens: 8,
        model: "embeddings",
        provider: "jesus-film-ai-gateway",
        dimensions: EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
        nativeDimensions: 4096,
        transformVersion: "matryoshka-truncate-1536-v1",
        mastraRunId: runId,
        sourceContentHash: "sha256:test",
        chunking: {
          type: "segment-aware",
          maxChunkTokens: 500,
          overlapTokens: 100,
          version: _internals.CHUNKING_VERSION,
        },
      }),
    })

    expect(authorized.status).toBe(200)
    expect(JSON.stringify(authorized.body)).not.toContain('"embedding"')
    expect(JSON.stringify(authorized.body)).not.toContain("Hello there")
  })

  it("keeps committed step summaries free of transcript text and vectors", () => {
    const planned = planTranscriptEmbeddingRun(input(), {
      mastraRunId: "run-safe-summary",
    })
    const summary = _internals.summarizePlannedRun(planned)
    const serialized = JSON.stringify(summary)

    expect(serialized).not.toContain("Hello there")
    expect(serialized).not.toContain('"chunks"')
    expect(summary).toMatchObject({
      source: {
        textLength: 34,
        segmentCount: 2,
        contentHash: expect.stringMatching(/^sha256:/),
      },
      chunking: {
        totalChunks: 1,
        totalTokens: expect.any(Number),
      },
    })
  })

  it("plans v2 enriched chunks with source provenance, canonical felt needs, and demographics", () => {
    const planned = planTranscriptEmbeddingRun(
      input({
        transcript: {
          text: "Jesus gives hope and love to children and parents in the family in John 3:16.",
          segments: [
            {
              start: 65,
              end: 70,
              text: "Jesus gives hope and love to children and parents in the family in John 3:16.",
            },
          ],
          artifactKey: "admin-video-subtitle/sub-1.vtt",
          kind: "subtitle",
          languageId: "lang-en",
          languageSlug: "english",
          subtitleId: "sub-1",
          format: "vtt",
          url: "https://api-media-core.jesusfilm.org/subtitles/en.vtt",
          provider: "admin-subtitle",
          generatedAt: "2026-05-25T00:00:00.000Z",
        },
      }),
      { mastraRunId: "run-v2-plan" },
    )

    expect(planned.source).toMatchObject({
      artifactKey: "admin-video-subtitle/sub-1.vtt",
      kind: "subtitle",
      languageId: "lang-en",
      languageSlug: "english",
      subtitleId: "sub-1",
      format: "vtt",
      provider: "admin-subtitle",
      contentHash: expect.stringMatching(/^sha256:/),
    })
    expect(planned.chunks[0]).toMatchObject({
      rawSourceText:
        "Jesus gives hope and love to children and parents in the family in John 3:16.",
      feltNeeds: ["Hope", "Love"],
      bibleVerses: ["John 3:16"],
      demographics: ["Children", "Parents", "Families"],
      embeddingInputText: expect.stringContaining("Time range: 01:05-01:10"),
    })
    expect(planned.chunks[0]?.embeddingInputText).toContain(
      "Demographics: Children, Parents, Families",
    )
  })

  it("preserves precise failures through the committed route launcher", async () => {
    const invalid = await handleTranscriptEmbeddingRouteRequest({
      authHeader: "Bearer secret",
      serviceKeys: ["secret"],
      readJson: async () =>
        input({ transcript: { text: "   ", segments: [] } }),
    })

    expect(invalid.status).toBe(400)
    expect(invalid.body.result).toMatchObject({
      ok: false,
      reason: "invalid_input",
      retryable: false,
    })

    const providerConfig = await handleTranscriptEmbeddingRouteRequest({
      authHeader: "Bearer secret",
      serviceKeys: ["secret"],
      readJson: async () => input(),
    })

    expect(providerConfig.status).toBe(503)
    expect(providerConfig.body.result).toMatchObject({
      ok: false,
      reason: "provider_config_missing",
      retryable: false,
    })

    const missingExternalMux = await handleTranscriptEmbeddingRouteRequest({
      authHeader: "Bearer secret",
      serviceKeys: ["secret"],
      readJson: async () =>
        input({ target: { external: { assetId: "asset-1" } } }),
    })

    expect(missingExternalMux.status).toBe(400)
    expect(missingExternalMux.body.result).toMatchObject({
      ok: false,
      reason: "invalid_input",
      retryable: false,
    })
  })

  it("accepts a caller run id envelope at the transcript embedding route", async () => {
    const launch = vi.fn(async () => ({
      ok: true as const,
      status: "created" as const,
      chunks: 1,
      totalTokens: 4,
      model: "embeddings",
      provider: "jesus-film-ai-gateway",
      dimensions: 1536,
      mastraRunId: "run-from-admin",
      sourceContentHash: "sha256:test",
      target: {
        videoId: "video-1",
        videoEditionId: "edition-1",
        coreId: "core-1",
        language: "en",
      },
      chunking: {
        type: "segment-aware" as const,
        maxChunkTokens: 500,
        overlapTokens: 100,
        version: _internals.CHUNKING_VERSION,
      },
    }))
    const workflowInput = input()

    const response = await handleTranscriptEmbeddingRouteRequest({
      authHeader: "Bearer secret",
      serviceKeys: ["secret"],
      readJson: async () => ({
        runId: "run-from-admin",
        input: workflowInput,
      }),
      launch,
    })

    expect(response.status).toBe(200)
    expect(response.body.result).toMatchObject({
      ok: true,
      mastraRunId: "run-from-admin",
    })
    expect(launch).toHaveBeenCalledWith(workflowInput, {
      runId: "run-from-admin",
    })
  })

  it("marks committed Mastra runs as failed when the workflow result is a typed failure", async () => {
    const run = await transcriptEmbeddingWorkflow.createRun({
      runId: "run-committed-provider-config",
    })

    const result = await run.start({ inputData: input() })

    expect(result.status).toBe("failed")
    expect(_internals.workflowFailureFromRunResult(result)).toMatchObject({
      ok: false,
      reason: "provider_config_missing",
      retryable: false,
      mastraRunId: "run-committed-provider-config",
    })
  })

  it("registers the committed Mastra workflow", () => {
    expect(transcriptEmbeddingWorkflow.id).toBe("transcript-embedding")
    expect(transcriptEmbeddingWorkflow.committed).toBe(true)
  })
})
