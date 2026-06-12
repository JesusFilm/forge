import { beforeEach, describe, expect, it, vi } from "vitest"

const mintAgentLoginHandle = vi.fn()

vi.mock("@/db/client", () => ({
  prisma: {},
}))

vi.mock("@/config/env", () => ({
  env: { AGENT_LOGIN_MINTING_KEY: "dev-key" },
}))

vi.mock("@/services/agent-login.service", async () => {
  const actual = await vi.importActual<
    typeof import("@/services/agent-login.service")
  >("@/services/agent-login.service")

  return {
    ...actual,
    mintAgentLoginHandle: (...args: unknown[]) => mintAgentLoginHandle(...args),
  }
})

describe("POST /api/agent-login/mint", () => {
  beforeEach(() => {
    mintAgentLoginHandle.mockReset()
  })

  it("returns a minted agent login handle", async () => {
    const expiresAt = new Date("2026-06-11T12:30:00.000Z")
    mintAgentLoginHandle.mockResolvedValueOnce({
      handle: "agent+jfp-admin-local.abc@agent-login.jesusfilm.internal",
      expiresAt,
      clientId: "jfp_admin_local",
      redirectUri: "http://localhost:3003/api/auth/callback",
      scopes: ["openid", "email:read", "admin:access"],
    })

    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3004/api/agent-login/mint", {
        method: "POST",
        headers: {
          authorization: "Bearer dev-key",
          "content-type": "application/json",
          "user-agent": "vitest",
        },
        body: JSON.stringify({
          clientId: "jfp_admin_local",
          redirectUri: "http://localhost:3003/api/auth/callback",
          scopes: ["openid", "email:read", "admin:access"],
          ttlSeconds: 600,
        }),
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      handle: "agent+jfp-admin-local.abc@agent-login.jesusfilm.internal",
      clientId: "jfp_admin_local",
      scopes: ["openid", "email:read", "admin:access"],
    })
    expect(mintAgentLoginHandle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        clientId: "jfp_admin_local",
        redirectUri: "http://localhost:3003/api/auth/callback",
        requestedScopes: ["openid", "email:read", "admin:access"],
        ttlSeconds: 600,
        userAgent: "vitest",
      }),
    )
  })

  it("rejects missing bearer credentials", async () => {
    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3004/api/agent-login/mint", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientId: "jfp_admin_local",
          redirectUri: "http://localhost:3003/api/auth/callback",
        }),
      }),
    )

    expect(response.status).toBe(401)
    expect(mintAgentLoginHandle).not.toHaveBeenCalled()
  })

  it("rejects invalid bearer credentials", async () => {
    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3004/api/agent-login/mint", {
        method: "POST",
        headers: {
          authorization: "Bearer wrong-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          clientId: "jfp_admin_local",
          redirectUri: "http://localhost:3003/api/auth/callback",
        }),
      }),
    )

    expect(response.status).toBe(401)
    expect(mintAgentLoginHandle).not.toHaveBeenCalled()
  })

  it("keeps invalid requests out of the service layer", async () => {
    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3004/api/agent-login/mint", {
        method: "POST",
        headers: {
          authorization: "Bearer dev-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({ clientId: "jfp_admin_local" }),
      }),
    )

    expect(response.status).toBe(400)
    expect(mintAgentLoginHandle).not.toHaveBeenCalled()
  })

  it("rejects malformed scopes instead of falling back to defaults", async () => {
    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3004/api/agent-login/mint", {
        method: "POST",
        headers: {
          authorization: "Bearer dev-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          clientId: "jfp_admin_local",
          redirectUri: "http://localhost:3003/api/auth/callback",
          scopes: "openid,email:read",
        }),
      }),
    )

    expect(response.status).toBe(400)
    expect(mintAgentLoginHandle).not.toHaveBeenCalled()
  })
})
