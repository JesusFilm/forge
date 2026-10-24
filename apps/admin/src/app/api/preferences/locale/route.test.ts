import { beforeEach, describe, expect, it, vi } from "vitest"

const cookieSet = vi.fn()

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    set: cookieSet,
  })),
}))

describe("locale preference route", () => {
  beforeEach(() => {
    cookieSet.mockReset()
  })

  it("persists a supported locale cookie", async () => {
    const { POST } = await import("./route")
    const request = new Request("http://localhost/api/preferences/locale", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locale: "es" }),
    })

    const response = await POST(request)
    const body = (await response.json()) as { ok: boolean }

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(cookieSet).toHaveBeenCalledWith(
      "forge-admin-locale",
      "es",
      expect.objectContaining({
        path: "/",
        sameSite: "lax",
      }),
    )
  })

  it("rejects unsupported locales", async () => {
    const { POST } = await import("./route")
    const request = new Request("http://localhost/api/preferences/locale", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locale: "fr" }),
    })

    const response = await POST(request)
    const body = (await response.json()) as { error: string }

    expect(response.status).toBe(400)
    expect(body.error).toBe("invalid-locale")
    expect(cookieSet).not.toHaveBeenCalled()
  })
})
