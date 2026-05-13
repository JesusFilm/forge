import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: { FORGE_CONTENT_API: "strapi" as string | undefined },
}))

vi.mock("@/env", () => ({
  env: mockEnv,
}))

describe("normalizeContentApiMode", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  // ---------------------------------------------------------------------------
  // Active modes (plan-003 R3 closed set)
  // ---------------------------------------------------------------------------

  it("returns 'strapi' for strapi input", async () => {
    const { normalizeContentApiMode } = await import("./content-api-mode")
    expect(normalizeContentApiMode("strapi")).toBe("strapi")
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it("returns 'admin' for admin input (NEW active mode in plan-003)", async () => {
    const { normalizeContentApiMode } = await import("./content-api-mode")
    expect(normalizeContentApiMode("admin")).toBe("admin")
    expect(warnSpy).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // Default-mode preservation (no warn on absent value)
  // ---------------------------------------------------------------------------

  it("returns 'strapi' for undefined without warning", async () => {
    const { normalizeContentApiMode } = await import("./content-api-mode")
    expect(normalizeContentApiMode(undefined)).toBe("strapi")
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it("returns 'strapi' for null without warning", async () => {
    const { normalizeContentApiMode } = await import("./content-api-mode")
    expect(normalizeContentApiMode(null)).toBe("strapi")
    expect(warnSpy).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // Legacy soft-removed modes (plan-003 U4 — stale Doppler configs warn-and-fall-back)
  // ---------------------------------------------------------------------------

  it("soft-removes 'dual-read' (legacy U5 canary) — falls back to 'strapi' with explicit soft-removed warn", async () => {
    const { normalizeContentApiMode } = await import("./content-api-mode")
    expect(normalizeContentApiMode("dual-read")).toBe("strapi")
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/dual-read/)
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/soft-removed/)
  })

  it("soft-removes 'admin-with-fallback' (legacy R7 spec value) — falls back to 'strapi' with explicit soft-removed warn", async () => {
    const { normalizeContentApiMode } = await import("./content-api-mode")
    expect(normalizeContentApiMode("admin-with-fallback")).toBe("strapi")
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/admin-with-fallback/)
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/soft-removed/)
  })

  // ---------------------------------------------------------------------------
  // Unknown / typo path (visible warn, fall back to strapi)
  // ---------------------------------------------------------------------------

  it("falls back to 'strapi' and warns on wrong-case 'ADMIN' (not a recognized value)", async () => {
    const { normalizeContentApiMode } = await import("./content-api-mode")
    expect(normalizeContentApiMode("ADMIN")).toBe("strapi")
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/ADMIN/)
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/not a recognized value/)
  })

  it("falls back to 'strapi' and warns on garbage strings", async () => {
    const { normalizeContentApiMode } = await import("./content-api-mode")
    expect(normalizeContentApiMode("garbage")).toBe("strapi")
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/garbage/)
  })

  it("falls back to 'strapi' and warns on non-string types (number)", async () => {
    const { normalizeContentApiMode } = await import("./content-api-mode")
    expect(normalizeContentApiMode(42)).toBe("strapi")
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/non-string value \(number\)/)
  })

  it("falls back to 'strapi' and warns on non-string types (object)", async () => {
    const { normalizeContentApiMode } = await import("./content-api-mode")
    expect(normalizeContentApiMode({})).toBe("strapi")
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/non-string value \(object\)/)
  })

  // ---------------------------------------------------------------------------
  // Warn-message differentiation: legacy soft-removed vs unknown
  // ---------------------------------------------------------------------------
  //
  // Operators reading logs can distinguish "I need to update my Doppler
  // config from a previously-valid value" (soft-removed) from "I have a
  // typo or unknown value" (not-recognized). The warn messages carry
  // different identifiers; the regression contract is that both still
  // fall back to "strapi" so the user-facing render keeps working.

  it("legacy soft-removed warn explicitly differentiates from unknown-value warn", async () => {
    const { normalizeContentApiMode } = await import("./content-api-mode")
    normalizeContentApiMode("dual-read")
    const softRemovedMsg = warnSpy.mock.calls[0]?.[0] as string
    warnSpy.mockClear()
    normalizeContentApiMode("garbage")
    const unknownMsg = warnSpy.mock.calls[0]?.[0] as string
    expect(softRemovedMsg).toMatch(/soft-removed/)
    expect(unknownMsg).not.toMatch(/soft-removed/)
    expect(unknownMsg).toMatch(/not a recognized value/)
  })
})

describe("getContentApiMode", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
    vi.resetModules()
    mockEnv.FORGE_CONTENT_API = "strapi"
  })

  it("returns 'strapi' when env.FORGE_CONTENT_API is 'strapi'", async () => {
    mockEnv.FORGE_CONTENT_API = "strapi"
    const { getContentApiMode } = await import("./content-api-mode")
    expect(getContentApiMode()).toBe("strapi")
  })

  it("returns 'admin' when env.FORGE_CONTENT_API is 'admin'", async () => {
    mockEnv.FORGE_CONTENT_API = "admin"
    const { getContentApiMode } = await import("./content-api-mode")
    expect(getContentApiMode()).toBe("admin")
  })

  // env.ts admits the four historical values at the schema level so an
  // operator with a stale Doppler config doesn't brick boot. The runtime
  // narrower coerces legacy values to "strapi" with a visible warn.
  it("soft-removes env.FORGE_CONTENT_API='dual-read' (legacy U5 canary) — getContentApiMode() returns 'strapi' with warn", async () => {
    mockEnv.FORGE_CONTENT_API = "dual-read"
    const { getContentApiMode } = await import("./content-api-mode")
    expect(getContentApiMode()).toBe("strapi")
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/dual-read/)
  })

  it("soft-removes env.FORGE_CONTENT_API='admin-with-fallback' (legacy R7 spec) — returns 'strapi' with warn", async () => {
    mockEnv.FORGE_CONTENT_API = "admin-with-fallback"
    const { getContentApiMode } = await import("./content-api-mode")
    expect(getContentApiMode()).toBe("strapi")
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/admin-with-fallback/)
  })

  it("caches the mode at module-import time and returns the same value across calls", async () => {
    mockEnv.FORGE_CONTENT_API = "admin"
    const { getContentApiMode } = await import("./content-api-mode")
    const first = getContentApiMode()
    // Mutate the underlying env value AFTER module import — should NOT
    // affect subsequent reads, because the value is captured at import time.
    mockEnv.FORGE_CONTENT_API = "strapi"
    const second = getContentApiMode()
    expect(first).toBe("admin")
    expect(second).toBe("admin")
  })
})
