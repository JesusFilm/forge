import { describe, expect, it } from "vitest"
import {
  cosineSimilarityFromText,
  deduplicateResults,
  fuseRankedLists,
  type FusedResult,
  type RankedItem,
} from "./fusion"

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function item(
  videoId: number,
  overrides: Partial<RankedItem> = {},
): RankedItem {
  return {
    videoId,
    videoCoreId: `core-${videoId}`,
    videoTitle: `Video ${videoId}`,
    ...overrides,
  }
}

/** Builds a pgvector-format embedding string from a plain number array. */
function toEmbeddingText(values: number[]): string {
  return `[${values.join(",")}]`
}

/* ------------------------------------------------------------------ */
/*  fuseRankedLists                                                    */
/* ------------------------------------------------------------------ */

describe("fuseRankedLists", () => {
  const K = 60 // default

  it("fuses two lists with overlapping videos — rank 1 in both yields score 1.0", () => {
    const listA = [item(1), item(2)]
    const listB = [item(1), item(3)]

    const results = fuseRankedLists([listA, listB], K)

    const video1 = results.find((r) => r.videoId === 1)!
    // score = (1/(61) + 1/(61)) / (2/61) = 2/61 / (2/61) = 1.0
    expect(video1.score).toBeCloseTo(1.0, 10)
  })

  it("fuses video at rank 1 in list A and rank 3 in list B", () => {
    const listA = [item(1)]
    const listB = [item(10), item(20), item(1)]

    const results = fuseRankedLists([listA, listB], K)

    const video1 = results.find((r) => r.videoId === 1)!
    // score = (1/61 + 1/63) / (2/61)
    const expected = (1 / 61 + 1 / 63) / (2 / 61)
    expect(video1.score).toBeCloseTo(expected, 10)
  })

  it("gives partial score to video appearing in only one list", () => {
    const listA = [item(1), item(2)]
    const listB = [item(3)]

    const results = fuseRankedLists([listA, listB], K)

    const video2 = results.find((r) => r.videoId === 2)!
    // score = (1/62) / (2/61) — only in list A at rank 2
    const expected = 1 / 62 / (2 / 61)
    expect(video2.score).toBeCloseTo(expected, 10)
  })

  it("normalizes all scores to at most 1.0", () => {
    const listA = [item(1), item(2), item(3)]
    const listB = [item(1), item(3), item(4)]
    const listC = [item(1), item(5)]

    const results = fuseRankedLists([listA, listB, listC], K)

    for (const r of results) {
      expect(r.score).toBeLessThanOrEqual(1.0)
      expect(r.score).toBeGreaterThan(0)
    }

    // Video 1 is rank 1 in all 3 lists — should be exactly 1.0
    const video1 = results.find((r) => r.videoId === 1)!
    expect(video1.score).toBeCloseTo(1.0, 10)
  })

  it("sorts results by score descending", () => {
    const listA = [item(1), item(2), item(3)]
    const listB = [item(2), item(3), item(1)]

    const results = fuseRankedLists([listA, listB], K)

    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score)
    }
  })

  it("returns empty array for empty input", () => {
    expect(fuseRankedLists([], K)).toEqual([])
    expect(fuseRankedLists([[]], K)).toEqual([])
  })

  it("works correctly with a single list", () => {
    const list = [item(1), item(2), item(3)]
    const results = fuseRankedLists([list], K)

    expect(results).toHaveLength(3)
    // Rank 1 in a single list: score = (1/61) / (1/61) = 1.0
    expect(results[0].score).toBeCloseTo(1.0, 10)
    expect(results[0].videoId).toBe(1)

    // Rank 2: score = (1/62) / (1/61)
    const expected2 = 1 / 62 / (1 / 61)
    expect(results[1].score).toBeCloseTo(expected2, 10)
  })

  it("merges properties with earlier lists taking priority", () => {
    const semanticItem: RankedItem = {
      videoId: 1,
      videoCoreId: "core-1",
      videoTitle: "Semantic Title",
      embeddingText: "[0.1,0.2]",
      sceneDescription: "A scene about forgiveness",
      startSeconds: 42,
    }
    const keywordItem: RankedItem = {
      videoId: 1,
      videoCoreId: "core-1",
      videoTitle: "Keyword Title",
      description: "A full video description",
      rank: 0.5,
    }

    // Semantic list first — its properties should take priority
    const results = fuseRankedLists([[semanticItem], [keywordItem]], K)

    const video1 = results.find((r) => r.videoId === 1)!
    // Earlier list (semantic) wins for overlapping keys
    expect(video1.videoTitle).toBe("Semantic Title")
    expect(video1.embeddingText).toBe("[0.1,0.2]")
    expect(video1.sceneDescription).toBe("A scene about forgiveness")
    // Keyword-only fields are still present
    expect(video1.description).toBe("A full video description")
    expect(video1.rank).toBe(0.5)
  })

  it("accepts custom k values", () => {
    const listA = [item(1)]
    const listB = [item(1)]

    const results10 = fuseRankedLists([listA, listB], 10)
    const results100 = fuseRankedLists([listA, listB], 100)

    // Both should normalize to 1.0 since video is rank 1 in both
    expect(results10[0].score).toBeCloseTo(1.0, 10)
    expect(results100[0].score).toBeCloseTo(1.0, 10)
  })

  it("uses default k=60 when not specified", () => {
    const listA = [item(1), item(2)]
    const listB = [item(2)]

    const withDefault = fuseRankedLists([listA, listB])
    const withExplicit = fuseRankedLists([listA, listB], 60)

    expect(withDefault[0].score).toBeCloseTo(withExplicit[0].score, 10)
    expect(withDefault[1].score).toBeCloseTo(withExplicit[1].score, 10)
  })
})

