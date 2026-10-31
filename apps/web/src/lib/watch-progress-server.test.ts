import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/env", () => ({
  env: {
    ADMIN_GRAPHQL_URL: "https://admin.example.test/api/graphql",
    WATCH_PROGRESS_ADMIN_API_KEYS: "progress-bearer,previous-bearer",
    WEB_ADMIN_API_KEYS: "general-bearer",
  },
}))

import {
  fetchWatchProgressForUser,
  syncWatchProgressForUser,
  deleteWatchProgressForUser,
} from "./watch-progress-server"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("watch progress upstream boundaries", () => {
  it("forwards the bootstrap abort while keeping the independent upstream deadline", async () => {
    const controller = new AbortController()
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout")
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true },
          )
        }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const pending = fetchWatchProgressForUser("user/one", controller.signal)
    const rejected = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    })
    expect(timeoutSpy).toHaveBeenCalledExactlyOnceWith(10_000)
    const [url, init] = fetchMock.mock.calls[0]
    expect(new URL(url).searchParams.get("userId")).toBe("user/one")
    expect(init.cache).toBe("no-store")
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer progress-bearer",
    )
    controller.abort()
    await rejected
    expect(init.signal?.aborted).toBe(true)
  })

  it("keeps progress writes/deletion authenticated, uncached and account-bound", async () => {
    const fetchMock = vi.fn(async () => Response.json({ entries: [] }))
    vi.stubGlobal("fetch", fetchMock)
    await syncWatchProgressForUser({ userId: "signed-in-user", entries: [] })
    await expect(deleteWatchProgressForUser("signed-in-user")).resolves.toBe(
      true,
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [, init] of vi.mocked(fetch).mock.calls) {
      expect(init?.cache).toBe("no-store")
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer progress-bearer",
      )
      expect(JSON.parse(String(init?.body))).toMatchObject({
        userId: "signed-in-user",
      })
      expect(init?.signal).toBeInstanceOf(AbortSignal)
    }
    expect(vi.mocked(fetch).mock.calls.map(([, init]) => init?.method)).toEqual(
      ["POST", "DELETE"],
    )
  })
})
