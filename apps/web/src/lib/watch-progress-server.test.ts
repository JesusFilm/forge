import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/env", () => ({
  env: {
    ADMIN_GRAPHQL_URL: "https://admin.example/api/graphql",
    WEB_ADMIN_API_KEYS: "test-key",
    WATCH_PROGRESS_ADMIN_API_KEYS: undefined,
  },
}))

const {
  deleteWatchProgressForUser,
  fetchWatchProgressForUser,
  syncWatchProgressForUser,
} = await import("./watch-progress-server")

const entry = {
  videoId: "video-1",
  languageSlug: "english",
  positionSeconds: 30,
  durationSeconds: 600,
  updatedAt: "2026-09-22T00:00:00.000Z",
}

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    json: () => Promise.resolve(body),
  } as unknown as Response
}

/** The shape `AbortSignal.timeout` rejects with, not a generic Error. */
function timeoutError() {
  return Object.assign(new Error("The operation was aborted due to timeout"), {
    name: "TimeoutError",
  })
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
  vi.stubGlobal("fetch", vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("watch-progress-server fail-soft contract", () => {
  it("returns the stored entries on a healthy read", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ entries: [entry] }))

    await expect(fetchWatchProgressForUser("user-1")).resolves.toEqual([entry])
  })

  it("returns an empty list instead of rejecting when the read times out", async () => {
    // `adminFetch` passes `AbortSignal.timeout(10_000)`, so a slow upstream
    // REJECTS rather than producing a non-OK response — which means the
    // existing `if (!response.ok) return []` never runs. Before this guard the
    // rejection escaped `/api/watch-progress` as a 500, and
    // `watch-progress-client.ts` reads any non-OK response as signed-out. That
    // is the FGE-185 symptom reached by a second path.
    vi.mocked(fetch).mockRejectedValue(timeoutError())

    await expect(fetchWatchProgressForUser("user-1")).resolves.toEqual([])
  })

  it("returns an empty list when the read body is not JSON", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new SyntaxError("Unexpected token <")),
    } as unknown as Response)

    await expect(fetchWatchProgressForUser("user-1")).resolves.toEqual([])
  })

  it("still returns an empty list for a non-OK read", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}, false))

    await expect(fetchWatchProgressForUser("user-1")).resolves.toEqual([])
  })

  it("returns an empty list instead of rejecting when the write fails", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("fetch failed"))

    await expect(
      syncWatchProgressForUser({ userId: "user-1", entries: [entry] }),
    ).resolves.toEqual([])
  })

  it("reports failure instead of rejecting when the delete fails", async () => {
    vi.mocked(fetch).mockRejectedValue(timeoutError())

    await expect(deleteWatchProgressForUser("user-1")).resolves.toBe(false)
  })

  it("logs each degraded call as a plain-string event carrying the type name only", async () => {
    vi.mocked(fetch).mockRejectedValue(timeoutError())

    await fetchWatchProgressForUser("user-1")
    await syncWatchProgressForUser({ userId: "user-1", entries: [] })
    await deleteWatchProgressForUser("user-1")

    expect(vi.mocked(console.warn).mock.calls.map(([line]) => line)).toEqual([
      "[watch-progress-server] event=progress_read_unavailable reason=TimeoutError",
      "[watch-progress-server] event=progress_write_unavailable reason=TimeoutError",
      "[watch-progress-server] event=progress_delete_unavailable reason=TimeoutError",
    ])
  })

  it("stays silent on a healthy call", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ entries: [] }))

    await fetchWatchProgressForUser("user-1")

    expect(console.warn).not.toHaveBeenCalled()
  })
})
