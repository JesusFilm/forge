import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/config/env", () => ({
  env: {} as {
    WEB_ADMIN_API_KEYS?: string
    FLEET_ADMIN_API_KEYS?: string
    WORKFLOW_API_KEYS?: string
    BACKUP_DOWNLOAD_API_KEYS?: string
  },
}))

// Stub the partner-key service so search-bearer tests don't need a
// real Prisma. Partner-branch behavior is exhaustively tested in
// `partner-api-key.service.test.ts`; here we only verify that the
// composer routes to it and surfaces `{ source: "partner", keyId }`.
vi.mock("@/services/partner-api-key.service", () => ({
  verifyPartnerToken: vi.fn(async () => ({ valid: false }) as const),
  sanitizeLogValue: (s: string) => s.replace(/[\r\n\t]/g, " ").slice(0, 200),
}))

const { env } = await import("@/config/env")
const { verifyPartnerToken } =
  await import("@/services/partner-api-key.service")
const { isAnyKnownBearer } = await import("@/auth/search-bearer")

const envMutable = env as {
  WEB_ADMIN_API_KEYS?: string
  FLEET_ADMIN_API_KEYS?: string
  WORKFLOW_API_KEYS?: string
  BACKUP_DOWNLOAD_API_KEYS?: string
}

const verifyPartnerTokenMock = verifyPartnerToken as ReturnType<typeof vi.fn>

