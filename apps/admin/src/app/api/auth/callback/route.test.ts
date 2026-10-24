import { beforeEach, describe, expect, it, vi } from "vitest"

const cookieGet = vi.fn()
const cookieSet = vi.fn()
const cookieDelete = vi.fn()
const exchangeAdminAuthorizationCode = vi.fn()
const verifyAdminIdToken = vi.fn()
const userFindUnique = vi.fn()
const userUpdate = vi.fn()
const userUpsert = vi.fn()
const userCreate = vi.fn()

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
      create: (...args: unknown[]) => userCreate(...args),
    },
  },
}))

describe("admin OAuth callback route", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    cookieGet.mockReset()
    cookieSet.mockReset()
    cookieDelete.mockReset()
    exchangeAdminAuthorizationCode.mockReset()
    verifyAdminIdToken.mockReset()
    userFindUnique.mockReset()
    userUpdate.mockReset()
    userUpsert.mockReset()
    userCreate.mockReset()
  })

  it("rejects callbacks with invalid state", async () => {
    cookieGet.mockReturnValue(undefined)
    const { GET } = await import("./route")

    const response = await GET(
      new Request("http://localhost:3003/api/auth/callback?code=c&state=s"),
    )

    expect(response.headers.get("location")).toBe(
      "http://localhost:3003/access-request?error=forbidden",
    )
    expect(exchangeAdminAuthorizationCode).not.toHaveBeenCalled()
  })

  it("uses the public admin base URL for forbidden redirects", async () => {
    cookieGet.mockReturnValue(undefined)
    const { GET } = await import("./route")

    const response = await GET(
      new Request("http://0.0.0.0:8080/api/auth/callback?code=c&state=s"),
    )

    expect(response.headers.get("location")).toBe(
      "http://localhost:3003/access-request?error=forbidden",
    )
  })

  it("offers access request actions for a first-time OAuth user without creating a row", async () => {
    cookieGet.mockImplementation((name: string) => {
      const values: Record<string, string> = {
        forge_admin_oauth_state: "state_123",
        forge_admin_oauth_verifier: "verifier_123",
        forge_admin_oauth_return_to: "/dashboard",
      }

      return values[name] ? { value: values[name] } : undefined
    })
    exchangeAdminAuthorizationCode.mockResolvedValueOnce({
      access_token: "access",
      id_token: "id",
      scope: "openid admin:access",
    })
    verifyAdminIdToken.mockResolvedValueOnce({
      subject: "user_123",
      email: "user@example.com",
      name: "Test User",
      scopes: ["openid", "admin:access"],
    })
    userFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null)

    const { GET } = await import("./route")
    const response = await GET(
      new Request(
        "http://localhost:3003/api/auth/callback?code=code_123&state=state_123",
      ),
    )

    expect(response.headers.get("location")).toBe(
      "http://localhost:3003/access-request",
    )
    expect(exchangeAdminAuthorizationCode).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "code_123",
        codeVerifier: "verifier_123",
      }),
    )
    expect(userUpsert).not.toHaveBeenCalled()
    expect(userCreate).not.toHaveBeenCalled()
    expect(response.headers.get("set-cookie")).toContain(
      "forge_admin_oauth_access_request=",
    )
    expect(response.headers.get("set-cookie")).not.toContain(
      "forge_admin_oauth_session=",
    )
  })

  it("reuses existing admin users by email without downgrading their role", async () => {
    cookieGet.mockImplementation((name: string) => {
      const values: Record<string, string> = {
        forge_admin_oauth_state: "state_123",
        forge_admin_oauth_verifier: "verifier_123",
        forge_admin_oauth_return_to: "/dashboard",
      }

      return values[name] ? { value: values[name] } : undefined
    })
    exchangeAdminAuthorizationCode.mockResolvedValueOnce({
      access_token: "access",
      scope: "openid admin:access",
    })
    verifyAdminIdToken.mockResolvedValueOnce({
      subject: "auth_user_123",
      email: "admin@example.com",
      name: "Admin User",
      scopes: ["openid", "admin:access"],
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
        data: expect.not.objectContaining({ role: expect.any(String) }),
      }),
    )
  })

  it("offers access request actions for existing viewer users", async () => {
    cookieGet.mockImplementation((name: string) => {
      const values: Record<string, string> = {
        forge_admin_oauth_state: "state_123",
        forge_admin_oauth_verifier: "verifier_123",
        forge_admin_oauth_return_to: "/dashboard",
      }

      return values[name] ? { value: values[name] } : undefined
    })
    exchangeAdminAuthorizationCode.mockResolvedValueOnce({
      access_token: "access",
      scope: "openid admin:access",
    })
    verifyAdminIdToken.mockResolvedValueOnce({
      subject: "viewer_user_123",
      email: "viewer@example.com",
      name: "Viewer User",
      scopes: ["openid", "admin:access"],
    })
    userFindUnique.mockResolvedValueOnce({
      id: "viewer_user_123",
      role: "VIEWER",
    })
    userUpdate.mockResolvedValueOnce({
      id: "viewer_user_123",
      role: "VIEWER",
    })

    const { GET } = await import("./route")
    const response = await GET(
      new Request(
        "http://localhost:3003/api/auth/callback?code=code_123&state=state_123",
      ),
    )

    expect(response.headers.get("location")).toBe(
      "http://localhost:3003/access-request",
    )
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "viewer_user_123" },
        data: expect.not.objectContaining({ role: expect.any(String) }),
      }),
    )
    expect(userCreate).not.toHaveBeenCalled()
    expect(userUpsert).not.toHaveBeenCalled()
    expect(response.headers.get("set-cookie")).toContain(
      "forge_admin_oauth_access_request=",
    )
    expect(response.headers.get("set-cookie")).not.toContain(
      "forge_admin_oauth_session=",
    )
  })

  it("preserves an existing subject-only user's stored role", async () => {
    cookieGet.mockImplementation((name: string) => {
      const values: Record<string, string> = {
        forge_admin_oauth_state: "state_123",
        forge_admin_oauth_verifier: "verifier_123",
        forge_admin_oauth_return_to: "/dashboard",
      }

      return values[name] ? { value: values[name] } : undefined
    })
    exchangeAdminAuthorizationCode.mockResolvedValueOnce({
      access_token: "access",
      scope: "openid admin:access",
    })
    verifyAdminIdToken.mockResolvedValueOnce({
      subject: "auth_subject_123",
      name: undefined,
      scopes: ["openid", "admin:access"],
    })
    userFindUnique.mockResolvedValueOnce({
      id: "auth_subject_123",
      role: "ADMIN",
    })
    userUpdate.mockResolvedValueOnce({
      id: "auth_subject_123",
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
    expect(userCreate).not.toHaveBeenCalled()
    expect(userUpsert).not.toHaveBeenCalled()
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "auth_subject_123" },
        data: expect.not.objectContaining({ role: expect.any(String) }),
      }),
    )
  })
})
