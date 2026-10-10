import { beforeEach, describe, expect, it, vi } from "vitest"

describe("GET /api/auth/login", () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()

    vi.stubEnv("MANAGER_DATA_MODE", "mock")
    vi.stubEnv("MANAGER_MOCK_SESSION_SECRET", "mock-session-secret")
    vi.stubEnv("MUX_TOKEN_ID", "mux-token-id")
    vi.stubEnv("MUX_TOKEN_SECRET", "mux-token-secret")
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key")
    vi.stubEnv(
      "MANAGER_SESSION_SECRET",
      "manager-session-secret-change-me-000000",
    )
    vi.stubEnv("AUTH_ISSUER_URL", "https://auth.jesusfilm.org")
    vi.stubEnv("AUTH_MANAGER_CLIENT_ID", "jfp_manager_local")
    vi.stubEnv("MANAGER_BASE_URL", "http://localhost:3002")
  })

  it("redirects to Auth with Manager OAuth scope and PKCE cookies", async () => {
    const { GET } = await import("./route")
    const response = await GET(
      new Request(
        "http://localhost:3002/api/auth/login?returnTo=/dashboard/jobs",
      ),
    )

    expect(response.status).toBe(307)
    const location = response.headers.get("location")
    expect(location).toBeTruthy()
    const redirectUrl = new URL(location!)
    expect(redirectUrl.origin).toBe("https://auth.jesusfilm.org")
    expect(redirectUrl.pathname).toBe("/api/auth/oauth2/authorize")
    expect(redirectUrl.searchParams.get("client_id")).toBe("jfp_manager_local")
    expect(redirectUrl.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3002/api/auth/callback",
    )
    expect(redirectUrl.searchParams.get("scope")).toBe(
      "openid profile:read email:read manager:access",
    )
    expect(redirectUrl.searchParams.get("code_challenge_method")).toBe("S256")

    const setCookie = response.headers.get("set-cookie") ?? ""
    expect(setCookie).toContain("manager-oauth-state=")
    expect(setCookie).toContain("manager-oauth-verifier=")
    expect(setCookie).toContain("manager-oauth-return-to=")
    expect(setCookie).not.toContain("strapi-jwt=")
  })

  it("does not allow cross-origin returnTo redirects", async () => {
    const { GET } = await import("./route")
    const response = await GET(
      new Request(
        "http://localhost:3002/api/auth/login?returnTo=https://evil.test/path",
      ),
    )

    expect(response.headers.get("set-cookie")).toContain(
      "manager-oauth-return-to=http%3A%2F%2Flocalhost%3A3002%2Fdashboard%2Fcoverage",
    )
  })
})
