import type Mux from "@mux/mux-node"

export type SupportedMuxGeneratedSubtitleLanguage = NonNullable<
  Mux.Video.AssetCreateParams.Input.GeneratedSubtitle["language_code"]
>
export type MuxGeneratedSubtitleLanguage =
  | SupportedMuxGeneratedSubtitleLanguage
  | "auto"

export type CmsLanguageMetadata = {
  coreId?: string | null
  bcp47?: string | null
  iso3?: string | null
}

const ORDERED_SUPPORTED_MUX_GENERATED_SUBTITLE_LANGUAGES = [
  "bg",
  "ca",
  "cs",
  "da",
  "de",
  "el",
  "en",
  "es",
  "fi",
  "fr",
  "hr",
  "it",
  "nl",
  "no",
  "pl",
  "pt",
  "ro",
  "ru",
  "sk",
  "sv",
  "tr",
  "uk",
] satisfies SupportedMuxGeneratedSubtitleLanguage[]

const SUPPORTED_MUX_GENERATED_SUBTITLE_LANGUAGES =
  new Set<MuxGeneratedSubtitleLanguage>([
    "auto",
    ...ORDERED_SUPPORTED_MUX_GENERATED_SUBTITLE_LANGUAGES,
  ])

const SOURCE_LANGUAGE_FALLBACKS = [
  "en",
  "es",
  "fr",
] satisfies SupportedMuxGeneratedSubtitleLanguage[]

const ISO3_TO_LANGUAGE_ROOT: Partial<Record<string, string>> = {
  ara: "ar",
  bul: "bg",
  cat: "ca",
  ces: "cs",
  cze: "cs",
  dan: "da",
  deu: "de",
  ger: "de",
  ell: "el",
  gre: "el",
  eng: "en",
  fas: "fa",
  per: "fa",
  spa: "es",
  fin: "fi",
  fra: "fr",
  fre: "fr",
  heb: "he",
  hin: "hi",
  hrv: "hr",
  ind: "id",
  ita: "it",
  jpn: "ja",
  kor: "ko",
  nld: "nl",
  dut: "nl",
  nor: "no",
  pol: "pl",
  por: "pt",
  ron: "ro",
  rum: "ro",
  rus: "ru",
  slk: "sk",
  slo: "sk",
  swe: "sv",
  tha: "th",
  tur: "tr",
  ukr: "uk",
  vie: "vi",
  zho: "zh",
  chi: "zh",
}

function normalizeLanguageRoot(
  value: string | null | undefined,
): string | null {
  if (!value) return null

  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return null

  return trimmed.split(/[-_]/)[0] ?? null
}

export function isMuxGeneratedSubtitleLanguage(
  value: string | null | undefined,
): value is MuxGeneratedSubtitleLanguage {
  return (
    typeof value === "string" &&
    SUPPORTED_MUX_GENERATED_SUBTITLE_LANGUAGES.has(
      value as MuxGeneratedSubtitleLanguage,
    )
  )
}

export function normalizeGeneratedSubtitleLanguage(
  language: string | null | undefined,
): MuxGeneratedSubtitleLanguage {
  const normalized = normalizeLanguageRoot(language)
  if (
    normalized &&
    isMuxGeneratedSubtitleLanguage(normalized as MuxGeneratedSubtitleLanguage)
  ) {
    return normalized as MuxGeneratedSubtitleLanguage
  }

  return "auto"
}

export function getOrderedSupportedMuxGeneratedSubtitleLanguages(): SupportedMuxGeneratedSubtitleLanguage[] {
  return [...ORDERED_SUPPORTED_MUX_GENERATED_SUBTITLE_LANGUAGES]
}

export function buildMuxSourceLanguagePriority(
  requestedLanguage: CmsLanguageMetadata | string | null | undefined,
): SupportedMuxGeneratedSubtitleLanguage[] {
  const requestedCode = resolveMuxSubtitleLanguageCode(requestedLanguage)
  const ordered = new Set<SupportedMuxGeneratedSubtitleLanguage>()

  if (requestedCode !== "auto") {
    ordered.add(requestedCode)
  }

  for (const fallback of SOURCE_LANGUAGE_FALLBACKS) {
    ordered.add(fallback)
  }

  for (const supportedCode of ORDERED_SUPPORTED_MUX_GENERATED_SUBTITLE_LANGUAGES) {
    ordered.add(supportedCode)
  }

  return [...ordered]
}

export function resolveCmsLanguageCode(
  language: CmsLanguageMetadata | string | null | undefined,
): string | null {
  if (!language) {
    return null
  }

  if (typeof language === "string") {
    const normalized = normalizeLanguageRoot(language)
    if (!normalized || /^\d+$/.test(normalized)) {
      return null
    }
    return normalized
  }

  const fromBcp47 = resolveCmsLanguageCode(language.bcp47)
  if (fromBcp47) {
    return fromBcp47
  }

  const fromCoreId = resolveCmsLanguageCode(language.coreId)
  if (fromCoreId) {
    return fromCoreId
  }

  const iso3 = normalizeLanguageRoot(language.iso3)
  if (iso3) {
    return ISO3_TO_LANGUAGE_ROOT[iso3] ?? null
  }

  return null
}

export function resolveMuxSubtitleLanguageCode(
  language: CmsLanguageMetadata | string | null | undefined,
): MuxGeneratedSubtitleLanguage {
  if (!language) {
    return "auto"
  }

  if (typeof language === "string") {
    return normalizeGeneratedSubtitleLanguage(language)
  }

  const fromBcp47 = normalizeGeneratedSubtitleLanguage(language.bcp47)
  if (fromBcp47 !== "auto") {
    return fromBcp47
  }

  const fromCoreId = normalizeGeneratedSubtitleLanguage(language.coreId)
  if (fromCoreId !== "auto") {
    return fromCoreId
  }

  const iso3 = normalizeLanguageRoot(language.iso3)
  if (iso3) {
    return normalizeGeneratedSubtitleLanguage(ISO3_TO_LANGUAGE_ROOT[iso3])
  }

  return "auto"
}
