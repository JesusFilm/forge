const ROMANIAN_LANGUAGE_SLUG = "romanian"

const ROMANIAN_CROSS_LOCALE_QUERY_VARIANTS = new Map([
  ["isus", "JESUS"],
  ["iisus", "JESUS"],
])

function normalizedComparisonKey(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("ro")
}

/**
 * Returns the original query followed by bounded, language-scoped lexical
 * variants. Variants are vocabulary normalization only: they never identify a
 * catalog record and still pass through normal retrieval and watchability.
 */
export function watchSearchQueryVariants({
  query,
  targetLanguageSlug,
}: {
  query: string
  targetLanguageSlug: string | null
}): string[] {
  const variants = [query]
  if (targetLanguageSlug !== ROMANIAN_LANGUAGE_SLUG) return variants

  const normalizedQuery = normalizedComparisonKey(query)
  const crossLocaleVariant =
    ROMANIAN_CROSS_LOCALE_QUERY_VARIANTS.get(normalizedQuery)
  if (!crossLocaleVariant) return variants

  const seen = new Set(variants.map(normalizedComparisonKey))
  if (!seen.has(normalizedComparisonKey(crossLocaleVariant))) {
    variants.push(crossLocaleVariant)
  }
  return variants
}
