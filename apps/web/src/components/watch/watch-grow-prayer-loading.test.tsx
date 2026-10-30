// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

let prayerImports: number
let release: () => void
let rejectPrayer: (error: Error) => void
let pending: Promise<void>

beforeEach(() => {
  vi.resetModules()
  prayerImports = 0
  pending = new Promise<void>((resolve, reject) => {
    rejectPrayer = reject
    release = resolve
  })
  vi.doMock("./WatchGrowPrayer", async () => {
    prayerImports += 1
    await pending
    return {
      WatchGrowPrayer: () =>
        createElement("section", { "aria-label": "Monthly prayer" }),
    }
  })
  vi.doMock("./WatchGrowProgressCourse", () => ({
    WatchGrowProgressCourse: () =>
      createElement("section", { "aria-label": "Returned lesson" }),
  }))
})
afterEach(async () => {
  await act(async () => {
    release()
    await pending.catch(() => {})
  })
  vi.doUnmock("./WatchGrowPrayer")
  vi.doUnmock("./WatchGrowProgressCourse")
})

it("keeps prayer implementation deferred when the persona module loads", async () => {
  // A static prayer import would start here, before any full-shelf intent.
  const importing = import("./WatchGrow")
  release()
  await importing
  expect(prayerImports).toBe(0)
})

it("renders the returned course independently while the optional prayer shelf loads", async () => {
  window.history.replaceState(null, "", "/watch?as=grow&growLesson=lesson-1")
  const { loadWatchGrow } = await import("./watch-grow-loader")
  const Grow = await loadWatchGrow()
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(createElement(Grow)))
    expect(
      container.querySelector('section[aria-label="Returned lesson"]'),
    ).not.toBeNull()
    expect(
      container.querySelector('section[aria-label="Monthly prayer"]'),
    ).toBeNull()
    await act(async () => {
      release()
      await pending
    })
    const course = container.querySelector(
      'section[aria-label="Returned lesson"]',
    )!
    const prayer = container.querySelector(
      'section[aria-label="Monthly prayer"]',
    )!
    expect(prayer).not.toBeNull()
    expect(
      course.compareDocumentPosition(prayer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  } finally {
    act(() => root.unmount())
    container.remove()
  }
})

it.each(["network", "render"])(
  "contains optional prayer %s failures and resets the content scope without a misleading retry",
  async (failure) => {
    window.history.replaceState(null, "", "/watch?as=grow&growLesson=lesson-1")
    document.documentElement.lang = "ar"
    document.documentElement.dir = "rtl"
    let crash = true
    if (failure === "render")
      vi.doMock("./WatchGrowPrayer", () => ({
        WatchGrowPrayer: () => {
          if (crash) throw new Error("Prayer render failed")
          return createElement("section", { "aria-label": "Monthly prayer" })
        },
      }))
    const { loadWatchGrow } = await import("./watch-grow-loader")
    const Grow = await loadWatchGrow()
    const container = document.createElement("div")
    document.body.append(container)
    const uncaught: unknown[] = []
    const root = createRoot(container, {
      onUncaughtError: (error) => uncaught.push(error),
      onCaughtError: () => {},
    })
    try {
      await act(async () =>
        root.render(createElement(Grow, { optionalContentKey: "ar:config-1" })),
      )
      if (failure === "network")
        await act(async () => {
          rejectPrayer(new Error("Prayer chunk aborted"))
          await pending.catch(() => {})
        })
      expect(uncaught).toEqual([])
      expect(
        container.querySelector('section[aria-label="Returned lesson"]'),
      ).not.toBeNull()
      const fallback = container.querySelector('[role="status"]')
      expect(fallback?.textContent).toContain("The prayer guide is unavailable")
      expect(fallback?.getAttribute("lang")).toBe("en")
      expect(fallback?.getAttribute("dir")).toBe("ltr")
      expect(container.textContent).not.toContain("Try again")
      // An ordinary rerender cannot loop a rejected lazy import.
      await act(async () =>
        root.render(createElement(Grow, { optionalContentKey: "ar:config-1" })),
      )
      expect(uncaught).toEqual([])
      crash = false
      await act(async () =>
        root.render(createElement(Grow, { optionalContentKey: "es:config-2" })),
      )
      expect(
        container.querySelector('section[aria-label="Returned lesson"]'),
      ).not.toBeNull()
      if (failure === "render") {
        expect(
          container.querySelector('section[aria-label="Monthly prayer"]'),
        ).not.toBeNull()
        expect(container.querySelector('[role="status"]')).toBeNull()
      } else {
        // React.lazy caches a rejected import; scope reset must fail locally again,
        // not promise a retry that cannot re-fetch that cached module.
        expect(
          container.querySelector('[role="status"]')?.textContent,
        ).toContain("The prayer guide is unavailable")
        expect(prayerImports).toBe(1)
      }
      expect(uncaught).toEqual([])
    } finally {
      act(() => root.unmount())
      container.remove()
      document.documentElement.lang = "en"
      document.documentElement.dir = "ltr"
    }
  },
)
