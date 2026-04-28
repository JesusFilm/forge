// Bulk-upsert helpers for Core sync phases.
//
// Replaces the per-row `prisma.upsert` inside `$transaction({ timeout: 5_000 })`
// pattern that timed out reliably in production:
//
//   "Transaction API error: Transaction not found.
//    Transaction ID is invalid, refers to an old closed transaction
//    Prisma doesn't have information about anymore..."
//
// 500 sequential round-trips ≈ 5s in best case, exceeded the 5s
// transaction ceiling on every page. A single bulk
// `INSERT ... ON CONFLICT DO UPDATE` runs in one round-trip and is
// atomic without a transaction wrapper.
//
// See `docs/handoffs/...` and the R1 prod smoke for the failure trace.

import { Prisma } from "@prisma/client"
import { createId } from "@paralleldrive/cuid2"

/**
 * Generate a fresh primary-key id for a Core-sync row insert.
 *
 * Wraps `@paralleldrive/cuid2`'s `createId()`. Prisma's
 * `@default(cuid())` schema directive uses the original cuid (v1)
 * which Prisma generates JS-side at create-time; cuid2 produces a
 * different format (longer, no leading `c`). The two coexist in the
 * `id` column without issue — the column is `String` and no
 * downstream consumer pattern-matches on cuid v1 shape — but the
 * mismatch is deliberate, not accidental: cuid2 has stronger
 * collision/sortability guarantees and is the recommended path
 * forward. If a future migration moves the schema to
 * `@default(cuid(2))`, this helper stays correct unchanged.
 */
export function newRowId(): string {
  return createId()
}

/**
 * Wrap a JSON-serializable value for INSERT into a `jsonb` column.
 *
 * Postgres requires an explicit `::jsonb` cast on parameterised JSON
 * literals; passing a plain string lands as text and the column type
 * coercion fails. The same `${...}::jsonb` shape is used by every
 * raw-SQL hot path in admin (cf. `apps/admin/src/db/pgvector.ts`).
 */
export function jsonbParam(value: unknown): Prisma.Sql {
  return Prisma.sql`${JSON.stringify(value)}::jsonb`
}

/**
 * Structured-log payload for a bulk-upsert failure. Centralises the
 * extraction of Prisma's `code`/`meta` (which carry the Postgres
 * SQLSTATE and constraint name on UNIQUE/CHECK violations) so all
 * five phase catch blocks emit the same shape.
 *
 * Without these fields, operators triaging a phase failure see only
 * `error.message` from the SDK — which often doesn't name the column
 * or row. With them, the structured log line lets you grep for the
 * specific constraint that tripped.
 */
export function bulkErrorLogFields(err: unknown): {
  error: string
  errorCode?: string
  errorMeta?: unknown
} {
  if (err instanceof Error) {
    const prisma = err as Error & {
      code?: string
      meta?: unknown
    }
    return {
      error: err.message,
      ...(typeof prisma.code === "string" ? { errorCode: prisma.code } : {}),
      ...(prisma.meta !== undefined ? { errorMeta: prisma.meta } : {}),
    }
  }
  return { error: String(err) }
}
