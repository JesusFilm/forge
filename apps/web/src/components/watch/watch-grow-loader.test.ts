// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

const Grow = () =>
  createElement("p", { "data-testid": "resolved-grow" }, "Grow ready")
const Course = () => null
let growImports: number
let imports: number
let release: () => void
let started: Promise<void>
let pending: Promise<void>

beforeEach(() => {
  vi.resetModules()
  growImports = 0
  imports = 0
  let markStarted: () => void
  started = new Promise<void>((resolve) => {
    markStarted = resolve
  })
  pending = new Promise<void>((resolve) => {
    release = resolve
  })
  vi.doMock("./WatchGrow", () => {
    growImports += 1
    return { WatchGrow: Grow }
  })
  vi.doMock("./WatchGrowProgressCourse", async () => {
    imports += 1
    markStarted()
    await pending
    return { WatchGrowProgressCourse: Course }
  })
})
afterEach(() => {
  release()
  vi.doUnmock("./WatchGrow")
  vi.doUnmock("./WatchGrowProgressCourse")
})

it.each(["/watch", "/watch?as=grow", "/watch?as=grow&growLesson=invalid"])(
  "does not import the course on ordinary entry %s",
  async (url) => {
    window.history.replaceState(null, "", url)
    const loader = await import("./watch-grow-loader")
    expect(await loader.loadWatchGrow()).toBe(Grow)
    expect(loader.getLoadedWatchGrowCourse()).toBeNull()
    expect(imports).toBe(0)
  },
)

it("resolves a cold lesson-return persona with its course ready, sharing one pending import", async () => {
  window.history.replaceState(null, "", "/watch?as=grow&growLesson=lesson-1")
  const loader = await import("./watch-grow-loader")
  let ready = false
  const grow = loader.loadWatchGrow().then((component) => {
    ready = true
    return component
  })
  await started
  expect(ready).toBe(false)
  expect(loader.getLoadedWatchGrowCourse()).toBeNull()
  const sameCourse = loader.loadWatchGrowCourse()
  expect(imports).toBe(1)
  release()
  expect(await grow).toBe(Grow)
  expect(await sameCourse).toBe(Course)
  expect(loader.getLoadedWatchGrowCourse()).toBe(Course)
  expect(await loader.loadWatchGrowCourse()).toBe(Course)
  expect(imports).toBe(1)
})

it("keeps Grow available when return preloading fails, allowing the course error/retry shell", async () => {
  window.history.replaceState(null, "", "/watch?as=grow&growLesson=lesson-1")
  vi.doMock("./WatchGrowProgressCourse", () => {
    throw new Error("Chunk unavailable")
  })
  const loader = await import("./watch-grow-loader")
  expect(await loader.loadWatchGrow()).toBe(Grow)
  expect(loader.getLoadedWatchGrowCourse()).toBeNull()
  await expect(loader.loadWatchGrowCourse()).rejects.toMatchObject({
    cause: { message: "Chunk unavailable" },
  })
  vi.doMock("./WatchGrowProgressCourse", () => ({
    WatchGrowProgressCourse: Course,
  }))
  expect(await loader.loadWatchGrowCourse()).toBe(Course)
})

// The browser timing regression was a lazy reveal, after chunk completion.
// Require the rendered host to commit as soon as the real loading promise
// settles, with no timer, extra suspense boundary or second loading effect.
it("commits a return's ready controls in the import-completion act turn", async () => {
  window.history.replaceState(null, "", "/watch?as=grow&growLesson=lesson-1")
  const { WatchGrowLoader } = await import("./WatchGrowLoader")
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => {
      root.render(createElement(WatchGrowLoader))
    })
    await started
    expect(container.querySelector('[data-testid="resolved-grow"]')).toBeNull()
    await act(async () => {
      release()
      await pending
    })
    expect(
      container.querySelector('[data-testid="resolved-grow"]')?.textContent,
    ).toBe("Grow ready")
  } finally {
    act(() => root.unmount())
    container.remove()
  }
})

it("starts the explicit return chunks before role hydration or host mount", async () => {
  window.history.replaceState(null, "", "/watch?as=grow&growLesson=lesson-1")
  const storage = vi.spyOn(Storage.prototype, "setItem")
  try {
    const marker = document.createElement("section")
    marker.dataset.testid = "watch-next-steps"
    document.body.append(marker)
    try {
      const loader = await import("./watch-grow-loader")
      loader.preloadWatchGrowReturn()
      await started
    } finally {
      marker.remove()
    }
    // Import initiation is observable without mounting a component or advancing
    // a timer. It must not wait for the role store's post-hydration rerender.
    expect(imports).toBe(1)
    expect(storage).not.toHaveBeenCalled()
  } finally {
    storage.mockRestore()
  }
})

it.each([
  ["/watch", true],
  ["/watch?as=grow", true],
  ["/watch?as=grow&growLesson=invalid", true],
  ["/watch?as=share&growLesson=lesson-1", true],
  ["/watch?as=grow&growLesson=lesson-1", false],
])(
  "defers module-init loading for %s (audience rendered: %s)",
  async (url, audienceRendered) => {
    window.history.replaceState(null, "", url)
    const marker = document.createElement("section")
    marker.dataset.testid = "watch-next-steps"
    if (audienceRendered) document.body.append(marker)
    try {
      const loader = await import("./watch-grow-loader")
      loader.preloadWatchGrowReturn()
      expect(growImports).toBe(0)
      expect(imports).toBe(0)
    } finally {
      marker.remove()
    }
  },
)
