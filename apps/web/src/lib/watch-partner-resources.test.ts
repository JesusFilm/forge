import { describe, expect, it } from "vitest"

import {
  WATCH_PARTNER_RESOURCE_CATEGORIES,
  WATCH_PARTNER_RESOURCES,
  filterWatchPartnerResources,
  watchPartnerResourceCategoryCounts,
  watchPartnerResourceLanguageLabel,
  watchPartnerResourceLinks,
  type WatchPartnerResource,
} from "./watch-partner-resources"

const CATEGORY_IDS = WATCH_PARTNER_RESOURCE_CATEGORIES.map(({ id }) => id)

describe("WATCH_PARTNER_RESOURCES", () => {
  it("lists every resource once, under a known category", () => {
    const ids = WATCH_PARTNER_RESOURCES.map(({ id }) => id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const resource of WATCH_PARTNER_RESOURCES) {
      expect(CATEGORY_IDS).toContain(resource.category)
    }
  })

  it("carries source language, source date and a real destination for each entry", () => {
    for (const resource of WATCH_PARTNER_RESOURCES) {
      expect(resource.title.trim()).not.toBe("")
      expect(resource.summary.trim()).not.toBe("")
      expect(resource.sourceLanguage).toBe("en")
      expect(resource.sourceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      const destination = new URL(resource.destination)
      expect(destination.protocol).toBe("https:")
      expect(destination.hostname).toBe("www.jesusfilm.org")
    }
  })

  it("keeps public PDFs as direct links on the source site, never a proxied URL", () => {
    const withPdf = WATCH_PARTNER_RESOURCES.filter(({ pdf }) => pdf)
    expect(withPdf.length).toBeGreaterThan(0)
    for (const { pdf } of withPdf) {
      const url = new URL(pdf!)
      expect(url.protocol).toBe("https:")
      expect(url.hostname).toBe("www.jesusfilm.org")
      expect(url.pathname).toMatch(/^\/wp-content\/uploads\/.+\.pdf$/)
    }
  })

  it("does not end any summary mid-sentence", () => {
    for (const { summary } of WATCH_PARTNER_RESOURCES) {
      expect(summary).toMatch(/[.!?)”]$/)
    }
  })
})

describe("filterWatchPartnerResources", () => {
  it("returns the whole library, in order, for `all`", () => {
    expect(filterWatchPartnerResources("all")).toEqual(WATCH_PARTNER_RESOURCES)
  })

  it.each(CATEGORY_IDS)("returns only %s entries, in library order", (id) => {
    const filtered = filterWatchPartnerResources(id)
    expect(filtered.length).toBeGreaterThan(0)
    expect(filtered.every(({ category }) => category === id)).toBe(true)
    expect(filtered).toEqual(
      WATCH_PARTNER_RESOURCES.filter(({ category }) => category === id),
    )
  })

  it("reports a count per category that adds up to the library", () => {
    const counts = watchPartnerResourceCategoryCounts()
    expect(Object.keys(counts).sort()).toEqual([...CATEGORY_IDS].sort())
    expect(Object.values(counts).reduce((sum, n) => sum + n, 0)).toBe(
      WATCH_PARTNER_RESOURCES.length,
    )
    for (const id of CATEGORY_IDS) {
      expect(counts[id]).toBe(filterWatchPartnerResources(id).length)
    }
  })
})

describe("watchPartnerResourceLinks", () => {
  const base: WatchPartnerResource = {
    id: "fixture",
    title: "Fixture",
    category: "outreach",
    summary: "A fixture.",
    sourceLanguage: "en",
    sourceDate: "2026-09-15",
    destination: "https://www.jesusfilm.org/resources/fixture/",
  }

  it("offers only the source page when the resource publishes no PDF", () => {
    expect(watchPartnerResourceLinks(base)).toEqual([
      {
        kind: "page",
        label: "View source page",
        href: "https://www.jesusfilm.org/resources/fixture/",
      },
    ])
  })

  it("adds a direct PDF link, after the page, only when one exists", () => {
    const pdf = "https://www.jesusfilm.org/wp-content/uploads/2023/01/x.pdf"
    expect(watchPartnerResourceLinks({ ...base, pdf })).toEqual([
      {
        kind: "page",
        label: "View source page",
        href: "https://www.jesusfilm.org/resources/fixture/",
      },
      { kind: "pdf", label: "Open PDF", href: pdf },
    ])
  })
})

describe("watchPartnerResourceLanguageLabel", () => {
  it("names the source language in plain words", () => {
    expect(watchPartnerResourceLanguageLabel("en")).toBe("English")
  })
})
