import { createHash, randomBytes, randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import {
  createOAuthResourceCatalog,
  getPublicDcrResources,
} from "@/domain/oauth-resources"

/**
 * Opt-in native-provider proof. The target must be a disposable PostgreSQL
 * database with Auth migrations applied; this suite seeds the normal
 * first-party catalogue before exercising the real authorize/token handlers.
 *
 *   AUTH_TEST_DATABASE_URL=postgresql://forge:forge@localhost:5432/auth_it \
 *   BETTER_AUTH_SECRET=changelog-integration-secret-not-for-production \
 *     pnpm --filter @forge/auth test -- changelog-oauth-grant.integration
 */
const databaseUrl = process.env.AUTH_TEST_DATABASE_URL
const describeIntegration = databaseUrl ? describe : describe.skip

process.env.DATABASE_URL = databaseUrl ?? process.env.DATABASE_URL
process.env.BETTER_AUTH_SECRET =
  process.env.BETTER_AUTH_SECRET ??
  "changelog-integration-secret-not-for-production"
process.env.AUTH_BASE_URL = process.env.AUTH_BASE_URL ?? "http://localhost:3004"
process.env.AUTH_CHANGELOG_PRODUCTION_ENABLED = "false"

const LOCAL_RESOURCE = "http://localhost:3000/mcp"
const PRODUCTION_RESOURCE = "https://changelog.jesusfilm.org/mcp"
const REDIRECT_URI = "http://127.0.0.1:49191/callback"
const SEEDED_REDIRECT_URI = "http://localhost:3000/api/auth/callback"
const nativeFetch = globalThis.fetch
const PUBLIC_MCP_RESOURCES = getPublicDcrResources(
  createOAuthResourceCatalog({
    authIssuer: process.env.AUTH_BASE_URL!,
    customAudiences: [],
  }),
).sort()

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

function pkcePair() {
  const verifier = randomBytes(32).toString("base64url")
  return {
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split(".")[1]
  if (!payload) throw new Error("Expected a JWT access token")
  return JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  ) as Record<string, unknown>
}

function digestToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url")
}

