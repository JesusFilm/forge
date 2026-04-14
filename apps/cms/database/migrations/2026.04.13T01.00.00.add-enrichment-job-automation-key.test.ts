import { describe, expect, it, vi } from "vitest"

import {
  down,
  up,
} from "./2026.04.13T01.00.00.add-enrichment-job-automation-key"

function buildKnex(options: { hasColumn?: boolean } = {}) {
  const tableBuilder = {
    string: vi.fn(),
    dropColumn: vi.fn(),
  }
  return {
    schema: {
      hasTable: vi.fn().mockResolvedValue(true),
      hasColumn: vi.fn().mockResolvedValue(options.hasColumn ?? false),
      alterTable: vi.fn(
        async (
          _table: string,
          callback: (table: typeof tableBuilder) => void,
        ) => callback(tableBuilder),
      ),
    },
    raw: vi.fn().mockResolvedValue({ rowCount: 1 }),
    tableBuilder,
  }
}

describe("add enrichment job automation key migration", () => {
  it("adds, backfills, and indexes the automation_key scalar", async () => {
    const knex = buildKnex()

    await up(knex)

    expect(knex.schema.alterTable).toHaveBeenCalledWith(
      "enrichment_jobs",
      expect.any(Function),
    )
    expect(knex.tableBuilder.string).toHaveBeenCalledWith("automation_key")
    expect(knex.raw).toHaveBeenCalledWith(
      `UPDATE "enrichment_jobs"
       SET "automation_key" = artifacts #>> '{automation,data,automationKey}'
       WHERE "automation_key" IS NULL
         AND artifacts #>> '{automation,data,automationKey}' IS NOT NULL`,
    )
    expect(knex.raw).toHaveBeenCalledWith(
      `CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_status_automation_key
       ON "enrichment_jobs" ("status", "automation_key")
       WHERE "automation_key" IS NOT NULL`,
    )
  })

  it("drops the index and column on rollback", async () => {
    const knex = buildKnex({ hasColumn: true })

    await down(knex)

    expect(knex.raw).toHaveBeenCalledWith(
      "DROP INDEX IF EXISTS idx_enrichment_jobs_status_automation_key",
    )
    expect(knex.tableBuilder.dropColumn).toHaveBeenCalledWith("automation_key")
  })
})
