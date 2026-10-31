/**
 * @vitest-environment jsdom
 */

// The original W-028 audit counted four reads. Current main retired beta
// signup and profile initialization; mount only the two surviving consumers.
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/components/FloatingSearchProvider", () => ({
  useFloatingSearchPinned: () => ({ searchChromeVisible: true }),
}))

vi.mock("@/components/DatadogRum", () => ({
  clearDatadogRumUser: vi.fn(),
  identifyDatadogRumUser: vi.fn(),
}))

function requestLabels(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.map(([input, init]) => {
    const url = new URL(String(input), window.location.origin)
    return `${(init as RequestInit | undefined)?.method ?? "GET"} ${url.pathname}`
  })
}

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  vi.unstubAllGlobals()
})

describe("Watch shell hydration requests", () => {
  it.each([false, true])(
    "shares one initial read with authenticated=%s and no retired background request",
    async (authenticated) => {
      vi.resetModules()
      window.localStorage.clear()
      const idleCallbacks: Array<() => void> = []
      vi.stubGlobal("requestIdleCallback", (callback: () => void) => {
        idleCallbacks.push(callback)
        return idleCallbacks.length
      })
      const { AccountControl } =
        await import("@/components/watch/AccountControl")
      const { useWatchProgress } = await import("@/lib/watch-progress-client")
      const { clearDatadogRumUser, identifyDatadogRumUser } =
        await import("@/components/DatadogRum")
      vi.mocked(clearDatadogRumUser).mockClear()
      vi.mocked(identifyDatadogRumUser).mockClear()
      const user = { id: "user-1", email: "viewer@example.test" }
      const fetchMock = vi.fn(async () =>
        Response.json({
          contractVersion: "watch-bootstrap-v1",
          account: authenticated
            ? { accountGateEnabled: true, authenticated: true, user }
            : { accountGateEnabled: true, authenticated: false },
          watchProgress: authenticated
            ? {
                authenticated: true,
                userId: user.id,
                entries: [
                  {
                    videoId: "video-1",
                    positionSeconds: 10,
                    durationSeconds: 100,
                    updatedAt: "2026-10-01T00:00:00.000Z",
                  },
                ],
              }
            : { authenticated: false, userId: null, entries: [] },
        }),
      )
      vi.stubGlobal("fetch", fetchMock)
      function ProgressConsumer() {
        const progress = useWatchProgress("video-1")
        return <output>{progress?.positionSeconds ?? "local"}</output>
      }
      container = document.createElement("div")
      document.body.appendChild(container)
      root = createRoot(container)
      await act(async () => {
        root?.render(
          <>
            <AccountControl />
            <ProgressConsumer />
            <ProgressConsumer />
          </>,
        )
      })
      await vi.waitFor(() => {
        expect(
          container
            ?.querySelector('[data-testid="watch-account-control"]')
            ?.getAttribute("data-auth-state"),
        ).toBe(authenticated ? "signed-in" : "signed-out")
        expect(container?.querySelector("output")?.textContent).toBe(
          authenticated ? "10" : "local",
        )
      })
      expect(requestLabels(fetchMock)).toEqual(["GET /watch/api/bootstrap"])
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/watch/api/bootstrap?callbackURL="),
        expect.objectContaining({
          cache: "no-store",
          credentials: "same-origin",
        }),
      )
      // No idle profile initialization or per-consumer standalone GET is left.
      expect(idleCallbacks).toEqual([])
      if (authenticated) {
        expect(identifyDatadogRumUser).toHaveBeenCalledWith(user)
        expect(clearDatadogRumUser).not.toHaveBeenCalled()
      } else {
        expect(clearDatadogRumUser).toHaveBeenCalledTimes(1)
        expect(identifyDatadogRumUser).not.toHaveBeenCalled()
      }
    },
  )
})
