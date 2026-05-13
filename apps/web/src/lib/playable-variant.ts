// A "playable" language variant is a published variant with an HLS stream
// URL and a non-null language slug. Three call sites in the watch tree need
// this exact predicate:
//   - WatchSectionRenderer.tsx (computes playableLanguageCount for the hero)
//   - LanguagePickerModal.tsx (builds the combobox options)
//   - language-preference-server.ts shouldRedirectForPreference (decides
//     whether to redirect to the user's preferred language)
// Keeping the rule in one place prevents subtle drift (one site forgetting
// the null-narrow or the slug check) that would let the globe button appear
// for a video whose modal has zero options, or vice versa.

export type PlayableVariantShape = {
  language?: { slug?: string | null } | null
  published?: boolean | null
  hls?: string | null
}

// Generic over T so the predicate narrows the call-site's input type rather
// than collapsing it to the bare PlayableVariantShape. Call sites pass their
// own variant type (e.g. LanguagePickerVariant) which carries additional
// fields like `name`, `coreId`, `documentId` — those survive the narrow.
export function isPlayableLanguageVariant<T extends PlayableVariantShape>(
  v: T | null | undefined,
): v is T & {
  language: NonNullable<T["language"]> & { slug: string }
  published: true
  hls: string
} {
  return (
    v != null &&
    v.published === true &&
    v.hls != null &&
    v.language != null &&
    v.language.slug != null
  )
}
