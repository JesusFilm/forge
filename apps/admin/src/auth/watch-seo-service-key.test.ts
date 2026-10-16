import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/config/env", () => ({
  env: {} as {
    WATCH_SEO_API_KEYS?: string
    WEB_ADMIN_API_KEYS?: string
  },
}))

const { env } = await import("@/config/env")
const { isValidWatchSeoServiceKey, isWatchSeoServiceKeyConfigured } =
  await import("@/auth/watch-seo-service-key")

const mutable = env as {
  WATCH_SEO_API_KEYS?: string
  WEB_ADMIN_API_KEYS?: string
}

describe("isValidWatchSeoServiceKey", () => {
  beforeEach(() => {
    mutable.WATCH_SEO_API_KEYS = "seo-a, seo-b"
    mutable.WEB_ADMIN_API_KEYS = "web-consumer"
  })

  afterEach(() => {
    mutable.WATCH_SEO_API_KEYS = undefined
    mutable.WEB_ADMIN_API_KEYS = undefined
  })

  it("accepts a key from the dedicated list, trimming entries", () => {
    expect(isValidWatchSeoServiceKey("Bearer seo-a")).toBe(true)
    expect(isValidWatchSeoServiceKey("bearer seo-b")).toBe(true)
  })

  it("never accepts the Web consumer bearer", () => {
    expect(isValidWatchSeoServiceKey("Bearer web-consumer")).toBe(false)
  })

  it("rejects wrong schemes, partial keys, and empty headers", () => {
    expect(isValidWatchSeoServiceKey(null)).toBe(false)
    expect(isValidWatchSeoServiceKey("Bearer ")).toBe(false)
    expect(isValidWatchSeoServiceKey("seo-a")).toBe(false)
    expect(isValidWatchSeoServiceKey("Basic seo-a")).toBe(false)
    expect(isValidWatchSeoServiceKey("Bearer seo")).toBe(false)
    expect(isValidWatchSeoServiceKey("Bearer seo-a-extra")).toBe(false)
  })

  it("fails closed when the list is unset or blank", () => {
    mutable.WATCH_SEO_API_KEYS = undefined
    expect(isWatchSeoServiceKeyConfigured()).toBe(false)
    expect(isValidWatchSeoServiceKey("Bearer seo-a")).toBe(false)
    mutable.WATCH_SEO_API_KEYS = " , "
    expect(isWatchSeoServiceKeyConfigured()).toBe(false)
    expect(isValidWatchSeoServiceKey("Bearer ")).toBe(false)
  })

  it("does not throw on multibyte keys of differing byte length", () => {
    mutable.WATCH_SEO_API_KEYS = "kéy-aaa"
    expect(() => isValidWatchSeoServiceKey("Bearer key-aaaa")).not.toThrow()
    expect(isValidWatchSeoServiceKey("Bearer kéy-aaa")).toBe(true)
  })
})
