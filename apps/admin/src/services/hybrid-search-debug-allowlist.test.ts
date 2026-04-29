import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { isDebugAllowedForOrigin } from "./hybrid-search-debug-allowlist"

// `env.NODE_ENV` is readonly under Next.js's TS lib, but the
// runtime allows mutation. Cast through `Record<string,string|undefined>`
// to mutate without losing the readonly guard elsewhere.
const env = process.env as Record<string, string | undefined>

const ORIGINAL_NODE_ENV = env.NODE_ENV
const ORIGINAL_ALLOWLIST = env.SEARCH_DEBUG_ALLOWED_ORIGINS

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  env.NODE_ENV = ORIGINAL_NODE_ENV
  if (ORIGINAL_ALLOWLIST != null) {
    env.SEARCH_DEBUG_ALLOWED_ORIGINS = ORIGINAL_ALLOWLIST
  } else {
    delete env.SEARCH_DEBUG_ALLOWED_ORIGINS
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
    env.NODE_ENV = "production"
    env.SEARCH_DEBUG_ALLOWED_ORIGINS =
      "https://staging.admin.jesusfilm.org, https://debug.admin.jesusfilm.org"
    expect(isDebugAllowedForOrigin("https://staging.admin.jesusfilm.org")).toBe(
      true,
    )
    expect(isDebugAllowedForOrigin("https://admin.jesusfilm.org")).toBe(false)
    expect(isDebugAllowedForOrigin("https://attacker.test")).toBe(false)
  })

  it("rejects all origins when explicit allowlist is set but does not include the origin (non-prod)", () => {
    env.NODE_ENV = "development"
    env.SEARCH_DEBUG_ALLOWED_ORIGINS = "https://staging.example"
    expect(isDebugAllowedForOrigin("http://localhost:3003")).toBe(false)
    expect(isDebugAllowedForOrigin("https://staging.example")).toBe(true)
  })

  it("falls back to non-production heuristic when allowlist env is unset", () => {
    delete env.SEARCH_DEBUG_ALLOWED_ORIGINS
    env.NODE_ENV = "development"
    expect(isDebugAllowedForOrigin("http://localhost:3003")).toBe(true)
    expect(isDebugAllowedForOrigin("https://preview.example")).toBe(true)
  })

  it("denies all origins in production when allowlist env is unset", () => {
    delete env.SEARCH_DEBUG_ALLOWED_ORIGINS
    env.NODE_ENV = "production"
    expect(isDebugAllowedForOrigin("https://admin.jesusfilm.org")).toBe(false)
  })

  it("treats whitespace-only allowlist as if unset (falls back to NODE_ENV)", () => {
    env.NODE_ENV = "development"
    env.SEARCH_DEBUG_ALLOWED_ORIGINS = "   "
    expect(isDebugAllowedForOrigin("http://localhost:3003")).toBe(true)
  })

  it("trims allowlist entries", () => {
    env.NODE_ENV = "production"
    env.SEARCH_DEBUG_ALLOWED_ORIGINS =
      "  https://staging.example  ,  https://debug.example  "
    expect(isDebugAllowedForOrigin("https://staging.example")).toBe(true)
    expect(isDebugAllowedForOrigin("https://debug.example")).toBe(true)
  })
})
