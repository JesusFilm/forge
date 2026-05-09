import { beforeEach, describe, expect, it, vi } from "vitest"

const { cookieDelete, cookiesMock, logoutManagerSessionMock } = vi.hoisted(
  () => ({
    cookieDelete: vi.fn(),
    cookiesMock: vi.fn(),
    logoutManagerSessionMock: vi.fn(),
  }),
)

vi.mock("next/headers", () => ({
  cookies: cookiesMock,
}))

vi.mock("@/cms/gateway", () => ({
  getCmsGateway: () => ({
    logoutManagerSession: logoutManagerSessionMock,
  }),
}))

describe("POST /api/auth/logout", () => {
  beforeEach(() => {
    cookieDelete.mockReset()
    cookiesMock.mockReset()
    logoutManagerSessionMock.mockReset()
  })

  it("revokes the Admin-backed Manager session before deleting the local cookie", async () => {
    cookiesMock.mockResolvedValue({
      get: (name: string) =>
        name === "manager-session"
          ? { value: "better-auth.session=abc" }
          : undefined,
      delete: cookieDelete,
    })
    logoutManagerSessionMock.mockResolvedValue(true)

    const { POST } = await import("./route")
    const response = await POST()

    expect(response.status).toBe(200)
    expect(logoutManagerSessionMock).toHaveBeenCalledWith(
      "better-auth.session=abc",
    )
    expect(cookieDelete).toHaveBeenCalledWith("manager-session")
  })

  it("deletes the local cookie even when no session token is present", async () => {
    cookiesMock.mockResolvedValue({
      get: () => undefined,
      delete: cookieDelete,
    })

    const { POST } = await import("./route")
    const response = await POST()

    expect(response.status).toBe(200)
    expect(logoutManagerSessionMock).not.toHaveBeenCalled()
    expect(cookieDelete).toHaveBeenCalledWith("manager-session")
  })
})
