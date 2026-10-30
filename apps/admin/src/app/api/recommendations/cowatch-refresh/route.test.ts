import { beforeEach, describe, expect, it, vi } from "vitest"
const session = vi.hoisted(() => vi.fn())
vi.mock("@/auth/session", () => ({ resolveAdminSessionFromRequest: session }))
import { GET, POST } from "./route"
const request = () =>
  new Request("http://localhost/api/recommendations/cowatch-refresh")

describe("retired co-watch refresh route", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    session.mockResolvedValue({ principal: { id: "admin", role: "ADMIN" } })
  })
  it("requires authentication before either method", async () => {
    session.mockResolvedValue(null)
    expect((await GET(request())).status).toBe(401)
    expect((await POST(request())).status).toBe(401)
  })
  it("does not permit an old client to restart refresh", async () => {
    for (const response of [await GET(request()), await POST(request())]) {
      expect(response.status).toBe(410)
      expect(response.headers.get("cache-control")).toBe("no-store")
      expect(await response.json()).toEqual({
        ok: false,
        error: "behavioral_recommendations_retired",
      })
    }
  })
})
