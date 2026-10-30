import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import {
  assertLegacyStageRecoveryIdentity,
  LEGACY_STAGE_MIGRATION,
} from "./legacy-stage-migration-recovery"

describe("legacy stage recovery identity", () => {
  const sql = "exact immutable migration bytes"
  const identity = {
    migration_name: LEGACY_STAGE_MIGRATION,
    checksum: createHash("sha256").update(sql).digest("hex"),
  }
  it("accepts only the exact single migration", () => {
    expect(() =>
      assertLegacyStageRecoveryIdentity([identity], sql),
    ).not.toThrow()
    for (const rows of [
      [],
      [identity, identity],
      [{ ...identity, migration_name: "other" }],
      [{ ...identity, checksum: "changed" }],
    ])
      expect(() => assertLegacyStageRecoveryIdentity(rows, sql)).toThrow(
        "identity mismatch",
      )
    expect(() =>
      assertLegacyStageRecoveryIdentity([identity], sql + "\n"),
    ).toThrow("identity mismatch")
  })
})
