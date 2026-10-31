/**
 * @vitest-environment jsdom
 */

import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  accountGate: vi.fn<() => Promise<boolean>>(),
  progress: vi.fn<() => Promise<unknown[]>>(),
  clearUser: vi.fn(),
  identifyUser: vi.fn(),
}))

// This test deliberately runs a server handler inside JSDOM. Supply its
// validated configuration directly instead of the client-only env proxy.
vi.mock("@/env", () => ({
  env: {
    WEB_AUTH_BASE_URL: "http://localhost:3004",
    WEB_BASE_URL: "http://localhost:3000",
    NEXT_PUBLIC_CANONICAL_ORIGIN: "http://localhost:3000",
    WEB_SESSION_SECRET: "local-test-secret-at-least-thirty-two-characters",
  },
}))

vi.mock("@/lib/feature-flags", () => ({
  isWatchDownloadAccountGateEnabled: mocks.accountGate,
  watchDownloadAccountGateFlagContext: {
    custom: { surface: "watch-download" },
  },
}))
vi.mock("@/lib/watch-progress-server", () => ({
  fetchWatchProgressForUser: mocks.progress,
}))
vi.mock("@/components/FloatingSearchProvider", () => ({
  useFloatingSearchPinned: () => ({ searchChromeVisible: true }),
}))
vi.mock("@/components/DatadogRum", () => ({
  clearDatadogRumUser: mocks.clearUser,
  identifyDatadogRumUser: mocks.identifyUser,
}))

const remoteEntry = {
  videoId: "video-1",
  positionSeconds: 42,
  durationSeconds: 100,
  updatedAt: "2026-10-01T00:00:00.000Z",
}
let now: number
let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.accountGate.mockReset().mockResolvedValue(true)
  mocks.progress.mockReset().mockResolvedValue([remoteEntry])
  vi.stubEnv("WEB_AUTH_BASE_URL", "http://localhost:3004")
  vi.stubEnv("WEB_BASE_URL", "http://localhost:3000")
  vi.stubEnv("NEXT_PUBLIC_CANONICAL_ORIGIN", "https://example.test")
  vi.stubEnv(
    "WEB_SESSION_SECRET",
    "local-test-secret-at-least-thirty-two-characters",
  )
  now = Date.now()
  vi.spyOn(Date, "now").mockImplementation(() => now)
  window.localStorage.clear()
  window.history.replaceState({}, "", "/watch/jesus.html")
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

async function mountedRoute(authResponse: () => Promise<Response>) {
  // Exercise the real Next handler, compatibility verifier, parser, loader
  // and React consumers. Only upstream auth/flags/progress are local seams.
  const { GET } = await import("@/app/api/bootstrap/route")
  const { AccountControl } = await import("@/components/watch/AccountControl")
  const { useWatchProgress } = await import("@/lib/watch-progress-client")
  const requests: string[] = []
  const responses: Response[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.origin)
      requests.push(url.pathname)
      if (url.pathname === "/watch/api/bootstrap") {
        const response = await GET(
          new Request(url, {
            headers: {
              cookie: "better-auth.session_token=local-compatibility-fixture",
            },
          }),
        )
        responses.push(response)
        return response
      }
      expect(url.pathname).toBe("/api/auth/get-session")
      return authResponse()
    }),
  )
  function ProgressConsumer() {
    const progress = useWatchProgress("video-1")
    return <output>{progress?.positionSeconds ?? "local"}</output>
  }
  return {
    requests,
    responses,
    async render(cycle: number) {
      await act(async () =>
        root.render(
          <StrictMode>
            <AccountControl key={`account-${cycle}`} />
            <ProgressConsumer key={`progress-a-${cycle}`} />
            <ProgressConsumer key={`progress-b-${cycle}`} />
          </StrictMode>,
        ),
      )
    },
  }
}

