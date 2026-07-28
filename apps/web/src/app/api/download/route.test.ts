/**
 * @vitest-environment node
 *
 * Route handler tests for the same-origin download resolver.
 * Downloads validate the target and redirect to the CDN so Web does not proxy
 * media or subtitle bytes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { isWatchDownloadAccountGateEnabledMock } = vi.hoisted(() => ({
  isWatchDownloadAccountGateEnabledMock: vi.fn(async () => true),
}))

vi.mock("node:dns", () => ({
  promises: {
    resolve4: vi.fn(async () => ["203.0.113.1"]),
    resolve6: vi.fn(async () => {
      throw new Error("ENODATA")
    }),
  },
}))

vi.mock("@/lib/auth-session", () => ({
  verifyAuthSession: vi.fn(async () => ({
    authenticated: true,
    user: { id: "user_123" },
  })),
}))

vi.mock("@/lib/feature-flags", () => ({
  isWatchDownloadAccountGateEnabled: isWatchDownloadAccountGateEnabledMock,
  watchDownloadAccountGateFlagContext: {
    custom: {
      surface: "watch-download",
    },
  },
}))

import { promises as dns } from "node:dns"

import { GET, HEAD } from "./route"

const ROUTE_URL = "https://example.test/watch/api/download"

function makeRequest(
  query: Record<string, string>,
  init: RequestInit = {},
): Request {
  const url = new URL(ROUTE_URL)
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value)
  }
  return new Request(url, init)
}

afterEach(() => {
  isWatchDownloadAccountGateEnabledMock.mockResolvedValue(true)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("GET /watch/api/download - DNS pre-flight", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
  })

  it("rejects when the hostname resolves to loopback IP", async () => {
    vi.mocked(dns.resolve4).mockResolvedValueOnce(["127.0.0.1"])

    const res = await GET(
      makeRequest({ url: "https://stream.mux.com/abc.mp4" }),
    )

    expect(res.status).toBe(403)
  })

  it("rejects when any resolved IP is private", async () => {
    vi.mocked(dns.resolve4).mockResolvedValueOnce(["203.0.113.1", "10.0.0.5"])

    const res = await GET(
      makeRequest({ url: "https://stream.mux.com/abc.mp4" }),
    )

    expect(res.status).toBe(403)
  })

  it("rejects IPv4-mapped-IPv6 private addresses", async () => {
    vi.mocked(dns.resolve4).mockRejectedValueOnce(new Error("ENODATA"))
    vi.mocked(dns.resolve6).mockResolvedValueOnce(["::ffff:127.0.0.1"])

    const res = await GET(
      makeRequest({ url: "https://stream.mux.com/abc.mp4" }),
    )

    expect(res.status).toBe(403)
  })

  it("redirects when resolution is public", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const res = await GET(
      makeRequest({ url: "https://stream.mux.com/abc.mp4" }),
    )

    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe("https://stream.mux.com/abc.mp4")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("GET /watch/api/download - input validation", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
  })

  it("returns 400 when the target is missing", async () => {
    const res = await GET(makeRequest({}))

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      error: "Missing required `url` or download identifiers",
    })
  })

  it("returns 403 when the URL is not allowlisted", async () => {
    const res = await GET(makeRequest({ url: "https://evil.com/payload.mp4" }))

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" })
  })

  it("rejects http downgrades from allowlisted hostnames", async () => {
    const res = await GET(makeRequest({ url: "http://stream.mux.com/abc.mp4" }))

    expect(res.status).toBe(403)
  })

  it("rejects anonymous raw-URL attachment downloads when the account gate is disabled", async () => {
    isWatchDownloadAccountGateEnabledMock.mockResolvedValueOnce(false)

    const res = await GET(
      makeRequest({
        url: "https://stream.mux.com/abc.mp4",
        filename: "x.mp4",
      }),
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      error: "Download identifiers required",
    })
  })

  it("rejects anonymous raw-URL inline media when the account gate is disabled", async () => {
    isWatchDownloadAccountGateEnabledMock.mockResolvedValueOnce(false)
    const fetchMock = vi.fn(async () => new Response("should not happen"))
    vi.stubGlobal("fetch", fetchMock)

    const res = await GET(
      makeRequest({
        disposition: "inline",
        url: "https://stream.mux.com/example.mp4",
      }),
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      error: "Download identifiers required",
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("GET /watch/api/download - redirect path", () => {
  it("redirects attachment downloads without fetching upstream media", async () => {
    const fetchMock = vi.fn(async () => new Response("should not happen"))
    vi.stubGlobal("fetch", fetchMock)

    const res = await GET(
      makeRequest({
        url: "https://stream.mux.com/abc.mp4?token=secret#fragment",
        filename: "Jesus-Film_English_eng_360p.mp4",
      }),
    )

    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe(
      "https://stream.mux.com/abc.mp4?token=secret",
    )
    expect(res.headers.get("cache-control")).toContain("no-store")
    expect(res.headers.get("x-content-type-options")).toBe("nosniff")
    expect(res.headers.has("content-disposition")).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("GET /watch/api/download - inline subtitles", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
  })

  it("redirects allowlisted VTT subtitles inline without fetching upstream", async () => {
    const fetchMock = vi.fn(async () => new Response("should not happen"))
    vi.stubGlobal("fetch", fetchMock)

    const res = await GET(
      makeRequest({
        url: "https://api-media-core.jesusfilm.org/subtitles/example.vtt",
        disposition: "inline",
      }),
    )

    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe(
      "https://api-media-core.jesusfilm.org/subtitles/example.vtt",
    )
    expect(res.headers.get("cache-control")).toContain("no-store")
    expect(await res.text()).toBe("")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("HEAD /watch/api/download", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
  })

  it("redirects without fetching upstream metadata", async () => {
    const fetchMock = vi.fn(async () => new Response("should not happen"))
    vi.stubGlobal("fetch", fetchMock)

    const res = await HEAD(
      makeRequest({ url: "https://stream.mux.com/abc/1080p.mp4" }),
    )

    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe(
      "https://stream.mux.com/abc/1080p.mp4",
    )
    expect(res.headers.get("cache-control")).toContain("no-store")
    expect(await res.text()).toBe("")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects non-allowlisted URLs", async () => {
    const res = await HEAD(makeRequest({ url: "https://evil.com/payload.mp4" }))

    expect(res.status).toBe(403)
  })

  it("rejects private DNS results", async () => {
    vi.mocked(dns.resolve4).mockResolvedValueOnce(["10.0.0.5"])

    const res = await HEAD(
      makeRequest({ url: "https://stream.mux.com/abc.mp4" }),
    )

    expect(res.status).toBe(403)
  })
})
