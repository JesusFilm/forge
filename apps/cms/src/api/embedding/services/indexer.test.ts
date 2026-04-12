import { describe, expect, it, vi } from "vitest"
import {
  buildGeneratedContentFingerprint,
  EmbeddingIndexError,
  syncVideoEmbeddings,
} from "./indexer"

function buildChunks() {
  return [
    {
      text: "first chunk",
      embedding: Array.from({ length: 1536 }, () => 1),
    },
    {
      text: "second chunk",
      embedding: Array.from({ length: 1536 }, () => 2),
    },
  ]
}

function createStrapiForIfMissingTest(options: {
  existingRowsAfterLock: Array<{
    chunk_index: number
    chunk_text: string
    model: string | null
  }>
  appliedRowsAfterWrite?: Array<{
    chunk_index: number
    chunk_text: string
    model: string | null
  }>
}) {
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

  const queryLog: string[] = []
  const transactionRaw = vi.fn(async (sql: string, bindings?: unknown[]) => {
    const normalized = sql.replace(/\s+/g, " ").trim()
    queryLog.push(normalized)

    if (
      normalized.includes("FROM videos") &&
      normalized.includes("FOR UPDATE")
    ) {
      expect(bindings).toEqual([42])
      return { rows: [{ id: 42 }] }
    }

    if (
      normalized.includes("FROM transcript_embeddings") &&
      normalized.includes("ORDER BY chunk_index ASC")
    ) {
      expect(bindings).toEqual([42])

      const selectCount = queryLog.filter((entry) =>
        entry.includes("FROM transcript_embeddings"),
      ).length

      if (selectCount === 1) {
        return { rows: options.existingRowsAfterLock }
      }

      return { rows: options.appliedRowsAfterWrite ?? [] }
    }

    if (normalized.startsWith("DELETE FROM transcript_embeddings")) {
      expect(bindings).toEqual([42])
      return { rows: [] }
    }

    if (normalized.startsWith("INSERT INTO transcript_embeddings")) {
      return { rows: [] }
    }

    throw new Error(`Unexpected transaction raw query: ${sql}`)
  })

  const trx = { raw: transactionRaw }
  const transaction = vi.fn(
    async (callback: (trx: typeof trx) => Promise<unknown>) => callback(trx),
  )

  const strapi = {
    db: {
      connection: {
        raw: connectionRaw,
        transaction,
      },
    },
    log: {
      info: vi.fn(),
    },
  }

  return {
    strapi,
    queryLog,
    connectionRaw,
    transaction,
    transactionRaw,
  }
}

function createStrapiForOverrideTest(options: {
  existingRowsAfterLock: Array<{
    chunk_index: number
    chunk_text: string
    model: string | null
  }>
  appliedRowsAfterWrite: Array<{
    chunk_index: number
    chunk_text: string
    model: string | null
  }>
}) {
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

  const queryLog: string[] = []
  const transactionRaw = vi.fn(async (sql: string, bindings?: unknown[]) => {
    const normalized = sql.replace(/\s+/g, " ").trim()
    queryLog.push(normalized)

    if (
      normalized.includes("FROM videos") &&
      normalized.includes("FOR UPDATE")
    ) {
      expect(bindings).toEqual([42])
      return { rows: [{ id: 42 }] }
    }

    if (
      normalized.includes("FROM transcript_embeddings") &&
      normalized.includes("ORDER BY chunk_index ASC")
    ) {
      expect(bindings).toEqual([42])

      const selectCount = queryLog.filter((entry) =>
        entry.includes("FROM transcript_embeddings"),
      ).length

      if (selectCount === 1) {
        return { rows: options.existingRowsAfterLock }
      }

      return { rows: options.appliedRowsAfterWrite }
    }

    if (normalized.startsWith("DELETE FROM transcript_embeddings")) {
      expect(bindings).toEqual([42])
      return { rows: [] }
    }

    if (normalized.startsWith("INSERT INTO transcript_embeddings")) {
      return { rows: [] }
    }

    throw new Error(`Unexpected transaction raw query: ${sql}`)
  })

  const trx = { raw: transactionRaw }
  const transaction = vi.fn(
    async (callback: (trx: typeof trx) => Promise<unknown>) => callback(trx),
  )

  const strapi = {
    db: {
      connection: {
        raw: connectionRaw,
        transaction,
      },
    },
    log: {
      info: vi.fn(),
    },
  }

  return {
    strapi,
    queryLog,
    transaction,
  }
}

