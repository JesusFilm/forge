/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  DynamicCollectionFeedRequestError,
  type DynamicCollectionFeedPage,
} from "@/lib/dynamic-collection-contract"

const loadPage = vi.hoisted(() => vi.fn())

vi.mock("@/lib/dynamic-collection-client", () => ({
  loadDynamicCollectionFeedPage: loadPage,
}))

vi.mock("@/components/sections/MediaCollection", () => ({
  MediaCollection: ({
    data,
    initialSelectedSnap,
    onSelectedSnapChange,
  }: {
    data: Record<string, unknown>
    initialSelectedSnap?: number
    onSelectedSnapChange?: (snap: number) => void
  }) => (
    <section
      data-testid="loaded-collection"
      data-title={String(data.title)}
      data-parent-slug={String(data.mediaDefaultCollectionSlug)}
      data-initial-snap={initialSelectedSnap}
    >
      <button type="button" onClick={() => onSelectedSnapChange?.(7)}>
        {String(data.title)} card
      </button>
    </section>
  ),
}))

import {
  DynamicMediaCollection,
  FEED_EXHAUSTED_MESSAGE,
} from "./DynamicMediaCollection"

function feedSentinel() {
  const sentinel = container.querySelector<HTMLDivElement>(
    '[data-testid="dynamic-collection-feed-sentinel"]',
  )
  if (!sentinel) throw new Error("feed sentinel not rendered")
  return sentinel
}

function sentinelMessage() {
  return feedSentinel().querySelector("p")
}

/**
 * jsdom applies no CSS, so `textContent` contains the exhausted-feed sentence
 * whether it renders visibly or screen-reader-only. Every assertion about that
 * sentence has to read the class list instead.
 */
function sentinelMessageIsScreenReaderOnly() {
  return sentinelMessage()?.classList.contains("sr-only") ?? false
}

/**
 * Returns each spacing utility still on the sentinel, so an assertion can name
 * both independently. A single `hasSpacing` boolean would let one leftover
 * utility — the 112px minimum height on its own is still a dead band — read as
 * "collapsed".
 */
function sentinelSpacingClasses() {
  const { classList } = feedSentinel()
  return ["min-h-28", "py-8"].filter((utility) => classList.contains(utility))
}

let container: HTMLDivElement
let root: Root
type IntersectionObserverHarness = {
  callback: IntersectionObserverCallback
  disconnect: ReturnType<typeof vi.fn>
  observed: Set<Element>
  rootMargin: string
}

let intersectionObservers: IntersectionObserverHarness[] = []
let resizeCallback: ResizeObserverCallback = () => {}
let resizeDisconnect = vi.fn()
let mobileProfile = false

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

beforeEach(() => {
  loadPage.mockReset()
  mobileProfile = false
  intersectionObservers = []
  resizeCallback = () => {}
  resizeDisconnect = vi.fn()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  class TestIntersectionObserver {
    harness: IntersectionObserverHarness
    constructor(
      callback: IntersectionObserverCallback,
      options?: IntersectionObserverInit,
    ) {
      this.harness = {
        callback,
        disconnect: vi.fn(),
        observed: new Set(),
        rootMargin: String(options?.rootMargin ?? "0px"),
      }
      intersectionObservers.push(this.harness)
    }
    observe = (element: Element) => this.harness.observed.add(element)
    unobserve = (element: Element) => this.harness.observed.delete(element)
    disconnect = () => {
      // A real disconnect stops observing everything. Without this, a
      // torn-down observer keeps its element forever and any "is the sentinel
      // observed?" assertion matches the stale one.
      this.harness.observed.clear()
      this.harness.disconnect()
    }
    takeRecords() {
      return []
    }
    root = null
    rootMargin = "0px"
    thresholds = [0]
  }
  vi.stubGlobal(
    "IntersectionObserver",
    TestIntersectionObserver as unknown as typeof IntersectionObserver,
  )
  class TestResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      resizeCallback = callback
    }
    observe() {}
    unobserve() {}
    disconnect() {
      resizeDisconnect()
    }
  }
  vi.stubGlobal(
    "ResizeObserver",
    TestResizeObserver as unknown as typeof ResizeObserver,
  )
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches:
        mobileProfile &&
        (query === "(max-width: 767px)" || query === "(pointer: coarse)"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  )
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function section(id: string, title: string) {
  return {
    id,
    slug: `slug-${id}`,
    title,
    description: null,
    items: [
      {
        id: `child-${id}`,
        coreId: `child-core-${id}`,
        title: `Child ${id}`,
        videoSlug: `child-slug-${id}`,
        languageSlug: "english",
        label: "EPISODE",
        imageUrl: null,
        blurDataUrl: null,
        dominantColor: null,
        muxPlaybackId: null,
      },
    ],
  }
}

