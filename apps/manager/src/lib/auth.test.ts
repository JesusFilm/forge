import { afterEach, describe, expect, it, vi } from "vitest"

const sessionSecret = "manager-session-secret-change-me-000000"

describe("authenticateManagerOverrideRequest", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("accepts the generic manager API key for override approval", async () => {
    stubBaseEnv()
    vi.stubEnv("MANAGER_API_KEY", "manager-key")

    const { authenticateManagerOverrideRequest } = await import("./auth")

    const result = await authenticateManagerOverrideRequest(
      new Request("http://example.test", {
        headers: {
          authorization: "Bearer manager-key",
        },
      }),
    )

    expect(result).toEqual({
      kind: "api_key",
      approvedByUserId: "service:manager-api-key",
    })
  })

  it("rejects invalid bearer tokens for override approval", async () => {
    stubBaseEnv()
    vi.stubEnv("MANAGER_API_KEY", "manager-key")

    const { authenticateManagerOverrideRequest } = await import("./auth")

    const result = await authenticateManagerOverrideRequest(
      new Request("http://example.test", {
        headers: {
          authorization: "Bearer wrong-key",
        },
      }),
    )

    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(403)
    await expect((result as Response).json()).resolves.toEqual({
      error: "Interactive Manager session or API key required",
    })
  })

  it("accepts a Manager-local OAuth session cookie", async () => {
    stubBaseEnv()
    const { createManagerSessionCookie, MANAGER_SESSION_COOKIE } =
      await import("./manager-session-cookie")
    const token = await createManagerSessionCookie({
      id: "admin-user-123",
      subject: "auth-user-123",
      email: "manager@forge.test",
      name: "Manager User",
      managerRole: "OPERATOR",
      scopes: ["openid", "manager:access"],
    })

    const { authenticateRequest, authenticateManagerOverrideRequest } =
      await import("./auth")

    const request = new Request("http://example.test", {
      headers: {
        cookie: `${MANAGER_SESSION_COOKIE}=${token}`,
      },
    })

    await expect(authenticateRequest(request)).resolves.toBeNull()
    await expect(authenticateManagerOverrideRequest(request)).resolves.toEqual({
      kind: "session",
      approvedByUserId: "admin-user-123",
      user: {
        id: "admin-user-123",
        username: "Manager User",
        email: "manager@forge.test",
        role: { name: "Manager", type: "manager" },
      },
    })
  })
})

function stubBaseEnv() {
  vi.stubEnv("MANAGER_DATA_MODE", "mock")
  vi.stubEnv("MANAGER_MOCK_SESSION_SECRET", "mock-session-secret")
  vi.stubEnv("MUX_TOKEN_ID", "mux-token-id")
  vi.stubEnv("MUX_TOKEN_SECRET", "mux-token-secret")
  vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key")
  vi.stubEnv("MANAGER_SESSION_SECRET", sessionSecret)
}
