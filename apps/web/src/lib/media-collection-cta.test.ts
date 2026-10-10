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

  it("keeps a non-vague authored label on a language-directory link", () => {
    expect(
      resolveMediaCollectionCta({
        authoredHref: "/watch/languages",
        authoredLabel: "Find the JESUS film in your language",
        collectionHref: null,
        inventoryHref,
        currentPathname: "/watch",
      }),
    ).toEqual({
      href: "/watch/languages",
      label: { kind: "authored", text: "Find the JESUS film in your language" },
    })
  })

  describe("a bare Watch-root link on a non-English page", () => {
    const spanish = {
      inventoryHref: "/watch/spanish-latin-american.html/videos",
      languageHomeHref: "/watch/spanish-latin-american.html",
    }

    it.each(["/", "/watch", "/watch/"])(
      "treats %j as the current translated home and falls back to its inventory",
      (authoredHref) => {
        expect(
          resolveMediaCollectionCta({
            ...spanish,
            authoredHref,
            authoredLabel: "See all",
            collectionHref:
              "/watch/jesus-films.html/spanish-latin-american.html",
            currentPathname: "/watch/spanish-latin-american.html",
          }),
        ).toEqual({
          href: "/watch/spanish-latin-american.html/videos",
          label: { kind: "inventory" },
        })
      },
    )

    it("links a translated content page to its own language home", () => {
      expect(
        resolveMediaCollectionCta({
          ...spanish,
          authoredHref: "/",
          authoredLabel: "Volver al inicio",
          collectionHref: null,
          currentPathname: "/watch/jesus.html/spanish-latin-american.html",
        }),
      ).toEqual({
        href: "/watch/spanish-latin-american.html",
        label: { kind: "authored", text: "Volver al inicio" },
      })
    })

    it("leaves an absolute root URL as authored", () => {
      const authoredHref =
        "https://www.jesusfilm.org/watch?utm_source=jesusfilm-watch"
      expect(
        resolveMediaCollectionCta({
          ...spanish,
          authoredHref,
          authoredLabel: "Explore all videos",
          collectionHref: null,
          currentPathname: "/watch/spanish-latin-american.html",
        }),
      ).toEqual({
        href: authoredHref,
        label: { kind: "authored", text: "Explore all videos" },
      })
    })
  })

  it("never falls back to the episode link when the full-length card is this page", () => {
    expect(
      resolveMediaCollectionCta({
        authoredHref:
          "/watch/creation-to-christ.html/1-the-most-high-god-and-his-creation/english.html",
        authoredLabel: "Watch the Full Story",
        collectionHref: null,
        firstItemHref: "/watch/creation-to-christ-story-full-video.html",
        inventoryHref,
        currentPathname: "/watch/creation-to-christ-story-full-video.html",
      }),
    ).toEqual({ href: inventoryHref, label: { kind: "inventory" } })
  })

  it("labels the language-bearing languages page as a language action", () => {
    expect(
      resolveMediaCollectionCta({
        authoredHref: "/watch/spanish-latin-american.html/languages",
        authoredLabel: "Watch",
        collectionHref: null,
        inventoryHref,
        currentPathname: "/watch",
      }),
    ).toEqual({
      href: "/watch/spanish-latin-american.html/languages",
      label: { kind: "languageDirectory" },
    })
  })

  describe("with no authored link", () => {
    it("keeps a non-vague label on the inferred collection", () => {
      expect(
        resolveMediaCollectionCta({
          authoredHref: null,
          authoredLabel: "Watch the El Camino series",
          collectionHref: "/watch/the-way-of-st-james.html",
          inventoryHref,
          currentPathname: "/watch",
        }),
      ).toEqual({
        href: "/watch/the-way-of-st-james.html",
        label: { kind: "authored", text: "Watch the El Camino series" },
      })
    })

    it("names the inferred collection when the label is vague", () => {
      expect(
        resolveMediaCollectionCta({
          authoredHref: null,
          authoredLabel: "Watch",
          collectionHref: "/watch/the-way-of-st-james.html",
          inventoryHref,
          currentPathname: "/watch",
        }),
      ).toEqual({
        href: "/watch/the-way-of-st-james.html",
        label: { kind: "collection" },
      })
    })

    it("skips an inferred collection that is the current page", () => {
      // A routeVideoChildren rail on its own collection page.
      expect(
        resolveMediaCollectionCta({
          authoredHref: null,
          authoredLabel: null,
          collectionHref: "/watch/the-way-of-st-james.html/english.html",
          inventoryHref,
          currentPathname: "/watch/the-way-of-st-james.html",
        }),
      ).toEqual({ href: inventoryHref, label: { kind: "inventory" } })
    })

    it("renders no CTA when every destination is the current page", () => {
      expect(
        resolveMediaCollectionCta({
          authoredHref: null,
          authoredLabel: null,
          collectionHref: inventoryHref,
          inventoryHref,
          currentPathname: inventoryHref,
        }),
      ).toBeNull()
    })
  })
})
