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

  it("keeps nullable model explanations out of Admin checkpoints and resumes an older absent-field checkpoint", async () => {
    const legacyBest = {
      targetVideoId: "target",
      kind: "direct",
      relationship: "shared story",
      reasonEnglish: "Both videos cover the same biblical account.",
      evidence: { basis: "metadata", fields: ["title"] },
      strength: 70,
    }
    const run = async (legacyCheckpoint: boolean) => {
      const saved = {
        stage: "candidate",
        cursor: {
          catalogIndex: 0,
          candidateIndex: 0,
          ...(legacyCheckpoint ? { candidateAfterChunkId: "next" } : {}),
        },
        sourceSummaryEnglish: "Source summary",
        candidateIds: ["target"],
        ...(legacyCheckpoint ? { bestJudgment: legacyBest } : {}),
      }
      const sourceCatalog = catalog(["source", "target"])
      sourceCatalog.chunks = async ({ afterChunkId }) => ({
        chunks: afterChunkId
          ? []
          : [
              {
                id: "chunk-1",
                language: "en",
                transcriptId: "transcript-1",
                chunkIndex: 0,
                text: "A sufficiently long transcript passage.",
              },
            ],
        nextCursor: afterChunkId ? null : "next",
      })
      const generate = vi.fn().mockResolvedValueOnce({
        output: {
          connections: legacyCheckpoint
            ? []
            : [{ ...legacyBest, addedViewingValueEnglish: null }],
        },
        usage: {},
      })
      if (!legacyCheckpoint)
        generate.mockResolvedValueOnce({
          output: { connections: [] },
          usage: {},
        })
      const writes: Array<Record<string, unknown>> = []
      let revision = 0
      const ingest = vi.fn(async (raw: unknown) => {
        const call = raw as Record<string, unknown>
        writes.push(call)
        switch (call.action) {
          case "start":
          case "capacity":
            return { state: "incomplete" }
          case "manifest":
            return { state: "incomplete", pendingSourceCount: 2 }
          case "capacity_probe":
            return {
              observedDbBytes: 1,
              clusterSystemId: "1",
              availableBytes: null,
            }
          case "claim":
            return call.sourceVideoId === "source"
              ? {
                  sourceState: "claimed",
                  leaseToken: "550e8400-e29b-41d4-a716-446655440000",
                  checkpointRevision: 0,
                  checkpoint: saved,
                }
              : { sourceState: "complete_empty", leaseToken: null }
          case "heartbeat":
            return { sourceState: "claimed" }
          case "model_call_start":
            return { state: "pending", callId: call.callId }
          case "model_call":
            return {
              receiptStored: true,
              checkpointApplied: true,
              staleLease: false,
              checkpointRevision: ++revision,
            }
          case "checkpoint":
            return { checkpointRevision: ++revision }
          case "source":
            return { sourceState: "complete_edges" }
          case "complete":
            return { state: "complete" }
          default:
            throw new Error(`Unexpected ingest action: ${String(call.action)}`)
        }
      })
      const result = await runPrecomputedCatalog(input, {
        catalog: sourceCatalog,
        ingest,
        model: { generate },
      })
      expect(result.state).toBe("complete")
      const modelCalls = writes.filter((call) => call.action === "model_call")
      expect(modelCalls).toHaveLength(legacyCheckpoint ? 1 : 2)
      const firstWire = JSON.parse(JSON.stringify(modelCalls[0]))
      if (!legacyCheckpoint)
        expect(firstWire.checkpoint.bestJudgment).not.toHaveProperty(
          "addedViewingValueEnglish",
        )
      const choiceWire = JSON.parse(JSON.stringify(modelCalls.at(-1)))
      expect(choiceWire.choice).not.toHaveProperty("addedViewingValueEnglish")
    }

    await run(false)
    await run(true)
  })
})
