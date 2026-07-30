import { describe, expect, it } from "vitest"

import {
  languageSwitcherTarget,
  projectGlobalLanguageOptions,
} from "./watch-language-switcher"
import type { SearchLanguageOption } from "./search-language"

describe("languageSwitcherTarget", () => {
  it("accepts a safe Admin-projected language absent from the static corpus", () => {
    expect(languageSwitcherTarget("/", "jiamao")).toBe("/jiamao.html")
  })

  it.each([
    ["/", "/spanish-latin-american.html"],
    ["/french.html", "/spanish-latin-american.html"],
    ["/easter.html", "/spanish-latin-american.html"],
    ["/jesus.html/english.html", "/spanish-latin-american.html"],
    [
      "/lumo-the-gospel-of-john.html/wedding-in-cana/english.html",
      "/spanish-latin-american.html",
    ],
    ["/not/a/public/route", "/spanish-latin-american.html"],
  ])(
    "uses localized home for global fallback context %s",
    (pathname, target) => {
      expect(languageSwitcherTarget(pathname, "spanish-latin-american")).toBe(
        target,
      )
    },
  )

  it("keeps inventory and utility route families language-bearing", () => {
    expect(
      languageSwitcherTarget("/french.html/videos", "portuguese-brazil"),
    ).toBe("/portuguese-brazil.html/videos")
    expect(languageSwitcherTarget("/languages", "portuguese-brazil")).toBe(
      "/portuguese-brazil.html/languages",
    )
    expect(
      languageSwitcherTarget("/french.html/languages", "portuguese-brazil"),
    ).toBe("/portuguese-brazil.html/languages")
    expect(languageSwitcherTarget("/history", "portuguese-brazil")).toBe(
      "/portuguese-brazil.html/history",
    )
    expect(
      languageSwitcherTarget("/french.html/history", "portuguese-brazil"),
    ).toBe("/portuguese-brazil.html/history")
  })

  it.each(["en", "pt-br", "English", "../english"])(
    "rejects malformed or internal language key %s",
    (slug) => {
      expect(languageSwitcherTarget("/", slug)).toBeNull()
    },
  )

  it("retains exact regional public slugs", () => {
    expect(languageSwitcherTarget("/", "portuguese-brazil")).toBe(
      "/portuguese-brazil.html",
    )
  })
})

describe("projectGlobalLanguageOptions", () => {
  it("keeps a safe Admin-projected language absent from the static corpus", () => {
    expect(
      projectGlobalLanguageOptions([
        {
          englishName: "Jiamao",
          nativeName: null,
          bcp47: null,
          publicSlug: "jiamao",
          regionNames: [],
        },
      ]),
    ).toEqual([{ slug: "jiamao", englishName: "Jiamao", nativeName: null }])
  })

  it("keeps only exact public slugs, compacts fields, dedupes, and sorts", () => {
    const options: SearchLanguageOption[] = [
      {
        englishName: "Spanish, Latin American",
        nativeName: "Español",
        bcp47: "es-419",
        publicSlug: "spanish-latin-american",
        regionNames: ["South America"],
      },
      {
        englishName: "English duplicate",
        nativeName: null,
        bcp47: "en",
        publicSlug: "english",
        regionNames: [],
      },
      {
        englishName: "English",
        nativeName: "English",
        bcp47: "en",
        publicSlug: "english",
        regionNames: ["North America"],
      },
      {
        englishName: "Internal catalog key",
        nativeName: null,
        bcp47: "pt-BR",
        publicSlug: "pt-br",
        regionNames: [],
      },
      {
        englishName: "Facet only",
        nativeName: null,
        bcp47: null,
        publicSlug: null,
        regionNames: [],
      },
    ]

    expect(projectGlobalLanguageOptions(options)).toEqual([
      { slug: "english", englishName: "English", nativeName: "English" },
      {
        slug: "spanish-latin-american",
        englishName: "Spanish, Latin American",
        nativeName: "Español",
      },
    ])
  })
})
