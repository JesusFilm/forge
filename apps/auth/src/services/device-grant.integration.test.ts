import { createHash, randomBytes, randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

/**
 * Real-database proof for the two claims no mocked test can make.
 *
 * 1. The device-code claim is genuinely atomic. A mocked `updateMany` returning
 *    `{count: 0}` proves the branch exists; it does not prove Postgres refuses
 *    the second writer. Only two concurrent statements against a real row do.
 * 2. The authorization code this app mints is accepted by
 *    `@better-auth/oauth-provider`'s own token endpoint. That compatibility rests
 *    on two undocumented internals of a pinned dependency — the identifier
 *    hashing and the stored JSON shape — so it has to be asserted at the layer
 *    where the claim actually lives: what the provider returns.
 *
 * Opt-in: set AUTH_TEST_DATABASE_URL to a scratch database that has had
 * `prisma migrate deploy` run against it. Skipped otherwise, so CI is unaffected.
 *
 *   docker exec <pg> psql -U forge -d postgres -c "CREATE DATABASE auth_it"
 *   DATABASE_URL=postgresql://forge:forge@localhost:5432/auth_it \
 *     pnpm --filter @forge/auth exec prisma migrate deploy
 *   AUTH_TEST_DATABASE_URL=postgresql://forge:forge@localhost:5432/auth_it \
 *   BETTER_AUTH_SECRET=upgrade-baseline-secret-not-for-production \
 *     pnpm --filter @forge/auth test -- device-grant.integration
 */

const databaseUrl = process.env.AUTH_TEST_DATABASE_URL
const describeIntegration = databaseUrl ? describe : describe.skip

process.env.DATABASE_URL = databaseUrl ?? process.env.DATABASE_URL
process.env.BETTER_AUTH_SECRET =
  process.env.BETTER_AUTH_SECRET ?? "upgrade-baseline-secret-not-for-production"
process.env.AUTH_BASE_URL = process.env.AUTH_BASE_URL ?? "http://localhost:3004"

const TEST_CLIENT_ID = "jfp_tv_integration_test"
const REDIRECT_URI = "http://localhost:3004/device/callback"
const SCOPES = ["openid", "profile:read", "email:read", "offline_access"]
const nativeFetch = globalThis.fetch

function stubSelfDiscovery() {
  vi.stubGlobal(
    "fetch",
    (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/.well-known/openid-configuration")) {
        return Promise.resolve(
          Response.json({
            issuer: "http://localhost:3004/api/auth",
            authorization_endpoint:
              "http://localhost:3004/api/auth/oauth2/authorize",
            token_endpoint: "http://localhost:3004/api/auth/oauth2/token",
            userinfo_endpoint: "http://localhost:3004/api/auth/oauth2/userinfo",
            jwks_uri: "http://localhost:3004/api/auth/jwks",
            id_token_signing_alg_values_supported: ["EdDSA"],
          }),
        )
      }
      return nativeFetch(input, init)
    },
  )
}

/**
 * Introspection is authenticated, and the TV's own public client cannot do it.
 * Admin calls it with a separate confidential client — this mirrors that pair so
 * the assertion exercises admin's real code path rather than a shortcut.
 */
const INTROSPECT_CLIENT_ID = "jfp_introspect_integration_test"
/**
 * The `jfp_cs_` prefix is mandatory: `verifyStoredClientSecret` rejects any
 * secret that does not carry the configured prefix, and hashes the remainder.
 * A stored hash is therefore of the value *after* the prefix.
 */
const INTROSPECT_CLIENT_SECRET = "jfp_cs_integration-test-introspection-secret"
const INTROSPECT_CLIENT_SECRET_BODY = INTROSPECT_CLIENT_SECRET.slice(
  "jfp_cs_".length,
)

function pkcePair() {
  const verifier = randomBytes(32).toString("base64url")
  const challenge = createHash("sha256").update(verifier).digest("base64url")
  return { verifier, challenge }
}

