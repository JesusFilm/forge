export type DisplayTitleCandidate = string | null | undefined

export interface VideoDisplayTitleInput {
  requestedTitles?: readonly DisplayTitleCandidate[]
  englishTitles?: readonly DisplayTitleCandidate[]
  slug?: string | null
}

export function firstNonBlankText(
  candidates: readonly DisplayTitleCandidate[] | null | undefined,
): string | undefined {
  for (const candidate of candidates ?? []) {
    const trimmed = candidate?.trim()
    if (trimmed) return trimmed
  }
}

export function humanizeContentSlug(
  slug: string | null | undefined,
): string | undefined {
  const words = slug
    ?.trim()
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))

  return words && words.length > 0 ? words.join(" ") : undefined
}

export function resolveVideoDisplayTitle({
  requestedTitles,
  englishTitles,
  slug,
}: VideoDisplayTitleInput): string | undefined {
  return (
    firstNonBlankText(requestedTitles) ??
    firstNonBlankText(englishTitles) ??
    humanizeContentSlug(slug)
  )
}
