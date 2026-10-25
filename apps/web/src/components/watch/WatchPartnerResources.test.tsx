/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  WATCH_PARTNER_RESOURCE_CATEGORIES,
  WATCH_PARTNER_RESOURCES,
} from "@/lib/watch-partner-resources"

import { WatchPartnerResources } from "./WatchPartnerResources"

let container: HTMLDivElement
let root: Root
let fetchMock: ReturnType<typeof vi.fn>

function render() {
  act(() => root.render(<WatchPartnerResources />))
}

function cards() {
  return [...container.querySelectorAll<HTMLElement>("[data-resource-id]")]
}

function card(id: string) {
  return container.querySelector<HTMLElement>(`[data-resource-id="${id}"]`)!
}

function filter(label: string) {
  return [
    ...container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"),
  ].find((el) => el.textContent?.startsWith(label))!
}

beforeEach(() => {
  fetchMock = vi.fn()
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

describe("WatchPartnerResources", () => {
  it("lists the whole public library with no sign-in and no account request", () => {
    render()

    expect(cards().map((el) => el.dataset.resourceId)).toEqual(
      WATCH_PARTNER_RESOURCES.map(({ id }) => id),
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(container.textContent).not.toMatch(/sign in|unlock/i)
  })

  it("states each resource's category, source language and source date", () => {
    render()
    const first = WATCH_PARTNER_RESOURCES[0]!
    const text = card(first.id).textContent!

    expect(text).toContain(first.title)
    expect(text).toContain(first.summary)
    expect(text).toContain("English")
    expect(text).toContain("Sep 15, 2026")
    const category = WATCH_PARTNER_RESOURCE_CATEGORIES.find(
      ({ id }) => id === first.category,
    )!
    expect(text).toContain(category.label)
  })

  it("filters by category and back, and says how many it is showing", () => {
    render()
    const training = WATCH_PARTNER_RESOURCES.filter(
      ({ category }) => category === "training",
    )

    act(() => filter("Training").click())

    expect(cards().map((el) => el.dataset.resourceId)).toEqual(
      training.map(({ id }) => id),
    )
    expect(filter("Training").getAttribute("aria-pressed")).toBe("true")
    expect(filter("All").getAttribute("aria-pressed")).toBe("false")
    expect(
      container.querySelector('[data-testid="watch-partner-result-count"]')!
        .textContent,
    ).toBe(`Showing ${training.length} of ${WATCH_PARTNER_RESOURCES.length}`)

    act(() => filter("All").click())
    expect(cards()).toHaveLength(WATCH_PARTNER_RESOURCES.length)
  })

  it("links a resource with a PDF to both its page and the PDF, as external noopener links", () => {
    render()
    const withPdf = WATCH_PARTNER_RESOURCES.find(({ pdf }) => pdf)!
    const links = [...card(withPdf.id).querySelectorAll("a")]

    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      [`View source page: ${withPdf.title}`, withPdf.destination],
      [`Open PDF: ${withPdf.title}`, withPdf.pdf],
    ])
    for (const a of links) {
      expect(a.getAttribute("target")).toBe("_blank")
      expect(a.getAttribute("rel")).toBe("noopener noreferrer")
    }
  })

  it("shows only the source page, never a false download, when a resource has no PDF", () => {
    render()
    const withoutPdf = WATCH_PARTNER_RESOURCES.find(({ pdf }) => !pdf)!
    const links = [...card(withoutPdf.id).querySelectorAll("a")]

    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      withoutPdf.destination,
    ])
    expect(card(withoutPdf.id).textContent).not.toMatch(/pdf|download/i)
    expect(card(withoutPdf.id).querySelector("[download]")).toBeNull()
  })

  it("never turns a resource link into a same-origin download or a proxied URL", () => {
    render()

    for (const a of container.querySelectorAll<HTMLAnchorElement>("a")) {
      expect(a.getAttribute("href")).toMatch(/^https:\/\/www\.jesusfilm\.org\//)
      expect(a.hasAttribute("download")).toBe(false)
    }
  })
})