function intersect(isIntersecting = true) {
  return act(async () => {
    intersectionObservers[0]?.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    )
  })
}

/**
 * The most recently created sentinel observer. `intersect()` always drives the
 * first one, which is the disconnected observer once the feed has been
 * exhausted and re-armed.
 */
function latestSentinelObserver() {
  const sentinelObservers = intersectionObservers.filter(
    (observer) => observer.rootMargin === "900px 0px",
  )
  const latest = sentinelObservers.at(-1)
  if (!latest) throw new Error("no sentinel observer was created")
  return latest
}

function intersectLatestSentinel(isIntersecting = true) {
  const latest = latestSentinelObserver()
  return act(async () => {
    latest.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    )
  })
}

function measureMountedRows(height = 240) {
  const rows = Array.from(
    container.querySelectorAll<HTMLDivElement>(
      '[data-testid="dynamic-collection-row"][data-window-state="mounted"]',
    ),
  )
  return act(async () => {
    resizeCallback(
      rows.map(
        (target) =>
          ({
            target,
            contentRect: { height },
          }) as unknown as ResizeObserverEntry,
      ),
      {} as ResizeObserver,
    )
  })
}

function observeRows(
  visibleIds: string[],
  positions: Record<string, number> = {},
) {
  const rowObserver = intersectionObservers.find(
    (observer) => observer.rootMargin.split(" ").length === 3,
  )
  const rows = Array.from(
    container.querySelectorAll<HTMLDivElement>(
      '[data-testid="dynamic-collection-row"]',
    ),
  )
  return act(async () => {
    rowObserver?.callback(
      rows.map((target, index) => {
        const id = target.dataset.collectionId ?? ""
        const top = positions[id] ?? index * 240
        return {
          target,
          isIntersecting: visibleIds.includes(id),
          boundingClientRect: { top, bottom: top + 240 },
        } as unknown as IntersectionObserverEntry
      }),
      {} as IntersectionObserver,
    )
  })
}

