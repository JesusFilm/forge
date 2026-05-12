import { describe, expect, it, vi } from "vitest"

vi.mock("@/auth/oauth-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/auth/oauth-client")>()),
  getAdminOAuthConfig: vi.fn(() => ({
    issuerUrl: "https://auth.jesusfilm.org/api/auth",
    clientId: "jfp_admin_local",
    adminBaseUrl: "http://localhost:3003",
  })),
}))

vi.mock("@/auth/oauth-state", () => ({
  createOAuthState: vi.fn(() => ({
    state: "state_123",
    codeVerifier: "verifier_123",
    codeChallenge: "challenge_123",
  })),
}))

describe("admin OAuth login route", () => {
  it("sets PKCE cookies from a route handler and redirects to Auth authorize", async () => {
    const { GET } = await import("./route")

    const response = await GET(
      new Request(
        "http://localhost:3003/api/auth/login?callbackURL=http%3A%2F%2Flocalhost%3A3003%2Fdashboard",
      ),
    )
    const location = new URL(response.headers.get("location") ?? "")

    expect(location.origin).toBe("https://auth.jesusfilm.org")
    expect(location.pathname).toBe("/api/auth/oauth2/authorize")
    expect(location.searchParams.get("client_id")).toBe("jfp_admin_local")
    expect(location.searchParams.get("state")).toBe("state_123")
    expect(location.searchParams.get("code_challenge")).toBe("challenge_123")
    expect(response.headers.get("set-cookie")).toContain(
      "forge_admin_oauth_state=state_123",
    )
    expect(response.headers.get("set-cookie")).toContain(
      "forge_admin_oauth_verifier=verifier_123",
    )
    expect(response.headers.get("set-cookie")).toContain(
      "forge_admin_oauth_callback=http%3A%2F%2Flocalhost%3A3003%2Fdashboard",
    )
  })
})
