import { beforeEach, describe, expect, it, vi } from "vitest"

const userFindUnique = vi.fn()
const userUpdate = vi.fn()

vi.mock("@/db/client", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => userFindUnique(...args),
      update: (...args: unknown[]) => userUpdate(...args),
    },
  },
}))

describe("POST /api/manager/session", () => {
  beforeEach(() => {
    userFindUnique.mockReset()
    userUpdate.mockReset()
    vi.unstubAllEnvs()
    vi.resetModules()
    vi.stubEnv("DATABASE_URL", "postgresql://example.test/admin")
    vi.stubEnv("ADMIN_SESSION_SECRET", "admin-session-secret-change-me-000000")
    vi.stubEnv("AUTH_ISSUER_URL", "https://auth.jesusfilm.org")
    vi.stubEnv("AUTH_ADMIN_CLIENT_ID", "jfp_admin_local")
    vi.stubEnv("MANAGER_ADMIN_API_KEY", "manager-admin-key")
  })

  it("rejects requests without the Manager service bearer", async () => {
    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3003/api/manager/session", {
        method: "POST",
        body: JSON.stringify({
          subject: "auth-user-123",
          email: "manager@example.com",
        }),
      }),
    )

    expect(response.status).toBe(403)
    expect(userFindUnique).not.toHaveBeenCalled()
  })

  it("returns an active operator membership by Auth subject", async () => {
    userFindUnique.mockResolvedValueOnce({
      id: "auth-user-123",
      email: "manager@example.com",
      name: "Manager User",
      managerMembership: {
        role: "OPERATOR",
        revokedAt: null,
      },
    })
    userUpdate.mockResolvedValueOnce({
      id: "auth-user-123",
      email: "manager@example.com",
      name: "Manager User",
      managerMembership: {
        role: "OPERATOR",
        revokedAt: null,
      },
    })

    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3003/api/manager/session", {
        method: "POST",
        headers: {
          authorization: "Bearer manager-admin-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          subject: "auth-user-123",
          email: "manager@example.com",
          name: "Manager User",
        }),
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      allowed: true,
      user: {
        id: "auth-user-123",
        email: "manager@example.com",
        name: "Manager User",
      },
      managerRole: "OPERATOR",
    })
  })

  it("denies Admin users without active Manager membership", async () => {
    userFindUnique.mockResolvedValueOnce({
      id: "auth-user-123",
      email: "admin@example.com",
      name: "Admin User",
      managerMembership: null,
    })
    userUpdate.mockResolvedValueOnce({
      id: "auth-user-123",
      email: "admin@example.com",
      name: "Admin User",
      managerMembership: null,
    })

    const { POST } = await import("./route")
    const response = await POST(
      new Request("http://localhost:3003/api/manager/session", {
        method: "POST",
        headers: {
          authorization: "Bearer manager-admin-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          subject: "auth-user-123",
          email: "admin@example.com",
        }),
      }),
    )

    await expect(response.json()).resolves.toEqual({ allowed: false })
  })
})
