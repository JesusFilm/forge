import { describe, expect, it, vi } from "vitest"

import {
  EmbeddingProviderError,
  EXPECTED_SCENE_EMBEDDING_DIMENSIONS,
  type EmbeddingProviderResult,
} from "../../services/embedding-provider"
import {
  handleSceneEmbeddingRouteRequest,
  planSceneEmbeddingRun,
  runSceneEmbeddingWorkflow,
  sceneEmbeddingWorkflow,
  type SceneEmbeddingWorkflowInput,
  _internals,
} from "./scene-embedding"

const vector = (seed: number) =>
  Array.from(
    { length: EXPECTED_SCENE_EMBEDDING_DIMENSIONS },
    (_, index) => seed + index / 1000,
  )

function input(
  overrides: Partial<SceneEmbeddingWorkflowInput> = {},
): SceneEmbeddingWorkflowInput {
  const base: SceneEmbeddingWorkflowInput = {
    target: {
      admin: {
        videoId: "video-1",
        videoEditionId: "edition-1",
        coreId: "core-1",
      },
    },
    locale: "en",
    sceneAnalysis: {
      artifactKey: "42/scene-analysis.json",
      artifactVersion: "manager-scene-analysis-v1",
      provider: "manager",
      generatedAt: "2026-05-25T00:00:00.000Z",
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
          endSeconds: 60,
          chapterTitle: "Middle",
          description: "Themes: courage.\nContent: A middle scene.",
          themes: ["courage"],
          bibleVerses: [],
          demographics: [],
          spiritualContext: [],
        },
      ],
    },
    model: {
      name: "embeddings",
      provider: "jesus-film-ai-gateway",
    },
    mode: "idempotent",
  }

  return { ...base, ...overrides } as SceneEmbeddingWorkflowInput
}

function embeddingResult(inputs: string[]): EmbeddingProviderResult {
  return {
    embeddings: inputs.map((_, index) => vector(index + 1)),
    dimensions: EXPECTED_SCENE_EMBEDDING_DIMENSIONS,
    tokenCount: inputs.length * 6,
    model: "embeddings",
    provider: "jesus-film-ai-gateway",
    requestModel: "embeddings",
    nativeDimensions: 4096,
    transformVersion: "matryoshka-truncate-1536-v1",
  }
}

function adminSuccessResult(payload: {
  locale: string
  scenes: unknown[]
  model: { name: string; dimensions: number }
  generation: { mastraRunId: string }
}) {
  return {
    ok: true as const,
    result: {
      status: "created" as const,
      target: {
        videoId: "video-1",
        videoEditionId: "edition-1",
        coreId: "core-1",
        locale: payload.locale,
      },
      scenes: payload.scenes.length,
      model: payload.model.name,
      dimensions: payload.model.dimensions,
      mastraRunId: payload.generation.mastraRunId,
    },
  }
}

