import { describe, expect, it, vi } from "vitest"

import {
  DESCRIPTION_TSV_GENERATED_EXPR,
  TITLE_TSV_GENERATED_EXPR,
  VIDEOS_LEXICAL_WEIGHTED_INDEX_NAME,
  VIDEOS_TITLE_TRGM_INDEX_NAME,
  WEIGHTED_TSV_EXPR,
} from "../api/search/services/lexical-sql"
import { ensureSearchLexical } from "./ensure-search-lexical"

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

function normalize(sql: string): string {
  return sql.replace(/\s+/g, " ").trim()
}

describe("ensureSearchLexical", () => {
  it("installs pg_trgm and provisions both generated columns + both GIN indexes", async () => {
    const { strapi, raw } = createStrapi()

    await ensureSearchLexical(
      strapi as Parameters<typeof ensureSearchLexical>[0],
    )

    const queries = raw.mock.calls.map(([sql]) => normalize(sql))

    expect(queries[0]).toBe("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    expect(queries).toContain(
      normalize(`
        ALTER TABLE videos
          ADD COLUMN IF NOT EXISTS title_tsv tsvector
          GENERATED ALWAYS AS (${TITLE_TSV_GENERATED_EXPR}) STORED
      `),
    )

    expect(queries).toContain(
      normalize(`
        ALTER TABLE videos
          ADD COLUMN IF NOT EXISTS description_tsv tsvector
          GENERATED ALWAYS AS (${DESCRIPTION_TSV_GENERATED_EXPR}) STORED
      `),
    )

    expect(queries).toContain(
      normalize(`
        CREATE INDEX IF NOT EXISTS ${VIDEOS_LEXICAL_WEIGHTED_INDEX_NAME}
          ON videos USING gin (${WEIGHTED_TSV_EXPR})
      `),
    )

    expect(queries).toContain(
      normalize(`
        CREATE INDEX IF NOT EXISTS ${VIDEOS_TITLE_TRGM_INDEX_NAME}
          ON videos USING gin (title gin_trgm_ops)
      `),
    )
  })

  it("byte-parity invariant: indexed expression matches the shared TS constant verbatim", async () => {
    // The whole point of `lexical-sql.ts` is that the keyword-first
    // retriever's WHERE clause and this index expression are the
    // SAME string. Drift here silently turns the GIN index into
    // dead weight (planner falls back to Seq Scan). Asserting
    // byte-equality on the SQL the bootstrap actually emits keeps
    // a test failing the moment they desynchronize.
    const { strapi, raw } = createStrapi()

    await ensureSearchLexical(
      strapi as Parameters<typeof ensureSearchLexical>[0],
    )

    const sqlTexts = raw.mock.calls.map(([sql]) => sql as string)

    const weightedIndexSql = sqlTexts.find((sql) =>
      sql.includes(VIDEOS_LEXICAL_WEIGHTED_INDEX_NAME),
    )
    expect(weightedIndexSql).toBeDefined()
    expect(weightedIndexSql).toContain(WEIGHTED_TSV_EXPR)

    const titleColumnSql = sqlTexts.find((sql) => sql.includes("title_tsv"))
    expect(titleColumnSql).toContain(TITLE_TSV_GENERATED_EXPR)

    const descriptionColumnSql = sqlTexts.find((sql) =>
      sql.includes("description_tsv"),
    )
    expect(descriptionColumnSql).toContain(DESCRIPTION_TSV_GENERATED_EXPR)
  })

  it("does not touch the legacy videos_fulltext_search_idx", async () => {
    // Hybrid mode reads the legacy index. Touching it here would be a
    // default-behavior change.
    const { strapi, raw } = createStrapi()

    await ensureSearchLexical(
      strapi as Parameters<typeof ensureSearchLexical>[0],
    )

    const queries = raw.mock.calls.map(([sql]) => sql as string)
    expect(queries.some((q) => q.includes("videos_fulltext_search_idx"))).toBe(
      false,
    )
  })

  it("is idempotent — running twice issues the same DDL", async () => {
    const { strapi, raw } = createStrapi()

    await ensureSearchLexical(
      strapi as Parameters<typeof ensureSearchLexical>[0],
    )
    const firstCallCount = raw.mock.calls.length
    await ensureSearchLexical(
      strapi as Parameters<typeof ensureSearchLexical>[0],
    )

    expect(raw.mock.calls.length).toBe(firstCallCount * 2)
    // All DDL is `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` —
    // PostgreSQL is responsible for the no-op semantics; we just
    // assert the bootstrap doesn't gate itself on prior state.
    const firstHalf = raw.mock.calls
      .slice(0, firstCallCount)
      .map(([sql]) => normalize(sql as string))
    const secondHalf = raw.mock.calls
      .slice(firstCallCount)
      .map(([sql]) => normalize(sql as string))
    expect(secondHalf).toEqual(firstHalf)
  })

  it("warns and returns early when pg_trgm extension fails to install", async () => {
    const extensionError = new Error("permission denied for extension pg_trgm")
    let callCount = 0
    const { strapi, raw } = createStrapi(async () => {
      callCount += 1
      if (callCount === 1) throw extensionError
      return undefined
    })

    await ensureSearchLexical(
      strapi as Parameters<typeof ensureSearchLexical>[0],
    )

    expect(raw).toHaveBeenCalledTimes(1)
    expect(strapi.log.warn).toHaveBeenCalledWith(
      "[search-lexical] pg_trgm not available, keyword-first mode will Seq Scan: permission denied for extension pg_trgm",
    )
    expect(strapi.log.info).not.toHaveBeenCalled()
  })

  it("warns and continues when ALTER TABLE fails (e.g. videos table missing)", async () => {
    let callCount = 0
    const tableError = new Error('relation "videos" does not exist')
    const { strapi, raw } = createStrapi(async () => {
      callCount += 1
      if (callCount === 1) return undefined // pg_trgm OK
      throw tableError
    })

    await ensureSearchLexical(
      strapi as Parameters<typeof ensureSearchLexical>[0],
    )

    expect(raw).toHaveBeenCalledTimes(2) // extension OK + first ALTER throws
    expect(strapi.log.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "[search-lexical] Failed to provision generated columns or indexes",
      ),
    )
  })
})
