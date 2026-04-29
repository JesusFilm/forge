import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { isDebugAllowedForOrigin } from "./hybrid-search-debug-allowlist"

const ORIGINAL_NODE_ENV = process.env.NODE_ENV
const ORIGINAL_ALLOWLIST = process.env.SEARCH_DEBUG_ALLOWED_ORIGINS

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV
  if (ORIGINAL_ALLOWLIST != null) {
    process.env.SEARCH_DEBUG_ALLOWED_ORIGINS = ORIGINAL_ALLOWLIST
  } else {
    delete process.env.SEARCH_DEBUG_ALLOWED_ORIGINS
  }
})

describe("isDebugAllowedForOrigin", () => {
  it("fails closed when origin is undefined", () => {
    expect(isDebugAllowedForOrigin(undefined)).toBe(false)
  })

  it("fails closed when origin is empty string", () => {
    expect(isDebugAllowedForOrigin("")).toBe(false)
  })

  it("uses explicit allowlist when SEARCH_DEBUG_ALLOWED_ORIGINS is set (production)", () => {
    process.env.NODE_ENV = "production"
    process.env.SEARCH_DEBUG_ALLOWED_ORIGINS =
      "https://staging.admin.jesusfilm.org, https://debug.admin.jesusfilm.org"
    expect(isDebugAllowedForOrigin("https://staging.admin.jesusfilm.org")).toBe(
      true,
    )
    expect(isDebugAllowedForOrigin("https://admin.jesusfilm.org")).toBe(false)
    expect(isDebugAllowedForOrigin("https://attacker.test")).toBe(false)
  })

  it("rejects all origins when explicit allowlist is set but does not include the origin (non-prod)", () => {
    process.env.NODE_ENV = "development"
    process.env.SEARCH_DEBUG_ALLOWED_ORIGINS = "https://staging.example"
    expect(isDebugAllowedForOrigin("http://localhost:3003")).toBe(false)
    expect(isDebugAllowedForOrigin("https://staging.example")).toBe(true)
  })

  it("falls back to non-production heuristic when allowlist env is unset", () => {
    delete process.env.SEARCH_DEBUG_ALLOWED_ORIGINS
    process.env.NODE_ENV = "development"
    expect(isDebugAllowedForOrigin("http://localhost:3003")).toBe(true)
    expect(isDebugAllowedForOrigin("https://preview.example")).toBe(true)
  })

  it("denies all origins in production when allowlist env is unset", () => {
    delete process.env.SEARCH_DEBUG_ALLOWED_ORIGINS
    process.env.NODE_ENV = "production"
    expect(isDebugAllowedForOrigin("https://admin.jesusfilm.org")).toBe(false)
  })

  it("treats whitespace-only allowlist as if unset (falls back to NODE_ENV)", () => {
    process.env.NODE_ENV = "development"
    process.env.SEARCH_DEBUG_ALLOWED_ORIGINS = "   "
    expect(isDebugAllowedForOrigin("http://localhost:3003")).toBe(true)
  })

  it("trims allowlist entries", () => {
    process.env.NODE_ENV = "production"
    process.env.SEARCH_DEBUG_ALLOWED_ORIGINS =
      "  https://staging.example  ,  https://debug.example  "
    expect(isDebugAllowedForOrigin("https://staging.example")).toBe(true)
    expect(isDebugAllowedForOrigin("https://debug.example")).toBe(true)
  })
})
