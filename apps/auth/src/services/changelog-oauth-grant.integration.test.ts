import { createHash, randomBytes, randomUUID } from "node:crypto"

import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose"

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
// The production gate is parsed once in deployment. Keep it switchable here
// so the same native-provider suite can exercise both deployment postures.
vi.mock("@/config/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/env")>()),
  isChangelogProductionEnabled: () =>
    process.env.AUTH_CHANGELOG_PRODUCTION_ENABLED === "true",
}))

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
process.env.GOOGLE_CLIENT_ID = "preapproval-google-client"
process.env.GOOGLE_CLIENT_SECRET = "preapproval-google-secret"
let googleKey: JWK
let googlePrivateKey: CryptoKey
let googleCallbackToken = ""

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
      if (String(input) === "https://oauth2.googleapis.com/token")
        return Promise.resolve(
          Response.json({
            access_token: "test-google-access",
            token_type: "Bearer",
            expires_in: 3600,
            id_token: googleCallbackToken,
          }),
        )
      if (String(input) === "https://www.googleapis.com/oauth2/v3/certs")
        return Promise.resolve(Response.json({ keys: [googleKey] }))
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
    const keys = await generateKeyPair("RS256")
    googlePrivateKey = keys.privateKey
    googleKey = {
      ...(await exportJWK(keys.publicKey)),
      kid: "preapproval-key",
      alg: "RS256",
    }
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
      await prisma.changelogPreapproval.deleteMany({
        where: { approverId: userId },
      })
      await prisma.session.deleteMany({ where: { userId } })
      await prisma.user.deleteMany({ where: { id: userId } })
    }
    await prisma.$disconnect()
  })

  it("redeems an active Google recipient before website access and retains Contributor through password sign-in", async () => {
    const environment = await prisma.appEnvironment.findUniqueOrThrow({
      where: { clientId: "jfp_changelog_local" },
    })
    const adminScope = await prisma.scope.findUniqueOrThrow({
      where: { key: "changelog:admin" },
    })
    await prisma.appGrantScope.create({
      data: { grantId, scopeId: adminScope.id },
    })
    const email = `redeem-${randomUUID()}@gmail.com`
    const password = `Test-${randomUUID()}!`
    const signup = await auth.api.signUpEmail({
      asResponse: true,
      body: { name: "Recipient", email, password },
    })
    const recipient = (await signup.json()) as { user: { id: string } }
    const recipientId = recipient.user.id
    await prisma.user.update({
      where: { id: recipientId },
      data: { membershipStatus: "ACTIVE", emailVerified: true },
    })
    const approvalId = randomUUID()
    await prisma.changelogPreapproval.create({
      data: {
        id: approvalId,
        email,
        environmentId: environment.id,
        approverId: userId,
        expiresAt: new Date(Date.now() + 86400000),
      },
    })
    try {
      const token = await new SignJWT({
        email,
        email_verified: true,
        name: "Recipient",
      })
        .setProtectedHeader({ alg: "RS256", kid: "preapproval-key" })
        .setSubject(recipientId)
        .setIssuer("https://accounts.google.com")
        .setAudience("preapproval-google-client")
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(googlePrivateKey)
      googleCallbackToken = token
      const start = await auth.api.signInSocial({
        asResponse: true,
        body: { provider: "google", callbackURL: "http://localhost:3004" },
      })
      const providerUrl = new URL((await start.json()).url)
      const stateCookie = start.headers.get("set-cookie")!.split(";")[0]
      const callback = await routeGet(
        new Request(
          `http://localhost:3004/api/auth/callback/google?code=test-google-code&state=${providerUrl.searchParams.get("state")}`,
          { headers: { cookie: stateCookie } },
        ),
        { params: Promise.resolve({ all: ["callback", "google"] }) },
      )
      const recipientCookie = callback.headers
        .getSetCookie()
        .find((value) => value.startsWith("better-auth.session_token="))
        ?.split(";")[0]
      expect(recipientCookie).toBeTruthy()
      const flow = await authorize({
        requestedClientId: "jfp_changelog_local",
        redirectUri: SEEDED_REDIRECT_URI,
        resource: null,
        scope: "openid changelog:read changelog:submit changelog:admin",
        sessionCookie: recipientCookie,
      })
      const code = await authorizationCode(flow.response, recipientCookie)
      const exchanged = await postToken(
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: "jfp_changelog_local",
          redirect_uri: SEEDED_REDIRECT_URI,
          code,
          code_verifier: flow.verifier,
        }),
      )
      expect(exchanged.response.status).toBe(200)
      expect(String(exchanged.body.scope).split(" ")).toEqual(
        expect.arrayContaining(["changelog:submit", "changelog:read"]),
      )
      expect(String(exchanged.body.scope)).not.toContain("changelog:admin")
      expect(
        await prisma.changelogPreapproval.findUnique({
          where: { id: approvalId },
        }),
      ).toMatchObject({
        state: "redeemed",
        redeemedById: recipientId,
        redeemedAt: expect.any(Date),
      })
      const passwordSignin = await auth.api.signInEmail({
        asResponse: true,
        body: { email, password },
      })
      const passwordCookie = passwordSignin.headers
        .get("set-cookie")!
        .split(";")[0]
      await prisma.user.update({
        where: { id: recipientId },
        data: { email: `renamed-${email}` },
      })
      const linked = await authorize({ sessionCookie: passwordCookie })
      const linkedCode = await authorizationCode(
        linked.response,
        passwordCookie,
      )
      const linkedTokens = await postToken(
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          redirect_uri: REDIRECT_URI,
          resource: LOCAL_RESOURCE,
          code: linkedCode,
          code_verifier: linked.verifier,
        }),
      )
      expect(linkedTokens.response.status).toBe(200)
      expect(String(linkedTokens.body.scope)).toContain("changelog:submit")
      const other = await auth.api.signUpEmail({
        asResponse: true,
        body: { name: "Different identity", email, password },
      })
      const otherId = (await other.json()).user.id as string
      try {
        await prisma.user.update({
          where: { id: otherId },
          data: { membershipStatus: "ACTIVE" },
        })
        const otherCookie = other.headers.get("set-cookie")!.split(";")[0]
        expect(
          (
            await authorize({ sessionCookie: otherCookie })
          ).response.headers.get("location"),
        ).toContain("access_denied")
      } finally {
        await prisma.user.delete({ where: { id: otherId } })
      }
    } finally {
      await prisma.changelogPreapproval.deleteMany({
        where: { id: approvalId },
      })
      await prisma.user.delete({ where: { id: recipientId } })
      await prisma.appGrantScope.deleteMany({
        where: { grantId, scopeId: adminScope.id },
      })
    }
  })

  it.each([
    "external-email",
    "unverified-workspace",
    "password",
    "missing",
    "mismatch",
    "canceled",
    "expired",
    "redeemed",
    "INVITED",
    "SUSPENDED",
    "DISABLED",
    "expired-identity",
    "AGENT",
    "unlinked",
    "expired-session",
    "changed-google-email",
    "environment-disabled",
    "application-disabled",
    "approver-loss",
    "wrong-environment",
    "production-disabled",
    "unrelated-application",
  ])(
    "leaves access and unused approvals unchanged for %s",
    async (scenario) => {
      const recipient = await preapprovedRecipient(
        scenario === "external-email" || scenario === "unverified-workspace"
          ? "external.test"
          : "gmail.com",
      )
      try {
        if (scenario === "unverified-workspace")
          await googleCookie(recipient.id, recipient.email)
        let recipientCookie = recipient.passwordCookie
        if (scenario !== "password")
          recipientCookie = await googleCookie(
            recipient.id,
            recipient.email,
            scenario === "unverified-workspace"
              ? { email_verified: false, hd: "external.test" }
              : {},
          )
        if (["INVITED", "SUSPENDED", "DISABLED"].includes(scenario))
          await prisma.user.update({
            where: { id: recipient.id },
            data: {
              membershipStatus: scenario as
                | "INVITED"
                | "SUSPENDED"
                | "DISABLED",
            },
          })
        if (scenario === "expired-identity")
          await prisma.user.update({
            where: { id: recipient.id },
            data: { expiresAt: new Date(0) },
          })
        if (scenario === "AGENT")
          await prisma.user.update({
            where: { id: recipient.id },
            data: { actorType: "AGENT" },
          })
        if (scenario === "unlinked")
          await prisma.account.deleteMany({
            where: { userId: recipient.id, providerId: "google" },
          })
        if (scenario === "expired-session")
          await prisma.session.updateMany({
            where: { userId: recipient.id },
            data: { expiresAt: new Date(0) },
          })
        if (scenario === "changed-google-email")
          await prisma.user.update({
            where: { id: recipient.id },
            data: { email: `changed-${recipient.email}` },
          })
        if (scenario === "environment-disabled")
          await prisma.appEnvironment.update({
            where: { id: recipient.environmentId },
            data: { status: "REVOKED" },
          })
        if (scenario === "application-disabled")
          await prisma.registeredApp.update({
            where: { key: "changelog" },
            data: { status: "SUSPENDED" },
          })
        if (scenario === "missing")
          await prisma.changelogPreapproval.delete({
            where: { id: recipient.approvalId },
          })
        if (scenario === "mismatch")
          await prisma.changelogPreapproval.update({
            where: { id: recipient.approvalId },
            data: { email: `other-${recipient.email}` },
          })
        if (scenario === "canceled")
          await prisma.changelogPreapproval.update({
            where: { id: recipient.approvalId },
            data: { state: "canceled" },
          })
        if (scenario === "expired")
          await prisma.changelogPreapproval.update({
            where: { id: recipient.approvalId },
            data: { expiresAt: new Date(0) },
          })
        if (scenario === "redeemed")
          await prisma.changelogPreapproval.update({
            where: { id: recipient.approvalId },
            data: {
              state: "redeemed",
              redeemedAt: new Date(),
              redeemedById: recipient.id,
            },
          })
        // Insert a stale pending approval AFTER authority loss to prove redemption
        // checks authority itself, independently of the cancellation triggers.
        if (scenario === "approver-loss") {
          await prisma.appGrantScope.deleteMany({
            where: { grantId, scopeId: recipient.adminScopeId },
          })
          await prisma.changelogPreapproval.update({
            where: { id: recipient.approvalId },
            data: { state: "pending" },
          })
        }
        if (scenario === "production-disabled") {
          const production = await prisma.appEnvironment.findUniqueOrThrow({
            where: { clientId: "jfp_changelog_production" },
          })
          await prisma.changelogPreapproval.update({
            where: { id: recipient.approvalId },
            data: { environmentId: production.id },
          })
        }
        const result = await authorize({
          sessionCookie: recipientCookie,
          ...(scenario === "wrong-environment" ||
          scenario === "production-disabled"
            ? { resource: PRODUCTION_RESOURCE }
            : {}),
          ...(scenario === "unrelated-application"
            ? { resource: "https://admin.jesusfilm.org/mcp" }
            : {}),
        })
        if (
          scenario !== "unrelated-application" &&
          scenario !== "expired-session" &&
          scenario !== "AGENT"
        )
          expect(
            result.response.headers.get("location") ??
              (await result.response.text()),
          ).toContain("access_denied")
        expect(
          await prisma.appGrant.count({ where: { userId: recipient.id } }),
        ).toBe(0)
        const approval = await prisma.changelogPreapproval.findUnique({
          where: { id: recipient.approvalId },
        })
        if (scenario !== "redeemed")
          expect(approval?.redeemedAt ?? null).toBeNull()
        if (scenario === "password") {
          const qualified = await authorize({
            sessionCookie: await googleCookie(recipient.id, recipient.email),
          })
          expect(qualified.response.headers.get("location")).toContain(
            "/oauth/consent",
          )
          expect(
            await prisma.changelogPreapproval.findUnique({
              where: { id: recipient.approvalId },
            }),
          ).toMatchObject({ state: "redeemed" })
        }
      } finally {
        if (scenario === "environment-disabled")
          await prisma.appEnvironment.update({
            where: { id: recipient.environmentId },
            data: { status: "APPROVED" },
          })
        if (scenario === "application-disabled")
          await prisma.registeredApp.update({
            where: { key: "changelog" },
            data: { status: "ACTIVE" },
          })
        await recipient.cleanup()
      }
    },
  )

  it("redeems Workspace MCP access, exposes history, and requires fresh approval after Contributor revocation", async () => {
    const recipient = await preapprovedRecipient("workspace.test")
    try {
      const recipientCookie = await googleCookie(
        recipient.id,
        recipient.email,
        { hd: "workspace.test" },
      )
      const flow = await authorize({ sessionCookie: recipientCookie })
      const code = await authorizationCode(flow.response, recipientCookie)
      const exchanged = await postToken(
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          redirect_uri: REDIRECT_URI,
          resource: LOCAL_RESOURCE,
          code,
          code_verifier: flow.verifier,
        }),
      )
      expect(exchanged.response.status).toBe(200)
      expect(String(exchanged.body.scope).split(" ").sort()).toEqual([
        "changelog:read",
        "changelog:submit",
        "openid",
      ])
      const headers = await adminHeaders()
      const approvals = await import("@/app/api/changelog/preapprovals/route")
      const contributors =
        await import("@/app/api/changelog/contributors/route")
      const list = () =>
        approvals.GET(
          new Request(
            "http://localhost:3004/api/changelog/preapprovals?clientId=jfp_changelog_local",
            { headers },
          ),
        )
      expect(await (await list()).json()).toMatchObject({
        preapprovals: expect.arrayContaining([
          expect.objectContaining({
            id: recipient.approvalId,
            state: "redeemed",
            redeemedById: recipient.id,
            redeemedAt: expect.any(String),
          }),
        ]),
      })
      const current = await contributors.GET(
        new Request(
          "http://localhost:3004/api/changelog/contributors?clientId=jfp_changelog_local",
          { headers },
        ),
      )
      expect(await current.json()).toMatchObject({
        contributors: expect.arrayContaining([
          expect.objectContaining({ id: recipient.id, canRevoke: true }),
        ]),
      })
      // Approver authority loss cannot revoke an already redeemed grant.
      await prisma.appGrantScope.deleteMany({
        where: { grantId, scopeId: recipient.adminScopeId },
      })
      expect(
        (
          await authorize({ sessionCookie: recipient.passwordCookie })
        ).response.headers.get("location"),
      ).toContain("/oauth/consent")
      await prisma.appGrantScope.create({
        data: { grantId, scopeId: recipient.adminScopeId },
      })
      const revoked = await contributors.POST(
        new Request("http://localhost:3004/api/changelog/contributors", {
          method: "POST",
          headers,
          body: JSON.stringify({
            clientId: "jfp_changelog_local",
            recipientId: recipient.id,
          }),
        }),
      )
      expect(revoked.status).toBe(200)
      for (const sessionCookie of [recipientCookie, recipient.passwordCookie])
        expect(
          (await authorize({ sessionCookie })).response.headers.get("location"),
        ).toContain("access_denied")
      expect(await (await list()).json()).toMatchObject({
        preapprovals: expect.arrayContaining([
          expect.objectContaining({
            id: recipient.approvalId,
            state: "redeemed",
          }),
        ]),
      })
      const freshId = randomUUID()
      const created = await approvals.POST(
        new Request("http://localhost:3004/api/changelog/preapprovals", {
          method: "POST",
          headers,
          body: JSON.stringify({
            clientId: "jfp_changelog_local",
            action: "create",
            id: freshId,
            email: recipient.email,
          }),
        }),
      )
      expect(created.status).toBe(200)
      expect(
        (
          await authorize({ sessionCookie: recipient.passwordCookie })
        ).response.headers.get("location"),
      ).toContain("access_denied")
      expect(
        (
          await authorize({ sessionCookie: recipientCookie })
        ).response.headers.get("location"),
      ).toContain("/oauth/consent")
      expect(await (await list()).json()).toMatchObject({
        preapprovals: expect.arrayContaining([
          expect.objectContaining({
            id: freshId,
            state: "redeemed",
            redeemedById: recipient.id,
          }),
        ]),
      })
    } finally {
      await recipient.cleanup()
    }
  })

  it("cancels unused preapprovals when revoking an existing Contributor and requires a fresh approval", async () => {
    const recipient = await preapprovedRecipient("gmail.com")
    try {
      const submitScope = await prisma.scope.findUniqueOrThrow({
        where: { key: "changelog:submit" },
      })
      await prisma.appGrant.create({
        data: {
          appId: (
            await prisma.appEnvironment.findUniqueOrThrow({
              where: { id: recipient.environmentId },
            })
          ).appId,
          environmentId: recipient.environmentId,
          subjectType: "USER",
          userId: recipient.id,
          status: "APPROVED",
          scopes: { create: { scopeId: submitScope.id } },
        },
      })
      // Password authorization cannot redeem the outstanding Google approval.
      expect(
        (
          await authorize({ sessionCookie: recipient.passwordCookie })
        ).response.headers.get("location"),
      ).toContain("/oauth/consent")
      const approval = await prisma.changelogPreapproval.findUniqueOrThrow({
        where: { id: recipient.approvalId },
      })
      expect(approval.state).toBe("pending")
      const headers = await adminHeaders()
      const contributors =
        await import("@/app/api/changelog/contributors/route")
      const revoked = await contributors.POST(
        new Request("http://localhost:3004/api/changelog/contributors", {
          method: "POST",
          headers,
          body: JSON.stringify({
            clientId: "jfp_changelog_local",
            recipientId: recipient.id,
          }),
        }),
      )
      expect(revoked.status).toBe(200)
      expect(await revoked.json()).toMatchObject({ changed: true })
      expect(
        await prisma.changelogPreapproval.findUniqueOrThrow({
          where: { id: recipient.approvalId },
        }),
      ).toMatchObject({
        state: "canceled",
        version: approval.version + 1,
        redeemedAt: null,
        redeemedById: null,
      })
      const googleSession = await googleCookie(recipient.id, recipient.email)
      for (const sessionCookie of [googleSession, recipient.passwordCookie])
        expect(
          (await authorize({ sessionCookie })).response.headers.get("location"),
        ).toContain("access_denied")

      const approvals = await import("@/app/api/changelog/preapprovals/route")
      const freshId = randomUUID()
      const created = await approvals.POST(
        new Request("http://localhost:3004/api/changelog/preapprovals", {
          method: "POST",
          headers,
          body: JSON.stringify({
            clientId: "jfp_changelog_local",
            action: "create",
            id: freshId,
            email: recipient.email,
          }),
        }),
      )
      expect(created.status).toBe(200)
      expect(
        (
          await authorize({ sessionCookie: googleSession })
        ).response.headers.get("location"),
      ).toContain("/oauth/consent")
      expect(
        await prisma.changelogPreapproval.findUniqueOrThrow({
          where: { id: freshId },
        }),
      ).toMatchObject({ state: "redeemed", redeemedById: recipient.id })
      expect(
        await prisma.changelogPreapproval.findUniqueOrThrow({
          where: { id: recipient.approvalId },
        }),
      ).toMatchObject({ state: "canceled" })
    } finally {
      await recipient.cleanup()
    }
  })

  it("serializes simultaneous redemptions and consumes duplicate approvals without duplicate grants", async () => {
    const recipient = await preapprovedRecipient("gmail.com")
    try {
      const recipientCookie = await googleCookie(recipient.id, recipient.email)
      await prisma.changelogPreapproval.create({
        data: {
          id: randomUUID(),
          email: recipient.email,
          environmentId: recipient.environmentId,
          approverId: userId,
          expiresAt: new Date(Date.now() + 86400000),
        },
      })
      const attempts = await Promise.all([
        authorize({ sessionCookie: recipientCookie }),
        authorize({ sessionCookie: recipientCookie }),
      ])
      expect(
        attempts.some(({ response }) =>
          response.headers.get("location")?.includes("/oauth/consent"),
        ),
      ).toBe(true)
      expect(
        (
          await authorize({ sessionCookie: recipientCookie })
        ).response.headers.get("location"),
      ).toContain("/oauth/consent")
      expect(
        await prisma.appGrant.count({ where: { userId: recipient.id } }),
      ).toBe(1)
      expect(
        await prisma.changelogPreapproval.count({
          where: { email: recipient.email, state: "redeemed" },
        }),
      ).toBe(2)
      const headers = await adminHeaders()
      const { POST } = await import("@/app/api/changelog/contributors/route")
      expect(
        (
          await POST(
            new Request("http://localhost:3004/api/changelog/contributors", {
              method: "POST",
              headers,
              body: JSON.stringify({
                clientId: "jfp_changelog_local",
                recipientId: recipient.id,
              }),
            }),
          )
        ).status,
      ).toBe(200)
      expect(
        (
          await authorize({ sessionCookie: recipientCookie })
        ).response.headers.get("location"),
      ).toContain("access_denied")
    } finally {
      await recipient.cleanup()
    }
  })

  it("rolls back the grant if redemption persistence fails", async () => {
    const recipient = await preapprovedRecipient("gmail.com")
    try {
      const recipientCookie = await googleCookie(recipient.id, recipient.email)
      // A real persistence failure AFTER grant insertion, without mocking Auth.
      await prisma.$executeRawUnsafe(
        `CREATE FUNCTION fail_test_redemption() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = '${recipient.approvalId}' AND NEW.state = 'redeemed' THEN RAISE EXCEPTION 'test redemption failure'; END IF; RETURN NEW; END $$`,
      )
      await prisma.$executeRawUnsafe(
        "CREATE TRIGGER fail_test_redemption BEFORE UPDATE ON changelog_preapproval FOR EACH ROW EXECUTE FUNCTION fail_test_redemption()",
      )
      expect(
        (
          await authorize({ sessionCookie: recipientCookie })
        ).response.headers.get("location"),
      ).toContain("access_denied")
      expect(
        await prisma.appGrant.count({ where: { userId: recipient.id } }),
      ).toBe(0)
      expect(
        await prisma.changelogPreapproval.findUnique({
          where: { id: recipient.approvalId },
        }),
      ).toMatchObject({ state: "pending", redeemedAt: null })
    } finally {
      await prisma.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS fail_test_redemption ON changelog_preapproval",
      )
      await prisma.$executeRawUnsafe(
        "DROP FUNCTION IF EXISTS fail_test_redemption()",
      )
      await recipient.cleanup()
    }
  })

  it.each(["recipient", "approver", "cancellation"])(
    "cannot redeem across concurrent %s lifecycle change",
    async (subject) => {
      const recipient = await preapprovedRecipient("gmail.com")
      let release!: () => void
      let ready!: () => void
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      const locked = new Promise<void>((resolve) => {
        ready = resolve
      })
      let writer: Promise<unknown> | undefined
      try {
        const recipientCookie = await googleCookie(
          recipient.id,
          recipient.email,
        )
        writer = prisma.$transaction(
          async (tx) => {
            await tx.appEnvironment.update({
              where: { id: recipient.environmentId },
              data: { updatedAt: new Date() },
            })
            ready()
            await held
            if (subject === "cancellation")
              await tx.changelogPreapproval.update({
                where: { id: recipient.approvalId },
                data: { state: "canceled" },
              })
            else
              await tx.user.update({
                where: { id: subject === "recipient" ? recipient.id : userId },
                data: { membershipStatus: "SUSPENDED" },
              })
          },
          { timeout: 10000 },
        )
        await locked
        const authorization = authorize({ sessionCookie: recipientCookie })
        // Wait until the real PostgreSQL writer is blocking redemption's UPDATE.
        for (let attempt = 0; attempt < 100; attempt++) {
          const blocked = await prisma.$queryRaw<
            { count: bigint }[]
          >`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE 'UPDATE app_environment SET updated_at = clock_timestamp()%'
        `
          if (Number(blocked[0].count) > 0) break
          if (attempt === 99)
            throw new Error("Redemption did not reach environment lock")
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
        release()
        await writer
        expect(
          (await authorization).response.headers.get("location"),
        ).toContain("access_denied")
        expect(
          (
            await authorize({ sessionCookie: recipientCookie })
          ).response.headers.get("location"),
        ).toContain("access_denied")
        expect(
          await prisma.appGrant.count({ where: { userId: recipient.id } }),
        ).toBe(0)
        expect(
          await prisma.changelogPreapproval.findUnique({
            where: { id: recipient.approvalId },
          }),
        ).not.toMatchObject({ state: "redeemed" })
      } finally {
        release()
        await writer
        await prisma.user.update({
          where: { id: userId },
          data: { membershipStatus: "ACTIVE" },
        })
        await recipient.cleanup()
      }
    },
  )

  it("redeems only the production approval when production issuance is enabled", async () => {
    const recipient = await preapprovedRecipient("gmail.com")
    const production = await prisma.appEnvironment.findUniqueOrThrow({
      where: { clientId: "jfp_changelog_production" },
    })
    const admin = await prisma.appGrant.create({
      data: {
        appId: production.appId,
        environmentId: production.id,
        subjectType: "USER",
        userId,
        status: "APPROVED",
        scopes: { create: { scopeId: recipient.adminScopeId } },
      },
    })
    try {
      await prisma.changelogPreapproval.update({
        where: { id: recipient.approvalId },
        data: { environmentId: production.id },
      })
      const recipientCookie = await googleCookie(recipient.id, recipient.email)
      process.env.AUTH_CHANGELOG_PRODUCTION_ENABLED = "true"
      const flow = await authorize({
        sessionCookie: recipientCookie,
        resource: PRODUCTION_RESOURCE,
      })
      const code = await authorizationCode(flow.response, recipientCookie)
      const result = await postToken(
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          redirect_uri: REDIRECT_URI,
          resource: PRODUCTION_RESOURCE,
          code,
          code_verifier: flow.verifier,
        }),
      )
      expect(result.response.status).toBe(200)
      expect(String(result.body.scope)).toContain("changelog:submit")
      expect(decodeJwtPayload(String(result.body.access_token))).toMatchObject({
        "https://jesusfilm.org/claims/environment": "production",
      })
      expect(
        (
          await authorize({ sessionCookie: recipientCookie })
        ).response.headers.get("location"),
      ).toContain("access_denied")
    } finally {
      process.env.AUTH_CHANGELOG_PRODUCTION_ENABLED = "false"
      await prisma.appGrant.delete({ where: { id: admin.id } })
      await recipient.cleanup()
    }
  })

  async function googleCookie(
    id: string,
    email: string,
    claims: Record<string, unknown> = {},
  ) {
    const token = await new SignJWT({
      email,
      email_verified: true,
      name: "Recipient",
      ...claims,
    })
      .setProtectedHeader({ alg: "RS256", kid: "preapproval-key" })
      .setSubject(id)
      .setIssuer("https://accounts.google.com")
      .setAudience("preapproval-google-client")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(googlePrivateKey)
    const signin = await auth.api.signInSocial({
      asResponse: true,
      body: { provider: "google", idToken: { token } },
    })
    expect(signin.status).toBe(200)
    return signin.headers.get("set-cookie")!.split(";")[0]
  }

  async function adminHeaders() {
    const flow = await authorize({
      requestedClientId: "jfp_changelog_local",
      redirectUri: SEEDED_REDIRECT_URI,
      resource: null,
      scope: "openid changelog:read changelog:submit changelog:admin",
    })
    const code = await authorizationCode(flow.response)
    const exchanged = await postToken(
      new URLSearchParams({
        grant_type: "authorization_code",
        client_id: "jfp_changelog_local",
        redirect_uri: SEEDED_REDIRECT_URI,
        code,
        code_verifier: flow.verifier,
      }),
    )
    expect(exchanged.response.status).toBe(200)
    return {
      authorization: `Bearer ${exchanged.body.access_token}`,
      "content-type": "application/json",
    }
  }

  async function preapprovedRecipient(domain: string) {
    const environment = await prisma.appEnvironment.findUniqueOrThrow({
      where: { clientId: "jfp_changelog_local" },
    })
    const adminScope = await prisma.scope.findUniqueOrThrow({
      where: { key: "changelog:admin" },
    })
    await prisma.appGrantScope.create({
      data: { grantId, scopeId: adminScope.id },
    })
    const email = `recipient-${randomUUID()}@${domain}`
    const password = `Test-${randomUUID()}!`
    const signup = await auth.api.signUpEmail({
      asResponse: true,
      body: { name: "Recipient", email, password },
    })
    const recipient = (await signup.json()) as { user: { id: string } }
    const id = recipient.user.id
    await prisma.user.update({
      where: { id },
      data: { membershipStatus: "ACTIVE", emailVerified: true },
    })
    const signin = await auth.api.signInEmail({
      asResponse: true,
      body: { email, password },
    })
    const passwordCookie = signin.headers.get("set-cookie")!.split(";")[0]
    const approvalId = randomUUID()
    await prisma.changelogPreapproval.create({
      data: {
        id: approvalId,
        email,
        environmentId: environment.id,
        approverId: userId,
        expiresAt: new Date(Date.now() + 86400000),
      },
    })
    return {
      id,
      email,
      passwordCookie,
      approvalId,
      environmentId: environment.id,
      adminScopeId: adminScope.id,
      cleanup: async () => {
        await prisma.changelogPreapproval.deleteMany({ where: { email } })
        await prisma.changelogPreapproval.deleteMany({
          where: { id: approvalId },
        })
        await prisma.user.delete({ where: { id } })
        await prisma.appGrantScope.deleteMany({
          where: { grantId, scopeId: adminScope.id },
        })
      },
    }
  }

  it("persists preapprovals before signup without creating access", async () => {
    const { POST, GET } = await import("@/app/api/changelog/preapprovals/route")
    const scope = await prisma.scope.findUniqueOrThrow({
      where: { key: "changelog:admin" },
    })
    await prisma.appGrantScope.create({ data: { grantId, scopeId: scope.id } })
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
      const headers = {
        authorization: `Bearer ${exchanged.body.access_token}`,
        "content-type": "application/json",
      }
      const email = `preapproval-${randomUUID()}@example.test`
      const id = randomUUID()
      const request = () =>
        new Request("http://localhost:3004/api/changelog/preapprovals", {
          method: "POST",
          headers,
          body: JSON.stringify({
            clientId: "jfp_changelog_local",
            action: "create",
            id,
            email: ` ${email.toUpperCase()} `,
          }),
        })
      const created = await POST(request())
      expect(created.status).toBe(200)
      const approval = await created.json()
      expect(approval).toMatchObject({
        id,
        email,
        state: "pending",
        approverId: userId,
        version: 0,
        redeemedById: null,
      })
      expect(
        Date.parse(approval.expiresAt) - Date.parse(approval.createdAt),
      ).toBe(30 * 24 * 60 * 60 * 1000)
      expect(await (await POST(request())).json()).toEqual(approval)
      const listed = await GET(
        new Request(
          "http://localhost:3004/api/changelog/preapprovals?clientId=jfp_changelog_local",
          { headers },
        ),
      )
      expect((await listed.json()).preapprovals).toContainEqual(approval)
      expect(await prisma.user.findUnique({ where: { email } })).toBeNull()
      const mutate = (action: string, version: number, extra = {}) =>
        POST(
          new Request("http://localhost:3004/api/changelog/preapprovals", {
            method: "POST",
            headers,
            body: JSON.stringify({
              clientId: "jfp_changelog_local",
              action,
              id,
              version,
              ...extra,
            }),
          }),
        )
      const list = () =>
        GET(
          new Request(
            "http://localhost:3004/api/changelog/preapprovals?clientId=jfp_changelog_local",
            { headers },
          ),
        )
      expect(
        (await mutate("cancel", 0, { scope: "changelog:admin" })).status,
      ).toBe(400)
      expect((await mutate("cancel", 0)).status).toBe(200)
      expect((await (await list()).json()).preapprovals).toContainEqual(
        expect.objectContaining({ id, state: "canceled", version: 1 }),
      )
      expect((await mutate("renew", 0)).status).toBe(409)
      expect((await mutate("renew", 1)).status).toBe(200)
      expect((await mutate("cancel", 0)).status).toBe(409)
      const boundary = new Date()
      await prisma.changelogPreapproval.update({
        where: { id },
        data: { expiresAt: boundary },
      })
      vi.useFakeTimers({ toFake: ["Date"] })
      vi.setSystemTime(new Date(boundary.getTime() - 1))
      expect((await (await list()).json()).preapprovals).toContainEqual(
        expect.objectContaining({ id, state: "pending" }),
      )
      vi.setSystemTime(boundary)
      expect((await (await list()).json()).preapprovals).toContainEqual(
        expect.objectContaining({ id, state: "expired" }),
      )
      vi.useRealTimers()
      expect((await mutate("renew", 2)).status).toBe(200)
      // Membership loss must persist cancellation, even if authority is restored
      // before anybody lists or attempts to redeem the approval.
      await prisma.user.update({
        where: { id: userId },
        data: { membershipStatus: "SUSPENDED" },
      })
      expect((await list()).status).toBe(403)
      expect((await mutate("renew", 3)).status).toBe(403)
      await prisma.user.update({
        where: { id: userId },
        data: { membershipStatus: "ACTIVE" },
      })
      expect((await (await list()).json()).preapprovals).toContainEqual(
        expect.objectContaining({ id, state: "canceled", version: 4 }),
      )
      const signup = await auth.api.signUpEmail({
        asResponse: true,
        body: {
          email: `renewing-admin-${randomUUID()}@example.test`,
          name: "Renewing admin",
          password: `Test-${randomUUID()}!`,
        },
      })
      const second = (await signup.json()).user
      const originalCookie = cookie
      const originalCredential = headers.authorization
      const environment = await prisma.appEnvironment.findUniqueOrThrow({
        where: { clientId: "jfp_changelog_local" },
      })
      await prisma.user.update({
        where: { id: second.id },
        data: { membershipStatus: "ACTIVE" },
      })
      const secondGrant = await prisma.appGrant.create({
        data: {
          appId: environment.appId,
          environmentId: environment.id,
          subjectType: "USER",
          userId: second.id,
          status: "APPROVED",
          scopes: { create: { scopeId: scope.id } },
        },
      })
      try {
        cookie = signup.headers.get("set-cookie")!.split(";")[0]
        const authorization = await authorize({
          requestedClientId: "jfp_changelog_local",
          redirectUri: SEEDED_REDIRECT_URI,
          resource: null,
          scope: "openid changelog:read changelog:submit changelog:admin",
        })
        const secondCode = await authorizationCode(authorization.response)
        const secondExchange = await postToken(
          new URLSearchParams({
            grant_type: "authorization_code",
            client_id: "jfp_changelog_local",
            code: secondCode,
            code_verifier: authorization.verifier,
            redirect_uri: SEEDED_REDIRECT_URI,
          }),
        )
        cookie = originalCookie
        headers.authorization = `Bearer ${secondExchange.body.access_token}`
        const renewed = await mutate("renew", 4)
        expect(renewed.status).toBe(200)
        expect(await renewed.json()).toMatchObject({
          approverId: second.id,
          state: "pending",
          version: 5,
        })
        await prisma.appGrantScope.deleteMany({
          where: { grantId, scopeId: scope.id },
        })
        expect((await (await list()).json()).preapprovals).toContainEqual(
          expect.objectContaining({
            id,
            state: "pending",
            approverId: second.id,
          }),
        )
        await prisma.appGrantScope.create({
          data: { grantId, scopeId: scope.id },
        })
        headers.authorization = originalCredential
        await prisma.appGrant.update({
          where: { id: secondGrant.id },
          data: { status: "REVOKED", revokedAt: new Date() },
        })
        expect((await (await list()).json()).preapprovals).toContainEqual(
          expect.objectContaining({ id, state: "canceled", version: 6 }),
        )
        expect((await mutate("renew", 6)).status).toBe(200)
        // A scope association can disappear independently of its parent grant.
        await prisma.appGrantScope.deleteMany({
          where: { grantId, scopeId: scope.id },
        })
        await prisma.appGrantScope.create({
          data: { grantId, scopeId: scope.id },
        })
        expect((await (await list()).json()).preapprovals).toContainEqual(
          expect.objectContaining({ id, state: "canceled", version: 8 }),
        )
        const competing = await Promise.all([
          mutate("cancel", 8),
          mutate("renew", 8),
        ])
        expect(
          competing.filter((response) => response.status === 200),
        ).toHaveLength(1)
        expect(
          competing.every((response) =>
            [200, 409, 503].includes(response.status),
          ),
        ).toBe(true)
        expect((await mutate("renew", 8)).status).toBe(409)
        // Fixture represents the transition owned by #131; management must keep it terminal.
        await prisma.changelogPreapproval.update({
          where: { id },
          data: {
            state: "redeemed",
            redeemedAt: new Date(),
            redeemedById: second.id,
          },
        })
        expect((await mutate("renew", 9)).status).toBe(409)
        expect((await mutate("cancel", 9)).status).toBe(409)
        expect((await (await list()).json()).preapprovals).toContainEqual(
          expect.objectContaining({
            id,
            state: "redeemed",
            redeemedById: second.id,
          }),
        )
        expect(
          await prisma.appGrant.count({
            where: { userId: second.id, status: "APPROVED" },
          }),
        ).toBe(0)
        const deniedBodies = [
          {
            clientId: "jfp_changelog_production",
            action: "renew",
            id,
            version: 9,
          },
          { clientId: "arbitrary", action: "create", id: randomUUID(), email },
        ]
        for (const body of deniedBodies)
          expect(
            (
              await POST(
                new Request(
                  "http://localhost:3004/api/changelog/preapprovals",
                  { method: "POST", headers, body: JSON.stringify(body) },
                ),
              )
            ).status,
          ).toBe(403)
        expect(
          (
            await GET(
              new Request(
                "http://localhost:3004/api/changelog/preapprovals?clientId=jfp_changelog_local",
              ),
            )
          ).status,
        ).toBe(401)
        expect(
          (
            await POST(
              new Request("http://localhost:3004/api/changelog/preapprovals", {
                method: "POST",
                body: JSON.stringify({
                  clientId: "jfp_changelog_local",
                  action: "create",
                  id: randomUUID(),
                  email,
                }),
              }),
            )
          ).status,
        ).toBe(401)
      } finally {
        cookie = originalCookie
        headers.authorization = originalCredential
        await prisma.changelogPreapproval.deleteMany({ where: { id } })
        await prisma.user.delete({ where: { id: second.id } })
      }
    } finally {
      vi.useRealTimers()
      await prisma.user.update({
        where: { id: userId },
        data: { membershipStatus: "ACTIVE" },
      })
      await prisma.appGrantScope.deleteMany({
        where: { grantId, scopeId: scope.id },
      })
    }
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

  it.each([
    {
      scenario: "recipient promotion",
      operation: "grant-admin",
      actorTarget: false,
      status: 503,
      retryStatus: 409,
      scopes: ["changelog:admin", "changelog:submit"],
    },
    {
      scenario: "actor revocation",
      operation: "revoke",
      actorTarget: true,
      status: 503,
      retryStatus: 403,
      scopes: ["changelog:submit"],
    },
    {
      scenario: "read-only inspection",
      operation: "inspect",
      actorTarget: false,
      status: 200,
      retryStatus: 200,
      scopes: [],
    },
  ] as const)(
    "handles concurrent $scenario before management obtains its lock",
    async ({ operation, actorTarget, status, retryStatus, scopes }) => {
      const { POST } = await import("@/app/api/changelog/contributors/route")
      const { operateChangelogProductionAccess } =
        await import("./changelog-production-access.service")
      const actor = await prisma.user.update({
        where: { id: userId },
        data: { emailVerified: true },
      })
      const recipient = await prisma.user.create({
        data: {
          id: randomUUID(),
          name: "Concurrent promotion recipient",
          email: `promotion-${randomUUID()}@example.test`,
          emailVerified: true,
          membershipStatus: "ACTIVE",
        },
      })
      const production = await prisma.appEnvironment.findUniqueOrThrow({
        where: { clientId: "jfp_changelog_production" },
      })
      let unlock: (() => void) | undefined
      let lock: Promise<unknown> | undefined
      let operator: Promise<unknown> | undefined
      let revocation: Promise<Response> | undefined
      try {
        process.env.AUTH_CHANGELOG_PRODUCTION_ENABLED = "true"
        await operateChangelogProductionAccess("grant-admin", actor.email)
        await prisma.appGrant.create({
          data: {
            appId: production.appId,
            environmentId: production.id,
            userId: recipient.id,
            subjectType: "USER",
            status: "APPROVED",
            scopes: {
              create: { scope: { connect: { key: "changelog:submit" } } },
            },
          },
        })
        const authorized = await authorize({
          requestedClientId: "jfp_changelog_production",
          redirectUri: "https://changelog.jesusfilm.org/api/auth/callback",
          resource: null,
          scope: "openid changelog:admin",
        })
        const code = await authorizationCode(authorized.response)
        const exchanged = await postToken(
          new URLSearchParams({
            grant_type: "authorization_code",
            client_id: "jfp_changelog_production",
            code,
            code_verifier: authorized.verifier,
            redirect_uri: "https://changelog.jesusfilm.org/api/auth/callback",
          }),
        )
        expect(exchanged.response.status).toBe(200)
        const request = () =>
          new Request("http://localhost:3004/api/changelog/contributors", {
            method: "POST",
            headers: {
              authorization: `Bearer ${exchanged.body.access_token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              clientId: "jfp_changelog_production",
              recipientId: recipient.id,
            }),
          })
        const environmentBefore = await prisma.appEnvironment.findUniqueOrThrow(
          {
            where: { id: production.id },
          },
        )
        const held = new Promise<void>((resolve) => {
          unlock = resolve
        })
        let ready!: () => void
        const locked = new Promise<void>((resolve) => {
          ready = resolve
        })
        lock = prisma.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT id FROM app_environment WHERE id = ${production.id} FOR UPDATE`
            ready()
            await held
          },
          { timeout: 10_000 },
        )
        await locked
        // Queue the real operator first, then management. Both must have reached
        // PostgreSQL's lock wait before release; no timing sleeps or mocked DB.
        const waitForBlocked = (count: number) =>
          vi.waitFor(
            async () => {
              const rows = await prisma.$queryRaw<{ count: bigint }[]>`
              SELECT count(*) FROM pg_stat_activity
              WHERE datname = current_database() AND wait_event_type = 'Lock'
                AND query LIKE '%app_environment%'
            `
              expect(Number(rows[0].count)).toBe(count)
            },
            { timeout: 2000, interval: 10 },
          )
        operator = operateChangelogProductionAccess(
          operation,
          actorTarget ? actor.email : recipient.email,
        )
        await waitForBlocked(1)
        revocation = POST(request())
        await waitForBlocked(2)
        unlock?.()
        await lock
        await operator
        expect((await revocation).status).toBe(status)
        const retried = await POST(request())
        expect(retried.status).toBe(retryStatus)
        if (operation === "inspect") {
          expect(await retried.json()).toEqual({ changed: false })
          const environmentAfter =
            await prisma.appEnvironment.findUniqueOrThrow({
              where: { id: production.id },
            })
          expect(environmentAfter.updatedAt).toEqual(
            environmentBefore.updatedAt,
          )
        }
        const { hashAuditSubject } = await import("./audit.service")
        expect(
          await prisma.authAuditEvent.count({
            where: {
              subjectHash: hashAuditSubject(recipient.id),
              eventType: "changelog_contributor_revoked",
            },
          }),
        ).toBe(operation === "inspect" ? 1 : 0)
        const grants = await prisma.appGrant.findMany({
          where: { userId: recipient.id },
          include: { scopes: { include: { scope: true } } },
        })
        expect(
          grants
            .flatMap((grant) => grant.scopes.map(({ scope }) => scope.key))
            .sort(),
        ).toEqual(scopes)
      } finally {
        unlock?.()
        await Promise.allSettled([lock, operator, revocation])
        process.env.AUTH_CHANGELOG_PRODUCTION_ENABLED = "false"
        await prisma.user.delete({ where: { id: recipient.id } })
        await prisma.appGrant.deleteMany({
          where: { userId, environmentId: production.id },
        })
        await prisma.user.update({
          where: { id: userId },
          data: { emailVerified: false },
        })
      }
    },
    20_000,
  )

  async function authorize({
    requestedClientId = clientId,
    redirectUri = REDIRECT_URI,
    resource = LOCAL_RESOURCE,
    sessionCookie = cookie,
    scope = "openid offline_access changelog:read changelog:submit changelog:admin",
  }: {
    sessionCookie?: string
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
      new Request(url, {
        headers: { cookie: sessionCookie },
        redirect: "manual",
      }),
      { params: Promise.resolve({ all: ["oauth2", "authorize"] }) },
    )
    return { response, verifier: pkce.verifier }
  }

  async function acceptConsent(response: Response, sessionCookie = cookie) {
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
      target: {
        environment:
          consentUrl.searchParams.get("resource") === PRODUCTION_RESOURCE
            ? "Production"
            : "Local",
        resource: consentUrl.searchParams.get("resource"),
      },
      unverifiedDynamicClient: true,
    })

    const accepted = await routePost(
      new Request("http://localhost:3004/api/auth/oauth2/consent", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: sessionCookie,
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

  async function authorizationCode(response: Response, sessionCookie = cookie) {
    const location = response.headers.get("location")
    if (!location) throw new Error("Authorization response omitted location")
    const url = new URL(location, process.env.AUTH_BASE_URL)
    const callback =
      url.pathname === "/oauth/consent"
        ? new URL(await acceptConsent(response, sessionCookie))
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
