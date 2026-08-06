import { describe, expect, it } from "vitest"
import type { TypesenseWatchCatalogDocument } from "./typesense-watch-search-schema"
import {
  buildTypesenseWatchLexicalDocuments,
  estimateTypesenseKeywordMemory,
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
      { locale: "en", title: "JESUS", description: "The life of Jesus" },
      { locale: "zh-Hans", title: "耶稣传", description: "耶稣的一生" },
      { locale: "th", title: "พระเยซู", description: "ชีวิตของพระเยซู" },
      { locale: "ar-EG", title: "يسوع", description: "حياة يسوع" },
      { locale: "es-ES", title: "JESÚS", description: "La vida de Jesús" },
      { locale: "fil", title: "Hesus", description: "Ang buhay ni Hesus" },
      { locale: "x-private", title: "Long-tail", description: null },
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
  it("projects every localized value once into a tokenizer or fallback field", () => {
    const [document] = buildTypesenseWatchLexicalDocuments([catalogDocument()])

    expect(document).toMatchObject({
      id: "video-1",
      videoId: "video-1",
      canonicalVideoId: "core:4_win4goodnewsjesus",
      localeCodes: [
        "en",
        "zh-Hans",
        "th",
        "ar-EG",
        "es-ES",
        "fil",
        "x-private",
      ],
      localesJson: catalogDocument().localesJson,
      title_en: ["JESUS"],
      metadata_en: ["The life of Jesus"],
      title_zh: ["耶稣传"],
      metadata_zh: ["耶稣的一生"],
      title_th: ["พระเยซู"],
      metadata_th: ["ชีวิตของพระเยซู"],
      title_ar: ["يسوع"],
      metadata_ar: ["حياة يسوع"],
      title_es: ["JESÚS"],
      metadata_es: ["La vida de Jesús"],
      title_fallback: ["Hesus", "Long-tail"],
      metadata_fallback: ["Ang buhay ni Hesus"],
    })

    const searchableValues = Object.entries(document ?? {})
      .filter(
        ([name]) => name.startsWith("title_") || name.startsWith("metadata_"),
      )
      .flatMap(([, values]) => values as string[])
    expect(searchableValues).toHaveLength(new Set(searchableValues).size)
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
})
