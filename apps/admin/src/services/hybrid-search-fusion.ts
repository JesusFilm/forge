/**
 * Reciprocal Rank Fusion (RRF) for hybrid search.
 *
 * RRF merges N ranked lists (video semantic, video keyword, experience
 * semantic, experience keyword, and future personalization) into a single
 * scored list. Items are identified by a compound `${resultType}:${resultId}`
 * key so heterogeneous result types do not collide on shared IDs.
 *
 * The 3-layer dedup primitive lives in `./video-dedup.ts` so both hybrid
 * search and R5 scene recommendations consume identical logic without
 * duplication. `deduplicateResults` below is a thin `FusedResult`-typed
 * wrapper over the shared primitive.
 *
 * Ported from apps/cms/src/api/search/services/fusion.ts. The admin app
 * uses cuid string ids rather than cms's integer ids; otherwise the
 * algorithm is line-for-line identical so the two implementations can
 * evolve together.
 */

import { dedupeByVideoIdentity, cosineSimilarityFromText } from "./video-dedup"

export { cosineSimilarityFromText }

export type RankedItem = {
  resultType: "video" | "experience"
  resultId: string
  videoId?: number
  videoCoreId?: string | null
  videoTitle?: string
  embeddingText?: string
  [key: string]: unknown
}

export type FusedResult = RankedItem & {
  score: number
}

/**
 * Merges N ranked lists into a single list using Reciprocal Rank Fusion.
 *
 * For each item across all lists, the fused score is:
 *   score = sum(1 / (k + rank_i)) for each list where the item appears
 *
 * Scores are normalized to [0, 1] by dividing by the theoretical maximum
 * (when an item is rank 1 in every list): lists.length / (k + 1).
 *
 * When an item appears in multiple lists, properties are merged with
 * earlier lists taking priority for overlapping keys. This ensures
 * semantic results (which carry scene-level snippet/timestamp) take
 * precedence over keyword results (video-level only).
 *
 * @param lists - Array of ranked lists. Each list is ordered by relevance
 *                (index 0 = best). The order of lists matters for property
 *                merge priority.
 * @param k     - RRF constant. Default 60 (standard value).
 * @returns     - Fused results sorted by score descending.
 */
export function fuseRankedLists(
  lists: RankedItem[][],
  k: number = 60,
): FusedResult[] {
  if (lists.length === 0) return []

  // Accumulate RRF scores and collect properties per result.
  // Compound key prevents cross-type ID collision (e.g. video "x" vs experience "x").
  const scoreMap = new Map<string, number>()
  const propsMap = new Map<string, RankedItem>()

  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank++) {
      const item = list[rank]
      const key = `${item.resultType}:${item.resultId}`
      const rank1Based = rank + 1
      const contribution = 1 / (k + rank1Based)

      scoreMap.set(key, (scoreMap.get(key) ?? 0) + contribution)

      // Merge properties — earlier lists take priority for overlapping keys
      const existing = propsMap.get(key)
      if (existing == null) {
        propsMap.set(key, { ...item })
      } else {
        // Add keys from this item that don't already exist on the merged object.
        // Use `propKey` to avoid shadowing the outer compound `key` variable.
        for (const propKey of Object.keys(item)) {
          if (!(propKey in existing) || existing[propKey] == null) {
            existing[propKey] = item[propKey]
          }
        }
      }
    }
  }

  // Normalize scores to [0, 1]
  const theoreticalMax = lists.length / (k + 1)

  const results: FusedResult[] = []
  scoreMap.forEach((rawScore, key) => {
    const props = propsMap.get(key)!
    results.push({
      ...props,
      score: theoreticalMax > 0 ? rawScore / theoreticalMax : 0,
    })
  })

  // Sort by score descending
  results.sort((a, b) => b.score - a.score)

  return results
}

/**
 * Thin `FusedResult`-typed wrapper over `dedupeByVideoIdentity`. Preserves
 * the original hybrid-search dedup signature so callers and tests are
 * unchanged. See `./video-dedup.ts` for the layered algorithm and the
 * non-video pass-through rules.
 *
 * @param results - Must be pre-sorted by score descending.
 * @param limit   - Stop collecting after this many unique results.
 */
export function deduplicateResults(
  results: FusedResult[],
  limit: number,
): FusedResult[] {
  return dedupeByVideoIdentity(results, limit)
}
