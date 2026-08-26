/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./LanguageGlobe", () => ({
  LanguageGlobe: ({ layout }: { layout: string }) => (
    <div data-layout={layout} data-testid="language-globe-canvas" />
  ),
}))

import { DeferredLanguageGlobe } from "./DeferredLanguageGlobe"

let container: HTMLDivElement
let root: Root
let intersectionCallback: IntersectionObserverCallback | null

beforeEach(() => {
  intersectionCallback = null
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)

  class IntersectionObserverMock {
    constructor(callback: IntersectionObserverCallback) {
      intersectionCallback = callback
    }

    disconnect() {}
    observe() {}
    takeRecords() {
      return []
    }
    unobserve() {}
    readonly root = null
    readonly rootMargin = "360px"
    readonly thresholds = [0]
  }

  vi.stubGlobal("IntersectionObserver", IntersectionObserverMock)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe("DeferredLanguageGlobe", () => {
  it("does not mount the heavy globe until its viewport gate intersects", async () => {
    await act(async () => {
      root.render(<DeferredLanguageGlobe />)
    })

    expect(
      container.querySelector('[data-testid="language-globe-canvas"]'),
    ).toBeNull()

    await act(async () => {
      intersectionCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      )
      await Promise.resolve()
    })

    expect(
      container
        .querySelector('[data-testid="language-globe-canvas"]')
        ?.getAttribute("data-layout"),
    ).toBe("embedded")
  })

  it("loads immediately for above-fold not-found usage", async () => {
    await act(async () => {
      root.render(<DeferredLanguageGlobe loadImmediately />)
      await Promise.resolve()
    })

    expect(
      container.querySelector('[data-testid="language-globe-canvas"]'),
    ).not.toBeNull()
  })
})
