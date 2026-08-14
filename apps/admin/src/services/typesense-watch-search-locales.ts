import type { TypesenseCollectionField } from "./typesense-client"
import type {
  TypesenseWatchCatalogDocument,
  TypesenseWatchLocale,
} from "./typesense-watch-search-schema"
import { TYPESENSE_WATCH_EXACT_TITLE_KEYS_FIELD } from "./typesense-watch-search-exact-title"
import {
  typesenseWatchStemmerLocale,
  typesenseWatchTokenizerLocale,
} from "./typesense-watch-search-lexical"

export type TypesenseWatchLexicalLane = "title" | "metadata" | "taxonomy"
export type TypesenseWatchLexicalVariant = "exact" | "stem"

export function watchLexicalQueryFields(
  locale: string,
  lane: TypesenseWatchLexicalLane,
  variant: TypesenseWatchLexicalVariant = "exact",
): string[] {
  const tokenizerLocale =
    variant === "stem" || lane === "taxonomy"
      ? typesenseWatchStemmerLocale(locale)
      : typesenseWatchTokenizerLocale(locale)
  if (variant === "stem") {
    return tokenizerLocale ? [`${lane}_stem_${tokenizerLocale}`] : []
  }
  return tokenizerLocale
    ? [`${lane}_${tokenizerLocale}`, `${lane}_fallback`]
    : [`${lane}_fallback`]
}

export function watchLexicalManifestQueryFields(
  fields: readonly TypesenseCollectionField[],
  lane: TypesenseWatchLexicalLane,
  variant: TypesenseWatchLexicalVariant = "exact",
): string[] {
  const prefix = variant === "stem" ? `${lane}_stem_` : `${lane}_`
  const excludedPrefix = `${lane}_stem_`
  return fields.flatMap((field) =>
    field.name.startsWith(prefix) &&
    (variant === "stem" || !field.name.startsWith(excludedPrefix)) &&
    field.name !== TYPESENSE_WATCH_EXACT_TITLE_KEYS_FIELD &&
    field.index !== false &&
    (field.type === "string" || field.type === "string[]")
      ? [field.name]
      : [],
  )
}

export function watchLexicalOrderedManifestQueryFields(
  fields: readonly TypesenseCollectionField[],
  lane: TypesenseWatchLexicalLane,
  preferredLocales: readonly string[],
): string[] {
  const manifestFields = watchLexicalManifestQueryFields(fields, lane)
  const availableFields = new Set(manifestFields)
  const preferredFields = preferredLocales.flatMap((locale) => {
    const tokenizerLocale = typesenseWatchTokenizerLocale(locale)
    return tokenizerLocale ? [`${lane}_${tokenizerLocale}`] : []
  })
  const fallbackField = `${lane}_fallback`

  return [...preferredFields, fallbackField, ...manifestFields].filter(
    (field, index, all) =>
      availableFields.has(field) && all.indexOf(field) === index,
  )
}

export type TypesenseWatchCatalogPreviewDocument = Pick<
  TypesenseWatchCatalogDocument,
  "id" | "titles" | "audioLanguageSlugs" | "subtitleLanguageSlugs"
> &
  Partial<Pick<TypesenseWatchCatalogDocument, "localeCodes" | "localesJson">>

function parsedLocales(value: string): TypesenseWatchLocale[] {
  const parsed: unknown = JSON.parse(value)
  return Array.isArray(parsed) ? (parsed as TypesenseWatchLocale[]) : []
}

export function displayLocale(
  document: Pick<TypesenseWatchCatalogDocument, "localesJson" | "titles">,
  preferredLocale: string,
): TypesenseWatchLocale {
  const locales = parsedLocales(document.localesJson)
  return (
    locales.find((locale) => locale.locale === preferredLocale) ??
    locales.find((locale) => locale.locale === preferredLocale.slice(0, 2)) ??
    locales.find((locale) => locale.locale === "en") ??
    locales[0] ?? {
      locale: preferredLocale,
      title: document.titles[0] ?? "",
      description: null,
    }
  )
}

export function hasAlignedLocaleCodes(
  document: TypesenseWatchCatalogPreviewDocument,
): document is TypesenseWatchCatalogPreviewDocument & {
  localeCodes: string[]
} {
  return (
    Array.isArray(document.localeCodes) &&
    document.localeCodes.length > 0 &&
    document.localeCodes.length === document.titles.length
  )
}

export function displayPreviewLocale(
  document: TypesenseWatchCatalogPreviewDocument,
  preferredLocale: string,
): TypesenseWatchLocale {
  if (hasAlignedLocaleCodes(document)) {
    const preferredIndex = document.localeCodes.findIndex(
      (locale) => locale === preferredLocale,
    )
    const baseLanguageIndex = document.localeCodes.findIndex(
      (locale) => locale === preferredLocale.slice(0, 2),
    )
    const englishIndex = document.localeCodes.findIndex(
      (locale) => locale === "en",
    )
    const index =
      preferredIndex >= 0
        ? preferredIndex
        : baseLanguageIndex >= 0
          ? baseLanguageIndex
          : englishIndex >= 0
            ? englishIndex
            : 0
    return {
      locale: document.localeCodes[index] ?? preferredLocale,
      title: document.titles[index] ?? document.titles[0] ?? "",
      description: null,
    }
  }
  if (typeof document.localesJson === "string") {
    return displayLocale(
      {
        localesJson: document.localesJson,
        titles: document.titles,
      },
      preferredLocale,
    )
  }
  return {
    locale: preferredLocale,
    title: document.titles[0] ?? "",
    description: null,
  }
}
