import { beforeEach, describe, expect, it, vi } from "vitest"

const cookieGet = vi.fn()
const cookieDelete = vi.fn()
const readAdminOAuthAccessRequestCookie = vi.fn()
const userFindUnique = vi.fn()
const userUpdate = vi.fn()
const userCreate = vi.fn()

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: cookieGet,
    delete: cookieDelete,
  })),
}))

vi.mock("@/auth/auth-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/auth-session")>()
  return {
    ...actual,
    readAdminOAuthAccessRequestCookie: (...args: unknown[]) =>
      readAdminOAuthAccessRequestCookie(...args),
  }
})

vi.mock("@/db/client", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => userFindUnique(...args),
      update: (...args: unknown[]) => userUpdate(...args),
      create: (...args: unknown[]) => userCreate(...args),
    },
  },
}))

describe("admin OAuth access request route", () => {
  beforeEach(() => {
    cookieGet.mockReset()
    cookieDelete.mockReset()
    readAdminOAuthAccessRequestCookie.mockReset()
    userFindUnique.mockReset()
    userUpdate.mockReset()
    userCreate.mockReset()
  })

  it("creates a pending viewer row from the signed request cookie", async () => {
    cookieGet.mockReturnValue({ value: "signed" })
    readAdminOAuthAccessRequestCookie.mockResolvedValueOnce({
      subject: "subject_123",
      email: "user@example.com",
      name: "Test User",
    })
    userFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    userCreate.mockResolvedValueOnce({ id: "subject_123" })

    const { POST } = await import("./route")
    const response = await POST()

    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(response.status).toBe(202)
    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: "subject_123",
          email: "user@example.com",
          role: "VIEWER",
        }),
      }),
    )
  })

  it("rejects missing request cookies", async () => {
    cookieGet.mockReturnValue(undefined)
    readAdminOAuthAccessRequestCookie.mockResolvedValueOnce(null)

    const { POST } = await import("./route")
    const response = await POST()

    expect(response.status).toBe(400)
    expect(userCreate).not.toHaveBeenCalled()
  })
})
