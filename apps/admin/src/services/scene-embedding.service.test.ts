// Unit tests for indexEditionScenes.
//
// DB interactions are tested against a stub Prisma client that mirrors
// the call surface we use — $transaction + upsert + $executeRaw. True
// end-to-end verification against a live Postgres with pgvector is
// covered by Unit 7's smoke test.

import { describe, expect, it, vi, beforeEach } from "vitest"
import type { Principal } from "@/auth/principal"
import type { SceneAnalysisResult } from "@/services/manager-artifacts.service"

// Mock the BATCHED form (Stage 2): one provider call per
// (video, locale) target. The mock returns deterministic vectors so
// position-stable ordering is observable in tests.
//
// importOriginal forwards every export from the real module — including
// the real `EmbeddingsBatchError` class. Locally re-defining the class
// would create a structural duplicate with a different identity, so any
// future production code that branches on `instanceof EmbeddingsBatchError`
// would silently bypass the branch under this mock. Keep the real class.
vi.mock("@/services/embeddings.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/embeddings.service")>()
  return {
    ...actual,
    generateExperienceEmbeddings: vi.fn(async (inputs: readonly string[]) => ({
      model: "openai/text-embedding-3-small",
      dimensions: 1536,
      embeddings: inputs.map((_, idx) =>
        Array.from({ length: 1536 }, (__, i) => (idx + 1) * 0.1 + i * 0.0001),
      ),
    })),
  }
})

const { generateExperienceEmbeddings } =
  await import("@/services/embeddings.service")
const { indexEditionScenes } = await import("./scene-embedding.service")

const SYSTEM = { id: null, role: "SYSTEM" } as const satisfies Principal
const ADMIN = { id: "admin-1", role: "ADMIN" } as const satisfies Principal
const VIEWER = { id: "viewer-1", role: "VIEWER" } as const satisfies Principal

type UpsertCall = { where: unknown; create: unknown; update: unknown }

type StubPrismaRecord = {
  videoScene: { upsert: ReturnType<typeof vi.fn> }
  videoSceneLocale: {
    upsert: ReturnType<typeof vi.fn>
    deleteMany: ReturnType<typeof vi.fn>
  }
  $executeRaw: ReturnType<typeof vi.fn>
}

function buildStubPrisma(opts?: { prunedCount?: number }) {
  const videoSceneUpsert = vi.fn(async (args: UpsertCall) => ({
    id: `scene-${JSON.stringify(args.where)}`,
  }))
  const videoSceneLocaleUpsert = vi.fn(async (args: UpsertCall) => ({
    id: `locale-${JSON.stringify(args.where)}`,
  }))
  const videoSceneLocaleDeleteMany = vi.fn(async () => ({
    count: opts?.prunedCount ?? 0,
  }))
  const executeRaw = vi.fn(async () => 1)

  const tx: StubPrismaRecord = {
    videoScene: { upsert: videoSceneUpsert },
    videoSceneLocale: {
      upsert: videoSceneLocaleUpsert,
      deleteMany: videoSceneLocaleDeleteMany,
    },
    $executeRaw: executeRaw,
  }

  const prisma = {
    $transaction: vi.fn(
      async (
        fn: (tx: StubPrismaRecord) => Promise<void>,
        _opts?: { timeout?: number },
      ) => {
        return fn(tx)
      },
    ),
    ...tx,
  }

  return {
    prisma: prisma as unknown as import("@prisma/client").PrismaClient,
    tx,
    videoSceneUpsert,
    videoSceneLocaleUpsert,
    videoSceneLocaleDeleteMany,
    executeRaw,
  }
}

const ARTIFACT: SceneAnalysisResult = {
  scenes: [
    {
      sceneIndex: 0,
      startSeconds: 0,
      endSeconds: 10,
      chapterTitle: "Intro",
      description: "Opening shot on a desert road.",
      themes: ["journey"],
      bibleVerses: [],
      demographics: ["adult"],
      spiritualContext: [],
    },
    {
      sceneIndex: 1,
      startSeconds: 10,
      endSeconds: null,
      chapterTitle: null,
      description: "A man kneels to pray at sunset.",
      themes: ["prayer", "solitude"],
      bibleVerses: ["Matthew 6:6"],
      demographics: [],
      spiritualContext: ["devotion"],
    },
  ],
}

