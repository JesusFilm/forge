import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const {
  deleteWatchProgressForUser,
  fetchWatchHistoryVideoDetails,
  fetchWatchProgressForUser,
  syncWatchProgressForUser,
  verifyAuthSession,
} = vi.hoisted(() => ({
  deleteWatchProgressForUser: vi.fn(),
  fetchWatchHistoryVideoDetails: vi.fn(),
  fetchWatchProgressForUser: vi.fn(),
  syncWatchProgressForUser: vi.fn(),
  verifyAuthSession: vi.fn(),
}))

vi.mock("@/lib/auth-session", () => ({ verifyAuthSession }))
vi.mock("@/lib/watch-progress-server", () => ({
  deleteWatchProgressForUser,
  fetchWatchProgressForUser,
  syncWatchProgressForUser,
}))
vi.mock("@/lib/watch-history", () => ({ fetchWatchHistoryVideoDetails }))

const { DELETE, GET, POST } = await import("./route")

const USER_ID = "user-1"

const entry = {
  videoId: "video-1",
  languageSlug: "english",
  positionSeconds: 30,
  durationSeconds: 600,
  updatedAt: "2026-09-22T00:00:00.000Z",
}

const videoDetails = {
  videoId: "video-1",
  title: "Title",
  label: "Short film",
  href: "/watch/slug.html/english.html",
  imageUrl: null,
  imageAlt: "Title",
  durationLabel: "10:00",
}

function request(body: unknown, method = "POST") {
  return new Request("https://watch.example/api/watch-progress", {
    method,
    headers: { "content-type": "application/json" },
    ...(method === "GET" || method === "DELETE"
      ? {}
      : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
  verifyAuthSession.mockResolvedValue({ authenticated: true, userId: USER_ID })
  fetchWatchProgressForUser.mockResolvedValue([entry])
  syncWatchProgressForUser.mockResolvedValue([entry])
  fetchWatchHistoryVideoDetails.mockResolvedValue([videoDetails])
})

afterEach(() => vi.restoreAllMocks())

describe("POST /api/watch-progress", () => {
  it("returns the history videos when the fan-out succeeds", async () => {
    const response = await POST(request({ includeVideos: true }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      authenticated: true,
      userId: USER_ID,
      entries: [entry],
      videos: [videoDetails],
    })
  })

  it("degrades to an authenticated response with no videos when the fan-out rejects", async () => {
    // The whole point of the route guard: the client treats any non-OK
    // response as signed-out (`authState = "anonymous"` in
    // watch-progress-client.ts), so a 500 here silently moves every
    // useWatchProgress consumer to the anonymous localStorage bucket.
    fetchWatchHistoryVideoDetails.mockRejectedValue(
      new Error("admin unreachable"),
    )

    const response = await POST(request({ includeVideos: true }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      authenticated: true,
      userId: USER_ID,
      entries: [entry],
      videos: [],
    })
  })

  it("logs the degraded fan-out as a plain-string event", async () => {
    fetchWatchHistoryVideoDetails.mockRejectedValue(
      new TypeError("fetch failed"),
    )

    await POST(request({ includeVideos: true }))

    expect(vi.mocked(console.warn).mock.calls.map(([line]) => line)).toEqual([
      "[watch-progress] event=history_videos_unavailable reason=TypeError",
    ])
  })

  it("still persists submitted entries when the fan-out rejects", async () => {
    fetchWatchHistoryVideoDetails.mockRejectedValue(new Error("nope"))
    fetchWatchProgressForUser.mockResolvedValue([])

    const response = await POST(
      request({ entries: [entry], includeVideos: true }),
    )

    expect(syncWatchProgressForUser).toHaveBeenCalledWith({
      userId: USER_ID,
      entries: [entry],
    })
    expect(response.status).toBe(200)
  })

  it("does not call the fan-out when includeVideos is absent", async () => {
    const response = await POST(request({ entries: [entry] }))

    expect(fetchWatchHistoryVideoDetails).not.toHaveBeenCalled()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ entries: [entry] })
  })

  it("rejects an unauthenticated caller before touching watch progress", async () => {
    verifyAuthSession.mockResolvedValue({ authenticated: false })

    const response = await POST(request({ includeVideos: true }))

    expect(response.status).toBe(401)
    expect(fetchWatchProgressForUser).not.toHaveBeenCalled()
    expect(fetchWatchHistoryVideoDetails).not.toHaveBeenCalled()
  })

  it("rejects a malformed JSON body", async () => {
    const response = await POST(request("{not json", "POST"))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "Invalid JSON body" })
  })

  it("rejects a payload that carries neither entries nor includeVideos", async () => {
    const response = await POST(request({}))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: "Invalid watch progress payload",
    })
  })

  it("ignores entries submitted under another local user id", async () => {
    const response = await POST(
      request({
        entries: [entry],
        localUserId: "someone-else",
        includeVideos: true,
      }),
    )

    expect(syncWatchProgressForUser).not.toHaveBeenCalled()
    expect(response.status).toBe(200)
  })
})

describe("GET /api/watch-progress", () => {
  it("returns an anonymous shape without a session", async () => {
    verifyAuthSession.mockResolvedValue({ authenticated: false })

    const response = await GET(request(null, "GET"))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      authenticated: false,
      userId: null,
      entries: [],
    })
  })

  it("returns the stored entries for a session", async () => {
    const response = await GET(request(null, "GET"))

    expect(await response.json()).toEqual({
      authenticated: true,
      userId: USER_ID,
      entries: [entry],
    })
  })
})

describe("DELETE /api/watch-progress", () => {
  it("requires a session", async () => {
    verifyAuthSession.mockResolvedValue({ authenticated: false })

    const response = await DELETE(request(null, "DELETE"))

    expect(response.status).toBe(401)
    expect(deleteWatchProgressForUser).not.toHaveBeenCalled()
  })

  it("clears the stored progress for a session", async () => {
    deleteWatchProgressForUser.mockResolvedValue(true)

    const response = await DELETE(request(null, "DELETE"))

    expect(deleteWatchProgressForUser).toHaveBeenCalledWith(USER_ID)
    expect(await response.json()).toEqual({ ok: true })
  })
})
