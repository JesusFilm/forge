import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import {
  assertLivePolicyRecoveryIdentity,
  LIVE_POLICY_MIGRATION,
  MigrationRecoveryError,
} from "./live-policy-migration-recovery"

describe("live-policy migration recovery identity", () => {
  const sql = "the exact reviewed migration bytes"
  const failed = {
    migration_name: LIVE_POLICY_MIGRATION,
    checksum: createHash("sha256").update(sql).digest("hex"),
  }
  it("permits only one failed attempt of the exact file", () => {
    expect(() => assertLivePolicyRecoveryIdentity([failed], sql)).not.toThrow()
    for (const rows of [
      [],
      [failed, failed],
      [{ ...failed, migration_name: "other" }],
      [{ ...failed, checksum: "a".repeat(64) }],
    ])
      expect(() => assertLivePolicyRecoveryIdentity(rows, sql)).toThrow(
        MigrationRecoveryError,
      )
    expect(() =>
      assertLivePolicyRecoveryIdentity([failed], sql + "\n"),
    ).toThrow("identity does not match")
  })
})
