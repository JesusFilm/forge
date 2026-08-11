import { afterEach, describe, expect, it, vi } from "vitest"

const ENVIRONMENT_CLAIM = "https://jesusfilm.org/claims/environment"

// Empty string resolves to `undefined` through env.ts's `emptyToUndefined`,
// which is how a test exercises the unset-CSV default path.
async function importWebUserToken(
  clientIds = "jfp_web_local,jfp_web_production",
) {
  vi.resetModules()
  vi.stubEnv("CI", "true")
  vi.stubEnv("DATABASE_URL", "postgresql://example.test/db")
  vi.stubEnv("ADMIN_SESSION_SECRET", "admin-session-secret-at-least-32-chars")
  vi.stubEnv("AUTH_ISSUER_URL", "https://auth.jesusfilm.org/api/auth")
  vi.stubEnv("AUTH_ADMIN_CLIENT_ID", "jfp_admin_local")
  vi.stubEnv("AUTH_WEB_USER_INTROSPECTION_CLIENT_ID", "admin_watch_events")
  vi.stubEnv("AUTH_WEB_USER_INTROSPECTION_CLIENT_SECRET", "secret")
  vi.stubEnv("AUTH_WEB_USER_CLIENT_IDS", clientIds)
  vi.stubEnv("AUTH_WEB_USER_TOKEN_ENVIRONMENT", "local")
  return import("./web-user-token")
}

function stubIntrospection(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        active: true,
        iss: "https://auth.jesusfilm.org/api/auth",
        client_id: "jfp_web_local",
        scope: "openid web:watch-events:write",
        sub: "auth-user-123",
        exp: Math.floor(Date.now() / 1000) + 60,
        [ENVIRONMENT_CLAIM]: "local",
        ...overrides,
      }),
    ),
  )
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("resolveWebUserPrincipalFromToken", () => {
  it("mints WEB_USER for an active scoped Web token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          active: true,
          iss: "https://auth.jesusfilm.org/api/auth",
          client_id: "jfp_web_local",
          scope: "openid web:watch-events:write",
          sub: "auth-user-123",
          exp: Math.floor(Date.now() / 1000) + 60,
          [ENVIRONMENT_CLAIM]: "local",
        }),
      ),
    )
    const { resolveWebUserPrincipalFromToken } = await importWebUserToken()

    await expect(
      resolveWebUserPrincipalFromToken("Bearer jfp_at_secret"),
    ).resolves.toEqual({
      id: "auth-user-123",
      role: "WEB_USER",
      rateLimitBucketKey: "auth-user-123",
    })
  })

  it("rejects inactive, wrong-client, missing-scope, and expired tokens", async () => {
    const cases = [
      { active: false },
      { client_id: "jfp_admin_local" },
      { scope: "openid" },
      { exp: Math.floor(Date.now() / 1000) - 1 },
    ]

    for (const override of cases) {
      stubIntrospection(override)
      const { resolveWebUserPrincipalFromToken } = await importWebUserToken()

      await expect(
        resolveWebUserPrincipalFromToken("Bearer jfp_at_secret"),
      ).resolves.toBeNull()
    }
  })
})

describe("AUTH_WEB_USER_CLIENT_IDS allowlist", () => {
  it("admits a jfp_tv_production token when the CSV lists it", async () => {
    stubIntrospection({ client_id: "jfp_tv_production", sub: "tv-user-1" })
    const { resolveWebUserPrincipalFromToken } = await importWebUserToken(
      "jfp_web_production,jfp_tv_production",
    )

    await expect(
      resolveWebUserPrincipalFromToken("Bearer jfp_at_secret"),
    ).resolves.toEqual({
      id: "tv-user-1",
      role: "WEB_USER",
      rateLimitBucketKey: "tv-user-1",
    })
  })

  it("rejects a jfp_tv_production token when the CSV omits it", async () => {
    stubIntrospection({ client_id: "jfp_tv_production", sub: "tv-user-1" })
    const { resolveWebUserPrincipalFromToken } =
      await importWebUserToken("jfp_web_production")

    await expect(
      resolveWebUserPrincipalFromToken("Bearer jfp_at_secret"),
    ).resolves.toBeNull()
  })

  it("keeps admitting web client ids alongside the tv ids", async () => {
    for (const clientId of ["jfp_web_local", "jfp_web_production"]) {
      stubIntrospection({ client_id: clientId })
      const { resolveWebUserPrincipalFromToken } = await importWebUserToken(
        "jfp_web_local,jfp_web_production,jfp_tv_production",
      )

      await expect(
        resolveWebUserPrincipalFromToken("Bearer jfp_at_secret"),
      ).resolves.toEqual({
        id: "auth-user-123",
        role: "WEB_USER",
        rateLimitBucketKey: "auth-user-123",
      })
    }
  })

  it("admits every seeded web and tv client id from the unset-CSV default", async () => {
    const defaults = [
      "jfp_web_local",
      "jfp_web_preview",
      "jfp_web_staging",
      "jfp_web_production",
      "jfp_tv_local",
      "jfp_tv_preview",
      "jfp_tv_staging",
      "jfp_tv_production",
    ]

    for (const clientId of defaults) {
      stubIntrospection({ client_id: clientId })
      const { resolveWebUserPrincipalFromToken } = await importWebUserToken("")

      await expect(
        resolveWebUserPrincipalFromToken("Bearer jfp_at_secret"),
      ).resolves.toEqual({
        id: "auth-user-123",
        role: "WEB_USER",
        rateLimitBucketKey: "auth-user-123",
      })
    }
  })

  it("still rejects a non-allowlisted client id under the unset-CSV default", async () => {
    stubIntrospection({ client_id: "jfp_admin_production" })
    const { resolveWebUserPrincipalFromToken } = await importWebUserToken("")

    await expect(
      resolveWebUserPrincipalFromToken("Bearer jfp_at_secret"),
    ).resolves.toBeNull()
  })
})
