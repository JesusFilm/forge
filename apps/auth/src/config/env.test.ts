import { describe, expect, it, vi } from "vitest"

async function loadEnv() {
  vi.resetModules()
  return import("./env")
}

describe("auth env", () => {
  it("defaults auth base URL to localhost outside production", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("AUTH_BASE_URL", "")

    const { getAuthBaseUrl } = await loadEnv()

    expect(getAuthBaseUrl()).toBe("http://localhost:3004")
  })

  it("defaults auth base URL to production origin in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("AUTH_BASE_URL", "")
    vi.stubEnv("BETTER_AUTH_SECRET", "test-secret")

    const { getAuthBaseUrl } = await loadEnv()

    expect(getAuthBaseUrl()).toBe("https://auth.jesusfilm.org")
  })

  it("parses comma-separated trusted origins", async () => {
    vi.stubEnv(
      "AUTH_TRUSTED_ORIGINS",
      "https://admin.jesusfilm.org, http://localhost:3003 ,,",
    )

    const { getTrustedOrigins } = await loadEnv()

    expect(getTrustedOrigins()).toEqual([
      "https://admin.jesusfilm.org",
      "http://localhost:3003",
    ])
  })

  it("fails closed when the production runtime secret is missing", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXT_PHASE", "")
    vi.stubEnv("BETTER_AUTH_SECRET", "")
    vi.stubEnv("DATABASE_URL", "")

    const { assertProductionAuthSecrets } = await loadEnv()

    expect(() => assertProductionAuthSecrets()).toThrow(
      "BETTER_AUTH_SECRET and DATABASE_URL are required in production.",
    )
  })

  it("allows missing runtime secret during production build", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXT_PHASE", "phase-production-build")
    vi.stubEnv("BETTER_AUTH_SECRET", "")

    const { assertProductionAuthSecrets } = await loadEnv()

    expect(() => assertProductionAuthSecrets()).not.toThrow()
  })
})
