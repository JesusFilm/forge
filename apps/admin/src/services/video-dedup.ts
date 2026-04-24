/**
 * Shared video-identity deduplication primitive.
 *
 * Factored out of `hybrid-search-fusion.ts` so both R4 (hybrid search) and
 * R5 (scene recommendations) consume the same 3-layer dedup logic without
 * duplication. The primitive operates on a structural row shape so callers
 * can pass any object that carries the identity fields, without having to
 * wrap rows in the `FusedResult` envelope (R5 has no RRF score).
 *
 * Three layers, checked in order against already-kept rows:
 *   1. `videoCoreId` prefix match — catches ad-format variants where one
 *      coreId is a prefix of another (e.g. "4_Win4GoodNewsJesus" vs
 *      "4_Win4GoodNewsJesusAD1x1").
 *   2. Exact `videoTitle` match — catches cross-series duplicates where
 *      the same scene exists in multiple film series with different
 *      coreIds but identical titles.
 *   3. `embeddingText` cosine similarity > 0.95 — safety net for
 *      unlabelled near-duplicates.
 *
 * Non-video rows (`resultType !== "video"`, used by hybrid search's
 * experience results) skip the 3 layer checks and only obey the limit
 * cap. Rows without a `resultType` are treated as videos — R5 passes rows
 * with no resultType field because recommendations are always videos.
 *
 * Input MUST be pre-sorted by caller-chosen score descending; the
 * primitive keeps the first-seen unique row and discards later
 * duplicates.
 */

export type VideoDedupKeys = {
  resultType?: string
  videoCoreId?: string | null
  videoTitle?: string | null
  embeddingText?: string | null
}

/**
 * Generic 3-layer dedup over a structural shape. Returns up to `limit`
 * rows in the order they were supplied (first-kept wins).
 */
export function dedupeByVideoIdentity<T extends VideoDedupKeys>(
  rows: T[],
  limit: number,
): T[] {
  const deduped: T[] = []

  for (const candidate of rows) {
    if (deduped.length >= limit) break

    const candidateIsVideo =
      candidate.resultType === undefined || candidate.resultType === "video"

    let isDuplicate = false

    if (candidateIsVideo) {
      for (const kept of deduped) {
        const keptIsVideo =
          kept.resultType === undefined || kept.resultType === "video"
        if (!keptIsVideo) continue

        // Check 1: coreId prefix match
        if (candidate.videoCoreId && kept.videoCoreId) {
          const a = candidate.videoCoreId
          const b = kept.videoCoreId
          if (a.startsWith(b) || b.startsWith(a)) {
            isDuplicate = true
            break
          }
        }

        // Check 2: exact title match
        if (
          candidate.videoTitle &&
          kept.videoTitle &&
          candidate.videoTitle === kept.videoTitle
        ) {
          isDuplicate = true
          break
        }

        // Check 3: embedding similarity
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
    }

    if (!isDuplicate) {
      deduped.push(candidate)
    }
  }

  return deduped
}

/**
 * Cosine similarity between two embedding vectors stored as pgvector text
 * format: "[0.1,0.2,...]". Used only for inter-result dedup (typically
 * <=60 candidates), so the parse-on-every-call overhead is negligible.
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
