/**
 * Materialize automation duplicate-suppression keys onto enrichment_jobs.
 *
 * Existing jobs store the key inside artifacts. Keeping a scalar column lets
 * pending/running lookup use a small btree index instead of JSONB extraction.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function up(knex: any): Promise<void> {
  const exists = await knex.schema.hasTable("enrichment_jobs")
  if (!exists) return

  const hasColumn = await knex.schema.hasColumn(
    "enrichment_jobs",
    "automation_key",
  )
  if (!hasColumn) {
    await knex.schema.alterTable("enrichment_jobs", (table: any) => {
      table.string("automation_key")
    })
  }

  await knex.raw(
    `UPDATE "enrichment_jobs"
       SET "automation_key" = artifacts #>> '{automation,data,automationKey}'
       WHERE "automation_key" IS NULL
         AND artifacts #>> '{automation,data,automationKey}' IS NOT NULL`,
  )

  await knex.raw(
    `CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_status_automation_key
       ON "enrichment_jobs" ("status", "automation_key")
       WHERE "automation_key" IS NOT NULL`,
  )
}

export async function down(knex: any): Promise<void> {
  const exists = await knex.schema.hasTable("enrichment_jobs")
  if (!exists) return

  await knex.raw(
    "DROP INDEX IF EXISTS idx_enrichment_jobs_status_automation_key",
  )

  const hasColumn = await knex.schema.hasColumn(
    "enrichment_jobs",
    "automation_key",
  )
  if (hasColumn) {
    await knex.schema.alterTable("enrichment_jobs", (table: any) => {
      table.dropColumn("automation_key")
    })
  }
}
