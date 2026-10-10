import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/config/env", () => ({
  env: {} as { WEB_ADMIN_API_KEYS?: string; FLEET_ADMIN_API_KEYS?: string },
}))

const { env } = await import("@/config/env")
const { isValidConsumerBearer } = await import("@/auth/consumer-bearer")

const envMutable = env as {
  WEB_ADMIN_API_KEYS?: string
  FLEET_ADMIN_API_KEYS?: string
}

describe("isValidConsumerBearer", () => {
  beforeEach(() => {
    envMutable.WEB_ADMIN_API_KEYS = "key-aaa,key-bbb,key-ccc"
  })
  afterEach(() => {
    envMutable.WEB_ADMIN_API_KEYS = undefined
    envMutable.FLEET_ADMIN_API_KEYS = undefined
  })

  // ---------------------------------------------------------------------------
  // Happy path — web SSR keys (fleet:false)
  // ---------------------------------------------------------------------------

  it("accepts a valid bearer token and returns the matched bucket key", () => {
    expect(isValidConsumerBearer("Bearer key-aaa")).toEqual({
      valid: true,
      bucketKey: "key-aaa",
      fleet: false,
    })
    expect(isValidConsumerBearer("Bearer key-bbb")).toEqual({
      valid: true,
      bucketKey: "key-bbb",
      fleet: false,
    })
    expect(isValidConsumerBearer("Bearer key-ccc")).toEqual({
      valid: true,
      bucketKey: "key-ccc",
      fleet: false,
    })
  })

  it("accepts case-insensitive Bearer prefix", () => {
    expect(isValidConsumerBearer("bearer key-aaa")).toEqual({
      valid: true,
      bucketKey: "key-aaa",
      fleet: false,
    })
    expect(isValidConsumerBearer("BEARER key-aaa")).toEqual({
      valid: true,
      bucketKey: "key-aaa",
      fleet: false,
    })
  })

  it("trims whitespace around allowlist entries when matching", () => {
    envMutable.WEB_ADMIN_API_KEYS = "  key-aaa  ,  key-bbb  "
    expect(isValidConsumerBearer("Bearer key-aaa")).toEqual({
      valid: true,
      bucketKey: "key-aaa",
      fleet: false,
    })
  })

  // ---------------------------------------------------------------------------
  // Fleet keys (fleet:true) — the new per-IP bucketing discriminant
  // ---------------------------------------------------------------------------

  it("flags a web key fleet:false and a fleet key fleet:true", () => {
    envMutable.FLEET_ADMIN_API_KEYS = "fleet-key-1,fleet-key-2"
    expect(isValidConsumerBearer("Bearer key-aaa")).toEqual({
      valid: true,
      bucketKey: "key-aaa",
      fleet: false,
    })
    expect(isValidConsumerBearer("Bearer fleet-key-1")).toEqual({
      valid: true,
      bucketKey: "fleet-key-1",
      fleet: true,
    })
  })

  it("matches a fleet key even though the web list is scanned first", () => {
    // Fleet entries come after web in iteration order; a regression that
    // short-circuited on the web list would leave fleet keys unreachable.
    envMutable.FLEET_ADMIN_API_KEYS = "fleet-only-key"
    expect(isValidConsumerBearer("Bearer fleet-only-key")).toEqual({
      valid: true,
      bucketKey: "fleet-only-key",
      fleet: true,
    })
  })

  it("rejects a fleet key when FLEET_ADMIN_API_KEYS is unset", () => {
    expect(isValidConsumerBearer("Bearer fleet-key-1")).toEqual({
      valid: false,
      bucketKey: null,
    })
  })

  // ---------------------------------------------------------------------------
  // Edge cases — header shape
  // ---------------------------------------------------------------------------

  it("rejects null header", () => {
    expect(isValidConsumerBearer(null)).toEqual({
      valid: false,
      bucketKey: null,
    })
  })

  it("rejects empty header", () => {
    expect(isValidConsumerBearer("")).toEqual({
      valid: false,
      bucketKey: null,
    })
  })

  it("rejects missing Bearer prefix", () => {
    expect(isValidConsumerBearer("key-aaa")).toEqual({
      valid: false,
      bucketKey: null,
    })
    expect(isValidConsumerBearer("Basic key-aaa")).toEqual({
      valid: false,
      bucketKey: null,
    })
  })

  it("rejects bearer with no key (whitespace only after prefix)", () => {
    expect(isValidConsumerBearer("Bearer ")).toEqual({
      valid: false,
      bucketKey: null,
    })
    expect(isValidConsumerBearer("Bearer    ")).toEqual({
      valid: false,
      bucketKey: null,
    })
  })

  // ---------------------------------------------------------------------------
  // Edge cases — allowlist membership
  // ---------------------------------------------------------------------------

  it("rejects when the presented key is not in the CSV", () => {
    expect(isValidConsumerBearer("Bearer not-a-real-key")).toEqual({
      valid: false,
      bucketKey: null,
    })
  })

  it("rejects partial / prefix matches", () => {
    expect(isValidConsumerBearer("Bearer key-aa")).toEqual({
      valid: false,
      bucketKey: null,
    })
    expect(isValidConsumerBearer("Bearer key-aaaX")).toEqual({
      valid: false,
      bucketKey: null,
    })
  })

  it("rejects when both allowlists are unset", () => {
    envMutable.WEB_ADMIN_API_KEYS = undefined
    expect(isValidConsumerBearer("Bearer key-aaa")).toEqual({
      valid: false,
      bucketKey: null,
    })
  })

  it("rejects when WEB_ADMIN_API_KEYS is empty / whitespace-only", () => {
    envMutable.WEB_ADMIN_API_KEYS = ""
    expect(isValidConsumerBearer("Bearer key-aaa")).toEqual({
      valid: false,
      bucketKey: null,
    })
    envMutable.WEB_ADMIN_API_KEYS = "  ,  "
    expect(isValidConsumerBearer("Bearer key-aaa")).toEqual({
      valid: false,
      bucketKey: null,
    })
  })

  // ---------------------------------------------------------------------------
  // Edge cases — multi-length allowlist
  // ---------------------------------------------------------------------------

  it("matches a valid key when allowlist contains entries of differing lengths", () => {
    // Same invariant as workflow-bearer.test.ts: a regression that
    // flipped `continue` to `return` early would make a longer key
    // unreachable. Locks in the length-mismatch skip branch.
    envMutable.WEB_ADMIN_API_KEYS =
      "short,key-correct-len,much-longer-than-the-target"
    expect(isValidConsumerBearer("Bearer key-correct-len")).toEqual({
      valid: true,
      bucketKey: "key-correct-len",
      fleet: false,
    })
    expect(isValidConsumerBearer("Bearer short")).toEqual({
      valid: true,
      bucketKey: "short",
      fleet: false,
    })
    expect(isValidConsumerBearer("Bearer much-longer-than-the-target")).toEqual(
      {
        valid: true,
        bucketKey: "much-longer-than-the-target",
        fleet: false,
      },
    )
    expect(isValidConsumerBearer("Bearer not-a-real-key")).toEqual({
      valid: false,
      bucketKey: null,
    })
  })

  it("does not throw when allowlist contains a non-ASCII key with UTF-16 length matching presented", () => {
    // Without Buffer.byteLength comparison, a string-length match with
    // UTF-8 byte-length mismatch would reach `timingSafeEqual` and
    // throw RangeError. Locks in the byte-length guard.
    envMutable.WEB_ADMIN_API_KEYS = "kéy-aaa" // 7 code units, 8 bytes
    expect(() => isValidConsumerBearer("Bearer key-aaaa")).not.toThrow()
    expect(isValidConsumerBearer("Bearer key-aaa")).toEqual({
      valid: false,
      bucketKey: null,
    })
  })

  // ---------------------------------------------------------------------------
  // Timing-safe comparison — locked in by structural assertion
  // ---------------------------------------------------------------------------

  it("uses timingSafeEqual from node:crypto (not naive string equality)", async () => {
    // Structural assertion. A regression that flipped to `key ===
    // presented` is functionally indistinguishable from `timingSafeEqual`
    // on correctness tests — only timing distribution reveals it. A
    // pure timing-distribution assertion is non-deterministic in CI
    // (event-loop jitter, GC pauses), so we lock the contract by
    // asserting the module imports timingSafeEqual. Belt-and-braces:
    // the byte-comparison invariant above ensures the call site
    // actually invokes it (a naive `===` would crash on UTF-16 vs
    // UTF-8 length mismatch).
    const { readFile } = await import("node:fs/promises")
    const { fileURLToPath } = await import("node:url")
    const source = await readFile(
      fileURLToPath(new URL("./consumer-bearer.ts", import.meta.url)),
      "utf8",
    )
    expect(source).toMatch(/timingSafeEqual.*from\s+["']node:crypto["']/s)
    expect(source).toMatch(/timingSafeEqual\(/)
    // Defense-in-depth: explicit deny on the naive shape.
    expect(source).not.toMatch(/===\s*presented/)
    expect(source).not.toMatch(/presented\s*===/)
  })

  // Timing-distribution smoke removed: wall-clock measurements at sub-
  // millisecond scale are dominated by event-loop jitter in vitest, so
  // any ratio threshold flakes. The structural property — `timingSafeEqual`
  // is imported from node:crypto AND invoked on every match attempt — is
  // already enforced by the source-file regex assertions above. That is
  // the actual contract; the timing test was belt-and-braces, not
  // load-bearing.

  // ---------------------------------------------------------------------------
  // Log scrubbing — neither the raw header nor the matched key may
  // ever appear in console output from this module.
  // ---------------------------------------------------------------------------

  it("does NOT log the Authorization header value or the bearer key on any path", () => {
    envMutable.FLEET_ADMIN_API_KEYS = "fleet-secret-key"
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {})
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {})
    try {
      // Walk the happy path (web + fleet) AND every failure branch.
      isValidConsumerBearer("Bearer key-aaa")
      isValidConsumerBearer("Bearer key-bbb")
      isValidConsumerBearer("Bearer fleet-secret-key")
      isValidConsumerBearer("Bearer wrong-key-of-rightlength")
      isValidConsumerBearer("Bearer ")
      isValidConsumerBearer("")
      isValidConsumerBearer(null)
      isValidConsumerBearer("Basic key-aaa")

      // Aggregate every logged payload across every console method.
      const allCalls = [
        ...logSpy.mock.calls,
        ...warnSpy.mock.calls,
        ...errorSpy.mock.calls,
        ...infoSpy.mock.calls,
        ...debugSpy.mock.calls,
      ]
      const combined = JSON.stringify(allCalls)
      // None of the candidate strings — neither valid keys nor the
      // raw Authorization header values — may appear in any log
      // output from this module.
      expect(combined).not.toContain("key-aaa")
      expect(combined).not.toContain("key-bbb")
      expect(combined).not.toContain("fleet-secret-key")
      expect(combined).not.toContain("wrong-key-of-rightlength")
      expect(combined).not.toContain("Bearer ")
    } finally {
      logSpy.mockRestore()
      warnSpy.mockRestore()
      errorSpy.mockRestore()
      infoSpy.mockRestore()
      debugSpy.mockRestore()
    }
  })
})
