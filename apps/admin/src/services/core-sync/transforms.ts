import type { VideoLabel, VideoSource } from "@prisma/client"

export type CoreLocalizedValue = {
  value: string
  primary?: boolean | null
  order?: number | null
  language?: {
    id?: string | null
    bcp47?: string | null
  } | null
}

export type LanguageLookup = {
  bcp47ByCoreId?: Map<string, string | null | undefined>
  slugByCoreId?: Map<string, string | null | undefined>
}

export function toNameMap(
  values: CoreLocalizedValue[],
  lookup: LanguageLookup = {},
): Record<string, string> {
  const map: Record<string, string> = {}
  for (const value of values) {
    const locale = localeFor(value, lookup)
    if (locale) map[locale] = value.value
  }
  return map
}

export type LocalizedNameInput = {
  locale: string
  value: string
  primary: boolean
  order: number | null
}

export function toLocalizedNames(
  values: CoreLocalizedValue[],
  lookup: LanguageLookup = {},
): LocalizedNameInput[] {
  const byLocale = new Map<string, LocalizedNameInput>()
  for (const value of values) {
    const locale = localeFor(value, lookup)
    if (!locale) continue
    const existing = byLocale.get(locale)
    byLocale.set(locale, {
      locale,
      value: value.value,
      primary: (existing?.primary ?? false) || (value.primary ?? false),
      order: value.order ?? existing?.order ?? null,
    })
  }
  return [...byLocale.values()].sort((a, b) => a.locale.localeCompare(b.locale))
}

export function localeFor(
  value: CoreLocalizedValue,
  lookup: LanguageLookup = {},
): string | null {
  const bcp47 = value.language?.bcp47
  if (bcp47) return bcp47

  const languageId = value.language?.id
  if (!languageId) return null
  return lookup.bcp47ByCoreId?.get(languageId) ?? null
}

export type VideoLocaleInput = {
  locale: string | null
  languageCoreId: string | null
  languageSlug: string | null
  title: string | null
  description: string | null
  snippet: string | null
  imageAlt: string | null
  primary: boolean
}

export function toVideoLocales(
  fields: {
    title: CoreLocalizedValue[]
    description: CoreLocalizedValue[]
    snippet: CoreLocalizedValue[]
    imageAlt: CoreLocalizedValue[]
  },
  lookup: LanguageLookup = {},
): VideoLocaleInput[] {
  const localeKeys = new Set<string>()
  for (const values of Object.values(fields)) {
    for (const value of values) {
      const key = localizedValueKey(value, lookup)
      if (key) localeKeys.add(key)
    }
  }

  return [...localeKeys].sort().map((key) => ({
    locale: localeForKey(key, lookup),
    languageCoreId: languageCoreIdForKey(key),
    languageSlug: languageSlugForKey(key, lookup),
    title: lastLocalizedValue(fields.title, key, lookup),
    description: lastLocalizedValue(fields.description, key, lookup),
    snippet: lastLocalizedValue(fields.snippet, key, lookup),
    imageAlt: lastLocalizedValue(fields.imageAlt, key, lookup),
    primary:
      hasPrimaryForLocale(fields.title, key, lookup) ||
      hasPrimaryForLocale(fields.description, key, lookup) ||
      hasPrimaryForLocale(fields.snippet, key, lookup) ||
      hasPrimaryForLocale(fields.imageAlt, key, lookup),
  }))
}

export type StudyQuestionInput = {
  coreId: string
  locale: string | null
  languageCoreId: string | null
  languageSlug: string | null
  text: string
  primary: boolean
  order: number | null
}

export function toStudyQuestions(
  values: Array<CoreLocalizedValue & { id: string }>,
  lookup: LanguageLookup = {},
): StudyQuestionInput[] {
  return values.map((value) => ({
    coreId: value.id,
    locale: localeFor(value, lookup),
    languageCoreId: value.language?.id ?? null,
    languageSlug: languageSlugFor(value, lookup),
    text: value.value,
    primary: value.primary ?? false,
    order: value.order ?? null,
  }))
}

export type VideoLabelValue = VideoLabel | null

export function mapVideoLabel(label: string | null): VideoLabelValue {
  if (!label) return null
  const labels: Record<string, VideoLabel> = {
    collection: "COLLECTION",
    episode: "EPISODE",
    featureFilm: "FEATURE_FILM",
    segment: "SEGMENT",
    series: "SERIES",
    shortFilm: "SHORT_FILM",
    trailer: "TRAILER",
    behindTheScenes: "BEHIND_THE_SCENES",
  }
  return labels[label] ?? null
}

export function mapVideoSource(source: string | null): VideoSource | null {
  if (!source) return null
  const sources: Record<string, VideoSource> = {
    internal: "INTERNAL",
    youTube: "YOUTUBE",
    youtube: "YOUTUBE",
    cloudflare: "CLOUDFLARE",
    mux: "MUX",
  }
  return sources[source] ?? null
}

function lastLocalizedValue(
  values: CoreLocalizedValue[],
  key: string,
  lookup: LanguageLookup,
): string | null {
  let result: string | null = null
  for (const value of values) {
    if (localizedValueKey(value, lookup) === key) result = value.value
  }
  return result
}

function hasPrimaryForLocale(
  values: CoreLocalizedValue[],
  key: string,
  lookup: LanguageLookup,
): boolean {
  return values.some(
    (value) =>
      localizedValueKey(value, lookup) === key && value.primary === true,
  )
}

function localizedValueKey(
  value: CoreLocalizedValue,
  lookup: LanguageLookup,
): string | null {
  const languageId = value.language?.id
  if (languageId) return `core:${languageId}`
  const locale = localeFor(value, lookup)
  return locale ? `locale:${locale}` : null
}

function localeForKey(key: string, lookup: LanguageLookup): string | null {
  if (key.startsWith("locale:")) return key.slice("locale:".length)
  const languageCoreId = languageCoreIdForKey(key)
  return languageCoreId
    ? (lookup.bcp47ByCoreId?.get(languageCoreId) ?? null)
    : null
}

function languageCoreIdForKey(key: string): string | null {
  return key.startsWith("core:") ? key.slice("core:".length) : null
}

function languageSlugFor(
  value: CoreLocalizedValue,
  lookup: LanguageLookup,
): string | null {
  const languageId = value.language?.id
  if (!languageId) return null
  return lookup.slugByCoreId?.get(languageId) ?? null
}

function languageSlugForKey(
  key: string,
  lookup: LanguageLookup,
): string | null {
  const languageCoreId = languageCoreIdForKey(key)
  return languageCoreId
    ? (lookup.slugByCoreId?.get(languageCoreId) ?? null)
    : null
}
