import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

class MissingDatabaseUrlError extends Error {
  override readonly name = "MissingDatabaseUrlError"
}

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new MissingDatabaseUrlError(
    "DATABASE_URL is required for the RAG database integration suite; start apps/rag/docker-compose.yml or use CI Postgres",
  )
}

const prisma = new PrismaClient({ datasourceUrl: databaseUrl })

beforeAll(() => prisma.$connect())
afterAll(() => prisma.$disconnect())

describe("RAG migrated PostgreSQL", () => {
  it("has pgvector, the complete schema, and a successful migration ledger", async () => {
    const extensions = await prisma.$queryRaw<Array<{ extversion: string }>>`
      SELECT extversion FROM pg_extension WHERE extname = 'vector'
    `
    expect(extensions[0]?.extversion).toBeTruthy()

    const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name
    `
    expect(tables.map(({ table_name }) => table_name)).toEqual(
      expect.arrayContaining([
        "_prisma_migrations",
        "chunk_embeddings",
        "chunks",
        "documents",
        "http_cache",
        "raw_documents",
        "robots_cache",
        "sources",
      ]),
    )

    const migrations = await prisma.$queryRaw<
      Array<{ finished_at: Date | null }>
    >`
      SELECT finished_at FROM "_prisma_migrations"
      WHERE migration_name = '20260827000000_init_rag_schema'
        AND rolled_back_at IS NULL
    `
    expect(migrations).toHaveLength(1)
    expect(migrations[0]?.finished_at).not.toBeNull()
  })

  it("preserves vector, generated-search, index, and cascade invariants", async () => {
    const sourceId = crypto.randomUUID()
    const documentId = crypto.randomUUID()
    const chunkId = crypto.randomUUID()
    const embedding = `[${Array(1536).fill("0").join(",")}]`

    try {
      await prisma.$executeRaw`
        INSERT INTO sources (id, key, name)
        VALUES (${sourceId}::uuid, ${`db-test-${sourceId}`}, 'DB test')
      `
      await prisma.$executeRaw`
        INSERT INTO documents (id, source_id, canonical_url, content_hash)
        VALUES (${documentId}::uuid, ${sourceId}::uuid, ${`https://example.test/${documentId}`}, 'hash')
      `
      await prisma.$executeRaw`
        INSERT INTO chunks (id, document_id, source_id, ord, text, char_start, char_end, token_count)
        VALUES (${chunkId}::uuid, ${documentId}::uuid, ${sourceId}::uuid, 0, 'Jesus brings hope', 0, 17, 3)
      `
      await prisma.$executeRawUnsafe(
        "INSERT INTO chunk_embeddings (chunk_id, embedding, embedding_model) VALUES ($1::uuid, $2::halfvec, $3)",
        chunkId,
        embedding,
        "qwen/qwen3-embedding-8b",
      )

      const facts = await prisma.$queryRawUnsafe<
        Array<{ dimensions: number; searchable: boolean }>
      >(
        `SELECT vector_dims(e.embedding)::int AS dimensions,
              c.search_tsv @@ plainto_tsquery('english', 'hope') AS searchable
       FROM chunk_embeddings e JOIN chunks c ON c.id = e.chunk_id
       WHERE e.chunk_id = $1::uuid`,
        chunkId,
      )
      expect(facts).toEqual([{ dimensions: 1536, searchable: true }])

      const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
        SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
      `
      expect(indexes.map(({ indexname }) => indexname)).toEqual(
        expect.arrayContaining([
          "chunks_tags_gin",
          "chunks_search_tsv_gin",
          "chunk_embeddings_hnsw",
        ]),
      )

      await prisma.$executeRaw`DELETE FROM sources WHERE id = ${sourceId}::uuid`
      const descendants = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*) FROM chunks WHERE id = ${chunkId}::uuid
      `
      expect(descendants[0]?.count).toBe(0n)
    } finally {
      await prisma.$executeRaw`DELETE FROM sources WHERE id = ${sourceId}::uuid`
    }
  })

  it("is empty outside rows created and removed by this suite", async () => {
    const counts = await prisma.$queryRaw<
      Array<{
        sources: bigint
        documents: bigint
        chunks: bigint
        embeddings: bigint
        httpCache: bigint
        robotsCache: bigint
        rawDocuments: bigint
      }>
    >`
      SELECT
        (SELECT count(*) FROM sources) AS sources,
        (SELECT count(*) FROM documents) AS documents,
        (SELECT count(*) FROM chunks) AS chunks,
        (SELECT count(*) FROM chunk_embeddings) AS embeddings,
        (SELECT count(*) FROM http_cache) AS "httpCache",
        (SELECT count(*) FROM robots_cache) AS "robotsCache",
        (SELECT count(*) FROM raw_documents) AS "rawDocuments"
    `
    expect(counts).toEqual([
      {
        sources: 0n,
        documents: 0n,
        chunks: 0n,
        embeddings: 0n,
        httpCache: 0n,
        robotsCache: 0n,
        rawDocuments: 0n,
      },
    ])
  })
})
