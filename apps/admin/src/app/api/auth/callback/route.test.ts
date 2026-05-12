import { beforeEach, describe, expect, it, vi } from "vitest"

const cookieGet = vi.fn()
const cookieSet = vi.fn()
const cookieDelete = vi.fn()
const exchangeAdminAuthorizationCode = vi.fn()
const verifyAdminIdToken = vi.fn()
const userFindUnique = vi.fn()
const userUpdate = vi.fn()
const userUpsert = vi.fn()

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: cookieGet,
    set: cookieSet,
    delete: cookieDelete,
  })),
}))

vi.mock("@/auth/oauth-client", () => ({
  getAdminOAuthConfig: vi.fn(() => ({
    issuerUrl: "https://auth.jesusfilm.org",
    clientId: "jfp_admin_local",
    adminBaseUrl: "http://localhost:3003",
  })),
  exchangeAdminAuthorizationCode: (...args: unknown[]) =>
    exchangeAdminAuthorizationCode(...args),
  verifyAdminIdToken: (...args: unknown[]) => verifyAdminIdToken(...args),
}))

vi.mock("@/db/client", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => userFindUnique(...args),
      update: (...args: unknown[]) => userUpdate(...args),
      upsert: (...args: unknown[]) => userUpsert(...args),
    },
  },
}))

describe("admin OAuth callback route", () => {
  beforeEach(() => {
    cookieGet.mockReset()
    cookieSet.mockReset()
    cookieDelete.mockReset()
    exchangeAdminAuthorizationCode.mockReset()
    verifyAdminIdToken.mockReset()
    userFindUnique.mockReset()
    userUpdate.mockReset()
    userUpsert.mockReset()
  })

  it("rejects callbacks with invalid state", async () => {
    cookieGet.mockReturnValue(undefined)
    const { GET } = await import("./route")

    const response = await GET(
      new Request("http://localhost:3003/api/auth/callback?code=c&state=s"),
    )

    expect(response.headers.get("location")).toBe(
      "http://localhost:3003/login?error=forbidden",
    )
    expect(exchangeAdminAuthorizationCode).not.toHaveBeenCalled()
  })

  it("exchanges the code and creates an admin-local session", async () => {
    cookieGet.mockImplementation((name: string) => {
      const values: Record<string, string> = {
        forge_admin_oauth_state: "state_123",
        forge_admin_oauth_verifier: "verifier_123",
        forge_admin_oauth_callback: "/dashboard",
      }

      return values[name] ? { value: values[name] } : undefined
    })
    exchangeAdminAuthorizationCode.mockResolvedValueOnce({
      access_token: "access",
      id_token: "id",
      scope: "openid admin:access admin:content:write",
    })
    verifyAdminIdToken.mockResolvedValueOnce({
      subject: "user_123",
      email: "user@example.com",
      name: "Test User",
      scopes: ["openid", "admin:access", "admin:content:write"],
    })
    userFindUnique.mockResolvedValueOnce(null)
    userUpsert.mockResolvedValueOnce({ id: "user_123", role: "EDITOR" })

    const { GET } = await import("./route")
    const response = await GET(
      new Request(
        "http://localhost:3003/api/auth/callback?code=code_123&state=state_123",
      ),
    )

    expect(response.headers.get("location")).toBe(
      "http://localhost:3003/dashboard",
    )
    expect(exchangeAdminAuthorizationCode).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "code_123",
        codeVerifier: "verifier_123",
      }),
    )
    expect(userUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user_123" },
        create: expect.objectContaining({ role: "EDITOR" }),
      }),
    )
    expect(response.headers.get("set-cookie")).toContain(
      "forge_admin_oauth_session=",
    )
  })

  it("reuses existing admin users by email without downgrading their role", async () => {
    cookieGet.mockImplementation((name: string) => {
      const values: Record<string, string> = {
        forge_admin_oauth_state: "state_123",
        forge_admin_oauth_verifier: "verifier_123",
        forge_admin_oauth_callback: "/dashboard",
      }

      return values[name] ? { value: values[name] } : undefined
    })
    exchangeAdminAuthorizationCode.mockResolvedValueOnce({
      access_token: "access",
      scope: "openid admin:access admin:content:write",
    })
    verifyAdminIdToken.mockResolvedValueOnce({
      subject: "auth_user_123",
      email: "admin@example.com",
      name: "Admin User",
      scopes: ["openid", "admin:access", "admin:content:write"],
    })
    userFindUnique.mockResolvedValueOnce({
      id: "existing_admin_user",
      role: "ADMIN",
    })
    userUpdate.mockResolvedValueOnce({
      id: "existing_admin_user",
      role: "ADMIN",
    })

    const { GET } = await import("./route")
    const response = await GET(
      new Request(
        "http://localhost:3003/api/auth/callback?code=code_123&state=state_123",
      ),
    )

    expect(response.headers.get("location")).toBe(
      "http://localhost:3003/dashboard",
    )
    expect(userUpsert).not.toHaveBeenCalled()
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "existing_admin_user" },
        data: expect.objectContaining({ role: "ADMIN" }),
      }),
    )
  })
})
