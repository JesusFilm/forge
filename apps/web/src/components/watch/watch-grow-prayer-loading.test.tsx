// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

let prayerImports: number
let release: () => void
let pending: Promise<void>

beforeEach(() => {
  vi.resetModules()
  prayerImports = 0
  pending = new Promise<void>((resolve) => {
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
afterEach(() => {
  release()
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
