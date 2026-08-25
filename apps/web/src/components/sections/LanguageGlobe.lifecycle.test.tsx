/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { LanguageGlobe } from "./LanguageGlobe"

let container: HTMLDivElement
let root: Root
let mounted: boolean

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  mounted = true
})

afterEach(() => {
  if (mounted) act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("LanguageGlobe lifecycle", () => {
  it("starts only when visible and releases animation resources", () => {
    const context = Object.fromEntries(
      [
        "beginPath",
        "clip",
        "ellipse",
        "fillRect",
        "fillText",
        "rect",
        "restore",
        "save",
        "setLineDash",
        "setTransform",
        "stroke",
      ].map((method) => [method, vi.fn()]),
    ) as unknown as CanvasRenderingContext2D
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context)

    let nextFrame = 0
    const requestAnimationFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation(() => ++nextFrame)
    const cancelAnimationFrame = vi.spyOn(window, "cancelAnimationFrame")

    let reducedMotion = false
    const motionListeners = new Set<() => void>()
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        get matches() {
          return reducedMotion
        },
        media: "(prefers-reduced-motion: reduce)",
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: (_type: string, listener: () => void) =>
          motionListeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) =>
          motionListeners.delete(listener),
        dispatchEvent: vi.fn(),
      })),
    )

    let intersectionCallback: IntersectionObserverCallback | undefined
    const intersectionDisconnect = vi.fn()
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          intersectionCallback = callback
        }
        observe = vi.fn()
        unobserve = vi.fn()
        disconnect = intersectionDisconnect
        takeRecords = vi.fn(() => [])
        root = null
        rootMargin = "120px"
        thresholds = [0]
      },
    )

    const resizeDisconnect = vi.fn()
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe = vi.fn()
        unobserve = vi.fn()
        disconnect = resizeDisconnect
      },
    )

    let documentVisible = true
    vi.spyOn(document, "readyState", "get").mockReturnValue("complete")
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() =>
      documentVisible ? "visible" : "hidden",
    )

    act(() => root.render(<LanguageGlobe />))
    expect(requestAnimationFrame).not.toHaveBeenCalled()

    act(() => {
      intersectionCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      )
    })
    expect(requestAnimationFrame).toHaveBeenLastCalledWith(expect.any(Function))
    expect(nextFrame).toBe(1)

    reducedMotion = true
    act(() => motionListeners.forEach((listener) => listener()))
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1)

    reducedMotion = false
    act(() => motionListeners.forEach((listener) => listener()))
    expect(nextFrame).toBe(2)

    documentVisible = false
    act(() => document.dispatchEvent(new Event("visibilitychange")))
    expect(cancelAnimationFrame).toHaveBeenCalledWith(2)

    documentVisible = true
    act(() => document.dispatchEvent(new Event("visibilitychange")))
    expect(nextFrame).toBe(3)

    act(() => root.unmount())
    mounted = false
    expect(cancelAnimationFrame).toHaveBeenCalledWith(3)
    expect(intersectionDisconnect).toHaveBeenCalledOnce()
    expect(resizeDisconnect).toHaveBeenCalledOnce()
    expect(motionListeners).toHaveLength(0)
  })
})
