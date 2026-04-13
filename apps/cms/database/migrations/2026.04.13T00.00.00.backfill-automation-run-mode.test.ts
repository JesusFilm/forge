import { describe, expect, it, vi } from "vitest"

import { down, up } from "./2026.04.13T00.00.00.backfill-automation-run-mode"

function buildKnex() {
  return {
    schema: {
      hasTable: vi.fn().mockResolvedValue(true),
      hasColumn: vi.fn().mockResolvedValue(true),
    },
    raw: vi.fn().mockResolvedValue({ rowCount: 1 }),
  }
}

describe("backfill automation run mode migration", () => {
  it("backfills run_mode and enforces defaults on automation tables", async () => {
    const knex = buildKnex()

    await up(knex)

    expect(knex.raw).toHaveBeenCalledWith(
      'UPDATE "enrichment_automations" SET "run_mode" = ? WHERE "run_mode" IS NULL',
      ["live"],
    )
    expect(knex.raw).toHaveBeenCalledWith(
      'ALTER TABLE "enrichment_automations" ALTER COLUMN "run_mode" SET DEFAULT ?',
      ["live"],
    )
    expect(knex.raw).toHaveBeenCalledWith(
      'ALTER TABLE "enrichment_automations" ALTER COLUMN "run_mode" SET NOT NULL',
    )
    expect(knex.raw).toHaveBeenCalledWith(
      'UPDATE "enrichment_automation_runs" SET "run_mode" = ? WHERE "run_mode" IS NULL',
      ["live"],
    )
    expect(knex.raw).toHaveBeenCalledWith(
      'ALTER TABLE "enrichment_automation_runs" ALTER COLUMN "run_mode" SET DEFAULT ?',
      ["live"],
    )
    expect(knex.raw).toHaveBeenCalledWith(
      'ALTER TABLE "enrichment_automation_runs" ALTER COLUMN "run_mode" SET NOT NULL',
    )
  })

  it("drops run_mode constraints on rollback", async () => {
    const knex = buildKnex()

    await down(knex)

    expect(knex.raw).toHaveBeenCalledWith(
      'ALTER TABLE "enrichment_automations" ALTER COLUMN "run_mode" DROP NOT NULL',
    )
    expect(knex.raw).toHaveBeenCalledWith(
      'ALTER TABLE "enrichment_automations" ALTER COLUMN "run_mode" DROP DEFAULT',
    )
    expect(knex.raw).toHaveBeenCalledWith(
      'ALTER TABLE "enrichment_automation_runs" ALTER COLUMN "run_mode" DROP NOT NULL',
    )
    expect(knex.raw).toHaveBeenCalledWith(
      'ALTER TABLE "enrichment_automation_runs" ALTER COLUMN "run_mode" DROP DEFAULT',
    )
  })
})
