// pgvector helpers shared across services.
//
// Mirrors `apps/cms/src/api/scene-embedding/services/indexer.ts` patterns:
//   - PostgreSQL 18 on Railway rejects `?::jsonb::text[]` casts. Use a PG
//     array literal like `{val1,val2}` with `?::text[]` instead.
//   - Vector parameters bind as 1536-float arrays; cast with `::vector` in SQL.
//
// Per Unit 2 of docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md.
// Unsafe brace input is rejected with a clear error rather than silently
// quoted. Backslashes and quotes are escaped for PostgreSQL array literals.

const UNSAFE_BRACE = /[{}]/

/**
 * Convert a string array to a PostgreSQL array literal: `{val1,val2}`.
 * Values are quoted and escaped so that commas, spaces, and double quotes
 * inside values survive the round-trip.
 *
 * `null` elements emit the unquoted literal `NULL` token, which Postgres
 * parses as a SQL NULL when the literal is bound through `?::text[]` (and
 * subsequently unfolded via `unnest(...)`). The literal three-character
 * string `"NULL"` survives as a quoted element distinct from a NULL.
 * Stage 3 (feat-117) of the embed-backfill performance plan added this
 * variant to support per-row Way A casts on nullable columns
 * (`chapter_title`, `start_seconds`, `end_seconds`, etc.) inside a single
 * `INSERT … unnest(...)` call.
 *
 * Reject `{` or `}` at the input boundary: braces are structural in PG array
 * literals. Pass already-validated input.
 */
export function toPgArray(values: readonly (string | null)[]): string {
  if (values.length === 0) return "{}"
  const escaped = values.map((value) => {
    if (value === null) return "NULL"
    if (UNSAFE_BRACE.test(value)) {
      throw new Error(
        `toPgArray: value contains unsupported brace character: ${value}`,
      )
    }
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
  })
  return "{" + escaped.join(",") + "}"
}

/**
 * Format a numeric vector for binding as a `::vector` parameter in raw SQL.
 * Produces `[0.1,0.2,...]` — pgvector's canonical text representation.
 */
export function toPgVector(embedding: readonly number[]): string {
  if (embedding.length === 0) return "[]"
  return "[" + embedding.map((v) => v.toString()).join(",") + "]"
}

/**
 * Length-equality preflight for parallel arrays bound into a single
 * `INSERT … unnest(arr1, arr2, ...)` statement. PostgreSQL 18's
 * `unnest(arr1, arr2, ...)` silently NULL-pads unequal-length arrays — a
 * regression that drops a row from a parallel-array bind would corrupt the
 * INSERT without raising. Throwing BEFORE `$executeRaw` makes the bug
 * visible at the call site rather than at downstream read time.
 *
 * Lives next to `toPgArray` because the two helpers are always used
 * together: `toPgArray` formats each parallel array as a `text[]`
 * literal; this helper guards against length mismatches across them.
 *
 * `errorFactory` lets each caller throw a typed error class whose `code`
 * union has its own arm (e.g. `SceneIndexError("artifact_invalid", ...)`,
 * `TranscriptIndexError("artifact_invalid", ...)`). Stage 3 (feat-117)
 * lifted this from the per-service definitions when the second copy
 * landed.
 */
export function assertParallelArrayLengthsMatch(
  expected: number,
  arrays: ReadonlyArray<{ name: string; length: number }>,
  errorFactory: (message: string) => Error,
): void {
  for (const arr of arrays) {
    if (arr.length !== expected) {
      throw errorFactory(
        `parallel-array length mismatch in bulk INSERT (expected=${expected}, ${arr.name}=${arr.length})`,
      )
    }
  }
}
