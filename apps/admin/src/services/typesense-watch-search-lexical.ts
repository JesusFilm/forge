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

const TYPESENSE_WATCH_TOKENIZER_LOCALE_SET = new Set<string>(
  TYPESENSE_WATCH_TOKENIZER_LOCALES,
)

export const TYPESENSE_WATCH_TAXONOMY_MAX_TERMS = 32
export const TYPESENSE_WATCH_TAXONOMY_MAX_BYTES = 4_096

export type TypesenseWatchLexicalDocument = {
  id: string
  videoId: string
  canonicalVideoId: string
  languageIdentity: string
  localeCodes: string[]
} & Record<string, string | string[]>

export type TypesenseSearchableBytesByFamily = {
  baselineTitleMetadata: number
  stemTitleMetadata: number
  exactTaxonomy: number
  stemTaxonomy: number
}

export type TypesenseKeywordMemoryEstimate = {
  searchableBytes: number
  searchableBytesByFamily: TypesenseSearchableBytesByFamily
  estimatedRamLowBytes: number
  estimatedRamHighBytes: number
}

function searchableFieldFamily(
  field: string,
): keyof TypesenseSearchableBytesByFamily | null {
  if (field.startsWith("title_stem_") || field.startsWith("metadata_stem_")) {
    return "stemTitleMetadata"
  }
  if (field.startsWith("title_") || field.startsWith("metadata_")) {
    return "baselineTitleMetadata"
  }
  if (field.startsWith("taxonomy_stem_")) return "stemTaxonomy"
  if (field.startsWith("taxonomy_")) return "exactTaxonomy"
  return null
}

export function typesenseWatchTokenizerLocale(locale: string): string | null {
  const base = locale
    .trim()
    .toLocaleLowerCase()
    .replace(/_/g, "-")
    .split("-")[0]
  return base && TYPESENSE_WATCH_TOKENIZER_LOCALE_SET.has(base) ? base : null
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
  const slugIdentity = typesenseWatchLanguageSlugIdentity(languageSlug)
  if (slugIdentity) return slugIdentity
  const [normalizedLocale] = typesenseWatchLocaleCodes(locale)
  return normalizedLocale ? `locale:${normalizedLocale}` : null
}

export function typesenseWatchLanguageSlugIdentity(
  languageSlug: string | null | undefined,
): string | null {
  const normalizedSlug = languageSlug?.trim().toLocaleLowerCase()
  return normalizedSlug && /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(normalizedSlug)
    ? `slug:${normalizedSlug}`
    : null
}

function compareNormalizedText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export function normalizeTypesenseWatchTaxonomy(
  values: readonly string[],
): string[] {
  const normalized = [
    ...new Set(
      values.flatMap((value) => {
        const term = value.normalize("NFKC").replace(/\s+/gu, " ").trim()
        return term ? [term] : []
      }),
    ),
  ].sort(compareNormalizedText)
  const result: string[] = []
  let bytes = 0
  for (const term of normalized) {
    if (result.length >= TYPESENSE_WATCH_TAXONOMY_MAX_TERMS) break
    const termBytes = new TextEncoder().encode(term).byteLength
    if (bytes + termBytes > TYPESENSE_WATCH_TAXONOMY_MAX_BYTES) break
    result.push(term)
    bytes += termBytes
  }
  return result
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
      if (tokenizerLocale) {
        appendUnique(document, `title_stem_${suffix}`, locale.title)
        appendUnique(document, `metadata_stem_${suffix}`, locale.description)
      }
      for (const term of normalizeTypesenseWatchTaxonomy(
        locale.taxonomy ?? [],
      )) {
        appendUnique(document, `taxonomy_${suffix}`, term)
        if (tokenizerLocale) {
          appendUnique(document, `taxonomy_stem_${suffix}`, term)
        }
      }
      documents.set(languageIdentity, document)
    }
    return [...documents.values()]
  })
}

export function estimateTypesenseKeywordMemory(
  documents: readonly TypesenseWatchLexicalDocument[],
): TypesenseKeywordMemoryEstimate {
  const searchableBytesByFamily = {
    baselineTitleMetadata: 0,
    stemTitleMetadata: 0,
    exactTaxonomy: 0,
    stemTaxonomy: 0,
  }
  for (const document of documents) {
    for (const [field, value] of Object.entries(document)) {
      const family = searchableFieldFamily(field)
      if (!family) continue
      const values = Array.isArray(value) ? value : [value]
      for (const text of values) {
        searchableBytesByFamily[family] += new TextEncoder().encode(
          text,
        ).byteLength
      }
    }
  }
  const searchableBytes = Object.values(searchableBytesByFamily).reduce(
    (total, value) => total + value,
    0,
  )
  return {
    searchableBytes,
    searchableBytesByFamily,
    estimatedRamLowBytes: searchableBytes * 2,
    estimatedRamHighBytes: searchableBytes * 3,
  }
}
