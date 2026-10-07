import { createHash } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import { runPrecomputedCatalog } from "./catalog-generation"
import { judgmentSchema, type SourceCatalog } from "./source-generation"

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
          coreId: `${id}-core`,
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
      return { chunks: [], nextCursor: null }
    },
  }
}

describe("catalog generation boundary", () => {
  it("binds selected transcript bytes to the generation input on replay", async () => {
    const sourceCatalog = catalog(["source"])
    let text = "First transcript passage."
    sourceCatalog.chunks = async () => ({
      chunks: [
        {
          id: "chunk",
          transcriptId: "transcript",
          language: "en",
          chunkIndex: 0,
          text,
        },
      ],
      nextCursor: null,
    })
    const digests: string[] = []
    const ingest = vi.fn(async (raw: unknown) => {
      const call = raw as Record<string, unknown>
      digests.push(String(call.inputDigest))
      return { state: "complete" }
    })
    const dependencies = {
      catalog: sourceCatalog,
      ingest,
      model: { generate: vi.fn() },
    }
    await runPrecomputedCatalog(input, dependencies)
    await runPrecomputedCatalog(input, dependencies)
    text = "A changed transcript passage."
    await runPrecomputedCatalog(input, dependencies)
    expect(digests[0]).toBe(digests[1])
    expect(digests[2]).not.toBe(digests[0])
    expect(dependencies.model.generate).not.toHaveBeenCalled()
  })

  it("rejects selected transcript identity drift before opening a generation", async () => {
    const sourceCatalog = catalog(["source"])
    const list = sourceCatalog.catalog
    sourceCatalog.catalog = async (request) => {
      const page = await list(request)
      return {
        ...page,
        videos: page.videos.map((video) => ({
          ...video,
          transcriptSelection: {
            policy: "english-per-edition-with-complete-fallback-v1" as const,
            availableTranscriptCount: 1,
            incompleteTranscriptCount: 0,
            skippedEditionCount: 0,
            selected: [
              {
                transcriptId: "selected-transcript",
                videoEditionId: "edition",
                language: "am",
                totalChunks: 1,
              },
            ],
          },
        })),
      }
    }
    sourceCatalog.chunks = async () => ({
      chunks: [
        {
          id: "chunk",
          transcriptId: "selected-transcript",
          language: "fr",
          chunkIndex: 0,
          text: "A complete but wrongly attributed transcript chunk.",
        },
      ],
      nextCursor: null,
    })
    const ingest = vi.fn().mockResolvedValue({ state: "complete" })
    await expect(
      runPrecomputedCatalog(input, {
        catalog: sourceCatalog,
        ingest,
        model: { generate: vi.fn() },
      }),
    ).rejects.toMatchObject({
      code: "input_stale",
      reason: "selected_transcript_incomplete",
    })
    expect(ingest).not.toHaveBeenCalled()
  })

  it("discovers from a bounded catalog pool without losing structural, exact, or fallback targets", async () => {
    const sourceId = "a-source"
    const structuralId = "z-structural"
    const exactId = "z-exact"
    const fallbackId = "z-fallback"
    const ids = [
      sourceId,
      ...Array.from({ length: 85 }, (_, index) => `b-${index}`),
      structuralId,
      exactId,
      fallbackId,
    ]
    const sourceCatalog = catalog(ids)
    const list = sourceCatalog.catalog
    sourceCatalog.catalog = async (request) => {
      const page = await list(request)
      return {
        ...page,
        videos: page.videos.map((video) => ({
          ...video,
          title: video.id === sourceId ? "Courage and hope" : video.id,
          parentVideoIds: video.id === sourceId ? [structuralId] : [],
          keywords:
            video.id === sourceId || video.id === exactId
              ? ["specific shared theme"]
              : [],
          transcriptLanguages: video.id === fallbackId ? ["am"] : [],
          transcriptSelection:
            video.id === fallbackId
              ? {
                  policy:
                    "english-per-edition-with-complete-fallback-v1" as const,
                  availableTranscriptCount: 1,
                  incompleteTranscriptCount: 0,
                  skippedEditionCount: 0,
                  selected: [
                    {
                      transcriptId: "fallback-transcript",
                      videoEditionId: "fallback-edition",
                      language: "am",
                      totalChunks: 1,
                    },
                  ],
                }
              : undefined,
        })),
      }
    }
    sourceCatalog.chunks = async ({ videoId }) => ({
      chunks:
        videoId === fallbackId
          ? [
              {
                id: "fallback-chunk",
                language: "am",
                transcriptId: "fallback-transcript",
                chunkIndex: 0,
                text: "የተለየ ታሪክ እና ትርጉም",
              },
            ]
          : [],
      nextCursor: null,
    })
    const prompts: string[] = []
    let revision = 0
    const ingest = vi.fn(async (raw: unknown) => {
      const call = raw as Record<string, unknown>
      switch (call.action) {
        case "start":
        case "capacity":
          return { state: "incomplete" }
        case "manifest":
          return { state: "incomplete", pendingSourceCount: ids.length }
        case "capacity_probe":
          return {
            observedDbBytes: 1,
            clusterSystemId: "1",
            availableBytes: null,
          }
        case "claim":
          return call.sourceVideoId === sourceId
            ? {
                sourceState: "claimed",
                leaseToken: "550e8400-e29b-41d4-a716-446655440000",
                checkpointRevision: 0,
                checkpoint: {
                  stage: "discovery",
                  cursor: { catalogIndex: 0 },
                  sourceSummaryEnglish: "Courage and hope",
                },
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
          return { sourceState: "complete_empty" }
        case "complete":
          return { state: "complete" }
        default:
          throw new Error(`Unexpected action ${String(call.action)}`)
      }
    })
    await runPrecomputedCatalog(input, {
      catalog: sourceCatalog,
      ingest,
      model: {
        async generate({ prompt, schema }) {
          prompts.push(prompt)
          return { output: schema.parse({ candidateVideoIds: [] }), usage: {} }
        },
      },
    })
    const candidateIds = prompts.flatMap((prompt) => {
      const parsed = JSON.parse(prompt) as {
        untrustedCatalogData: { candidates: Array<{ id: string }> }
      }
      return parsed.untrustedCatalogData.candidates.map((video) => video.id)
    })
    expect(prompts).toHaveLength(2)
    expect(candidateIds).toContain(structuralId)
    expect(candidateIds).toContain(exactId)
    expect(candidateIds).toContain(fallbackId)
    expect(candidateIds.length).toBeLessThan(ids.length - 1)
  })

  it("does not offer a metadata evidence field absent from catalog Videos", () => {
    expect(
      judgmentSchema.safeParse({
        connections: [
          {
            kind: "direct",
            relationship: "shared story",
            reasonEnglish: "Both videos cover the same biblical account.",
            addedViewingValueEnglish: null,
            evidence: { basis: "metadata", fields: ["themes"] },
            strength: 70,
          },
        ],
      }).success,
    ).toBe(false)
  })

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

  it("repairs bad evidence once and fails truthfully when repair is exhausted", async () => {
    const passage = "A sufficiently long transcript passage."
    const connection = (excerpt: string) => ({
      kind: "direct",
      relationship: "shared story",
      reasonEnglish: "Both videos cover the same biblical account.",
      addedViewingValueEnglish: null,
      evidence: {
        basis: "transcript",
        passages: [{ chunkId: "chunk-1", excerpt }],
      },
      strength: 70,
    })
    const metadataConnection = {
      ...connection(passage),
      evidence: { basis: "metadata", fields: ["keywords"] },
    }
    const run = async (
      firstConnection: unknown,
      secondConnection: unknown,
      priorRepair?: {
        candidateId: string
        afterChunkId: null
        attempts: number
        feedback: { reason: "transcript_excerpt_not_verbatim"; chunkId: string }
      },
    ) => {
      const sourceCatalog = catalog(["source", "target"])
      sourceCatalog.chunks = async () => ({
        chunks: [
          {
            id: "chunk-1",
            language: "en",
            transcriptId: "transcript-1",
            chunkIndex: 0,
            text: passage,
          },
        ],
        nextCursor: null,
      })
      const generate = vi
        .fn()
        .mockResolvedValueOnce({
          output: { connections: [firstConnection] },
          usage: { inputTokens: 1, outputTokens: 2, costUsd: 0.01 },
        })
        .mockResolvedValueOnce({
          output: { connections: [secondConnection] },
          usage: { inputTokens: 1, outputTokens: 2, costUsd: 0.01 },
        })
      const writes: Array<Record<string, unknown>> = []
      const warnings: string[] = []
      const warn = vi
        .spyOn(console, "warn")
        .mockImplementation((message: unknown) => {
          warnings.push(String(message))
        })
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
                  checkpoint: {
                    stage: "candidate",
                    cursor: { catalogIndex: 0, candidateIndex: 0 },
                    sourceSummaryEnglish: "Source summary",
                    candidateIds: ["target"],
                    ...(priorRepair ? { repair: priorRepair } : {}),
                  },
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
          case "fail":
            return { sourceState: "failed" }
          case "complete":
            return { state: "complete" }
          default:
            throw new Error(`Unexpected ingest action: ${String(call.action)}`)
        }
      })

      try {
        const result = await runPrecomputedCatalog(input, {
          catalog: sourceCatalog,
          ingest,
          model: { generate },
        })
        return { result, generate, writes, warnings }
      } finally {
        warn.mockRestore()
      }
    }

    const repaired = await run(
      connection("A passage absent from the chunk."),
      connection(passage),
    )
    expect(repaired.result.state).toBe("complete")
    expect(repaired.generate).toHaveBeenCalledTimes(2)
    expect(repaired.generate.mock.calls[1]?.[0].prompt).toContain(
      '"reason":"transcript_excerpt_not_verbatim","chunkId":"chunk-1"',
    )
    expect(repaired.warnings).toHaveLength(1)
    expect(repaired.warnings[0]).not.toContain(
      "A passage absent from the chunk.",
    )
    const receipts = repaired.writes.filter(
      (call) => call.action === "model_call",
    )
    expect(receipts).toHaveLength(2)
    expect(receipts[0]).toMatchObject({
      status: "failed",
      errorCode: "provider_invalid_output",
      costUsd: 0.01,
    })
    expect(receipts[0]).not.toHaveProperty("choice")
    expect(receipts[1]).toMatchObject({
      status: "succeeded",
      choice: { evidence: connection(passage).evidence },
    })
    expect(
      repaired.writes.filter((call) => call.action === "fail"),
    ).toHaveLength(0)

    const metadataRepaired = await run(metadataConnection, connection(passage))
    expect(metadataRepaired.result.state).toBe("complete")
    expect(metadataRepaired.generate.mock.calls[1]?.[0].prompt).toContain(
      '"reason":"metadata_field_unavailable","field":"keywords"',
    )
    expect(
      metadataRepaired.writes.filter((call) => call.action === "model_call")[0],
    ).not.toHaveProperty("choice")

    const missingChunk = await run(
      {
        ...connection(passage),
        evidence: {
          basis: "transcript",
          passages: [{ chunkId: "missing-chunk", excerpt: passage }],
        },
      },
      connection(passage),
    )
    expect(missingChunk.result.state).toBe("complete")
    expect(missingChunk.generate.mock.calls[1]?.[0].prompt).toContain(
      '"reason":"transcript_chunk_unavailable","chunkId":"missing-chunk"',
    )

    const exhausted = await run(
      connection("A passage absent from the chunk."),
      connection("Still not present in the chunk."),
    )
    expect(exhausted.result.state).toBe("failed")
    expect(exhausted.generate).toHaveBeenCalledTimes(2)
    expect(exhausted.warnings).toHaveLength(2)
    const exhaustedReceipts = exhausted.writes.filter(
      (call) => call.action === "model_call",
    )
    expect(exhaustedReceipts).toHaveLength(2)
    expect(exhaustedReceipts.map((receipt) => receipt.status)).toEqual([
      "failed",
      "failed",
    ])
    expect(exhaustedReceipts.map((receipt) => receipt.costUsd)).toEqual([
      0.01, 0.01,
    ])
    expect(
      exhaustedReceipts.map((receipt) => receipt.checkpoint),
    ).toMatchObject([
      {
        stage: "candidate",
        cursor: { catalogIndex: 0, candidateIndex: 0 },
        repair: { candidateId: "target", attempts: 1 },
      },
      {
        stage: "candidate",
        cursor: { catalogIndex: 0, candidateIndex: 0 },
        repair: { candidateId: "target", attempts: 2 },
      },
    ])
    expect(exhaustedReceipts.some((receipt) => "choice" in receipt)).toBe(false)
    expect(
      exhausted.writes.filter((call) => call.action === "fail"),
    ).toMatchObject([{ failureCode: "provider_invalid_output" }])

    const repair = {
      candidateId: "target",
      afterChunkId: null,
      attempts: 1,
      feedback: {
        reason: "transcript_excerpt_not_verbatim" as const,
        chunkId: "chunk-1",
      },
    }
    const resumed = await run(connection(passage), connection(passage), repair)
    expect(resumed.result.state).toBe("complete")
    expect(resumed.generate).toHaveBeenCalledOnce()
    expect(resumed.generate.mock.calls[0]?.[0].prompt).toContain(
      '"reason":"transcript_excerpt_not_verbatim","chunkId":"chunk-1"',
    )
    const atLimit = await run(connection(passage), connection(passage), {
      ...repair,
      attempts: 2,
    })
    expect(atLimit.result.state).toBe("failed")
    expect(atLimit.generate).not.toHaveBeenCalled()
    expect(
      atLimit.writes.filter((call) => call.action === "model_call"),
    ).toEqual([])
    expect(
      atLimit.writes.filter((call) => call.action === "fail"),
    ).toMatchObject([{ failureCode: "provider_invalid_output" }])
  })
})
