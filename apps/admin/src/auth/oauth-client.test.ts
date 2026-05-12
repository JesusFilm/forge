import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  buildAdminAuthorizeUrl,
  exchangeAdminAuthorizationCode,
  getAdminOAuthRedirectUri,
  verifyAdminIdToken,
  type AdminOAuthConfig,
} from "./oauth-client"

const jwtVerify = vi.fn()

vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => "jwks"),
  jwtVerify: (...args: unknown[]) => jwtVerify(...args),
}))

const config: AdminOAuthConfig = {
  issuerUrl: "https://auth.jesusfilm.org",
  clientId: "jfp_admin_production",
  clientSecret: "secret",
  adminBaseUrl: "https://admin.jesusfilm.org",
}

describe("admin OAuth client", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    jwtVerify.mockReset()
  })

  it("builds an authorization-code PKCE URL for admin", () => {
    const url = buildAdminAuthorizeUrl({
      config,
      state: "state_123",
      codeChallenge: "challenge_123",
      callbackUrl: "https://admin.jesusfilm.org/dashboard",
    })

    expect(url.origin).toBe("https://auth.jesusfilm.org")
    expect(url.pathname).toBe("/api/auth/oauth2/authorize")
    expect(url.searchParams.get("client_id")).toBe("jfp_admin_production")
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://admin.jesusfilm.org/api/auth/callback",
    )
    expect(url.searchParams.get("response_type")).toBe("code")
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.searchParams.get("scope")).toContain("admin:access")
    expect(url.searchParams.get("callbackURL")).toBe(
      "https://admin.jesusfilm.org/dashboard",
    )
  })

  it("exchanges authorization codes with client auth and PKCE verifier", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "access",
          id_token: "id",
          scope: "openid admin:access",
        }),
        { status: 200 },
      ),
    )

    await expect(
      exchangeAdminAuthorizationCode({
        config,
        code: "code_123",
        codeVerifier: "verifier_123",
      }),
    ).resolves.toMatchObject({ access_token: "access" })

    const [, init] = fetchMock.mock.calls[0] ?? []
    expect(init?.method).toBe("POST")
    expect(init?.headers).toMatchObject({
      authorization: expect.stringMatching(/^Basic /),
    })
    expect(init?.body?.toString()).toContain("code_verifier=verifier_123")
  })

  it("verifies issuer, audience, and admin access scope", async () => {
    jwtVerify.mockResolvedValueOnce({
      payload: {
        sub: "user_123",
        email: "user@example.com",
        name: "Test User",
        scope: "openid admin:access",
      },
    })

    await expect(
      verifyAdminIdToken({
        config,
        accessToken: "access",
      }),
    ).resolves.toMatchObject({
      subject: "user_123",
      email: "user@example.com",
      scopes: ["openid", "admin:access"],
    })

    expect(jwtVerify).toHaveBeenCalledWith("access", "jwks", {
      issuer: "https://auth.jesusfilm.org",
      audience: "jfp_admin_production",
    })
  })

  it("rejects tokens without admin access", async () => {
    jwtVerify.mockResolvedValueOnce({
      payload: {
        sub: "user_123",
        scope: "openid",
      },
    })

    await expect(
      verifyAdminIdToken({
        config,
        accessToken: "access",
      }),
    ).rejects.toThrow("Auth token is missing the admin access grant.")
  })

  it("normalizes the admin redirect URI", () => {
    expect(
      getAdminOAuthRedirectUri({
        ...config,
        adminBaseUrl: "https://admin.jesusfilm.org/",
      }),
    ).toBe("https://admin.jesusfilm.org/api/auth/callback")
  })
})