describe("Watch bootstrap unavailable-section recovery", () => {
  it.each(["503", "timeout", "invalid JSON", "malformed 200"])(
    "recovers a mounted compatibility session after an upstream %s",
    async (failure) => {
      let attempts = 0
      const bridge = await mountedRoute(async () => {
        attempts += 1
        if (attempts === 1) {
          if (failure === "timeout") throw new Error("local upstream timeout")
          if (failure === "invalid JSON") return new Response("{broken-json")
          return failure === "503"
            ? new Response(null, { status: 503 })
            : Response.json({ unexpected: true })
        }
        return Response.json({
          user: { id: "user-1", name: "Existing viewer" },
        })
      })
      await bridge.render(0)
      await vi.waitFor(() => expect(mocks.clearUser).toHaveBeenCalled())
      expect(
        container.querySelector('[data-testid="watch-account-control"]'),
      ).toBeNull()
      expect(container.querySelector("output")?.textContent).toBe("local")
      expect(attempts).toBe(1)
      now += 5_001
      await bridge.render(1)
      await vi.waitFor(() => {
        expect(
          container
            .querySelector('[data-testid="watch-account-control"]')
            ?.getAttribute("data-auth-state"),
        ).toBe("signed-in")
        expect(container.querySelector("output")?.textContent).toBe("42")
      })
      expect(attempts).toBe(2)
      expect(
        bridge.requests.filter((p) => p === "/watch/api/bootstrap"),
      ).toHaveLength(2)
      expect(mocks.identifyUser).toHaveBeenCalledWith({
        id: "user-1",
        name: "Existing viewer",
      })
      for (const response of bridge.responses) {
        expect(response.headers.get("cache-control")).toBe(
          "private, no-cache, no-store, must-revalidate",
        )
      }
      await bridge.render(2)
      expect(attempts).toBe(2)
    },
  )

  it.each(["empty session", "401"])(
    "caches a healthy compatibility guest (%s)",
    async (responseKind) => {
      let attempts = 0
      const bridge = await mountedRoute(async () => {
        attempts += 1
        return responseKind === "401"
          ? new Response(null, { status: 401 })
          : Response.json(null)
      })
      await bridge.render(0)
      await vi.waitFor(() =>
        expect(
          container
            .querySelector('[data-testid="watch-account-control"]')
            ?.getAttribute("data-auth-state"),
        ).toBe("signed-out"),
      )
      now += 60_000
      await bridge.render(1)
      expect(attempts).toBe(1)
      expect(mocks.progress).not.toHaveBeenCalled()
      expect(mocks.identifyUser).not.toHaveBeenCalled()
    },
  )

  it("recovers a partial account without discarding healthy same-user progress", async () => {
    mocks.accountGate.mockRejectedValueOnce(new Error("local flag outage"))
    mocks.progress
      .mockResolvedValueOnce([remoteEntry])
      .mockRejectedValue(new Error("later progress outage"))
    const bridge = await mountedRoute(async () =>
      Response.json({ user: { id: "user-1" } }),
    )
    await bridge.render(0)
    await vi.waitFor(() =>
      expect(container.querySelector("output")?.textContent).toBe("42"),
    )
    expect(
      container.querySelector('[data-testid="watch-account-control"]'),
    ).toBeNull()
    now += 5_001
    await bridge.render(1)
    await vi.waitFor(() =>
      expect(
        container
          .querySelector('[data-testid="watch-account-control"]')
          ?.getAttribute("data-auth-state"),
      ).toBe("signed-in"),
    )
    const { loadWatchBootstrap } = await import("@/lib/watch-bootstrap-client")
    expect((await loadWatchBootstrap())?.watchProgress).toMatchObject({
      authenticated: true,
      userId: "user-1",
      entries: [remoteEntry],
    })
    expect(
      bridge.requests.filter((p) => p === "/watch/api/bootstrap"),
    ).toHaveLength(2)
  })

  it("shares each bounded retry and never polls an unavailable section", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        contractVersion: "watch-bootstrap-v1",
        account: null,
        watchProgress: { authenticated: false, userId: null, entries: [] },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const { loadWatchBootstrap } = await import("@/lib/watch-bootstrap-client")
    await Promise.all(Array.from({ length: 20 }, () => loadWatchBootstrap()))
    await Promise.all(Array.from({ length: 20 }, () => loadWatchBootstrap()))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    now += 5_001
    await Promise.all(Array.from({ length: 20 }, () => loadWatchBootstrap()))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await loadWatchBootstrap()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("does not carry a cached progress identity into a different account", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          contractVersion: "watch-bootstrap-v1",
          account: null,
          watchProgress: {
            authenticated: true,
            userId: "first-user",
            entries: [remoteEntry],
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          contractVersion: "watch-bootstrap-v1",
          account: {
            authenticated: true,
            accountGateEnabled: true,
            user: { id: "second-user" },
          },
          watchProgress: null,
        }),
      )
    vi.stubGlobal("fetch", fetchMock)
    const { loadWatchBootstrap } = await import("@/lib/watch-bootstrap-client")
    await loadWatchBootstrap()
    now += 5_001
    const recovered = await loadWatchBootstrap()
    expect(recovered?.account).toMatchObject({ user: { id: "second-user" } })
    expect(recovered?.watchProgress).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
