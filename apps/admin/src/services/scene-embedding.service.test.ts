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

const SYSTEM: Principal = { id: null, role: "SYSTEM" } as Principal
const ADMIN: Principal = { id: "admin-1", role: "ADMIN" } as Principal
const VIEWER: Principal = { id: "viewer-1", role: "VIEWER" } as Principal

type UpsertCall = { where: unknown; create: unknown; update: unknown }

type StubPrismaRecord = {
  videoScene: { upsert: ReturnType<typeof vi.fn> }
  videoSceneLocale: { upsert: ReturnType<typeof vi.fn> }
  $executeRaw: ReturnType<typeof vi.fn>
}

function buildStubPrisma() {
  const videoSceneUpsert = vi.fn(async (args: UpsertCall) => ({
    id: `scene-${JSON.stringify(args.where)}`,
  }))
  const videoSceneLocaleUpsert = vi.fn(async (args: UpsertCall) => ({
    id: `locale-${JSON.stringify(args.where)}`,
  }))
  const executeRaw = vi.fn(async () => 1)

  const tx: StubPrismaRecord = {
    videoScene: { upsert: videoSceneUpsert },
    videoSceneLocale: { upsert: videoSceneLocaleUpsert },
    $executeRaw: executeRaw,
  }

  const prisma = {
    $transaction: vi.fn(async (fn: (tx: StubPrismaRecord) => Promise<void>) => {
      return fn(tx)
    }),
    ...tx,
  }

  return {
    prisma: prisma as unknown as import("@prisma/client").PrismaClient,
    tx,
    videoSceneUpsert,
    videoSceneLocaleUpsert,
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
    const { prisma, videoSceneUpsert, videoSceneLocaleUpsert, executeRaw } =
      buildStubPrisma()

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
    expect(result.locale).toBe("en")
    expect(generateExperienceEmbedding).toHaveBeenCalledTimes(2)
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

  it("passes a Prisma.Sql payload to $executeRaw (verifies ::vector cast is in-place)", async () => {
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
    const firstArg = (executeRaw.mock.calls[0] as unknown as unknown[])[0] as {
      sql?: string
      strings?: readonly string[]
    }
    const rawSql =
      firstArg.sql ?? (firstArg.strings ? firstArg.strings.join("?") : "")
    expect(rawSql).toContain("UPDATE video_scene_locale")
    expect(rawSql).toContain("::vector")
  })
})
