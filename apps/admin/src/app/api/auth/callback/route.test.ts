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
const bindingFindUnique = vi.fn()
const bindingCreate = vi.fn()
const bindingUpdate = vi.fn()

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
    adminAuthSubjectBinding: {
      findUnique: (...args: unknown[]) => bindingFindUnique(...args),
      create: (...args: unknown[]) => bindingCreate(...args),
      update: (...args: unknown[]) => bindingUpdate(...args),
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
    bindingFindUnique.mockReset().mockResolvedValue(null)
    bindingCreate.mockReset().mockResolvedValue({ subject: "created" })
    bindingUpdate.mockReset().mockResolvedValue({ subject: "updated" })
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
  function primeCallback(identity: {
    subject: string
    email?: string
    name?: string
  }) {
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
      ...identity,
      scopes: ["openid", "admin:access"],
    })
  }

  async function callback() {
    const { GET } = await import("./route")
    return GET(
      new Request(
        "http://localhost:3003/api/auth/callback?code=code_123&state=state_123",
      ),
    )
  }

  describe("Auth subject -> Admin user binding", () => {
    it("records the binding for an email-matched user whose id differs from the subject", async () => {
      primeCallback({ subject: "auth_sub_A", email: "admin@example.com" })
      userFindUnique.mockResolvedValueOnce({ id: "cuid_admin", role: "ADMIN" })
      userUpdate.mockResolvedValueOnce({ id: "cuid_admin", role: "ADMIN" })

      const response = await callback()

      expect(response.headers.get("location")).toBe(
        "http://localhost:3003/dashboard",
      )
      expect(bindingCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subject: "auth_sub_A",
            userId: "cuid_admin",
          }),
        }),
      )
      // Binding is recorded before the profile write.
      expect(bindingCreate.mock.invocationCallOrder[0]).toBeLessThan(
        userUpdate.mock.invocationCallOrder[0]!,
      )
    })

    it("records an identity binding for a legacy subject-id user", async () => {
      primeCallback({ subject: "auth_sub_B" })
      userFindUnique.mockResolvedValueOnce({ id: "auth_sub_B", role: "ADMIN" })
      userUpdate.mockResolvedValueOnce({ id: "auth_sub_B", role: "ADMIN" })

      await callback()

      expect(bindingCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subject: "auth_sub_B",
            userId: "auth_sub_B",
          }),
        }),
      )
    })

    it("refreshes an existing matching binding instead of creating another", async () => {
      primeCallback({ subject: "auth_sub_A", email: "admin@example.com" })
      userFindUnique.mockResolvedValueOnce({ id: "cuid_admin", role: "ADMIN" })
      bindingFindUnique.mockResolvedValueOnce({ userId: "cuid_admin" })
      userUpdate.mockResolvedValueOnce({ id: "cuid_admin", role: "ADMIN" })

      const response = await callback()

      expect(response.headers.get("location")).toBe(
        "http://localhost:3003/dashboard",
      )
      expect(bindingCreate).not.toHaveBeenCalled()
      expect(bindingUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ where: { subject: "auth_sub_A" } }),
      )
    })

    it("rejects a subject already bound to a different user without writing any user row", async () => {
      // The Auth account's email now matches another Admin user.
      primeCallback({ subject: "auth_sub_A", email: "other@example.com" })
      userFindUnique.mockResolvedValueOnce({ id: "cuid_other", role: "ADMIN" })
      bindingFindUnique.mockResolvedValueOnce({ userId: "cuid_admin" })

      const response = await callback()

      expect(response.headers.get("location")).toBe(
        "http://localhost:3003/access-request?error=forbidden",
      )
      expect(userUpdate).not.toHaveBeenCalled()
      expect(bindingCreate).not.toHaveBeenCalled()
      expect(response.headers.get("set-cookie") ?? "").not.toContain(
        "forge_admin_oauth_session=",
      )
      expect(console.warn).toHaveBeenCalledWith(
        "admin.oauth.callback.forbidden",
        {
          reason: "subject_binding_conflict",
          conflict: "subject_bound_to_other_user",
        },
      )
    })

    it("rejects a new subject claiming a user already bound to another subject", async () => {
      primeCallback({ subject: "auth_sub_NEW", email: "admin@example.com" })
      userFindUnique.mockResolvedValueOnce({ id: "cuid_admin", role: "ADMIN" })
      bindingCreate.mockRejectedValueOnce(
        Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
      )
      // Re-read after the unique violation: the subject is still unbound.
      bindingFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null)

      const response = await callback()

      expect(response.headers.get("location")).toBe(
        "http://localhost:3003/access-request?error=forbidden",
      )
      expect(userUpdate).not.toHaveBeenCalled()
      expect(console.warn).toHaveBeenCalledWith(
        "admin.oauth.callback.forbidden",
        {
          reason: "subject_binding_conflict",
          conflict: "user_bound_to_other_subject",
        },
      )
    })

    it("accepts the winner of a concurrent first sign-in race for the same pair", async () => {
      primeCallback({ subject: "auth_sub_A", email: "admin@example.com" })
      userFindUnique.mockResolvedValueOnce({ id: "cuid_admin", role: "ADMIN" })
      bindingCreate.mockRejectedValueOnce(
        Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
      )
      bindingFindUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ userId: "cuid_admin" })
      userUpdate.mockResolvedValueOnce({ id: "cuid_admin", role: "ADMIN" })

      const response = await callback()

      expect(response.headers.get("location")).toBe(
        "http://localhost:3003/dashboard",
      )
    })

    it("does not record a binding when no Admin user exists", async () => {
      primeCallback({ subject: "auth_sub_X", email: "new@example.com" })
      userFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null)

      await callback()

      expect(bindingFindUnique).not.toHaveBeenCalled()
      expect(bindingCreate).not.toHaveBeenCalled()
    })
  })
})
