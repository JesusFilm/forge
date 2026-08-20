import { createHash, randomBytes, randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { AUTH_SCOPES } from "@/domain/scopes"

/**
 * Executable compatibility contract for the Better Auth 1.6.2 -> 1.7 upgrade.
 *
 * This suite deliberately uses the real provider and a scratch PostgreSQL
 * database. It is opt-in so ordinary unit-test runs need no database:
 *
 *   AUTH_TEST_DATABASE_URL=postgresql://... \
 *   BETTER_AUTH_SECRET=upgrade-baseline-secret-not-for-production \
 *     pnpm --filter @forge/auth test -- better-auth-upgrade.integration
 *
 * Keep these assertions version-shaped. U5 replays the same contract after the
 * migration and dependency upgrade; changing an expectation requires an
 * explicit compatibility decision, not a snapshot refresh.
 */

const databaseUrl = process.env.AUTH_TEST_DATABASE_URL
const describeIntegration = databaseUrl ? describe : describe.skip

process.env.DATABASE_URL = databaseUrl ?? process.env.DATABASE_URL
process.env.BETTER_AUTH_SECRET =
  process.env.BETTER_AUTH_SECRET ?? "upgrade-baseline-secret-not-for-production"
process.env.AUTH_BASE_URL = process.env.AUTH_BASE_URL ?? "http://localhost:3004"

const PUBLIC_CLIENT_ID = "jfp_upgrade_baseline_public"
const OTHER_CLIENT_ID = "jfp_upgrade_baseline_other"
const MANAGER_CLIENT_ID = "jfp_upgrade_baseline_manager_service"
const REDIRECT_URI = "http://127.0.0.1:49173/callback"
const MANAGER_AUDIENCE = "http://localhost:3003/api/manager/session"
const RESOURCE_B = "https://resource-b.example.test/mcp"
const CLIENT_SECRET = "jfp_cs_upgrade-baseline-client-secret"
const CLIENT_SECRET_BODY = CLIENT_SECRET.slice("jfp_cs_".length)
const AUTH_TIME = new Date("2026-08-20T01:02:03.000Z")
const USER_SCOPES = ["openid", "profile:read", "email:read", "offline_access"]
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

process.env.AUTH_VALID_AUDIENCES = [
  process.env.AUTH_VALID_AUDIENCES,
  MANAGER_AUDIENCE,
  RESOURCE_B,
]
  .filter(Boolean)
  .join(",")

function hash(value: string): string {
  // This reproduces Better Auth's database key for opaque OAuth tokens; the
  // input is random token material, not a user password requiring stretching.
  // codeql[js/insufficient-password-hash]
  return createHash("sha256").update(value).digest("base64url")
}

function basicHeaders(clientId: string, secret: string) {
  return new Headers({
    authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`,
  })
}

async function postOAuth(
  handler: (request: Request) => Promise<Response>,
  path: string,
  body: Record<string, string>,
  credentials?: { clientId: string; secret: string },
) {
  const headers = new Headers({
    "content-type": "application/x-www-form-urlencoded",
  })
  if (credentials) {
    headers.set(
      "authorization",
      basicHeaders(credentials.clientId, credentials.secret).get(
        "authorization",
      )!,
    )
  }
  const response = await handler(
    new Request(`http://localhost:3004/api/auth${path}`, {
      method: "POST",
      headers,
      body: new URLSearchParams(body),
    }),
  )
  return {
    response,
    body: (await response.json()) as Record<string, unknown>,
  }
}

function pkcePair() {
  const verifier = randomBytes(32).toString("base64url")
  return {
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split(".")[1]
  if (!payload) throw new Error("Expected a JWT")
  return JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  ) as Record<string, unknown>
}

