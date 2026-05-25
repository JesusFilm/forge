import { beforeEach, describe, expect, it, vi } from "vitest"

describe("Developer OAuth client", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv("AUTH_DATABASE_URL", "postgresql://localhost/forge_auth")
    vi.stubEnv("AUTH_ISSUER_URL", "http://localhost:3004/api/auth")
    vi.stubEnv("AUTH_DEVELOPER_CLIENT_ID", "jfp_developer_local")
    vi.stubEnv("DEVELOPER_BASE_URL", "http://localhost:3006")
    vi.stubEnv("DEVELOPER_SESSION_SECRET", "x".repeat(32))
  })

  it("builds an Auth authorize URL with the Developer access scope", async () => {
    const { buildDeveloperAuthorizeUrl, getDeveloperOAuthConfig } =
      await import("./oauth-client")

    const url = buildDeveloperAuthorizeUrl({
      config: getDeveloperOAuthConfig(),
      state: "state",
      codeChallenge: "challenge",
    })

    expect(url.toString()).toContain("client_id=jfp_developer_local")
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3006/api/auth/callback",
    )
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([
      "openid",
      "profile:read",
      "email:read",
      "membership:read",
      "developer:access",
    ])
  })
})
