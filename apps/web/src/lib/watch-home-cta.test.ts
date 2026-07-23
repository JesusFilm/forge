import { describe, expect, it } from "vitest"

import {
  WATCH_HOME_SECTION_CTA_ACTION,
  resolveWatchHomeMediaCtaHref,
  resolveWatchHomeSectionCtaHref,
  watchHomeCtaAccessibleName,
  watchHomeCtaAnalyticsContext,
} from "./watch-home-cta"

describe("resolveWatchHomeSectionCtaHref", () => {
  it.each([
    "/",
    "/watch",
    "/watch/",
    "/watch?campaign=home",
    "/watch#films",
    "https://www.jesusfilm.org/watch",
    "http://www.jesusfilm.org/watch",
    "https://jesusfilm.org/watch/",
    "/watch/french.html",
    "/watch/featured",
    "/watch/search",
    "/watch/lumo/english",
    "/watch/lumo.html/english.html/",
    "/watch/jesus.html/chapter/english",
    "/watch/languages/",
    "/watch/easter/",
    "/watch/%",
    "/\\evil.example",
    "/about/\tfaq",
    "/about/%2fadmin",
    "featured",
    "?campaign=home",
    "#films",
  ])("rejects homepage-equivalent or unsupported Watch href %s", (href) => {
    expect(resolveWatchHomeSectionCtaHref(href)).toBeNull()
  })

  it.each([
    "/watch/lumo.html/english.html",
    "/watch/jesus.html/women-disciples/english.html",
    "/watch/languages",
    "/watch/french.html/languages",
    "/watch/french.html/videos",
    "/watch/history",
    "/watch/french.html/history",
    "/watch/easter",
    "/about/faq/",
    "https://example.org/watch",
  ])("preserves supported Watch, ministry, and external href %s", (href) => {
    expect(resolveWatchHomeSectionCtaHref(href)).toBe(href)
  })
})

describe("resolveWatchHomeMediaCtaHref", () => {
  it("falls through from the authored root placeholder to the inferred collection", () => {
    expect(
      resolveWatchHomeMediaCtaHref({
        authoredHref: "/",
        inferredHref: "/watch/jfm-collection.html/english.html",
        fallbackHref: "/watch/languages",
      }),
    ).toBe("/watch/jfm-collection.html/english.html")
  })

  it("falls through to the language index without an inferred collection", () => {
    expect(
      resolveWatchHomeMediaCtaHref({
        authoredHref: "/watch/featured",
        inferredHref: null,
        fallbackHref: "/watch/languages",
      }),
    ).toBe("/watch/languages")
  })

  it("preserves a canonical explicit destination", () => {
    expect(
      resolveWatchHomeMediaCtaHref({
        authoredHref: "/watch/lumo.html/french.html",
        inferredHref: "/watch/jfm-collection.html/french.html",
        fallbackHref: "/watch/languages",
      }),
    ).toBe("/watch/lumo.html/french.html")
  })
})

describe("watchHomeCtaAccessibleName", () => {
  it("starts with the visible label and uses the first human-facing context", () => {
    expect(
      watchHomeCtaAccessibleName(" See all ", [
        " ",
        "Films About Jesus",
        "Featured",
      ]),
    ).toBe("See all: Films About Jesus")
  })

  it("preserves the visible label when no context exists", () => {
    expect(watchHomeCtaAccessibleName("Watch", [null, "", " "])).toBe("Watch")
  })
})

describe("watchHomeCtaAnalyticsContext", () => {
  it("returns bounded route context without query or fragment data", () => {
    expect(
      watchHomeCtaAnalyticsContext({
        href: "/watch/lumo.html/english.html?campaign=home#cta",
        sectionKey: "media-collection-1",
      }),
    ).toEqual({
      surface: "watch_home",
      sectionKey: "media-collection-1",
      destination: "/watch/lumo.html/english.html",
      routeKind: "video",
    })
    expect(WATCH_HOME_SECTION_CTA_ACTION).toBe("watch_home.section_cta_clicked")
  })

  it("does not include an external origin or query in destination context", () => {
    expect(
      watchHomeCtaAnalyticsContext({
        href: "https://www.jesusfilm.org/about/faq/?source=watch#questions",
        sectionKey: "related-questions",
      }),
    ).toEqual({
      surface: "watch_home",
      sectionKey: "related-questions",
      destination: "/about/faq/",
      routeKind: "site",
    })
  })

  it("bounds internal section identity", () => {
    expect(
      watchHomeCtaAnalyticsContext({
        href: "/watch/languages",
        sectionKey: `section-${"x".repeat(100)}`,
      }).sectionKey,
    ).toHaveLength(80)
  })
})
