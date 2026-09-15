import { readFileSync } from "node:fs"
import { describe, expect, it, vi } from "vitest"
import {
  ACTIVE_CONTENT_EMBEDDING_CONTRACT_ID,
  ACTIVE_CONTENT_QUERY_EMBEDDING_DIMENSIONS,
  ACTIVE_CONTENT_QUERY_EMBEDDING_MODEL,
  ACTIVE_CONTENT_QUERY_EMBEDDING_PROVIDER,
  ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
  ACTIVE_CONTENT_STORAGE_EMBEDDING_MODEL,
  ACTIVE_CONTENT_STORAGE_EMBEDDING_PROVIDER,
  CONTENT_EMBEDDING_CONTRACT_POINTER_ID,
  INITIAL_CONTENT_EMBEDDING_CONTRACT_ID,
  contentEmbeddingTupleMatches,
  resolveActiveContentEmbeddingContract,
} from "./content-embedding-contract"

function activeContractRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    pointerId: CONTENT_EMBEDDING_CONTRACT_POINTER_ID,
    contractId: ACTIVE_CONTENT_EMBEDDING_CONTRACT_ID,
    queryProvider: ACTIVE_CONTENT_QUERY_EMBEDDING_PROVIDER,
    queryModel: ACTIVE_CONTENT_QUERY_EMBEDDING_MODEL,
    queryNativeDimensions: ACTIVE_CONTENT_QUERY_EMBEDDING_DIMENSIONS,
    queryDimensions: ACTIVE_CONTENT_QUERY_EMBEDDING_DIMENSIONS,
    queryTransformVersion: null,
    storageProvider: ACTIVE_CONTENT_STORAGE_EMBEDDING_PROVIDER,
    storageModel: ACTIVE_CONTENT_STORAGE_EMBEDDING_MODEL,
    storageNativeDimensions: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
    storageDimensions: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
    storageTransformVersion: null,
    ...overrides,
  }
}

describe("contentEmbeddingTupleMatches", () => {
  it("requires exact provider, model, native dimensions, stored dimensions, and transform", () => {
    const base = {
      provider: ACTIVE_CONTENT_STORAGE_EMBEDDING_PROVIDER,
      model: ACTIVE_CONTENT_STORAGE_EMBEDDING_MODEL,
      nativeDimensions: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
      dimensions: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
      transformVersion: null,
    }

    expect(contentEmbeddingTupleMatches(base, { ...base })).toBe(true)
    expect(
      contentEmbeddingTupleMatches(base, {
        ...base,
        provider: "openai",
      }),
    ).toBe(false)
    expect(
      contentEmbeddingTupleMatches(base, {
        ...base,
        transformVersion: "matryoshka-truncate-1536-v1",
      }),
    ).toBe(false)
  })
})

describe("resolveActiveContentEmbeddingContract", () => {
  it("defines Fireworks as the active query side of the v2 contract", () => {
    expect(ACTIVE_CONTENT_EMBEDDING_CONTRACT_ID).toBe(
      "semantic-transcript-pgvector-v2",
    )
    expect(ACTIVE_CONTENT_QUERY_EMBEDDING_PROVIDER).toBe("fireworks")
    expect(ACTIVE_CONTENT_QUERY_EMBEDDING_MODEL).toBe(
      "fireworks/qwen3-embedding-8b",
    )
  })

  it("resolves the single active contract row", async () => {
    const prisma = {
      $queryRaw: vi.fn(async () => [activeContractRow()]),
    }

    await expect(
      resolveActiveContentEmbeddingContract(prisma as never),
    ).resolves.toEqual({
      id: ACTIVE_CONTENT_EMBEDDING_CONTRACT_ID,
      query: {
        provider: ACTIVE_CONTENT_QUERY_EMBEDDING_PROVIDER,
        model: ACTIVE_CONTENT_QUERY_EMBEDDING_MODEL,
        nativeDimensions: ACTIVE_CONTENT_QUERY_EMBEDDING_DIMENSIONS,
        dimensions: ACTIVE_CONTENT_QUERY_EMBEDDING_DIMENSIONS,
        transformVersion: null,
      },
      storage: {
        provider: ACTIVE_CONTENT_STORAGE_EMBEDDING_PROVIDER,
        model: ACTIVE_CONTENT_STORAGE_EMBEDDING_MODEL,
        nativeDimensions: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
        dimensions: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
        transformVersion: null,
      },
    })
  })

  it("fails closed when the active pointer is missing", async () => {
    const prisma = {
      $queryRaw: vi.fn(async () => []),
    }

    await expect(
      resolveActiveContentEmbeddingContract(prisma as never),
    ).rejects.toMatchObject({
      code: "missing_active_pointer",
    })
  })

  it("fails closed when multiple active pointers exist", async () => {
    const prisma = {
      $queryRaw: vi.fn(async () => [activeContractRow(), activeContractRow()]),
    }

    await expect(
      resolveActiveContentEmbeddingContract(prisma as never),
    ).rejects.toMatchObject({
      code: "multiple_active_pointers",
    })
  })

  it("fails closed when the pointer is dangling or incomplete", async () => {
    const dangling = {
      $queryRaw: vi.fn(async () => [activeContractRow({ contractId: null })]),
    }
    await expect(
      resolveActiveContentEmbeddingContract(dangling as never),
    ).rejects.toMatchObject({
      code: "dangling_active_pointer",
    })

    const incomplete = {
      $queryRaw: vi.fn(async () => [activeContractRow({ storageModel: null })]),
    }
    await expect(
      resolveActiveContentEmbeddingContract(incomplete as never),
    ).rejects.toMatchObject({
      code: "dangling_active_pointer",
    })
  })
})

describe("content embedding contract migration", () => {
  it("creates the registry, singleton pointer, immutability guards, and query cache backfill", () => {
    const sql = readFileSync(
      new URL(
        "../../prisma/migrations/0072_content_embedding_contract_authority/migration.sql",
        import.meta.url,
      ),
      "utf8",
    )

    expect(sql).toContain('CREATE TABLE "content_embedding_contract"')
    expect(sql).toContain('CREATE TABLE "content_embedding_contract_pointer"')
    expect(sql).toContain(
      'CREATE TRIGGER "content_embedding_contract_immutable"',
    )
    expect(sql).toContain(
      'CREATE TRIGGER "content_embedding_contract_pointer_delete_forbidden"',
    )
    expect(sql).toContain('INSERT INTO "content_embedding_contract" (')
    expect(sql).toContain('INSERT INTO "content_embedding_contract_pointer" (')
    expect(sql).toContain('ALTER TABLE "query_embedding_cache"')
    expect(sql).toContain(
      `SET "contract_id" = '${INITIAL_CONTENT_EMBEDDING_CONTRACT_ID}'`,
    )
  })

  it("registers the immutable Fireworks v2 contract before rotating the active pointer", () => {
    const sql = readFileSync(
      new URL(
        "../../prisma/migrations/0080_fireworks_content_embedding_contract/migration.sql",
        import.meta.url,
      ),
      "utf8",
    )

    expect(sql).toContain("'semantic-transcript-pgvector-v2'")
    expect(sql).toContain("'fireworks'")
    expect(sql).toContain("'fireworks/qwen3-embedding-8b'")
    expect(sql).toMatch(
      /UPDATE\s+"content_embedding_contract_pointer"[\s\S]+SET\s+"active_contract_id"\s*=\s*'semantic-transcript-pgvector-v2'[\s\S]+WHERE[\s\S]+"active_contract_id"\s*=\s*'semantic-transcript-pgvector-v1'/,
    )
  })
})