describeIntegration("Changelog OAuth grants against native Better Auth", () => {
  let prisma: typeof import("@/db/client").prisma
  let auth: typeof import("@/auth/config").auth
  let routeGet: typeof import("@/app/api/auth/[...all]/route").GET
  let routePost: typeof import("@/app/api/auth/[...all]/route").POST
  let userId = ""
  let clientId = ""
  let grantId = ""
  let cookie = ""

  beforeAll(async () => {
    stubSelfDiscovery()
    ;({ prisma } = await import("@/db/client"))
    const { seedFirstPartyApps } =
      await import("@/scripts/seed-first-party-apps")
    await seedFirstPartyApps()
    ;({ auth } = await import("@/auth/config"))
    ;({ GET: routeGet, POST: routePost } =
      await import("@/app/api/auth/[...all]/route"))

    const signUp = await auth.api.signUpEmail({
      asResponse: true,
      headers: new Headers(),
      body: {
        email: `changelog_it_${randomUUID()}@example.test`,
        password: `T3st-${randomUUID()}!`,
        name: "Changelog Integration User",
      },
    })
    expect(signUp.status).toBe(200)
    cookie = signUp.headers.get("set-cookie")?.split(";")[0] ?? ""
    if (!cookie) throw new Error("Sign-up response omitted session cookie")
    const signedUp = (await signUp.json()) as { user: { id: string } }
    userId = signedUp.user.id
    await prisma.user.update({
      where: { id: userId },
      data: { membershipStatus: "ACTIVE" },
    })

    const registrationResponse = await routePost(
      new Request("http://localhost:3004/api/auth/oauth2/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "Changelog integration dynamic client",
          redirect_uris: [REDIRECT_URI],
        }),
      }),
      { params: Promise.resolve({ all: ["oauth2", "register"] }) },
    )
    expect(registrationResponse.status).toBeGreaterThanOrEqual(200)
    expect(registrationResponse.status).toBeLessThan(300)
    const registered = (await registrationResponse.json()) as {
      client_id: string
    }
    clientId = registered.client_id
    const registeredResourceIds = await prisma.oauthClientResource
      .findMany({
        where: { clientId },
        select: { resourceId: true },
      })
      .then((rows) => rows.map(({ resourceId }) => resourceId).sort())
    expect(registeredResourceIds).toEqual(PUBLIC_MCP_RESOURCES)

    const environment = await prisma.appEnvironment.findFirstOrThrow({
      where: { kind: "LOCAL", app: { key: "changelog" } },
      select: { id: true, appId: true },
    })
    const scope = await prisma.scope.findUniqueOrThrow({
      where: { key: "changelog:read" },
      select: { id: true },
    })
    const grant = await prisma.appGrant.create({
      data: {
        appId: environment.appId,
        environmentId: environment.id,
        subjectType: "USER",
        userId,
        status: "APPROVED",
        approvedAt: new Date(),
        scopes: { create: { scopeId: scope.id } },
      },
    })
    grantId = grant.id
  })

  afterAll(async () => {
    vi.unstubAllGlobals()
    if (!databaseUrl) return
    if (clientId) {
      await prisma.oauthClient.deleteMany({ where: { clientId } })
    }
    if (grantId) await prisma.appGrant.deleteMany({ where: { id: grantId } })
    if (userId) {
      await prisma.session.deleteMany({ where: { userId } })
      await prisma.user.deleteMany({ where: { id: userId } })
    }
    await prisma.$disconnect()
  })

  it("manages existing Contributors with current authority and exact grant scope", async () => {
    const { GET, POST } = await import("@/app/api/changelog/contributors/route")
    const adminScope = await prisma.scope.findUniqueOrThrow({
      where: { key: "changelog:admin" },
    })
    await prisma.appGrantScope.create({
      data: { grantId, scopeId: adminScope.id },
    })
    try {
      const authorized = await authorize({
        requestedClientId: "jfp_changelog_local",
        redirectUri: SEEDED_REDIRECT_URI,
        resource: null,
        scope: "openid changelog:read changelog:submit changelog:admin",
      })
      const code = await authorizationCode(authorized.response)
      const exchanged = await postToken(
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: "jfp_changelog_local",
          code,
          code_verifier: authorized.verifier,
          redirect_uri: SEEDED_REDIRECT_URI,
        }),
      )
      expect(exchanged.response.status).toBe(200)
      const response = await GET(
        new Request(
          "http://localhost:3004/api/changelog/contributors?clientId=jfp_changelog_local",
          {
            headers: { authorization: `Bearer ${exchanged.body.access_token}` },
          },
        ),
      )
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        environment: "local",
        contributors: [{ id: userId, canRevoke: false }],
      })
      const signup = await auth.api.signUpEmail({
        asResponse: true,
        body: {
          name: "Existing Contributor",
          email: `contributor-${randomUUID()}@example.test`,
          password: "integration-contributor-password",
        },
      })
      expect(signup.status).toBe(200)
      const recipient = ((await signup.json()) as { user: { id: string } }).user
      const recipientCookie = signup.headers.get("set-cookie")!.split(";")[0]
      await prisma.user.update({
        where: { id: recipient.id },
        data: { membershipStatus: "ACTIVE" },
      })
      const local = await prisma.appEnvironment.findUniqueOrThrow({
        where: { clientId: "jfp_changelog_local" },
      })
      const production = await prisma.appEnvironment.findUniqueOrThrow({
        where: { clientId: "jfp_changelog_production" },
      })
      async function grant(environment: typeof local, scopes: string[]) {
        return prisma.appGrant.create({
          data: {
            appId: environment.appId,
            environmentId: environment.id,
            userId: recipient.id,
            subjectType: "USER",
            status: "APPROVED",
            scopes: {
              create: await Promise.all(
                scopes.map(async (key) => ({
                  scopeId: (
                    await prisma.scope.findUniqueOrThrow({ where: { key } })
                  ).id,
                })),
              ),
            },
          },
        })
      }
      const mixed = await grant(local, [
        "changelog:submit",
        "changelog:read",
        "profile:read",
      ])
      const reader = await grant(local, ["changelog:read"])
      const otherEnvironment = await grant(production, ["changelog:submit"])
      const contributorOnly = await grant(local, ["changelog:submit"])
      const unrelatedEnvironment = await prisma.appEnvironment.findFirstOrThrow(
        { where: { kind: "LOCAL", app: { key: "admin" } } },
      )
      const unrelated = await grant(unrelatedEnvironment, ["admin:access"])
      const token = String(exchanged.body.access_token)
      const request = (
        body: Record<string, string> = {
          clientId: "jfp_changelog_local",
          recipientId: recipient.id,
        },
        credential = token,
      ) =>
        new Request("http://localhost:3004/api/changelog/contributors", {
          method: "POST",
          headers: {
            authorization: `Bearer ${credential}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        })
      try {
        const list = (credential = token, client = "jfp_changelog_local") =>
          GET(
            new Request(
              `http://localhost:3004/api/changelog/contributors?clientId=${client}`,
              { headers: { authorization: `Bearer ${credential}` } },
            ),
          )
        expect((await list()).status).toBe(200)
        await prisma.user.update({
          where: { id: userId },
          data: { membershipStatus: "SUSPENDED" },
        })
        expect((await list()).status).toBe(403)
        expect((await POST(request())).status).toBe(403)
        await prisma.user.update({
          where: { id: userId },
          data: { membershipStatus: "ACTIVE" },
        })
        const actorSessionId = String(decodeJwtPayload(token).sid)
        const actorSession = await prisma.session.findUniqueOrThrow({
          where: { id: actorSessionId },
        })
        await prisma.session.update({
          where: { id: actorSessionId },
          data: { expiresAt: new Date(0) },
        })
        expect((await list()).status).toBe(403)
        expect((await POST(request())).status).toBe(403)
        await prisma.session.update({
          where: { id: actorSessionId },
          data: { expiresAt: actorSession.expiresAt },
        })
        vi.useFakeTimers({ toFake: ["Date"] })
        vi.setSystemTime(new Date(Date.now() + 7_200_000))
        try {
          expect((await list()).status).toBe(403)
          expect((await POST(request())).status).toBe(403)
        } finally {
          vi.useRealTimers()
        }
        for (const credential of [
          "",
          "forged",
          token.slice(0, -8) + "AAAAAAAA",
          String(exchanged.body.id_token),
        ]) {
          expect((await list(credential)).status).toBeGreaterThanOrEqual(400)
          expect(
            (await POST(request(undefined, credential))).status,
          ).toBeGreaterThanOrEqual(400)
        }
        process.env.AUTH_CHANGELOG_PRODUCTION_ENABLED = "true"
        expect((await list(token, "jfp_changelog_production")).status).toBe(403)
        expect(
          (
            await POST(
              request({
                clientId: "jfp_changelog_production",
                recipientId: recipient.id,
              }),
            )
          ).status,
        ).toBe(403)
        process.env.AUTH_CHANGELOG_PRODUCTION_ENABLED = "false"
        for (const field of [
          "application",
          "scope",
          "subject",
          "environment",
        ]) {
          expect(
            (
              await POST(
                request({
                  clientId: "jfp_changelog_local",
                  recipientId: recipient.id,
                  [field]: "forged",
                }),
              )
            ).status,
          ).toBe(400)
        }
        await prisma.appGrantScope.deleteMany({
          where: { grantId, scopeId: adminScope.id },
        })
        expect((await list()).status).toBe(403)
        expect((await POST(request())).status).toBe(403)
        const readerAuthorization = await authorize({
          requestedClientId: "jfp_changelog_local",
          redirectUri: SEEDED_REDIRECT_URI,
          resource: null,
          scope: "openid changelog:read",
        })
        const readerCode = await authorizationCode(readerAuthorization.response)
        const readerToken = await postToken(
          new URLSearchParams({
            grant_type: "authorization_code",
            client_id: "jfp_changelog_local",
            code: readerCode,
            code_verifier: readerAuthorization.verifier,
            redirect_uri: SEEDED_REDIRECT_URI,
          }),
        )
        expect(readerToken.response.status).toBe(200)
        await prisma.appGrantScope.create({
          data: { grantId, scopeId: adminScope.id },
        })
        expect((await list(String(readerToken.body.access_token))).status).toBe(
          403,
        )
        expect(
          (
            await POST(
              request(undefined, String(readerToken.body.access_token)),
            )
          ).status,
        ).toBe(403)
        // The recipient became Admin AFTER the list was loaded.
        const promoted = await grant(local, ["changelog:admin"])
        expect((await POST(request())).status).toBe(409)
        const promotedList = await (await list()).json()
        expect(
          promotedList.contributors.find(
            (person: { id: string }) => person.id === recipient.id,
          ).canRevoke,
        ).toBe(false)
        await prisma.appGrant.delete({ where: { id: promoted.id } })
        const actorCookie = cookie
        let issued, stale
        try {
          cookie = recipientCookie
          const recipientAuthorization = await authorize()
          const recipientCode = await authorizationCode(
            recipientAuthorization.response,
          )
          issued = await postToken(
            new URLSearchParams({
              grant_type: "authorization_code",
              client_id: clientId,
              code: recipientCode,
              code_verifier: recipientAuthorization.verifier,
              redirect_uri: REDIRECT_URI,
              resource: LOCAL_RESOURCE,
            }),
          )
          expect(issued.response.status).toBe(200)
          expect(issued.body.scope).toBe(
            "openid changelog:read changelog:submit",
          )
          const staleAuthorization = await authorize()
          stale = {
            code: await authorizationCode(staleAuthorization.response),
            verifier: staleAuthorization.verifier,
          }
        } finally {
          cookie = actorCookie
        }
        let unlock!: () => void
        let ready!: () => void
        const held = new Promise<void>((resolve) => {
          unlock = resolve
        })
        const locked = new Promise<void>((resolve) => {
          ready = resolve
        })
        const lock = prisma.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT id FROM app_environment WHERE id = ${local.id} FOR UPDATE`
            ready()
            await held
          },
          { timeout: 10_000 },
        )
        await locked
        const started = Date.now()
        try {
          expect((await POST(request())).status).toBe(503)
          expect(Date.now() - started).toBeLessThan(9000)
        } finally {
          unlock()
          await lock
        }
        const revoked = await POST(request())
        expect(revoked.status).toBe(200)
        const remaining = await prisma.appGrant.findMany({
          where: { userId: recipient.id },
          include: { scopes: { include: { scope: true } } },
        })
        const scopesFor = (id: string) =>
          remaining
            .find((item) => item.id === id)!
            .scopes.map(({ scope }) => scope.key)
            .sort()
        expect(scopesFor(mixed.id)).toEqual(["changelog:read", "profile:read"])
        expect(scopesFor(reader.id)).toEqual(["changelog:read"])
        expect(scopesFor(otherEnvironment.id)).toEqual(["changelog:submit"])
        expect(scopesFor(contributorOnly.id)).toEqual([])
        expect(scopesFor(unrelated.id)).toEqual(["admin:access"])
        const rejectedExchange = await postToken(
          new URLSearchParams({
            grant_type: "authorization_code",
            client_id: clientId,
            code: stale.code,
            code_verifier: stale.verifier,
            redirect_uri: REDIRECT_URI,
            resource: LOCAL_RESOURCE,
          }),
        )
        expect(rejectedExchange.response.status).toBe(400)
        const rejectedRefresh = await postToken(
          new URLSearchParams({
            grant_type: "refresh_token",
            client_id: clientId,
            refresh_token: String(issued.body.refresh_token),
          }),
        )
        expect(rejectedRefresh.response.status).toBe(400)
        expect(
          (await (await list()).json()).contributors.some(
            (person: { id: string }) => person.id === recipient.id,
          ),
        ).toBe(false)
        expect(await (await POST(request())).json()).toEqual({ changed: false })
      } finally {
        await prisma.user.delete({ where: { id: recipient.id } })
      }
    } finally {
      await prisma.appGrantScope.deleteMany({
        where: { grantId, scopeId: adminScope.id },
      })
    }
  }, 20_000)

  async function authorize({
    requestedClientId = clientId,
    redirectUri = REDIRECT_URI,
    resource = LOCAL_RESOURCE,
    scope = "openid offline_access changelog:read changelog:submit changelog:admin",
  }: {
    requestedClientId?: string
    redirectUri?: string
    resource?: string | null
    scope?: string | null
  } = {}) {
    const pkce = pkcePair()
    const url = new URL("http://localhost:3004/api/auth/oauth2/authorize")
    const params = new URLSearchParams({
      response_type: "code",
      client_id: requestedClientId,
      redirect_uri: redirectUri,
      code_challenge: pkce.challenge,
      code_challenge_method: "S256",
      state: "integration-state",
    })
    if (requestedClientId === clientId) params.set("prompt", "consent")
    if (scope != null) params.set("scope", scope)
    if (resource != null) params.set("resource", resource)
    url.search = params.toString()
    const response = await routeGet(
      new Request(url, { headers: { cookie }, redirect: "manual" }),
      { params: Promise.resolve({ all: ["oauth2", "authorize"] }) },
    )
    return { response, verifier: pkce.verifier }
  }

  async function acceptConsent(response: Response) {
    const consentLocation = response.headers.get("location")
    if (!consentLocation) throw new Error("Authorization omitted consent URL")
    const consentUrl = new URL(consentLocation, process.env.AUTH_BASE_URL)
    expect(consentUrl.pathname).toBe("/oauth/consent")

    const { default: OAuthConsentPage } =
      await import("@/app/oauth/consent/page")
    const rendered = (await OAuthConsentPage({
      searchParams: Promise.resolve(
        Object.fromEntries(consentUrl.searchParams.entries()),
      ),
    })) as { props: Record<string, unknown> }
    expect(rendered.props).toMatchObject({
      target: { environment: "Local", resource: LOCAL_RESOURCE },
      unverifiedDynamicClient: true,
    })

    const accepted = await routePost(
      new Request("http://localhost:3004/api/auth/oauth2/consent", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({
          accept: true,
          oauth_query: consentUrl.searchParams.toString(),
          scope: consentUrl.searchParams.get("scope"),
        }),
      }),
      { params: Promise.resolve({ all: ["oauth2", "consent"] }) },
    )
    expect(accepted.status).toBe(200)
    const body = (await accepted.json()) as { url?: string }
    if (!body.url) throw new Error("Consent response omitted callback URL")
    return body.url
  }

  async function authorizationCode(response: Response) {
    const location = response.headers.get("location")
    if (!location) throw new Error("Authorization response omitted location")
    const url = new URL(location, process.env.AUTH_BASE_URL)
    const callback =
      url.pathname === "/oauth/consent"
        ? new URL(await acceptConsent(response))
        : url
    const code = callback.searchParams.get("code")
    if (!code) throw new Error(`Authorization failed: ${callback}`)
    return code
  }

  async function postToken(body: URLSearchParams) {
    const response = await routePost(
      new Request("http://localhost:3004/api/auth/oauth2/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      }),
      { params: Promise.resolve({ all: ["oauth2", "token"] }) },
    )
    return {
      response,
      body: (await response.json()) as Record<string, unknown>,
    }
  }

  async function tokenRowsSnapshot() {
    const [accessTokens, refreshTokens] = await Promise.all([
      prisma.oauthAccessToken.findMany({
        where: { clientId },
        orderBy: { id: "asc" },
      }),
      prisma.oauthRefreshToken.findMany({
        where: { clientId },
        orderBy: { id: "asc" },
      }),
    ])

    return {
      accessTokens: accessTokens.map(({ token, ...row }) => ({
        ...row,
        tokenDigest: digestToken(token),
      })),
      refreshTokens: refreshTokens.map(
        ({ token, rotationReplayResponse, ...row }) => ({
          ...row,
          tokenDigest: digestToken(token),
          rotationReplayResponseDigest: rotationReplayResponse
            ? digestToken(rotationReplayResponse)
            : null,
        }),
      ),
    }
  }

  it("downscopes, binds the exact resource, and revalidates refresh before writes", async () => {
    const denied = await authorize()
    const deniedLocation = denied.response.headers.get("location")
    if (!deniedLocation) throw new Error("Authorization omitted consent URL")
    const deniedConsentUrl = new URL(deniedLocation, process.env.AUTH_BASE_URL)
    const rejectedConsent = await routePost(
      new Request("http://localhost:3004/api/auth/oauth2/consent", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          accept: false,
          oauth_query: deniedConsentUrl.searchParams.toString(),
        }),
      }),
      { params: Promise.resolve({ all: ["oauth2", "consent"] }) },
    )
    expect(rejectedConsent.status).toBe(200)
    const rejectedConsentBody = (await rejectedConsent.json()) as {
      url?: string
    }
    const rejectedConsentCallback = new URL(
      rejectedConsentBody.url ?? "http://invalid",
    )
    expect(rejectedConsentCallback.searchParams.get("error")).toBe(
      "access_denied",
    )
    expect(rejectedConsentCallback.searchParams.get("state")).toBe(
      "integration-state",
    )

    const authorized = await authorize()
    expect(authorized.response.status).toBe(302)
    const code = await authorizationCode(authorized.response)

    const persistedCode = await prisma.verification.findFirstOrThrow({
      where: {
        identifier: createHash("sha256").update(code).digest("base64url"),
      },
    })
    expect(JSON.parse(persistedCode.value)).toMatchObject({
      resource: [LOCAL_RESOURCE],
      query: {
        scope: "openid offline_access changelog:read",
      },
    })

    const exchanged = await postToken(
      new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        code_verifier: authorized.verifier,
        redirect_uri: REDIRECT_URI,
        resource: LOCAL_RESOURCE,
      }),
    )
    expect(exchanged.response.status).toBe(200)
    expect(exchanged.response.headers.get("cache-control")).toBe("no-store")
    expect(exchanged.body.scope).toBe("openid changelog:read")
    const claims = decodeJwtPayload(String(exchanged.body.access_token))
    expect(claims).toMatchObject({
      azp: clientId,
      "https://jesusfilm.org/claims/environment": "local",
      "https://jesusfilm.org/claims/app": "changelog",
    })
    expect(claims.aud).toEqual(expect.arrayContaining([LOCAL_RESOURCE]))
    expect(claims.aud).not.toEqual(
      expect.arrayContaining([PRODUCTION_RESOURCE]),
    )

    const refreshed = await postToken(
      new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: String(exchanged.body.refresh_token),
      }),
    )
    expect(refreshed.response.status, JSON.stringify(refreshed.body)).toBe(200)
    expect(refreshed.response.headers.get("cache-control")).toBe("no-store")
    expect(refreshed.body.scope).toBe("openid changelog:read")
    expect(decodeJwtPayload(String(refreshed.body.access_token)).aud).toEqual(
      expect.arrayContaining([LOCAL_RESOURCE]),
    )

    const revocationFamilyAuthorization = await authorize()
    const revocationFamilyCode = await authorizationCode(
      revocationFamilyAuthorization.response,
    )
    const revocationFamily = await postToken(
      new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code: revocationFamilyCode,
        code_verifier: revocationFamilyAuthorization.verifier,
        redirect_uri: REDIRECT_URI,
        resource: LOCAL_RESOURCE,
      }),
    )
    expect(revocationFamily.response.status).toBe(200)

    const staleCodeAuthorization = await authorize()
    const staleCode = await authorizationCode(staleCodeAuthorization.response)
    const tokenRowsBeforeDenial = await tokenRowsSnapshot()
    await prisma.appGrant.update({
      where: { id: grantId },
      data: { status: "REVOKED", revokedAt: new Date() },
    })
    const rejectedExchange = await postToken(
      new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code: staleCode,
        code_verifier: staleCodeAuthorization.verifier,
        redirect_uri: REDIRECT_URI,
        resource: LOCAL_RESOURCE,
      }),
    )
    expect(rejectedExchange.response.status).toBe(400)
    expect(rejectedExchange.body).toMatchObject({ error: "invalid_grant" })
    await expect(tokenRowsSnapshot()).resolves.toEqual(tokenRowsBeforeDenial)

    const rejectedRefresh = await postToken(
      new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: String(revocationFamily.body.refresh_token),
      }),
    )
    expect(rejectedRefresh.response.status).toBe(400)
    expect(rejectedRefresh.body).toMatchObject({ error: "invalid_grant" })
    await expect(tokenRowsSnapshot()).resolves.toEqual(tokenRowsBeforeDenial)
  })

  it("keeps production disabled and rejects cross-resource substitution", async () => {
    await prisma.appGrant.update({
      where: { id: grantId },
      data: { status: "APPROVED", revokedAt: null },
    })
    const local = await authorize()
    const localCode = await authorizationCode(local.response)
    const tokenRowsBeforeSubstitution = await tokenRowsSnapshot()
    const substituted = await postToken(
      new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code: localCode,
        code_verifier: local.verifier,
        redirect_uri: REDIRECT_URI,
        resource: PRODUCTION_RESOURCE,
      }),
    )
    expect(substituted.response.status).toBe(400)
    expect(substituted.body).toMatchObject({ error: "invalid_target" })
    await expect(tokenRowsSnapshot()).resolves.toEqual(
      tokenRowsBeforeSubstitution,
    )

    const productionEnvironment = await prisma.appEnvironment.findFirstOrThrow({
      where: { kind: "PRODUCTION", app: { key: "changelog" } },
      select: { id: true, appId: true },
    })
    const readScope = await prisma.scope.findUniqueOrThrow({
      where: { key: "changelog:read" },
      select: { id: true },
    })
    await prisma.appGrant.create({
      data: {
        appId: productionEnvironment.appId,
        environmentId: productionEnvironment.id,
        subjectType: "USER",
        userId,
        status: "APPROVED",
        approvedAt: new Date(),
        scopes: { create: { scopeId: readScope.id } },
      },
    })
    const verificationRowsBefore = await prisma.verification.count()
    const production = await authorize({ resource: PRODUCTION_RESOURCE })
    expect(production.response.status).toBe(302)
    const productionLocation = new URL(
      production.response.headers.get("location") ?? "http://invalid",
    )
    expect(productionLocation.searchParams.get("error")).toBe("access_denied")
    await expect(prisma.verification.count()).resolves.toBe(
      verificationRowsBefore,
    )
  })

  it("issues a seeded PKCE code with omitted-scope defaults", async () => {
    await prisma.appGrant.update({
      where: { id: grantId },
      data: { status: "APPROVED", revokedAt: null },
    })
    const authorized = await authorize({
      requestedClientId: "jfp_changelog_local",
      redirectUri: SEEDED_REDIRECT_URI,
      resource: null,
      scope: null,
    })
    expect(authorized.response.status).toBe(302)
    const code = await authorizationCode(authorized.response)
    const exchanged = await postToken(
      new URLSearchParams({
        grant_type: "authorization_code",
        client_id: "jfp_changelog_local",
        code,
        code_verifier: authorized.verifier,
        redirect_uri: SEEDED_REDIRECT_URI,
        resource: LOCAL_RESOURCE,
      }),
    )
    expect(exchanged.response.status).toBe(200)
    expect(exchanged.body.scope).toBe(
      "openid profile:read email:read membership:read changelog:read",
    )
  })
})
