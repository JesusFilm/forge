import { describe, it } from "vitest"
import { env } from "@/config/env"
import { proveProfileVectorSnapshotMigration } from "./profile-vector-snapshot.native-helper"

// Retired publisher/reconciliation behavior is covered by behavioral-retirement
// and profile.service native suites. Keep the historical migration invariant
// until the stored generations and shared vector references are removed.
describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "profile vector snapshot migration",
  () => {
    it("preserves legacy rows and exact shared-vector retention invariants", async () => {
      await proveProfileVectorSnapshotMigration(env.DATABASE_URL)
    })
  },
)
