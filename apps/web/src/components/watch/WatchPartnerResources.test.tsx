/**
 * @vitest-environment jsdom
 */

import { act, createElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/image", () => ({
  default: ({ fill: _fill, ...props }: Record<string, unknown>) =>
    createElement("img", props),
}))
vi.mock("@/components/ui/carousel", () => {
  const pass = (tag: string) =>
    function Pass({
      children,
      opts: _opts,
      label: _label,
      ...props
    }: Record<string, unknown> & { children?: ReactNode }) {
      return createElement(tag, props, children)
    }
  return {
    Carousel: pass("div"),
    CarouselContent: pass("div"),
    CarouselItem: pass("div"),
    CarouselPrevious: () => null,
    CarouselNext: () => null,
  }
})

import { WATCH_PARTNER_RESOURCES } from "@/lib/watch-partner-resources"

import { PARTNER_RESOURCES } from "./partner-resources"
import { WatchPartnerResources } from "./WatchPartnerResources"

let container: HTMLDivElement
let root: Root
const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe("partner-resources adapter", () => {
  it("carries every verified record, with its real page, PDF and summary", () => {
    expect(PARTNER_RESOURCES).toHaveLength(WATCH_PARTNER_RESOURCES.length)
    for (const r of PARTNER_RESOURCES) {
      const verified = WATCH_PARTNER_RESOURCES.find((v) => v.id === r.id)!
      expect(r.href).toBe(verified.destination)
      expect(r.pdf).toBe(verified.pdf)
      expect(r.summary).toBe(verified.summary)
      expect(r.image).toMatch(
        /^https:\/\/www\.jesusfilm\.org\/wp-content\/uploads\//,
      )
    }
  })
})

describe("WatchPartnerResources (original presentation)", () => {
  it("renders the PDF rail, the filterable toolkit and prayer guides with no account request", () => {
    act(() => root.render(<WatchPartnerResources />))
    const pdfs = container.querySelectorAll(
      "[data-testid=watch-partner-pdfs] a",
    )
    expect(pdfs).toHaveLength(PARTNER_RESOURCES.filter((r) => r.pdf).length)
    for (const a of pdfs) expect(a.getAttribute("href")).toMatch(/\.pdf$/)
    expect(
      container.querySelectorAll("[data-testid=watch-partner-grid] li"),
    ).toHaveLength(PARTNER_RESOURCES.length)
    expect(container.textContent).toContain("Monthly prayer guides")
    expect(fetchMock).not.toHaveBeenCalled()
    for (const a of container.querySelectorAll("a"))
      expect(a.getAttribute("href")).not.toBe("#")
  })

  it("filters the toolkit by kind", () => {
    act(() => root.render(<WatchPartnerResources />))
    const tab = [
      ...container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ].find((b) => b.textContent?.startsWith("Equipment"))!
    act(() => tab.click())
    expect(tab.getAttribute("aria-selected")).toBe("true")
    expect(
      container.querySelectorAll("[data-testid=watch-partner-grid] li"),
    ).toHaveLength(
      PARTNER_RESOURCES.filter((r) => r.kind === "Equipment").length,
    )
  })
})
