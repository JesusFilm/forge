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
      totalTokens: 8,
      mastraRunId: "run-segment",
      nativeDimensions: 4096,
      transformVersion: "matryoshka-truncate-1536-v1",
    })
    expect(embeddingRequester).toHaveBeenCalledWith(
      ["Hello there. This is a transcript."],
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
      totalTokens: 10,
    })
    expect(embeddingRequester).toHaveBeenCalledTimes(2)
    expect(adminIngestClient).toHaveBeenCalledWith(
      expect.objectContaining({
        chunking: expect.objectContaining({ type: "plain-text" }),
        chunks: [
          expect.objectContaining({ text: "one two three" }),
          expect.objectContaining({ text: "four five six" }),
          expect.objectContaining({ text: "seven" }),
        ],
      }),
    )
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
        totalTokens: 8,
      },
    })
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
