import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/config/env", () => ({
  env: {} as {
    SEARCH_API_KEYS?: string
    WEB_ADMIN_API_KEYS?: string
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
}))

const { env } = await import("@/config/env")
const { verifyPartnerToken } =
  await import("@/services/partner-api-key.service")
const { isValidSearchBearer, isAnyKnownBearer } =
  await import("@/auth/search-bearer")

const envMutable = env as {
  SEARCH_API_KEYS?: string
  WEB_ADMIN_API_KEYS?: string
  WORKFLOW_API_KEYS?: string
  BACKUP_DOWNLOAD_API_KEYS?: string
}

const verifyPartnerTokenMock = verifyPartnerToken as ReturnType<typeof vi.fn>

describe("isValidSearchBearer", () => {
  beforeEach(() => {
    envMutable.SEARCH_API_KEYS = "key-aaa,key-bbb,key-ccc"
  })
  afterEach(() => {
    envMutable.SEARCH_API_KEYS = undefined
  })

  it("accepts a valid bearer token matching any allowlisted key", () => {
    expect(isValidSearchBearer("Bearer key-aaa")).toBe(true)
    expect(isValidSearchBearer("Bearer key-bbb")).toBe(true)
    expect(isValidSearchBearer("Bearer key-ccc")).toBe(true)
  })

  it("accepts case-insensitive Bearer prefix", () => {
    expect(isValidSearchBearer("bearer key-aaa")).toBe(true)
    expect(isValidSearchBearer("BEARER key-aaa")).toBe(true)
  })

  it("rejects an unknown key", () => {
    expect(isValidSearchBearer("Bearer not-a-real-key")).toBe(false)
  })

  it("rejects null / empty headers", () => {
    expect(isValidSearchBearer(null)).toBe(false)
    expect(isValidSearchBearer("")).toBe(false)
    expect(isValidSearchBearer("Bearer ")).toBe(false)
  })

  it("rejects non-Bearer schemes", () => {
    expect(isValidSearchBearer("Basic key-aaa")).toBe(false)
    expect(isValidSearchBearer("key-aaa")).toBe(false)
  })

  it("rejects bearer with no key (whitespace only)", () => {
    expect(isValidSearchBearer("Bearer    ")).toBe(false)
  })

  it("rejects when SEARCH_API_KEYS is unset", () => {
    envMutable.SEARCH_API_KEYS = undefined
    expect(isValidSearchBearer("Bearer key-aaa")).toBe(false)
  })

  it("rejects when SEARCH_API_KEYS is empty / whitespace-only", () => {
    envMutable.SEARCH_API_KEYS = ""
    expect(isValidSearchBearer("Bearer key-aaa")).toBe(false)
    envMutable.SEARCH_API_KEYS = "  ,  "
    expect(isValidSearchBearer("Bearer key-aaa")).toBe(false)
  })

  it("trims whitespace around allowlist entries", () => {
    envMutable.SEARCH_API_KEYS = "  key-aaa  ,  key-bbb  "
    expect(isValidSearchBearer("Bearer key-aaa")).toBe(true)
    expect(isValidSearchBearer("Bearer key-bbb")).toBe(true)
  })

  it("rejects partial / prefix matches", () => {
    expect(isValidSearchBearer("Bearer key-aa")).toBe(false)
    expect(isValidSearchBearer("Bearer key-aaaX")).toBe(false)
  })

  it("matches a valid key when allowlist contains entries of differing lengths", () => {
    // Locks in the length-mismatch skip branch in search-bearer.ts:
    // a regression that flipped `continue` to `return` early would
    // make this test fail because `key-correct-len` would be skipped
    // before being reached.
    envMutable.SEARCH_API_KEYS =
      "short,key-correct-len,much-longer-than-the-target"
    expect(isValidSearchBearer("Bearer key-correct-len")).toBe(true)
    expect(isValidSearchBearer("Bearer short")).toBe(true)
    expect(isValidSearchBearer("Bearer much-longer-than-the-target")).toBe(true)
    expect(isValidSearchBearer("Bearer not-a-real-key")).toBe(false)
  })

  it("does not throw when allowlist contains a non-ASCII key with UTF-16 length matching presented", () => {
    // Without Buffer.byteLength comparison, a string-length match with
    // UTF-8 byte-length mismatch would reach `timingSafeEqual` and
    // throw RangeError — which propagates out of the route handler /
    // resolver as a 500. Locks in the byte-length guard in
    // search-bearer.ts.
    envMutable.SEARCH_API_KEYS = "kéy-aaa" // 7 code units, 8 bytes
    expect(() => isValidSearchBearer("Bearer key-aaaa")).not.toThrow()
    // Same UTF-16 length (7) as the configured key but ASCII bytes;
    // length-mismatch guard now uses byte length, so this rejects
    // cleanly instead of crashing.
    expect(isValidSearchBearer("Bearer key-aaa")).toBe(false)
  })

  it("byte-length guard distinguishes from .length: UTF-8-byte-equal but UTF-16-unequal pair rejects without throw", () => {
    // CRITICAL test for the mocked-shape-vs-real-contract discipline.
    // The previous UTF-8 test only asserted "doesn't throw" — that
    // assertion holds equally well with String.length (no entry would
    // ever reach timingSafeEqual because UTF-16 lengths differ AND
    // UTF-8 byte lengths differ). To actually distinguish the
    // Buffer.byteLength branch from .length, we need an entry where
    // UTF-16 length DIFFERS from the presented value but UTF-8 byte
    // length MATCHES — so a .length implementation would skip
    // (mismatch) but a byte-length implementation would proceed into
    // timingSafeEqual (match-on-length, mismatch-on-content) and
    // return false. Both implementations behave identically here
    // (return false, don't throw), but only the byte-length one
    // exercises the timingSafeEqual call site for this input.
    //
    // 'kéy' = 3 UTF-16 code units, 4 UTF-8 bytes (é = 2 bytes).
    // 'keya' = 4 UTF-16 code units, 4 UTF-8 bytes.
    // String.length: 3 ≠ 4 → skip (timingSafeEqual never called).
    // Buffer.byteLength: 4 === 4 → call timingSafeEqual → mismatch → false.
    envMutable.SEARCH_API_KEYS = "kéy"
    expect(() => isValidSearchBearer("Bearer keya")).not.toThrow()
    expect(isValidSearchBearer("Bearer keya")).toBe(false)
    // The match-on-bytes case: 'kéy' presented against 'kéy' configured.
    // Both implementations match — this is the positive control.
    expect(isValidSearchBearer("Bearer kéy")).toBe(true)
  })

  it("ASYMMETRIC byte-length test: configured key with extra UTF-8 byte vs presented same UTF-16 length WOULD throw under .length but returns false under Buffer.byteLength", () => {
    // The PROPER mocked-shape-vs-real-contract test. The previous
    // UTF-8 cases admitted both implementations behave identically;
    // this one actually DIVERGES:
    //
    // configured 'kéy' = 3 UTF-16 code units, 4 UTF-8 bytes.
    // presented  'key' = 3 UTF-16 code units, 3 UTF-8 bytes.
    //
    // Under `.length` (3 === 3): proceeds to timingSafeEqual with
    // mismatched byte lengths → throws RangeError → crashes the
    // request as a 500.
    //
    // Under `Buffer.byteLength` (4 !== 3): skips the entry → returns
    // false cleanly.
    //
    // A regression flipping Buffer.byteLength back to .length would
    // make this `.not.toThrow()` assertion fail loudly. This is the
    // assertion that actually distinguishes the two implementations.
    envMutable.SEARCH_API_KEYS = "kéy"
    expect(() => isValidSearchBearer("Bearer key")).not.toThrow()
    expect(isValidSearchBearer("Bearer key")).toBe(false)
  })

  it("rejects an Authorization header exceeding MAX_BEARER_LENGTH (1024) without allocating the per-comparison Buffer", () => {
    // Defense-in-depth guard. Node's HTTP parser already caps total
    // header size around 8-16 KB, so this is mostly a contract-shape
    // assertion: a pathological 64KB Authorization header returns
    // false at the boundary without dropping into the per-key
    // Buffer.from allocation loop.
    envMutable.SEARCH_API_KEYS = "key-aaa"
    const huge = "Bearer " + "a".repeat(2048)
    expect(huge.length).toBeGreaterThan(1024)
    expect(isValidSearchBearer(huge)).toBe(false)
  })
})

