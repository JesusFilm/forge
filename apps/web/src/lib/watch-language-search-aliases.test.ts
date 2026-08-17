import { PUBLIC_WATCH_LANGUAGE_SLUGS } from "@forge/watch-url-policy/routes"
import { describe, expect, it } from "vitest"

import {
  WATCH_LANGUAGE_SEARCH_EXACT_ALIASES,
  WATCH_LANGUAGE_SEARCH_ALIASES,
  watchLanguageSearchAliasesFor,
} from "./watch-language-search-aliases"

const SPECIFIC_CHINESE_ALIASES = {
  cantonese: ["粤语", "粵語"],
  "chinese-simplified": ["简体", "簡體", "简体中文", "簡體中文"],
  "chinese-traditional": ["繁体", "繁體", "繁体中文", "繁體中文"],
  "mandarin-china": ["普通话", "普通話"],
  "mandarin-taiwan": ["国语", "國語", "台湾华语", "臺灣華語"],
} as const

const BROAD_CHINESE_LANGUAGE_SLUGS = [
  "cantonese",
  "chinese-guiliu",
  "chinese-hokkien-amoy",
  "chinese-qinghai",
  "chinese-sichuan",
  "chinese-simplified",
  "chinese-traditional",
  "chinese-yunnan-kunming",
  "foochow",
  "hainanese",
  "hakka",
  "hui",
  "mandarin-china",
  "mandarin-taiwan",
  "penang-hokkien",
  "pontianak-hakka",
  "shanghainese",
  "teochew",
  "xiang",
] as const

describe("Watch language search aliases", () => {
  it.each(Object.entries(SPECIFIC_CHINESE_ALIASES))(
    "binds the approved aliases to %s",
    (slug, aliases) => {
      expect(watchLanguageSearchAliasesFor(slug)).toEqual(
        expect.arrayContaining([...aliases]),
      )
    },
  )

  it("binds broad Chinese discovery only to the reviewed slug group", () => {
    for (const slug of BROAD_CHINESE_LANGUAGE_SLUGS) {
      expect(watchLanguageSearchAliasesFor(slug)).toContain("中文")
    }

    expect(watchLanguageSearchAliasesFor("english")).not.toContain("中文")
  })

  it.each(["mandarin-taiwan", "chinese-hokkien-amoy", "penang-hokkien"])(
    "does not approximate Taiwanese for %s",
    (slug) => {
      expect(watchLanguageSearchAliasesFor(slug)).not.toContain("台語")
      expect(watchLanguageSearchAliasesFor(slug)).not.toContain("臺語")
    },
  )

  it("returns an empty alias collection for an unknown slug", () => {
    expect(watchLanguageSearchAliasesFor("not-a-language")).toEqual([])
  })

  it("uses only public Watch language slugs as alias keys", () => {
    const publicSlugs = new Set(PUBLIC_WATCH_LANGUAGE_SLUGS)

    for (const slug of Object.keys(WATCH_LANGUAGE_SEARCH_ALIASES)) {
      expect(publicSlugs.has(slug)).toBe(true)
    }
  })

  it("publishes the normalized exact-alias vocabulary with the authority", () => {
    const configuredAliases = new Set(
      Object.values(WATCH_LANGUAGE_SEARCH_ALIASES).flat(),
    )

    expect(WATCH_LANGUAGE_SEARCH_EXACT_ALIASES).toEqual(configuredAliases)
  })
})
