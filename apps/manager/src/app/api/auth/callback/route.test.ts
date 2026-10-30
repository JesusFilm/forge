import { beforeEach, describe, expect, it, vi } from "vitest"

const cookieGet = vi.fn()
const exchangeManagerAuthorizationCode = vi.fn()
const verifyManagerIdToken = vi.fn()
const validateAdminManagerSession = vi.fn()

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: cookieGet,
  })),
}))

vi.mock("@/lib/oauth-client", () => ({
  getManagerOAuthConfig: vi.fn(() => ({
    issuerUrl: "https://auth.jesusfilm.org",
    clientId: "jfp_manager_local",
    managerBaseUrl: "http://localhost:3002",
  })),
  exchangeManagerAuthorizationCode: (...args: unknown[]) =>
    exchangeManagerAuthorizationCode(...args),
  verifyManagerIdToken: (...args: unknown[]) => verifyManagerIdToken(...args),
}))

vi.mock("@/lib/admin-manager-session", () => ({
  validateAdminManagerSession: (...args: unknown[]) =>
    validateAdminManagerSession(...args),
}))

describe("Manager OAuth callback route", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    cookieGet.mockReset()
    exchangeManagerAuthorizationCode.mockReset()
    verifyManagerIdToken.mockReset()
    validateAdminManagerSession.mockReset()
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
  })

  it("rejects callbacks with invalid state without setting a Manager session", async () => {
    cookieGet.mockReturnValue(undefined)

    const { GET } = await import("./route")
    const response = await GET(
      new Request("http://localhost:3002/api/auth/callback?code=c&state=s"),
    )

    expect(response.headers.get("location")).toBe(
      "http://localhost:3002/login?error=invalid_state",
    )
    expect(exchangeManagerAuthorizationCode).not.toHaveBeenCalled()
    const setCookie = response.headers.get("set-cookie") ?? ""
    expect(setCookie).toContain("manager-session=;")
    expect(setCookie).toContain("Expires=Thu, 01 Jan 1970")
  })

  it("uses the configured Manager origin for callback error redirects", async () => {
    cookieGet.mockReturnValue(undefined)

    const { GET } = await import("./route")
    const response = await GET(
      new Request("https://0.0.0.0:8080/api/auth/callback?code=c&state=s"),
    )

    expect(response.headers.get("location")).toBe(
      "http://localhost:3002/login?error=invalid_state",
    )
  })

  it("sets a Manager-local session after Auth token and Admin membership validation", async () => {
    cookieGet.mockImplementation((name: string) => {
      const values: Record<string, string> = {
        "manager-oauth-state": "state_123",
        "manager-oauth-verifier": "verifier_123",
        "manager-oauth-return-to": "/dashboard/coverage",
      }

      return values[name] ? { value: values[name] } : undefined
    })
    exchangeManagerAuthorizationCode.mockResolvedValueOnce({
      access_token: "access",
      id_token: "id",
      scope: "openid manager:access",
    })
    verifyManagerIdToken.mockResolvedValueOnce({
      subject: "auth_user_123",
      email: "manager@example.com",
      name: "Manager User",
      scopes: ["openid", "manager:access"],
    })
    validateAdminManagerSession.mockResolvedValueOnce({
      user: {
        id: "admin-user-123",
        email: "manager@example.com",
        name: "Manager User",
      },
      managerRole: "OPERATOR",
    })

    const { GET } = await import("./route")
    const response = await GET(
      new Request(
        "http://localhost:3002/api/auth/callback?code=code_123&state=state_123",
      ),
    )

    expect(response.headers.get("location")).toBe(
      "http://localhost:3002/dashboard/coverage",
    )
    expect(exchangeManagerAuthorizationCode).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "code_123",
        codeVerifier: "verifier_123",
      }),
    )
    expect(validateAdminManagerSession).toHaveBeenCalledWith({
      subject: "auth_user_123",
      email: "manager@example.com",
      name: "Manager User",
    })
    const setCookie = response.headers.get("set-cookie") ?? ""
    expect(setCookie).toContain("manager-session=")
    expect(setCookie).toContain("strapi-jwt=;")
  })

  it("routes a reviewer to the separate review lane and rejects an operator return target", async () => {
    cookieGet.mockImplementation((name: string) => {
      const values: Record<string, string> = {
        "manager-oauth-state": "state_123",
        "manager-oauth-verifier": "verifier_123",
        "manager-oauth-return-to": "/dashboard/jobs",
      }
      return values[name] ? { value: values[name] } : undefined
    })
    exchangeManagerAuthorizationCode.mockResolvedValueOnce({
      access_token: "access",
      id_token: "id",
      scope: "openid manager:access",
    })
    verifyManagerIdToken.mockResolvedValueOnce({
      subject: "auth_reviewer_123",
      email: "reviewer@example.com",
      name: "Spanish Reviewer",
      scopes: ["openid", "manager:access"],
    })
    validateAdminManagerSession.mockResolvedValueOnce({
      user: {
        id: "admin-reviewer-123",
        email: "reviewer@example.com",
        name: "Spanish Reviewer",
      },
      managerRole: "REVIEWER",
      reviewerLanguageGrants: [
        {
          id: "grant-es",
          languageId: "language-es",
          languageSlug: "spanish-latin-america",
          permittedRubricDimensions: ["MEANING_ACCURACY"],
          specialistCapabilities: { scripture: false, theology: false },
        },
      ],
    })

    const { GET } = await import("./route")
    const response = await GET(
      new Request(
        "http://localhost:3002/api/auth/callback?code=code_123&state=state_123",
      ),
    )

    expect(response.headers.get("location")).toBe(
      "http://localhost:3002/subtitle-review",
    )
    expect(response.headers.get("set-cookie")).toContain("manager-session=")
  })

  it("does not trust a cross-origin returnTo cookie", async () => {
    cookieGet.mockImplementation((name: string) => {
      const values: Record<string, string> = {
        "manager-oauth-state": "state_123",
        "manager-oauth-verifier": "verifier_123",
        "manager-oauth-return-to": "https://evil.test/dashboard",
      }

      return values[name] ? { value: values[name] } : undefined
    })
    exchangeManagerAuthorizationCode.mockResolvedValueOnce({
      access_token: "access",
      scope: "openid manager:access",
    })
    verifyManagerIdToken.mockResolvedValueOnce({
      subject: "auth_user_123",
      email: "manager@example.com",
      scopes: ["openid", "manager:access"],
    })
    validateAdminManagerSession.mockResolvedValueOnce({
      user: {
        id: "admin-user-123",
        email: "manager@example.com",
      },
      managerRole: "OPERATOR",
    })

    const { GET } = await import("./route")
    const response = await GET(
      new Request(
        "http://localhost:3002/api/auth/callback?code=code_123&state=state_123",
      ),
    )

    expect(response.headers.get("location")).toBe(
      "http://localhost:3002/dashboard/coverage",
    )
  })

  it("does not set a session when Admin denies Manager membership", async () => {
    cookieGet.mockImplementation((name: string) => {
      const values: Record<string, string> = {
        "manager-oauth-state": "state_123",
        "manager-oauth-verifier": "verifier_123",
      }

      return values[name] ? { value: values[name] } : undefined
    })
    exchangeManagerAuthorizationCode.mockResolvedValueOnce({
      access_token: "access",
      scope: "openid manager:access",
    })
    verifyManagerIdToken.mockResolvedValueOnce({
      subject: "auth_user_123",
      email: "viewer@example.com",
      scopes: ["openid", "manager:access"],
    })
    validateAdminManagerSession.mockResolvedValueOnce(null)

    const { GET } = await import("./route")
    const response = await GET(
      new Request(
        "http://localhost:3002/api/auth/callback?code=code_123&state=state_123",
      ),
    )

    expect(response.headers.get("location")).toBe(
      "http://localhost:3002/login?error=forbidden",
    )
    const setCookie = response.headers.get("set-cookie") ?? ""
    expect(setCookie).toContain("manager-session=;")
    expect(setCookie).toContain("Expires=Thu, 01 Jan 1970")
  })
})
