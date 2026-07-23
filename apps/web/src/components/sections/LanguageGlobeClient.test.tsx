/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { LanguageGlobeClient } from "./LanguageGlobeClient"
import type { LanguageGlobeEntry } from "./language-globe-model"

const orbitState = vi.hoisted(() => ({
  lifecycle: "ready" as "ready" | "pending" | "failed",
  props: null as null | Record<string, unknown>,
}))

vi.mock("./EarthLanguageOrbitCanvas", async () => {
  const { useEffect } = await import("react")
  return {
    EarthLanguageOrbitCanvas: (props: {
      onReady: () => void
      onFailure: (reason: "render-error") => void
    }) => {
      orbitState.props = props
      const { onFailure, onReady } = props
      useEffect(() => {
        if (orbitState.lifecycle === "ready") onReady()
        if (orbitState.lifecycle === "failed") onFailure("render-error")
      }, [onFailure, onReady])
      return <div data-mock-language-orbit-canvas />
    },
  }
})

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  orbitState.lifecycle = "ready"
  orbitState.props = null
  Object.defineProperty(document, "readyState", {
    configurable: true,
    value: "complete",
  })
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  })
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
  Object.defineProperty(window, "requestIdleCallback", {
    configurable: true,
    writable: true,
    value: (callback: IdleRequestCallback) => {
      callback({ didTimeout: false, timeRemaining: () => 50 })
      return 1
    },
  })
  Object.defineProperty(window, "cancelIdleCallback", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  })
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private callback: IntersectionObserverCallback) {}
      observe() {
        this.callback(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        )
      }
      unobserve() {}
      disconnect() {}
    },
  )
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  )
})

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
  }
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
  container?.remove()
  container = null
  root = null
})

async function renderGlobe(
  languages: LanguageGlobeEntry[],
  metadataUnavailable = false,
) {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      <LanguageGlobeClient
        sectionKey="language-globe"
        heading="Explore"
        description="Pick a language"
        backgroundColor="#071526"
        languages={languages}
        metadataUnavailable={metadataUnavailable}
      />,
    )
    await Promise.resolve()
    await Promise.resolve()
  })
  return container
}

const spanish: LanguageGlobeEntry = {
  id: "spanish",
  nativeLabel: "Español",
  englishLabel: "Spanish",
  href: "/spanish.html/videos",
  latitude: null,
  longitude: null,
}

function numberedLanguage(index: number): LanguageGlobeEntry {
  return {
    id: `language-${index}`,
    nativeLabel: `Native ${index}`,
    englishLabel: `Language ${index}`,
    href: `/language-${index}.html/videos`,
    latitude: null,
    longitude: null,
  }
}

describe("LanguageGlobeClient", () => {
  it("keeps native-first canonical links outside the decorative canvas", async () => {
    const html = await renderGlobe([spanish])
    const semanticLink = html.querySelector(
      'a[data-globe-language-link][href="/spanish.html/videos"]',
    )

    expect(semanticLink?.textContent?.indexOf("Español")).toBeLessThan(
      semanticLink?.textContent?.indexOf("Spanish") ?? -1,
    )
    expect(semanticLink?.getAttribute("tabindex")).toBeNull()
    expect(html.querySelector("[data-language-orbit-links]")).not.toBeNull()
    expect(html.querySelector("[data-globe-language-marker]")).toBeNull()
    expect(html.querySelector("section")?.dataset.sectionKey).toBe(
      "language-globe",
    )
  })

  it("loads the scene after the idle boundary and reveals it only when ready", async () => {
    const html = await renderGlobe([spanish])

    expect(
      html.querySelector("[data-mock-language-orbit-canvas]"),
    ).not.toBeNull()
    expect(html.querySelector("section")?.dataset.globeReady).toBe("true")
    expect(html.textContent).toContain("Pause orbit")
    expect(orbitState.props).toMatchObject({
      active: true,
      paused: false,
      reducedMotionOverride: false,
    })
  })

  it("defers the 3D engine until the block approaches the viewport", async () => {
    let intersectionCallback: IntersectionObserverCallback | null = null
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          intersectionCallback = callback
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    const html = await renderGlobe([spanish])

    expect(html.querySelector("[data-mock-language-orbit-canvas]")).toBeNull()

    await act(async () => {
      intersectionCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(
      html.querySelector("[data-mock-language-orbit-canvas]"),
    ).not.toBeNull()
  })

  it("exposes a keyboard-accessible pause control for the ready orbit", async () => {
    const html = await renderGlobe([spanish])
    const button = Array.from(html.querySelectorAll("button")).find((node) =>
      node.textContent?.includes("Pause orbit"),
    )

    expect(button?.getAttribute("aria-pressed")).toBe("false")
    act(() => button?.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    expect(button?.textContent).toContain("Resume orbit")
    expect(button?.getAttribute("aria-pressed")).toBe("true")
  })

  it("uses a calm static composition when reduced motion is requested", async () => {
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))

    const html = await renderGlobe([spanish])
    const button = Array.from(html.querySelectorAll("button")).find((node) =>
      node.textContent?.includes("Reduced motion"),
    )
    expect(button?.getAttribute("aria-pressed")).toBe("true")
    expect(button?.hasAttribute("disabled")).toBe(true)
    expect(orbitState.props).toMatchObject({ reducedMotionOverride: true })
  })

  it("keeps the fallback and semantic links while the scene is loading", async () => {
    orbitState.lifecycle = "pending"
    const html = await renderGlobe([spanish])

    expect(html.querySelector("section")?.dataset.globeReady).toBe("false")
    expect(html.textContent).toContain("Loading the interactive 3D Earth")
    expect(html.querySelector("[data-language-orbit-fallback]")).not.toBeNull()
    expect(html.querySelector("[data-globe-language-link]")).not.toBeNull()
    expect(html.querySelector("button")).toBeNull()
  })

  it("contains renderer failure to a terminal authored fallback", async () => {
    orbitState.lifecycle = "failed"
    const html = await renderGlobe([spanish])

    expect(html.querySelector("section")?.dataset.globeFailed).toBe("true")
    expect(html.textContent).toContain("interactive Earth is unavailable")
    expect(html.querySelector("[data-mock-language-orbit-canvas]")).toBeNull()
    expect(html.querySelector("[data-globe-language-link]")).not.toBeNull()
  })

  it("contains a stalled scene in the terminal authored fallback", async () => {
    vi.useFakeTimers()
    orbitState.lifecycle = "pending"
    const html = await renderGlobe([spanish])

    await act(async () => {
      vi.advanceTimersByTime(1_200)
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      vi.advanceTimersByTime(15_000)
      await Promise.resolve()
    })

    expect(html.querySelector("section")?.dataset.globeFailed).toBe("true")
    expect(html.textContent).toContain("interactive Earth is unavailable")
    expect(html.querySelector("[data-globe-language-link]")).not.toBeNull()
  })

  it("contains metadata failures inside the block", async () => {
    const html = await renderGlobe([], true)
    expect(html.textContent).toContain("Explore")
    expect(html.textContent).toContain("temporarily unavailable")
    expect(html.querySelector("[data-language-orbit-canvas]")).toBeNull()
  })

  it("bounds the decorative orbit without truncating semantic links", async () => {
    const html = await renderGlobe(
      Array.from({ length: 16 }, (_, index) => numberedLanguage(index)),
    )

    expect(html.querySelectorAll("[data-globe-language-link]")).toHaveLength(16)
    expect(
      (orbitState.props?.languages as LanguageGlobeEntry[] | undefined)?.length,
    ).toBe(12)
  })
})
