/** @vitest-environment jsdom */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  useEligibleRecommendationImpression,
  type ExposureVisibilityCapability,
} from "./useEligibleRecommendationImpression"

let callback: IntersectionObserverCallback
let options: IntersectionObserverInit
let visibility: DocumentVisibilityState
const observe = vi.fn()
const unobserve = vi.fn()
class TestObserver implements IntersectionObserver {
  readonly root = null
  readonly rootMargin = "0px"
  readonly thresholds = [0.5]
  constructor(
    next: IntersectionObserverCallback,
    init?: IntersectionObserverInit,
  ) {
    callback = next
    options = init ?? {}
  }
  observe = observe
  unobserve = unobserve
  disconnect = vi.fn()
  takeRecords() {
    return []
  }
}

function Harness({
  item = "one",
  onEligible,
}: {
  item?: string
  onEligible: (id: string, capability: ExposureVisibilityCapability) => void
}) {
  const attach = useEligibleRecommendationImpression({
    envelopeKey: "window-one",
    onEligible,
  })
  return createElement("a", {
    key: item,
    href: "/watch/test.html",
    ref: (node: HTMLAnchorElement | null) => attach(item, node),
  })
}

function intersect(node: Element, ratio: number, isVisible?: boolean) {
  act(() =>
    callback(
      [
        {
          target: node,
          isIntersecting: ratio > 0,
          intersectionRatio: ratio,
          isVisible,
        } as unknown as IntersectionObserverEntry,
      ],
      {} as IntersectionObserver,
    ),
  )
}

describe("Watch eligible exposure primitive", () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    vi.useFakeTimers()
    observe.mockClear()
    unobserve.mockClear()
    visibility = "visible"
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    })
    vi.stubGlobal("IntersectionObserver", TestObserver)
    vi.stubGlobal("IntersectionObserverEntry", undefined)
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

  it("requires continuous half-card dwell in a visible tab and deduplicates repeats", () => {
    const onEligible = vi.fn()
    act(() => root.render(createElement(Harness, { onEligible })))
    const card = container.querySelector("a")!
    intersect(card, 0.49)
    act(() => vi.advanceTimersByTime(1200))
    expect(onEligible).not.toHaveBeenCalled()
    intersect(card, 0.5)
    act(() => vi.advanceTimersByTime(500))
    visibility = "hidden"
    act(() => document.dispatchEvent(new Event("visibilitychange")))
    act(() => vi.advanceTimersByTime(1200))
    expect(onEligible).not.toHaveBeenCalled()
    visibility = "visible"
    act(() => document.dispatchEvent(new Event("visibilitychange")))
    act(() => vi.advanceTimersByTime(1000))
    expect(onEligible).toHaveBeenCalledExactlyOnceWith("one", "unknown")
    intersect(card, 0)
    intersect(card, 0.5)
    act(() => vi.advanceTimersByTime(1000))
    expect(onEligible).toHaveBeenCalledTimes(1)
  })

  it("uses occlusion-aware visibility only when supported", () => {
    vi.stubGlobal(
      "IntersectionObserverEntry",
      class {
        get isVisible() {
          return false
        }
      },
    )
    const onEligible = vi.fn()
    act(() => root.render(createElement(Harness, { onEligible })))
    expect(options).toMatchObject({ trackVisibility: true, delay: 100 })
    const card = container.querySelector("a")!
    intersect(card, 0.7, false)
    act(() => vi.advanceTimersByTime(1000))
    expect(onEligible).not.toHaveBeenCalled()
    intersect(card, 0.7, true)
    act(() => vi.advanceTimersByTime(1000))
    expect(onEligible).toHaveBeenCalledExactlyOnceWith("one", "occlusion-aware")
  })

  it("resets dwell on responsive node replacement", () => {
    const onEligible = vi.fn()
    act(() => root.render(createElement(Harness, { onEligible })))
    intersect(container.querySelector("a")!, 0.5)
    act(() => vi.advanceTimersByTime(600))
    act(() => root.render(createElement(Harness, { item: "two", onEligible })))
    expect(unobserve).toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1000))
    expect(onEligible).not.toHaveBeenCalled()
    intersect(container.querySelector("a")!, 0.5)
    act(() => vi.advanceTimersByTime(1000))
    expect(onEligible).toHaveBeenCalledExactlyOnceWith("two", "unknown")
  })
})
