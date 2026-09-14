/** @vitest-environment jsdom */
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WatchForYouRecommendations } from "./WatchForYouRecommendations"
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }))
vi.mock("next/image", () => ({ default: () => <span /> }))
vi.mock("@/components/DatadogRum", () => ({
  reportDatadogRumAction: vi.fn(),
}))
vi.mock("@/lib/recommendation-consent-bootstrap", () => ({
  waitForRecommendationConsentBootstrap: async () => undefined,
  withRecommendationConsentLock: async (f: () => unknown) => f(),
}))
let container: HTMLDivElement, root: Root
let intersections: IntersectionObserverCallback[]
function delivery(language = "english") {
  return {
    delivery: {
      contractVersion: "user-recommendation-v1",
      surfaceVersion: "watch-for-you-v1",
      requestId: "request-1",
      result: "served",
      reason: null,
      items: Array.from({ length: 6 }, (_, i) => ({
        id: `item-${i}`,
        position: i,
        targetMediaId: `video-${i}`,
        videoTitle: `Video ${i}`,
        imageUrl: "https://image.test/poster.jpg",
        durationSeconds: 60,
        capability: "secret-capability",
        canonicalHref: `/watch/video-${i}.html${language === "english" ? "" : `/${language}.html`}`,
      })),
    },
  }
}
function acceptedEvidence(init: RequestInit) {
  const body = JSON.parse(String(init.body)) as {
    events: Array<{ eventId: string }>
  }
  return {
    receipts: body.events.map(({ eventId }) => ({
      eventId,
      status: "accepted",
    })),
  }
}
const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}
beforeEach(() => {
  intersections = []
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersections.push(callback)
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  )
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})
async function show(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock)
  act(() =>
    root.render(
      <WatchForYouRecommendations locale="en" audioLanguageSlug="english" />,
    ),
  )
  expect(fetchMock).not.toHaveBeenCalled()
  act(() =>
    intersections[0](
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  )
  await flush()
  await flush()
}
describe("For you row", () => {
  it("loads lazily, renders six stable full-video links and keeps capabilities out of the DOM", async () => {
    const fetchMock = vi.fn(
      async (_url: string, init: RequestInit) =>
        new Response(
          JSON.stringify(
            init.body?.toString().includes('"locale"')
              ? delivery()
              : acceptedEvidence(init),
          ),
        ),
    )
    await show(fetchMock)
    expect(container.querySelectorAll("a")).toHaveLength(6)
    expect(container.innerHTML).not.toContain("secret-capability")
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/watch/video-0.html",
    )
    const requests = () =>
      fetchMock.mock.calls.filter(([url]) => url.endsWith("/for-you"))
    act(() => window.dispatchEvent(new Event("focus")))
    await flush()
    expect(requests()).toHaveLength(1)
    act(() =>
      window.dispatchEvent(
        new PageTransitionEvent("pageshow", { persisted: true }),
      ),
    )
    await flush()
    expect(requests()).toHaveLength(2)
  })
  it.each([
    "cooldown",
    "in_flight",
    "admission_unavailable",
    "delivery_timeout",
    "service_unavailable",
  ])("retries %s once after the admission window", async (reason) => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(
      async (url: string, init: RequestInit) =>
        new Response(
          JSON.stringify(
            url.endsWith("/for-you") ? delivery() : acceptedEvidence(init),
          ),
        ),
    )
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          delivery: {
            ...delivery().delivery,
            result: "unavailable",
            reason,
            items: [],
          },
        }),
      ),
    )
    vi.stubGlobal("fetch", fetchMock)
    await act(async () =>
      root.render(
        <WatchForYouRecommendations locale="en" audioLanguageSlug="english" />,
      ),
    )
    await act(async () =>
      intersections[0](
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      ),
    )
    expect(container.querySelector('[data-state="loading"]')).not.toBeNull()
    await act(async () => vi.advanceTimersByTimeAsync(4999))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(container.querySelectorAll("a")).toHaveLength(6)
    expect(
      fetchMock.mock.calls.filter(([url]) => url.endsWith("/for-you")),
    ).toHaveLength(2)
  })

  it("omits an unavailable optional row without showing a page error or shrinking its slate", async () => {
    await show(
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              delivery: {
                ...delivery().delivery,
                result: "unavailable",
                reason: "coverage_unavailable",
                items: [],
              },
            }),
          ),
      ),
    )
    expect(container.querySelectorAll("a")).toHaveLength(0)
    expect(container.textContent).not.toContain("pageLoadFailed")
    expect(container.querySelector("section")).toBeNull()
  })

  it("recovers after a full upstream timeout with a fresh attempt after cooldown", async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (!url.endsWith("/for-you"))
        return new Response(JSON.stringify(acceptedEvidence(init)))
      return new Response(JSON.stringify(delivery()))
    })
    fetchMock.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2400))
      return new Response("{}", { status: 503 })
    })
    vi.stubGlobal("fetch", fetchMock)
    await act(async () =>
      root.render(
        <WatchForYouRecommendations locale="en" audioLanguageSlug="english" />,
      ),
    )
    await act(async () =>
      intersections[0](
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      ),
    )
    await act(async () => vi.advanceTimersByTimeAsync(7399))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[data-state="loading"]')).not.toBeNull()
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(container.querySelectorAll("a")).toHaveLength(6)
  })

  it("preserves visible space on failure until the viewer scrolls past it", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 100, 1000, 360),
    )
    const fetchMock = vi.fn(async () => new Response("{}", { status: 403 }))
    await show(fetchMock)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(container.querySelector("section")).toBeNull()
    expect(
      container.querySelector<HTMLElement>("[data-recommendation-placeholder]")
        ?.style.height,
    ).toBe("360px")
    act(() =>
      intersections.at(-1)!(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      ),
    )
    expect(container.innerHTML).toBe("")
  })

  it("caps repeated transport failures and cancels retries on unmount", async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async () => new Response("{}", { status: 503 }))
    vi.stubGlobal("fetch", fetchMock)
    await act(async () =>
      root.render(
        <WatchForYouRecommendations locale="en" audioLanguageSlug="english" />,
      ),
    )
    await act(async () =>
      intersections[0](
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      ),
    )
    await act(async () => vi.advanceTimersByTimeAsync(30000))
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(container.querySelector("section")).toBeNull()
    await act(async () =>
      window.dispatchEvent(
        new PageTransitionEvent("pageshow", { persisted: true }),
      ),
    )
    expect(fetchMock).toHaveBeenCalledTimes(4)
    await act(async () => root.render(null))
    await act(async () => vi.advanceTimersByTimeAsync(30000))
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it("ignores an old delivery after the playback language changes", async () => {
    let finishOldDelivery: (response: Response) => void = () => {}
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (!url.endsWith("/for-you"))
        return new Response(JSON.stringify(acceptedEvidence(init)))
      return new Response(JSON.stringify(delivery("hindi")))
    })
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOldDelivery = resolve
        }),
    )
    await show(fetchMock)
    await act(async () =>
      root.render(
        <WatchForYouRecommendations locale="en" audioLanguageSlug="hindi" />,
      ),
    )
    expect(container.querySelectorAll("a")).toHaveLength(6)
    await act(async () =>
      finishOldDelivery(new Response(JSON.stringify(delivery()))),
    )
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/watch/video-0.html/hindi.html",
    )
  })
})
