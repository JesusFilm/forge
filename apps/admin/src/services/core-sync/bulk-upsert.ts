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
 * Mirrors Prisma's `@default(cuid())` behavior — the model field is
 * `String @id @default(cuid())` and Prisma generates the cuid in JS
 * at create-time. For raw SQL inserts we have to do the same thing
 * ourselves, since the DB column has no Postgres-side default.
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
