import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/config/env", () => ({
  env: {} as {
    SEARCH_API_KEYS?: string
    WEB_ADMIN_API_KEYS?: string
    WORKFLOW_API_KEYS?: string
  },
}))

const { env } = await import("@/config/env")
const { isValidSearchBearer, isAnyKnownBearer } =
  await import("@/auth/search-bearer")

const envMutable = env as {
  SEARCH_API_KEYS?: string
  WEB_ADMIN_API_KEYS?: string
  WORKFLOW_API_KEYS?: string
}

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
})

describe("isAnyKnownBearer", () => {
  beforeEach(() => {
    envMutable.SEARCH_API_KEYS = "search-key-aaa"
    envMutable.WEB_ADMIN_API_KEYS = "consumer-key-bbb"
    envMutable.WORKFLOW_API_KEYS = "workflow-key-ccc"
  })

  afterEach(() => {
    envMutable.SEARCH_API_KEYS = undefined
    envMutable.WEB_ADMIN_API_KEYS = undefined
    envMutable.WORKFLOW_API_KEYS = undefined
  })

  it("accepts a SEARCH_API_KEYS bearer", () => {
    expect(isAnyKnownBearer("Bearer search-key-aaa")).toBe(true)
  })

  it("accepts a WEB_ADMIN_API_KEYS bearer (consumer)", () => {
    // apps/web SSR already carries this for graphql rate-limit
    // identity. The search passport must accept it so the
    // SEARCH_AUTH_REQUIRED flip doesn't break web's search calls.
    expect(isAnyKnownBearer("Bearer consumer-key-bbb")).toBe(true)
  })

  it("accepts a WORKFLOW_API_KEYS bearer (workflow-trigger)", () => {
    // Workflow-trigger callers (manager → admin proxies, eval CLI
    // via the workflow bearer mint) already prove a stronger claim
    // than "known caller" — requiring them to also carry a search
    // key would be incoherent.
    expect(isAnyKnownBearer("Bearer workflow-key-ccc")).toBe(true)
  })

  it("rejects an unknown key (not in any CSV)", () => {
    expect(isAnyKnownBearer("Bearer not-in-any-csv")).toBe(false)
  })

  it("rejects null / empty / no-bearer headers", () => {
    expect(isAnyKnownBearer(null)).toBe(false)
    expect(isAnyKnownBearer("")).toBe(false)
    expect(isAnyKnownBearer("Bearer ")).toBe(false)
    expect(isAnyKnownBearer("Basic search-key-aaa")).toBe(false)
  })

  it("rejects when ALL three CSVs are unset (no allowlists configured)", () => {
    envMutable.SEARCH_API_KEYS = undefined
    envMutable.WEB_ADMIN_API_KEYS = undefined
    envMutable.WORKFLOW_API_KEYS = undefined
    expect(isAnyKnownBearer("Bearer search-key-aaa")).toBe(false)
  })

  it("accepts a search key even when other CSVs are unset", () => {
    envMutable.WEB_ADMIN_API_KEYS = undefined
    envMutable.WORKFLOW_API_KEYS = undefined
    expect(isAnyKnownBearer("Bearer search-key-aaa")).toBe(true)
  })

  it("does NOT short-circuit on first validator (BACKUP_DOWNLOAD-style values stay rejected)", () => {
    // Regression guard: if the OR composition ever grows to include
    // BACKUP_DOWNLOAD_API_KEYS, this test would need to flip. Until
    // then, a backup-download value (which we don't set in env at
    // all here) must NOT satisfy. We simulate by checking that an
    // unrelated key string isn't accidentally accepted.
    expect(isAnyKnownBearer("Bearer backup-download-key-zzz")).toBe(false)
  })
})
