import { describe, expect, it } from "vitest"

import { classifyPublicWatchPathname } from "./routes"

describe("classifyPublicWatchPathname", () => {
  it.each([
    ["/watch", { kind: "page", shape: "home" }],
    ["/watch/", { kind: "page", shape: "home" }],
    [
      "/watch/languages",
      { kind: "page", shape: "utility", utility: "languages" },
    ],
    [
      "/watch/jesus.html",
      { kind: "page", shape: "one-segment", slug: "jesus" },
    ],
    [
      "/watch/jesus.html/spanish-latin-american.html",
      {
        kind: "page",
        shape: "two-segment",
        firstSlug: "jesus",
        secondSlug: "spanish-latin-american",
      },
    ],
    [
      "/watch/lumo-the-gospel-of-john.html/wedding-in-cana/english.html",
      {
        kind: "page",
        shape: "episode",
        parentSlug: "lumo-the-gospel-of-john",
        episodeSlug: "wedding-in-cana",
        languageSlug: "english",
      },
    ],
    [
      "/watch/spanish-latin-american.html/videos",
      {
        kind: "page",
        shape: "localized-utility",
        languageSlug: "spanish-latin-american",
        utility: "videos",
      },
    ],
  ])("recognizes public page shape %s", (pathname, expected) => {
    expect(classifyPublicWatchPathname(pathname)).toMatchObject(expected)
  })

  it.each([
    ["/watch/api/recommendations", "api"],
    ["/watch/_next/static/chunk.js", "_next"],
    ["/watch/assets/poster.jpg", "assets"],
    ["/watch/preview/experience/token", "preview"],
    ["/watch/sitemap/0.xml", "sitemap"],
  ])("rejects reserved or non-page subtree %s", (pathname, prefix) => {
    expect(classifyPublicWatchPathname(pathname)).toEqual({
      kind: "reserved",
      prefix,
    })
  })

  it.each([
    "/",
    "/watching/jesus.html",
    "/watch/jesus",
    "/watch/Jesus.html",
    "/watch/jesus.html/spanish",
    "/watch/series.html/episode.html/english.html",
    "/watch/series.html/episode/english.html/extra",
    "/watch//jesus.html",
    "/watch/../admin",
    "/watch/jesus%2Fenglish.html",
    "/watch/jesus.html?utm_source=test",
  ])("fails closed for malformed or non-Watch path %s", (pathname) => {
    expect(classifyPublicWatchPathname(pathname).kind).not.toBe("page")
  })

  it("honors an explicit base path without accepting neighboring prefixes", () => {
    expect(
      classifyPublicWatchPathname("/media/jesus.html", "/media"),
    ).toMatchObject({ kind: "page", shape: "one-segment", slug: "jesus" })
    expect(
      classifyPublicWatchPathname("/media-old/jesus.html", "/media"),
    ).toEqual({ kind: "outside-watch" })
  })
})
