import { afterEach, describe, expect, it, vi } from "vitest"

describe("validateAdminManagerSession", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("uses an Auth OAuth service token when service credentials are configured", async () => {
    stubEnv()
    vi.stubEnv("AUTH_MANAGER_SERVICE_CLIENT_ID", "jfp_manager_local_service")
    vi.stubEnv("AUTH_MANAGER_SERVICE_CLIENT_SECRET", "service-secret")

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "auth-service-token",
            token_type: "Bearer",
            expires_in: 1800,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            allowed: true,
            user: { id: "admin-user-123", email: "manager@example.com" },
            managerRole: "OPERATOR",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )

    const { validateAdminManagerSession } =
      await import("./admin-manager-session")

    await expect(
      validateAdminManagerSession({
        subject: "auth-user-123",
        email: "manager@example.com",
      }),
    ).resolves.toEqual({
      user: { id: "admin-user-123", email: "manager@example.com" },
      managerRole: "OPERATOR",
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://auth.jesusfilm.org/api/auth/oauth2/token",
      expect.objectContaining({
        method: "POST",
        body: new URLSearchParams({
          grant_type: "client_credentials",
          scope: "admin:manager-session:validate",
          resource: "https://admin.example/api/manager/session",
        }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://admin.example/api/manager/session",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer auth-service-token",
        }),
      }),
    )
  })

  it("falls back to the legacy Admin Manager API key", async () => {
    stubEnv()
    vi.stubEnv("ADMIN_MANAGER_API_KEY", "admin-manager-key")

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          allowed: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )

    const { validateAdminManagerSession } =
      await import("./admin-manager-session")

    await expect(
      validateAdminManagerSession({ subject: "auth-user-123" }),
    ).resolves.toBeNull()

    expect(fetchMock).toHaveBeenCalledWith(
      "https://admin.example/api/manager/session",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer admin-manager-key",
        }),
      }),
    )
  })
})

function stubEnv() {
  vi.stubEnv("MANAGER_DATA_MODE", "admin")
  vi.stubEnv("MUX_TOKEN_ID", "mux-token-id")
  vi.stubEnv("MUX_TOKEN_SECRET", "mux-token-secret")
  vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key")
  vi.stubEnv(
    "MANAGER_SESSION_SECRET",
    "manager-session-secret-change-me-000000",
  )
  vi.stubEnv("AUTH_ISSUER_URL", "https://auth.jesusfilm.org")
  vi.stubEnv("AUTH_MANAGER_CLIENT_ID", "jfp_manager_local")
  vi.stubEnv("ADMIN_GRAPHQL_URL", "https://admin.example/api/graphql")
}
