/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  accountGateEnabled: vi.fn<() => Promise<boolean>>(),
  fetchWatchProgressForUser:
    vi.fn<(userId: string, signal?: AbortSignal) => Promise<unknown[]>>(),
}))

vi.mock("@/lib/feature-flags", () => ({
  isWatchDownloadAccountGateEnabled: mocks.accountGateEnabled,
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
  vi.stubEnv("NEXT_PUBLIC_CANONICAL_ORIGIN", "https://example.test")
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

async function signedInRequest(subject = "user_123") {
  const { WEB_AUTH_SESSION_COOKIE, createWebAuthSessionCookie } =
    await import("@/auth/web-session")
  const cookie = await createWebAuthSessionCookie({
    subject,
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
  mocks.fetchWatchProgressForUser.mockReset().mockResolvedValue([])
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("GET /watch/api/bootstrap", () => {
  it("answers an anonymous visitor in one private, uncached response", async () => {
    mocks.accountGateEnabled.mockResolvedValue(true)
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
    const { GET } = await importRoute()

    const response = await GET(
      anonymousRequest(
        "http://localhost:3000/watch/api/download?url=https%3A%2F%2Fstream.mux.com%2Fabc.mp4",
      ),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      account: null,
      watchProgress: { authenticated: false },
    })
  })

  it("hides the account section when the account gate flag cannot be read", async () => {
    mocks.accountGateEnabled.mockRejectedValue(new Error("flag outage"))
    const { GET } = await importRoute()

    const response = await GET(anonymousRequest())

    await expect(response.json()).resolves.toMatchObject({
      account: null,
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

  it("aborts a slow progress read within the shared response budget", async () => {
    mocks.accountGateEnabled.mockResolvedValue(true)
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

    const timeoutSpy = vi.spyOn(AbortSignal, "timeout")
    const response = await GET(request)

    expect(timeoutSpy).toHaveBeenCalledWith(1_500)
    expect(mocks.fetchWatchProgressForUser.mock.calls[0]?.[1]?.aborted).toBe(
      true,
    )
    await expect(response.json()).resolves.toMatchObject({
      account: { authenticated: true },
      watchProgress: null,
    })
  })

  it("starts session verification while the account flag is pending", async () => {
    let releaseFlags: (() => void) | undefined
    const flagsGate = new Promise<void>((resolve) => {
      releaseFlags = resolve
    })
    mocks.accountGateEnabled.mockImplementation(async () => {
      await flagsGate
      return false
    })
    const { GET } = await importRoute()

    const fetchMock = vi.fn(async () =>
      Response.json({ user: { id: "compat-user" } }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const pending = GET(
      new Request(`${ROUTE_URL}?callbackURL=%2Fwatch`, {
        headers: { cookie: "better-auth.session_token=compat-fixture" },
      }),
    )
    // The real compatibility verifier reaches its upstream before the flag
    // resolves; only one verification serves account and progress.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(mocks.accountGateEnabled).toHaveBeenCalledTimes(1)
    releaseFlags?.()
    const response = await pending
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      account: { authenticated: true, user: { id: "compat-user" } },
      watchProgress: { authenticated: true, userId: "compat-user" },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(mocks.fetchWatchProgressForUser).toHaveBeenCalledExactlyOnceWith(
      "compat-user",
      expect.any(AbortSignal),
    )
  })
  it("does not reuse one visitor's account or progress in another request", async () => {
    const { GET } = await importRoute()
    mocks.fetchWatchProgressForUser.mockImplementation(async (userId) => [
      {
        ...progressEntry,
        videoId: `${userId}-video`,
      },
    ])
    const first = await GET(await signedInRequest("first-user"))
    const second = await GET(await signedInRequest("second-user"))
    const guest = await GET(anonymousRequest("/watch"))
    expect(await first.text()).not.toContain("second-user")
    const secondBody = await second.text()
    expect(secondBody).toContain("second-user-video")
    expect(secondBody).not.toContain("first-user")
    const guestBody = await guest.text()
    expect(guestBody).not.toContain("first-user")
    expect(guestBody).not.toContain("second-user")
    expect(mocks.fetchWatchProgressForUser).toHaveBeenCalledTimes(2)
    for (const response of [first, second, guest]) {
      expect(response.headers.get("cache-control")).toBe(
        "private, no-cache, no-store, must-revalidate",
      )
    }
  })
})
