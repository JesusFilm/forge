import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

import {
  DESCRIPTION_TSV_GENERATED_EXPR,
  EXPERIENCE_LOCALE_TSVECTOR_INDEX_EXPR,
  TITLE_TSV_GENERATED_EXPR,
  VIDEO_LOCALE_LEXICAL_WEIGHTED_INDEX_NAME,
  VIDEO_LOCALE_TITLE_TRGM_INDEX_NAME,
  VIDEO_LOCALE_TSVECTOR_INDEX_EXPR,
  WEIGHTED_TSV_INDEX_EXPR,
} from "./hybrid-search-sql"

/**
 * Byte-parity invariant: the tsvector expressions used by R4's keyword
 * retrievers MUST be byte-identical to the expressions baked into the
 * GIN indexes created by `0006_hybrid_search_gin/migration.sql`. If
 * they drift, Postgres silently falls back to sequential scan.
 *
 * This test is pure string-matching — it does not open a DB
 * connection. Migration runnability is covered by Prisma's own
 * migrate-diff tooling at deploy time.
 */
describe("hybrid-search-sql byte-parity with GIN migration", () => {
  const migrationSql = readFileSync(
    resolve(
      __dirname,
      "..",
      "..",
      "prisma",
      "migrations",
      "0006_hybrid_search_gin",
      "migration.sql",
    ),
    "utf8",
  )

  it("contains the video-locale tsvector INDEX expression verbatim", () => {
    expect(migrationSql).toContain(VIDEO_LOCALE_TSVECTOR_INDEX_EXPR)
  })

  it("contains the experience-locale tsvector INDEX expression verbatim", () => {
    expect(migrationSql).toContain(EXPERIENCE_LOCALE_TSVECTOR_INDEX_EXPR)
  })
})

/**
 * Byte-parity invariant for R4-extension keyword-first lexical search.
 *
 * The generated-column expressions and weighted GIN index expression
 * MUST appear byte-equal inside `0009_keyword_first_lexical/migration.sql`.
 * Drift on the generated columns means a future migration would
 * compute different tsvectors than the live data carries; drift on
 * the weighted index expression silently reverts the
 * `searchByKeywordWeighted` retriever to seq scan.
 *
 * The trigram retriever uses operator-class GIN (`gin_trgm_ops`) and
 * has no expression byte-parity to enforce — only the index name is
 * cross-checked here so a future rename can't go un-noticed.
 */
describe("hybrid-search-sql byte-parity with keyword-first migration", () => {
  const keywordFirstMigrationSql = readFileSync(
    resolve(
      __dirname,
      "..",
      "..",
      "prisma",
      "migrations",
      "0009_keyword_first_lexical",
      "migration.sql",
    ),
    "utf8",
  )

  it("contains the title generated-column expression verbatim", () => {
    expect(keywordFirstMigrationSql).toContain(TITLE_TSV_GENERATED_EXPR)
  })

  it("contains the description generated-column expression verbatim", () => {
    expect(keywordFirstMigrationSql).toContain(DESCRIPTION_TSV_GENERATED_EXPR)
  })

  it("contains the weighted tsvector INDEX expression verbatim", () => {
    expect(keywordFirstMigrationSql).toContain(WEIGHTED_TSV_INDEX_EXPR)
  })

  it("creates the weighted GIN index under the canonical name", () => {
    expect(keywordFirstMigrationSql).toContain(
      VIDEO_LOCALE_LEXICAL_WEIGHTED_INDEX_NAME,
    )
  })

  it("creates the trigram GIN index under the canonical name", () => {
    expect(keywordFirstMigrationSql).toContain(
      VIDEO_LOCALE_TITLE_TRGM_INDEX_NAME,
    )
  })

  it("provisions pg_trgm idempotently", () => {
    expect(keywordFirstMigrationSql).toMatch(
      /CREATE EXTENSION IF NOT EXISTS pg_trgm/i,
    )
  })

  it("leaves the legacy R4 GIN index untouched", () => {
    // Sanity: nothing in the keyword-first migration drops or alters
    // R4's index. The R4 keyword retriever still reads it on the
    // hybrid path. The migration is allowed to *mention* the legacy
    // index in comments — what matters is no DDL touches it.
    expect(keywordFirstMigrationSql).not.toMatch(
      /\b(DROP|ALTER)\s+INDEX[^\n]*video_locale_fulltext_search_idx/i,
    )
  })
})
