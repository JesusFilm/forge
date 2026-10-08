import { describe, expect, it } from "vitest"

import { classifyPublicWatchPathname } from "./routes"

describe("classifyPublicWatchPathname", () => {
  it.each([
    "tümlükden-nura",
    "la-liberté-de-l-interieur-freedom-within",
    "la-búsqueda-the-search",
    "jätku-leiba",
  ])("classifies each reported Unicode slug: %s", (slug) => {
    expect(
      classifyPublicWatchPathname(`/watch/${encodeURIComponent(slug)}.html`),
    ).toMatchObject({ kind: "page", shape: "one-segment", slug })
  })

  it("accepts lowercase Latin dotless i when UTF-8 encoded canonically", () => {
    expect(
      classifyPublicWatchPathname(`/watch/${encodeURI("kılıç")}.html`),
    ).toMatchObject({ kind: "page", shape: "one-segment", slug: "kılıç" })
  })

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
      "/watch/conversation-starters.html/t%C3%BCml%C3%BCkden-nura.html",
      {
        kind: "page",
        shape: "two-segment",
        firstSlug: "conversation-starters",
        secondSlug: "tümlükden-nura",
      },
    ],
    [
      "/watch/conversation-starters.html/la-b%C3%BAsqueda-the-search/english.html",
      {
        kind: "page",
        shape: "episode",
        parentSlug: "conversation-starters",
        episodeSlug: "la-búsqueda-the-search",
        languageSlug: "english",
      },
    ],
    [
      "/watch/conversation-starters.html/la-libert%C3%A9-de-l-interieur-freedom-within.html",
      {
        kind: "page",
        shape: "two-segment",
        firstSlug: "conversation-starters",
        secondSlug: "la-liberté-de-l-interieur-freedom-within",
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
    "/watch/conversation-starters.html/t%C3%BCml%C3%BCkden%2Fnura.html",
    "/watch/conversation-starters.html/%E0%A4.html",
    "/watch/%6Aesus.html",
    "/watch/t%c3%bcml%c3%bckden-nura.html",
    "/watch/%2E%2E/conversation-starters.html",
    "/watch/%C3%9Cber.html",
    "/watch/jesus.html?utm_source=test",
  ])("fails closed for malformed or non-Watch path %s", (pathname) => {
    expect(classifyPublicWatchPathname(pathname).kind).not.toBe("page")
  })

  it.each([
    "иисус",
    "𝐚",
    "jesus١",
    "ｊｅｓｕｓ",
    "ᴀlpha",
    "ʰome",
    "ɪesus",
    "ꜱcript",
    "ﬁlm",
  ])("rejects non-canonical lookalike slug characters in %s", (slug) => {
    expect(
      classifyPublicWatchPathname(encodeURI(`/watch/${slug}.html`)),
    ).not.toMatchObject({ kind: "page" })
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
