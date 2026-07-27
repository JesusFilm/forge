import { google, type GoogleOptions } from "better-auth/social-providers"
import { beforeEach, describe, expect, it, vi } from "vitest"

const authConfigCapture = vi.hoisted(() => ({
  betterAuth: vi.fn((options: unknown) => ({ options })),
  oauthProvider: vi.fn(() => ({})),
  env: {} as Record<string, string | undefined>,
}))

vi.mock("better-auth", () => ({
  betterAuth: authConfigCapture.betterAuth,
}))

vi.mock("better-auth/next-js", () => ({
  nextCookies: vi.fn(() => ({})),
  toNextJsHandler: vi.fn(() => ({})),
}))

vi.mock("better-auth/plugins", () => ({
  genericOAuth: vi.fn(() => ({})),
  jwt: vi.fn(() => ({})),
  okta: vi.fn(() => ({})),
}))

vi.mock("@better-auth/oauth-provider", () => ({
  oauthProvider: authConfigCapture.oauthProvider,
}))

vi.mock("@better-auth/prisma-adapter", () => ({
  prismaAdapter: vi.fn(() => ({})),
}))

vi.mock("@/auth/agent-login-plugin", () => ({
  agentLoginPlugin: vi.fn(() => ({})),
}))

vi.mock("@/config/env", () => ({
  assertProductionAuthSecrets: vi.fn(),
  env: authConfigCapture.env,
  getAuthBaseUrl: vi.fn(() => "http://localhost:3004"),
  getAuthTrustedOrigins: vi.fn(() => []),
  getAuthValidAudiences: vi.fn(() => []),
}))

vi.mock("@/db/client", () => ({
  prisma: {},
}))

type CapturedAuthOptions = {
  socialProviders: Record<string, unknown> & {
    google: GoogleOptions
  }
}

type CapturedOAuthProviderOptions = {
  accessTokenExpiresIn: number
  advertisedMetadata: {
    scopes_supported: string[]
  }
  clientRegistrationAllowedScopes: string[]
  clientRegistrationDefaultScopes: string[]
  scopes: string[]
}

function configureProviderEnvironment(
  overrides: Record<string, string | undefined> = {},
) {
  Object.keys(authConfigCapture.env).forEach((key) => {
    delete authConfigCapture.env[key]
  })

  Object.assign(authConfigCapture.env, {
    BETTER_AUTH_SECRET: "test-secret",
    FACEBOOK_CLIENT_ID: "facebook-client-id",
    FACEBOOK_CLIENT_SECRET: "facebook-client-secret",
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    APPLE_CLIENT_ID: "apple-client-id",
    APPLE_CLIENT_SECRET: "apple-client-secret",
    ...overrides,
  })
}

async function captureAuthOptions() {
  vi.resetModules()
  authConfigCapture.betterAuth.mockClear()
  authConfigCapture.oauthProvider.mockClear()

  await import("./config")

  return authConfigCapture.betterAuth.mock.calls[0]?.[0] as CapturedAuthOptions
}

async function captureOAuthProviderOptions() {
  vi.resetModules()
  authConfigCapture.betterAuth.mockClear()
  authConfigCapture.oauthProvider.mockClear()

  await import("./config")

  const calls = authConfigCapture.oauthProvider.mock.calls as unknown[][]
  return calls[0]?.[0] as CapturedOAuthProviderOptions
}

describe("auth provider configuration", () => {
  beforeEach(() => {
    configureProviderEnvironment()
  })

  it("always requests Google account selection when Google is enabled", async () => {
    const options = await captureAuthOptions()

    expect(options.socialProviders.google).toEqual({
      clientId: "google-client-id",
      clientSecret: "google-client-secret",
      prompt: "select_account",
    })
  })

  it("includes account selection in Better Auth's Google authorization URL", async () => {
    const options = await captureAuthOptions()
    const googleProvider = google(options.socialProviders.google)

    const authorizationURL = await googleProvider.createAuthorizationURL({
      state: "test-state",
      codeVerifier: "test-code-verifier",
      redirectURI: "http://localhost:3004/api/auth/callback/google",
    })

    expect(authorizationURL.searchParams.get("prompt")).toBe("select_account")
  })

  it("does not add an account-selection prompt to other providers", async () => {
    const options = await captureAuthOptions()

    expect(options.socialProviders.facebook).not.toHaveProperty("prompt")
    expect(options.socialProviders.apple).not.toHaveProperty("prompt")
  })

  it("keeps Google disabled when its credentials are missing", async () => {
    configureProviderEnvironment({
      GOOGLE_CLIENT_ID: undefined,
      GOOGLE_CLIENT_SECRET: undefined,
    })

    const options = await captureAuthOptions()

    expect(options.socialProviders).not.toHaveProperty("google")
  })

  it("advertises offline_access so public PKCE MCP clients can receive refresh tokens", async () => {
    const options = await captureOAuthProviderOptions()

    expect(options.accessTokenExpiresIn).toBe(60 * 60)
    expect(options.scopes).toContain("offline_access")
    expect(options.advertisedMetadata.scopes_supported).toContain(
      "offline_access",
    )
    expect(options.clientRegistrationAllowedScopes).toContain("offline_access")
    expect(options.clientRegistrationDefaultScopes).not.toContain(
      "offline_access",
    )
  })
})
