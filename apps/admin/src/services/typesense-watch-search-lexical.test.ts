import { describe, expect, it } from "vitest"
import type { TypesenseWatchCatalogDocument } from "./typesense-watch-search-schema"
import {
  buildTypesenseWatchCandidateLexicalDocuments,
  buildTypesenseWatchLexicalDocuments,
  estimateTypesenseCandidateKeywordMemory,
  estimateTypesenseKeywordMemory,
  normalizeTypesenseWatchTaxonomy,
  TYPESENSE_WATCH_TAXONOMY_MAX_BYTES,
  TYPESENSE_WATCH_TAXONOMY_MAX_TERMS,
  typesenseWatchLanguageIdentity,
  typesenseWatchLocaleCodes,
  typesenseWatchTokenizerLocale,
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
        taxonomy: ["Short Film"],
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
        taxonomy: ["Kiriata poto"],
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
      title_stem_en: ["JESUS"],
      metadata_en: ["The life of Jesus"],
      metadata_stem_en: ["The life of Jesus"],
      taxonomy_en: ["Short Film"],
      taxonomy_stem_en: ["Short Film"],
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
      taxonomy_fallback: ["Kiriata poto"],
    })
    expect(byLocale.get("mi")).not.toHaveProperty("taxonomy_mi")
    expect(byLocale.get("mi")).not.toHaveProperty("taxonomy_stem_mi")
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
          ([name]) =>
            !name.includes("_stem_") &&
            (name.startsWith("title_") || name.startsWith("metadata_")),
        )
        .flatMap(([, values]) => values as string[]),
    )
    expect(searchableValues).toHaveLength(new Set(searchableValues).size)
  })

  it("decorates Candidate documents with exact keys without changing Current documents", () => {
    const current = buildTypesenseWatchLexicalDocuments([catalogDocument()])
    const candidate = buildTypesenseWatchCandidateLexicalDocuments([
      catalogDocument(),
    ])

    expect(current).toEqual(
      buildTypesenseWatchLexicalDocuments([catalogDocument()]),
    )
    expect(current.every((document) => !("title_exact_keys" in document))).toBe(
      true,
    )
    expect(candidate).toHaveLength(current.length)
    expect(
      candidate.every((document) =>
        document.title_exact_keys?.every((key) => /^[a-f0-9]{32}$/.test(key)),
      ),
    ).toBe(true)
    expect(
      candidate.map(({ title_exact_keys: _keys, ...document }) => document),
    ).toEqual(current)
  })

  it("keeps Candidate exact keys deterministic across localized-title input order", () => {
    const document = catalogDocument()
    const locales = [
      {
        locale: "en-US",
        languageSlug: "english",
        title: "JESUS",
        description: null,
      },
      {
        locale: "en-GB",
        languageSlug: "english",
        title: "The Story of Jesus",
        description: null,
      },
    ]
    document.localesJson = JSON.stringify(locales)
    const reversed = {
      ...document,
      localesJson: JSON.stringify([...locales].reverse()),
    }

    expect(
      buildTypesenseWatchCandidateLexicalDocuments([document])[0]
        ?.title_exact_keys,
    ).toEqual(
      buildTypesenseWatchCandidateLexicalDocuments([reversed])[0]
        ?.title_exact_keys,
    )
  })

  it("retains fail-closed validation for malformed Candidate locale rows", () => {
    const malformed = catalogDocument()
    malformed.localesJson = JSON.stringify({ locale: "en" })
    expect(() =>
      buildTypesenseWatchCandidateLexicalDocuments([malformed]),
    ).toThrow("Catalog locales are malformed")

    const identityLess = catalogDocument()
    identityLess.localesJson = JSON.stringify([
      { locale: "not a locale", title: "Jesus", description: null },
    ])
    expect(() =>
      buildTypesenseWatchCandidateLexicalDocuments([identityLess]),
    ).toThrow("no safe language identity")
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
    const stemBytes = documents
      .flatMap((document) =>
        Object.entries(document)
          .filter(
            ([name]) =>
              name.startsWith("title_stem_") ||
              name.startsWith("metadata_stem_"),
          )
          .flatMap(([, values]) => values as string[]),
      )
      .reduce(
        (total, value) => total + new TextEncoder().encode(value).byteLength,
        0,
      )
    const taxonomyBytes = new TextEncoder().encode("Short Film").byteLength
    const fallbackTaxonomyBytes = new TextEncoder().encode(
      "Kiriata poto",
    ).byteLength
    const exactTaxonomyBytes = taxonomyBytes + fallbackTaxonomyBytes
    const searchableBytes =
      expectedBytes + stemBytes + exactTaxonomyBytes + taxonomyBytes

    expect(estimate).toEqual({
      searchableBytes,
      searchableBytesByFamily: {
        baselineTitleMetadata: expectedBytes,
        stemTitleMetadata: stemBytes,
        exactTaxonomy: exactTaxonomyBytes,
        stemTaxonomy: taxonomyBytes,
      },
      estimatedRamLowBytes: searchableBytes * 2,
      estimatedRamHighBytes: searchableBytes * 3,
    })
  })

  it("normalizes, deduplicates, orders, and caps taxonomy deterministically", () => {
    const values = [
      "  zeta  ",
      "cafe\u0301",
      "caf\u00e9",
      "alpha   term",
      ...Array.from(
        { length: 40 },
        (_, index) => `term-${String(index).padStart(2, "0")}`,
      ),
    ]

    const first = normalizeTypesenseWatchTaxonomy(values)
    const second = normalizeTypesenseWatchTaxonomy([...values].reverse())

    expect(first).toEqual(second)
    expect(first).toHaveLength(TYPESENSE_WATCH_TAXONOMY_MAX_TERMS)
    expect(first).toContain("alpha term")
    expect(first.filter((value) => value === "caf\u00e9")).toHaveLength(1)
    expect(first).toEqual([...first].sort())
  })

  it("keeps taxonomy at or below the exact UTF-8 byte ceiling", () => {
    const atLimit = "a".repeat(TYPESENSE_WATCH_TAXONOMY_MAX_BYTES)
    const values = normalizeTypesenseWatchTaxonomy([atLimit, "z"])

    expect(values).toEqual([atLimit])
    expect(
      values.reduce(
        (total, value) => total + new TextEncoder().encode(value).byteLength,
        0,
      ),
    ).toBe(TYPESENSE_WATCH_TAXONOMY_MAX_BYTES)
  })

  it("reports Candidate exact-key bytes explicitly in keyword memory", () => {
    const documents = buildTypesenseWatchCandidateLexicalDocuments([
      catalogDocument(),
    ])
    const estimate = estimateTypesenseCandidateKeywordMemory(documents)
    const exactTitleKeyBytes = documents.reduce(
      (total, document) =>
        total +
        (document.title_exact_keys ?? []).reduce(
          (keyTotal, key) =>
            keyTotal + new TextEncoder().encode(key).byteLength,
          0,
        ),
      0,
    )

    expect(exactTitleKeyBytes).toBe(8 * 32)
    expect(estimate.exactTitleKeyBytes).toBe(exactTitleKeyBytes)
    expect(estimate.searchableBytes).toBe(
      estimateTypesenseKeywordMemory(documents).searchableBytes,
    )
    expect(estimate.estimatedRamHighBytes).toBe(estimate.searchableBytes * 3)
  })

  it("normalizes valid language tags without accepting filter syntax", () => {
    expect(typesenseWatchLocaleCodes("zh_Hans")).toEqual(["zh-hans"])
    expect(typesenseWatchTokenizerLocale("zh_Hans")).toBe("zh")
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