describe("isAnyKnownBearer", () => {
  beforeEach(() => {
    envMutable.SEARCH_API_KEYS = "search-key-aaa"
    envMutable.WEB_ADMIN_API_KEYS = "consumer-key-bbb"
    envMutable.WORKFLOW_API_KEYS = "workflow-key-ccc"
    verifyPartnerTokenMock.mockReset()
    verifyPartnerTokenMock.mockResolvedValue({ valid: false })
  })

  afterEach(() => {
    envMutable.SEARCH_API_KEYS = undefined
    envMutable.WEB_ADMIN_API_KEYS = undefined
    envMutable.WORKFLOW_API_KEYS = undefined
  })

  it("accepts a SEARCH_API_KEYS bearer with source=search", async () => {
    await expect(isAnyKnownBearer("Bearer search-key-aaa")).resolves.toEqual({
      valid: true,
      source: "search",
    })
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

  it("PARTNER branch runs before env-CSV branches (dual-accept ordering)", async () => {
    // During the xoSP… migration window, the same plaintext can match
    // both the DB row AND the SEARCH_API_KEYS env CSV. Composer MUST
    // prefer the partner branch so logs surface keyId for the partner.
    envMutable.SEARCH_API_KEYS = "shared-plaintext"
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
    // verifyPartnerToken default mock returns { valid: false }; the
    // env-CSV `search` branch should still pick up search-key-aaa.
    await expect(isAnyKnownBearer("Bearer search-key-aaa")).resolves.toEqual({
      valid: true,
      source: "search",
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
    await expect(isAnyKnownBearer("Bearer ")).resolves.toEqual({ valid: false })
    await expect(isAnyKnownBearer("Basic search-key-aaa")).resolves.toEqual({
      valid: false,
    })
  })

  it("rejects when ALL CSVs are unset AND partner branch misses", async () => {
    envMutable.SEARCH_API_KEYS = undefined
    envMutable.WEB_ADMIN_API_KEYS = undefined
    envMutable.WORKFLOW_API_KEYS = undefined
    await expect(isAnyKnownBearer("Bearer search-key-aaa")).resolves.toEqual({
      valid: false,
    })
  })

  it("accepts a search key even when other CSVs are unset", async () => {
    envMutable.WEB_ADMIN_API_KEYS = undefined
    envMutable.WORKFLOW_API_KEYS = undefined
    await expect(isAnyKnownBearer("Bearer search-key-aaa")).resolves.toEqual({
      valid: true,
      source: "search",
    })
  })

  it("accepts a consumer key even when SEARCH + WORKFLOW are unset (proves the consumer OR clause)", async () => {
    envMutable.SEARCH_API_KEYS = undefined
    envMutable.WORKFLOW_API_KEYS = undefined
    await expect(isAnyKnownBearer("Bearer consumer-key-bbb")).resolves.toEqual({
      valid: true,
      source: "consumer",
    })
  })

  it("accepts a workflow key even when SEARCH + WEB_ADMIN are unset (proves the workflow OR clause)", async () => {
    envMutable.SEARCH_API_KEYS = undefined
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
    // Positive control: the four included sources still work.
    await expect(isAnyKnownBearer("Bearer search-key-aaa")).resolves.toEqual({
      valid: true,
      source: "search",
    })
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
      envMutable.SEARCH_API_KEYS = undefined
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
    envMutable.SEARCH_API_KEYS = undefined
    envMutable.WEB_ADMIN_API_KEYS = undefined
    envMutable.WORKFLOW_API_KEYS = undefined
    await expect(isAnyKnownBearer("Bearer anything")).resolves.toEqual({
      valid: false,
    })
    const warnedLines = warnSpy.mock.calls
      .map((args) => String(args[0] ?? ""))
      .filter((line) => line.includes("search_bearer.validator_threw"))
    expect(warnedLines.some((line) => line.includes('"partner"'))).toBe(true)
    warnSpy.mockRestore()
  })
})
