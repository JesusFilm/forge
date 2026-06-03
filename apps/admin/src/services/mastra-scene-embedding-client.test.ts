import { describe, expect, it, vi } from "vitest"

import { launchMastraSceneEmbedding } from "@/services/mastra-scene-embedding-client"

const successResult = {
  ok: true,
  status: "created",
  scenes: 2,
  providerTokens: 12,
  model: "embeddings",
  provider: "jesus-film-ai-gateway",
  dimensions: 1536,
  mastraRunId: "run-1",
  sourceContentHash: "sha256:test",
}

function sceneAnalysis() {
  return {
    scenes: [
      {
        sceneIndex: 0,
        startSeconds: 0,
        endSeconds: 30,
        chapterTitle: "Intro",
        description: "Themes: hope.\nContent: An opening scene.",
        themes: ["hope"],
        bibleVerses: [],
        demographics: [],
        spiritualContext: [],
      },
      {
        sceneIndex: 1,
        startSeconds: 30,
        endSeconds: null,
        chapterTitle: null,
        description: "Themes: courage.\nContent: A closing scene.",
        themes: ["courage"],
        bibleVerses: [],
        demographics: [],
        spiritualContext: [],
      },
    ],
    totalInputTokens: 10,
    totalOutputTokens: 4,
  }
}

describe("launchMastraSceneEmbedding", () => {
  it("returns config_missing without Mastra URL or bearer", async () => {
    await expect(
      launchMastraSceneEmbedding({
        target: { videoId: "v-1", videoEditionId: "e-1", coreId: "core-1" },
        locale: "en",
        assetId: 42,
        sceneAnalysis: sceneAnalysis(),
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "config_missing",
      retryable: false,
    })
  })

  it("posts Admin target identifiers and scene-analysis source to Mastra", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ result: successResult }),
    )

    await expect(
      launchMastraSceneEmbedding(
        {
          target: {
            videoId: "v-1",
            videoEditionId: "e-1",
            coreId: "core-1",
          },
          locale: "en",
          assetId: 42,
          sceneAnalysis: sceneAnalysis(),
          mode: "repair",
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
      new URL("https://mastra.internal/forge-scene-embeddings"),
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer secret",
        }),
      }),
    )
    expect(body).toMatchObject({
      target: {
        admin: {
          videoId: "v-1",
          videoEditionId: "e-1",
          coreId: "core-1",
        },
      },
      locale: "en",
      sceneAnalysis: {
        artifactKey: "42/scene-analysis.json",
        artifactVersion: "manager-scene-analysis-v1",
        provider: "manager",
        scenes: [
          expect.objectContaining({
            sceneIndex: 0,
            description: "Themes: hope.\nContent: An opening scene.",
          }),
          expect.objectContaining({
            sceneIndex: 1,
            description: "Themes: courage.\nContent: A closing scene.",
          }),
        ],
      },
      mode: "repair",
    })
    expect(JSON.stringify(body)).not.toContain("embedding")
  })

  it("returns Mastra product failures and upstream auth failures safely", async () => {
    const productFailure = {
      ok: false,
      reason: "admin_ingest_rejected",
      retryable: false,
      mastraRunId: "run-2",
      adminStatus: "rejected",
      adminReason: "existing_scene_differs",
    }
    const rejected = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ result: productFailure }, { status: 409 }),
    )

    await expect(
      launchMastraSceneEmbedding(
        {
          target: { videoId: "v-1", videoEditionId: "e-1" },
          locale: "en",
          assetId: 42,
          sceneAnalysis: sceneAnalysis(),
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
      launchMastraSceneEmbedding(
        {
          target: { videoId: "v-1", videoEditionId: "e-1" },
          locale: "en",
          assetId: 42,
          sceneAnalysis: sceneAnalysis(),
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
      launchMastraSceneEmbedding(
        {
          target: { videoId: "v-1", videoEditionId: "e-1" },
          locale: "en",
          assetId: 42,
          sceneAnalysis: sceneAnalysis(),
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
  })
})