describe("syncVideoEmbeddings if_missing", () => {
  it("locks and writes when no rows exist after the lock is acquired", async () => {
    const chunks = buildChunks()
    const appliedRows = [
      {
        chunk_index: 0,
        chunk_text: "first chunk",
        model: "text-embedding-3-small",
      },
      {
        chunk_index: 1,
        chunk_text: "second chunk",
        model: "text-embedding-3-small",
      },
    ]
    const { strapi, queryLog } = createStrapiForIfMissingTest({
      existingRowsAfterLock: [],
      appliedRowsAfterWrite: appliedRows,
    })

    const result = await syncVideoEmbeddings(
      strapi as Parameters<typeof syncVideoEmbeddings>[0],
      {
        videoDocumentId: "video-doc-1",
        mode: "if_missing",
        chunks,
        model: "text-embedding-3-small",
      },
    )

    expect(result).toMatchObject({
      status: "applied_missing",
      resolvedVideoId: 42,
      videoDocumentId: "video-doc-1",
      hasEmbeddings: true,
      chunkCount: 2,
      model: "text-embedding-3-small",
      contentFingerprint: buildGeneratedContentFingerprint(
        "text-embedding-3-small",
        chunks,
      ),
    })
    expect(queryLog).toEqual([
      "SELECT id FROM videos WHERE id = ? FOR UPDATE",
      "SELECT chunk_index, chunk_text, model FROM transcript_embeddings WHERE video_id = ? ORDER BY chunk_index ASC",
      "DELETE FROM transcript_embeddings WHERE video_id = ?",
      "INSERT INTO transcript_embeddings (video_id, chunk_index, chunk_text, embedding, model) VALUES (?, ?, ?, ?::vector, ?), (?, ?, ?, ?::vector, ?)",
      "SELECT chunk_index, chunk_text, model FROM transcript_embeddings WHERE video_id = ? ORDER BY chunk_index ASC",
    ])
  })

  it("skips writing when rows exist once the lock is acquired", async () => {
    const existingRows = [
      {
        chunk_index: 0,
        chunk_text: "already there",
        model: "text-embedding-3-small",
      },
    ]
    const { strapi, queryLog } = createStrapiForIfMissingTest({
      existingRowsAfterLock: existingRows,
    })

    const result = await syncVideoEmbeddings(
      strapi as Parameters<typeof syncVideoEmbeddings>[0],
      {
        videoDocumentId: "video-doc-1",
        mode: "if_missing",
        chunks: buildChunks(),
        model: "text-embedding-3-small",
      },
    )

    expect(result).toMatchObject({
      status: "skipped_existing",
      resolvedVideoId: 42,
      videoDocumentId: "video-doc-1",
      hasEmbeddings: true,
      chunkCount: 1,
      model: "text-embedding-3-small",
      contentFingerprint: buildGeneratedContentFingerprint(
        "text-embedding-3-small",
        [{ text: "already there" }],
      ),
    })
    expect(queryLog).toEqual([
      "SELECT id FROM videos WHERE id = ? FOR UPDATE",
      "SELECT chunk_index, chunk_text, model FROM transcript_embeddings WHERE video_id = ? ORDER BY chunk_index ASC",
    ])
  })
})

describe("syncVideoEmbeddings target resolution", () => {
  it("rejects numeric mode-aware targets when the video is draft-only", async () => {
    const strapi = {
      db: {
        connection: {
          raw: vi.fn(async (sql: string, bindings?: unknown[]) => {
            if (sql.includes("FROM videos") && sql.includes("LIMIT 1")) {
              expect(bindings).toEqual([42])
              return {
                rows: [
                  {
                    id: 42,
                    document_id: "video-doc-1",
                    published_at: null,
                  },
                ],
              }
            }

            throw new Error(`Unexpected query: ${sql}`)
          }),
        },
      },
      log: {
        info: vi.fn(),
      },
    }

    await expect(
      syncVideoEmbeddings(strapi as Parameters<typeof syncVideoEmbeddings>[0], {
        videoId: 42,
        mode: "inspect",
      }),
    ).rejects.toMatchObject<Partial<EmbeddingIndexError>>({
      status: 409,
      code: "unpublished_video",
    })
  })
})

describe("syncVideoEmbeddings override", () => {
  it("locks, rechecks, and writes inside one transaction", async () => {
    const chunks = buildChunks()
    const existingRows = [
      {
        chunk_index: 0,
        chunk_text: "already there",
        model: "text-embedding-3-small",
      },
    ]
    const appliedRows = [
      {
        chunk_index: 0,
        chunk_text: "first chunk",
        model: "text-embedding-3-small",
      },
      {
        chunk_index: 1,
        chunk_text: "second chunk",
        model: "text-embedding-3-small",
      },
    ]
    const { strapi, queryLog } = createStrapiForOverrideTest({
      existingRowsAfterLock: existingRows,
      appliedRowsAfterWrite: appliedRows,
    })

    const result = await syncVideoEmbeddings(
      strapi as Parameters<typeof syncVideoEmbeddings>[0],
      {
        videoDocumentId: "video-doc-1",
        mode: "override",
        chunks,
        model: "text-embedding-3-small",
        expectedGeneratedContentFingerprint: buildGeneratedContentFingerprint(
          "text-embedding-3-small",
          chunks,
        ),
        expectedExistingContentFingerprint: buildGeneratedContentFingerprint(
          "text-embedding-3-small",
          [{ text: "already there" }],
        ),
      },
    )

    expect(result).toMatchObject({
      status: "override_applied",
      resolvedVideoId: 42,
      videoDocumentId: "video-doc-1",
      hasEmbeddings: true,
      chunkCount: 2,
      model: "text-embedding-3-small",
      contentFingerprint: buildGeneratedContentFingerprint(
        "text-embedding-3-small",
        chunks,
      ),
    })
    expect(queryLog).toEqual([
      "SELECT id FROM videos WHERE id = ? FOR UPDATE",
      "SELECT chunk_index, chunk_text, model FROM transcript_embeddings WHERE video_id = ? ORDER BY chunk_index ASC",
      "DELETE FROM transcript_embeddings WHERE video_id = ?",
      "INSERT INTO transcript_embeddings (video_id, chunk_index, chunk_text, embedding, model) VALUES (?, ?, ?, ?::vector, ?), (?, ?, ?, ?::vector, ?)",
      "SELECT chunk_index, chunk_text, model FROM transcript_embeddings WHERE video_id = ? ORDER BY chunk_index ASC",
    ])
  })
})
