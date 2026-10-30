import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  verifyAuthSession,
  fetchWatchProgressForUser,
  deleteWatchProgressForUser,
} = vi.hoisted(() => ({
  verifyAuthSession: vi.fn(),
  fetchWatchProgressForUser: vi.fn(),
  deleteWatchProgressForUser: vi.fn(),
}))

vi.mock("@/lib/auth-session", () => ({ verifyAuthSession }))
vi.mock("@/lib/watch-progress-server", () => ({
  deleteWatchProgressForUser,
  fetchWatchProgressForUser,
  syncWatchProgressForUser: vi.fn(),
}))
vi.mock("@/lib/watch-history", () => ({
  fetchWatchHistoryVideoDetails: vi.fn(),
}))

import { DELETE, GET, POST } from "./route"

describe("watch progress private responses", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("marks authenticated history responses private and cookie varying", async () => {
    verifyAuthSession.mockResolvedValue({
      authenticated: true,
      userId: "opaque",
    })
    fetchWatchProgressForUser.mockResolvedValue([])

    const response = await GET(
      new Request("https://www.jesusfilm.org/watch/api/watch-progress"),
    )

    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    )
    expect(response.headers.get("vary")).toBe("Cookie")
    expect(await response.json()).toMatchObject({ authenticated: true })
  })

  it("keeps unauthenticated responses out of shared caches", async () => {
    verifyAuthSession.mockResolvedValue({ authenticated: false })

    const response = await GET(
      new Request("https://www.jesusfilm.org/watch/api/watch-progress"),
    )

    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    )
    expect(response.headers.get("vary")).toBe("Cookie")
    expect(await response.json()).toMatchObject({ authenticated: false })
  })

  it("marks POST authentication and validation errors private", async () => {
    verifyAuthSession.mockResolvedValue({ authenticated: false })
    const unauthorized = await POST(
      new Request("https://www.jesusfilm.org/watch/api/watch-progress", {
        method: "POST",
        body: "{}",
      }),
    )
    expect(unauthorized.status).toBe(401)
    expect(unauthorized.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    )
    expect(unauthorized.headers.get("vary")).toBe("Cookie")

    verifyAuthSession.mockResolvedValue({
      authenticated: true,
      userId: "opaque",
    })
    const invalid = await POST(
      new Request("https://www.jesusfilm.org/watch/api/watch-progress", {
        method: "POST",
        body: "not json",
      }),
    )
    expect(invalid.status).toBe(400)
    expect(invalid.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    )
    expect(invalid.headers.get("vary")).toBe("Cookie")
  })

  it("marks DELETE responses private and cookie varying", async () => {
    verifyAuthSession.mockResolvedValue({
      authenticated: true,
      userId: "opaque",
    })
    deleteWatchProgressForUser.mockResolvedValue(true)
    const response = await DELETE(
      new Request("https://www.jesusfilm.org/watch/api/watch-progress", {
        method: "DELETE",
      }),
    )
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    )
    expect(response.headers.get("vary")).toBe("Cookie")
  })
})
