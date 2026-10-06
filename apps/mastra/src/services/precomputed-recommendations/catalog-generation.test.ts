import { createHash } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import { runPrecomputedCatalog } from "./catalog-generation"
import type { SourceCatalog } from "./source-generation"

const input = {
  generationId: "generation-one",
  inputCutoff: "2026-10-06T00:00:00.000Z",
  historyRequired: false,
  capacity: {
    measuredAt: "2026-10-06T00:01:00.000Z",
    clusterSystemId: "1234567890",
    observedDbBytes: 1_000_000,
    availableBytes: 10_000_000_000,
    reserveBytes: 5_000_000_000,
    projectedBytes: 1_000_000,
    sampleSourceCount: 1,
    sampleBytes: 1000,
    source: "operator_verified_pgdata_df" as const,
  },
}

function catalog(ids: string[]): SourceCatalog {
  return {
    async catalog() {
      return {
        videos: ids.map((id) => ({
          id,
          coreId: id,
          slug: id,
          locale: null,
          title: `Video ${id}`,
          description: "",
          descriptionTruncated: false,
          keywords: [],
          keywordsTruncated: false,
          bibleCitations: [],
          bibleCitationsTruncated: false,
          parentVideoIds: [],
          childVideoIds: [],
          transcriptLanguages: [],
        })),
        nextCursor: null,
      }
    },
    async video() {
      throw new Error("unexpected source read")
    },
    async chunks() {
      throw new Error("unexpected transcript read")
    },
  }
}

describe("catalog generation boundary", () => {
  it("rejects malformed Admin state before any model spend", async () => {
    const generate = vi.fn()
    const ingest = vi.fn().mockResolvedValue({ state: "unknown" })
    await expect(
      runPrecomputedCatalog(input, {
        catalog: catalog(["source"]),
        ingest,
        model: { generate },
      }),
    ).rejects.toThrow("admin_contract_rejected")
    expect(ingest).toHaveBeenCalledOnce()
    expect(generate).not.toHaveBeenCalled()
  })

  it("uses canonical code-unit source ordering for the manifest digest", async () => {
    const ingest = vi.fn().mockResolvedValue({ state: "complete" })
    const result = await runPrecomputedCatalog(input, {
      catalog: catalog(["z", "a", "_", "A"]),
      ingest,
      model: { generate: vi.fn() },
    })
    const expected = createHash("sha256")
      .update(JSON.stringify(["A", "_", "a", "z"]))
      .digest("hex")
    expect(ingest.mock.calls[0]?.[0]).toMatchObject({
      action: "start",
      sourceSetDigest: expected,
    })
    expect(result.state).toBe("replayed")
  })
})
