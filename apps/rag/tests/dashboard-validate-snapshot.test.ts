import { describe, expect, it } from "vitest"
import { validateDashboardSnapshot } from "../scripts/dashboard-validate-snapshot.js"
import { requireProductionDashboardTarget } from "../scripts/dashboard-data.js"

const valid = {
  schema_version: 1,
  target: "production-read",
  fetched_at: "2026-08-07T12:00:00.000Z",
  source_commit: "0123456789abcdef0123456789abcdef01234567",
  schema_digest:
    "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  ingested: [],
  acquired_keys: [],
  unclassified: [],
}

describe("dashboard production snapshot validation", () => {
  it("accepts the strict data-only shape", () => {
    expect(() => validateDashboardSnapshot(JSON.stringify(valid))).not.toThrow()
  })

  it.each([
    ["unexpected credential field", { ...valid, password: "hidden" }],
    [
      "connection string in an expected field",
      { ...valid, acquired_keys: ["postgres://user:pass@host/db"] },
    ],
  ])("rejects %s", (_name, value) => {
    expect(() => validateDashboardSnapshot(JSON.stringify(value))).toThrow()
  })
})

describe("dashboard production target", () => {
  const env = {
    JFRAG_POSTGRESQL_DB_URL: "postgresql://reader:redacted@prod.example/rag",
    JFRAG_EXPECTED_POSTGRES_HOST: "prod.example",
  }

  it("requires the explicit production-read target and namespaced credential", () => {
    expect(() => requireProductionDashboardTarget([], env)).toThrow(
      /production-read/,
    )
    expect(() =>
      requireProductionDashboardTarget(["--target", "production-read"], {}),
    ).toThrow(/incomplete/)
  })

  it("rejects a mismatched host without exposing the URL", () => {
    expect(() =>
      requireProductionDashboardTarget(["--target", "production-read"], {
        ...env,
        JFRAG_EXPECTED_POSTGRES_HOST: "other.example",
      }),
    ).toThrow(/approved host/)
  })
})
