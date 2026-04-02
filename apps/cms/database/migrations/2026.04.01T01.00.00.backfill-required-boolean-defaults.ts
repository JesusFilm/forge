/**
 * Backfill NULL → false for required boolean columns and add NOT NULL defaults.
 *
 * Strapi v5 marks these fields as non-nullable in the GraphQL schema (Boolean!)
 * but only applies defaults on new record creation. Existing rows imported via
 * data snapshots or created before the field was added retain NULL, causing
 * "Cannot return null for non-nullable field" GraphQL errors that cascade into
 * 502s on downstream apps (e.g. @forge/manager video cache).
 */

const COLUMNS: Array<{ table: string; column: string; fallback: boolean }> = [
  { table: "videos", column: "ai_metadata", fallback: false },
  { table: "video_subtitles", column: "ai_generated", fallback: false },
  { table: "video_variants", column: "ai_generated", fallback: false },
]

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function up(knex: any): Promise<void> {
  for (const { table, column, fallback } of COLUMNS) {
    const exists = await knex.schema.hasTable(table)
    if (!exists) continue

    const hasCol = await knex.schema.hasColumn(table, column)
    if (!hasCol) continue

    // Backfill NULLs first
    const result = await knex.raw(
      `UPDATE "${table}" SET "${column}" = ? WHERE "${column}" IS NULL`,
      [fallback],
    )
    const count = result?.rowCount ?? result?.rows?.length ?? 0
    if (count > 0) {
      console.log(
        `[migration] Backfilled ${count} rows: ${table}.${column} → ${fallback}`,
      )
    }

    // Add NOT NULL constraint with DEFAULT to prevent future NULLs
    await knex.raw(
      `ALTER TABLE "${table}" ALTER COLUMN "${column}" SET DEFAULT ${fallback}`,
    )
    await knex.raw(
      `ALTER TABLE "${table}" ALTER COLUMN "${column}" SET NOT NULL`,
    )
  }
}

export async function down(knex: any): Promise<void> {
  for (const { table, column } of COLUMNS) {
    const exists = await knex.schema.hasTable(table)
    if (!exists) continue

    const hasCol = await knex.schema.hasColumn(table, column)
    if (!hasCol) continue

    await knex.raw(
      `ALTER TABLE "${table}" ALTER COLUMN "${column}" DROP NOT NULL`,
    )
    await knex.raw(
      `ALTER TABLE "${table}" ALTER COLUMN "${column}" DROP DEFAULT`,
    )
  }
}
