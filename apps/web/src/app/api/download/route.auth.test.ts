/**
 * @vitest-environment node
 *
 * Account-gate tests for the same-origin download resolver.
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
      videoEdition: {
        subtitles: [
          {
            documentId: "subtitle-1",
            vttSrc:
              "https://api-media-core.jesusfilm.org/subtitles/example.vtt",
            video: { documentId: "video-1" },
          },
        ],
      },
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
  vi.stubEnv("FORGE_WATCH_DOWNLOAD_ACCOUNT_GATE_DEFAULT", "true")
  return import("./route")
}

async function importRouteWithAccountGateDisabled() {
  vi.resetModules()
  vi.stubEnv("WEB_AUTH_BASE_URL", "http://localhost:3004")
  vi.stubEnv("WEB_BASE_URL", "http://localhost:3000")
  vi.stubEnv(
    "WEB_SESSION_SECRET",
    "test-session-secret-at-least-thirty-two-chars",
  )
  vi.stubEnv("LAUNCHDARKLY_SDK_KEY", "")
  vi.stubEnv("FORGE_WATCH_DOWNLOAD_ACCOUNT_GATE_DEFAULT", "false")
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
    expect(response.headers.get("x-watch-download-error")).toBe("auth-required")
    await expect(response.json()).resolves.toEqual({
      error: "Authentication required",
    })
    expect(dns.resolve4).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  }, 15_000)

  it("redirects anonymous opaque-ID downloads when the account gate is disabled", async () => {
    queryMock.mockResolvedValueOnce({ data: adminVideoDub() })
    const fetchMock = vi.fn(async () => new Response("should not happen"))
    vi.stubGlobal("fetch", fetchMock)

    const { GET } = await importRouteWithAccountGateDisabled()
    const response = await GET(
      makeRequest({
        downloadId: "download-1",
        filename: "jesus-highest.mp4",
        variantId: "variant-1",
        videoSlug: "jesus",
      }),
    )

    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toBe(
      "https://stream.mux.com/abc.mp4?download=jesus-highest.mp4",
    )
    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({ variables: { variantId: "variant-1" } }),
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(recordWatchEventWithAccessTokenMock).not.toHaveBeenCalled()
  }, 15_000)

  it("rejects anonymous raw-URL attachment downloads when the account gate is disabled", async () => {
    const fetchMock = vi.fn(async () => new Response("should not happen"))
    vi.stubGlobal("fetch", fetchMock)

    const { GET } = await importRouteWithAccountGateDisabled()
    const response = await GET(
      makeRequest({
        filename: "jesus-highest.mp4",
        url: "https://stream.mux.com/abc.mp4",
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "Download identifiers required",
    })
    expect(dns.resolve4).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("serves allowlisted inline VTT subtitles without an auth cookie", async () => {
    queryMock.mockResolvedValueOnce({ data: adminVideoDub() })
    const fetchMock = vi.fn(
      async () => new Response("WEBVTT\n\n00:00.000 --> 00:01.000\nHello"),
    )
    vi.stubGlobal("fetch", fetchMock)

    const { GET } = await importRoute()
    const response = await GET(
      makeRequest({
        disposition: "inline",
        subtitleId: "subtitle-1",
        variantId: "variant-1",
      }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("location")).toBeNull()
    expect(response.headers.get("content-type")).toContain("text/vtt")
    expect(await response.text()).toContain("WEBVTT")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("keeps anonymous non-VTT inline requests behind the account gate", async () => {
    const fetchMock = vi.fn(async () => new Response("should not happen"))
    vi.stubGlobal("fetch", fetchMock)

    const { GET } = await importRoute()
    const response = await GET(
      makeRequest({
        disposition: "inline",
        url: "https://stream.mux.com/example.mp4",
      }),
    )

    expect(response.status).toBe(401)
    expect(dns.resolve4).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("resolves signed-in opaque-ID downloads and records a best-effort event before redirecting", async () => {
    queryMock.mockResolvedValueOnce({ data: adminVideoDub() })
    recordWatchEventWithAccessTokenMock.mockResolvedValueOnce({
      ok: true,
      recorded: true,
    })
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

    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toBe(
      "https://stream.mux.com/abc.mp4?download=jesus-highest.mp4",
    )
    expect(fetchMock).not.toHaveBeenCalled()
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

  it("returns a shaped 503 when opaque ID lookup fails before redirecting", async () => {
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

  it("redirects signed-in legacy raw-URL downloads when the gate is enabled", async () => {
    const fetchMock = vi.fn(async () => new Response("should not happen"))
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

    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toBe(
      "https://stream.mux.com/abc.mp4?download=jesus-highest.mp4",
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(recordWatchEventWithAccessTokenMock).not.toHaveBeenCalled()
  })
})

describe("HEAD /watch/api/download - opaque download target", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
  })

  it("resolves opaque IDs and redirects without fetching upstream", async () => {
    queryMock.mockResolvedValueOnce({ data: adminVideoDub() })
    const fetchMock = vi.fn(async () => new Response("should not happen"))
    vi.stubGlobal("fetch", fetchMock)

    const { HEAD } = await importRoute()
    const response = await HEAD(
      makeRequest({
        downloadId: "download-1",
        variantId: "variant-1",
        videoSlug: "jesus",
      }),
    )

    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toBe(
      "https://stream.mux.com/abc.mp4?download=abc.mp4",
    )
    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({ variables: { variantId: "variant-1" } }),
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("returns a shaped 503 when opaque ID lookup fails before HEAD can redirect", async () => {
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
