import { afterEach, describe, expect, it, vi } from "vitest"

const ENVIRONMENT_CLAIM = "https://jesusfilm.org/claims/environment"

async function importWebUserToken() {
  vi.resetModules()
  vi.stubEnv("CI", "true")
  vi.stubEnv("DATABASE_URL", "postgresql://example.test/db")
  vi.stubEnv("ADMIN_SESSION_SECRET", "admin-session-secret-at-least-32-chars")
  vi.stubEnv("AUTH_ISSUER_URL", "https://auth.jesusfilm.org/api/auth")
  vi.stubEnv("AUTH_ADMIN_CLIENT_ID", "jfp_admin_local")
  vi.stubEnv("AUTH_WEB_USER_INTROSPECTION_CLIENT_ID", "admin_watch_events")
  vi.stubEnv("AUTH_WEB_USER_INTROSPECTION_CLIENT_SECRET", "secret")
  vi.stubEnv("AUTH_WEB_USER_CLIENT_IDS", "jfp_web_local,jfp_web_production")
  vi.stubEnv("AUTH_WEB_USER_TOKEN_ENVIRONMENT", "local")
  return import("./web-user-token")
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
            ...override,
          }),
        ),
      )
      const { resolveWebUserPrincipalFromToken } = await importWebUserToken()

      await expect(
        resolveWebUserPrincipalFromToken("Bearer jfp_at_secret"),
      ).resolves.toBeNull()
    }
  })
})