async function authorizeResource(input: {
  auth: typeof import("@/auth/config").auth
  clientId: string
  cookie: string
  challenge: string
  resource: string
}) {
  const url = new URL("http://localhost:3004/api/auth/oauth2/authorize")
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    redirect_uri: REDIRECT_URI,
    scope: "offline_access admin:manager-session:validate",
    code_challenge: input.challenge,
    code_challenge_method: "S256",
    resource: input.resource,
  }).toString()
  const response = await input.auth.handler(
    new Request(url, {
      headers: { cookie: input.cookie },
      redirect: "manual",
    }),
  )
  expect(response.status).toBe(302)
  const location = response.headers.get("location")
  if (!location) throw new Error("Authorization response omitted Location")
  const code = new URL(location).searchParams.get("code")
  if (!code) throw new Error(`Authorization failed: ${location}`)
  return code
}

async function exchangeOverHttp(
  auth: typeof import("@/auth/config").auth,
  params: URLSearchParams,
) {
  const response = await auth.handler(
    new Request("http://localhost:3004/api/auth/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params,
    }),
  )
  return {
    response,
    body: (await response.json()) as Record<string, unknown>,
  }
}

describeIntegration("Better Auth PostgreSQL compatibility contract", () => {
  let prisma: typeof import("@/db/client").prisma
  let auth: typeof import("@/auth/config").auth
  let buildAuthorizationCode: typeof import("./oauth-authorization-code.service").buildAuthorizationCode
  let userId: string
  let sessionId: string
  const dynamicClientIds: string[] = []

  beforeAll(async () => {
    stubSelfDiscovery()
    ;({ prisma } = await import("@/db/client"))
    ;({ auth } = await import("@/auth/config"))
    ;({ buildAuthorizationCode } =
      await import("./oauth-authorization-code.service"))

    const sharedClient = {
      scopes: USER_SCOPES,
      redirectUris: [REDIRECT_URI],
      postLogoutRedirectUris: [],
      grantTypes: ["authorization_code", "refresh_token"],
      responseTypes: ["code"],
      disabled: false,
      clientSecret: null,
      public: true,
      requirePKCE: true,
      tokenEndpointAuthMethod: "none",
      applicationType: "native",
      skipConsent: true,
      metadata: { appKey: "web", environmentKind: "local" },
    }
    await prisma.oauthClient.upsert({
      where: { clientId: PUBLIC_CLIENT_ID },
      update: sharedClient,
      create: {
        clientId: PUBLIC_CLIENT_ID,
        name: "Upgrade baseline public client",
        ...sharedClient,
      },
    })
    await prisma.oauthClient.upsert({
      where: { clientId: OTHER_CLIENT_ID },
      update: sharedClient,
      create: {
        clientId: OTHER_CLIENT_ID,
        name: "Upgrade baseline binding control",
        ...sharedClient,
      },
    })
    await prisma.oauthClient.upsert({
      where: { clientId: MANAGER_CLIENT_ID },
      update: {
        clientSecret: hash(CLIENT_SECRET_BODY),
        scopes: ["admin:manager-session:validate"],
        public: false,
        requirePKCE: false,
        tokenEndpointAuthMethod: "client_secret_basic",
        applicationType: "web",
        clientCredentialsScopes: ["admin:manager-session:validate"],
        grantTypes: ["client_credentials"],
        responseTypes: [],
        metadata: {
          appKey: "manager",
          environmentKind: "local",
          serviceAudience: MANAGER_AUDIENCE,
        },
      },
      create: {
        clientId: MANAGER_CLIENT_ID,
        name: "Upgrade baseline Manager session service",
        clientSecret: hash(CLIENT_SECRET_BODY),
        scopes: ["admin:manager-session:validate"],
        redirectUris: [],
        postLogoutRedirectUris: [],
        grantTypes: ["client_credentials"],
        responseTypes: [],
        disabled: false,
        public: false,
        requirePKCE: false,
        tokenEndpointAuthMethod: "client_secret_basic",
        applicationType: "web",
        clientCredentialsScopes: ["admin:manager-session:validate"],
        skipConsent: true,
        metadata: {
          appKey: "manager",
          environmentKind: "local",
          serviceAudience: MANAGER_AUDIENCE,
        },
      },
    })
    const managerResource = await prisma.oauthResource.findUniqueOrThrow({
      where: { identifier: MANAGER_AUDIENCE },
    })
    await prisma.oauthClientResource.upsert({
      where: {
        clientId_resourceId: {
          clientId: MANAGER_CLIENT_ID,
          resourceId: managerResource.identifier,
        },
      },
      update: {},
      create: {
        clientId: MANAGER_CLIENT_ID,
        resourceId: managerResource.identifier,
      },
    })

    userId = `upgrade_baseline_user_${randomUUID()}`
    await prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@example.test`,
        name: "Upgrade Baseline User",
        emailVerified: true,
        membershipStatus: "ACTIVE",
      },
    })
    sessionId = `upgrade_baseline_session_${randomUUID()}`
    await prisma.session.create({
      data: {
        id: sessionId,
        userId,
        token: randomBytes(24).toString("base64url"),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    })
  })

  afterAll(async () => {
    vi.unstubAllGlobals()
    if (!databaseUrl) return
    await prisma.verification.deleteMany({
      where: { value: { contains: userId } },
    })
    await prisma.oauthClient.deleteMany({
      where: {
        clientId: {
          in: [
            PUBLIC_CLIENT_ID,
            OTHER_CLIENT_ID,
            MANAGER_CLIENT_ID,
            ...dynamicClientIds,
          ],
        },
      },
    })
    await prisma.session.deleteMany({ where: { userId } })
    await prisma.user.deleteMany({ where: { id: userId } })
    await prisma.$disconnect()
  })

  async function mintCode(
    input: {
      clientId?: string
      redirectUri?: string
      referenceId?: string
    } = {},
  ) {
    const { verifier, challenge } = pkcePair()
    const minted = buildAuthorizationCode({
      query: {
        client_id: input.clientId ?? PUBLIC_CLIENT_ID,
        redirect_uri: input.redirectUri ?? REDIRECT_URI,
        scope: USER_SCOPES.join(" "),
        code_challenge: challenge,
        code_challenge_method: "S256",
      },
      userId,
      sessionId,
      authTime: AUTH_TIME.getTime(),
      codeExpiresInMs: 10 * 60 * 1000,
    })
    const value = JSON.parse(minted.value) as Record<string, unknown>
    if (input.referenceId) value.referenceId = input.referenceId
    await prisma.verification.create({
      data: {
        id: randomUUID(),
        identifier: minted.identifier,
        value: JSON.stringify(value),
        expiresAt: minted.expiresAt,
      },
    })
    return { ...minted, verifier }
  }

  it("exchanges once, persists only hashes, and preserves referenceId/authTime through refresh and revocation", async () => {
    const referenceId = `upgrade_reference_${randomUUID()}`
    const minted = await mintCode({ referenceId })

    const tokens = (await auth.api.oauth2Token({
      body: {
        grant_type: "authorization_code",
        client_id: PUBLIC_CLIENT_ID,
        code: minted.code,
        code_verifier: minted.verifier,
        redirect_uri: REDIRECT_URI,
      },
    })) as unknown as Record<string, unknown>

    const accessToken = String(tokens.access_token)
    const refreshToken = String(tokens.refresh_token)
    expect(tokens).toMatchObject({
      token_type: "Bearer",
      scope: USER_SCOPES.join(" "),
    })
    expect(accessToken).toMatch(/^jfp_at_[A-Za-z0-9_-]+$/)
    expect(refreshToken).toMatch(/^jfp_rt_[A-Za-z0-9_-]+$/)
    expect(String(tokens.id_token).split(".")).toHaveLength(3)

    const accessBody = accessToken.slice("jfp_at_".length)
    const refreshBody = refreshToken.slice("jfp_rt_".length)
    const persistedAccess = await prisma.oauthAccessToken.findUniqueOrThrow({
      where: { token: hash(accessBody) },
    })
    const persistedRefresh = await prisma.oauthRefreshToken.findFirstOrThrow({
      where: { token: hash(refreshBody) },
    })
    expect(persistedAccess).toMatchObject({
      clientId: PUBLIC_CLIENT_ID,
      userId,
      sessionId,
      referenceId,
      scopes: USER_SCOPES,
      resources: [],
    })
    expect(persistedAccess.token).not.toBe(accessBody)
    expect(persistedRefresh).toMatchObject({
      clientId: PUBLIC_CLIENT_ID,
      userId,
      sessionId,
      referenceId,
      scopes: USER_SCOPES,
      resources: [],
    })
    expect(persistedRefresh.token).not.toBe(refreshBody)
    expect(persistedRefresh.authTime?.getTime()).toBe(AUTH_TIME.getTime())

    const idClaims = decodeJwtPayload(String(tokens.id_token))
    expect(idClaims).toMatchObject({
      sub: userId,
      aud: PUBLIC_CLIENT_ID,
      auth_time: Math.floor(AUTH_TIME.getTime() / 1000),
      email_verified: true,
      "https://jesusfilm.org/claims/actor_type": "human",
      // 1.6.2's internal user lookup omits this Forge additional field, so
      // the custom-claim callback observes no value and applies its fallback.
      "https://jesusfilm.org/claims/membership_status": "invited",
    })

    const refreshed = (await auth.api.oauth2Token({
      body: {
        grant_type: "refresh_token",
        client_id: PUBLIC_CLIENT_ID,
        refresh_token: refreshToken,
      },
    })) as Record<string, unknown>
    expect(String(refreshed.access_token)).toMatch(/^jfp_at_/)
    expect(String(refreshed.refresh_token)).toMatch(/^jfp_rt_/)
    expect(String(refreshed.refresh_token)).not.toBe(refreshToken)
    await expect(
      prisma.oauthRefreshToken.findUniqueOrThrow({
        where: { id: persistedRefresh.id },
      }),
    ).resolves.toMatchObject({ revoked: expect.any(Date) })

    const refreshedBody = String(refreshed.refresh_token).slice(
      "jfp_rt_".length,
    )
    const rotated = await prisma.oauthRefreshToken.findFirstOrThrow({
      where: { token: hash(refreshedBody) },
    })
    expect(rotated).toMatchObject({ referenceId, authTime: AUTH_TIME })

    await auth.api.oauth2Revoke({
      body: {
        client_id: PUBLIC_CLIENT_ID,
        token: String(refreshed.refresh_token),
        token_type_hint: "refresh_token",
      },
    })
    await expect(
      prisma.oauthRefreshToken.findUniqueOrThrow({
        where: { id: rotated.id },
      }),
    ).resolves.toMatchObject({ revoked: expect.any(Date) })

    await expect(
      auth.api.oauth2Token({
        body: {
          grant_type: "authorization_code",
          client_id: PUBLIC_CLIENT_ID,
          code: minted.code,
          code_verifier: minted.verifier,
          redirect_uri: REDIRECT_URI,
        },
      }),
    ).rejects.toMatchObject({ body: { error: "invalid_grant" } })
  })

  it.each([
    ["PKCE verifier", "pkce"],
    ["redirect URI", "redirect"],
    ["client id", "client"],
  ])(
    "rejects a code with the wrong %s without issuing tokens",
    async (_name, mismatch) => {
      const referenceId = `rejected_exchange_${randomUUID()}`
      const minted = await mintCode({ referenceId })
      const before = await prisma.oauthAccessToken.count({
        where: { referenceId },
      })

      await expect(
        auth.api.oauth2Token({
          body: {
            grant_type: "authorization_code",
            client_id:
              mismatch === "client" ? OTHER_CLIENT_ID : PUBLIC_CLIENT_ID,
            code: minted.code,
            code_verifier:
              mismatch === "pkce" ? pkcePair().verifier : minted.verifier,
            redirect_uri:
              mismatch === "redirect"
                ? "http://127.0.0.1:49173/wrong"
                : REDIRECT_URI,
          },
        }),
      ).rejects.toMatchObject({
        body: {
          error: mismatch === "pkce" ? "invalid_request" : "invalid_grant",
        },
      })
      await expect(
        prisma.oauthAccessToken.count({
          where: { referenceId },
        }),
      ).resolves.toBe(before)
      await expect(
        prisma.verification.findFirst({
          where: { identifier: minted.identifier },
        }),
      ).resolves.toBeNull()
    },
  )

  it("preserves Manager client-credentials authentication and JWT claims", async () => {
    const client = await prisma.oauthClient.findUniqueOrThrow({
      where: { clientId: MANAGER_CLIENT_ID },
    })
    expect(client.clientSecret).toBe(hash(CLIENT_SECRET_BODY))
    expect(client.clientSecret).not.toContain(CLIENT_SECRET_BODY)

    const tokenResult = await postOAuth(
      auth.handler,
      "/oauth2/token",
      {
        grant_type: "client_credentials",
        resource: MANAGER_AUDIENCE,
        scope: "admin:manager-session:validate",
      },
      { clientId: MANAGER_CLIENT_ID, secret: CLIENT_SECRET },
    )
    expect(tokenResult.response.status).toBe(200)
    const tokens = tokenResult.body
    const claims = decodeJwtPayload(String(tokens.access_token))
    expect(claims).toMatchObject({
      aud: MANAGER_AUDIENCE,
      azp: MANAGER_CLIENT_ID,
      scope: "admin:manager-session:validate",
      iss: "http://localhost:3004/api/auth",
      "https://jesusfilm.org/claims/environment": "local",
      "https://jesusfilm.org/claims/app": "manager",
    })
    expect(claims.sub).toBe(MANAGER_CLIENT_ID)
    expect(tokens).toMatchObject({
      token_type: "Bearer",
      scope: "admin:manager-session:validate",
      expires_in: 30 * 60,
    })

    await expect(
      auth.api.oauth2Token({
        body: {
          grant_type: "client_credentials",
          client_id: MANAGER_CLIENT_ID,
          client_secret: CLIENT_SECRET_BODY,
          resource: MANAGER_AUDIENCE,
        },
      }),
    ).rejects.toMatchObject({ body: { error: "invalid_client" } })
  })

  it("allows unauthenticated DCR only for an explicitly public PKCE client", async () => {
    const registered = (await auth.api.registerOAuthClient({
      body: {
        client_name: "Upgrade baseline dynamic public client",
        redirect_uris: ["http://127.0.0.1:54321/callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        application_type: "native",
        scope: USER_SCOPES.join(" "),
      },
    })) as unknown as Record<string, unknown>
    dynamicClientIds.push(String(registered.client_id))

    expect(registered).toMatchObject({
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      require_pkce: undefined,
      client_secret: undefined,
      scope: AUTH_SCOPES.map((scope) => scope.key).join(" "),
    })
    await expect(
      prisma.oauthClient.findUniqueOrThrow({
        where: { clientId: String(registered.client_id) },
      }),
    ).resolves.toMatchObject({
      public: null,
      requirePKCE: null,
      tokenEndpointAuthMethod: "none",
      applicationType: "native",
      clientSecret: null,
      referenceId: null,
    })

    await expect(
      auth.api.registerOAuthClient({
        body: {
          client_name: "Must not default to unauthenticated confidential",
          redirect_uris: ["http://127.0.0.1:54322/callback"],
          grant_types: ["authorization_code"],
          response_types: ["code"],
          application_type: "web",
        },
      }),
    ).rejects.toMatchObject({ body: { error: "invalid_redirect_uri" } })
  })

  it("binds a native DCR resource through authorization, exchange, and refresh", async () => {
    const email = `resource_binding_${randomUUID()}@example.test`
    const signUp = await auth.api.signUpEmail({
      asResponse: true,
      headers: new Headers(),
      body: {
        email,
        password: `T3st-${randomUUID()}!`,
        name: "Resource Binding User",
      },
    })
    expect(signUp.status).toBe(200)
    const cookie = signUp.headers.get("set-cookie")?.split(";")[0]
    if (!cookie) throw new Error("Sign-up response omitted session cookie")

    const registered = (await auth.api.registerOAuthClient({
      body: {
        client_name: "Native resource binding client",
        redirect_uris: [REDIRECT_URI],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        application_type: "native",
        resources: [MANAGER_AUDIENCE],
      },
    })) as unknown as Record<string, unknown>
    const clientId = String(registered.client_id)
    dynamicClientIds.push(clientId)
    await prisma.oauthClient.update({
      where: { clientId },
      data: { skipConsent: true },
    })

    const rejectedPkce = pkcePair()
    const rejectedCode = await authorizeResource({
      auth,
      clientId,
      cookie,
      challenge: rejectedPkce.challenge,
      resource: MANAGER_AUDIENCE,
    })
    const persisted = await prisma.verification.findFirstOrThrow({
      where: { identifier: hash(rejectedCode) },
    })
    expect(JSON.parse(persisted.value)).toMatchObject({
      type: "authorization_code",
      resource: [MANAGER_AUDIENCE],
    })

    const widenedParams = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code: rejectedCode,
      code_verifier: rejectedPkce.verifier,
      redirect_uri: REDIRECT_URI,
    })
    widenedParams.append("resource", MANAGER_AUDIENCE)
    widenedParams.append("resource", RESOURCE_B)
    const tokenRowsBeforeWidening = await prisma.oauthAccessToken.count({
      where: { clientId },
    })
    const widened = await exchangeOverHttp(auth, widenedParams)
    expect(widened.response.status).toBe(400)
    expect(widened.body).toMatchObject({ error: "invalid_target" })
    await expect(
      prisma.oauthAccessToken.count({ where: { clientId } }),
    ).resolves.toBe(tokenRowsBeforeWidening)

    const acceptedPkce = pkcePair()
    const acceptedCode = await authorizeResource({
      auth,
      clientId,
      cookie,
      challenge: acceptedPkce.challenge,
      resource: MANAGER_AUDIENCE,
    })
    const accepted = await exchangeOverHttp(
      auth,
      new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code: acceptedCode,
        code_verifier: acceptedPkce.verifier,
        redirect_uri: REDIRECT_URI,
        resource: MANAGER_AUDIENCE,
      }),
    )
    expect(accepted.response.status).toBe(200)
    expect(decodeJwtPayload(String(accepted.body.access_token)).aud).toBe(
      MANAGER_AUDIENCE,
    )
    await expect(
      prisma.oauthRefreshToken.findFirstOrThrow({ where: { clientId } }),
    ).resolves.toMatchObject({ resources: [MANAGER_AUDIENCE] })

    const inheritedPkce = pkcePair()
    const inheritedCode = await authorizeResource({
      auth,
      clientId,
      cookie,
      challenge: inheritedPkce.challenge,
      resource: MANAGER_AUDIENCE,
    })
    const inherited = await exchangeOverHttp(
      auth,
      new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code: inheritedCode,
        code_verifier: inheritedPkce.verifier,
        redirect_uri: REDIRECT_URI,
      }),
    )
    expect(inherited.response.status).toBe(200)
    expect(decodeJwtPayload(String(inherited.body.access_token)).aud).toBe(
      MANAGER_AUDIENCE,
    )

    const refreshed = await exchangeOverHttp(
      auth,
      new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: String(accepted.body.refresh_token),
        resource: MANAGER_AUDIENCE,
      }),
    )
    expect(refreshed.response.status).toBe(200)
    expect(decodeJwtPayload(String(refreshed.body.access_token)).aud).toBe(
      MANAGER_AUDIENCE,
    )

    const widenedRefresh = await exchangeOverHttp(
      auth,
      new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: String(accepted.body.refresh_token),
        resource: RESOURCE_B,
      }),
    )
    expect(widenedRefresh.response.status).toBe(400)
    expect(widenedRefresh.body).toMatchObject({ error: "invalid_target" })

    const user = await prisma.user.findUniqueOrThrow({ where: { email } })
    await prisma.user.delete({ where: { id: user.id } })
  })
})
