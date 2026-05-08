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

  it("returns 'strapi' for strapi input", async () => {
    const { normalizeContentApiMode } = await import("./content-api-mode")
    expect(normalizeContentApiMode("strapi")).toBe("strapi")
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it("returns 'dual-read' for dual-read input", async () => {
    const { normalizeContentApiMode } = await import("./content-api-mode")
    expect(normalizeContentApiMode("dual-read")).toBe("dual-read")
    expect(warnSpy).not.toHaveBeenCalled()
  })

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

  it("falls back to 'strapi' and warns on wrong-case 'DUAL-READ'", async () => {
    const { normalizeContentApiMode } = await import("./content-api-mode")
    expect(normalizeContentApiMode("DUAL-READ")).toBe("strapi")
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/FORGE_CONTENT_API="DUAL-READ"/)
  })

  it("falls back to 'strapi' and warns on U5b value 'admin'", async () => {
    const { normalizeContentApiMode } = await import("./content-api-mode")
    expect(normalizeContentApiMode("admin")).toBe("strapi")
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/FORGE_CONTENT_API="admin"/)
  })

  it("falls back to 'strapi' and warns on U5b value 'admin-with-fallback'", async () => {
    const { normalizeContentApiMode } = await import("./content-api-mode")
    expect(normalizeContentApiMode("admin-with-fallback")).toBe("strapi")
    expect(warnSpy).toHaveBeenCalledTimes(1)
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

  it("returns 'dual-read' when env.FORGE_CONTENT_API is 'dual-read'", async () => {
    mockEnv.FORGE_CONTENT_API = "dual-read"
    const { getContentApiMode } = await import("./content-api-mode")
    expect(getContentApiMode()).toBe("dual-read")
  })

  // env.ts widens FORGE_CONTENT_API to accept all four origin-R7 values
  // so an operator pre-setting a U5b value doesn't brick boot. The
  // runtime narrower (normalizeContentApiMode) coerces U5b values to
  // "strapi" with a warn until U5b ships admin-mode rendering.
  it("returns 'strapi' (with warn) when env.FORGE_CONTENT_API is 'admin-with-fallback' (U5b value)", async () => {
    mockEnv.FORGE_CONTENT_API = "admin-with-fallback"
    const { getContentApiMode } = await import("./content-api-mode")
    expect(getContentApiMode()).toBe("strapi")
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/admin-with-fallback/)
  })

  it("returns 'strapi' (with warn) when env.FORGE_CONTENT_API is 'admin' (U5b value)", async () => {
    mockEnv.FORGE_CONTENT_API = "admin"
    const { getContentApiMode } = await import("./content-api-mode")
    expect(getContentApiMode()).toBe("strapi")
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/FORGE_CONTENT_API="admin"/)
  })

  it("caches the mode at module-import time and returns the same value across calls", async () => {
    mockEnv.FORGE_CONTENT_API = "dual-read"
    const { getContentApiMode } = await import("./content-api-mode")
    const first = getContentApiMode()
    // Mutate the underlying env value AFTER module import — should NOT
    // affect subsequent reads, because the value is captured at import time.
    mockEnv.FORGE_CONTENT_API = "strapi"
    const second = getContentApiMode()
    expect(first).toBe("dual-read")
    expect(second).toBe("dual-read")
  })
})