describe("indexEditionScenes", () => {
  beforeEach(() => {
    vi.mocked(generateExperienceEmbeddings).mockClear()
  })

  it("rejects principals that cannot write derived columns", async () => {
    const { prisma } = buildStubPrisma()
    await expect(
      indexEditionScenes(prisma, {
        editionId: "edition-1",
        videoId: "video-1",
        coreId: "core-1",
        locale: "en",
        user: VIEWER,
        loadedArtifact: ARTIFACT,
      }),
    ).rejects.toMatchObject({
      name: "SceneIndexError",
      code: "forbidden",
    })
  })

  it("throws missing_cms_video_id when no artifact or id is provided", async () => {
    const { prisma } = buildStubPrisma()
    await expect(
      indexEditionScenes(prisma, {
        editionId: "edition-1",
        videoId: "video-1",
        coreId: "core-1",
        locale: "en",
        user: SYSTEM,
      }),
    ).rejects.toMatchObject({ code: "missing_cms_video_id" })
  })

  it("returns zero counts for an empty artifact without touching the DB", async () => {
    const { prisma, videoSceneUpsert, executeRaw } = buildStubPrisma()
    const result = await indexEditionScenes(prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      locale: "en",
      user: SYSTEM,
      loadedArtifact: { scenes: [] },
    })
    expect(result.scenesIndexed).toBe(0)
    expect(result.embeddingsWritten).toBe(0)
    expect(videoSceneUpsert).not.toHaveBeenCalled()
    expect(executeRaw).not.toHaveBeenCalled()
    // Empty artifact short-circuits BEFORE the provider call too —
    // no point paying for an empty batch.
    expect(generateExperienceEmbeddings).not.toHaveBeenCalled()
  })

  it("throws duplicate_scene_index when an artifact repeats sceneIndex", async () => {
    const { prisma } = buildStubPrisma()
    await expect(
      indexEditionScenes(prisma, {
        editionId: "edition-1",
        videoId: "video-1",
        coreId: "core-1",
        locale: "en",
        user: SYSTEM,
        loadedArtifact: {
          scenes: [
            { ...ARTIFACT.scenes[0]!, sceneIndex: 0 },
            { ...ARTIFACT.scenes[1]!, sceneIndex: 0 },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "duplicate_scene_index" })
  })

  it("throws empty_description when a scene has no text", async () => {
    const { prisma } = buildStubPrisma()
    await expect(
      indexEditionScenes(prisma, {
        editionId: "edition-1",
        videoId: "video-1",
        coreId: "core-1",
        locale: "en",
        user: SYSTEM,
        loadedArtifact: {
          scenes: [{ ...ARTIFACT.scenes[0]!, description: "   " }],
        },
      }),
    ).rejects.toMatchObject({ code: "empty_description" })
  })

  it("issues exactly ONE batched provider call per target with scene descriptions in order", async () => {
    // Stage 2 contract: one provider call per (video, locale) instead
    // of one per scene. Body.input must be the descriptions in scene-
    // index order so the response's `embeddings[i]` corresponds to
    // `scenes[i]`.
    const { prisma } = buildStubPrisma()
    await indexEditionScenes(prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      locale: "en",
      user: ADMIN,
      loadedArtifact: ARTIFACT,
    })

    expect(generateExperienceEmbeddings).toHaveBeenCalledTimes(1)
    expect(generateExperienceEmbeddings).toHaveBeenCalledWith([
      "Opening shot on a desert road.",
      "A man kneels to pray at sunset.",
    ])
  })

  it("embeds + upserts each scene inside a transaction for ADMIN with position-stable vectors", async () => {
    const {
      prisma,
      videoSceneUpsert,
      videoSceneLocaleUpsert,
      videoSceneLocaleDeleteMany,
      executeRaw,
    } = buildStubPrisma()

    const result = await indexEditionScenes(prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      locale: "en",
      user: ADMIN,
      loadedArtifact: ARTIFACT,
    })

    expect(result.scenesIndexed).toBe(2)
    expect(result.embeddingsWritten).toBe(2)
    expect(result.scenesSkipped).toBe(0)
    expect(result.scenesPruned).toBe(0)
    expect(result.locale).toBe("en")
    // ONE batched call (down from per-scene N).
    expect(generateExperienceEmbeddings).toHaveBeenCalledTimes(1)
    expect(videoSceneLocaleDeleteMany).toHaveBeenCalledTimes(1)
    expect(videoSceneUpsert).toHaveBeenCalledTimes(2)
    expect(videoSceneLocaleUpsert).toHaveBeenCalledTimes(2)
    expect(executeRaw).toHaveBeenCalledTimes(2)

    // Ensure the update preserves the description text per locale.
    expect(videoSceneLocaleUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          locale: "en",
          description: "Opening shot on a desert road.",
          sourceText: "Opening shot on a desert road.",
          themes: ["journey"],
        }),
      }),
    )
  })

  it("writes vectors position-stably: scene[i] gets embeddings[i] in the $executeRaw call", async () => {
    // The batched provider returns one vector per input in input order;
    // the indexer must thread `embeddings[i]` into the upsert for
    // `scenes[i]`. A bug that swapped the indices would silently land
    // the wrong vector on the wrong scene with no other test catching
    // it. Mock the batched call to return distinct vectors per input
    // so the mapping is observable.
    const v0 = Array.from({ length: 1536 }, () => 0.111) // for scene 0
    const v1 = Array.from({ length: 1536 }, () => 0.222) // for scene 1
    vi.mocked(generateExperienceEmbeddings).mockResolvedValueOnce({
      model: "openai/text-embedding-3-small",
      dimensions: 1536,
      embeddings: [v0, v1],
    })

    const { prisma, executeRaw, videoSceneUpsert } = buildStubPrisma()
    await indexEditionScenes(prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      locale: "en",
      user: SYSTEM,
      loadedArtifact: ARTIFACT,
    })

    // The upsert's where-clause encodes the sceneIndex; we use that
    // ordering to confirm the executeRaw vector matches the right scene.
    const sceneIndexInOrder = videoSceneUpsert.mock.calls.map((c) => {
      const where = (
        c[0] as { where: { videoEditionId_sceneIndex: { sceneIndex: number } } }
      ).where
      return where.videoEditionId_sceneIndex.sceneIndex
    })
    expect(sceneIndexInOrder).toEqual([0, 1])

    // The first $executeRaw bound the v0 literal (for scene 0); the
    // second bound the v1 literal (for scene 1). Find the bound vector
    // literal by SHAPE (`[n,n,n,...]`) rather than by parameter index
    // — a future SQL refactor that adds a leading parameter (e.g. an
    // explicit updated_at literal) would silently shift the vector to
    // a different position; matching by shape stays correct.
    const calls = executeRaw.mock.calls as unknown as [unknown, ...unknown[]][]
    const VECTOR_LITERAL = /^\[[0-9.,-]+\]$/
    const findVectorLiteral = (call: unknown[]): string => {
      // Skip index 0 (TemplateStringsArray); scan bound values.
      for (let i = 1; i < call.length; i += 1) {
        const v = call[i]
        if (typeof v === "string" && VECTOR_LITERAL.test(v)) return v
      }
      throw new Error(
        `no vector literal in $executeRaw call: ${JSON.stringify(call.slice(1))}`,
      )
    }
    const firstVectorLiteral = findVectorLiteral(calls[0]!)
    const secondVectorLiteral = findVectorLiteral(calls[1]!)
    expect(firstVectorLiteral).toContain("0.111")
    expect(firstVectorLiteral).not.toContain("0.222")
    expect(secondVectorLiteral).toContain("0.222")
    expect(secondVectorLiteral).not.toContain("0.111")
  })

  it("rejects a null (unauthenticated) principal with forbidden", async () => {
    const { prisma } = buildStubPrisma()
    await expect(
      indexEditionScenes(prisma, {
        editionId: "edition-1",
        videoId: "video-1",
        coreId: "core-1",
        locale: "en",
        user: null,
        loadedArtifact: ARTIFACT,
      }),
    ).rejects.toMatchObject({ code: "forbidden" })
  })

  it("reports scenesPruned when the transaction deletes stale locale rows", async () => {
    const { prisma } = buildStubPrisma({ prunedCount: 3 })

    const result = await indexEditionScenes(prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      locale: "en",
      user: SYSTEM,
      loadedArtifact: ARTIFACT,
    })

    expect(result.scenesPruned).toBe(3)
  })

  it("propagates a batched-provider failure as a thrown error (fail-fast for the whole target)", async () => {
    // Stage 2 trade-off: the provider's per-scene fan-out is replaced
    // with one batched call. A length-mismatch / dimension-mismatch /
    // request-failed surface as `EmbeddingsBatchError` and must abort
    // the whole `(video, locale)` target rather than partial-write.
    // The workflow's per-target catch demotes this to a `failed`
    // outcome (covered in workflow tests).
    const { prisma, executeRaw, videoSceneUpsert } = buildStubPrisma()
    vi.mocked(generateExperienceEmbeddings).mockRejectedValueOnce(
      new Error("provider 503"),
    )

    await expect(
      indexEditionScenes(prisma, {
        editionId: "edition-1",
        videoId: "video-1",
        coreId: "core-1",
        locale: "en",
        user: SYSTEM,
        loadedArtifact: ARTIFACT,
      }),
    ).rejects.toThrow("provider 503")

    // No partial DB writes — the transaction never opened.
    expect(videoSceneUpsert).not.toHaveBeenCalled()
    expect(executeRaw).not.toHaveBeenCalled()
  })

  it("writes embeddings via $executeRaw tagged template with ::vector cast", async () => {
    const { prisma, executeRaw } = buildStubPrisma()
    await indexEditionScenes(prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      locale: "en",
      user: SYSTEM,
      loadedArtifact: { scenes: [ARTIFACT.scenes[0]!] },
    })
    expect(executeRaw).toHaveBeenCalledTimes(1)
    // With the tagged-template call form, the first arg is a
    // TemplateStringsArray (array-like of literal fragments) and the
    // rest are the bound values.
    const [strings, ...values] = executeRaw.mock.calls[0] as unknown as [
      readonly string[],
      ...unknown[],
    ]
    const rawSql = strings.join("?")
    expect(rawSql).toContain("UPDATE video_scene_locale")
    expect(rawSql).toContain("::vector")
    // Vector literal flows through as a parameter, not a string splice.
    expect(typeof values[0]).toBe("string")
    expect(values[0] as string).toMatch(/^\[[0-9.,-]+\]$/)
  })

  it("skips the S3 read when loadedArtifact is supplied (Stage 2 per-(video, edition) cache)", async () => {
    // Stage 2 hands a pre-loaded artifact down from the workflow's
    // group-level fetch. The service must NOT re-read S3 when that's
    // the case. Spy on `readSceneAnalysisArtifact` to lock the
    // invariant — a regression that "helpfully" re-fetches would re-
    // introduce the per-locale S3 read storm Stage 2 was designed to
    // eliminate.
    const managerArtifactsModule =
      await import("@/services/manager-artifacts.service")
    const s3ReadSpy = vi.spyOn(
      managerArtifactsModule,
      "readSceneAnalysisArtifact",
    )

    const { prisma } = buildStubPrisma()
    await indexEditionScenes(prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      locale: "en",
      user: SYSTEM,
      loadedArtifact: ARTIFACT,
    })

    expect(s3ReadSpy).not.toHaveBeenCalled()
  })
})
