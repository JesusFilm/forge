/**
 * @vitest-environment node
 *
 * Route handler tests for the same-origin download resolver.
 * Downloads validate the target and redirect to the CDN. Inline VTT tracks
 * remain same-origin through a narrow streaming proxy.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const {
  isWatchDownloadAccountGateEnabledMock,
  resolveWatchSubtitleTargetMock,
} = vi.hoisted(() => ({
  isWatchDownloadAccountGateEnabledMock: vi.fn(async () => true),
  resolveWatchSubtitleTargetMock: vi.fn(),
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

vi.mock("@/lib/subtitle-target", () => ({
  resolveWatchSubtitleTarget: resolveWatchSubtitleTargetMock,
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
  resolveWatchSubtitleTargetMock.mockReset()
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
    expect(res.headers.get("location")).toBe(
      "https://stream.mux.com/abc.mp4?download=abc.mp4",
    )
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
      "https://stream.mux.com/abc.mp4?token=secret&download=Jesus-Film_English_eng_360p.mp4",
    )
    expect(res.headers.get("cache-control")).toContain("no-store")
    expect(res.headers.get("x-content-type-options")).toBe("nosniff")
    expect(res.headers.has("content-disposition")).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("sanitizes the Mux download filename parameter", async () => {
    const fetchMock = vi.fn(async () => new Response("should not happen"))
    vi.stubGlobal("fetch", fetchMock)

    const res = await GET(
      makeRequest({
        url: "https://stream.mux.com/abc.mp4",
        filename: 'bad/name;\r\n"movie"',
      }),
    )

    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe(
      "https://stream.mux.com/abc.mp4?download=badnamemovie.mp4",
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("does not add Mux download parameters to non-Mux redirects", async () => {
    const fetchMock = vi.fn(async () => new Response("should not happen"))
    vi.stubGlobal("fetch", fetchMock)

    const res = await GET(
      makeRequest({
        url: "https://api-media-core.jesusfilm.org/media/example.mp4",
        filename: "video.mp4",
      }),
    )

    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe(
      "https://api-media-core.jesusfilm.org/media/example.mp4",
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("GET /watch/api/download - inline subtitles", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    resolveWatchSubtitleTargetMock.mockResolvedValue({
      ok: true,
      target: "https://api-media-core.jesusfilm.org/subtitles/chinese.vtt",
    })
  })

  it("streams alternate-language VTT subtitles through the same-origin proxy", async () => {
    const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nChinese cue\n"
    const fetchMock = vi.fn(
      async () =>
        new Response(vtt, {
          status: 200,
          headers: {
            "content-encoding": "gzip",
            "content-length": "23",
            "content-type": "text/vtt",
          },
        }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const res = await GET(
      makeRequest({
        disposition: "inline",
        subtitleId: "subtitle-1",
        variantId: "variant-1",
      }),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("text/vtt")
    expect(res.headers.get("content-disposition")).toBe("inline")
    expect(res.headers.get("content-encoding")).toBeNull()
    expect(res.headers.get("content-length")).toBeNull()
    expect(res.headers.get("cache-control")).toContain("no-store")
    expect(res.headers.get("x-content-type-options")).toBe("nosniff")
    expect(res.headers.get("location")).toBeNull()
    expect(await res.text()).toBe(vtt)
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api-media-core.jesusfilm.org/subtitles/chinese.vtt",
      expect.objectContaining({ redirect: "manual" }),
    )
    expect(resolveWatchSubtitleTargetMock).toHaveBeenCalledWith({
      subtitleId: "subtitle-1",
      variantId: "variant-1",
    })
  })

  it("does not proxy legacy raw URLs as anonymous inline subtitles", async () => {
    isWatchDownloadAccountGateEnabledMock.mockResolvedValueOnce(false)
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const res = await GET(
      makeRequest({
        url: "https://api-media-core.jesusfilm.org/subtitles/chinese.vtt",
        disposition: "inline",
      }),
    )

    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(resolveWatchSubtitleTargetMock).not.toHaveBeenCalled()
  })

  it("rejects resolved subtitle URLs outside the exact Core VTT origin", async () => {
    resolveWatchSubtitleTargetMock.mockResolvedValueOnce({
      ok: true,
      target: "https://subtitles.jesusfilm.org/example.vtt",
    })
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const res = await GET(
      makeRequest({
        disposition: "inline",
        subtitleId: "subtitle-1",
        variantId: "variant-1",
      }),
    )

    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ["missing-params", 400, "Subtitle identifiers required"],
    ["unavailable", 503, "Subtitle lookup unavailable"],
    ["not-found", 404, "Subtitle unavailable"],
  ] as const)(
    "maps subtitle lookup %s failures to HTTP %s",
    async (reason, status, message) => {
      resolveWatchSubtitleTargetMock.mockResolvedValueOnce({
        ok: false,
        reason,
      })
      const fetchMock = vi.fn()
      vi.stubGlobal("fetch", fetchMock)

      const res = await GET(
        makeRequest({
          disposition: "inline",
          subtitleId: "subtitle-1",
          variantId: "variant-1",
        }),
      )

      expect(res.status).toBe(status)
      await expect(res.json()).resolves.toEqual({ error: message })
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it("rejects resolved subtitle URLs with query strings", async () => {
    resolveWatchSubtitleTargetMock.mockResolvedValueOnce({
      ok: true,
      target:
        "https://api-media-core.jesusfilm.org/subtitles/example.vtt?redirect=1",
    })
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const res = await GET(
      makeRequest({
        disposition: "inline",
        subtitleId: "subtitle-1",
        variantId: "variant-1",
      }),
    )

    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("canonicalizes each resolved Core VTT path segment before fetching", async () => {
    resolveWatchSubtitleTargetMock.mockResolvedValueOnce({
      ok: true,
      target:
        "https://api-media-core.jesusfilm.org/subtitles/russian%20captions/example.vtt",
    })
    const fetchMock = vi.fn(
      async () =>
        new Response("WEBVTT\n\n", {
          headers: { "content-type": "text/vtt" },
        }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const res = await GET(
      makeRequest({
        disposition: "inline",
        subtitleId: "subtitle-1",
        variantId: "variant-1",
      }),
    )

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api-media-core.jesusfilm.org/subtitles/russian%20captions/example.vtt",
      expect.objectContaining({ redirect: "manual" }),
    )
  })

  it("keeps the timeout active until the subtitle body finishes", async () => {
    vi.useFakeTimers()
    const abortSpy = vi.fn()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        init?.signal?.addEventListener("abort", abortSpy)
        return new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener("abort", () => {
                controller.error(new DOMException("Aborted", "AbortError"))
              })
            },
          }),
          { headers: { "content-type": "text/vtt" } },
        )
      }),
    )

    try {
      const res = await GET(
        makeRequest({
          disposition: "inline",
          subtitleId: "subtitle-1",
          variantId: "variant-1",
        }),
      )
      const bodyResult = expect(res.text()).rejects.toThrow()

      await vi.advanceTimersByTimeAsync(30_000)

      expect(abortSpy).toHaveBeenCalledOnce()
      await bodyResult
    } finally {
      vi.useRealTimers()
    }
  })

  it("rejects redirected inline subtitle responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://evil.example/subtitles.vtt" },
          }),
      ),
    )

    const res = await GET(
      makeRequest({
        disposition: "inline",
        subtitleId: "subtitle-1",
        variantId: "variant-1",
      }),
    )

    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toEqual({
      error: "Upstream subtitle redirected; refusing to follow",
    })
  })

  it("rejects inline subtitle responses that are not VTT", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("video bytes", {
            status: 200,
            headers: { "content-type": "video/mp4" },
          }),
      ),
    )

    const res = await GET(
      makeRequest({
        disposition: "inline",
        subtitleId: "subtitle-1",
        variantId: "variant-1",
      }),
    )

    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toEqual({
      error: "Upstream subtitle response was not VTT",
    })
  })

  it("returns a controlled error when the upstream fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("down"))),
    )

    const res = await GET(
      makeRequest({
        disposition: "inline",
        subtitleId: "subtitle-1",
        variantId: "variant-1",
      }),
    )

    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toEqual({
      error: "Upstream subtitle fetch failed",
    })
  })

  it("returns 499 when the client aborts the upstream fetch", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"))
          })
        }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const controller = new AbortController()

    const response = GET(
      makeRequest(
        {
          disposition: "inline",
          subtitleId: "subtitle-1",
          variantId: "variant-1",
        },
        { signal: controller.signal },
      ),
    )
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    controller.abort()

    expect((await response).status).toBe(499)
  })

  it("preserves an upstream subtitle error status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("missing", { status: 404 })),
    )

    const res = await GET(
      makeRequest({
        disposition: "inline",
        subtitleId: "subtitle-1",
        variantId: "variant-1",
      }),
    )

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: "Upstream 404" })
  })

  it("rejects an upstream VTT response without a body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(null, {
            status: 200,
            headers: { "content-type": "text/vtt" },
          }),
      ),
    )

    const res = await GET(
      makeRequest({
        disposition: "inline",
        subtitleId: "subtitle-1",
        variantId: "variant-1",
      }),
    )

    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toEqual({
      error: "Upstream subtitle had no body",
    })
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
      "https://stream.mux.com/abc/1080p.mp4?download=1080p.mp4",
    )
    expect(res.headers.get("cache-control")).toContain("no-store")
    expect(await res.text()).toBe("")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("resolves and proxies opaque inline subtitle requests", async () => {
    resolveWatchSubtitleTargetMock.mockResolvedValueOnce({
      ok: true,
      target: "https://api-media-core.jesusfilm.org/subtitles/russian.vtt",
    })
    const fetchMock = vi.fn(
      async () =>
        new Response(null, {
          status: 200,
          headers: { "Content-Type": "text/vtt; charset=utf-8" },
        }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const res = await HEAD(
      makeRequest(
        {
          disposition: "inline",
          subtitleId: "subtitle-1",
          variantId: "variant-1",
        },
        { method: "HEAD" },
      ),
    )

    expect(resolveWatchSubtitleTargetMock).toHaveBeenCalledWith({
      subtitleId: "subtitle-1",
      variantId: "variant-1",
    })
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api-media-core.jesusfilm.org/subtitles/russian.vtt",
      expect.objectContaining({ method: "HEAD", redirect: "manual" }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("text/vtt; charset=utf-8")
    expect(res.headers.get("content-disposition")).toBe("inline")
    expect(await res.text()).toBe("")
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
