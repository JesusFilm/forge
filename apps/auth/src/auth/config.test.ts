import { google, type GoogleOptions } from "better-auth/social-providers"
import { beforeEach, describe, expect, it, vi } from "vitest"

const authConfigCapture = vi.hoisted(() => ({
  betterAuth: vi.fn((options: unknown) => ({ options })),
  oauthProvider: vi.fn(() => ({})),
  genericOAuth: vi.fn((_options: unknown) => ({})),
  jwt: vi.fn((_options: unknown) => ({})),
  env: {} as Record<string, string | undefined>,
  findAccountUnique: vi.fn(
    async (
      _args: unknown,
    ): Promise<{ user: { email: string | null } } | null> => null,
  ),
}))

vi.mock("better-auth", () => ({
  betterAuth: authConfigCapture.betterAuth,
}))

vi.mock("better-auth/next-js", () => ({
  nextCookies: vi.fn(() => ({})),
  toNextJsHandler: vi.fn(() => ({})),
}))

vi.mock("better-auth/plugins", () => ({
  genericOAuth: authConfigCapture.genericOAuth,
  jwt: authConfigCapture.jwt,
  okta: vi.fn(() => ({ providerId: "okta" })),
}))

vi.mock("@better-auth/oauth-provider", () => ({
  oauthProvider: authConfigCapture.oauthProvider,
}))

vi.mock("@better-auth/expo", () => ({
  expo: vi.fn(() => ({})),
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
  getAdminWatchProgressErasureConfig: vi.fn(() => null),
  getAppleNativeClientConfig: vi.fn(() => null),
  getAuthBaseUrl: vi.fn(() => "http://localhost:3004"),
  getAuthTrustedOrigins: vi.fn(() => []),
  getAuthValidAudiences: vi.fn(() => []),
}))

vi.mock("@/db/client", () => ({
  prisma: { account: { findUnique: authConfigCapture.findAccountUnique } },
}))

