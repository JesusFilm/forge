import { describe, expect, it } from "vitest"
import { resolveMediaCollectionCta } from "./media-collection-cta"

describe("resolveMediaCollectionCta", () => {
  const inventoryHref = "/watch/english.html/videos"

  it("skips a self-link and falls back to the video inventory", () => {
    expect(
      resolveMediaCollectionCta({
        authoredHref: "/watch/jesus.html/english.html",
        authoredLabel: "See all",
        collectionHref: "/watch/jesus-films.html/english.html",
        inventoryHref,
        currentPathname: "/watch/jesus.html",
      }),
    ).toEqual({
      href: inventoryHref,
      label: { kind: "inventory" },
    })
  })

  it("falls back to the language inventory when an authored home CTA self-links", () => {
    expect(
      resolveMediaCollectionCta({
        authoredHref: "/",
        authoredLabel: "Watch",
        collectionHref: "/watch/jesus-films.html/english.html",
        inventoryHref,
        currentPathname: "/watch",
      }),
    ).toEqual({
      href: inventoryHref,
      label: { kind: "inventory" },
    })
  })

  it("uses the first card for a CTA that promises the full story", () => {
    expect(
      resolveMediaCollectionCta({
        authoredHref:
          "/watch/creation-to-christ.html/1-the-most-high-god-and-his-creation/english.html",
        authoredLabel: "Watch the Full Story",
        collectionHref: null,
        firstItemHref: "/watch/creation-to-christ-story-full-video.html",
        inventoryHref,
        currentPathname: "/watch",
      }),
    ).toEqual({
      href: "/watch/creation-to-christ-story-full-video.html",
      label: { kind: "authored", text: "Watch the Full Story" },
    })
  })

  it("labels a language-directory destination as a language action", () => {
    expect(
      resolveMediaCollectionCta({
        authoredHref: "/watch/languages",
        authoredLabel: "Watch",
        collectionHref: null,
        inventoryHref,
        currentPathname: "/watch",
      }),
    ).toEqual({
      href: "/watch/languages",
      label: { kind: "languageDirectory" },
    })
  })
})
