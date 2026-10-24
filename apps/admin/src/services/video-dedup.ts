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

export type VideoIdentityDuplicateReason =
  | "core_prefix"
  | "exact_title"
  | "embedding_similarity"

/**
 * Returns the first shared canonical-video identity rule that makes two rows
 * duplicates. Candidate orchestration uses the reason while legacy callers
 * continue consuming the boolean behavior through `dedupeByVideoIdentity`.
 */
export function videoIdentityDuplicateReason(
  candidate: VideoDedupKeys,
  kept: VideoDedupKeys,
): VideoIdentityDuplicateReason | null {
  return videoIdentityDuplicateReasonWithCache(candidate, kept)
}

export function createVideoIdentityDuplicateReasonResolver() {
  const embeddingCache = new Map<string, number[]>()
  return (candidate: VideoDedupKeys, kept: VideoDedupKeys) =>
    videoIdentityDuplicateReasonWithCache(candidate, kept, embeddingCache)
}

function videoIdentityDuplicateReasonWithCache(
  candidate: VideoDedupKeys,
  kept: VideoDedupKeys,
  embeddingCache?: Map<string, number[]>,
): VideoIdentityDuplicateReason | null {
  const candidateIsVideo =
    candidate.resultType === undefined || candidate.resultType === "video"
  const keptIsVideo =
    kept.resultType === undefined || kept.resultType === "video"
  if (!candidateIsVideo || !keptIsVideo) return null

  if (candidate.videoCoreId && kept.videoCoreId) {
    const candidateCoreId = candidate.videoCoreId
    const keptCoreId = kept.videoCoreId
    if (
      candidateCoreId.startsWith(keptCoreId) ||
      keptCoreId.startsWith(candidateCoreId)
    ) {
      return "core_prefix"
    }
  }

  if (
    candidate.videoTitle &&
    kept.videoTitle &&
    candidate.videoTitle === kept.videoTitle
  ) {
    return "exact_title"
  }

  if (candidate.embeddingText && kept.embeddingText) {
    if (
      cosineSimilarityFromTextWithCache(
        candidate.embeddingText,
        kept.embeddingText,
        embeddingCache,
      ) > 0.95
    ) {
      return "embedding_similarity"
    }
  }

  return null
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
  const duplicateReason = createVideoIdentityDuplicateReasonResolver()

  for (const candidate of rows) {
    if (deduped.length >= limit) break

    let isDuplicate = false

    for (const kept of deduped) {
      if (duplicateReason(candidate, kept)) {
        isDuplicate = true
        break
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
 * format: "[0.1,0.2,...]".
 */
export function cosineSimilarityFromText(a: string, b: string): number {
  return cosineSimilarityFromTextWithCache(a, b)
}

function cosineSimilarityFromTextWithCache(
  a: string,
  b: string,
  embeddingCache?: Map<string, number[]>,
): number {
  const parse = (value: string) => {
    const cached = embeddingCache?.get(value)
    if (cached) return cached
    const parsed = value.slice(1, -1).split(",").map(Number)
    embeddingCache?.set(value, parsed)
    return parsed
  }
  const va = parse(a)
  const vb = parse(b)
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
