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

  it("allows Admin MCP resource audiences by default", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("AUTH_BASE_URL", "https://auth.jesusfilm.org")
    vi.stubEnv("AUTH_VALID_AUDIENCES", "")
    vi.stubEnv("BETTER_AUTH_SECRET", "test-secret")

    const { getAuthValidAudiences } = await loadEnv()

    expect(getAuthValidAudiences()).toEqual(
      expect.arrayContaining([
        "https://auth.jesusfilm.org",
        "http://localhost:3003/mcp",
        "https://admin-preview.jesusfilm.org/mcp",
        "https://admin-stage.jesusfilm.org/mcp",
        "https://admin.jesusfilm.org/mcp",
      ]),
    )
  })

  it("adds configured OAuth audiences", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("AUTH_BASE_URL", "https://auth.jesusfilm.org")
    vi.stubEnv(
      "AUTH_VALID_AUDIENCES",
      "https://custom.example.test, https://admin.jesusfilm.org/mcp",
    )
    vi.stubEnv("BETTER_AUTH_SECRET", "test-secret")

    const { getAuthValidAudiences } = await loadEnv()

    expect(getAuthValidAudiences()).toEqual(
      expect.arrayContaining([
        "https://custom.example.test",
        "https://admin.jesusfilm.org/mcp",
      ]),
    )
    expect(
      getAuthValidAudiences().filter(
        (audience) => audience === "https://admin.jesusfilm.org/mcp",
      ),
    ).toHaveLength(1)
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

describe("mobile auth env", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("always trusts the mobile app scheme origin", async () => {
    vi.stubEnv("NODE_ENV", "development")

    const { getAuthTrustedOrigins, MOBILE_APP_SCHEME_ORIGIN } = await loadEnv()

    expect(MOBILE_APP_SCHEME_ORIGIN).toBe("forgemobile://")
    expect(getAuthTrustedOrigins()).toContain("forgemobile://")
  })

  it("returns no Apple native config until both env vars are set", async () => {
    vi.stubEnv("APPLE_APP_BUNDLE_ID", "org.jesusfilm.forgewatch")
    vi.stubEnv("APPLE_NATIVE_CLIENT_SECRET", "")

    const { getAppleNativeClientConfig } = await loadEnv()

    expect(getAppleNativeClientConfig()).toBeNull()
  })

  it("returns the Apple native config when both env vars are set", async () => {
    vi.stubEnv("APPLE_APP_BUNDLE_ID", "org.jesusfilm.forgewatch")
    vi.stubEnv("APPLE_NATIVE_CLIENT_SECRET", "apple-native-secret")

    const { getAppleNativeClientConfig } = await loadEnv()

    expect(getAppleNativeClientConfig()).toEqual({
      bundleId: "org.jesusfilm.forgewatch",
      clientSecret: "apple-native-secret",
    })
  })

  it("returns no admin erasure config until both env vars are set", async () => {
    vi.stubEnv("ADMIN_WATCH_PROGRESS_BASE_URL", "http://localhost:3003")
    vi.stubEnv("ADMIN_WATCH_PROGRESS_API_KEY", "")

    const { getAdminWatchProgressErasureConfig } = await loadEnv()

    expect(getAdminWatchProgressErasureConfig()).toBeNull()
  })

  it("returns the admin erasure config when both env vars are set", async () => {
    vi.stubEnv("ADMIN_WATCH_PROGRESS_BASE_URL", "http://localhost:3003")
    vi.stubEnv("ADMIN_WATCH_PROGRESS_API_KEY", "erasure-key")

    const { getAdminWatchProgressErasureConfig } = await loadEnv()

    expect(getAdminWatchProgressErasureConfig()).toEqual({
      baseUrl: "http://localhost:3003",
      apiKey: "erasure-key",
    })
  })

  it("requires the lifecycle and erasure credentials as one playlist-deletion bundle", async () => {
    vi.stubEnv(
      "ADMIN_USER_PLAYLIST_LIFECYCLE_URL",
      "http://localhost:3003/api/internal/user-playlists/lifecycle",
    )
    vi.stubEnv(
      "USER_PLAYLIST_LIFECYCLE_HMAC_SECRET",
      "lifecycle-secret-that-is-at-least-32-bytes",
    )
    vi.stubEnv("ADMIN_USER_PLAYLIST_ERASURE_URL", "")
    vi.stubEnv("ADMIN_USER_PLAYLIST_ERASURE_API_KEY", "")

    const { getAdminUserPlaylistDeletionConfig } = await loadEnv()

    expect(() => getAdminUserPlaylistDeletionConfig()).toThrow(
      "partial user-playlist deletion configuration",
    )
  })

  it("returns the complete playlist-deletion authority bundle", async () => {
    vi.stubEnv(
      "ADMIN_USER_PLAYLIST_LIFECYCLE_URL",
      "http://localhost:3003/api/internal/user-playlists/lifecycle",
    )
    vi.stubEnv(
      "USER_PLAYLIST_LIFECYCLE_HMAC_SECRET",
      "lifecycle-secret-that-is-at-least-32-bytes",
    )
    vi.stubEnv(
      "ADMIN_USER_PLAYLIST_ERASURE_URL",
      "http://localhost:3003/api/internal/user-playlists/erasure",
    )
    vi.stubEnv("ADMIN_USER_PLAYLIST_ERASURE_API_KEY", "playlist-erasure")

    const { getAdminUserPlaylistDeletionConfig } = await loadEnv()

    expect(getAdminUserPlaylistDeletionConfig()).toEqual({
      lifecycle: {
        endpoint: "http://localhost:3003/api/internal/user-playlists/lifecycle",
        secret: "lifecycle-secret-that-is-at-least-32-bytes",
      },
      erasure: {
        endpoint: "http://localhost:3003/api/internal/user-playlists/erasure",
        apiKey: "playlist-erasure",
      },
    })
  })
})
