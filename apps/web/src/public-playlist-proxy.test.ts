import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { proxy, type ProxyRequest } from "./proxy"
import {
  openPublicUserPlaylistCapability,
  PUBLIC_USER_PLAYLIST_CAPABILITY_HEADER,
  setPublicUserPlaylistPreflightForTest,
} from "./lib/user-playlist-public-boundary"

const CAPABILITY = "a".repeat(43)
const SECRET = "s".repeat(32)

function request(pathname: string, headers?: HeadersInit): ProxyRequest {
  const url = new URL(pathname, "https://www.jesusfilm.org")
  return {
    nextUrl: Object.assign(url, { clone: () => new URL(url) }),
    headers: new Headers(headers),
  }
}

function expectPrivateCapabilityHeaders(response: Response): void {
  expect(response.headers.get("cache-control")).toContain("no-store")
  expect(response.headers.get("x-robots-tag")).toBe(
    "noindex, nofollow, noarchive",
  )
  expect(response.headers.get("referrer-policy")).toBe("no-referrer")
  expect(response.headers.get("content-security-policy")).toContain(
    "frame-ancestors 'none'",
  )
  expect(response.headers.get("x-content-type-options")).toBe("nosniff")
}

afterEach(() => {
  setPublicUserPlaylistPreflightForTest()
  vi.unstubAllEnvs()
})

beforeEach(() => {
  vi.stubEnv("USER_PLAYLIST_TRUSTED_CONTEXT_HMAC_SECRET", SECRET)
})

describe("proxy — public unlisted user playlists", () => {
  it("passes a valid strict capability without locale canonicalization", async () => {
    const preflight = vi.fn().mockResolvedValue("available")
    setPublicUserPlaylistPreflightForTest(preflight)

    const response = await proxy(request(`/p/${CAPABILITY}`))

    expect(response.status).toBe(200)
    const rewrite = response.headers.get("x-middleware-rewrite")
    expect(new URL(rewrite!).pathname).toBe("/p/_render")
    expect(rewrite).not.toContain(CAPABILITY)
    expect(
      response.headers.get(PUBLIC_USER_PLAYLIST_CAPABILITY_HEADER),
    ).toBeNull()
    const envelope = response.headers.get(
      `x-middleware-request-${PUBLIC_USER_PLAYLIST_CAPABILITY_HEADER}`,
    )
    expect(envelope).not.toContain(CAPABILITY)
    expect(
      openPublicUserPlaylistCapability(envelope, {
        secret: SECRET,
        now: new Date(),
      }),
    ).toBe(CAPABILITY)
    expect(preflight).toHaveBeenCalledWith(
      expect.objectContaining({ capability: CAPABILITY }),
    )
    expectPrivateCapabilityHeaders(response)
  })

  it("returns the same real, token-free 404 for unavailable and malformed links", async () => {
    setPublicUserPlaylistPreflightForTest(
      vi.fn().mockResolvedValue("unavailable"),
    )
    const unavailable = await proxy(request(`/p/${CAPABILITY}`))
    const malformed = await proxy(request("/p/not-a-capability"))

    expect(unavailable.status).toBe(404)
    expect(malformed.status).toBe(404)
    expect(await unavailable.text()).toBe(await malformed.text())
    expect((await proxy(request(`/p/${CAPABILITY}`))).status).toBe(404)
    expectPrivateCapabilityHeaders(unavailable)
    expectPrivateCapabilityHeaders(malformed)
    expect(
      await (await proxy(request(`/p/${CAPABILITY}`))).text(),
    ).not.toContain(CAPABILITY)
  })

  it("returns a distinct localized actual 503 with retry and the same privacy controls", async () => {
    setPublicUserPlaylistPreflightForTest(
      vi.fn().mockResolvedValue("service-unavailable"),
    )
    const response = await proxy(
      request(`/p/${CAPABILITY}`, { "accept-language": "es-MX,es;q=0.9" }),
    )

    expect(response.status).toBe(503)
    expect(response.headers.get("content-language")).toBe("es")
    const html = await response.text()
    expect(html).toContain("Inténtalo de nuevo")
    expect(html).toContain('<h1 tabindex="-1" autofocus>')
    expect(html).not.toMatch(/<a[^>]+autofocus/)
    expect(html).not.toContain(CAPABILITY)
    expectPrivateCapabilityHeaders(response)
  })

  it("does not classify playlist-like paths as ordinary Watch content", async () => {
    for (const pathname of [
      "/p",
      "/p/_render",
      `/p/${CAPABILITY}/extra`,
      "/P/token",
    ]) {
      const response = await proxy(request(pathname))
      expect(response.status).toBe(404)
    }
  })
})