describe("scene embedding workflow", () => {
  it("plans scene sources and submits aligned vectors to Admin ingest", async () => {
    const embeddingRequester = vi.fn(async (items: string[]) =>
      embeddingResult(items),
    )
    const adminIngestClient = vi.fn(async (payload) =>
      adminSuccessResult(payload),
    )

    const result = await runSceneEmbeddingWorkflow(input(), {
      runId: "run-scenes",
      generatedAt: "2026-05-25T01:00:00.000Z",
      embeddingRequester,
      adminIngestClient,
    })

    expect(result).toMatchObject({
      ok: true,
      status: "created",
      scenes: 2,
      providerTokens: 12,
      mastraRunId: "run-scenes",
      nativeDimensions: 4096,
      transformVersion: "matryoshka-truncate-1536-v1",
    })
    expect(embeddingRequester).toHaveBeenCalledWith(
      [
        "Themes: hope.\nContent: An opening scene.",
        "Themes: courage.\nContent: A middle scene.",
      ],
      expect.objectContaining({
        expectedDimensions: EXPECTED_SCENE_EMBEDDING_DIMENSIONS,
      }),
    )
    expect(adminIngestClient).toHaveBeenCalledWith(
      expect.objectContaining({
        target: {
          admin: {
            videoId: "video-1",
            videoEditionId: "edition-1",
            coreId: "core-1",
          },
        },
        locale: "en",
        source: expect.objectContaining({
          artifactKey: "42/scene-analysis.json",
          artifactVersion: "manager-scene-analysis-v1",
          provider: "manager",
          contentHash: expect.stringMatching(/^sha256:/),
        }),
        model: {
          name: "embeddings",
          provider: "jesus-film-ai-gateway",
          dimensions: EXPECTED_SCENE_EMBEDDING_DIMENSIONS,
          nativeDimensions: 4096,
          transformVersion: "matryoshka-truncate-1536-v1",
        },
        generation: {
          mode: "idempotent",
          generatedAt: "2026-05-25T01:00:00.000Z",
          mastraRunId: "run-scenes",
        },
        scenes: [
          expect.objectContaining({
            sceneIndex: 0,
            sourceText: "Themes: hope.\nContent: An opening scene.",
            embedding: vector(1),
          }),
          expect.objectContaining({
            sceneIndex: 1,
            sourceText: "Themes: courage.\nContent: A middle scene.",
            embedding: vector(2),
          }),
        ],
      }),
    )
  })

  it("rejects incomplete source provenance and non-contiguous scene indexes before provider calls", async () => {
    const embeddingRequester = vi.fn(async (items: string[]) =>
      embeddingResult(items),
    )
    const missingArtifactKey = input() as unknown as Record<string, unknown>
    delete (missingArtifactKey.sceneAnalysis as Record<string, unknown>)
      .artifactKey

    await expect(
      runSceneEmbeddingWorkflow(missingArtifactKey, {
        runId: "run-missing-source",
        embeddingRequester,
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "invalid_input",
      retryable: false,
      mastraRunId: "run-missing-source",
    })

    await expect(
      runSceneEmbeddingWorkflow(
        input({
          sceneAnalysis: {
            ...input().sceneAnalysis,
            scenes: [
              {
                ...input().sceneAnalysis.scenes[0]!,
                sceneIndex: 1,
              },
            ],
          },
        }),
        { runId: "run-gap", embeddingRequester },
      ),
    ).resolves.toEqual({
      ok: false,
      reason: "invalid_input",
      retryable: false,
      mastraRunId: "run-gap",
    })

    expect(embeddingRequester).not.toHaveBeenCalled()
  })

  it("returns safe failures for empty sources, provider failures, and Admin rejects", async () => {
    await expect(
      runSceneEmbeddingWorkflow(
        input({
          sceneAnalysis: {
            ...input().sceneAnalysis,
            scenes: [
              {
                ...input().sceneAnalysis.scenes[0]!,
                description: "   ",
              },
            ],
          },
        }),
        { runId: "run-empty" },
      ),
    ).resolves.toEqual({
      ok: false,
      reason: "invalid_input",
      retryable: false,
      mastraRunId: "run-empty",
    })

    await expect(
      runSceneEmbeddingWorkflow(input(), {
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
      runSceneEmbeddingWorkflow(input(), {
        runId: "run-admin",
        embeddingRequester: async (items) => embeddingResult(items),
        adminIngestClient: async () => ({
          ok: false,
          reason: "rejected",
          retryable: false,
          status: 409,
          result: {
            status: "rejected",
            reason: "existing_scene_differs",
            target: {
              videoId: "video-1",
              videoEditionId: "edition-1",
              coreId: "core-1",
              locale: "en",
            },
            scenes: 2,
            model: "embeddings",
            dimensions: EXPECTED_SCENE_EMBEDDING_DIMENSIONS,
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
      adminReason: "existing_scene_differs",
    })
  })

  it("retries only retryable provider and Admin failures", async () => {
    let providerAttempts = 0
    const retryableProvider = vi.fn(async (items: string[]) => {
      providerAttempts += 1
      if (providerAttempts === 1) {
        throw new EmbeddingProviderError(
          "upstream_failed",
          "temporary provider failure",
          true,
        )
      }
      return embeddingResult(items)
    })
    const adminIngestClient = vi.fn(async (payload) =>
      adminSuccessResult(payload),
    )

    await expect(
      runSceneEmbeddingWorkflow(input(), {
        runId: "run-provider-retry",
        embeddingRequester: retryableProvider,
        adminIngestClient,
      }),
    ).resolves.toMatchObject({
      ok: true,
      mastraRunId: "run-provider-retry",
    })
    expect(retryableProvider).toHaveBeenCalledTimes(2)

    const nonRetryableProvider = vi.fn(async () => {
      throw new EmbeddingProviderError(
        "auth_failed",
        "provider rejected credentials",
      )
    })
    await expect(
      runSceneEmbeddingWorkflow(input(), {
        runId: "run-provider-auth",
        embeddingRequester: nonRetryableProvider,
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "provider_auth_failed",
      retryable: false,
      mastraRunId: "run-provider-auth",
    })
    expect(nonRetryableProvider).toHaveBeenCalledTimes(1)

    let adminAttempts = 0
    const retryableAdmin = vi.fn(async (payload) => {
      adminAttempts += 1
      if (adminAttempts === 1) {
        return {
          ok: false as const,
          reason: "network_error" as const,
          retryable: true,
          status: 503,
        }
      }
      return adminSuccessResult(payload)
    })

    await expect(
      runSceneEmbeddingWorkflow(input(), {
        runId: "run-admin-retry",
        embeddingRequester: async (items) => embeddingResult(items),
        adminIngestClient: retryableAdmin,
      }),
    ).resolves.toMatchObject({
      ok: true,
      mastraRunId: "run-admin-retry",
    })
    expect(retryableAdmin).toHaveBeenCalledTimes(2)

    const nonRetryableAdmin = vi.fn(async () => ({
      ok: false as const,
      reason: "rejected" as const,
      retryable: false,
      status: 409,
      result: {
        status: "rejected" as const,
        reason: "existing_scene_differs",
        target: {
          videoId: "video-1",
          videoEditionId: "edition-1",
          coreId: "core-1",
          locale: "en",
        },
        scenes: 2,
        model: "embeddings",
        dimensions: EXPECTED_SCENE_EMBEDDING_DIMENSIONS,
        mastraRunId: "run-admin-reject",
      },
    }))

    await expect(
      runSceneEmbeddingWorkflow(input(), {
        runId: "run-admin-reject",
        embeddingRequester: async (items) => embeddingResult(items),
        adminIngestClient: nonRetryableAdmin,
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "admin_ingest_rejected",
      retryable: false,
    })
    expect(nonRetryableAdmin).toHaveBeenCalledTimes(1)
  })

  it("keeps the route authenticated and response payload scrubbed", async () => {
    const unauthorized = await handleSceneEmbeddingRouteRequest({
      authHeader: "Bearer wrong",
      serviceKeys: ["secret"],
      readJson: async () => input(),
    })

    expect(unauthorized).toEqual({
      status: 401,
      body: { error: "Service bearer required" },
    })

    const authorized = await handleSceneEmbeddingRouteRequest({
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
          locale: "en",
        },
        scenes: 2,
        providerTokens: 12,
        model: "embeddings",
        provider: "jesus-film-ai-gateway",
        dimensions: EXPECTED_SCENE_EMBEDDING_DIMENSIONS,
        nativeDimensions: 4096,
        transformVersion: "matryoshka-truncate-1536-v1",
        mastraRunId: runId,
        sourceContentHash: "sha256:test",
      }),
    })

    expect(authorized.status).toBe(200)
    expect(JSON.stringify(authorized.body)).not.toContain('"embedding"')
    expect(JSON.stringify(authorized.body)).not.toContain("opening scene")
  })

  it("keeps committed step summaries free of scene text and vectors", () => {
    const planned = planSceneEmbeddingRun(input(), {
      mastraRunId: "run-safe-summary",
    })
    const summary = _internals.summarizePlannedRun(planned)
    const serialized = JSON.stringify(summary)

    expect(serialized).not.toContain("opening scene")
    expect(serialized).not.toContain('"embedding"')
    expect(summary).toMatchObject({
      source: {
        sceneCount: 2,
        sceneIndexes: [0, 1],
        sourceTextLength: 81,
        contentHash: expect.stringMatching(/^sha256:/),
      },
    })
  })

  it("preserves precise failures through the committed route launcher", async () => {
    const invalid = await handleSceneEmbeddingRouteRequest({
      authHeader: "Bearer secret",
      serviceKeys: ["secret"],
      readJson: async () =>
        input({
          sceneAnalysis: {
            ...input().sceneAnalysis,
            scenes: [
              {
                ...input().sceneAnalysis.scenes[0]!,
                description: "   ",
              },
            ],
          },
        }),
    })

    expect(invalid.status).toBe(400)
    expect(invalid.body.result).toMatchObject({
      ok: false,
      reason: "invalid_input",
      retryable: false,
    })

    const providerConfig = await handleSceneEmbeddingRouteRequest({
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
  })

  it("marks committed Mastra runs as failed when the workflow result is a typed failure", async () => {
    const run = await sceneEmbeddingWorkflow.createRun({
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
    expect(sceneEmbeddingWorkflow.id).toBe("scene-embedding")
    expect(sceneEmbeddingWorkflow.committed).toBe(true)
  })
})
