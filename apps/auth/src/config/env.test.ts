import { afterEach, describe, expect, it, vi } from "vitest"

async function loadEnv() {
  vi.resetModules()
  return import("./env")
}

describe("auth env", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

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

  it("trusts common local web watch origins outside production", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("AUTH_BASE_URL", "http://localhost:3034")
    vi.stubEnv("AUTH_WEB_TRUSTED_ORIGINS", "")

    const { getAuthTrustedOrigins } = await loadEnv()

    expect(getAuthTrustedOrigins()).toEqual(
      expect.arrayContaining([
        "http://localhost:3034",
        "http://localhost:3000",
        "http://127.0.0.1:3030",
      ]),
    )
  })

  it("adds configured web trusted origins", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("AUTH_BASE_URL", "https://auth.jesusfilm.org")
    vi.stubEnv(
      "AUTH_WEB_TRUSTED_ORIGINS",
      "https://preview.jesusfilm.org/path, https://branch.example.test",
    )
    vi.stubEnv("BETTER_AUTH_SECRET", "test-secret")

    const { getAuthTrustedOrigins } = await loadEnv()

    expect(getAuthTrustedOrigins()).toEqual(
      expect.arrayContaining([
        "https://auth.jesusfilm.org",
        "https://jesusfilm.org",
        "https://www.jesusfilm.org",
        "https://watch.jesusfilm.org",
        "https://preview.jesusfilm.org",
        "https://branch.example.test",
      ]),
    )
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