function basicHeaders(clientId: string, secret: string) {
  return new Headers({
    authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`,
  })
}

async function introspectOverHttp(
  handler: (request: Request) => Promise<Response>,
  token: string,
  clientId: string,
) {
  const response = await handler(
    new Request("http://localhost:3004/api/auth/oauth2/introspect", {
      method: "POST",
      headers: {
        authorization: basicHeaders(clientId, INTROSPECT_CLIENT_SECRET).get(
          "authorization",
        )!,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        token,
        token_type_hint: "access_token",
      }),
    }),
  )
  expect(response.status).toBe(200)
  return (await response.json()) as Record<string, unknown>
}

describeIntegration("device grant against a real database", () => {
  let prisma: typeof import("@/db/client").prisma
  let service: typeof import("./device-grant.service")
  let auth: typeof import("@/auth/config").auth
  let userId: string
  let sessionId: string

  beforeAll(async () => {
    stubSelfDiscovery()
    ;({ prisma } = await import("@/db/client"))
    service = await import("./device-grant.service")
    ;({ auth } = await import("@/auth/config"))

    await prisma.oauthClient.upsert({
      where: { clientId: TEST_CLIENT_ID },
      update: {
        scopes: SCOPES,
        redirectUris: [REDIRECT_URI],
        grantTypes: [
          "authorization_code",
          "refresh_token",
          "urn:ietf:params:oauth:grant-type:device_code",
        ],
        disabled: false,
        public: true,
        requirePKCE: true,
        tokenEndpointAuthMethod: "none",
        applicationType: "native",
        skipConsent: true,
      },
      create: {
        clientId: TEST_CLIENT_ID,
        name: "Jesus Film TV (integration test)",
        scopes: SCOPES,
        redirectUris: [REDIRECT_URI],
        postLogoutRedirectUris: [],
        grantTypes: [
          "authorization_code",
          "refresh_token",
          "urn:ietf:params:oauth:grant-type:device_code",
        ],
        responseTypes: ["code"],
        disabled: false,
        public: true,
        requirePKCE: true,
        tokenEndpointAuthMethod: "none",
        skipConsent: true,
        metadata: { appKey: "tv", environmentKind: "local" },
      },
    })

    await prisma.oauthClient.upsert({
      where: { clientId: INTROSPECT_CLIENT_ID },
      update: {},
      create: {
        clientId: INTROSPECT_CLIENT_ID,
        name: "Introspection (integration test)",
        // Hashed exactly as seed-first-party-apps.ts stores client secrets.
        clientSecret: createHash("sha256")
          .update(INTROSPECT_CLIENT_SECRET_BODY)
          .digest("base64url"),
        scopes: ["openid"],
        redirectUris: [],
        postLogoutRedirectUris: [],
        grantTypes: ["client_credentials"],
        responseTypes: [],
        disabled: false,
        public: false,
        requirePKCE: false,
        tokenEndpointAuthMethod: "client_secret_basic",
        applicationType: "web",
        clientCredentialsScopes: [],
        skipConsent: true,
      },
    })

    userId = `it_user_${randomUUID()}`
    await prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@device-grant.test`,
        name: "Device Grant Tester",
        emailVerified: true,
        membershipStatus: "ACTIVE",
      },
    })

    sessionId = `it_sess_${randomUUID()}`
    await prisma.session.create({
      data: {
        id: sessionId,
        userId,
        token: randomBytes(24).toString("base64url"),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    })
  })

  afterAll(async () => {
    vi.unstubAllGlobals()
    if (!databaseUrl) return
    await prisma.deviceCode.deleteMany({ where: { clientId: TEST_CLIENT_ID } })
    await prisma.session.deleteMany({ where: { userId } })
    await prisma.user.deleteMany({ where: { id: userId } })
    await prisma.oauthClient.deleteMany({
      where: { clientId: { in: [TEST_CLIENT_ID, INTROSPECT_CLIENT_ID] } },
    })
    await prisma.$disconnect()
  })

  it("lets exactly one of two concurrent polls claim an approved code", async () => {
    const { challenge } = pkcePair()
    const issued = await service.issueDeviceCode(prisma, {
      clientId: TEST_CLIENT_ID,
      scopes: SCOPES,
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
      expiresInMs: 900_000,
      // Zero so the two polls are not rejected as slow_down before racing.
      pollingIntervalMs: 0,
    })

    await service.approveDeviceCode(prisma, {
      userCode: issued.userCode,
      userId,
      sessionId,
    })

    const results = await Promise.allSettled([
      service.pollDeviceCode(prisma, {
        deviceCode: issued.deviceCode,
        clientId: TEST_CLIENT_ID,
      }),
      service.pollDeviceCode(prisma, {
        deviceCode: issued.deviceCode,
        clientId: TEST_CLIENT_ID,
      }),
    ])

    const fulfilled = results.filter((r) => r.status === "fulfilled")
    const rejected = results.filter((r) => r.status === "rejected")

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: "invalid_grant",
    })
  })

  it("refuses a second approval of the same code", async () => {
    const { challenge } = pkcePair()
    const issued = await service.issueDeviceCode(prisma, {
      clientId: TEST_CLIENT_ID,
      scopes: SCOPES,
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
      expiresInMs: 900_000,
      pollingIntervalMs: 0,
    })

    await service.approveDeviceCode(prisma, {
      userCode: issued.userCode,
      userId,
      sessionId,
    })

    await expect(
      service.approveDeviceCode(prisma, {
        userCode: issued.userCode,
        userId,
        sessionId,
      }),
    ).rejects.toMatchObject({ code: "device_code_already_processed" })
  })

  it("mints a first-class OAuth token through the provider's own endpoint", async () => {
    const { verifier, challenge } = pkcePair()
    const issued = await service.issueDeviceCode(prisma, {
      clientId: TEST_CLIENT_ID,
      scopes: SCOPES,
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
      expiresInMs: 900_000,
      pollingIntervalMs: 0,
    })

    await service.approveDeviceCode(prisma, {
      userCode: issued.userCode,
      userId,
      sessionId,
    })

    const tokens = (await auth.api.deviceGrantToken({
      body: {
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: issued.deviceCode,
        client_id: TEST_CLIENT_ID,
        code_verifier: verifier,
      },
    })) as Record<string, unknown>

    // This is the origin plan's success criterion: the TV token is the same
    // kind of token every other first-party client gets, not a special case.
    expect(typeof tokens.access_token).toBe("string")
    expect(tokens.token_type).toBe("Bearer")
    expect(typeof tokens.refresh_token).toBe("string")
    expect(String(tokens.refresh_token)).toMatch(/^jfp_rt_/)
    expect(typeof tokens.id_token).toBe("string")

    const persisted = await prisma.oauthRefreshToken.findFirst({
      where: { clientId: TEST_CLIENT_ID, userId },
    })
    expect(persisted).not.toBeNull()

    // Opaque, not a JWT. A relying app therefore cannot verify this locally
    // against JWKS — it has to introspect. That constraint is what the next two
    // tests are about.
    expect(String(tokens.access_token)).toMatch(/^jfp_at_/)
    expect(String(tokens.access_token).split(".")).toHaveLength(1)

    const refreshed = (await auth.api.oauth2Token({
      body: {
        grant_type: "refresh_token",
        client_id: TEST_CLIENT_ID,
        refresh_token: String(tokens.refresh_token),
      },
    })) as Record<string, unknown>
    expect(String(refreshed.access_token)).toMatch(/^jfp_at_/)
    expect(String(refreshed.refresh_token)).toMatch(/^jfp_rt_/)
    expect(refreshed.refresh_token).not.toBe(tokens.refresh_token)
  })

  /**
   * These two pin the legacy no-resource introspection constraint that the TV
   * rollout depends on and that no mocked test can see: introspection is
   * caller-scoped. Both `validateJwtAccessToken` and `validateOpaqueAccessToken`
   * end with `if (clientId && <token>.clientId !== clientId) return {active:false}`.
   *
   * Consequence for PR6: admin holds a single introspection client id, so it
   * cannot authorise both `jfp_web_*` and `jfp_tv_*` tokens as currently
   * configured. Better Auth 1.7 broadens introspection only for explicitly
   * linked resource servers; an unlinked legacy caller must remain inactive.
   */
  it("refuses to introspect a token minted for a different client", async () => {
    const { verifier, challenge } = pkcePair()
    const issued = await service.issueDeviceCode(prisma, {
      clientId: TEST_CLIENT_ID,
      scopes: SCOPES,
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
      expiresInMs: 900_000,
      pollingIntervalMs: 0,
    })
    await service.approveDeviceCode(prisma, {
      userCode: issued.userCode,
      userId,
      sessionId,
    })
    const tokens = (await auth.api.deviceGrantToken({
      body: {
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: issued.deviceCode,
        client_id: TEST_CLIENT_ID,
        code_verifier: verifier,
      },
    })) as Record<string, unknown>

    const introspection = await introspectOverHttp(
      auth.handler,
      String(tokens.access_token),
      INTROSPECT_CLIENT_ID,
    )

    expect(introspection.active).toBe(false)
  })

  it("introspects a token when the authenticated caller owns it", async () => {
    // Same token, caller switched to the owning client. Production TV clients
    // are public and hold no secret; an operator provisions one out of band for
    // whichever client does the introspecting. The seeder's update branch never
    // writes `clientSecret`, so such a secret survives re-seeding.
    await prisma.oauthClient.update({
      where: { clientId: TEST_CLIENT_ID },
      data: {
        clientSecret: createHash("sha256")
          .update(INTROSPECT_CLIENT_SECRET_BODY)
          .digest("base64url"),
      },
    })

    const { verifier, challenge } = pkcePair()
    const issued = await service.issueDeviceCode(prisma, {
      clientId: TEST_CLIENT_ID,
      scopes: SCOPES,
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
      expiresInMs: 900_000,
      pollingIntervalMs: 0,
    })
    await service.approveDeviceCode(prisma, {
      userCode: issued.userCode,
      userId,
      sessionId,
    })
    const tokens = (await auth.api.deviceGrantToken({
      body: {
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: issued.deviceCode,
        client_id: TEST_CLIENT_ID,
        code_verifier: verifier,
      },
    })) as Record<string, unknown>

    await prisma.oauthClient.update({
      where: { clientId: TEST_CLIENT_ID },
      data: {
        public: false,
        tokenEndpointAuthMethod: "client_secret_basic",
        applicationType: "web",
      },
    })

    const introspection = await introspectOverHttp(
      auth.handler,
      String(tokens.access_token),
      TEST_CLIENT_ID,
    )

    expect(introspection.active).toBe(true)
    expect(introspection.client_id).toBe(TEST_CLIENT_ID)
    expect(introspection.sub).toBe(userId)
    expect(String(introspection.scope)).toContain("openid")
    await prisma.oauthClient.update({
      where: { clientId: TEST_CLIENT_ID },
      data: {
        public: true,
        tokenEndpointAuthMethod: "none",
        applicationType: "native",
      },
    })
  })

  it("rejects a device code redeemed with the wrong PKCE verifier", async () => {
    // Binds redemption to the device that requested the code: a stolen device
    // code alone is not enough. RFC 8628 has no such binding on its own.
    const { challenge } = pkcePair()
    const wrong = pkcePair()
    const issued = await service.issueDeviceCode(prisma, {
      clientId: TEST_CLIENT_ID,
      scopes: SCOPES,
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
      expiresInMs: 900_000,
      pollingIntervalMs: 0,
    })

    await service.approveDeviceCode(prisma, {
      userCode: issued.userCode,
      userId,
      sessionId,
    })

    await expect(
      auth.api.deviceGrantToken({
        body: {
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: issued.deviceCode,
          client_id: TEST_CLIENT_ID,
          code_verifier: wrong.verifier,
        },
      }),
    ).rejects.toMatchObject({
      body: { error: "invalid_grant" },
    })
  })

  it("works against the real seeded jfp_tv_local client, not just a fixture", async () => {
    // The cases above use a purpose-built client, which would still pass if the
    // first-party seed were wrong. This one drives the grant through the row the
    // seeder actually writes, so a bad `grantTypes` or scope list fails here.
    // Requires: pnpm --filter @forge/auth exec tsx src/scripts/seed-first-party-apps.ts
    const seeded = await prisma.oauthClient.findUnique({
      where: { clientId: "jfp_tv_local" },
      select: { grantTypes: true, scopes: true, redirectUris: true },
    })
    if (!seeded) {
      throw new Error(
        "jfp_tv_local is not seeded in the test database; run the first-party seeder first.",
      )
    }

    expect(seeded.grantTypes).toContain(
      "urn:ietf:params:oauth:grant-type:device_code",
    )
    // Admin's introspection gate requires this scope specifically.
    expect(seeded.scopes).toContain("web:watch-events:write")
    expect(seeded.redirectUris).toHaveLength(1)

    const { verifier, challenge } = pkcePair()
    const issued = (await auth.api.deviceGrantCode({
      body: {
        client_id: "jfp_tv_local",
        code_challenge: challenge,
        code_challenge_method: "S256",
      },
    })) as Record<string, unknown>

    expect(String(issued.user_code)).toMatch(/^[0-9]{10}$/)
    expect(String(issued.verification_uri)).toContain("/device")
    expect(String(issued.verification_uri_complete)).toContain("user_code=")
    expect(issued.interval).toBe(5)

    // Approval goes through the service rather than the endpoint: the endpoint
    // resolves a browser session from cookies, which a direct auth.api call has
    // no way to present. The endpoint's own session gate is covered by unit
    // tests; what this case is proving is the seeded client, not the gate.
    await service.approveDeviceCode(prisma, {
      userCode: String(issued.user_code),
      userId,
      sessionId,
    })

    const tokens = (await auth.api.deviceGrantToken({
      body: {
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: String(issued.device_code),
        client_id: "jfp_tv_local",
        code_verifier: verifier,
      },
    })) as Record<string, unknown>

    expect(String(tokens.refresh_token)).toMatch(/^jfp_rt_/)
    expect(String(tokens.access_token)).toMatch(/^jfp_at_/)
    expect(String(tokens.scope)).toContain("web:watch-events:write")

    await prisma.deviceCode.deleteMany({ where: { clientId: "jfp_tv_local" } })
  })

  it("refuses to issue a code for a client without the device grant type", async () => {
    await expect(
      auth.api.deviceGrantCode({
        body: {
          client_id: "jfp_web_production",
          code_challenge: pkcePair().challenge,
          code_challenge_method: "S256",
        },
      }),
    ).rejects.toMatchObject({ body: { error: "invalid_client" } })
  })
})
