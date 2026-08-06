import { describe, expect, it } from "vitest"
import type { TypesenseWatchCatalogDocument } from "./typesense-watch-search-schema"
import {
  buildTypesenseWatchLexicalDocuments,
  estimateTypesenseKeywordMemory,
  typesenseWatchLanguageIdentity,
  typesenseWatchLocaleCodes,
} from "./typesense-watch-search-lexical"

function catalogDocument(): TypesenseWatchCatalogDocument {
  return {
    id: "video-1",
    coreId: "4_Win4GoodNewsJesusAD1x1",
    slug: "jesus",
    titles: [],
    localeCodes: [],
    descriptions: [],
    localesJson: JSON.stringify([
      {
        locale: "en",
        languageSlug: "english",
        title: "JESUS",
        description: "The life of Jesus",
      },
      {
        locale: "zh-Hans",
        languageSlug: "mandarin-chinese",
        title: "耶稣传",
        description: "耶稣的一生",
      },
      {
        locale: "th",
        languageSlug: "thai",
        title: "พระเยซู",
        description: "ชีวิตของพระเยซู",
      },
      {
        locale: "ar-EG",
        languageSlug: "arabic-egyptian",
        title: "يسوع",
        description: "حياة يسوع",
      },
      {
        locale: "es-ES",
        languageSlug: "spanish-castilian",
        title: "JESÚS",
        description: "La vida de Jesús",
      },
      {
        locale: "mi",
        languageSlug: "maori",
        title: "Ihu",
        description: "Te oranga o Ihu",
      },
      {
        locale: "fil",
        languageSlug: "filipino",
        title: "Hesus",
        description: "Ang buhay ni Hesus",
      },
      {
        locale: "x-private",
        languageSlug: "private-language",
        title: "Long-tail",
        description: null,
      },
    ]),
    label: null,
    childCount: 0,
    imageUrl: null,
    imageBlurDataUrl: null,
    audioLanguageSlugs: [],
    subtitleLanguageSlugs: [],
    audioOptionsJson: "[]",
    subtitleOptionsJson: "[]",
  }
}

describe("Typesense Watch lexical projection", () => {
  it("projects every localization into an independently filterable document", () => {
    const documents = buildTypesenseWatchLexicalDocuments([catalogDocument()])
    const byLocale = new Map(
      documents.map((document) => [document.localeCodes[0], document]),
    )

    expect(documents).toHaveLength(8)
    expect(new Set(documents.map((document) => document.id)).size).toBe(8)
    expect(byLocale.get("en")).toMatchObject({
      videoId: "video-1",
      canonicalVideoId: "core:4_win4goodnewsjesus",
      languageIdentity: "slug:english",
      localeCodes: ["en"],
      title_en: ["JESUS"],
      metadata_en: ["The life of Jesus"],
    })
    expect(byLocale.get("zh-hans")).toMatchObject({
      languageIdentity: "slug:mandarin-chinese",
      localeCodes: ["zh-hans"],
      title_zh: ["耶稣传"],
      metadata_zh: ["耶稣的一生"],
    })
    expect(byLocale.get("th")).toMatchObject({
      localeCodes: ["th"],
      title_th: ["พระเยซู"],
      metadata_th: ["ชีวิตของพระเยซู"],
    })
    expect(byLocale.get("mi")).toMatchObject({
      localeCodes: ["mi"],
      title_mi: ["Ihu"],
      metadata_mi: ["Te oranga o Ihu"],
    })
    expect(byLocale.get("fil")).toMatchObject({
      localeCodes: ["fil"],
      title_fallback: ["Hesus"],
      metadata_fallback: ["Ang buhay ni Hesus"],
    })
    expect(byLocale.get("x-private")).toMatchObject({
      localeCodes: ["x-private"],
      title_fallback: ["Long-tail"],
    })
    expect(byLocale.get("fil")?.title_fallback).not.toContain("Long-tail")

    const searchableValues = documents.flatMap((document) =>
      Object.entries(document)
        .filter(
          ([name]) => name.startsWith("title_") || name.startsWith("metadata_"),
        )
        .flatMap(([, values]) => values as string[]),
    )
    expect(searchableValues).toHaveLength(new Set(searchableValues).size)
  })

  it("keeps distinct languages isolated when they share a BCP-47 tag", () => {
    const document = catalogDocument()
    document.localesJson = JSON.stringify([
      {
        locale: "ko",
        languageSlug: "korean",
        title: "예수",
        description: null,
      },
      {
        locale: "ko",
        languageSlug: "korean-sign-language",
        title: "한국 수어 예수",
        description: null,
      },
    ])

    const documents = buildTypesenseWatchLexicalDocuments([document])

    expect(documents).toHaveLength(2)
    expect(new Set(documents.map((entry) => entry.id)).size).toBe(2)
    expect(documents.map((entry) => entry.languageIdentity).sort()).toEqual([
      "slug:korean",
      "slug:korean-sign-language",
    ])
  })

  it("reports exact UTF-8 searchable bytes and the documented 2x-3x RAM range", () => {
    const documents = buildTypesenseWatchLexicalDocuments([catalogDocument()])
    const estimate = estimateTypesenseKeywordMemory(documents)
    const expectedBytes = [
      "JESUS",
      "The life of Jesus",
      "耶稣传",
      "耶稣的一生",
      "พระเยซู",
      "ชีวิตของพระเยซู",
      "يسوع",
      "حياة يسوع",
      "JESÚS",
      "La vida de Jesús",
      "Ihu",
      "Te oranga o Ihu",
      "Hesus",
      "Long-tail",
      "Ang buhay ni Hesus",
    ].reduce(
      (total, value) => total + new TextEncoder().encode(value).byteLength,
      0,
    )

    expect(estimate).toEqual({
      searchableBytes: expectedBytes,
      estimatedRamLowBytes: expectedBytes * 2,
      estimatedRamHighBytes: expectedBytes * 3,
    })
  })

  it("normalizes valid language tags without accepting filter syntax", () => {
    expect(typesenseWatchLocaleCodes("zh_Hans")).toEqual(["zh-hans"])
    expect(typesenseWatchLocaleCodes("x-private")).toEqual(["x-private"])
    expect(typesenseWatchLocaleCodes("en`,localeCodes:=fr")).toEqual([])
    expect(
      typesenseWatchLanguageIdentity({
        languageSlug: "French",
        locale: "fr",
      }),
    ).toBe("slug:french")
    expect(
      typesenseWatchLanguageIdentity({
        languageSlug: null,
        locale: "zh_Hans",
      }),
    ).toBe("locale:zh-hans")
  })
})
