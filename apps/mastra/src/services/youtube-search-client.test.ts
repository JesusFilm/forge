import { describe, expect, it, vi } from "vitest"

import {
  YouTubeSearchError,
  listPlaylistVideos,
  parseChannelRef,
  resolveUploadsPlaylist,
  searchVideos,
} from "./youtube-search-client"

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  })
}

const OPTS = { apiKey: "yt-key", maxAttempts: 1 }

describe("searchVideos", () => {
  it("returns items from a search.list response", async () => {
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) =>
      jsonResponse({ items: [{ id: { videoId: "v1" }, snippet: {} }] }),
    )
    const items = await searchVideos("ai jesus", {
      ...OPTS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(items).toHaveLength(1)
    const calledUrl = new URL(String(fetchImpl.mock.calls[0]![0]))
    expect(calledUrl.searchParams.get("q")).toBe("ai jesus")
    expect(calledUrl.searchParams.get("type")).toBe("video")
    expect(calledUrl.searchParams.get("key")).toBe("yt-key")
  })

  it("throws config_missing when no api key is set", async () => {
    const fetchImpl = vi.fn()
    await expect(
      searchVideos("q", { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: "config_missing" })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("maps 401 to auth_failed (not retryable)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, { status: 401 }))
    await expect(
      searchVideos("q", {
        ...OPTS,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "auth_failed", retryable: false })
  })

  it("maps a 403 quota error to retryable rate_limited", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        { error: { errors: [{ reason: "quotaExceeded" }] } },
        { status: 403 },
      ),
    )
    await expect(
      searchVideos("q", {
        ...OPTS,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "rate_limited", retryable: true })
  })

  it("maps a plain 403 to auth_failed", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        { error: { errors: [{ reason: "forbidden" }] } },
        { status: 403 },
      ),
    )
    await expect(
      searchVideos("q", {
        ...OPTS,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "auth_failed" })
  })

  it("maps 500 to retryable upstream_failed", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, { status: 500 }))
    await expect(
      searchVideos("q", {
        ...OPTS,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "upstream_failed", retryable: true })
  })

  it("maps malformed JSON to invalid_response", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("not json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    )
    await expect(
      searchVideos("q", {
        ...OPTS,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "invalid_response" })
  })

  it("retries transient failures then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, { status: 503 }))
      .mockResolvedValueOnce(
        jsonResponse({ items: [{ id: { videoId: "v2" } }] }),
      )
    const items = await searchVideos("q", {
      apiKey: "yt-key",
      maxAttempts: 2,
      sleep: async () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(items).toHaveLength(1)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})

describe("resolveUploadsPlaylist", () => {
  it("returns the uploads playlist id", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        items: [
          { contentDetails: { relatedPlaylists: { uploads: "UU_grace" } } },
        ],
      }),
    )
    const uploads = await resolveUploadsPlaylist("UC_grace_channel_id_000000", {
      ...OPTS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(uploads).toBe("UU_grace")
  })

  it("throws not_found when the channel list is empty", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ items: [] }))
    await expect(
      resolveUploadsPlaylist("@grace", {
        ...OPTS,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "not_found" })
  })
})

describe("listPlaylistVideos", () => {
  it("returns items from a playlistItems.list response", async () => {
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) =>
      jsonResponse({
        items: [{ contentDetails: { videoId: "p1" }, snippet: {} }],
      }),
    )
    const items = await listPlaylistVideos("UU_grace", {
      ...OPTS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(items).toHaveLength(1)
    const calledUrl = new URL(String(fetchImpl.mock.calls[0]![0]))
    expect(calledUrl.searchParams.get("playlistId")).toBe("UU_grace")
  })
})

describe("parseChannelRef", () => {
  it("treats a UC… id as an id lookup", () => {
    expect(parseChannelRef("UCabcdefghijklmnopqrstuv")).toEqual({
      param: "id",
      value: "UCabcdefghijklmnopqrstuv",
    })
  })

  it("treats an @handle as a forHandle lookup", () => {
    expect(parseChannelRef("@graceFilms")).toEqual({
      param: "forHandle",
      value: "@graceFilms",
    })
  })

  it("extracts a channel id from a channel URL", () => {
    expect(
      parseChannelRef("https://youtube.com/channel/UCabcdefghijklmnopqrstuv"),
    ).toEqual({ param: "id", value: "UCabcdefghijklmnopqrstuv" })
  })

  it("extracts a handle from a youtube.com/@handle URL", () => {
    expect(parseChannelRef("https://www.youtube.com/@graceFilms")).toEqual({
      param: "forHandle",
      value: "@graceFilms",
    })
  })

  it("falls back to forHandle for a bare name", () => {
    expect(parseChannelRef("graceFilms")).toEqual({
      param: "forHandle",
      value: "@graceFilms",
    })
  })
})

describe("YouTubeSearchError", () => {
  it("carries a code and retryable flag", () => {
    const err = new YouTubeSearchError("rate_limited", "boom", true)
    expect(err.code).toBe("rate_limited")
    expect(err.retryable).toBe(true)
    expect(err.name).toBe("YouTubeSearchError")
  })
})
