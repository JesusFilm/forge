/** @vitest-environment jsdom */
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WatchForYouRecommendations } from "./WatchForYouRecommendations"
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }))
vi.mock("next/image", () => ({ default: () => <span /> }))
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
              : { receipts: [] },
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
  it.each(["cooldown", "in_flight"])(
    "retries %s once after the admission window",
    async (reason) => {
      vi.useFakeTimers()
      const fetchMock = vi.fn(
        async (url: string) =>
          new Response(
            JSON.stringify(
              url.endsWith("/for-you") ? delivery() : { receipts: [] },
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
          <WatchForYouRecommendations
            locale="en"
            audioLanguageSlug="english"
          />,
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
    },
  )

  it("shows a retry state for a coverage failure, without silently shrinking the row", async () => {
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
    expect(container.textContent).toContain("pageLoadFailed")
    expect(container.querySelector("button")).not.toBeNull()
  })
})