/* ------------------------------------------------------------------ */
/*  deduplicateResults                                                 */
/* ------------------------------------------------------------------ */

describe("deduplicateResults", () => {
  function fused(
    videoId: number,
    score: number,
    overrides: Partial<FusedResult> = {},
  ): FusedResult {
    return {
      videoId,
      videoCoreId: `core-${videoId}`,
      videoTitle: `Video ${videoId}`,
      score,
      ...overrides,
    }
  }

  it("removes lower-scored duplicate by core_id prefix match", () => {
    const results: FusedResult[] = [
      fused(1, 0.9, { videoCoreId: "4_Win4GoodNewsJesus" }),
      fused(2, 0.7, { videoCoreId: "4_Win4GoodNewsJesusAD1x1" }),
    ]

    const deduped = deduplicateResults(results, 10)

    expect(deduped).toHaveLength(1)
    expect(deduped[0].videoId).toBe(1)
  })

  it("removes lower-scored duplicate by core_id prefix match (reverse prefix)", () => {
    const results: FusedResult[] = [
      fused(1, 0.9, { videoCoreId: "4_Win4GoodNewsJesusAD1x1" }),
      fused(2, 0.7, { videoCoreId: "4_Win4GoodNewsJesus" }),
    ]

    const deduped = deduplicateResults(results, 10)

    expect(deduped).toHaveLength(1)
    expect(deduped[0].videoId).toBe(1)
  })

  it("removes lower-scored duplicate by exact title match", () => {
    const results: FusedResult[] = [
      fused(1, 0.9, {
        videoCoreId: "series-a-scene1",
        videoTitle: "Sermon on the Mount",
      }),
      fused(2, 0.7, {
        videoCoreId: "series-b-scene1",
        videoTitle: "Sermon on the Mount",
      }),
    ]

    const deduped = deduplicateResults(results, 10)

    expect(deduped).toHaveLength(1)
    expect(deduped[0].videoId).toBe(1)
  })

  it("removes lower-scored duplicate by embedding similarity >0.95", () => {
    // Two vectors that are nearly identical (cosine sim > 0.95)
    const baseVec = Array.from({ length: 10 }, (_, i) => Math.sin(i))
    // Slightly perturbed copy — still very similar
    const perturbedVec = baseVec.map((v) => v + 0.001)

    const results: FusedResult[] = [
      fused(1, 0.9, {
        videoCoreId: "distinct-a",
        videoTitle: "Distinct Title A",
        embeddingText: toEmbeddingText(baseVec),
      }),
      fused(2, 0.7, {
        videoCoreId: "distinct-b",
        videoTitle: "Distinct Title B",
        embeddingText: toEmbeddingText(perturbedVec),
      }),
    ]

    const deduped = deduplicateResults(results, 10)

    expect(deduped).toHaveLength(1)
    expect(deduped[0].videoId).toBe(1)
  })

  it("keeps videos with different core_ids, titles, and embeddings", () => {
    // Orthogonal vectors — cosine similarity near 0
    const vecA = [1, 0, 0, 0, 0]
    const vecB = [0, 0, 0, 0, 1]

    const results: FusedResult[] = [
      fused(1, 0.9, {
        videoCoreId: "alpha",
        videoTitle: "The JESUS Film",
        embeddingText: toEmbeddingText(vecA),
      }),
      fused(2, 0.7, {
        videoCoreId: "beta",
        videoTitle: "Magdalena",
        embeddingText: toEmbeddingText(vecB),
      }),
    ]

    const deduped = deduplicateResults(results, 10)

    expect(deduped).toHaveLength(2)
  })

  it("respects limit — stops collecting when limit is reached", () => {
    const results: FusedResult[] = [
      fused(1, 0.9, { videoCoreId: "a", videoTitle: "Title A" }),
      fused(2, 0.8, { videoCoreId: "b", videoTitle: "Title B" }),
      fused(3, 0.7, { videoCoreId: "c", videoTitle: "Title C" }),
      fused(4, 0.6, { videoCoreId: "d", videoTitle: "Title D" }),
      fused(5, 0.5, { videoCoreId: "e", videoTitle: "Title E" }),
    ]

    const deduped = deduplicateResults(results, 3)

    expect(deduped).toHaveLength(3)
    expect(deduped.map((d) => d.videoId)).toEqual([1, 2, 3])
  })

  it("returns empty array for empty input", () => {
    expect(deduplicateResults([], 10)).toEqual([])
  })

  it("handles results with null core_ids gracefully", () => {
    const results: FusedResult[] = [
      fused(1, 0.9, { videoCoreId: null, videoTitle: "Title A" }),
      fused(2, 0.7, { videoCoreId: null, videoTitle: "Title B" }),
    ]

    const deduped = deduplicateResults(results, 10)

    // Null core_ids should not match each other
    expect(deduped).toHaveLength(2)
  })

  it("handles results without embedding text", () => {
    const results: FusedResult[] = [
      fused(1, 0.9, {
        videoCoreId: "distinct-a",
        videoTitle: "Title A",
      }),
      fused(2, 0.7, {
        videoCoreId: "distinct-b",
        videoTitle: "Title B",
      }),
    ]

    // No embeddingText — layer 3 is skipped, no crash
    const deduped = deduplicateResults(results, 10)
    expect(deduped).toHaveLength(2)
  })
})

