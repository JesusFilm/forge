import { readFileSync } from "node:fs"
import { URL } from "node:url"
import { describe, expect, it } from "vitest"

const schema = readFileSync(
  new URL("../prisma/schema.prisma", import.meta.url),
  "utf8",
)
const migration = readFileSync(
  new URL(
    "../prisma/migrations/20260827000000_init_rag_schema/migration.sql",
    import.meta.url,
  ),
  "utf8",
)

const expectedTables = [
  "sources",
  "documents",
  "chunks",
  "chunk_embeddings",
  "http_cache",
  "robots_cache",
  "raw_documents",
]
const expectedIndexes = [
  "sources_key_uq",
  "documents_source_idx",
  "documents_source_canonical_url_uq",
  "chunks_source_idx",
  "chunks_document_idx",
  "chunks_tags_gin",
  "chunks_search_tsv_gin",
  "chunk_embeddings_hnsw",
  "chunk_embeddings_model_idx",
  "raw_documents_source_key_idx",
  "raw_documents_ingested_at_idx",
]

describe("RAG Prisma schema and initial migration", () => {
  it("keeps all legacy tables in the RAG-owned database", () => {
    for (const table of expectedTables) {
      expect(migration).toContain(`CREATE TABLE "${table}"`)
      expect(schema).toContain(`@@map("${table}")`)
    }
  })

  it("enables pgvector before declaring the compatible halfvec column", () => {
    expect(
      migration.indexOf("CREATE EXTENSION IF NOT EXISTS vector"),
    ).toBeLessThan(migration.indexOf('"embedding" halfvec(1536) NOT NULL'))
    expect(schema).toContain('Unsupported("halfvec(1536)")')
    expect(migration).toContain('USING hnsw ("embedding" halfvec_cosine_ops)')
  })

  it("keeps generated full-text search and every compatibility index", () => {
    expect(migration).toContain(
      `"search_tsv" TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', "text")) STORED`,
    )
    expect(schema).toContain('Unsupported("tsvector")? @map("search_tsv")')
    for (const index of expectedIndexes)
      expect(migration).toContain(`"${index}"`)
  })

  it("keeps corpus foreign keys cascading without concurrent indexes", () => {
    expect(
      migration.match(/ON DELETE CASCADE ON UPDATE NO ACTION/g),
    ).toHaveLength(4)
    expect(migration).not.toMatch(/\bCONCURRENTLY\b/i)
  })

  it("does not invent identities missing from the source schema", () => {
    expect(migration).not.toContain('UNIQUE ("source_key", "canonical_url")')
    expect(migration).not.toContain('UNIQUE ("document_id", "ord")')
  })
})
