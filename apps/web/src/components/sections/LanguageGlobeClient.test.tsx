/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { LanguageGlobeClient } from "./LanguageGlobeClient"
import type { LanguageGlobeEntry } from "./language-globe-model"

const runtimeState = vi.hoisted(() => ({ ready: true }))
vi.mock("./language-globe-webgl", () => ({
  startLanguageGlobeRuntime: ({
    onReady,
  }: {
    onReady: (ready: boolean) => void
  }) => {
    onReady(runtimeState.ready)
    return { requestRender: vi.fn(), dispose: vi.fn() }
  },
}))

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  runtimeState.ready = true
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null)
})

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
  }
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
  })
  return container
}

const spanish: LanguageGlobeEntry = {
  id: "spanish",
  nativeLabel: "Español",
  englishLabel: "Spanish",
  href: "/spanish.html/videos",
  latitude: 20,
  longitude: -100,
}

function numberedLanguage(index: number): LanguageGlobeEntry {
  return {
    id: `language-${index}`,
    nativeLabel: `Native ${index}`,
    englishLabel: `Language ${index}`,
    href: `/language-${index}.html/videos`,
    latitude: index,
    longitude: index * 20,
  }
}

describe("LanguageGlobeClient", () => {
  it("keeps native-first canonical links usable independently of WebGL", async () => {
    const html = await renderGlobe([spanish])
    const semanticLink = html.querySelector(
      'nav a[href="/spanish.html/videos"]',
    )
    expect(semanticLink?.textContent?.indexOf("Español")).toBeLessThan(
      semanticLink?.textContent?.indexOf("Spanish") ?? -1,
    )
    expect(semanticLink).not.toBeNull()
    expect(html.querySelector("section")?.dataset.sectionKey).toBe(
      "language-globe",
    )
    const presentationLink = html.querySelector(
      'a[aria-hidden="true"][href="/spanish.html/videos"]',
    )
    expect(presentationLink?.getAttribute("tabindex")).toBe("-1")
  })

  it("exposes a working pause control for an animated globe", async () => {
    const html = await renderGlobe([spanish])
    const button = Array.from(html.querySelectorAll("button")).find((node) =>
      node.textContent?.includes("Pause globe"),
    )
    expect(button?.getAttribute("aria-pressed")).toBe("false")
    act(() => button?.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    expect(button?.textContent).toContain("Resume globe")
    expect(button?.getAttribute("aria-pressed")).toBe("true")
  })

  it("contains metadata failures to an authored fallback", async () => {
    const html = await renderGlobe([], true)
    expect(html.textContent).toContain("Explore")
    expect(html.textContent).toContain("temporarily unavailable")
    expect(html.querySelector("canvas")).toBeNull()
  })

  it("starts paused when reduced motion is requested", async () => {
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
      node.textContent?.includes("Resume globe"),
    )
    expect(button?.getAttribute("aria-pressed")).toBe("true")
  })

  it("limits presentation labels on mobile without removing semantic links", async () => {
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: query === "(max-width: 640px)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    const languages = Array.from({ length: 8 }, (_, index) =>
      numberedLanguage(index),
    )

    const html = await renderGlobe(languages)

    expect(html.querySelectorAll('a[aria-hidden="true"]')).toHaveLength(6)
    expect(html.querySelectorAll("nav a")).toHaveLength(8)
  })

  it("hides the animation control when the runtime falls back", async () => {
    runtimeState.ready = false
    const html = await renderGlobe([spanish])
    expect(html.querySelector("button")).toBeNull()
    expect(
      html.querySelector('nav a[href="/spanish.html/videos"]'),
    ).not.toBeNull()
  })
})
