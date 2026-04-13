/**
 * Backfill NULL -> live for automation run modes before exposing them as
 * non-null GraphQL fields.
 */

const COLUMNS: Array<{ table: string; column: string; fallback: string }> = [
  { table: "enrichment_automations", column: "run_mode", fallback: "live" },
  {
    table: "enrichment_automation_runs",
    column: "run_mode",
    fallback: "live",
  },
]

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function up(knex: any): Promise<void> {
  for (const { table, column, fallback } of COLUMNS) {
    const exists = await knex.schema.hasTable(table)
    if (!exists) continue

    const hasCol = await knex.schema.hasColumn(table, column)
    if (!hasCol) continue

    const result = await knex.raw(
      `UPDATE "${table}" SET "${column}" = ? WHERE "${column}" IS NULL`,
      [fallback],
    )
    const count = result?.rowCount ?? result?.rows?.length ?? 0
    if (count > 0) {
      console.log(
        `[migration] Backfilled ${count} rows: ${table}.${column} -> ${fallback}`,
      )
    }

    await knex.raw(
      `ALTER TABLE "${table}" ALTER COLUMN "${column}" SET DEFAULT ?`,
      [fallback],
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