describe("isAnyKnownBearer", () => {
  beforeEach(() => {
    envMutable.WEB_ADMIN_API_KEYS = "consumer-key-bbb"
    envMutable.WORKFLOW_API_KEYS = "workflow-key-ccc"
    verifyPartnerTokenMock.mockReset()
    verifyPartnerTokenMock.mockResolvedValue({ valid: false })
  })

  afterEach(() => {
    envMutable.WEB_ADMIN_API_KEYS = undefined
    envMutable.FLEET_ADMIN_API_KEYS = undefined
    envMutable.WORKFLOW_API_KEYS = undefined
  })

  it("accepts a WEB_ADMIN_API_KEYS bearer with source=consumer", async () => {
    // apps/web SSR already carries this for graphql rate-limit
    // identity. The search passport must accept it so the
    // SEARCH_AUTH_REQUIRED flip doesn't break web's search calls.
    await expect(isAnyKnownBearer("Bearer consumer-key-bbb")).resolves.toEqual({
      valid: true,
      source: "consumer",
    })
  })

  it("accepts a FLEET_ADMIN_API_KEYS bearer with source=fleet + a non-secret fleetKeyId", async () => {
    // The fleet key must pass the SEARCH_AUTH_REQUIRED gate (so TV/mobile
    // search returns 200) and carry a stable sha256-prefix fleetKeyId the global
    // ceiling buckets on — never the raw key (AE2, R4, security#5).
    envMutable.FLEET_ADMIN_API_KEYS = "fleet-key-zzz"
    const result = await isAnyKnownBearer("Bearer fleet-key-zzz")
    expect(result.valid).toBe(true)
    if (!result.valid) throw new Error("expected valid")
    expect(result.source).toBe("fleet")
    expect(result.fleetKeyId).toMatch(/^[0-9a-f]{12}$/)
    expect(result.fleetKeyId).not.toBe("fleet-key-zzz")
    expect(JSON.stringify(result)).not.toContain("fleet-key-zzz")
  })

  it("accepts a WORKFLOW_API_KEYS bearer with source=workflow", async () => {
    await expect(isAnyKnownBearer("Bearer workflow-key-ccc")).resolves.toEqual({
      valid: true,
      source: "workflow",
    })
  })

  it("accepts a DB-backed PARTNER token with source=partner + keyId", async () => {
    // The partner branch runs FIRST in the composer, so a stubbed
    // valid result wins over any env-CSV branch.
    verifyPartnerTokenMock.mockResolvedValueOnce({
      valid: true,
      keyId: "PartnerKey01",
    })
    const result = await isAnyKnownBearer(
      "Bearer jfp_search_PartnerKey01_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    )
    expect(result).toEqual({
      valid: true,
      source: "partner",
      keyId: "PartnerKey01",
    })
  })

  it("PARTNER branch runs before env-CSV branches", async () => {
    // A plaintext that ALSO matches an env-CSV entry MUST tag as
    // partner — the partner branch runs first so logs surface keyId.
    envMutable.WEB_ADMIN_API_KEYS = "shared-plaintext"
    verifyPartnerTokenMock.mockResolvedValueOnce({
      valid: true,
      keyId: "MigratedKey1",
    })
    const result = await isAnyKnownBearer("Bearer shared-plaintext")
    expect(result).toEqual({
      valid: true,
      source: "partner",
      keyId: "MigratedKey1",
    })
  })

  it("falls through to env-CSV when partner branch returns valid:false", async () => {
    await expect(isAnyKnownBearer("Bearer consumer-key-bbb")).resolves.toEqual({
      valid: true,
      source: "consumer",
    })
  })

  it("rejects an unknown key (not in any CSV, not in DB)", async () => {
    await expect(isAnyKnownBearer("Bearer not-in-any-csv")).resolves.toEqual({
      valid: false,
    })
  })

  it("rejects null / empty / no-bearer headers", async () => {
    await expect(isAnyKnownBearer(null)).resolves.toEqual({ valid: false })
    await expect(isAnyKnownBearer("")).resolves.toEqual({ valid: false })
    await expect(isAnyKnownBearer("Bearer ")).resolves.toEqual({
      valid: false,
    })
    await expect(isAnyKnownBearer("Basic consumer-key-bbb")).resolves.toEqual({
      valid: false,
    })
  })

  it("rejects when ALL CSVs are unset AND partner branch misses", async () => {
    envMutable.WEB_ADMIN_API_KEYS = undefined
    envMutable.WORKFLOW_API_KEYS = undefined
    await expect(isAnyKnownBearer("Bearer anything")).resolves.toEqual({
      valid: false,
    })
  })

  it("accepts a consumer key even when WORKFLOW is unset (proves the consumer OR clause)", async () => {
    envMutable.WORKFLOW_API_KEYS = undefined
    await expect(isAnyKnownBearer("Bearer consumer-key-bbb")).resolves.toEqual({
      valid: true,
      source: "consumer",
    })
  })

  it("accepts a workflow key even when WEB_ADMIN is unset (proves the workflow OR clause)", async () => {
    envMutable.WEB_ADMIN_API_KEYS = undefined
    await expect(isAnyKnownBearer("Bearer workflow-key-ccc")).resolves.toEqual({
      valid: true,
      source: "workflow",
    })
  })

  it("BACKUP_DOWNLOAD_API_KEYS values are REJECTED — the exclusion is actively asserted, not implicit", async () => {
    envMutable.BACKUP_DOWNLOAD_API_KEYS = "backup-key-zzz"
    await expect(isAnyKnownBearer("Bearer backup-key-zzz")).resolves.toEqual({
      valid: false,
    })
    // Positive controls: the three included sources still work.
    await expect(isAnyKnownBearer("Bearer consumer-key-bbb")).resolves.toEqual({
      valid: true,
      source: "consumer",
    })
    await expect(isAnyKnownBearer("Bearer workflow-key-ccc")).resolves.toEqual({
      valid: true,
      source: "workflow",
    })
  })

  it("returns valid:false when a sync composed validator throws (defense-in-depth try/catch)", async () => {
    const consumerModule = await import("@/auth/consumer-bearer")
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const spy = vi
      .spyOn(consumerModule, "isValidConsumerBearer")
      .mockImplementation(() => {
        throw new Error("synthetic-validator-failure")
      })
    try {
      envMutable.WORKFLOW_API_KEYS = undefined
      await expect(isAnyKnownBearer("Bearer anything")).resolves.toEqual({
        valid: false,
      })
      const warnedLines = warnSpy.mock.calls
        .map((args) => String(args[0] ?? ""))
        .filter((line) => line.includes("search_bearer.validator_threw"))
      expect(warnedLines.length).toBeGreaterThan(0)
      const allLogged = warnSpy.mock.calls
        .map((args) => String(args[0] ?? ""))
        .join("\n")
      expect(allLogged).not.toContain("Bearer anything")
    } finally {
      spy.mockRestore()
      warnSpy.mockRestore()
    }
  })

  it("returns valid:false when the async PARTNER validator throws (safeCheckAsync wrapper)", async () => {
    // safeCheckAsync must swallow async throws the same way safeCheck
    // swallows sync throws — otherwise a Prisma blowup converts to a
    // 500 on every search request.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    verifyPartnerTokenMock.mockRejectedValueOnce(
      new Error("synthetic-prisma-failure"),
    )
    envMutable.WEB_ADMIN_API_KEYS = undefined
    envMutable.WORKFLOW_API_KEYS = undefined
    await expect(isAnyKnownBearer("Bearer anything")).resolves.toEqual({
      valid: false,
    })
    const warnedLines = warnSpy.mock.calls
      .map((args) => String(args[0] ?? ""))
      .filter((line) => line.includes("search_bearer.validator_threw"))
    // Plain-string format: `validator=partner` (NOT JSON's `"partner"`).
    expect(warnedLines.some((line) => line.includes("validator=partner"))).toBe(
      true,
    )
    // Regression guard: ensure we never JSON-stringify these (Railway
    // logsV2 silences JSON payloads from runtime route handlers).
    expect(warnedLines.every((line) => !line.startsWith("{"))).toBe(true)
    warnSpy.mockRestore()
  })
})