describe("DynamicMediaCollection", () => {
  it("stays lazy, uses the desktop profile, and deduplicates authored sections", async () => {
    loadPage.mockResolvedValue({
      sections: [
        section("already-featured", "Duplicate"),
        section("new", "New"),
      ],
      endCursor: "new",
      hasNextPage: false,
    } satisfies DynamicCollectionFeedPage)

    await act(async () => {
      root.render(
        <DynamicMediaCollection
          data={{
            sectionKey: "keep-exploring",
            title: "Keep exploring",
            subtitle: "More stories",
            mediaDescription: "Introductory feed copy",
            excludedVideoIds: ["blocked", "already-featured"],
          }}
          locale="en"
          languageSlug="english"
          featuredCollections={{
            ids: ["already-featured"],
            slugs: ["featured-slug"],
          }}
        />,
      )
    })

    expect(loadPage).not.toHaveBeenCalled()
    await intersect()

    expect(loadPage).toHaveBeenCalledWith(
      {
        locale: "en",
        languageSlug: "english",
        after: null,
        excludedIds: ["blocked", "already-featured"],
        excludedSlugs: ["featured-slug"],
        cacheScope: "live",
        cacheSignature: null,
        first: 3,
        cardsPerParent: 12,
      },
      { signal: expect.any(AbortSignal) },
    )
    expect(
      container.querySelectorAll('[data-testid="loaded-collection"]'),
    ).toHaveLength(1)
    expect(container.querySelector('[data-title="New"]')).toBeTruthy()
    expect(container.textContent).not.toContain("Keep exploring")
    expect(container.textContent).not.toContain("More stories")
    expect(container.textContent).not.toContain("Introductory feed copy")
    expect(sentinelMessage()?.textContent).toBe(FEED_EXHAUSTED_MESSAGE)
    expect(sentinelMessageIsScreenReaderOnly()).toBe(true)
  })

  it("marks draft feed requests as preview cache variants", async () => {
    loadPage.mockResolvedValue({
      sections: [],
      endCursor: null,
      hasNextPage: false,
    } satisfies DynamicCollectionFeedPage)

    await act(async () => {
      root.render(
        <DynamicMediaCollection
          data={{ title: "Explore" }}
          locale="en"
          languageSlug="english"
          cacheScope="preview"
          cacheSignatures={{
            mobile: "m".repeat(43),
            desktop: "d".repeat(43),
          }}
        />,
      )
    })
    await intersect()

    expect(loadPage.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        cacheScope: "preview",
        cacheSignature: "d".repeat(43),
      }),
    )
  })

  it("uses only server-issued signatures while advancing duplicate pages", async () => {
    loadPage
      .mockResolvedValueOnce({
        sections: [],
        endCursor: "cursor-1",
        hasNextPage: true,
        nextCacheSignature: "n".repeat(43),
      })
      .mockResolvedValueOnce({
        sections: [section("new", "New")],
        endCursor: "cursor-2",
        hasNextPage: false,
        nextCacheSignature: null,
      })

    await act(async () => {
      root.render(
        <DynamicMediaCollection
          data={{ title: "Explore" }}
          locale="en"
          languageSlug="english"
          cacheSignatures={{
            mobile: "m".repeat(43),
            desktop: "d".repeat(43),
          }}
        />,
      )
    })
    await intersect()

    expect(loadPage).toHaveBeenCalledTimes(2)
    expect(loadPage.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        after: null,
        cacheSignature: "d".repeat(43),
      }),
    )
    expect(loadPage.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        after: "cursor-1",
        cacheSignature: "n".repeat(43),
      }),
    )
  })

  it("freezes the mobile/coarse profile and prevents concurrent loads", async () => {
    mobileProfile = true
    const first = deferred<DynamicCollectionFeedPage>()
    loadPage.mockReturnValueOnce(first.promise).mockResolvedValueOnce({
      sections: [section("second", "Second")],
      endCursor: "second",
      hasNextPage: false,
    })
    await act(async () => {
      root.render(
        <DynamicMediaCollection
          data={{ title: "Explore" }}
          locale="en"
          languageSlug="english"
        />,
      )
    })

    await intersect()
    await intersect()
    expect(loadPage).toHaveBeenCalledTimes(1)
    expect(loadPage.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ first: 2, cardsPerParent: 8 }),
    )
    expect(
      container
        .querySelector('[data-testid="dynamic-media-collection-feed"]')
        ?.getAttribute("aria-busy"),
    ).toBe("true")

    mobileProfile = false
    first.resolve({
      sections: [section("first", "First")],
      endCursor: "first",
      hasNextPage: true,
    })
    await act(async () => first.promise)
    await intersect()
    expect(loadPage.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ first: 2, cardsPerParent: 8, after: "first" }),
    )
  })

  it("retries with a fresh GET after a failed page load", async () => {
    loadPage.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({
      sections: [section("recovered", "Recovered")],
      endCursor: "recovered",
      hasNextPage: false,
    } satisfies DynamicCollectionFeedPage)
    await act(async () => {
      root.render(
        <DynamicMediaCollection
          data={{ title: "Explore" }}
          locale="en"
          languageSlug="english"
        />,
      )
    })
    await intersect()

    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Try loading"),
    )
    expect(retry).toBeTruthy()

    await act(async () => retry?.click())
    expect(loadPage).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[data-title="Recovered"]')).toBeTruthy()
  })

  it("disables retry until a rate-limit window expires", async () => {
    vi.useFakeTimers()
    loadPage
      .mockRejectedValueOnce(
        new DynamicCollectionFeedRequestError("rate_limited", 30),
      )
      .mockResolvedValueOnce({
        sections: [section("recovered", "Recovered")],
        endCursor: "recovered",
        hasNextPage: false,
      } satisfies DynamicCollectionFeedPage)
    await act(async () => {
      root.render(
        <DynamicMediaCollection
          data={{ title: "Explore" }}
          locale="en"
          languageSlug="english"
        />,
      )
    })
    await intersect()

    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Try loading"),
    )
    expect((retry as HTMLButtonElement | undefined)?.disabled).toBe(true)
    await act(async () => retry?.click())
    expect(loadPage).toHaveBeenCalledTimes(1)

    for (let second = 0; second < 30; second += 1) {
      await act(async () => vi.advanceTimersByTimeAsync(1000))
    }
    expect((retry as HTMLButtonElement | undefined)?.disabled).toBe(false)
    await act(async () => retry?.click())
    expect(loadPage).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[data-title="Recovered"]')).toBeTruthy()
  })

  it("drains only three duplicate-only pages before yielding and rearming", async () => {
    vi.useFakeTimers()
    loadPage
      .mockResolvedValueOnce({
        sections: [section("featured", "Duplicate")],
        endCursor: "cursor-1",
        hasNextPage: true,
      })
      .mockResolvedValueOnce({
        sections: [section("featured", "Duplicate")],
        endCursor: "cursor-2",
        hasNextPage: true,
      })
      .mockResolvedValueOnce({
        sections: [section("featured", "Duplicate")],
        endCursor: "cursor-3",
        hasNextPage: true,
      })
      .mockResolvedValueOnce({
        sections: [section("fresh", "Fresh")],
        endCursor: "cursor-4",
        hasNextPage: false,
      })
    await act(async () => {
      root.render(
        <DynamicMediaCollection
          data={{ title: "Explore" }}
          locale="en"
          languageSlug="english"
          featuredCollections={{ ids: ["featured"], slugs: [] }}
        />,
      )
    })

    await intersect()
    await act(async () => Promise.resolve())
    expect(loadPage).toHaveBeenCalledTimes(3)
    expect(loadPage.mock.calls.map(([input]) => input.after)).toEqual([
      null,
      "cursor-1",
      "cursor-2",
    ])

    await act(async () => vi.advanceTimersByTimeAsync(249))
    expect(loadPage).toHaveBeenCalledTimes(3)

    await act(async () => vi.runOnlyPendingTimersAsync())
    expect(loadPage).toHaveBeenCalledTimes(4)
    expect(loadPage.mock.calls[3]?.[0]).toEqual(
      expect.objectContaining({ after: "cursor-3" }),
    )
    expect(container.querySelector('[data-title="Fresh"]')).toBeTruthy()
  })

  it("terminates safely when a page does not advance the cursor", async () => {
    loadPage
      .mockResolvedValueOnce({
        sections: [section("first", "First")],
        endCursor: "cursor-1",
        hasNextPage: true,
      })
      .mockResolvedValueOnce({
        sections: [],
        endCursor: "cursor-1",
        hasNextPage: true,
      })
    await act(async () => {
      root.render(
        <DynamicMediaCollection
          data={{ title: "Explore" }}
          locale="en"
          languageSlug="english"
        />,
      )
    })

    await intersect()
    await intersect()
    await intersect()
    expect(loadPage).toHaveBeenCalledTimes(2)
    expect(sentinelMessage()?.textContent).toBe(FEED_EXHAUSTED_MESSAGE)
    expect(sentinelMessageIsScreenReaderOnly()).toBe(true)
  })

  it("ignores a late response after feed props change", async () => {
    const oldRequest = deferred<DynamicCollectionFeedPage>()
    loadPage.mockReturnValueOnce(oldRequest.promise)
    await act(async () => {
      root.render(
        <DynamicMediaCollection
          data={{ title: "Explore" }}
          locale="en"
          languageSlug="english"
        />,
      )
    })
    await intersect()

    await act(async () => {
      root.render(
        <DynamicMediaCollection
          data={{ title: "Explore" }}
          locale="fr"
          languageSlug="french"
        />,
      )
    })
    oldRequest.resolve({
      sections: [section("stale", "Stale")],
      endCursor: "stale",
      hasNextPage: false,
    })
    await act(async () => oldRequest.promise)

    expect(container.querySelector('[data-title="Stale"]')).toBeNull()
    expect(container.textContent).toContain(
      "More collections load as you scroll.",
    )
  })

  it("resets and aborts the feed when its cache scope changes", async () => {
    const oldRequest = deferred<DynamicCollectionFeedPage>()
    loadPage.mockReturnValueOnce(oldRequest.promise)
    await act(async () => {
      root.render(
        <DynamicMediaCollection
          data={{ title: "Explore" }}
          locale="en"
          languageSlug="english"
          cacheScope="live"
        />,
      )
    })
    await intersect()
    const signal = loadPage.mock.calls[0]?.[1]?.signal as AbortSignal

    await act(async () => {
      root.render(
        <DynamicMediaCollection
          data={{ title: "Explore" }}
          locale="en"
          languageSlug="english"
          cacheScope="preview"
        />,
      )
    })

    expect(signal.aborted).toBe(true)
    oldRequest.resolve({
      sections: [section("stale", "Stale")],
      endCursor: "stale",
      hasNextPage: false,
    })
    await act(async () => oldRequest.promise)

    expect(container.querySelector('[data-title="Stale"]')).toBeNull()
  })

  it("aborts and ignores an in-flight response after unmount", async () => {
    const pending = deferred<DynamicCollectionFeedPage>()
    loadPage.mockReturnValueOnce(pending.promise)
    await act(async () => {
      root.render(
        <DynamicMediaCollection
          data={{ title: "Explore" }}
          locale="en"
          languageSlug="english"
        />,
      )
    })
    await intersect()
    const signal = loadPage.mock.calls[0]?.[1]?.signal as AbortSignal

    act(() => root.unmount())
    expect(signal.aborted).toBe(true)
    pending.resolve({
      sections: [section("stale", "Stale")],
      endCursor: "stale",
      hasNextPage: false,
    })
    await act(async () => pending.promise)
    expect(container.querySelector('[data-title="Stale"]')).toBeNull()
  })

  it("keeps nine rows mounted before activating windowing", async () => {
    loadPage.mockResolvedValue({
      sections: Array.from({ length: 9 }, (_, index) =>
        section(`row-${index + 1}`, `Row ${index + 1}`),
      ),
      endCursor: "done",
      hasNextPage: false,
    } satisfies DynamicCollectionFeedPage)
    await act(async () => {
      root.render(
        <DynamicMediaCollection
          data={{ title: "Explore" }}
          locale="en"
          languageSlug="english"
        />,
      )
    })

    await intersect()

    expect(
      container.querySelectorAll('[data-window-state="mounted"]'),
    ).toHaveLength(9)
    expect(container.querySelector('[data-window-state="shell"]')).toBeNull()
    expect(
      intersectionObservers.filter(
        (observer) => observer.rootMargin.split(" ").length === 3,
      ),
    ).toHaveLength(0)
  })

  it("unmounts measured distant rows into exact-height shells and remounts them on focus", async () => {
    loadPage.mockResolvedValue({
      sections: Array.from({ length: 12 }, (_, index) =>
        section(`row-${index + 1}`, `Row ${index + 1}`),
      ),
      endCursor: "done",
      hasNextPage: false,
    } satisfies DynamicCollectionFeedPage)
    await act(async () => {
      root.render(
        <DynamicMediaCollection
          data={{ title: "Explore" }}
          locale="en"
          languageSlug="english"
        />,
      )
    })
    await intersect()
    await observeRows(
      Array.from({ length: 10 }, (_, index) => `row-${index + 1}`),
    )
    expect(
      container.querySelectorAll('[data-window-state="mounted"]'),
    ).toHaveLength(12)
    await measureMountedRows(0)
    expect(
      container.querySelectorAll('[data-window-state="mounted"]'),
    ).toHaveLength(12)

    const focusedCard = container.querySelector<HTMLButtonElement>(
      '[data-collection-id="row-12"] button',
    )
    act(() => focusedCard?.focus())
    await measureMountedRows(240)
    expect(document.activeElement).toBe(focusedCard)
    expect(
      container.querySelectorAll('[data-window-state="mounted"]'),
    ).toHaveLength(11)

    const outside = document.createElement("button")
    document.body.appendChild(outside)
    act(() => outside.focus())

    const shell = container.querySelector<HTMLDivElement>(
      '[data-collection-id="row-12"]',
    )
    expect(shell?.dataset.windowState).toBe("shell")
    expect(shell?.style.height).toBe("240px")
    expect(shell?.getAttribute("tabindex")).toBe("0")
    expect(shell?.getAttribute("aria-label")).toBe(
      "Row 12, collection 12 of 12",
    )

    act(() => shell?.focus())
    expect(document.activeElement).toBe(shell)
    expect(shell?.dataset.windowState).toBe("mounted")
    expect(shell?.querySelector('[data-title="Row 12"]')).not.toBeNull()
    expect(
      container.querySelectorAll('[data-window-state="mounted"]'),
    ).toHaveLength(11)

    act(() => outside.focus())
    expect(shell?.dataset.windowState).toBe("shell")
    outside.remove()
  })

  it("persists a selected snap across shell restoration", async () => {
    loadPage.mockResolvedValue({
      sections: Array.from({ length: 12 }, (_, index) =>
        section(`row-${index + 1}`, `Row ${index + 1}`),
      ),
      endCursor: "done",
      hasNextPage: false,
    } satisfies DynamicCollectionFeedPage)
    await act(async () => {
      root.render(
        <DynamicMediaCollection
          data={{ title: "Explore" }}
          locale="en"
          languageSlug="english"
        />,
      )
    })
    await intersect()
    const firstCard = container.querySelector<HTMLButtonElement>(
      '[data-collection-id="row-1"] button',
    )
    act(() => firstCard?.click())
    await measureMountedRows()
    await observeRows(
      Array.from({ length: 10 }, (_, index) => `row-${index + 2}`),
    )

    const firstRow = container.querySelector<HTMLDivElement>(
      '[data-collection-id="row-1"]',
    )
    expect(firstRow?.dataset.windowState).toBe("shell")
    act(() => firstRow?.focus())
    expect(
      firstRow
        ?.querySelector('[data-title="Row 1"]')
        ?.getAttribute("data-initial-snap"),
    ).toBe("7")
  })

  it("caps thirty measured rows at ten while resize keeps distant shell heights provisional", async () => {
    loadPage.mockResolvedValue({
      sections: Array.from({ length: 30 }, (_, index) =>
        section(`row-${index + 1}`, `Row ${index + 1}`),
      ),
      endCursor: "done",
      hasNextPage: false,
    } satisfies DynamicCollectionFeedPage)
    await act(async () => {
      root.render(
        <DynamicMediaCollection
          data={{ title: "Explore" }}
          locale="en"
          languageSlug="english"
        />,
      )
    })
    await intersect()
    await measureMountedRows(240)
    await observeRows(
      Array.from({ length: 10 }, (_, index) => `row-${index + 1}`),
    )
    expect(
      container.querySelectorAll('[data-window-state="mounted"]'),
    ).toHaveLength(10)

    await act(async () => {
      window.dispatchEvent(new Event("resize"))
      await new Promise<void>((resolve) =>
        window.requestAnimationFrame(() => resolve()),
      )
    })
    const distant = container.querySelector<HTMLDivElement>(
      '[data-collection-id="row-30"]',
    )
    expect(distant?.dataset.heightState).toBe("provisional")
    expect(distant?.style.height).toBe("240px")
    expect(
      container.querySelectorAll('[data-window-state="mounted"]'),
    ).toHaveLength(10)

    await measureMountedRows(300)
    expect(distant?.dataset.heightState).toBe("provisional")
    expect(distant?.style.height).toBe("240px")
    expect(
      container.querySelectorAll('[data-window-state="mounted"]'),
    ).toHaveLength(10)

    act(() => root.unmount())
    expect(resizeDisconnect).toHaveBeenCalled()
    expect(
      intersectionObservers.every(
        (observer) => observer.disconnect.mock.calls.length > 0,
      ),
    ).toBe(true)
  })

  it("announces the exhausted feed without showing it, even when the last page appended collections", async () => {
    loadPage.mockResolvedValue({
      sections: [section("only", "Only")],
      endCursor: "only",
      hasNextPage: false,
    } satisfies DynamicCollectionFeedPage)

    await act(async () => {
      root.render(
        <DynamicMediaCollection
          data={{ title: "Explore" }}
          locale="en"
          languageSlug="english"
        />,
      )
    })
    await intersect()

    // The discriminating case: the loader's "Loaded N more collections."
    // branch wins over its end-of-library branch whenever the final page
    // appended something, so an implementation that reused the live-message
    // state would announce the wrong sentence here and pass everywhere else.
    //
    // The sentence is spelled out rather than compared against
    // FEED_EXHAUSTED_MESSAGE on purpose: production and the oracle would
    // otherwise be the same value, and editing the constant to any other
    // string — "Loading more collections…" included — would keep this green.
    expect(sentinelMessage()?.textContent).toBe(
      "You’ve reached the end of the collection library.",
    )
    expect(sentinelMessageIsScreenReaderOnly()).toBe(true)
    expect(feedSentinel().getAttribute("aria-live")).toBe("polite")
    expect(sentinelSpacingClasses()).toEqual([])
  })

  it("keeps the loading line visible and the sentinel spaced while pages remain", async () => {
    const pending = deferred<DynamicCollectionFeedPage>()
    loadPage.mockReturnValueOnce(pending.promise)

    await act(async () => {
      root.render(
        <DynamicMediaCollection
          data={{ title: "Explore" }}
          locale="en"
          languageSlug="english"
        />,
      )
    })
    await intersect()

    expect(sentinelMessage()?.textContent).toBe("Loading more collections…")
    expect(sentinelMessageIsScreenReaderOnly()).toBe(false)
    expect(sentinelSpacingClasses()).toEqual(["min-h-28", "py-8"])

    await act(async () => {
      pending.resolve({
        sections: [section("first", "First")],
        endCursor: "cursor-1",
        hasNextPage: true,
      })
    })
    expect(sentinelSpacingClasses()).toEqual(["min-h-28", "py-8"])
  })

  it("keeps the sentinel spaced for the retry button and shows no end notice on failure", async () => {
    loadPage.mockRejectedValue(new Error("boom"))

    await act(async () => {
      root.render(
        <DynamicMediaCollection
          data={{ title: "Explore" }}
          locale="en"
          languageSlug="english"
        />,
      )
    })
    await intersect()

    expect(feedSentinel().querySelector("button")).toBeTruthy()
    expect(sentinelMessage()).toBeNull()
    expect(container.textContent).not.toContain(FEED_EXHAUSTED_MESSAGE)
    expect(sentinelSpacingClasses()).toEqual(["min-h-28", "py-8"])
  })

  it("re-arms the sentinel when the feed identity changes after exhaustion", async () => {
    loadPage.mockResolvedValue({
      sections: [section("only", "Only")],
      endCursor: "only",
      hasNextPage: false,
    } satisfies DynamicCollectionFeedPage)

    await act(async () => {
      root.render(
        <DynamicMediaCollection
          data={{ title: "Explore" }}
          locale="en"
          languageSlug="english"
        />,
      )
    })
    await intersect()

    const exhausted = feedSentinel()
    expect(sentinelSpacingClasses()).toEqual([])
    loadPage.mockClear()

    await act(async () => {
      root.render(
        <DynamicMediaCollection
          data={{ title: "Explore" }}
          locale="fr"
          languageSlug="french"
        />,
      )
    })

    // Same element, restyled — not unmounted and remounted. The observer
    // effect re-observes `sentinelRef.current`, so losing the node would
    // silently stop paging on the new locale.
    expect(feedSentinel()).toBe(exhausted)
    expect(sentinelSpacingClasses()).toEqual(["min-h-28", "py-8"])

    // Both halves matter, and neither implies the other: the live observer
    // must actually hold the sentinel, and driving it must resume paging on
    // the new locale. Asserting that *some* observer holds the sentinel would
    // pass on the disconnected one from before exhaustion.
    expect(latestSentinelObserver().observed.has(exhausted)).toBe(true)

    await intersectLatestSentinel()
    expect(loadPage).toHaveBeenCalledWith(
      expect.objectContaining({ locale: "fr", languageSlug: "french" }),
      expect.anything(),
    )
  })
})
