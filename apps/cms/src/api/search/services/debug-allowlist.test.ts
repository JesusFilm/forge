import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { isDebugAllowedForOrigin } from "./debug-allowlist"

const SAVED_ENV: Record<string, string | undefined> = {}

beforeEach(() => {
  SAVED_ENV.SEARCH_DEBUG_ALLOWED_ORIGINS =
    process.env.SEARCH_DEBUG_ALLOWED_ORIGINS
  SAVED_ENV.NODE_ENV = process.env.NODE_ENV
})

afterEach(() => {
  if (SAVED_ENV.SEARCH_DEBUG_ALLOWED_ORIGINS == null) {
    delete process.env.SEARCH_DEBUG_ALLOWED_ORIGINS
  } else {
    process.env.SEARCH_DEBUG_ALLOWED_ORIGINS =
      SAVED_ENV.SEARCH_DEBUG_ALLOWED_ORIGINS
  }
  if (SAVED_ENV.NODE_ENV == null) {
    delete process.env.NODE_ENV
  } else {
    process.env.NODE_ENV = SAVED_ENV.NODE_ENV
  }
})

describe("isDebugAllowedForOrigin", () => {
  it("fails closed when origin is undefined", () => {
    process.env.NODE_ENV = "development"
    expect(isDebugAllowedForOrigin(undefined)).toBe(false)
  })

  it("fails closed when origin is empty string", () => {
    process.env.NODE_ENV = "development"
    expect(isDebugAllowedForOrigin("")).toBe(false)
  })

  it("allows any origin in non-production when no allowlist is configured", () => {
    delete process.env.SEARCH_DEBUG_ALLOWED_ORIGINS
    process.env.NODE_ENV = "development"
    expect(isDebugAllowedForOrigin("http://localhost:3000")).toBe(true)
    expect(isDebugAllowedForOrigin("https://staging.example.com")).toBe(true)
  })

  it("denies all origins in production when no allowlist is configured", () => {
    delete process.env.SEARCH_DEBUG_ALLOWED_ORIGINS
    process.env.NODE_ENV = "production"
    expect(isDebugAllowedForOrigin("http://localhost:3000")).toBe(false)
    expect(isDebugAllowedForOrigin("https://example.com")).toBe(false)
  })

  it("respects an explicit CSV allowlist when configured (production)", () => {
    process.env.SEARCH_DEBUG_ALLOWED_ORIGINS =
      "https://staging.example.com,http://localhost:3000"
    process.env.NODE_ENV = "production"

    expect(isDebugAllowedForOrigin("https://staging.example.com")).toBe(true)
    expect(isDebugAllowedForOrigin("http://localhost:3000")).toBe(true)
    expect(isDebugAllowedForOrigin("https://prod.example.com")).toBe(false)
  })

  it("respects an explicit allowlist even in development (allowlist always wins)", () => {
    process.env.SEARCH_DEBUG_ALLOWED_ORIGINS = "https://staging.example.com"
    process.env.NODE_ENV = "development"

    // Dev would normally allow everything, but the explicit allowlist
    // tightens that — useful for tightening a deployed staging
    // environment.
    expect(isDebugAllowedForOrigin("https://staging.example.com")).toBe(true)
    expect(isDebugAllowedForOrigin("http://localhost:3000")).toBe(false)
  })

  it("treats whitespace-only allowlist as unset (falls back to NODE_ENV check)", () => {
    process.env.SEARCH_DEBUG_ALLOWED_ORIGINS = "   "
    process.env.NODE_ENV = "production"
    expect(isDebugAllowedForOrigin("https://example.com")).toBe(false)

    process.env.NODE_ENV = "development"
    expect(isDebugAllowedForOrigin("https://example.com")).toBe(true)
  })
})
