import { describe, expect, it, vi } from "vitest"

import {
  callAdminSceneIngest,
  type AdminSceneEmbeddingIngestPayload,
} from "./admin-scene-ingest-client"

const vector = Array.from({ length: 1536 }, (_, index) => index / 1000)

function payload(): AdminSceneEmbeddingIngestPayload {
  return {
    target: {
      admin: {
        videoId: "video-1",
        videoEditionId: "edition-1",
        coreId: "core-1",
      },
    },
    locale: "en",
    source: {
      artifactKey: "42/scene-analysis.json",
      artifactVersion: "manager-scene-analysis-v1",
      provider: "manager",
      contentHash: "sha256:test",
    },
    model: {
      name: "openai/text-embedding-3-small",
      provider: "openai",
      dimensions: 1536,
    },
    generation: {
      mode: "idempotent",
      generatedAt: "2026-05-25T00:00:00.000Z",
      mastraRunId: "run-1",
    },
    scenes: [
      {
        sceneIndex: 0,
        startSeconds: 0,
        endSeconds: 30,
        sourceText: "Themes: hope.\nContent: An opening scene.",
        description: "Themes: hope.\nContent: An opening scene.",
        themes: ["hope"],
        bibleVerses: [],
        demographics: [],
        spiritualContext: [],
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
    locale: "en",
  },
  scenes: 1,
  model: "openai/text-embedding-3-small",
  dimensions: 1536,
  mastraRunId: "run-1",
}

describe("Admin scene ingest client", () => {
  it("returns config_missing without URL or bearer", async () => {
    await expect(callAdminSceneIngest({ payload: payload() })).resolves.toEqual(
      {
        ok: false,
        reason: "config_missing",
        retryable: false,
      },
    )
  })

  it("sends bearer auth and parses an ingest result", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ result: adminResult }))

    await expect(
      callAdminSceneIngest({
        ingestUrl:
          "https://admin.internal/api/internal/mastra/scene-embeddings",
        bearer: "secret",
        payload: payload(),
        fetchImpl,
      }),
    ).resolves.toEqual({ ok: true, result: adminResult })

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://admin.internal/api/internal/mastra/scene-embeddings"),
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
      reason: "existing_scene_differs",
    }
    const fetchImpl = vi.fn(async () =>
      Response.json({ result: rejected }, { status: 409 }),
    )

    await expect(
      callAdminSceneIngest({
        ingestUrl:
          "https://admin.internal/api/internal/mastra/scene-embeddings",
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
          error: "Scene embedding ingest failed",
          reason: "target_not_found",
          retryable: false,
        },
        { status: 404 },
      ),
    )

    await expect(
      callAdminSceneIngest({
        ingestUrl:
          "https://admin.internal/api/internal/mastra/scene-embeddings",
        bearer: "secret",
        payload: payload(),
        fetchImpl,
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "rejected",
      retryable: false,
      status: 404,
      adminReason: "target_not_found",
    })
  })

  it("classifies upstream auth and invalid response bodies", async () => {
    const authFailure = vi.fn(async () => new Response("no", { status: 401 }))

    await expect(
      callAdminSceneIngest({
        ingestUrl:
          "https://admin.internal/api/internal/mastra/scene-embeddings",
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
      callAdminSceneIngest({
        ingestUrl:
          "https://admin.internal/api/internal/mastra/scene-embeddings",
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
      callAdminSceneIngest({
        ingestUrl:
          "https://admin.internal/api/internal/mastra/scene-embeddings",
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