type CapturedAuthOptions = {
  socialProviders: Record<string, unknown> & {
    google: GoogleOptions
    apple?: {
      clientId: string
      clientSecret: string
      audience: string[]
      mapProfileToUser: (profile: {
        sub?: string
        email?: string
      }) => Promise<Record<string, unknown>>
    }
  }
  account: {
    accountLinking: { enabled: boolean; trustedProviders: string[] }
  }
  user: {
    deleteUser?: {
      enabled: boolean
      sendDeleteAccountVerification?: unknown
      beforeDelete?: unknown
      afterDelete?: unknown
    }
  }
  session: {
    expiresIn: number
    additionalFields?: Record<string, { type: string; input?: boolean }>
  }
  databaseHooks?: {
    session?: {
      create?: {
        before?: (
          session: Record<string, unknown>,
          ctx: { path?: string; body?: unknown } | null,
        ) => Promise<{ data: Record<string, unknown> } | void>
      }
    }
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
    // Clears call history AND any queued mockResolvedValueOnce, so a test
    // that never stubs the lookup cannot inherit the previous one's value.
    authConfigCapture.findAccountUnique.mockReset()
    authConfigCapture.findAccountUnique.mockResolvedValue(null)
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

describe("mobile login configuration", () => {
  beforeEach(() => {
    configureProviderEnvironment()
    // Clears call history AND any queued mockResolvedValueOnce, so a test
    // that never stubs the lookup cannot inherit the previous one's value.
    authConfigCapture.findAccountUnique.mockReset()
    authConfigCapture.findAccountUnique.mockResolvedValue(null)
  })

  it("accepts native Apple identity tokens for both the web Service ID and the app bundle id", async () => {
    configureProviderEnvironment({
      APPLE_APP_BUNDLE_ID: "org.jesusfilm.forgewatch",
    })

    const options = await captureAuthOptions()

    expect(options.socialProviders.apple?.audience).toEqual([
      "apple-client-id",
      "org.jesusfilm.forgewatch",
    ])
  })

  it("keeps the web Service ID as the only Apple audience without a bundle id", async () => {
    const options = await captureAuthOptions()

    expect(options.socialProviders.apple?.audience).toEqual(["apple-client-id"])
  })

  it("passes through the Apple email without a lookup when the token has one", async () => {
    const options = await captureAuthOptions()
    const mapProfileToUser = options.socialProviders.apple?.mapProfileToUser

    await expect(
      mapProfileToUser?.({ sub: "apple-sub", email: "person@example.com" }),
    ).resolves.toEqual({ email: "person@example.com" })
    expect(authConfigCapture.findAccountUnique).not.toHaveBeenCalled()
  })

  it("restores the stored email when Apple omits it — the returning-user lockout", async () => {
    // Apple sends `email` only on a first authorization. Better Auth reads it
    // straight off the token and 401s when absent, so without this a returning
    // user could never sign in again (worst right after account deletion).
    authConfigCapture.findAccountUnique.mockResolvedValueOnce({
      user: { email: "stored@example.com" },
    })
    const options = await captureAuthOptions()

    await expect(
      options.socialProviders.apple?.mapProfileToUser({ sub: "apple-sub" }),
    ).resolves.toEqual({ email: "stored@example.com" })
    expect(authConfigCapture.findAccountUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          providerId_accountId: {
            providerId: "apple",
            accountId: "apple-sub",
          },
        },
      }),
    )
  })

  it("returns no email rather than a wrong one when nothing is stored", async () => {
    authConfigCapture.findAccountUnique.mockResolvedValueOnce(null)
    const options = await captureAuthOptions()

    await expect(
      options.socialProviders.apple?.mapProfileToUser({ sub: "unknown-sub" }),
    ).resolves.toEqual({})
  })

  it("never looks up an account without a subject", async () => {
    const options = await captureAuthOptions()

    await expect(
      options.socialProviders.apple?.mapProfileToUser({}),
    ).resolves.toEqual({})
    expect(authConfigCapture.findAccountUnique).not.toHaveBeenCalled()
  })

  it("links consumer providers only on provider-verified emails (R1)", async () => {
    const options = await captureAuthOptions()

    // Without blanket trust, better-auth links a matched-email account only
    // when the provider asserts a verified email. okta and the jfp self-RP
    // stay trusted as internal identity assertions.
    expect(options.account.accountLinking.trustedProviders).toEqual([
      "okta",
      "jfp",
    ])
  })

  it("registers the jfp self-RP provider as a public PKCE client of Auth's own OAuth provider", async () => {
    await captureAuthOptions()

    const genericOAuthCall = authConfigCapture.genericOAuth.mock
      .calls[0]?.[0] as {
      config: Array<Record<string, unknown>>
    }
    const jfp = genericOAuthCall.config.find(
      (entry) => entry.providerId === "jfp",
    )

    expect(jfp).toMatchObject({
      providerId: "jfp",
      clientId: "jfp_mobile_local",
      discoveryUrl: "http://localhost:3004/.well-known/openid-configuration",
      redirectURI: "http://localhost:3004/api/auth/oauth2/callback/jfp",
      pkce: true,
      scopes: ["openid", "profile:read", "email:read"],
    })
    expect(jfp).not.toHaveProperty("clientSecret")
  })

  it("enables account deletion without a verification email (fresh-session SSO re-auth instead)", async () => {
    const options = await captureAuthOptions()

    expect(options.user.deleteUser?.enabled).toBe(true)
    expect(
      options.user.deleteUser?.sendDeleteAccountVerification,
    ).toBeUndefined()
    expect(options.user.deleteUser?.beforeDelete).toBeTypeOf("function")
    // No afterDelete: every side effect runs before the row is deleted, so a
    // failure can still abort. A post-delete hook could only log.
    expect(options.user.deleteUser?.afterDelete).toBeUndefined()
  })

  it("declares the clientKind session field without client input", async () => {
    const options = await captureAuthOptions()

    expect(options.session.additionalFields?.clientKind).toMatchObject({
      type: "string",
      input: false,
    })
  })

  it("stamps mobile sessions at creation and leaves web sessions unstamped", async () => {
    const options = await captureAuthOptions()
    const before = options.databaseHooks?.session?.create?.before

    await expect(
      before?.(
        { token: "session-token" },
        {
          path: "/sign-in/social",
          body: { provider: "apple", idToken: { token: "t" } },
        },
      ),
    ).resolves.toEqual({
      data: { token: "session-token", clientKind: "mobile" },
    })

    await expect(
      before?.({ token: "session-token" }, { path: "/callback/google" }),
    ).resolves.toBeUndefined()
  })

  it("mints lean JWTs whose only claims are the subject and the mobile client claim", async () => {
    await captureAuthOptions()

    const jwtCall = authConfigCapture.jwt.mock.calls[0]?.[0] as {
      jwt: {
        expirationTime: string
        definePayload: (session: {
          user: Record<string, unknown>
          session: Record<string, unknown>
        }) => Record<string, unknown>
      }
    }

    expect(jwtCall.jwt.expirationTime).toBe("15m")
    expect(
      jwtCall.jwt.definePayload({
        user: { id: "user-1", email: "person@example.com", name: "Person" },
        session: { clientKind: "mobile" },
      }),
    ).toEqual({
      sub: "user-1",
      "https://jesusfilm.org/claims/client": "mobile",
    })
    expect(
      jwtCall.jwt.definePayload({
        user: { id: "user-2", email: "person@example.com" },
        session: {},
      }),
    ).toEqual({ sub: "user-2" })
  })
})

