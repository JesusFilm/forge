import { describe, expect, it, vi } from "vitest"

import {
  callAdminTranscriptIngest,
  type AdminTranscriptEmbeddingIngestPayload,
} from "./admin-transcript-ingest-client"

const vector = Array.from({ length: 1536 }, (_, index) => index / 1000)

function payload(): AdminTranscriptEmbeddingIngestPayload {
  return {
    target: { external: { assetId: "asset-1", muxAssetId: "mux-1" } },
    language: "en",
    source: {
      text: "Hello transcript",
      contentHash: "sha256:test",
    },
    model: {
      name: "embeddings",
      provider: "jesus-film-ai-gateway",
      dimensions: 1536,
      nativeDimensions: 4096,
      transformVersion: "matryoshka-truncate-1536-v1",
    },
    chunking: {
      type: "plain-text",
      maxChunkTokens: 500,
      overlapTokens: 100,
      version: "manager-transcript-v1",
    },
    generation: {
      mode: "idempotent",
      generatedAt: "2026-05-25T00:00:00.000Z",
      mastraRunId: "run-1",
    },
    chunks: [
      {
        chunkIndex: 0,
        chunkId: "chunk-0",
        text: "Hello transcript",
        tokenCount: 3,
        embedding: vector,
      },
    ],
  }
}

const adminResult = {
  status: "created",
  target: {
    videoId: "video-1",
    videoEditionId: "edition-1",
    coreId: "core-1",
    language: "en",
  },
  chunks: 1,
  model: "embeddings",
  dimensions: 1536,
  mastraRunId: "run-1",
}

describe("Admin transcript ingest client", () => {
  it("returns config_missing without URL or bearer", async () => {
    await expect(
      callAdminTranscriptIngest({ payload: payload() }),
    ).resolves.toEqual({
      ok: false,
      reason: "config_missing",
      retryable: false,
    })
  })

  it("sends bearer auth and parses an ingest result", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ result: adminResult }))

    await expect(
      callAdminTranscriptIngest({
        ingestUrl:
          "https://admin.internal/api/internal/mastra/transcript-embeddings",
        bearer: "secret",
        payload: payload(),
        fetchImpl,
      }),
    ).resolves.toEqual({ ok: true, result: adminResult })

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL(
        "https://admin.internal/api/internal/mastra/transcript-embeddings",
      ),
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer secret",
        }),
      }),
    )
  })

  it("classifies rejected idempotent writes as safe product failures", async () => {
    const rejected = {
      ...adminResult,
      status: "rejected",
      reason: "existing_transcript_differs",
    }
    const fetchImpl = vi.fn(async () =>
      Response.json({ result: rejected }, { status: 409 }),
    )

    await expect(
      callAdminTranscriptIngest({
        ingestUrl:
          "https://admin.internal/api/internal/mastra/transcript-embeddings",
        bearer: "secret",
        payload: payload(),
        fetchImpl,
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "rejected",
      retryable: false,
      status: 409,
      result: rejected,
    })
  })

  it("preserves structured Admin target-resolution errors", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json(
        {
          error: "Transcript embedding ingest failed",
          reason: "target_ambiguous",
          retryable: false,
        },
        { status: 409 },
      ),
    )

    await expect(
      callAdminTranscriptIngest({
        ingestUrl:
          "https://admin.internal/api/internal/mastra/transcript-embeddings",
        bearer: "secret",
        payload: payload(),
        fetchImpl,
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "rejected",
      retryable: false,
      status: 409,
      adminReason: "target_ambiguous",
    })
  })

  it("classifies upstream auth and invalid response bodies", async () => {
    const authFailure = vi.fn(async () => new Response("no", { status: 401 }))

    await expect(
      callAdminTranscriptIngest({
        ingestUrl:
          "https://admin.internal/api/internal/mastra/transcript-embeddings",
        bearer: "bad",
        payload: payload(),
        fetchImpl: authFailure,
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "auth_failed",
      retryable: false,
      status: 401,
    })

    const invalidJson = vi.fn(async () => Response.json({ ok: true }))

    await expect(
      callAdminTranscriptIngest({
        ingestUrl:
          "https://admin.internal/api/internal/mastra/transcript-embeddings",
        bearer: "secret",
        payload: payload(),
        fetchImpl: invalidJson,
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "parse_error",
      retryable: true,
      status: 200,
    })
  })

  it("rejects unknown Admin ingest status values as parse errors", async () => {
    const invalidStatus = vi.fn(async () =>
      Response.json({
        result: {
          ...adminResult,
          status: "surprising-status",
        },
      }),
    )

    await expect(
      callAdminTranscriptIngest({
        ingestUrl:
          "https://admin.internal/api/internal/mastra/transcript-embeddings",
        bearer: "secret",
        payload: payload(),
        fetchImpl: invalidStatus,
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "parse_error",
      retryable: true,
      status: 200,
    })
  })
})
