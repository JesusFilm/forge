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
 * Reject `{` or `}` at the input boundary: braces are structural in PG array
 * literals. Pass already-validated input.
 */
export function toPgArray(values: readonly string[]): string {
  if (values.length === 0) return "{}"
  const escaped = values.map((value) => {
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
