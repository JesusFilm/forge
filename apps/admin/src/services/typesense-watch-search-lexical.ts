import { canonicalTypesenseVideoId } from "./typesense-watch-search-identifiers"
import type {
  TypesenseWatchCatalogDocument,
  TypesenseWatchLocale,
} from "./typesense-watch-search-schema"

export const TYPESENSE_WATCH_TOKENIZER_LOCALES = [
  "en",
  "fr",
  "es",
  "ru",
  "ar",
  "pt",
  "de",
  "zh",
  "it",
  "fa",
  "th",
  "hi",
  "vi",
  "tr",
  "ja",
  "ko",
  "bn",
  "id",
  "ro",
  "km",
  "ur",
  "te",
  "kk",
  "ta",
  "pl",
] as const

export type TypesenseWatchTokenizerLocale =
  (typeof TYPESENSE_WATCH_TOKENIZER_LOCALES)[number]

const TYPESENSE_WATCH_TOKENIZER_LOCALE_SET = new Set<string>(
  TYPESENSE_WATCH_TOKENIZER_LOCALES,
)

export type TypesenseWatchLexicalDocument = {
  id: string
  videoId: string
  canonicalVideoId: string
  localeCodes: string[]
  localesJson: string
} & Record<string, string | string[]>

export type TypesenseKeywordMemoryEstimate = {
  searchableBytes: number
  estimatedRamLowBytes: number
  estimatedRamHighBytes: number
}

export function typesenseWatchTokenizerLocale(
  locale: string,
): TypesenseWatchTokenizerLocale | null {
  const base = locale.trim().toLocaleLowerCase().split("-")[0]
  return base && TYPESENSE_WATCH_TOKENIZER_LOCALE_SET.has(base)
    ? (base as TypesenseWatchTokenizerLocale)
    : null
}

function appendUnique(
  document: TypesenseWatchLexicalDocument,
  field: string,
  value: string | null,
): void {
  const normalized = value?.trim()
  if (!normalized) return
  const values = document[field]
  if (Array.isArray(values)) {
    if (!values.includes(normalized)) values.push(normalized)
    return
  }
  document[field] = [normalized]
}

function parseLocales(document: TypesenseWatchCatalogDocument) {
  const value = JSON.parse(document.localesJson) as unknown
  if (!Array.isArray(value)) {
    throw new Error(`Catalog locales are malformed for video ${document.id}`)
  }
  return value as TypesenseWatchLocale[]
}

export function buildTypesenseWatchLexicalDocuments(
  catalog: readonly TypesenseWatchCatalogDocument[],
): TypesenseWatchLexicalDocument[] {
  return catalog.map((catalogDocument) => {
    const locales = parseLocales(catalogDocument)
    const document: TypesenseWatchLexicalDocument = {
      id: catalogDocument.id,
      videoId: catalogDocument.id,
      canonicalVideoId: canonicalTypesenseVideoId(
        catalogDocument.id,
        catalogDocument.coreId,
      ),
      localeCodes: locales.map((locale) => locale.locale),
      localesJson: catalogDocument.localesJson,
    }

    for (const locale of locales) {
      const tokenizerLocale = typesenseWatchTokenizerLocale(locale.locale)
      const suffix = tokenizerLocale ?? "fallback"
      appendUnique(document, `title_${suffix}`, locale.title)
      appendUnique(document, `metadata_${suffix}`, locale.description)
    }
    return document
  })
}

export function estimateTypesenseKeywordMemory(
  documents: readonly TypesenseWatchLexicalDocument[],
): TypesenseKeywordMemoryEstimate {
  let searchableBytes = 0
  for (const document of documents) {
    for (const [field, value] of Object.entries(document)) {
      if (!field.startsWith("title_") && !field.startsWith("metadata_")) {
        continue
      }
      const values = Array.isArray(value) ? value : [value]
      for (const text of values) {
        searchableBytes += new TextEncoder().encode(text).byteLength
      }
    }
  }
  return {
    searchableBytes,
    estimatedRamLowBytes: searchableBytes * 2,
    estimatedRamHighBytes: searchableBytes * 3,
  }
}
