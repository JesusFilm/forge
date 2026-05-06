import { afterEach, describe, expect, it, vi } from "vitest"

const { verifyManagerSessionMock } = vi.hoisted(() => ({
  verifyManagerSessionMock: vi.fn(),
}))

vi.mock("@/cms/gateway", () => ({
  registerLiveCmsGatewayAuthHandlers: vi.fn(),
  getCmsGateway: () => ({
    verifyManagerSession: verifyManagerSessionMock,
  }),
}))

describe("authenticateManagerOverrideRequest", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    verifyManagerSessionMock.mockReset()
  })

  it("accepts the generic manager API key for override approval", async () => {
    vi.stubEnv("MANAGER_DATA_MODE", "live")
    vi.stubEnv("STRAPI_URL", "http://localhost:1337")
    vi.stubEnv("STRAPI_API_TOKEN", "default-token")
    vi.stubEnv("MUX_TOKEN_ID", "mux-token-id")
    vi.stubEnv("MUX_TOKEN_SECRET", "mux-token-secret")
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key")
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
    vi.stubEnv("MANAGER_DATA_MODE", "live")
    vi.stubEnv("STRAPI_URL", "http://localhost:1337")
    vi.stubEnv("STRAPI_API_TOKEN", "default-token")
    vi.stubEnv("MUX_TOKEN_ID", "mux-token-id")
    vi.stubEnv("MUX_TOKEN_SECRET", "mux-token-secret")
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key")
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

  it("accepts a mock-mode session cookie when the gateway verifies it", async () => {
    vi.stubEnv("MANAGER_DATA_MODE", "mock")
    vi.stubEnv("MANAGER_MOCK_SESSION_SECRET", "mock-session-secret")
    vi.stubEnv("MUX_TOKEN_ID", "mux-token-id")
    vi.stubEnv("MUX_TOKEN_SECRET", "mux-token-secret")
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key")

    verifyManagerSessionMock.mockResolvedValue({
      id: 7,
      username: "manager",
      email: "manager@forge.test",
      role: { name: "Manager", type: "manager" },
    })

    const { authenticateRequest, authenticateManagerOverrideRequest } =
      await import("./auth")

    const request = new Request("http://example.test", {
      headers: {
        cookie: "manager-session=mock-session-token",
      },
    })

    await expect(authenticateRequest(request)).resolves.toBeNull()
    await expect(authenticateManagerOverrideRequest(request)).resolves.toEqual({
      kind: "session",
      approvedByUserId: "7",
      user: {
        id: 7,
        username: "manager",
        email: "manager@forge.test",
        role: { name: "Manager", type: "manager" },
      },
    })
    expect(verifyManagerSessionMock).toHaveBeenCalledWith("mock-session-token")
  })

  it("still accepts the legacy Strapi cookie during the transition window", async () => {
    vi.stubEnv("MANAGER_DATA_MODE", "mock")
    vi.stubEnv("MANAGER_MOCK_SESSION_SECRET", "mock-session-secret")
    vi.stubEnv("MUX_TOKEN_ID", "mux-token-id")
    vi.stubEnv("MUX_TOKEN_SECRET", "mux-token-secret")
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key")

    verifyManagerSessionMock.mockResolvedValue({
      id: 7,
      username: "manager",
      email: "manager@forge.test",
      role: { name: "Manager", type: "manager" },
    })

    const { authenticateRequest } = await import("./auth")

    await expect(
      authenticateRequest(
        new Request("http://example.test", {
          headers: {
            cookie: "strapi-jwt=legacy-session-token",
          },
        }),
      ),
    ).resolves.toBeNull()
    expect(verifyManagerSessionMock).toHaveBeenCalledWith(
      "legacy-session-token",
    )
  })
})
