/**
 * @vitest-environment node
 *
 * Account-gate tests for the same-origin streaming download proxy.
 * These tests intentionally assert the auth gate runs before URL validation,
 * DNS pre-flight, or any upstream media fetch.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { queryMock, recordWatchEventWithAccessTokenMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  recordWatchEventWithAccessTokenMock: vi.fn(),
}))

vi.mock("node:dns", () => ({
  promises: {
    resolve4: vi.fn(async () => ["203.0.113.1"]),
    resolve6: vi.fn(async () => {
      throw new Error("ENODATA")
    }),
  },
}))

vi.mock("@/lib/admin-client", () => ({
  default: {
    query: queryMock,
  },
}))

vi.mock("@/lib/watch-event-actions", () => ({
  recordWatchEventWithAccessToken: recordWatchEventWithAccessTokenMock,
}))

import { promises as dns } from "node:dns"

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

function adminVideoDub() {
  return {
    videoDub: {
      documentId: "variant-1",
      videoId: "video-1",
      downloadable: true,
      language: { documentId: "language-1" },
      downloads: [
        {
          documentId: "download-1",
          url: "https://stream.mux.com/abc.mp4",
        },
      ],
      published: true,
      slug: "jesus/english",
    },
  }
}

async function importRoute() {
  vi.resetModules()
  vi.stubEnv("WEB_AUTH_BASE_URL", "http://localhost:3004")
  vi.stubEnv("WEB_BASE_URL", "http://localhost:3000")
  vi.stubEnv(
    "WEB_SESSION_SECRET",
    "test-session-secret-at-least-thirty-two-chars",
  )
  vi.stubEnv("LAUNCHDARKLY_SDK_KEY", "")
  return import("./route")
}

async function webSessionCookie() {
  const { WEB_AUTH_SESSION_COOKIE, createWebAuthSessionCookie } =
    await import("@/auth/web-session")
  const value = await createWebAuthSessionCookie({
    subject: "user_123",
    scopes: ["openid", "web:watch-events:write"],
    accessToken: "jfp_at_secret",
    expiresAt: Math.floor(Date.now() / 1000) + 60,
  })
  return `${WEB_AUTH_SESSION_COOKIE}=${value}`
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  queryMock.mockReset()
  recordWatchEventWithAccessTokenMock.mockReset()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("GET /watch/api/download - account gate", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
  })

  it("returns 401 before DNS or upstream fetch when the request has no auth cookie", async () => {
    const fetchMock = vi.fn(async () => new Response("should not happen"))
    vi.stubGlobal("fetch", fetchMock)

    const { GET } = await importRoute()
    const response = await GET(
      makeRequest({
        filename: "jesus-highest.mp4",
        url: "https://stream.mux.com/abc.mp4",
      }),
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: "Authentication required",
    })
    expect(dns.resolve4).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("streams allowlisted inline VTT subtitles without an auth cookie", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(
        "https://api-media-core.jesusfilm.org/subtitles/example.vtt",
      )
      return new Response("WEBVTT\n\n", {
        status: 200,
        headers: { "content-type": "Text/VTT; charset=utf-8" },
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    const { GET } = await importRoute()
    const response = await GET(
      makeRequest({
        disposition: "inline",
        url: "https://api-media-core.jesusfilm.org/subtitles/example.vtt",
      }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("content-disposition")).toContain("inline;")
    expect(response.headers.get("content-type")).toBe("Text/VTT; charset=utf-8")
    expect(await response.text()).toBe("WEBVTT\n\n")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("rejects a non-VTT response on the anonymous subtitle path", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("video-bytes", {
          status: 200,
          headers: { "content-type": "video/mp4" },
        }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const consoleErrorMock = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined)
    const { GET } = await importRoute()
    const response = await GET(
      makeRequest({
        disposition: "inline",
        url: "https://api-media-core.jesusfilm.org/subtitles/example.vtt",
      }),
    )

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      error: "Upstream subtitle response was not VTT",
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(consoleErrorMock).toHaveBeenCalledWith(
      "[api/download] rejected non-VTT anonymous response",
      expect.objectContaining({ contentType: "video/mp4" }),
    )
  })

  it.each([
    {
      name: "inline video",
      query: {
        disposition: "inline",
        url: "https://stream.mux.com/example.mp4",
      },
    },
    {
      name: "subtitle attachment",
      query: {
        disposition: "attachment",
        url: "https://api-media-core.jesusfilm.org/subtitles/example.vtt",
      },
    },
  ])(
    "keeps anonymous $name requests behind the account gate",
    async ({ query }) => {
      const fetchMock = vi.fn(async () => new Response("should not happen"))
      vi.stubGlobal("fetch", fetchMock)

      const { GET } = await importRoute()
      const response = await GET(makeRequest(query))

      expect(response.status).toBe(401)
      expect(dns.resolve4).not.toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it("resolves signed-in downloads by opaque IDs instead of requiring the browser to send a CDN URL", async () => {
    queryMock.mockResolvedValueOnce({
      data: adminVideoDub(),
    })
    recordWatchEventWithAccessTokenMock.mockResolvedValueOnce({
      ok: true,
      recorded: true,
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://stream.mux.com/abc.mp4")
      return new Response("video-bytes", {
        status: 200,
        headers: { "content-type": "video/mp4" },
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    const { GET } = await importRoute()
    const response = await GET(
      makeRequest(
        {
          downloadId: "download-1",
          filename: "jesus-highest.mp4",
          variantId: "variant-1",
          videoSlug: "jesus",
        },
        { headers: { cookie: await webSessionCookie() } },
      ),
    )

    expect(response.status).toBe(200)
    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: { variantId: "variant-1" },
      }),
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://stream.mux.com/abc.mp4",
    )
    await vi.waitFor(() =>
      expect(recordWatchEventWithAccessTokenMock).toHaveBeenCalledWith(
        "jfp_at_secret",
        {
          eventType: "download",
          videoId: "video-1",
          videoDubId: "variant-1",
          languageId: "language-1",
        },
      ),
    )
  })

  it("returns a shaped 503 when opaque ID lookup fails before GET can fetch the CDN", async () => {
    queryMock.mockRejectedValueOnce(new Error("admin unavailable"))
    const fetchMock = vi.fn(async () => new Response("should not happen"))
    vi.stubGlobal("fetch", fetchMock)

    const { GET } = await importRoute()
    const response = await GET(
      makeRequest(
        {
          downloadId: "download-1",
          filename: "jesus-highest.mp4",
          variantId: "variant-1",
          videoSlug: "jesus",
        },
        { headers: { cookie: await webSessionCookie() } },
      ),
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: "Download lookup unavailable",
    })
    expect(dns.resolve4).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("returns a shaped 404 when opaque IDs do not resolve to a downloadable target", async () => {
    queryMock.mockResolvedValueOnce({ data: { videoDub: null } })
    const fetchMock = vi.fn(async () => new Response("should not happen"))
    vi.stubGlobal("fetch", fetchMock)

    const { GET } = await importRoute()
    const response = await GET(
      makeRequest(
        {
          downloadId: "download-1",
          filename: "jesus-highest.mp4",
          variantId: "variant-1",
          videoSlug: "jesus",
        },
        { headers: { cookie: await webSessionCookie() } },
      ),
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: "Download unavailable",
    })
    expect(dns.resolve4).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("streams the proxy download when the gate is enabled and the Web session is valid", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => {
      return new Response("video-bytes", {
        status: 200,
        headers: { "content-type": "video/mp4" },
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    const { GET } = await importRoute()
    const response = await GET(
      makeRequest(
        {
          filename: "jesus-highest.mp4",
          url: "https://stream.mux.com/abc.mp4",
        },
        { headers: { cookie: await webSessionCookie() } },
      ),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("content-disposition")).toContain(
      'attachment; filename="jesus-highest.mp4"',
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://stream.mux.com/abc.mp4",
    )
    expect(recordWatchEventWithAccessTokenMock).not.toHaveBeenCalled()
  })

  it("keeps the legacy Better Auth session verifier as a rollout fallback", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/api/auth/get-session")) {
        return Response.json({ user: { id: "user_123" } })
      }
      return new Response("video-bytes", {
        status: 200,
        headers: { "content-type": "video/mp4" },
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    const { GET } = await importRoute()
    const response = await GET(
      makeRequest(
        {
          filename: "jesus-highest.mp4",
          url: "https://stream.mux.com/abc.mp4",
        },
        { headers: { cookie: "better-auth.session=abc" } },
      ),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("content-disposition")).toContain(
      'attachment; filename="jesus-highest.mp4"',
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/api/auth/get-session",
    )
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://stream.mux.com/abc.mp4",
    )
  })
})

describe("HEAD /watch/api/download - opaque download target", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
  })

  it("resolves file-size probes by opaque IDs instead of requiring a browser CDN URL", async () => {
    queryMock.mockResolvedValueOnce({
      data: adminVideoDub(),
    })
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => {
        return new Response(null, {
          status: 200,
          headers: {
            "content-length": "123456",
            "content-type": "video/mp4",
          },
        })
      },
    )
    vi.stubGlobal("fetch", fetchMock)

    const { HEAD } = await importRoute()
    const response = await HEAD(
      makeRequest({
        downloadId: "download-1",
        variantId: "variant-1",
        videoSlug: "jesus",
      }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("content-length")).toBe("123456")
    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: { variantId: "variant-1" },
      }),
    )
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://stream.mux.com/abc.mp4",
    )
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ method: "HEAD" }),
    )
  })

  it("returns a shaped 503 when opaque ID lookup fails before HEAD can fetch the CDN", async () => {
    queryMock.mockRejectedValueOnce(new Error("admin unavailable"))
    const fetchMock = vi.fn(async () => new Response(null))
    vi.stubGlobal("fetch", fetchMock)

    const { HEAD } = await importRoute()
    const response = await HEAD(
      makeRequest({
        downloadId: "download-1",
        variantId: "variant-1",
        videoSlug: "jesus",
      }),
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: "Download lookup unavailable",
    })
    expect(dns.resolve4).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
