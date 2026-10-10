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
})
