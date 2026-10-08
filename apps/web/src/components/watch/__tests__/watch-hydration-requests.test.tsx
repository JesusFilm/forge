/**
 * @vitest-environment jsdom
 */

// FGE-225 / W-028 request-count evidence: mounts the four shell consumers that
// used to fire their own uncacheable request on hydration, together, and
// counts what actually reaches the network before and after browser idle.

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  usePathname: () => "/watch/jesus.html",
}))

vi.mock("@/components/FloatingSearchProvider", () => ({
  useFloatingSearchPinned: () => ({
    pinned: false,
    playerChromeVisible: true,
    searchChromeVisible: true,
    searchChromeDimmed: false,
    searchOpen: false,
  }),
}))

vi.mock("@/components/DatadogRum", () => ({
  clearDatadogRumUser: vi.fn(),
  identifyDatadogRumUser: vi.fn(),
}))

import { RecommendationConsentShell } from "@/components/recommendations/RecommendationConsentShell"
import { AccountControl } from "@/components/watch/AccountControl"
import {
  __resetBetaTesterCtaBootstrapForTests,
  BetaTesterModalProvider,
} from "@/components/watch/BetaTesterModalProvider"
import { WatchModalActivityProvider } from "@/components/watch/WatchModalActivityProvider"
import { __resetWatchBootstrapForTests } from "@/lib/watch-bootstrap-client"
import { useWatchProgress } from "@/lib/watch-progress-client"

function ProgressConsumer() {
  useWatchProgress("video-1")
  return null
}

const signedInBootstrap = {
  contractVersion: "watch-bootstrap-v1",
  account: {
    accountGateEnabled: false,
    authenticated: true,
    user: { id: "user-1", email: "viewer@example.test" },
  },
  betaTesterCta: { enabled: true },
  watchProgress: {
    authenticated: true,
    userId: "user-1",
    entries: [
      {
        videoId: "video-1",
        positionSeconds: 10,
        durationSeconds: 100,
        updatedAt: "2026-10-01T00:00:00.000Z",
      },
    ],
  },
}

const profile = {
  consentChoice: "personalization",
  consentContractVersion: "recommendation-consent-v1",
  erasureState: "not_required",
}

let container: HTMLDivElement
let root: Root
let idleCallbacks: Array<() => void>

function requestLabels(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.map(([input, init]) => {
    const url = new URL(String(input), "http://localhost:3000")
    return `${(init as RequestInit | undefined)?.method ?? "GET"} ${url.pathname}`
  })
}

beforeEach(() => {
  window.localStorage.clear()
  __resetWatchBootstrapForTests()
  __resetBetaTesterCtaBootstrapForTests()
  idleCallbacks = []
  vi.stubGlobal("requestIdleCallback", (callback: () => void) => {
    idleCallbacks.push(callback)
    return idleCallbacks.length
  })
  vi.stubGlobal("cancelIdleCallback", vi.fn())
  vi.stubGlobal("navigator", {
    locks: {
      request: (_name: string, operation: () => Promise<unknown>) =>
        operation(),
    },
  })
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe("Watch shell hydration requests", () => {
  it("collapses the visitor reads into one bootstrap and defers the profile POST to idle", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/watch/api/bootstrap")) {
        return Response.json(signedInBootstrap)
      }
      if (url.includes("/api/recommendations/profile")) {
        return Response.json({ profile })
      }
      return Response.json({ entries: [] })
    })
    vi.stubGlobal("fetch", fetchMock)

    await act(async () => {
      root.render(
        <WatchModalActivityProvider>
          <RecommendationConsentShell />
          <BetaTesterModalProvider>
            <AccountControl />
            <ProgressConsumer />
          </BetaTesterModalProvider>
        </WatchModalActivityProvider>,
      )
    })

    await vi.waitFor(() => {
      expect(
        container.querySelector('[data-testid="watch-account-control"]'),
      ).not.toBeNull()
      expect(
        document.querySelector("[data-testid='global-beta-tester-cta']"),
      ).not.toBeNull()
    })

    // Hydration: one same-origin GET instead of session + CTA + progress +
    // profile. Before FGE-225 this list held four requests.
    expect(requestLabels(fetchMock)).toEqual(["GET /watch/api/bootstrap"])
    expect(idleCallbacks).toHaveLength(1)

    await act(async () => {
      idleCallbacks[0]?.()
    })
    await vi.waitFor(() => {
      expect(requestLabels(fetchMock)).toContain(
        "POST /watch/api/recommendations/profile",
      )
    })

    // No consumer fell back to its old per-surface GET.
    expect(
      requestLabels(fetchMock).filter((label) =>
        /GET \/watch\/api\/(auth\/session|beta-tester-cta|watch-progress)$/.test(
          label,
        ),
      ),
    ).toEqual([])
  })
})
