/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  accountGateEnabled: vi.fn<() => Promise<boolean>>(),
  globalBetaTesterCtaEnabled: vi.fn<() => Promise<boolean>>(),
  fetchWatchProgressForUser:
    vi.fn<(userId: string, signal?: AbortSignal) => Promise<unknown[]>>(),
}))

vi.mock("@/lib/feature-flags", () => ({
  isWatchDownloadAccountGateEnabled: mocks.accountGateEnabled,
  isWatchGlobalBetaTesterCtaEnabled: mocks.globalBetaTesterCtaEnabled,
  watchDownloadAccountGateFlagContext: {
    custom: { surface: "watch-download" },
  },
}))

vi.mock("@/lib/watch-progress-server", () => ({
  fetchWatchProgressForUser: mocks.fetchWatchProgressForUser,
}))

const ROUTE_URL = "https://example.test/watch/api/bootstrap"

async function importRoute() {
  vi.resetModules()
  vi.stubEnv("WEB_AUTH_BASE_URL", "http://localhost:3004")
  vi.stubEnv("WEB_BASE_URL", "http://localhost:3000")
  vi.stubEnv(
    "WEB_SESSION_SECRET",
    "test-session-secret-at-least-thirty-two-chars",
  )
  return import("./route")
}

function anonymousRequest(callbackURL: string | null = "/watch/jesus/english") {
  const url = new URL(ROUTE_URL)
  if (callbackURL != null) url.searchParams.set("callbackURL", callbackURL)
  return new Request(url)
}

async function signedInRequest() {
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
  return new Request(`${ROUTE_URL}?callbackURL=%2Fwatch`, {
    headers: { cookie: `${WEB_AUTH_SESSION_COOKIE}=${cookie}` },
  })
}

const progressEntry = {
  videoId: "video-1",
  languageSlug: "english",
  positionSeconds: 42,
  durationSeconds: 100,
  updatedAt: "2026-10-01T00:00:00.000Z",
}