// Production has no web Service ID (APPLE_CLIENT_ID unset in Doppler forge-auth
// as of 2026-08-05), so gating Apple on the web pair alone left the provider
// unregistered and native sign-in failing with PROVIDER_NOT_FOUND.
describe("Apple credential pairing", () => {
  it("registers Apple from the NATIVE pair alone — no web Service ID", async () => {
    configureProviderEnvironment({
      APPLE_CLIENT_ID: undefined,
      APPLE_CLIENT_SECRET: undefined,
      APPLE_APP_BUNDLE_ID: "org.jesusfilm.forgewatch",
      APPLE_NATIVE_CLIENT_SECRET: "apple-native-secret",
    })

    const options = await captureAuthOptions()

    expect(options.socialProviders.apple).toMatchObject({
      clientId: "org.jesusfilm.forgewatch",
      clientSecret: "apple-native-secret",
      audience: ["org.jesusfilm.forgewatch"],
    })
  })

  it("keeps clientId and clientSecret a MATCHED pair — never web id with native secret", async () => {
    // Apple requires the secret JWT's `sub` to equal the presented client_id;
    // a mixed pair is rejected at its token endpoint.
    configureProviderEnvironment({
      APPLE_APP_BUNDLE_ID: "org.jesusfilm.forgewatch",
      APPLE_NATIVE_CLIENT_SECRET: "apple-native-secret",
    })

    const options = await captureAuthOptions()

    expect(options.socialProviders.apple).toMatchObject({
      clientId: "apple-client-id",
      clientSecret: "apple-client-secret",
    })
    // Both ids still verify identity tokens.
    expect(options.socialProviders.apple?.audience).toEqual([
      "apple-client-id",
      "org.jesusfilm.forgewatch",
    ])
  })

  it("verifies native tokens even when the native secret is absent", async () => {
    // The bundle id can be trusted as an audience before the code-exchange
    // credential exists; the exchange endpoint degrades on its own.
    configureProviderEnvironment({
      APPLE_APP_BUNDLE_ID: "org.jesusfilm.forgewatch",
      APPLE_NATIVE_CLIENT_SECRET: undefined,
    })

    const options = await captureAuthOptions()

    expect(options.socialProviders.apple?.clientId).toBe("apple-client-id")
    expect(options.socialProviders.apple?.audience).toContain(
      "org.jesusfilm.forgewatch",
    )
  })

  it("leaves Apple unregistered when neither pair is complete", async () => {
    configureProviderEnvironment({
      APPLE_CLIENT_ID: undefined,
      APPLE_CLIENT_SECRET: undefined,
      APPLE_APP_BUNDLE_ID: "org.jesusfilm.forgewatch",
      APPLE_NATIVE_CLIENT_SECRET: undefined,
    })

    const options = await captureAuthOptions()

    expect(options.socialProviders).not.toHaveProperty("apple")
  })
})
