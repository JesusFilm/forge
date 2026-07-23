type SeriesLanguageOption = {
  slug?: string | null
  bcp47?: string | null
}

export type ResolvedSeriesLanguage = {
  slug: string
  bcp47: string | null
}

export function resolveSeriesLanguageIdentity(
  options: readonly SeriesLanguageOption[],
  requested: string,
  fallback?: SeriesLanguageOption | null,
): ResolvedSeriesLanguage | null {
  const requestedLower = requested.toLowerCase()
  const validOptions = options.flatMap((option) => {
    const slug = option.slug?.trim()
    if (!slug) return []
    return [{ slug, bcp47: option.bcp47?.trim() || null }]
  })
  const selected =
    validOptions.find(
      (option) =>
        option.slug === requested ||
        option.slug.toLowerCase() === requestedLower,
    ) ??
    validOptions.find(
      (option) => option.bcp47?.toLowerCase() === requestedLower,
    ) ??
    validOptions[0] ??
    (() => {
      const slug = fallback?.slug?.trim()
      if (!slug) return null
      return { slug, bcp47: fallback?.bcp47?.trim() || null }
    })()

  return selected ?? null
}
