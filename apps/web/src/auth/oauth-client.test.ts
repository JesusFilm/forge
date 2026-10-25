import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

async function importClient() {
  vi.resetModules()
  vi.stubEnv("ADMIN_GRAPHQL_URL", "http://localhost:3003/api/graphql")
  vi.stubEnv("WEB_ADMIN_API_KEYS", "test-key")
  vi.stubEnv("REVALIDATION_SECRET", "test-secret")
  vi.stubEnv("WEB_AUTH_BASE_URL", "https://auth.jesusfilm.org")
  vi.stubEnv("WEB_AUTH_ISSUER_URL", "https://auth.jesusfilm.org/api/auth")
  vi.stubEnv("WEB_AUTH_CLIENT_ID", "jfp_web_local")
  vi.stubEnv("WEB_BASE_URL", "http://localhost:3000")
  vi.stubEnv(
    "WEB_SESSION_SECRET",
    "test-session-secret-at-least-thirty-two-chars",
  )
  return import("./oauth-client")
}

async function importProductionClient() {
  vi.resetModules()
  vi.stubEnv("ADMIN_GRAPHQL_URL", "https://admin.jesusfilm.org/api/graphql")
  vi.stubEnv("WEB_ADMIN_API_KEYS", "test-key")
  vi.stubEnv("REVALIDATION_SECRET", "test-secret")
  vi.stubEnv("WEB_AUTH_BASE_URL", "https://auth.jesusfilm.org")
  vi.stubEnv("WEB_AUTH_ISSUER_URL", "https://auth.jesusfilm.org/api/auth")
  vi.stubEnv("WEB_AUTH_CLIENT_ID", "jfp_web_production")
  vi.stubEnv("WEB_BASE_URL", "https://www.jesusfilm.org")
  vi.stubEnv(
    "WEB_SESSION_SECRET",
    "test-session-secret-at-least-thirty-two-chars",
  )
  return import("./oauth-client")
}

async function importResourceBoundClient() {
  vi.stubEnv("WEB_AUTH_ADMIN_RESOURCE", "http://localhost:4318/api/graphql")
  return importClient()
}

beforeEach(() => {
  vi.stubEnv("WEB_AUTH_ADMIN_RESOURCE", "")
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("Web OAuth client", () => {
  it("builds an Auth authorize URL with PKCE and watch-event scope", async () => {
    const { buildWebAuthorizeUrl, getWebOAuthConfig } = await importClient()
    const config = getWebOAuthConfig()

    expect(config).not.toBeNull()
    const url = buildWebAuthorizeUrl({
      config: config!,
      state: "state-123",
      codeChallenge: "challenge-123",
    })

    expect(url.toString()).toContain(
      "https://auth.jesusfilm.org/api/auth/oauth2/authorize?",
    )
    expect(url.searchParams.get("client_id")).toBe("jfp_web_local")
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/watch/api/auth/callback",
    )
    expect(url.searchParams.get("response_type")).toBe("code")
    expect(url.searchParams.get("scope")).toBe(
      "openid profile:read email:read web:watch-events:write",
    )
    expect(url.searchParams.get("state")).toBe("state-123")
    expect(url.searchParams.get("code_challenge")).toBe("challenge-123")
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
  })

  it("uses the request loopback origin for the local Web client", async () => {
    const { buildWebAuthorizeUrl, getWebOAuthConfig } = await importClient()
    const config = getWebOAuthConfig({
      requestOrigin: "http://localhost:51810",
    })

    expect(config?.webBaseUrl).toBe("http://localhost:51810")
    const url = buildWebAuthorizeUrl({
      config: config!,
      state: "state-123",
      codeChallenge: "challenge-123",
    })

    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:51810/watch/api/auth/callback",
    )
  })

  it("ignores non-loopback request origins", async () => {
    const { getWebOAuthConfig } = await importClient()

    expect(
      getWebOAuthConfig({
        requestOrigin: "https://attacker.example.test",
      })?.webBaseUrl,
    ).toBe("http://localhost:3000")
  })

  it("uses an allowed production request origin for the production Web client", async () => {
    const { buildWebAuthorizeUrl, getWebOAuthConfig } =
      await importProductionClient()
    const config = getWebOAuthConfig({
      requestOrigin: "https://watch.jesusfilm.org",
    })

    expect(config?.webBaseUrl).toBe("https://watch.jesusfilm.org")
    const url = buildWebAuthorizeUrl({
      config: config!,
      state: "state-123",
      codeChallenge: "challenge-123",
    })

    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://watch.jesusfilm.org/watch/api/auth/callback",
    )
  })

  it("falls back to the configured production base URL for untrusted origins", async () => {
    const { getWebOAuthConfig } = await importProductionClient()

    expect(
      getWebOAuthConfig({
        requestOrigin: "https://attacker.example.test",
      })?.webBaseUrl,
    ).toBe("https://www.jesusfilm.org")
  })

  it("requires an id_token for identity verification", async () => {
    const { getWebOAuthConfig, verifyWebIdToken } = await importClient()

    await expect(
      verifyWebIdToken({
        config: getWebOAuthConfig()!,
        idToken: undefined,
        scope: "openid web:watch-events:write",
      }),
    ).rejects.toThrow("missing an id_token")
  })

  it("leaves the authorize request and exchange audience-less by default", async () => {
    const {
      buildWebAuthorizeUrl,
      exchangeWebAuthorizationCode,
      getWebOAuthConfig,
    } = await importClient()
    const config = getWebOAuthConfig()!
    expect(
      buildWebAuthorizeUrl({
        config,
        state: "s",
        codeChallenge: "c",
      }).searchParams.has("resource"),
    ).toBe(false)

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ access_token: "t" })))
    await exchangeWebAuthorizationCode({
      config,
      code: "code",
      codeVerifier: "v",
    })
    const body = fetchMock.mock.calls[0][1]?.body as URLSearchParams
    expect(body.has("resource")).toBe(false)
  })

  it("binds both authorize and exchange to Admin's resource when configured", async () => {
    // Auth only lets Admin's confidential client introspect a public-client
    // token whose audience names a resource both clients are linked to.
    const {
      buildWebAuthorizeUrl,
      exchangeWebAuthorizationCode,
      getWebOAuthConfig,
    } = await importResourceBoundClient()
    const config = getWebOAuthConfig()!
    const url = buildWebAuthorizeUrl({ config, state: "s", codeChallenge: "c" })
    expect(url.searchParams.get("resource")).toBe(
      "http://localhost:4318/api/graphql",
    )
    // Still the public PKCE client with the same scopes.
    expect(url.searchParams.get("client_id")).toBe("jfp_web_local")
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.searchParams.get("scope")).toBe(
      "openid profile:read email:read web:watch-events:write",
    )

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ access_token: "t" })))
    await exchangeWebAuthorizationCode({
      config,
      code: "code",
      codeVerifier: "v",
    })
    const body = fetchMock.mock.calls[0][1]?.body as URLSearchParams
    expect(body.get("resource")).toBe("http://localhost:4318/api/graphql")
    expect(body.get("code_verifier")).toBe("v")
    expect(body.has("client_secret")).toBe(false)
  })
})
