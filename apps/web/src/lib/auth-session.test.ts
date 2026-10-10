/**
 * @vitest-environment node
 */

import { afterEach, describe, expect, it, vi } from "vitest"

async function importAuthSession() {
  vi.resetModules()
  vi.stubEnv("ADMIN_GRAPHQL_URL", "https://admin.example.test/graphql")
  vi.stubEnv("WEB_ADMIN_API_KEYS", "test-key")
  return import("./auth-session")
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("resolveAuthBaseURL", () => {
  it("defaults to the production Auth service in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("WEB_AUTH_BASE_URL", "")

    const { resolveAuthBaseURL } = await importAuthSession()

    expect(resolveAuthBaseURL()?.toString()).toBe("https://auth.jesusfilm.org/")
  })

  it("rejects localhost Auth URLs in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("WEB_AUTH_BASE_URL", "http://localhost:3004")

    const { resolveAuthBaseURL } = await importAuthSession()

    expect(resolveAuthBaseURL()).toBeNull()
  })
})