/* ------------------------------------------------------------------ */
/*  cosineSimilarityFromText                                           */
/* ------------------------------------------------------------------ */

describe("cosineSimilarityFromText", () => {
  it("returns 1.0 for identical vectors", () => {
    const vec = "[0.5,0.3,0.8,0.1]"
    expect(cosineSimilarityFromText(vec, vec)).toBeCloseTo(1.0, 10)
  })

  it("returns approximately 0.0 for orthogonal vectors", () => {
    const a = "[1,0,0]"
    const b = "[0,1,0]"
    expect(cosineSimilarityFromText(a, b)).toBeCloseTo(0.0, 10)
  })

  it("returns known cosine similarity for a specific pair", () => {
    // [1, 2, 3] and [4, 5, 6]
    // dot = 4+10+18 = 32
    // normA = sqrt(1+4+9) = sqrt(14)
    // normB = sqrt(16+25+36) = sqrt(77)
    // cos = 32 / (sqrt(14) * sqrt(77))
    const a = "[1,2,3]"
    const b = "[4,5,6]"
    const expected = 32 / (Math.sqrt(14) * Math.sqrt(77))
    expect(cosineSimilarityFromText(a, b)).toBeCloseTo(expected, 10)
  })

  it("returns 0 for vectors of different lengths", () => {
    const a = "[1,2,3]"
    const b = "[1,2]"
    expect(cosineSimilarityFromText(a, b)).toBe(0)
  })

  it("returns 0 for empty vectors", () => {
    expect(cosineSimilarityFromText("[]", "[]")).toBe(0)
  })

  it("returns 0 for zero vectors", () => {
    const zero = "[0,0,0]"
    const nonZero = "[1,2,3]"
    expect(cosineSimilarityFromText(zero, nonZero)).toBe(0)
  })

  it("handles negative values", () => {
    // Opposite vectors should have similarity -1.0
    const a = "[1,0,0]"
    const b = "[-1,0,0]"
    expect(cosineSimilarityFromText(a, b)).toBeCloseTo(-1.0, 10)
  })
})
