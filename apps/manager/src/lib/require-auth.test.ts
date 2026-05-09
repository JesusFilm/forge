import { beforeEach, describe, expect, it, vi } from "vitest"

const { cookiesMock, redirectMock, verifyManagerSessionMock } = vi.hoisted(
  () => ({
    cookiesMock: vi.fn(),
    redirectMock: vi.fn((path: string) => {
      throw new Error(`redirect:${path}`)
    }),
    verifyManagerSessionMock: vi.fn(),
  }),
)

vi.mock("next/headers", () => ({
  cookies: cookiesMock,
}))

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}))

vi.mock("@/lib/auth", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth")
  return {
    ...actual,
    verifyManagerSession: verifyManagerSessionMock,
  }
})

describe("requireAuth", () => {
  beforeEach(() => {
    cookiesMock.mockReset()
    redirectMock.mockClear()
    verifyManagerSessionMock.mockReset()
  })

  it("accepts Admin-backed users with ManagerRole.OPERATOR", async () => {
    cookiesMock.mockResolvedValue({
      get: (name: string) =>
        name === "manager-session"
          ? { value: "better-auth.session_token=admin-session" }
          : undefined,
    })
    verifyManagerSessionMock.mockResolvedValue({
      id: "admin-user-1",
      username: "viewer@example.test",
      email: "viewer@example.test",
      role: { name: "VIEWER", type: "viewer" },
      managerRole: "OPERATOR",
    })

    const { requireAuth } = await import("./require-auth")

    await expect(requireAuth()).resolves.toEqual({
      username: "viewer@example.test",
      email: "viewer@example.test",
    })
    expect(redirectMock).not.toHaveBeenCalled()
  })

  it("redirects when the verified session lacks Manager access", async () => {
    cookiesMock.mockResolvedValue({
      get: (name: string) =>
        name === "manager-session" ? { value: "session-token" } : undefined,
    })
    verifyManagerSessionMock.mockResolvedValue({
      id: 1,
      username: "other",
      email: "other@example.test",
      role: { name: "Authenticated", type: "authenticated" },
    })

    const { requireAuth } = await import("./require-auth")

    await expect(requireAuth()).rejects.toThrow("redirect:/login")
    expect(redirectMock).toHaveBeenCalledWith("/login")
  })
})
