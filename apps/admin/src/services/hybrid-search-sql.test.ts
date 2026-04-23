import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

import {
  EXPERIENCE_LOCALE_TSVECTOR_INDEX_EXPR,
  VIDEO_LOCALE_TSVECTOR_INDEX_EXPR,
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
