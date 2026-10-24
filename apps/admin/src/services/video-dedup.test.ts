import { describe, expect, it } from "vitest"
import {
  cosineSimilarityFromText,
  dedupeByVideoIdentity,
  videoIdentityDuplicateReason,
  type VideoDedupKeys,
} from "./video-dedup"

function toEmbeddingText(values: number[]): string {
  return `[${values.join(",")}]`
}

describe("dedupeByVideoIdentity", () => {
  it("exposes the canonical identity rule used by candidate-stage evidence", () => {
    expect(
      videoIdentityDuplicateReason(
        { videoCoreId: "core-a-square", videoTitle: "Square" },
        { videoCoreId: "core-a", videoTitle: "Wide" },
      ),
    ).toBe("core_prefix")
  })

  it("removes coreId-prefix duplicate (candidate prefix of kept)", () => {
    const rows: VideoDedupKeys[] = [
      { resultType: "video", videoCoreId: "4_Win4GoodNewsJesus" },
      { resultType: "video", videoCoreId: "4_Win4GoodNewsJesusAD1x1" },
    ]
    expect(dedupeByVideoIdentity(rows, 10)).toHaveLength(1)
  })

  it("removes coreId-prefix duplicate (kept prefix of candidate)", () => {
    const rows: VideoDedupKeys[] = [
      { resultType: "video", videoCoreId: "4_Win4GoodNewsJesusAD1x1" },
      { resultType: "video", videoCoreId: "4_Win4GoodNewsJesus" },
    ]
    expect(dedupeByVideoIdentity(rows, 10)).toHaveLength(1)
  })

  it("removes exact-title duplicate", () => {
    const rows: VideoDedupKeys[] = [
      { resultType: "video", videoCoreId: "a", videoTitle: "Sermon" },
      { resultType: "video", videoCoreId: "b", videoTitle: "Sermon" },
    ]
    expect(dedupeByVideoIdentity(rows, 10)).toHaveLength(1)
  })

  it("removes near-duplicate by embedding cosine > 0.95", () => {
    const base = Array.from({ length: 10 }, (_, i) => Math.sin(i))
    const perturbed = base.map((v) => v + 0.001)
    const rows: VideoDedupKeys[] = [
      {
        resultType: "video",
        videoCoreId: "a",
        videoTitle: "A",
        embeddingText: toEmbeddingText(base),
      },
      {
        resultType: "video",
        videoCoreId: "b",
        videoTitle: "B",
        embeddingText: toEmbeddingText(perturbed),
      },
    ]
    expect(dedupeByVideoIdentity(rows, 10)).toHaveLength(1)
  })

  it("keeps rows with orthogonal embeddings", () => {
    const rows: VideoDedupKeys[] = [
      {
        resultType: "video",
        videoCoreId: "a",
        videoTitle: "A",
        embeddingText: toEmbeddingText([1, 0, 0, 0, 0]),
      },
      {
        resultType: "video",
        videoCoreId: "b",
        videoTitle: "B",
        embeddingText: toEmbeddingText([0, 0, 0, 0, 1]),
      },
    ]
    expect(dedupeByVideoIdentity(rows, 10)).toHaveLength(2)
  })

  it("treats rows without resultType as videos (R5 row shape)", () => {
    const rows: VideoDedupKeys[] = [
      { videoCoreId: "a", videoTitle: "Sermon" },
      { videoCoreId: "a-AD1x1", videoTitle: "Sermon Variant" },
    ]
    // coreId prefix match still triggers even though resultType is absent
    expect(dedupeByVideoIdentity(rows, 10)).toHaveLength(1)
  })

  it("passes non-video rows through without dedup", () => {
    const rows: VideoDedupKeys[] = [
      { resultType: "experience", videoTitle: "Easter" },
      { resultType: "experience", videoTitle: "Easter" },
    ]
    expect(dedupeByVideoIdentity(rows, 10)).toHaveLength(2)
  })

  it("respects limit cap", () => {
    const rows: VideoDedupKeys[] = [
      { resultType: "video", videoCoreId: "a", videoTitle: "A" },
      { resultType: "video", videoCoreId: "b", videoTitle: "B" },
      { resultType: "video", videoCoreId: "c", videoTitle: "C" },
      { resultType: "video", videoCoreId: "d", videoTitle: "D" },
    ]
    expect(dedupeByVideoIdentity(rows, 2)).toHaveLength(2)
  })

  it("handles null coreIds without matching them to each other", () => {
    const rows: VideoDedupKeys[] = [
      { resultType: "video", videoCoreId: null, videoTitle: "A" },
      { resultType: "video", videoCoreId: null, videoTitle: "B" },
    ]
    expect(dedupeByVideoIdentity(rows, 10)).toHaveLength(2)
  })

  it("returns empty for empty input", () => {
    expect(dedupeByVideoIdentity([], 10)).toEqual([])
  })

  it("mixed-shape input: R5-style rows (no resultType) coexist with R4 experience rows", () => {
    // Guards against future changes to the primitive silently breaking
    // one consumer. R5 passes rows with no resultType; R4 hybrid-search
    // passes rows tagged "video" or "experience". Both must survive.
    const rows: VideoDedupKeys[] = [
      // R5 row (no resultType) — treated as video, triggers prefix dedup
      { videoCoreId: "promo", videoTitle: "A" },
      { videoCoreId: "promo-AD1x1", videoTitle: "A Variant" },
      // R4 experience row — must pass through untouched
      { resultType: "experience", videoTitle: "Easter" },
      { resultType: "experience", videoTitle: "Easter" },
    ]
    const result = dedupeByVideoIdentity(rows, 10)
    // One R5 row survives (prefix match), both experiences pass through.
    expect(result).toHaveLength(3)
    expect(result.filter((r) => r.resultType === "experience")).toHaveLength(2)
  })
})

describe("cosineSimilarityFromText", () => {
  it("returns 1.0 for identical vectors", () => {
    const v = "[0.5,0.3,0.8,0.1]"
    expect(cosineSimilarityFromText(v, v)).toBeCloseTo(1.0, 10)
  })

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarityFromText("[1,0,0]", "[0,1,0]")).toBeCloseTo(0.0, 10)
  })

  it("returns 0 for different-length vectors", () => {
    expect(cosineSimilarityFromText("[1,2,3]", "[1,2]")).toBe(0)
  })

  it("returns 0 for zero vectors", () => {
    expect(cosineSimilarityFromText("[0,0,0]", "[1,2,3]")).toBe(0)
  })

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarityFromText("[1,0,0]", "[-1,0,0]")).toBeCloseTo(-1, 10)
  })
})
