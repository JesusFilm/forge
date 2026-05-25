import { afterEach, describe, expect, it, vi } from "vitest"

describe("isValidManagerServiceToken", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("accepts an active Auth service token with the Manager session scope", async () => {
    stubEnv()
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          active: true,
          aud: "https://admin.example/api/manager/session",
          client_id: "jfp_manager_local_session_service",
          exp: Math.floor(Date.now() / 1000) + 60,
          iss: "https://auth.jesusfilm.org",
          scope: "admin:manager-session:validate",
          "https://jesusfilm.org/claims/environment": "local",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )

    const { isValidManagerServiceToken } =
      await import("./manager-service-token")

    await expect(
      isValidManagerServiceToken(
        "Bearer auth-service-token",
        "https://admin.example/api/manager/session",
      ),
    ).resolves.toBe(true)
  })

  it("rejects tokens missing the Manager session scope", async () => {
    stubEnv()
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          active: true,
          aud: "https://admin.example/api/manager/session",
          client_id: "jfp_manager_local_session_service",
          exp: Math.floor(Date.now() / 1000) + 60,
          iss: "https://auth.jesusfilm.org",
          scope: "manager:access",
          "https://jesusfilm.org/claims/environment": "local",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )

    const { isValidManagerServiceToken } =
      await import("./manager-service-token")

    await expect(
      isValidManagerServiceToken(
        "Bearer auth-service-token",
        "https://admin.example/api/manager/session",
      ),
    ).resolves.toBe(false)
  })

  it.each([
    [
      "inactive tokens",
      {
        active: false,
        aud: "https://admin.example/api/manager/session",
        client_id: "jfp_manager_local_session_service",
        exp: Math.floor(Date.now() / 1000) + 60,
        iss: "https://auth.jesusfilm.org",
        scope: "admin:manager-session:validate",
        "https://jesusfilm.org/claims/environment": "local",
      },
    ],
    [
      "tokens from the wrong issuer",
      {
        active: true,
        aud: "https://admin.example/api/manager/session",
        client_id: "jfp_manager_local_session_service",
        exp: Math.floor(Date.now() / 1000) + 60,
        iss: "https://evil.example",
        scope: "admin:manager-session:validate",
        "https://jesusfilm.org/claims/environment": "local",
      },
    ],
    [
      "tokens for the wrong audience",
      {
        active: true,
        aud: "https://admin.example/api/other",
        client_id: "jfp_manager_local_session_service",
        exp: Math.floor(Date.now() / 1000) + 60,
        iss: "https://auth.jesusfilm.org",
        scope: "admin:manager-session:validate",
        "https://jesusfilm.org/claims/environment": "local",
      },
    ],
    [
      "tokens from the wrong client",
      {
        active: true,
        aud: "https://admin.example/api/manager/session",
        client_id: "jfp_manager_preview_session_service",
        exp: Math.floor(Date.now() / 1000) + 60,
        iss: "https://auth.jesusfilm.org",
        scope: "admin:manager-session:validate",
        "https://jesusfilm.org/claims/environment": "local",
      },
    ],
    [
      "tokens for the wrong environment",
      {
        active: true,
        aud: "https://admin.example/api/manager/session",
        client_id: "jfp_manager_local_session_service",
        exp: Math.floor(Date.now() / 1000) + 60,
        iss: "https://auth.jesusfilm.org",
        scope: "admin:manager-session:validate",
        "https://jesusfilm.org/claims/environment": "production",
      },
    ],
    [
      "expired tokens",
      {
        active: true,
        aud: "https://admin.example/api/manager/session",
        client_id: "jfp_manager_local_session_service",
        exp: Math.floor(Date.now() / 1000) - 60,
        iss: "https://auth.jesusfilm.org",
        scope: "admin:manager-session:validate",
        "https://jesusfilm.org/claims/environment": "local",
      },
    ],
  ])("rejects %s", async (_label, payload) => {
    stubEnv()
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )

    const { isValidManagerServiceToken } =
      await import("./manager-service-token")

    await expect(
      isValidManagerServiceToken(
        "Bearer auth-service-token",
        "https://admin.example/api/manager/session",
      ),
    ).resolves.toBe(false)
  })
})

function stubEnv() {
  vi.stubEnv("DATABASE_URL", "postgresql://example.test/admin")
  vi.stubEnv("ADMIN_SESSION_SECRET", "admin-session-secret-change-me-000000")
  vi.stubEnv("AUTH_ISSUER_URL", "https://auth.jesusfilm.org")
  vi.stubEnv("AUTH_ADMIN_CLIENT_ID", "jfp_admin_local")
  vi.stubEnv(
    "AUTH_MANAGER_SERVICE_CLIENT_ID",
    "jfp_manager_local_session_service",
  )
  vi.stubEnv("AUTH_MANAGER_SERVICE_CLIENT_SECRET", "service-secret")
  vi.stubEnv("AUTH_MANAGER_SERVICE_ENVIRONMENT", "local")
}
