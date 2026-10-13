/**
 * @vitest-environment node
 */

import { afterEach, describe, expect, it, vi } from "vitest"

function makeRequest(
  callbackURL: string,
  routeURL = "https://example.test/watch/api/auth/session",
): Request {
  const url = new URL(routeURL)
  url.searchParams.set("callbackURL", callbackURL)
  return new Request(url)
}

async function importRoute(canonicalOrigin = "https://www.jesusfilm.org") {
  vi.resetModules()
  vi.stubEnv("WEB_AUTH_BASE_URL", "http://localhost:3004")
  vi.stubEnv("WEB_BASE_URL", "http://localhost:3000")
  vi.stubEnv("NEXT_PUBLIC_CANONICAL_ORIGIN", canonicalOrigin)
  vi.stubEnv(
    "WEB_SESSION_SECRET",
    "test-session-secret-at-least-thirty-two-chars",
  )
  vi.stubEnv("LAUNCHDARKLY_SDK_KEY", "")
  return import("./route")
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("GET /watch/api/auth/session", () => {
  it("accepts the relative Watch homepage as a signed-out callback", async () => {
    const { GET } = await importRoute()
    const response = await GET(makeRequest("/watch"))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      accountGateEnabled: false,
      authenticated: false,
      loginUrl:
        "https://www.jesusfilm.org/watch/api/auth/login?returnTo=https%3A%2F%2Fwww.jesusfilm.org%2Fwatch",
    })
  })

  it("returns a sanitized auth login URL for signed-out watch-page callbacks", async () => {
    const { GET } = await importRoute()
    const response = await GET(
      makeRequest("http://localhost:3000/watch/jesus/english"),
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      accountGateEnabled: boolean
      authenticated: boolean
      loginUrl: string
    }
    expect(body.accountGateEnabled).toBe(false)
    expect(body.authenticated).toBe(false)
    expect(body.loginUrl).toBe(
      "https://www.jesusfilm.org/watch/api/auth/login?returnTo=http%3A%2F%2Flocalhost%3A3000%2Fwatch%2Fjesus%2Fenglish",
    )
    expect(body.loginUrl).not.toContain("stream.mux.com")
  })

  it("allows the current request origin as a watch callback origin for preview deployments", async () => {
    const { GET } = await importRoute("https://preview.example.up.railway.app")
    const response = await GET(
      makeRequest(
        "https://preview.example.up.railway.app/watch/jesus/english",
        "https://preview.example.up.railway.app/watch/api/auth/session",
      ),
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      accountGateEnabled: boolean
      loginUrl: string
    }
    expect(body.accountGateEnabled).toBe(false)
    expect(body.loginUrl).toBe(
      "https://preview.example.up.railway.app/watch/api/auth/login?returnTo=https%3A%2F%2Fpreview.example.up.railway.app%2Fwatch%2Fjesus%2Fenglish",
    )
  })

  it("ignores an unapproved forwarded host and uses the canonical origin", async () => {
    const { GET } = await importRoute("https://www.jesusfilm.org")
    const request = makeRequest("/watch")
    request.headers.set("x-forwarded-host", "railway-alias.jesusfilm.org")
    request.headers.set("x-forwarded-proto", "https")

    const response = await GET(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      loginUrl:
        "https://www.jesusfilm.org/watch/api/auth/login?returnTo=https%3A%2F%2Fwww.jesusfilm.org%2Fwatch",
    })
  })

  it("accepts an explicitly configured forwarded host", async () => {
    const { GET } = await importRoute("https://watch.railway.app")
    const request = makeRequest("/watch")
    request.headers.set("x-forwarded-host", "watch.railway.app")
    request.headers.set("x-forwarded-proto", "https")

    const response = await GET(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      loginUrl:
        "https://watch.railway.app/watch/api/auth/login?returnTo=https%3A%2F%2Fwatch.railway.app%2Fwatch",
    })
  })

  it("accepts the new Web-local Auth session as signed in", async () => {
    const { GET } = await importRoute()
    const { WEB_AUTH_SESSION_COOKIE, createWebAuthSessionCookie } =
      await import("@/auth/web-session")
    const cookie = await createWebAuthSessionCookie({
      subject: "user_123",
      email: "viewer@example.test",
      name: "Viewer Example",
      image: "https://example.test/avatar.jpg",
      scopes: ["openid", "web:watch-events:write"],
      accessToken: "jfp_at_secret",
      expiresAt: Math.floor(Date.now() / 1000) + 60,
    })
    const response = await GET(
      new Request(
        "https://example.test/watch/api/auth/session?callbackURL=http%3A%2F%2Flocalhost%3A3000%2Fwatch%2Fjesus%2Fenglish",
        {
          headers: {
            cookie: `${WEB_AUTH_SESSION_COOKIE}=${cookie}`,
          },
        },
      ),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      accountGateEnabled: false,
      authenticated: true,
      user: {
        id: "user_123",
        email: "viewer@example.test",
        name: "Viewer Example",
        image: "https://example.test/avatar.jpg",
      },
    })
  })

  it("reports Web-local sessions without building a login URL", async () => {
    const { GET } = await importRoute()
    const { WEB_AUTH_SESSION_COOKIE, createWebAuthSessionCookie } =
      await import("@/auth/web-session")
    const cookie = await createWebAuthSessionCookie({
      subject: "user_123",
      email: "viewer@example.test",
      name: "Viewer Example",
      scopes: ["openid", "web:watch-events:write"],
      accessToken: "jfp_at_secret",
      expiresAt: Math.floor(Date.now() / 1000) + 60,
    })
    const response = await GET(
      new Request("https://example.test/watch/api/auth/session", {
        headers: {
          cookie: `${WEB_AUTH_SESSION_COOKIE}=${cookie}`,
        },
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      accountGateEnabled: false,
      authenticated: true,
      user: {
        id: "user_123",
        email: "viewer@example.test",
        name: "Viewer Example",
      },
    })
  })

  it("rejects callbacks that point at the download API", async () => {
    const { GET } = await importRoute()
    const response = await GET(
      makeRequest(
        "http://localhost:3000/watch/api/download?url=https%3A%2F%2Fstream.mux.com%2Fabc.mp4",
      ),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "Invalid auth destination",
    })
  })

  it("reports when the download account gate is enabled", async () => {
    vi.stubEnv("FORGE_WATCH_DOWNLOAD_ACCOUNT_GATE_DEFAULT", "true")

    const { GET } = await importRoute()
    const response = await GET(
      makeRequest("http://localhost:3000/watch/jesus/english"),
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      accountGateEnabled: boolean
      authenticated: boolean
    }
    expect(body.accountGateEnabled).toBe(true)
    expect(body.authenticated).toBe(false)
  })
})
