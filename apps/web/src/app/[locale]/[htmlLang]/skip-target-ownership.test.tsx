/**
 * @vitest-environment jsdom
 */

import { act, isValidElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { setRequestLocale } from "next-intl/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

vi.mock("@/lib/search-actions", () => ({
  recordWatchSearchResultClick: vi.fn(async () => ({ ok: true })),
  recordWatchSearchResultsViewed: vi.fn(async () => ({ ok: true })),
}))

vi.mock("@/lib/watch-search-client", () => ({
  fetchWatchSearchSuggestions: vi.fn(),
  searchWatchDirect: vi.fn(),
  watchSearchErrorKind: vi.fn(() => "unknown"),
}))

vi.mock("@/components/watch/GlobalLanguagePickerModal", () => ({
  GlobalLanguagePickerModal: () => null,
}))

vi.mock("@/components/DatadogRum", () => ({
  default: () => null,
  reportDatadogRumError: vi.fn(),
}))

vi.mock("@/components/sections/LanguageGlobe", () => ({
  LanguageGlobe: () => <div data-testid="language-globe-canvas" />,
}))

import { FloatingSearchProvider } from "@/components/FloatingSearchProvider"
import { WatchNotFound } from "@/components/WatchNotFound"
import { WATCH_MAIN_CONTENT_ID } from "@/lib/watch-main-content"

import WatchLocaleError from "./error"
import NotFound from "./not-found"
import WatchPageError from "./[...rest]/error"

const targetSelector = `#${WATCH_MAIN_CONTENT_ID}`

// The root layout renders one skip link to `#watch-main-content`. Exactly one
// element per page must own that id: the FloatingSearchProvider wrapper on shell
// pages, or the page's own <main> on the fallbacks that render outside the shell.
describe("skip-link target ownership", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it("is owned once by the shell wrapper, not by a page <main>", () => {
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <main>Watch page</main>
        </FloatingSearchProvider>,
      )
    })

    const targets = container.querySelectorAll(targetSelector)
    expect(targets).toHaveLength(1)
    expect(targets[0]?.tagName).toBe("DIV")
    expect(targets[0]?.getAttribute("tabindex")).toBe("-1")
    expect(targets[0]?.contains(container.querySelector("main"))).toBe(true)
  })

  it("lets the root not-found <main> own the target outside the shell", () => {
    const element = NotFound()
    expect(isValidElement(element)).toBe(true)
    expect(element.type).toBe(WatchNotFound)
    expect(element.props).toMatchObject({ ownsMainTarget: true })

    act(() => {
      root.render(element)
    })

    const targets = container.querySelectorAll(targetSelector)
    expect(targets).toHaveLength(1)
    expect(targets[0]?.tagName).toBe("MAIN")
    expect(targets[0]?.getAttribute("tabindex")).toBe("-1")
  })

  it("does not let a bare WatchNotFound claim the target", () => {
    act(() => {
      root.render(<WatchNotFound />)
    })

    expect(container.querySelector("main")).not.toBeNull()
    expect(container.querySelectorAll(targetSelector)).toHaveLength(0)
  })

  it("does not duplicate the target when WatchNotFound renders inside the shell", () => {
    act(() => {
      root.render(
        <FloatingSearchProvider>
          <WatchNotFound />
        </FloatingSearchProvider>,
      )
    })

    expect(container.querySelectorAll(targetSelector)).toHaveLength(1)
    expect(container.querySelector(targetSelector)?.tagName).toBe("DIV")
  })

  it("lets the root error <main> own the target outside the shell", () => {
    setRequestLocale("en")
    const html = renderToString(
      <WatchLocaleError error={new Error("boom")} reset={() => {}} />,
    )
    container.innerHTML = html

    const targets = container.querySelectorAll(targetSelector)
    expect(targets).toHaveLength(1)
    expect(targets[0]?.tagName).toBe("MAIN")
    expect(targets[0]?.getAttribute("tabindex")).toBe("-1")
  })

  it("keeps the [...rest] error boundary off the target because its shell owns it", () => {
    setRequestLocale("en")
    container.innerHTML = renderToString(
      <WatchPageError error={new Error("boom")} reset={() => {}} />,
    )

    expect(container.querySelector("main")).not.toBeNull()
    expect(container.querySelectorAll(targetSelector)).toHaveLength(0)
  })
})
