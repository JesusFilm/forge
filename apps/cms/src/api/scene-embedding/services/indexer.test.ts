import { describe, expect, it, vi } from "vitest"
import { indexSceneEmbeddings, SceneEmbeddingIndexError } from "./indexer"

function buildScene(videoId?: number) {
  return {
    ...(videoId != null ? { videoId } : {}),
    muxAssetId: "mux-1",
    playbackId: "play-1",
    sceneIndex: 0,
    startSeconds: 0,
    endSeconds: 30,
    description: "Themes: hope.",
    themes: ["hope"],
    bibleVerses: [],
    demographics: [],
    spiritualContext: [],
    chapterTitle: "Intro",
    embedding: Array.from({ length: 1536 }, () => 1),
    model: "text-embedding-3-small",
    language: "en",
  }
}

function createStrapiForDocumentIdTarget() {
  const connectionRaw = vi.fn(async (sql: string, bindings?: unknown[]) => {
    if (sql.includes("FROM videos") && sql.includes("document_id")) {
      expect(bindings).toEqual(["video-doc-1"])
      return {
        rows: [
          { id: 42, document_id: "video-doc-1", published_at: "2026-04-10" },
        ],
      }
    }

    throw new Error(`Unexpected connection raw query: ${sql}`)
  })

  const transactionRaw = vi.fn(async (sql: string, bindings?: unknown[]) => {
    const normalized = sql.replace(/\s+/g, " ").trim()

    if (normalized.startsWith("DELETE FROM scene_embeddings")) {
      expect(bindings).toEqual([42])
      return { rows: [] }
    }

    if (normalized.startsWith("INSERT INTO scene_embeddings")) {
      expect(bindings?.[0]).toBe(42)
      return { rows: [] }
    }

    throw new Error(`Unexpected transaction raw query: ${sql}`)
  })

  const trx = { raw: transactionRaw }
  const transaction = vi.fn(
    async (callback: (trx: typeof trx) => Promise<unknown>) => callback(trx),
  )

  return {
    strapi: {
      db: {
        connection: {
          raw: connectionRaw,
          transaction,
        },
      },
      log: {
        info: vi.fn(),
      },
    },
    transactionRaw,
  }
}

describe("indexSceneEmbeddings", () => {
  it("resolves request-level videoDocumentId to the published numeric video row", async () => {
    const { strapi, transactionRaw } = createStrapiForDocumentIdTarget()

    const result = await indexSceneEmbeddings(
      strapi as Parameters<typeof indexSceneEmbeddings>[0],
      {
        videoDocumentId: "video-doc-1",
        scenes: [buildScene()],
      },
    )

    expect(result).toEqual({
      scenesIndexed: 1,
      resolvedVideoId: 42,
      videoDocumentId: "video-doc-1",
    })
    expect(transactionRaw).toHaveBeenCalledTimes(2)
  })

  it("rejects conflicting row-level videoId when a request target is provided", async () => {
    const { strapi } = createStrapiForDocumentIdTarget()

    await expect(
      indexSceneEmbeddings(
        strapi as Parameters<typeof indexSceneEmbeddings>[0],
        {
          videoDocumentId: "video-doc-1",
          scenes: [buildScene(99)],
        },
      ),
    ).rejects.toMatchObject<SceneEmbeddingIndexError>({
      status: 400,
      code: "conflicting_video_id",
    })
  })

  it("rejects multi-video row payloads without a request-level target", async () => {
    const { strapi } = createStrapiForDocumentIdTarget()

    await expect(
      indexSceneEmbeddings(
        strapi as Parameters<typeof indexSceneEmbeddings>[0],
        {
          scenes: [
            buildScene(41),
            {
              ...buildScene(42),
              sceneIndex: 1,
            },
          ],
        },
      ),
    ).rejects.toMatchObject<SceneEmbeddingIndexError>({
      status: 400,
      code: "multi_video_request",
    })
  })
})
