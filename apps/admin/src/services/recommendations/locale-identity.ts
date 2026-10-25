export type RecommendationLocaleIdentity = Readonly<{
  transcriptLocale: string
  presentationLocale: string
  audioLanguageSlug: string
}>

/** Only the demonstrated Chinese aliases are normalized; other locales stay exact. */
export function recommendationTranscriptLocale(locale: string): string {
  return /^zh(?:-hans|-hant)?$/i.test(locale) ? "zh" : locale
}

/** The public locale is the requested display identity, never the audio identity. */
export function resolveRecommendationLocaleIdentity(
  locale: string,
  audioLanguageSlug: string,
): RecommendationLocaleIdentity {
  const requested = locale.trim()
  // Owner decision (2026-10-01): generic Chinese uses Simplified presentation.
  const presentationLocale = /^zh(?:-hans|-hant)?$/i.test(requested)
    ? requested.toLowerCase() === "zh"
      ? "zh-hans"
      : requested.toLowerCase()
    : requested
  return {
    transcriptLocale: recommendationTranscriptLocale(presentationLocale),
    presentationLocale,
    audioLanguageSlug: audioLanguageSlug.trim(),
  }
}
