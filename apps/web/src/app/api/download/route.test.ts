/**
 * @vitest-environment node
 *
 * Route handler tests for the same-origin streaming download proxy.
 * Covers the security gates (allowlist, redirect rejection, status codes),
 * the header forwarding contract (Range / Content-Range / conditional
 * requests), and the response shape (Content-Disposition + JSON errors).
 *
 * The handler is invoked directly with `new Request(...)`; `global.fetch`
 * is mocked per test to control upstream behaviour. No HTTP listener.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { isWatchDownloadAccountGateEnabledMock } = vi.hoisted(() => ({
  isWatchDownloadAccountGateEnabledMock: vi.fn(async () => true),
}))

// Stub DNS so the route's pre-flight check is deterministic. Default
// behaviour: every hostname resolves to a single public IPv4
// (203.0.113.1, TEST-NET-3 from RFC 5737). Tests override per-case to
// exercise the private-IP rejection path.
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
  for (const [k, v] of Object.entries(query)) {
    url.searchParams.set(k, v)
  }
  return new Request(url, init)
}

function mockUpstream(response: Response): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response),
  )
}

afterEach(() => {
  isWatchDownloadAccountGateEnabledMock.mockResolvedValue(true)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("GET /watch/api/download — DNS pre-flight (SSRF defense)", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
  })

  it("rejects with 403 when the hostname resolves to a loopback IP (subdomain takeover → 127.0.0.1)", async () => {
    vi.mocked(dns.resolve4).mockResolvedValueOnce(["127.0.0.1"])
    const res = await GET(
      makeRequest({
        url: "https://stream.mux.com/abc.mp4",
        filename: "x.mp4",
      }),
    )
    expect(res.status).toBe(403)
  })

  it("rejects when the hostname resolves to RFC 1918 private space (10.0.0.0/8)", async () => {
    vi.mocked(dns.resolve4).mockResolvedValueOnce(["10.0.0.5"])
    const res = await GET(
      makeRequest({
        url: "https://stream.mux.com/abc.mp4",
        filename: "x.mp4",
      }),
    )
    expect(res.status).toBe(403)
  })

  it("rejects when the hostname resolves to link-local space (169.254.169.254 = AWS metadata)", async () => {
    vi.mocked(dns.resolve4).mockResolvedValueOnce(["169.254.169.254"])
    const res = await GET(
      makeRequest({
        url: "https://stream.mux.com/abc.mp4",
        filename: "x.mp4",
      }),
    )
    expect(res.status).toBe(403)
  })

  it("rejects 172.16.0.0/12 specifically (boundary check)", async () => {
    vi.mocked(dns.resolve4).mockResolvedValueOnce(["172.20.0.1"])
    const res = await GET(
      makeRequest({
        url: "https://stream.mux.com/abc.mp4",
        filename: "x.mp4",
      }),
    )
    expect(res.status).toBe(403)
  })

  it("allows 172.15.x and 172.32.x (just outside the private 172.16-31 range)", async () => {
    vi.mocked(dns.resolve4).mockResolvedValueOnce(["172.15.0.1"])
    mockUpstream(new Response("ok", { status: 200 }))
    const res = await GET(
      makeRequest({
        url: "https://stream.mux.com/abc.mp4",
        filename: "x.mp4",
      }),
    )
    expect(res.status).toBe(200)
  })

  it("rejects when ANY of multiple resolved IPs is private (defense against attacker mixing public+private answers)", async () => {
    vi.mocked(dns.resolve4).mockResolvedValueOnce(["203.0.113.1", "10.0.0.5"])
    const res = await GET(
      makeRequest({
        url: "https://stream.mux.com/abc.mp4",
        filename: "x.mp4",
      }),
    )
    expect(res.status).toBe(403)
  })

  it("rejects IPv6 loopback (::1)", async () => {
    vi.mocked(dns.resolve4).mockRejectedValueOnce(new Error("ENODATA"))
    vi.mocked(dns.resolve6).mockResolvedValueOnce(["::1"])
    const res = await GET(
      makeRequest({
        url: "https://stream.mux.com/abc.mp4",
        filename: "x.mp4",
      }),
    )
    expect(res.status).toBe(403)
  })

  it("rejects IPv4-mapped-IPv6 form of a private IPv4 (::ffff:127.0.0.1)", async () => {
    vi.mocked(dns.resolve4).mockRejectedValueOnce(new Error("ENODATA"))
    vi.mocked(dns.resolve6).mockResolvedValueOnce(["::ffff:127.0.0.1"])
    const res = await GET(
      makeRequest({
        url: "https://stream.mux.com/abc.mp4",
        filename: "x.mp4",
      }),
    )
    expect(res.status).toBe(403)
  })
})

describe("GET /watch/api/download — input validation", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
  })

  it("returns 400 (not 403) when the `url` query param is missing", async () => {
    const res = await GET(makeRequest({}))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/url/i)
  })

  it("returns 403 with JSON body when the URL is not allowlisted", async () => {
    const res = await GET(makeRequest({ url: "https://evil.com/payload.mp4" }))
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe("Forbidden")
  })

  it("rejects http: downgrades from allowlisted hostnames", async () => {
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
})

describe("GET /watch/api/download — upstream success path", () => {
  it("streams the upstream body with attachment Content-Disposition", async () => {
    mockUpstream(
      new Response("video-bytes", {
        status: 200,
        headers: {
          "content-type": "video/mp4",
          "content-length": "11",
        },
      }),
    )
    const res = await GET(
      makeRequest({
        url: "https://stream.mux.com/abc.mp4",
        filename: "Jesus-Film_English_eng_360p.mp4",
      }),
    )
    expect(res.status).toBe(200)
    const cd = res.headers.get("content-disposition") ?? ""
    expect(cd).toContain(
      'attachment; filename="Jesus-Film_English_eng_360p.mp4"',
    )
    expect(cd).toContain("filename*=UTF-8''Jesus-Film_English_eng_360p.mp4")
    expect(res.headers.get("content-type")).toBe("video/mp4")
    expect(res.headers.get("content-length")).toBe("11")
    expect(res.headers.get("cache-control")).toContain("no-store")
    expect(res.headers.get("x-content-type-options")).toBe("nosniff")
    expect(await res.text()).toBe("video-bytes")
  })

  it("can stream media inline for in-page consumers", async () => {
    mockUpstream(
      new Response("WEBVTT\n\n", {
        status: 200,
        headers: {
          "content-type": "text/vtt",
          "content-length": "8",
        },
      }),
    )
    const res = await GET(
      makeRequest({
        url: "https://api-media-core.jesusfilm.org/subtitles/example.vtt",
        disposition: "inline",
      }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("content-disposition")).toContain(
      'inline; filename="download"',
    )
    expect(res.headers.get("content-type")).toBe("text/vtt")
    expect(await res.text()).toBe("WEBVTT\n\n")
  })

  it("defaults unknown dispositions to attachment", async () => {
    mockUpstream(new Response("video-bytes", { status: 200 }))
    const res = await GET(
      makeRequest({
        url: "https://stream.mux.com/abc.mp4",
        disposition: "inline; filename=x",
      }),
    )
    expect(res.headers.get("content-disposition")).toContain("attachment;")
  })

  it("preserves 206 Partial Content and forwards Content-Range", async () => {
    mockUpstream(
      new Response("partial-bytes", {
        status: 206,
        headers: {
          "content-type": "video/mp4",
          "content-length": "13",
          "content-range": "bytes 0-12/100",
          "accept-ranges": "bytes",
        },
      }),
    )
    const res = await GET(
      makeRequest(
        { url: "https://stream.mux.com/abc.mp4", filename: "x.mp4" },
        { headers: { Range: "bytes=0-12" } },
      ),
    )
    expect(res.status).toBe(206)
    // Content-Range must round-trip to the client — without it, the
    // browser's download manager cannot validate the byte slice.
    expect(res.headers.get("content-range")).toBe("bytes 0-12/100")
    expect(res.headers.get("accept-ranges")).toBe("bytes")
  })

  it("forwards conditional request headers (Range + If-Range + If-None-Match)", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response("ok", { status: 200, headers: {} })),
    )
    vi.stubGlobal("fetch", fetchMock)

    await GET(
      makeRequest(
        { url: "https://stream.mux.com/abc.mp4", filename: "x.mp4" },
        {
          headers: {
            Range: "bytes=100-",
            "If-Range": '"abc"',
            "If-None-Match": '"abc"',
          },
        },
      ),
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const upstreamInit = fetchMock.mock.calls[0]?.[1]
    expect(upstreamInit).toBeDefined()
    const headers = upstreamInit?.headers as Record<string, string>
    expect(headers["range"]).toBe("bytes=100-")
    expect(headers["if-range"]).toBe('"abc"')
    expect(headers["if-none-match"]).toBe('"abc"')
  })
})

describe("GET /watch/api/download — upstream failure paths", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
  })

  it("returns 502 with JSON body when the upstream fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED")
      }),
    )
    const res = await GET(
      makeRequest({
        url: "https://stream.mux.com/abc.mp4",
        filename: "x.mp4",
      }),
    )
    expect(res.status).toBe(502)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe("Upstream fetch failed")
  })

  it("passes through upstream non-OK status codes (e.g. 404)", async () => {
    mockUpstream(new Response("Not Found", { status: 404 }))
    const res = await GET(
      makeRequest({
        url: "https://stream.mux.com/missing.mp4",
        filename: "x.mp4",
      }),
    )
    expect(res.status).toBe(404)
  })

  it("rejects upstream redirects (3xx) with 502 — the allowlist validates the initial URL only, so following would silently bypass it", async () => {
    mockUpstream(
      new Response(null, {
        status: 302,
        headers: { location: "https://attacker.com/payload.mp4" },
      }),
    )
    const res = await GET(
      makeRequest({
        url: "https://stream.mux.com/redirect.mp4",
        filename: "x.mp4",
      }),
    )
    expect(res.status).toBe(502)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/redirect/i)
  })
})

describe("GET /watch/api/download — filename sanitization", () => {
  it("strips control characters and double-quotes from the filename", async () => {
    mockUpstream(new Response("ok", { status: 200 }))
    const res = await GET(
      makeRequest({
        url: "https://stream.mux.com/abc.mp4",
        // CR/LF + double-quote attempting header injection.
        filename: 'evil"\r\nSet-Cookie: foo=bar.mp4',
      }),
    )
    const cd = res.headers.get("content-disposition") ?? ""
    // CR/LF are the actual smuggling vector — everything else is just
    // text inside the quoted filename. Verify no line breaks make it
    // through and no smuggled Set-Cookie header lands on the response.
    expect(cd).not.toContain("\r")
    expect(cd).not.toContain("\n")
    // The double-quote in the filename must be stripped so the filename
    // can't break out of the quoted-string token.
    expect(cd).not.toMatch(/filename="[^"]*"[^;]*"/)
    expect(res.headers.has("set-cookie")).toBe(false)
  })

  it("strips RTL-override and other bidi-control codepoints used in extension-spoof attacks", async () => {
    mockUpstream(new Response("ok", { status: 200 }))
    const res = await GET(
      makeRequest({
        url: "https://stream.mux.com/abc.mp4",
        filename: "invoice‮gnp.exe",
      }),
    )
    const cd = res.headers.get("content-disposition") ?? ""
    expect(cd).not.toContain("‮")
  })

  it("forces the extension to a known media format when the supplied one is unsafe (e.g. .exe)", async () => {
    mockUpstream(new Response("ok", { status: 200 }))
    const res = await GET(
      makeRequest({
        url: "https://stream.mux.com/abc.mp4",
        filename: "Adobe-Update.exe",
      }),
    )
    const cd = res.headers.get("content-disposition") ?? ""
    expect(cd).toMatch(/filename="Adobe-Update\.mp4"/)
  })

  it("preserves an allowed extension when clamping long filenames", async () => {
    mockUpstream(new Response("ok", { status: 200 }))
    const res = await GET(
      makeRequest({
        url: "https://stream.mux.com/abc.mp4",
        filename: `${"Jesus-Film-".repeat(30)}_English_eng_360p.mp4`,
      }),
    )
    const cd = res.headers.get("content-disposition") ?? ""
    const match = cd.match(/filename="([^"]+)"/)
    const filename = match?.[1] ?? ""
    expect(filename).toMatch(/\.mp4$/)
    expect(filename.length).toBeLessThanOrEqual(200)
  })

  it("falls back to a `download` literal when the sanitized filename collapses to empty", async () => {
    mockUpstream(new Response("ok", { status: 200 }))
    const res = await GET(
      makeRequest({
        url: "https://stream.mux.com/abc.mp4",
        // All chars are stripped → empty after sanitize.
        filename: '\\\\////""""',
      }),
    )
    const cd = res.headers.get("content-disposition") ?? ""
    expect(cd).toContain('filename="download"')
  })
})

describe("HEAD /watch/api/download — size probe", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
  })

  it("returns 200 with Content-Length forwarded from upstream HEAD", async () => {
    mockUpstream(
      new Response(null, {
        status: 200,
        headers: {
          "content-type": "video/mp4",
          "content-length": "296924373",
        },
      }),
    )
    const res = await HEAD(
      makeRequest({ url: "https://stream.mux.com/abc/1080p.mp4" }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("content-length")).toBe("296924373")
    expect(res.headers.get("content-type")).toBe("video/mp4")
    // Body must be empty on HEAD.
    expect(await res.text()).toBe("")
  })

  it("rejects with 403 when the URL is not allowlisted (same allowlist as GET)", async () => {
    const res = await HEAD(makeRequest({ url: "https://evil.com/payload.mp4" }))
    expect(res.status).toBe(403)
  })

  it("rejects with 403 when DNS resolves to private space (shared SSRF defense)", async () => {
    vi.mocked(dns.resolve4).mockResolvedValueOnce(["10.0.0.5"])
    const res = await HEAD(
      makeRequest({ url: "https://stream.mux.com/abc.mp4" }),
    )
    expect(res.status).toBe(403)
  })

  it("rejects upstream redirects with 502 (no allowlist-bypass via 3xx)", async () => {
    mockUpstream(
      new Response(null, {
        status: 302,
        headers: { location: "https://attacker.com/payload.mp4" },
      }),
    )
    const res = await HEAD(
      makeRequest({ url: "https://stream.mux.com/redirect.mp4" }),
    )
    expect(res.status).toBe(502)
  })

  it("does NOT forward Set-Cookie or other non-allowlisted upstream headers", async () => {
    mockUpstream(
      new Response(null, {
        status: 200,
        headers: {
          "content-length": "100",
          "set-cookie": "tracker=abc; HttpOnly",
          "x-attacker-frame": "yes",
        },
      }),
    )
    const res = await HEAD(
      makeRequest({ url: "https://stream.mux.com/abc.mp4" }),
    )
    expect(res.headers.has("set-cookie")).toBe(false)
    expect(res.headers.has("x-attacker-frame")).toBe(false)
    expect(res.headers.get("content-length")).toBe("100")
  })

  it("returns 502 when upstream fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED")
      }),
    )
    const res = await HEAD(
      makeRequest({ url: "https://stream.mux.com/abc.mp4" }),
    )
    expect(res.status).toBe(502)
  })

  it("passes through upstream non-OK status codes (e.g. 404)", async () => {
    // Mirrors the GET-side coverage of the !upstream.ok passthrough so a
    // regression that turned 404 into a generic 502 (or 200) would fail.
    mockUpstream(new Response(null, { status: 404 }))
    const res = await HEAD(
      makeRequest({ url: "https://stream.mux.com/missing.mp4" }),
    )
    expect(res.status).toBe(404)
  })

  it("preserves 206 Partial Content from upstream (parity with GET)", async () => {
    // Some CDNs respond to bare HEADs with 206. Treating that as 502 would
    // make legitimate sizes invisible to the download modal; GET allows
    // 206 and HEAD must mirror.
    mockUpstream(
      new Response(null, {
        status: 206,
        headers: { "content-length": "100", "content-type": "video/mp4" },
      }),
    )
    const res = await HEAD(
      makeRequest({ url: "https://stream.mux.com/abc.mp4" }),
    )
    expect(res.status).toBe(206)
    expect(res.headers.get("content-length")).toBe("100")
  })
})

describe("GET /watch/api/download — response header allowlist", () => {
  it("does NOT forward upstream headers outside the allowlist (e.g. Set-Cookie)", async () => {
    mockUpstream(
      new Response("bytes", {
        status: 200,
        headers: {
          "content-type": "video/mp4",
          "set-cookie": "tracker=abc; HttpOnly",
          "x-attacker-frame": "yes",
        },
      }),
    )
    const res = await GET(
      makeRequest({
        url: "https://stream.mux.com/abc.mp4",
        filename: "x.mp4",
      }),
    )
    expect(res.headers.has("set-cookie")).toBe(false)
    expect(res.headers.has("x-attacker-frame")).toBe(false)
    expect(res.headers.get("content-type")).toBe("video/mp4")
  })
})
