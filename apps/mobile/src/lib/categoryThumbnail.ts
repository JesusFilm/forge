import { resolveImageUrl } from "./resolveImageUrl"

/**
 * Extract the first search result's resolved thumbnail URL, or null. Pure (no
 * Apollo/network), so the browse-category thumbnail logic is unit-testable.
 */
export function pickThumbnailUrl(searchData: unknown): string | null {
  const results = (
    searchData as
      | { search?: { results?: ({ imageUrl?: string | null } | null)[] } }
      | null
      | undefined
  )?.search?.results
  return resolveImageUrl(results?.[0]?.imageUrl ?? null)
}
