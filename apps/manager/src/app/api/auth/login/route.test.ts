import { beforeEach, describe, expect, it, vi } from "vitest"

const { cookieSet, loginManagerUserMock } = vi.hoisted(() => ({
  cookieSet: vi.fn(),
  loginManagerUserMock: vi.fn(),
}))

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    set: cookieSet,
  })),
}))

vi.mock("@/cms/gateway", () => ({
  registerLiveCmsGatewayAuthHandlers: vi.fn(),
  getCmsGateway: () => ({
    loginManagerUser: loginManagerUserMock,
  }),
}))

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    cookieSet.mockReset()
    loginManagerUserMock.mockReset()

    vi.unstubAllEnvs()
    vi.resetModules()

    vi.stubEnv("MANAGER_DATA_MODE", "mock")
    vi.stubEnv("MANAGER_MOCK_SESSION_SECRET", "mock-session-secret")
    vi.stubEnv("MUX_TOKEN_ID", "mux-token-id")
    vi.stubEnv("MUX_TOKEN_SECRET", "mux-token-secret")
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key")
  })

  it("logs in through the gateway and sets the neutral Manager session cookie", async () => {
    loginManagerUserMock.mockResolvedValue({
      token: "mock-session-token",
      user: {
        id: 7,
        email: "manager@forge.test",
        role: { name: "Manager", type: "manager" },
      },
    })

    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://example.test/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "manager@forge.test",
          password: "demo-manager-password",
        }),
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      user: {
        id: 7,
        email: "manager@forge.test",
        role: "Manager",
      },
    })
    expect(loginManagerUserMock).toHaveBeenCalledWith(
      "manager@forge.test",
      "demo-manager-password",
    )
    expect(cookieSet).toHaveBeenCalledWith(
      "manager-session",
      "mock-session-token",
      expect.objectContaining({
        httpOnly: true,
        path: "/",
        sameSite: "lax",
      }),
    )
  })

  it("accepts Admin role names after Admin grants Manager access", async () => {
    loginManagerUserMock.mockResolvedValue({
      token: "admin-session-token",
      user: {
        id: "admin-user-1",
        email: "viewer@example.test",
        role: { name: "VIEWER", type: "viewer" },
      },
    })

    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://example.test/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "viewer@example.test",
          password: "admin-password",
        }),
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      user: {
        id: "admin-user-1",
        email: "viewer@example.test",
        role: "VIEWER",
      },
    })
    expect(cookieSet).toHaveBeenCalledWith(
      "manager-session",
      "admin-session-token",
      expect.objectContaining({ httpOnly: true }),
    )
  })

  it("rejects invalid mock credentials", async () => {
    loginManagerUserMock.mockResolvedValue(null)

    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://example.test/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "manager@forge.test",
          password: "wrong-password",
        }),
      }),
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: "Invalid credentials",
    })
    expect(cookieSet).not.toHaveBeenCalled()
  })
})
