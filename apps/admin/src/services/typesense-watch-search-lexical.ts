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

export type TypesenseWatchLexicalDocument = {
  id: string
  videoId: string
  canonicalVideoId: string
  languageIdentity: string
  localeCodes: string[]
} & Record<string, string | string[]>

export type TypesenseKeywordMemoryEstimate = {
  searchableBytes: number
  estimatedRamLowBytes: number
  estimatedRamHighBytes: number
}

export function typesenseWatchTokenizerLocale(locale: string): string | null {
  const base = locale.trim().toLocaleLowerCase().split("-")[0]
  return base && /^[a-z]{2}$/.test(base) ? base : null
}

export function typesenseWatchLocaleCodes(locale: string): string[] {
  const normalized = locale.trim().toLocaleLowerCase().replace(/_/g, "-")
  return /^(?:[a-z]{2,8}|[ix])(?:-[a-z0-9]{1,8})*$/.test(normalized)
    ? [normalized]
    : []
}

export function typesenseWatchLanguageIdentity({
  languageSlug,
  locale,
}: Pick<TypesenseWatchLocale, "languageSlug" | "locale">): string | null {
  const normalizedSlug = languageSlug?.trim().toLocaleLowerCase()
  if (normalizedSlug && /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(normalizedSlug)) {
    return `slug:${normalizedSlug}`
  }
  const [normalizedLocale] = typesenseWatchLocaleCodes(locale)
  return normalizedLocale ? `locale:${normalizedLocale}` : null
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
  return catalog.flatMap((catalogDocument) => {
    const documents = new Map<string, TypesenseWatchLexicalDocument>()
    for (const locale of parseLocales(catalogDocument)) {
      const localeCodes = typesenseWatchLocaleCodes(locale.locale)
      const languageIdentity = typesenseWatchLanguageIdentity(locale)
      if (!languageIdentity) {
        throw new Error(
          `Catalog locale has no safe language identity for video ${catalogDocument.id}`,
        )
      }
      const document =
        documents.get(languageIdentity) ??
        ({
          id: `${catalogDocument.id}:${languageIdentity}`,
          videoId: catalogDocument.id,
          canonicalVideoId: canonicalTypesenseVideoId(
            catalogDocument.id,
            catalogDocument.coreId,
          ),
          languageIdentity,
          localeCodes: [],
        } satisfies TypesenseWatchLexicalDocument)
      for (const localeCode of localeCodes) {
        if (!document.localeCodes.includes(localeCode)) {
          document.localeCodes.push(localeCode)
        }
      }
      const tokenizerLocale = typesenseWatchTokenizerLocale(locale.locale)
      const suffix = tokenizerLocale ?? "fallback"
      appendUnique(document, `title_${suffix}`, locale.title)
      appendUnique(document, `metadata_${suffix}`, locale.description)
      documents.set(languageIdentity, document)
    }
    return [...documents.values()]
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

export function typesenseWatchTokenizerLocales(
  documents: readonly TypesenseWatchLexicalDocument[],
): string[] {
  const locales = new Set<string>(TYPESENSE_WATCH_TOKENIZER_LOCALES)
  for (const document of documents) {
    for (const field of Object.keys(document)) {
      const match = /^(?:title|metadata)_([a-z]{2})$/.exec(field)
      if (match?.[1]) locales.add(match[1])
    }
  }
  return [...locales].sort()
}
