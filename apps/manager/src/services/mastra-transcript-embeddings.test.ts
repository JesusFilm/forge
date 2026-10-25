import { describe, expect, it, vi } from "vitest"

import { launchMastraTranscriptEmbeddings } from "@/services/mastra-transcript-embeddings"

const successResult = {
  ok: true,
  status: "created",
  chunks: 2,
  totalTokens: 14,
  model: "openai/text-embedding-3-small",
  provider: "openai",
  dimensions: 1536,
  mastraRunId: "run-1",
  sourceContentHash: "sha256:test",
  chunking: {
    type: "segment-aware",
    maxChunkTokens: 500,
    overlapTokens: 100,
    version: "manager-transcript-v1",
  },
}

describe("launchMastraTranscriptEmbeddings", () => {
  it("returns config_missing when service configuration is absent", async () => {
    await expect(
      launchMastraTranscriptEmbeddings({
        assetId: "asset-1",
        muxAssetId: "mux-1",
        language: "en",
        transcript: { text: "hello transcript" },
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "config_missing",
      retryable: false,
    })
  })

  it("posts transcript source to Mastra without vector-shaped fields", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ result: successResult }),
    )

    await expect(
      launchMastraTranscriptEmbeddings(
        {
          assetId: "asset-1",
          muxAssetId: "mux-1",
          adminVideoId: "admin-video-1",
          language: "en",
          transcript: {
            text: "hello transcript",
            segments: [{ start: 0, end: 2, text: "hello transcript" }],
            provider: "mux",
          },
        },
        {
          baseUrl: "https://mastra.internal",
          bearer: "secret",
          fetchImpl,
        },
      ),
    ).resolves.toEqual(successResult)

    const body = JSON.parse(
      String(fetchImpl.mock.calls[0]?.[1]?.body),
    ) as Record<string, unknown>
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://mastra.internal/forge-transcript-embeddings"),
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer secret",
        }),
      }),
    )
    expect(body).toMatchObject({
      target: {
        external: {
          assetId: "asset-1",
          muxAssetId: "mux-1",
          adminVideoId: "admin-video-1",
        },
      },
      language: "en",
      transcript: {
        text: "hello transcript",
        artifactKey: "asset-1/transcript.json",
      },
      mode: "idempotent",
    })
    expect(JSON.stringify(body)).not.toContain("embedding")
  })

  it("returns Mastra product failures and auth failures safely", async () => {
    const productFailure = {
      ok: false,
      reason: "admin_ingest_rejected",
      retryable: false,
      mastraRunId: "run-2",
      adminStatus: "rejected",
      adminReason: "existing_transcript_differs",
    }
    const rejected = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ result: productFailure }, { status: 409 }),
    )

    await expect(
      launchMastraTranscriptEmbeddings(
        {
          assetId: "asset-1",
          muxAssetId: "mux-1",
          language: "en",
          transcript: { text: "hello transcript" },
        },
        {
          baseUrl: "https://mastra.internal",
          bearer: "secret",
          fetchImpl: rejected,
        },
      ),
    ).resolves.toEqual(productFailure)

    const authFailure = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response("no", { status: 401 }),
    )
    await expect(
      launchMastraTranscriptEmbeddings(
        {
          assetId: "asset-1",
          muxAssetId: "mux-1",
          language: "en",
          transcript: { text: "hello transcript" },
        },
        {
          baseUrl: "https://mastra.internal",
          bearer: "bad",
          fetchImpl: authFailure,
        },
      ),
    ).resolves.toEqual({
      ok: false,
      reason: "auth_failed",
      retryable: false,
    })
  })

  it("treats unknown workflow enum values as parse errors", async () => {
    const malformedStatus = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({
          result: {
            ...successResult,
            status: "surprising-status",
          },
        }),
    )

    await expect(
      launchMastraTranscriptEmbeddings(
        {
          assetId: "asset-1",
          muxAssetId: "mux-1",
          language: "en",
          transcript: { text: "hello transcript" },
        },
        {
          baseUrl: "https://mastra.internal",
          bearer: "secret",
          fetchImpl: malformedStatus,
        },
      ),
    ).resolves.toEqual({
      ok: false,
      reason: "parse_error",
      retryable: true,
    })

    const malformedReason = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({
          result: {
            ok: false,
            reason: "surprising-reason",
            retryable: false,
          },
        }),
    )

    await expect(
      launchMastraTranscriptEmbeddings(
        {
          assetId: "asset-1",
          muxAssetId: "mux-1",
          language: "en",
          transcript: { text: "hello transcript" },
        },
        {
          baseUrl: "https://mastra.internal",
          bearer: "secret",
          fetchImpl: malformedReason,
        },
      ),
    ).resolves.toEqual({
      ok: false,
      reason: "parse_error",
      retryable: true,
    })
  })
})
