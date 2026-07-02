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

  it("is idempotent when already anonymous (no throw, still 303 home)", async () => {
    const { POST } = await import("./route")
    const res = await POST()
    expect(res.status).toBe(303)
  })
})
