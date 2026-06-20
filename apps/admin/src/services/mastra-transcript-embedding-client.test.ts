import { describe, expect, it, vi } from "vitest"

import { launchMastraTranscriptEmbedding } from "@/services/mastra-transcript-embedding-client"

const successResult = {
  ok: true,
  status: "created",
  chunks: 1,
  totalTokens: 4,
  model: "embeddings",
  provider: "jesus-film-ai-gateway",
  dimensions: 1536,
  mastraRunId: "run-1",
  sourceContentHash: "sha256:test",
}

describe("launchMastraTranscriptEmbedding", () => {
  it("returns config_missing without Mastra URL or bearer", async () => {
    await expect(
      launchMastraTranscriptEmbedding({
        target: { videoId: "v-1", videoEditionId: "e-1", coreId: "core-1" },
        language: "en",
        cmsVideoId: 42,
        transcript: {
          text: "hello transcript",
          segments: [{ start: 0, end: 1, text: "hello transcript" }],
          resolvedProvider: "mux",
        },
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "config_missing",
      retryable: false,
    })
  })

  it("posts Admin target identifiers and transcript source to Mastra", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ result: successResult }),
    )

    await expect(
      launchMastraTranscriptEmbedding(
        {
          target: {
            videoId: "v-1",
            videoEditionId: "e-1",
            coreId: "core-1",
          },
          language: "en",
          cmsVideoId: 42,
          transcript: {
            text: "hello transcript",
            segments: [{ start: 0, end: 1, text: "hello transcript" }],
            resolvedProvider: "mux",
          },
          mode: "repair",
        },
        {
          baseUrl: "https://mastra.internal",
          bearer: "secret",
          runId: "run-launch-1",
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
      runId: "run-launch-1",
      input: {
        target: {
          admin: {
            videoId: "v-1",
            videoEditionId: "e-1",
            coreId: "core-1",
          },
        },
        language: "en",
        transcript: {
          text: "hello transcript",
          artifactKey: "42/transcript.json",
          provider: "mux",
        },
        mode: "repair",
      },
    })
    expect(JSON.stringify(body)).not.toContain("embedding")
  })

  it("posts resolved subtitle source keys instead of hardcoded Manager artifact keys", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ result: successResult }),
    )

    await launchMastraTranscriptEmbedding(
      {
        target: {
          videoId: "v-1",
          videoEditionId: "e-1",
          coreId: "core-1",
        },
        language: "en",
        cmsVideoId: 42,
        transcript: {
          text: "subtitle transcript",
          segments: [{ start: 0, end: 2, text: "subtitle transcript" }],
          artifactKey: "admin-video-subtitle/sub-1.vtt",
          kind: "subtitle",
          languageId: "lang-en",
          languageSlug: "english",
          subtitleId: "sub-1",
          format: "vtt",
          url: "https://api-media-core.jesusfilm.org/subtitles/en.vtt",
          provider: "admin-subtitle",
          generatedAt: "2026-06-01T00:00:00.000Z",
        },
      },
      {
        baseUrl: "https://mastra.internal",
        bearer: "secret",
        fetchImpl,
      },
    )

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as {
      input?: Record<string, unknown>
    }
    expect(body).toMatchObject({
      input: {
        transcript: {
          artifactKey: "admin-video-subtitle/sub-1.vtt",
          kind: "subtitle",
          languageId: "lang-en",
          languageSlug: "english",
          subtitleId: "sub-1",
          format: "vtt",
          url: "https://api-media-core.jesusfilm.org/subtitles/en.vtt",
          provider: "admin-subtitle",
          generatedAt: "2026-06-01T00:00:00.000Z",
        },
      },
    })
  })

  it("preserves caller run id on Mastra gateway timeouts", async () => {
    const timedOut = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ error: "Gateway Timeout" }, { status: 504 }),
    )

    await expect(
      launchMastraTranscriptEmbedding(
        {
          target: { videoId: "v-1", videoEditionId: "e-1" },
          language: "en",
          cmsVideoId: 42,
          transcript: {
            text: "hello transcript",
            segments: [{ start: 0, end: 1, text: "hello transcript" }],
          },
        },
        {
          baseUrl: "https://mastra.internal",
          bearer: "secret",
          runId: "run-timeout",
          fetchImpl: timedOut,
        },
      ),
    ).resolves.toEqual({
      ok: false,
      reason: "network_error",
      retryable: true,
      mastraRunId: "run-timeout",
    })
  })

  it("preserves caller run id when the Mastra launch fetch throws", async () => {
    const threw = vi.fn(async () => {
      throw Object.assign(new Error("operation timed out"), {
        name: "TimeoutError",
      })
    })

    await expect(
      launchMastraTranscriptEmbedding(
        {
          target: { videoId: "v-1", videoEditionId: "e-1" },
          language: "en",
          cmsVideoId: 42,
          transcript: {
            text: "hello transcript",
            segments: [{ start: 0, end: 1, text: "hello transcript" }],
          },
        },
        {
          baseUrl: "https://mastra.internal",
          bearer: "secret",
          runId: "run-fetch-threw",
          fetchImpl: threw as typeof fetch,
        },
      ),
    ).resolves.toEqual({
      ok: false,
      reason: "network_error",
      retryable: true,
      mastraRunId: "run-fetch-threw",
    })
  })

  it("returns Mastra failures and upstream auth failures safely", async () => {
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
      launchMastraTranscriptEmbedding(
        {
          target: { videoId: "v-1", videoEditionId: "e-1" },
          language: "en",
          cmsVideoId: 42,
          transcript: {
            text: "hello transcript",
            segments: [{ start: 0, end: 1, text: "hello transcript" }],
          },
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
      launchMastraTranscriptEmbedding(
        {
          target: { videoId: "v-1", videoEditionId: "e-1" },
          language: "en",
          cmsVideoId: 42,
          transcript: {
            text: "hello transcript",
            segments: [{ start: 0, end: 1, text: "hello transcript" }],
          },
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
      launchMastraTranscriptEmbedding(
        {
          target: { videoId: "v-1", videoEditionId: "e-1" },
          language: "en",
          cmsVideoId: 42,
          transcript: {
            text: "hello transcript",
            segments: [{ start: 0, end: 1, text: "hello transcript" }],
          },
        },
        {
          baseUrl: "https://mastra.internal",
          bearer: "secret",
          runId: "run-malformed-status",
          fetchImpl: malformedStatus,
        },
      ),
    ).resolves.toEqual({
      ok: false,
      reason: "parse_error",
      retryable: true,
      mastraRunId: "run-malformed-status",
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
      launchMastraTranscriptEmbedding(
        {
          target: { videoId: "v-1", videoEditionId: "e-1" },
          language: "en",
          cmsVideoId: 42,
          transcript: {
            text: "hello transcript",
            segments: [{ start: 0, end: 1, text: "hello transcript" }],
          },
        },
        {
          baseUrl: "https://mastra.internal",
          bearer: "secret",
          runId: "run-malformed-reason",
          fetchImpl: malformedReason,
        },
      ),
    ).resolves.toEqual({
      ok: false,
      reason: "parse_error",
      retryable: true,
      mastraRunId: "run-malformed-reason",
    })
  })
})
