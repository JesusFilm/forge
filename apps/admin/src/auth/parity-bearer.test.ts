import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/config/env", () => ({
  env: {} as { PARITY_API_KEYS?: string },
}))

const { env } = await import("@/config/env")
const { isValidParityBearer } = await import("@/auth/parity-bearer")

const envMutable = env as { PARITY_API_KEYS?: string }

describe("isValidParityBearer", () => {
  beforeEach(() => {
    envMutable.PARITY_API_KEYS = "parity-aaa,parity-bbb,parity-ccc"
  })
  afterEach(() => {
    envMutable.PARITY_API_KEYS = undefined
  })

  it("accepts a valid bearer token and returns the matched bucket key", () => {
    expect(isValidParityBearer("Bearer parity-aaa")).toEqual({
      valid: true,
      bucketKey: "parity-aaa",
    })
    expect(isValidParityBearer("Bearer parity-bbb")).toEqual({
      valid: true,
      bucketKey: "parity-bbb",
    })
  })

  it("accepts case-insensitive Bearer prefix", () => {
    expect(isValidParityBearer("bearer parity-aaa")).toEqual({
      valid: true,
      bucketKey: "parity-aaa",
    })
  })

  it("trims whitespace around allowlist entries when matching", () => {
    envMutable.PARITY_API_KEYS = "  parity-aaa  ,  parity-bbb  "
    expect(isValidParityBearer("Bearer parity-aaa")).toEqual({
      valid: true,
      bucketKey: "parity-aaa",
    })
  })

  it("rejects null / empty / wrong-prefix headers", () => {
    expect(isValidParityBearer(null)).toEqual({ valid: false, bucketKey: null })
    expect(isValidParityBearer("")).toEqual({ valid: false, bucketKey: null })
    expect(isValidParityBearer("parity-aaa")).toEqual({
      valid: false,
      bucketKey: null,
    })
    expect(isValidParityBearer("Basic parity-aaa")).toEqual({
      valid: false,
      bucketKey: null,
    })
  })

  it("rejects bearer with no key after prefix", () => {
    expect(isValidParityBearer("Bearer ")).toEqual({
      valid: false,
      bucketKey: null,
    })
  })

  it("rejects non-allowlisted and partial keys", () => {
    expect(isValidParityBearer("Bearer not-real")).toEqual({
      valid: false,
      bucketKey: null,
    })
    expect(isValidParityBearer("Bearer parity-aa")).toEqual({
      valid: false,
      bucketKey: null,
    })
    expect(isValidParityBearer("Bearer parity-aaaX")).toEqual({
      valid: false,
      bucketKey: null,
    })
  })

  it("rejects when PARITY_API_KEYS is unset or whitespace-only", () => {
    envMutable.PARITY_API_KEYS = undefined
    expect(isValidParityBearer("Bearer parity-aaa")).toEqual({
      valid: false,
      bucketKey: null,
    })
    envMutable.PARITY_API_KEYS = "  ,  "
    expect(isValidParityBearer("Bearer parity-aaa")).toEqual({
      valid: false,
      bucketKey: null,
    })
  })

  it("matches a valid key when allowlist contains entries of differing lengths", () => {
    envMutable.PARITY_API_KEYS = "short,parity-correct-len,much-longer-key-here"
    expect(isValidParityBearer("Bearer parity-correct-len")).toEqual({
      valid: true,
      bucketKey: "parity-correct-len",
    })
    expect(isValidParityBearer("Bearer short")).toEqual({
      valid: true,
      bucketKey: "short",
    })
    expect(isValidParityBearer("Bearer much-longer-key-here")).toEqual({
      valid: true,
      bucketKey: "much-longer-key-here",
    })
    expect(isValidParityBearer("Bearer not-real")).toEqual({
      valid: false,
      bucketKey: null,
    })
  })

  it("does not throw on non-ASCII allowlist entries (Buffer.byteLength guard)", () => {
    envMutable.PARITY_API_KEYS = "péy-aaa" // 7 code units, 8 bytes
    expect(() => isValidParityBearer("Bearer key-aaaa")).not.toThrow()
  })

  it("uses timingSafeEqual from node:crypto", async () => {
    const { readFile } = await import("node:fs/promises")
    const { fileURLToPath } = await import("node:url")
    const source = await readFile(
      fileURLToPath(new URL("./parity-bearer.ts", import.meta.url)),
      "utf8",
    )
    expect(source).toMatch(/timingSafeEqual.*from\s+["']node:crypto["']/s)
    expect(source).toMatch(/timingSafeEqual\(/)
    expect(source).not.toMatch(/===\s*presented/)
    expect(source).not.toMatch(/presented\s*===/)
  })

  it("does NOT log the Authorization header value or the bearer key on any path", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {})
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {})
    try {
      isValidParityBearer("Bearer parity-aaa")
      isValidParityBearer("Bearer wrong-key-of-rightlength")
      isValidParityBearer("Bearer ")
      isValidParityBearer(null)
      isValidParityBearer("Basic parity-aaa")

      const allCalls = [
        ...logSpy.mock.calls,
        ...warnSpy.mock.calls,
        ...errorSpy.mock.calls,
        ...infoSpy.mock.calls,
        ...debugSpy.mock.calls,
      ]
      const combined = JSON.stringify(allCalls)
      expect(combined).not.toContain("parity-aaa")
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
