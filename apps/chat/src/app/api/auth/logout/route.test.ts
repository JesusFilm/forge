// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest"

beforeAll(() => {
  process.env.CHAT_BASE_URL = "https://chat.example.com"
})

describe("POST /api/auth/logout (F2/R6)", () => {
  it("clears the session cookie and 303s home (GET after POST)", async () => {
    const { POST } = await import("./route")
    const res = await POST()
    expect(res.status).toBe(303)
    expect(res.headers.get("location")).toBe("https://chat.example.com/")
    // Deletion = an empty, expired Set-Cookie for the session cookie.
    expect(res.headers.getSetCookie().join("\n")).toMatch(
      /forge_chat_session=;[^\n]*(Max-Age=0|Expires=Thu, 01 Jan 1970)/i,
    )
  })

  it("sets the hardened 30-day force-login marker (feat-240)", async () => {
    const { POST } = await import("./route")
    const res = await POST()
    const marker = res.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith("forge_chat_force_login="))
    expect(marker).toBeDefined()
    expect(marker).toContain("forge_chat_force_login=1")
    expect(marker).toContain(`Max-Age=${60 * 60 * 24 * 30}`)
    expect(marker).toContain("HttpOnly")
    expect(marker?.toLowerCase()).toContain("samesite=lax")
    expect(marker).toContain("Path=/")
    // Host-only: no Domain, never the parent .jesusfilm.org (R11).
    expect(marker?.toLowerCase()).not.toContain("domain=")
  })

  it("is idempotent when already anonymous (no throw, still 303 home)", async () => {
    const { POST } = await import("./route")
    const res = await POST()
    expect(res.status).toBe(303)
  })
})