beforeEach(() => {
  mocks.accountGateEnabled.mockReset().mockResolvedValue(false)
  mocks.globalBetaTesterCtaEnabled.mockReset().mockResolvedValue(false)
  mocks.fetchWatchProgressForUser.mockReset().mockResolvedValue([])
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("GET /watch/api/bootstrap", () => {
  it("answers an anonymous visitor in one private, uncached response", async () => {
    mocks.accountGateEnabled.mockResolvedValue(true)
    mocks.globalBetaTesterCtaEnabled.mockResolvedValue(true)
    const { GET } = await importRoute()

    const response = await GET(anonymousRequest())

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe(
      "private, no-cache, no-store, must-revalidate",
    )
    await expect(response.json()).resolves.toEqual({
      contractVersion: "watch-bootstrap-v1",
      account: {
        accountGateEnabled: true,
        authenticated: false,
        loginUrl:
          "https://example.test/watch/api/auth/login?returnTo=https%3A%2F%2Fexample.test%2Fwatch%2Fjesus%2Fenglish",
      },
      betaTesterCta: { enabled: true },
      watchProgress: { authenticated: false, userId: null, entries: [] },
    })
    // Progress is account-bound: anonymous visitors never reach the upstream.
    expect(mocks.fetchWatchProgressForUser).not.toHaveBeenCalled()
  })

  it("matches the account-session route body for the same request", async () => {
    mocks.accountGateEnabled.mockResolvedValue(true)
    const { GET } = await importRoute()
    vi.stubEnv("LAUNCHDARKLY_SDK_KEY", "")
    const sessionRoute = await import("../auth/session/route")

    const bootstrap = (await (
      await GET(anonymousRequest("/watch"))
    ).json()) as {
      account: unknown
    }
    const session = await sessionRoute.GET(
      new Request(
        "https://example.test/watch/api/auth/session?callbackURL=%2Fwatch",
      ),
    )

    expect(bootstrap.account).toEqual(await session.json())
  })

  it("returns the signed-in account and that account's progress", async () => {
    mocks.fetchWatchProgressForUser.mockResolvedValue([progressEntry])
    const { GET } = await importRoute()

    const response = await GET(await signedInRequest())

    await expect(response.json()).resolves.toEqual({
      contractVersion: "watch-bootstrap-v1",
      account: {
        accountGateEnabled: false,
        authenticated: true,
        user: {
          id: "user_123",
          email: "viewer@example.test",
          name: "Viewer Example",
          image: "https://example.test/avatar.jpg",
        },
      },
      betaTesterCta: { enabled: false },
      watchProgress: {
        authenticated: true,
        userId: "user_123",
        entries: [progressEntry],
      },
    })
    expect(mocks.fetchWatchProgressForUser).toHaveBeenCalledExactlyOnceWith(
      "user_123",
      expect.any(AbortSignal),
    )
    expect(response.headers.get("cache-control")).toContain("no-store")
  })

  it("never echoes the session access token", async () => {
    const { GET } = await importRoute()

    const response = await GET(await signedInRequest())

    expect(await response.text()).not.toContain("jfp_at_secret")
  })

  it("fails only the account section for a rejected callback destination", async () => {
    mocks.globalBetaTesterCtaEnabled.mockResolvedValue(true)
    const { GET } = await importRoute()

    const response = await GET(
      anonymousRequest(
        "http://localhost:3000/watch/api/download?url=https%3A%2F%2Fstream.mux.com%2Fabc.mp4",
      ),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      account: null,
      betaTesterCta: { enabled: true },
      watchProgress: { authenticated: false },
    })
  })

  it("fails the beta tester CTA closed without touching the other sections", async () => {
    mocks.globalBetaTesterCtaEnabled.mockRejectedValue(
      new Error("LaunchDarkly unavailable"),
    )
    const { GET } = await importRoute()

    const response = await GET(anonymousRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      account: { authenticated: false },
      betaTesterCta: null,
      watchProgress: { authenticated: false },
    })
  })

  it("hides the account section when the account gate flag cannot be read", async () => {
    mocks.accountGateEnabled.mockRejectedValue(new Error("flag outage"))
    const { GET } = await importRoute()

    const response = await GET(anonymousRequest())

    await expect(response.json()).resolves.toMatchObject({
      account: null,
      betaTesterCta: { enabled: false },
    })
  })

  it("marks progress unavailable when the progress upstream throws", async () => {
    mocks.fetchWatchProgressForUser.mockRejectedValue(new Error("timeout"))
    const { GET } = await importRoute()

    const response = await GET(await signedInRequest())

    await expect(response.json()).resolves.toMatchObject({
      account: { authenticated: true },
      watchProgress: null,
    })
  })

  it("aborts a slow progress read so account and CTA state still return", async () => {
    mocks.accountGateEnabled.mockResolvedValue(true)
    mocks.globalBetaTesterCtaEnabled.mockResolvedValue(true)
    mocks.fetchWatchProgressForUser.mockImplementation(
      (_userId, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          })
        }),
    )
    const { GET } = await importRoute()
    const request = await signedInRequest()

    const response = await GET(request)

    await expect(response.json()).resolves.toMatchObject({
      account: { authenticated: true },
      betaTesterCta: { enabled: true },
      watchProgress: null,
    })
    vi.useRealTimers()
  })

  it("evaluates the session and both flags concurrently", async () => {
    let releaseFlags: (() => void) | undefined
    const flagsGate = new Promise<void>((resolve) => {
      releaseFlags = resolve
    })
    mocks.accountGateEnabled.mockImplementation(async () => {
      await flagsGate
      return false
    })
    mocks.globalBetaTesterCtaEnabled.mockImplementation(async () => {
      await flagsGate
      return false
    })
    const { GET } = await importRoute()

    const pending = GET(anonymousRequest())
    await Promise.resolve()

    expect(mocks.accountGateEnabled).toHaveBeenCalledTimes(1)
    expect(mocks.globalBetaTesterCtaEnabled).toHaveBeenCalledTimes(1)
    releaseFlags?.()
    expect((await pending).status).toBe(200)
  })
})
