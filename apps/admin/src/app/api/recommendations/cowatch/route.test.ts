import { beforeEach, describe, expect, it, vi } from "vitest"
const session = vi.hoisted(() => vi.fn())
vi.mock("@/auth/session", () => ({ resolveAdminSessionFromRequest: session }))
import { GET } from "./route"
const request = () =>
  new Request("http://localhost/api/recommendations/cowatch")

describe("retired co-watch inspection route", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    session.mockResolvedValue({ principal: { id: "admin", role: "ADMIN" } })
  })
  it("requires authentication", async () => {
    session.mockResolvedValue(null)
    expect((await GET(request())).status).toBe(401)
  })
  it("requires aggregate permission", async () => {
    session.mockResolvedValue({ principal: { id: "viewer", role: "VIEWER" } })
    expect((await GET(request())).status).toBe(403)
  })
  it("returns a non-cacheable retired tombstone", async () => {
    const response = await GET(request())
    expect(response.status).toBe(410)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({
      ok: false,
      error: "behavioral_recommendations_retired",
    })
  })
})
