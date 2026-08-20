import { createHash, randomBytes, randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

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
const CLIENT_SECRET = "jfp_cs_upgrade-baseline-client-secret"
const CLIENT_SECRET_BODY = CLIENT_SECRET.slice("jfp_cs_".length)
const AUTH_TIME = new Date("2026-08-20T01:02:03.000Z")
const USER_SCOPES = ["openid", "profile:read", "email:read", "offline_access"]

process.env.AUTH_VALID_AUDIENCES = [
  process.env.AUTH_VALID_AUDIENCES,
  MANAGER_AUDIENCE,
]
  .filter(Boolean)
  .join(",")

function hash(value: string): string {
  return createHash("sha256").update(value).digest("base64url")
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

describeIntegration(
  "Better Auth 1.6.2 PostgreSQL compatibility baseline",
  () => {
    let prisma: typeof import("@/db/client").prisma
    let auth: typeof import("@/auth/config").auth
    let buildAuthorizationCode: typeof import("./oauth-authorization-code.service").buildAuthorizationCode
    let userId: string
    let sessionId: string
    const dynamicClientIds: string[] = []

    beforeAll(async () => {
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
        public: true,
        requirePKCE: true,
        tokenEndpointAuthMethod: "none",
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
          skipConsent: true,
          metadata: {
            appKey: "manager",
            environmentKind: "local",
            serviceAudience: MANAGER_AUDIENCE,
          },
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
      })) as Record<string, unknown>

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
      })
      expect(persistedAccess.token).not.toBe(accessBody)
      expect(persistedRefresh).toMatchObject({
        clientId: PUBLIC_CLIENT_ID,
        userId,
        sessionId,
        referenceId,
        scopes: USER_SCOPES,
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

      // 1.6.2 consumes a code before completing exchange validation, so replay
      // is impossible regardless of whether the first exchange succeeded.
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
      ).rejects.toMatchObject({ body: { error: "invalid_verification" } })

      // Introspection requires client authentication even for a token belonging
      // to a public client. Adding the hashed secret models the operator-owned
      // introspection posture already used by the TV real-database suite.
      await prisma.oauthClient.update({
        where: { clientId: PUBLIC_CLIENT_ID },
        data: { clientSecret: hash(CLIENT_SECRET_BODY) },
      })
      const introspection = (await auth.api.oauth2Introspect({
        body: {
          client_id: PUBLIC_CLIENT_ID,
          client_secret: CLIENT_SECRET,
          token: accessToken,
          token_type_hint: "access_token",
        },
      })) as Record<string, unknown>
      expect(introspection).toMatchObject({
        active: true,
        client_id: PUBLIC_CLIENT_ID,
        sub: userId,
        sid: sessionId,
        scope: USER_SCOPES.join(" "),
        "https://jesusfilm.org/claims/environment": "local",
        "https://jesusfilm.org/claims/app": "web",
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
          client_secret: CLIENT_SECRET,
          token: String(refreshed.refresh_token),
          token_type_hint: "refresh_token",
        },
      })
      const revoked = (await auth.api.oauth2Introspect({
        body: {
          client_id: PUBLIC_CLIENT_ID,
          client_secret: CLIENT_SECRET,
          token: String(refreshed.refresh_token),
          token_type_hint: "refresh_token",
        },
      })) as Record<string, unknown>
      expect(revoked).toEqual({ active: false })
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
            error: mismatch === "client" ? "invalid_client" : "invalid_request",
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

      const tokens = (await auth.api.oauth2Token({
        body: {
          grant_type: "client_credentials",
          client_id: MANAGER_CLIENT_ID,
          client_secret: CLIENT_SECRET,
          resource: MANAGER_AUDIENCE,
          scope: "admin:manager-session:validate",
        },
      })) as Record<string, unknown>
      const claims = decodeJwtPayload(String(tokens.access_token))
      expect(claims).toMatchObject({
        aud: MANAGER_AUDIENCE,
        azp: MANAGER_CLIENT_ID,
        scope: "admin:manager-session:validate",
        iss: "http://localhost:3004/api/auth",
        "https://jesusfilm.org/claims/environment": "local",
        "https://jesusfilm.org/claims/app": "manager",
      })
      expect(claims).not.toHaveProperty("sub")
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
          type: "native",
        },
      })) as Record<string, unknown>
      dynamicClientIds.push(String(registered.client_id))

      expect(registered).toMatchObject({
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        public: true,
        // 1.6.2 does not serialize the derived public-client PKCE posture.
        require_pkce: undefined,
        client_secret: undefined,
        scope: "openid profile:read email:read",
      })
      await expect(
        prisma.oauthClient.findUniqueOrThrow({
          where: { clientId: String(registered.client_id) },
        }),
      ).resolves.toMatchObject({
        public: true,
        requirePKCE: null,
        tokenEndpointAuthMethod: "none",
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
            type: "web",
          },
        }),
      ).rejects.toMatchObject({ body: { error: "invalid_request" } })
    })
  },
)
