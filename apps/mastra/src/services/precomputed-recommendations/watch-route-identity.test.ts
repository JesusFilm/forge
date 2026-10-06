import { describe, expect, it } from "vitest"

import { mapWatchPathToCatalogVideo } from "./watch-route-identity"

const catalog = [
  {
    id: "film",
    slug: "jesus",
    watchRouteIdentity: {
      basis: "current_catalog_cutoff_fenced" as const,
      parentSlugs: [],
      playableAudioLanguageSlugs: ["english", "spanish-latin-american"],
      truncated: false,
    },
  },
  {
    id: "chapter",
    slug: "the-beginning",
    watchRouteIdentity: {
      basis: "current_catalog_cutoff_fenced" as const,
      parentSlugs: ["jesus"],
      playableAudioLanguageSlugs: ["english", "spanish-latin-american"],
      truncated: false,
    },
  },
]

describe("current-catalog Watch route identity", () => {
  it("maps exact standalone and contextual chapter paths to unique Videos", () => {
    expect(
      mapWatchPathToCatalogVideo(
        "/watch/jesus.html/english.html?campaign=1#part",
        catalog,
      ),
    ).toEqual({ status: "mapped", videoId: "film" })
    expect(
      mapWatchPathToCatalogVideo(
        "/watch/jesus.html/the-beginning/spanish-latin-american.html",
        catalog,
      ),
    ).toEqual({ status: "mapped", videoId: "chapter" })
  })

  it("rejects unsupported language, wrong parent, homepage and unrelated paths", () => {
    expect(
      mapWatchPathToCatalogVideo("/watch/jesus.html/french.html", catalog),
    ).toMatchObject({ status: "unmapped" })
    expect(
      mapWatchPathToCatalogVideo(
        "/watch/other.html/the-beginning/english.html",
        catalog,
      ),
    ).toMatchObject({ status: "unmapped" })
    expect(mapWatchPathToCatalogVideo("/watch", catalog)).toMatchObject({
      status: "unmapped",
    })
    expect(
      mapWatchPathToCatalogVideo("/watching/jesus.html", catalog),
    ).toMatchObject({ status: "unmapped" })
  })

  it("keeps language-versus-child collisions ambiguous", () => {
    const collision = {
      id: "same-as-language",
      slug: "spanish-latin-american",
      watchRouteIdentity: {
        basis: "current_catalog_cutoff_fenced" as const,
        parentSlugs: ["jesus"],
        playableAudioLanguageSlugs: ["english"],
        truncated: false,
      },
    }
    expect(
      mapWatchPathToCatalogVideo(
        "/watch/jesus.html/spanish-latin-american.html",
        [...catalog, collision],
      ),
    ).toMatchObject({ status: "ambiguous" })
  })

  it("does not admit a route when its catalog identity was truncated", () => {
    const truncated = [
      catalog[0]!,
      {
        ...catalog[1]!,
        watchRouteIdentity: {
          ...catalog[1]!.watchRouteIdentity,
          truncated: true,
        },
      },
    ]
    expect(
      mapWatchPathToCatalogVideo(
        "/watch/jesus.html/the-beginning/english.html",
        truncated,
      ),
    ).toMatchObject({ status: "truncated" })
  })

  it("rejects a language route when a truncated competing child may have omitted its parent", () => {
    const competing = {
      id: "possible-child",
      slug: "spanish-latin-american",
      watchRouteIdentity: {
        basis: "current_catalog_cutoff_fenced" as const,
        parentSlugs: [],
        playableAudioLanguageSlugs: ["english"],
        truncated: true,
      },
    }
    expect(
      mapWatchPathToCatalogVideo(
        "/watch/jesus.html/spanish-latin-american.html",
        [...catalog, competing],
      ),
    ).toMatchObject({ status: "truncated" })
    expect(
      mapWatchPathToCatalogVideo("/watch/jesus.html/english.html", [
        ...catalog,
        { ...competing, slug: "unrelated" },
      ]),
    ).toEqual({ status: "mapped", videoId: "film" })
  })
})
