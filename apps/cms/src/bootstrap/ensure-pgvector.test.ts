import { describe, expect, it, vi } from "vitest"

import { ensurePgvector } from "./ensure-pgvector"

function createStrapi(rawImpl?: (sql: string) => Promise<unknown>) {
  const raw = vi.fn(
    rawImpl ??
      (async () => {
        return undefined
      }),
  )

  return {
    strapi: {
      db: {
        connection: {
          raw,
        },
      },
      log: {
        info: vi.fn(),
        warn: vi.fn(),
      },
    },
    raw,
  }
}

describe("ensurePgvector", () => {
  it("creates transcript embeddings tables and indexes", async () => {
    const { strapi, raw } = createStrapi()

    await ensurePgvector(strapi as Parameters<typeof ensurePgvector>[0])

    const queries = raw.mock.calls.map(([sql]) =>
      sql.replace(/\s+/g, " ").trim(),
    )

    expect(queries[0]).toBe("CREATE EXTENSION IF NOT EXISTS vector")
    expect(queries).toContain(
      "CREATE TABLE IF NOT EXISTS transcript_embeddings ( id SERIAL PRIMARY KEY, video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE, chunk_index INTEGER NOT NULL, chunk_text TEXT NOT NULL, embedding vector(1536) NOT NULL, model VARCHAR(100) NOT NULL DEFAULT 'text-embedding-3-small', created_at TIMESTAMP DEFAULT NOW(), UNIQUE(video_id, chunk_index) )",
    )
    expect(queries).toContain(
      "CREATE INDEX IF NOT EXISTS transcript_embeddings_embedding_idx ON transcript_embeddings USING hnsw (embedding vector_cosine_ops)",
    )
    expect(queries.some((query) => query.includes("video_embeddings"))).toBe(
      false,
    )
  })

  it("returns early when pgvector extension is unavailable", async () => {
    const extensionError = new Error("extension unavailable")
    const { strapi, raw } = createStrapi(async () => {
      throw extensionError
    })

    await ensurePgvector(strapi as Parameters<typeof ensurePgvector>[0])

    expect(raw).toHaveBeenCalledTimes(1)
    expect(strapi.log.warn).toHaveBeenCalledWith(
      "[pgvector] Extension not available, embedding features disabled: extension unavailable",
    )
    expect(strapi.log.info).not.toHaveBeenCalled()
  })
})
