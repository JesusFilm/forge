// Unit tests for indexEditionScenes.
//
// DB interactions are tested against a stub Prisma client that mirrors
// the call surface we use — $transaction + upsert + $executeRaw. True
// end-to-end verification against a live Postgres with pgvector is
// covered by Unit 7's smoke test.

import { describe, expect, it, vi, beforeEach } from "vitest"
import type { Principal } from "@/auth/principal"
import type { SceneAnalysisResult } from "@/services/manager-artifacts.service"

vi.mock("@/services/embeddings.service", () => ({
  generateExperienceEmbedding: vi.fn(async (text: string) => ({
    model: "openai/text-embedding-3-small",
    dimensions: 1536,
    embedding: Array.from({ length: 1536 }, (_, i) => (i % 10) * 0.001),
    _text: text,
  })),
}))

const { generateExperienceEmbedding } =
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
    vi.mocked(generateExperienceEmbedding).mockClear()
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
        artifactOverride: ARTIFACT,
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
      artifactOverride: { scenes: [] },
    })
    expect(result.scenesIndexed).toBe(0)
    expect(result.embeddingsWritten).toBe(0)
    expect(videoSceneUpsert).not.toHaveBeenCalled()
    expect(executeRaw).not.toHaveBeenCalled()
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
        artifactOverride: {
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
        artifactOverride: {
          scenes: [{ ...ARTIFACT.scenes[0]!, description: "   " }],
        },
      }),
    ).rejects.toMatchObject({ code: "empty_description" })
  })

  it("embeds + upserts each scene inside a transaction for ADMIN", async () => {
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
      artifactOverride: ARTIFACT,
    })

    expect(result.scenesIndexed).toBe(2)
    expect(result.embeddingsWritten).toBe(2)
    expect(result.scenesSkipped).toBe(0)
    expect(result.scenesPruned).toBe(0)
    expect(result.locale).toBe("en")
    expect(generateExperienceEmbedding).toHaveBeenCalledTimes(2)
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

  it("rejects a null (unauthenticated) principal with forbidden", async () => {
    const { prisma } = buildStubPrisma()
    await expect(
      indexEditionScenes(prisma, {
        editionId: "edition-1",
        videoId: "video-1",
        coreId: "core-1",
        locale: "en",
        user: null,
        artifactOverride: ARTIFACT,
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
      artifactOverride: ARTIFACT,
    })

    expect(result.scenesPruned).toBe(3)
  })

  it("skips scenes whose embedding fails but keeps processing the rest", async () => {
    const { prisma, executeRaw } = buildStubPrisma()

    vi.mocked(generateExperienceEmbedding)
      .mockResolvedValueOnce({
        model: "openai/text-embedding-3-small",
        dimensions: 1536,
        embedding: Array.from({ length: 1536 }, () => 0),
      })
      .mockRejectedValueOnce(new Error("provider 503"))

    const result = await indexEditionScenes(prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      locale: "en",
      user: SYSTEM,
      artifactOverride: ARTIFACT,
    })

    expect(result.scenesIndexed).toBe(1)
    expect(result.embeddingsWritten).toBe(1)
    expect(result.scenesSkipped).toBe(1)
    expect(executeRaw).toHaveBeenCalledTimes(1)
  })

  it("writes embeddings via $executeRaw tagged template with ::vector cast", async () => {
    const { prisma, executeRaw } = buildStubPrisma()
    await indexEditionScenes(prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      locale: "en",
      user: SYSTEM,
      artifactOverride: { scenes: [ARTIFACT.scenes[0]!] },
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
})
