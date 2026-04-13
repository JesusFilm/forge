/**
 * Reciprocal Rank Fusion (RRF) and deduplication for hybrid search.
 *
 * RRF merges N ranked lists (semantic, keyword, and future personalization)
 * into a single scored list. The 3-layer dedup strategy is adapted from
 * the recommender service (core_id prefix, exact title, embedding cosine
 * similarity) to remove duplicate videos before pagination.
 */

export type RankedItem = {
  videoId: number
  videoCoreId: string | null
  videoTitle: string
  embeddingText?: string
  [key: string]: unknown
}

export type FusedResult = RankedItem & {
  score: number
}

/**
 * Merges N ranked lists into a single list using Reciprocal Rank Fusion.
 *
 * For each video across all lists, the fused score is:
 *   score = sum(1 / (k + rank_i)) for each list where the video appears
 *
 * Scores are normalized to [0, 1] by dividing by the theoretical maximum
 * (when a video is rank 1 in every list): lists.length / (k + 1).
 *
 * When a video appears in multiple lists, properties are merged with
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

  // Accumulate RRF scores and collect properties per video
  const scoreMap = new Map<number, number>()
  const propsMap = new Map<number, RankedItem>()

  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank++) {
      const item = list[rank]
      const rank1Based = rank + 1
      const contribution = 1 / (k + rank1Based)

      scoreMap.set(
        item.videoId,
        (scoreMap.get(item.videoId) ?? 0) + contribution,
      )

      // Merge properties — earlier lists take priority for overlapping keys
      const existing = propsMap.get(item.videoId)
      if (existing == null) {
        propsMap.set(item.videoId, { ...item })
      } else {
        // Add keys from this item that don't already exist on the merged object
        for (const key of Object.keys(item)) {
          if (!(key in existing) || existing[key] == null) {
            existing[key] = item[key]
          }
        }
      }
    }
  }

  // Normalize scores to [0, 1]
  const theoreticalMax = lists.length / (k + 1)

  const results: FusedResult[] = []
  scoreMap.forEach((rawScore, videoId) => {
    const props = propsMap.get(videoId)!
    results.push({
      ...props,
      videoId,
      score: theoreticalMax > 0 ? rawScore / theoreticalMax : 0,
    })
  })

  // Sort by score descending
  results.sort((a, b) => b.score - a.score)

  return results
}

/**
 * 3-layer deduplication adapted from the recommender service.
 *
 * Given a list of fused results sorted by score descending, removes
 * duplicates using three strategies:
 *
 * 1. core_id prefix match — catches ad-format variants where one core_id
 *    is a prefix of the other (e.g. "4_Win4GoodNewsJesus" and
 *    "4_Win4GoodNewsJesusAD1x1").
 * 2. Exact title match — catches cross-series duplicates where the same
 *    scene exists in multiple film series with different core_ids.
 * 3. Embedding similarity >0.95 — safety net for unlabeled near-duplicates.
 *
 * The higher-scored result is always kept; the lower-scored duplicate is
 * discarded. Stops collecting once `limit` unique results are found.
 *
 * @param results - Must be pre-sorted by score descending.
 * @param limit   - Stop collecting after this many unique results.
 */
export function deduplicateResults(
  results: FusedResult[],
  limit: number,
): FusedResult[] {
  const deduped: FusedResult[] = []

  for (const candidate of results) {
    if (deduped.length >= limit) break

    let isDuplicate = false
    for (const kept of deduped) {
      // Check 1: core_id prefix match (ad-format variants)
      if (candidate.videoCoreId && kept.videoCoreId) {
        const a = candidate.videoCoreId
        const b = kept.videoCoreId
        if (a.startsWith(b) || b.startsWith(a)) {
          isDuplicate = true
          break
        }
      }

      // Check 2: exact title match (cross-series same scene)
      if (
        candidate.videoTitle &&
        kept.videoTitle &&
        candidate.videoTitle === kept.videoTitle
      ) {
        isDuplicate = true
        break
      }

      // Check 3: embedding similarity (safety net for unlabeled duplicates)
      if (candidate.embeddingText && kept.embeddingText) {
        const sim = cosineSimilarityFromText(
          candidate.embeddingText,
          kept.embeddingText,
        )
        if (sim > 0.95) {
          isDuplicate = true
          break
        }
      }
    }

    if (!isDuplicate) {
      deduped.push(candidate)
    }
  }

  return deduped
}

/**
 * Computes cosine similarity between two embedding vectors stored as
 * pgvector text format: "[0.1,0.2,...]". This is used only for
 * inter-result dedup (typically <=60 candidates), so parsing overhead
 * is negligible.
 */
export function cosineSimilarityFromText(a: string, b: string): number {
  const va = a.slice(1, -1).split(",").map(Number)
  const vb = b.slice(1, -1).split(",").map(Number)
  if (va.length !== vb.length || va.length === 0) return 0

  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < va.length; i++) {
    dot += va[i] * vb[i]
    normA += va[i] * va[i]
    normB += vb[i] * vb[i]
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}
