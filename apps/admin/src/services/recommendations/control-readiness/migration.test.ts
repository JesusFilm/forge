import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const migration = readFileSync(
  new URL(
    "../../../../prisma/migrations/0057_semantic_control_readiness/migration.sql",
    import.meta.url,
  ),
  "utf8",
)

describe("semantic control readiness migration", () => {
  it("is additive, append-oriented, declared, and privacy-safe", () => {
    expect(migration).toContain(
      'CREATE TABLE "recommendation_control_evaluation"',
    )
    expect(migration).toContain("recommendation_control_evaluation_input_key")
    expect(migration).toContain(
      "recommendation_control_evaluation_revision_key",
    )
    expect(migration).toContain("ON DELETE SET NULL")
    expect(migration).toContain("semantic_control_readiness")
    expect(migration).toContain("aggregate_human_no_identity")
    expect(migration).toContain("recommendation_aggregate_readers")
    expect(migration).toContain("scheduled_expiry")
    expect(migration).toContain("last_known_semantic_control")
    expect(migration).toContain('"retention_days" INTEGER NOT NULL DEFAULT 365')
    expect(migration).toContain("Evaluation is entirely offline")
    expect(migration).not.toMatch(
      /DROP TABLE|DROP COLUMN|session_digest|profile_id/,
    )
  })
})
