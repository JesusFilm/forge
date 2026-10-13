/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  ensureWatchProgressAuth,
  getWatchProgressRatio,
  getWatchProgress,
  loadWatchProgressHistory,
  saveWatchProgress,
  type WatchProgressEntry,
} from "./watch-progress-client"

function entry(overrides: Partial<WatchProgressEntry>): WatchProgressEntry {
  return {
    videoId: "video-1",
    positionSeconds: 10,
    durationSeconds: 100,
    updatedAt: 1,
    ...overrides,
  }
}

describe("getWatchProgressRatio", () => {
  it("returns a normalized partial progress ratio", () => {
    expect(getWatchProgressRatio(entry({ positionSeconds: 25 }))).toBe(0.25)
  })

  it("hides tiny and invalid progress", () => {
    expect(getWatchProgressRatio(entry({ positionSeconds: 0.2 }))).toBe(0)
    expect(getWatchProgressRatio(entry({ durationSeconds: 0 }))).toBe(0)
  })

  it("shows a full bar at the 90 percent completion threshold", () => {
    expect(getWatchProgressRatio(entry({ positionSeconds: 90 }))).toBe(1)
    expect(getWatchProgressRatio(entry({ positionSeconds: 97 }))).toBe(1)
  })
})

describe("watch progress bootstrap auth", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  async function freshClient() {
    vi.resetModules()
    return import("./watch-progress-client")
  }

  function bootstrapBody(watchProgress: unknown) {
    return Response.json({
      contractVersion: "watch-bootstrap-v1",
      account: null,
      betaTesterCta: null,
      watchProgress,
    })
  }

  it.each([
    ["anonymous section", () => bootstrapBody({ authenticated: false })],
    ["unavailable section", () => bootstrapBody(null)],
    ["malformed section", () => bootstrapBody({ authenticated: true })],
    ["failed bootstrap", () => new Response(null, { status: 503 })],
    ["unknown contract", () => Response.json({ contractVersion: "v0" })],
  ])("keeps progress local for a %s", async (_name, respond) => {
    window.localStorage.clear()
    const fetchMock = vi.fn(async () => respond())
    vi.stubGlobal("fetch", fetchMock)
    const client = await freshClient()

    client.saveWatchProgress({
      videoId: "video-1",
      positionSeconds: 30,
      durationSeconds: 100,
    })

    await expect(client.ensureWatchProgressAuth()).resolves.toBe(false)
    expect(client.getWatchProgress("video-1")).toMatchObject({
      positionSeconds: 30,
    })
    expect(
      window.localStorage.getItem("forge.watch_progress.v1.anonymous"),
    ).not.toBeNull()
    // Anonymous visitors never sync, so the bootstrap is the only request.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe("watch progress storage", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("stores anonymous progress locally before auth resolves", () => {
    window.localStorage.clear()

    saveWatchProgress({
      videoId: "video-1",
      positionSeconds: 30,
      durationSeconds: 100,
    })

    expect(getWatchProgress("video-1")).toMatchObject({
      videoId: "video-1",
      positionSeconds: 30,
      durationSeconds: 100,
    })
  })

  it("merges anonymous progress into the signed-in profile and syncs it", async () => {
    window.localStorage.clear()
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/watch/api/bootstrap") && init?.method == null) {
        return new Response(
          JSON.stringify({
            contractVersion: "watch-bootstrap-v1",
            account: null,
            betaTesterCta: null,
            watchProgress: {
              authenticated: true,
              userId: "user-1",
              entries: [
                {
                  videoId: "video-1",
                  positionSeconds: 10,
                  durationSeconds: 100,
                  updatedAt: new Date(1).toISOString(),
                },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      }
      return new Response(JSON.stringify({ entries: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    saveWatchProgress({
      videoId: "video-1",
      languageSlug: "spanish-castilian",
      positionSeconds: 40,
      durationSeconds: 100,
    })

    await expect(ensureWatchProgressAuth()).resolves.toBe(true)

    // The initial signed-in read comes from the shared bootstrap, not a
    // dedicated GET to the watch-progress route.
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        url.includes("/watch/api/bootstrap"),
      ),
    ).toHaveLength(1)
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          url === "/watch/api/watch-progress" && init?.method == null,
      ),
    ).toHaveLength(0)

    expect(getWatchProgress("video-1")).toMatchObject({
      positionSeconds: 40,
      languageSlug: "spanish-castilian",
      durationSeconds: 100,
    })
    expect(
      window.localStorage.getItem("forge.watch_progress.v1.anonymous"),
    ).toBeNull()
    expect(fetchMock).toHaveBeenCalledWith(
      "/watch/api/watch-progress",
      expect.objectContaining({ method: "POST" }),
    )
    expect(
      JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body)),
    ).toMatchObject({
      entries: [
        expect.objectContaining({
          videoId: "video-1",
          languageSlug: "spanish-castilian",
        }),
      ],
    })
  })

  it("submits locally stored progress when loading history", async () => {
    window.localStorage.clear()
    window.localStorage.setItem(
      "forge.watch_progress.v1.current_user",
      "user-1",
    )
    window.localStorage.setItem(
      "forge.watch_progress.v1.user.user-1",
      JSON.stringify({
        "video-1": {
          videoId: "video-1",
          languageSlug: "spanish-castilian",
          positionSeconds: 20,
          durationSeconds: 100,
          updatedAt: 2,
        },
      }),
    )
    window.localStorage.setItem(
      "forge.watch_progress.v1.user.user-2",
      JSON.stringify({
        "video-2": {
          videoId: "video-2",
          languageSlug: "english",
          positionSeconds: 80,
          durationSeconds: 100,
          updatedAt: 3,
        },
      }),
    )
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
      return new Response(
        JSON.stringify({
          authenticated: true,
          userId: "user-1",
          entries: [
            {
              videoId: "video-1",
              languageSlug: "spanish-castilian",
              positionSeconds: 20,
              durationSeconds: 100,
              updatedAt: new Date(2).toISOString(),
            },
          ],
          videos: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(loadWatchProgressHistory()).resolves.toMatchObject({
      authenticated: true,
      entries: [
        expect.objectContaining({
          videoId: "video-1",
          languageSlug: "spanish-castilian",
        }),
      ],
    })

    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      localUserId: "user-1",
      entries: [
        expect.objectContaining({
          videoId: "video-1",
          languageSlug: "spanish-castilian",
        }),
      ],
      includeVideos: true,
    })
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).not.toContain("video-2")
  })
})
