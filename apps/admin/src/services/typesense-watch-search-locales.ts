import { resolveVideoDisplayTitle } from "@forge/content-display"
import type { TypesenseCollectionField } from "./typesense-client"
import type {
  TypesenseWatchCatalogDocument,
  TypesenseWatchLocale,
} from "./typesense-watch-search-schema"
import { typesenseWatchTokenizerLocale } from "./typesense-watch-search-lexical"

export type TypesenseWatchLexicalLane = "title" | "metadata"

export function watchLexicalQueryFields(
  locale: string,
  lane: TypesenseWatchLexicalLane,
): string[] {
  const tokenizerLocale = typesenseWatchTokenizerLocale(locale)
  return tokenizerLocale
    ? [`${lane}_${tokenizerLocale}`, `${lane}_fallback`]
    : [`${lane}_fallback`]
}

export function watchLexicalManifestQueryFields(
  fields: readonly TypesenseCollectionField[],
  lane: TypesenseWatchLexicalLane,
): string[] {
  const prefix = `${lane}_`
  return fields.flatMap((field) =>
    field.name.startsWith(prefix) &&
    field.index !== false &&
    (field.type === "string" || field.type === "string[]")
      ? [field.name]
      : [],
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
  document: Pick<TypesenseWatchCatalogDocument, "localesJson" | "titles"> &
    Partial<Pick<TypesenseWatchCatalogDocument, "slug">>,
  preferredLocale: string,
): TypesenseWatchLocale {
  const locales = parsedLocales(document.localesJson)
  const exactLocales = locales.filter(
    (locale) => locale.locale === preferredLocale,
  )
  const broadLocale = preferredLocale.slice(0, 2)
  const broadLocales =
    broadLocale === preferredLocale
      ? []
      : locales.filter((locale) => locale.locale === broadLocale)
  const englishLocales = locales.filter(
    (locale) => locale.locale === "en" || locale.languageSlug === "english",
  )
  const requestedLocale = exactLocales[0] ?? broadLocales[0]

  return {
    ...(requestedLocale ?? {
      locale: preferredLocale,
      description: null,
    }),
    title:
      resolveVideoDisplayTitle({
        requestedTitles: [...exactLocales, ...broadLocales].map(
          ({ title }) => title,
        ),
        englishTitles: englishLocales.map(({ title }) => title),
        slug: document.slug,
      }) ?? "",
  }
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
