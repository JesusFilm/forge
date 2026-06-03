import { describe, expect, it, vi } from "vitest"
import type { Principal } from "@/auth/principal"
import {
  EXPECTED_SCENE_EMBEDDING_DIMENSIONS,
  SceneIndexError,
  writeSceneEmbeddingPayload,
  type SceneEmbeddingPayloadInput,
} from "./scene-embedding.service"

const SYSTEM = { id: null, role: "SYSTEM" } as const satisfies Principal
const VIEWER = { id: "viewer-1", role: "VIEWER" } as const satisfies Principal

type StubPrismaTx = {
  videoSceneLocale: { deleteMany: ReturnType<typeof vi.fn> }
  $executeRaw: ReturnType<typeof vi.fn>
  $queryRaw: ReturnType<typeof vi.fn>
}

function vector() {
  return Array.from(
    { length: EXPECTED_SCENE_EMBEDDING_DIMENSIONS },
    (_value, index) => index / 1000,
  )
}

function input(
  overrides: Partial<SceneEmbeddingPayloadInput> = {},
): SceneEmbeddingPayloadInput {
  return {
    editionId: "edition-1",
    videoId: "video-1",
    coreId: "core-1",
    locale: "en",
    user: SYSTEM,
    model: "embeddings",
    dimensions: EXPECTED_SCENE_EMBEDDING_DIMENSIONS,
    scenes: [
      {
        sceneIndex: 0,
        startSeconds: 0,
        endSeconds: 3,
        chapterTitle: "Opening",
        sourceText: "Jesus teaches beside the sea.",
        description: "Jesus teaches beside the sea.",
        themes: ["teaching"],
        bibleVerses: ["Mark 4"],
        demographics: ["families"],
        spiritualContext: ["kingdom"],
        embedding: vector(),
      },
    ],
    provenance: {
      embeddingProvider: "jesus-film-ai-gateway",
      embeddingNativeDimensions: 4096,
      embeddingTransformVersion: "matryoshka-truncate-1536-v1",
      sourceArtifactKey: "42/scene-analysis.json",
      sourceArtifactVersion: "manager-scene-analysis-v1",
      sourceContentHash: "sha256:scene",
      sourceProvider: "manager",
      generationMode: "force",
      mastraRunId: "run-1",
      generatedAt: "2026-05-26T00:00:00.000Z",
    },
    ...overrides,
  }
}

function buildStubPrisma() {
  const deleteMany = vi.fn(async () => ({ count: 0 }))
  const executeRaw = vi.fn(async () => 1)
  const queryRaw = vi.fn(async () => [{ id: "scene-1", scene_index: 0 }])
  const tx: StubPrismaTx = {
    videoSceneLocale: { deleteMany },
    $executeRaw: executeRaw,
    $queryRaw: queryRaw,
  }
  const prisma = {
    $transaction: vi.fn(
      async (
        fn: (innerTx: StubPrismaTx) => Promise<void>,
        _opts?: { timeout?: number },
      ) => fn(tx),
    ),
    ...tx,
  }

  return {
    prisma: prisma as unknown as import("@prisma/client").PrismaClient,
    deleteMany,
    executeRaw,
    queryRaw,
  }
}

describe("writeSceneEmbeddingPayload", () => {
  it("rejects non-derived writers", async () => {
    const { prisma } = buildStubPrisma()

    await expect(
      writeSceneEmbeddingPayload(prisma, input({ user: VIEWER })),
    ).rejects.toMatchObject({
      name: "SceneIndexError",
      code: "forbidden",
    })
  })

  it("rejects dimension drift before opening a transaction", async () => {
    const { prisma } = buildStubPrisma()

    await expect(
      writeSceneEmbeddingPayload(
        prisma,
        input({
          dimensions: EXPECTED_SCENE_EMBEDDING_DIMENSIONS + 1,
        }),
      ),
    ).rejects.toMatchObject({
      code: "dimension_mismatch",
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("writes scene parents, locale rows, vectors, and provenance in bulk", async () => {
    const { prisma, deleteMany, executeRaw } = buildStubPrisma()

    await expect(writeSceneEmbeddingPayload(prisma, input())).resolves.toEqual({
      editionId: "edition-1",
      locale: "en",
      scenesIndexed: 1,
      embeddingsWritten: 1,
      scenesPruned: 0,
      model: "embeddings",
      dimensions: EXPECTED_SCENE_EMBEDDING_DIMENSIONS,
    })

    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        locale: "en",
        videoScene: {
          videoEditionId: "edition-1",
          sceneIndex: { notIn: [0] },
        },
      },
    })
    const sql = executeRaw.mock.calls
      .map((call) => String((call as unknown[])[0]))
      .join("\n")
    expect(sql).toContain("INSERT INTO video_scene")
    expect(sql).toContain("INSERT INTO video_scene_locale")
    expect(sql).toContain("embedding_provider")
    expect(sql).toContain("embedding_native_dimensions")
    expect(sql).toContain("embedding_transform_version")
    expect(sql).toContain("source_artifact_key")
    expect(sql).toContain("mastra_run_id")
    expect(sql).toContain("u.embedding_text::vector(1536)")
    expect(sql).toContain("ON CONFLICT (video_scene_id, locale)")
  })

  it("rejects duplicate scene indexes and empty scene text", async () => {
    const { prisma } = buildStubPrisma()
    const base = input()

    await expect(
      writeSceneEmbeddingPayload(
        prisma,
        input({ scenes: [base.scenes[0]!, { ...base.scenes[0]! }] }),
      ),
    ).rejects.toBeInstanceOf(SceneIndexError)

    await expect(
      writeSceneEmbeddingPayload(
        prisma,
        input({
          scenes: [{ ...base.scenes[0]!, sourceText: "", description: "" }],
        }),
      ),
    ).rejects.toMatchObject({ code: "empty_description" })
  })
})
