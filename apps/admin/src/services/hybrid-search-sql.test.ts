import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

import {
  DESCRIPTION_TSV_GENERATED_EXPR,
  EXPERIENCE_LOCALE_TSVECTOR_INDEX_EXPR,
  TITLE_TSV_GENERATED_EXPR,
  VIDEO_LOCALE_DESCRIPTION_TRGM_INDEX_NAME,
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
 * The generated-column expressions and the weighted GIN index expression
 * MUST appear byte-equal inside the migration that currently defines
 * the live `video_locale.title_tsv` / `video_locale.description_tsv`
 * columns. As of `0010_camelcase_tsv_and_description_trigram`, the
 * generated-column expressions inject a CamelCase-split via
 * `regexp_replace` BEFORE `to_tsvector` runs (closes the BibleProject
 * recall gap on keyword-first mode). The migration also DROP-CASCADEs
 * the previous columns + index from `0009_keyword_first_lexical` and
 * recreates them, so any byte-parity check against 0009 is now
 * historical and the LIVE invariant lives against 0010.
 *
 * Drift on the generated columns means a future migration would
 * compute different tsvectors than the live data carries; drift on
 * the weighted index expression silently reverts the
 * `searchByKeywordWeighted` retriever to seq scan.
 *
 * The trigram retrievers use operator-class GIN (`gin_trgm_ops`) and
 * have no expression byte-parity to enforce — only the index names are
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
      "0010_camelcase_tsv_and_description_trigram",
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

  it("creates the description trigram GIN index under the canonical name", () => {
    expect(keywordFirstMigrationSql).toContain(
      VIDEO_LOCALE_DESCRIPTION_TRGM_INDEX_NAME,
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

  it("leaves the title trigram GIN index from 0009 untouched", () => {
    // 0009 provisioned `video_locale_title_trgm_idx`; 0010 only adds the
    // description trigram counterpart. Drop/Alter the title index would
    // be a regression for the existing trigram retriever path.
    expect(keywordFirstMigrationSql).not.toMatch(
      /\b(DROP|ALTER)\s+INDEX[^\n]*video_locale_title_trgm_idx/i,
    )
  })
})

/**
 * Behavioural invariant for the CamelCase-split regex.
 *
 * The byte-parity tests above verify that the literal regex pattern
 * appears character-identically inside the migration. They do NOT
 * exercise the regex's behaviour. This block runs the same pattern
 * (`([a-z])([A-Z])`, replacement `$1 $2`, global) as a JavaScript
 * regex against representative inputs and asserts the expected
 * tokenization split.
 *
 * Postgres' POSIX regex and JavaScript's regex implement
 * non-Unicode-aware `[a-z]` / `[A-Z]` classes identically (both
 * match only ASCII Latin code points), so the JS form is a faithful
 * stand-in for Postgres' `regexp_replace` here. A future migration
 * that broadens the classes to `[[:lower:]]` / `[[:upper:]]` would
 * diverge — Postgres honors LC_CTYPE there, JS does not — and this
 * test would need a real-DB run instead. Out of scope today;
 * documented as a known limit in the migration comment.
 */
describe("CamelCase-split regex behaviour (locked in by byte-parity above)", () => {
  // Same pattern + replacement string used in TITLE_TSV_GENERATED_EXPR /
  // DESCRIPTION_TSV_GENERATED_EXPR. Re-derived here as a JS RegExp so
  // we can exercise the transformation without a DB connection.
  const splitCamel = (input: string): string =>
    input.replace(/([a-z])([A-Z])/g, "$1 $2")

  const cases: Array<{ input: string; expected: string; rationale: string }> = [
    {
      input: "BibleProject",
      expected: "Bible Project",
      rationale: "two-segment CamelCase brand splits",
    },
    {
      input: "JesusFilm",
      expected: "Jesus Film",
      rationale: "two-segment CamelCase brand splits",
    },
    {
      input: "MacOS",
      expected: "Mac OS",
      rationale: "lower-then-upper boundary splits",
    },
    {
      input: "iPhone",
      expected: "i Phone",
      rationale: "single-letter prefix splits",
    },
    {
      input: "BibleProjectVideo",
      expected: "Bible Project Video",
      rationale: "multi-segment CamelCase splits at every boundary",
    },
    {
      input: "YHWH",
      expected: "YHWH",
      rationale: "all-caps acronym preserved (no lower-then-upper boundary)",
    },
    {
      input: "LORD",
      expected: "LORD",
      rationale: "all-caps acronym preserved",
    },
    {
      input: "iOS",
      expected: "i OS",
      rationale:
        "single-lower-then-upper boundary splits even when followed by all-caps; trailing 'S' has no upper after it",
    },
    {
      input: "ABCDef",
      expected: "ABCDef",
      rationale:
        "no `[a-z]` followed by `[A-Z]` — leading all-caps run kept whole",
    },
    {
      input: "Bible Project",
      expected: "Bible Project",
      rationale: "already split — regex is idempotent",
    },
    {
      input: "",
      expected: "",
      rationale: "empty string short-circuits",
    },
    {
      input: "СловоБожие",
      expected: "СловоБожие",
      rationale:
        "ASCII-only regex does NOT split Cyrillic CamelCase — known limit, recall on those locales falls through to trigram retriever",
    },
  ]

  for (const { input, expected, rationale } of cases) {
    it(`splits ${JSON.stringify(input)} -> ${JSON.stringify(expected)} (${rationale})`, () => {
      expect(splitCamel(input)).toBe(expected)
    })
  }
})

/**
 * Historical invariant for `0009_keyword_first_lexical/migration.sql`.
 *
 * 0009 originally created the `title_tsv` / `description_tsv` generated
 * columns + the weighted GIN index + the title trigram GIN index. 0010
 * supersedes 0009's generated-column definitions (DROP CASCADE + ADD
 * with the CamelCase-split expression) but keeps the title trigram
 * index untouched. This block locks the invariants 0009 still owns:
 * the trigram extension and the title trigram index name.
 */
describe("hybrid-search-sql historical invariants on 0009", () => {
  const oldMigrationSql = readFileSync(
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

  it("provisions pg_trgm idempotently in 0009", () => {
    expect(oldMigrationSql).toMatch(/CREATE EXTENSION IF NOT EXISTS pg_trgm/i)
  })

  it("creates the title trigram GIN index under the canonical name", () => {
    expect(oldMigrationSql).toContain(VIDEO_LOCALE_TITLE_TRGM_INDEX_NAME)
  })
})
