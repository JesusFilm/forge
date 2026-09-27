/** @vitest-environment jsdom */
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { fetchWithRetry } = vi.hoisted(() => ({
  fetchWithRetry: vi.fn(
    async (_url: string, _init: RequestInit, _deadline: number) =>
      new Response("{}", { status: 200 }),
  ),
}))
vi.mock("@/lib/recommendation-browser", () => ({
  recommendationFetchWithRetry: fetchWithRetry,
}))
import { WatchExposureBoundary } from "./WatchExposureBoundary"

let observerCallback: IntersectionObserverCallback
const observed = new Set<Element>()
class TestObserver implements IntersectionObserver {
  readonly root = null
  readonly rootMargin = "0px"
  readonly thresholds = [0.5]
  constructor(callback: IntersectionObserverCallback) {
    observerCallback = callback
  }
  observe(node: Element) {
    observed.add(node)
  }
  unobserve(node: Element) {
    observed.delete(node)
  }
  disconnect() {
    observed.clear()
  }
  takeRecords() {
    return []
  }
}
const config = {
  surface: "watch-search",
  block: "results",
  presentation: "result-list",
  placement: "search-results",
} as const

function bodies() {
  return fetchWithRetry.mock.calls.flatMap((call) => {
    const init = call[1] as RequestInit
    return JSON.parse(String(init.body)) as Array<Record<string, unknown>>
  })
}

describe("WatchExposureBoundary", () => {
  let root: Root
  let container: HTMLDivElement
  let uuid = 0
  beforeEach(() => {
    vi.useFakeTimers()
    fetchWithRetry.mockClear()
    observed.clear()
    vi.stubGlobal("IntersectionObserver", TestObserver)
    vi.stubGlobal("IntersectionObserverEntry", undefined)
    vi.stubGlobal("crypto", {
      randomUUID: () =>
        `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}`,
    })
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    })
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

  it("batches many rendered cards and retains an early selection anomaly", () => {
    act(() => {
      root.render(
        <WatchExposureBoundary config={config}>
          {Array.from({ length: 70 }, (_, i) => (
            <a
              key={i}
              href={`/watch/video-${i}.html`}
              onClick={(event) => event.preventDefault()}
            >
              video {i}
            </a>
          ))}
        </WatchExposureBoundary>,
      )
    })
    act(() => vi.advanceTimersByTime(120))
    expect(fetchWithRetry).toHaveBeenCalledTimes(2)
    expect(bodies().filter((event) => event.kind === "rendered")).toHaveLength(
      70,
    )
    const first = container.querySelector("a")!
    act(() => first.click())
    expect(bodies().filter((event) => event.kind === "selected")).toHaveLength(
      1,
    )
    expect(bodies().filter((event) => event.kind === "eligible")).toHaveLength(
      0,
    )
    act(() =>
      observerCallback(
        [
          {
            target: first,
            isIntersecting: true,
            intersectionRatio: 0.5,
          } as unknown as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      ),
    )
    act(() => vi.advanceTimersByTime(1120))
    expect(bodies().filter((event) => event.kind === "eligible")).toHaveLength(
      1,
    )
  })

  it("splits long valid paths below the server's 48 KiB body limit", () => {
    const prefix = "a".repeat(155)
    act(() => {
      root.render(
        <WatchExposureBoundary config={config}>
          {Array.from({ length: 64 }, (_, i) => (
            <a
              key={i}
              href={`/watch/${prefix}.html/${prefix}.html/${String(i).padStart(3, "0")}${prefix}.html`}
            >
              video {i}
            </a>
          ))}
        </WatchExposureBoundary>,
      )
    })
    act(() => vi.advanceTimersByTime(120))
    expect(fetchWithRetry.mock.calls.length).toBeGreaterThan(1)
    expect(bodies()).toHaveLength(64)
    for (const call of fetchWithRetry.mock.calls) {
      expect(
        new TextEncoder().encode(String((call[1] as RequestInit).body))
          .byteLength,
      ).toBeLessThanOrEqual(48 * 1024)
    }
  })

  it("re-reads a responsive href change and does not fabricate an exposure", () => {
    act(() =>
      root.render(
        <WatchExposureBoundary config={config}>
          <a
            href="/watch/first.html"
            onClick={(event) => event.preventDefault()}
          >
            first
          </a>
        </WatchExposureBoundary>,
      ),
    )
    act(() => vi.advanceTimersByTime(120))
    const anchor = container.querySelector("a")!
    anchor.setAttribute("href", "/watch/second.html")
    act(() => {
      vi.advanceTimersByTime(16)
      vi.advanceTimersByTime(120)
    })
    expect(bodies().filter((event) => event.kind === "eligible")).toHaveLength(
      0,
    )
    expect(
      bodies()
        .filter((event) => event.kind === "rendered")
        .map((event) => event.itemPath),
    ).toContain("/watch/first.html")
  })

  it("resets dwell and records a new placement after card reorder", async () => {
    const renderCards = (order: string[]) => (
      <WatchExposureBoundary config={config}>
        {order.map((name) => (
          <a
            key={name}
            href={`/watch/${name}.html`}
            onClick={(event) => event.preventDefault()}
          >
            {name}
          </a>
        ))}
      </WatchExposureBoundary>
    )
    act(() => root.render(renderCards(["first", "second"])))
    act(() => vi.advanceTimersByTime(120))
    const first = container.querySelector("a")!
    act(() =>
      observerCallback(
        [
          {
            target: first,
            isIntersecting: true,
            intersectionRatio: 0.5,
          } as unknown as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      ),
    )
    act(() => vi.advanceTimersByTime(500))
    await act(async () => {
      root.render(renderCards(["second", "first"]))
      await Promise.resolve()
      vi.advanceTimersByTime(16)
    })
    act(() => vi.advanceTimersByTime(620))
    expect(
      bodies().filter(
        (event) =>
          event.kind === "eligible" && event.itemPath === "/watch/first.html",
      ),
    ).toHaveLength(0)
    expect(
      bodies().filter(
        (event) =>
          event.kind === "rendered" && event.itemPath === "/watch/first.html",
      ),
    ).toHaveLength(2)
  })
})
