import { describe, expect, it } from "vitest"
import {
  encodeRecommendationHistoryPage,
  requestHistoryEvent,
  servedItemHistoryEvent,
  stageHistoryEvent,
  storedCandidateStageRows,
} from "./trace-codec"

const createdAt = new Date("2026-10-28T02:00:01.000Z")
const issuedAt = new Date("2026-10-28T02:00:00.000Z")
const expiresAt = new Date("2026-11-26T02:00:00.000Z")
const request = {
  id: "request-1",
  manifestId: "manifest-1",
  strategyVersion: "strategy-v1",
  seedMediaId: "video-0",
  locale: "en",
  result: "SERVED",
  state: "ISSUED",
  fallbackReason: null,
  expectedItemCount: 1,
  retrievalLatencyMs: 17,
  responseBytes: 100,
  experimentAssignmentId: null,
  createdAt,
  issuedAt,
  expiresAt,
  servedItemPayload: null,
}
const item = {
  id: "item-1",
  requestId: request.id,
  position: 0,
  targetMediaId: "video-1",
  candidateGenerator: "semantic",
  presentation: {
    videoSlug: "video-one",
    videoTitle: "One",
    imageUrl: "https://example.org/image.jpg",
    description: "Description",
    startSeconds: 2,
    endSeconds: 20,
    durationSeconds: 22,
    themes: ["hope"],
    demographics: [],
    spiritualContext: [],
    playbackId: "playback-1",
    audioLanguageSlug: "en",
  },
  candidateProvenance: {
    sceneIndex: 3,
    similarity: 0.9,
    sources: [
      {
        generator: "semantic",
        generatorVersion: "semantic-v1",
        sourceRank: 1,
        sourceScore: 0.9,
        evidence: { sceneIndex: 3, similarity: 0.9 },
        rejectionReason: null,
      },
    ],
    normalizedSemanticScore: 1,
    rrfBenchmark: 0.5,
    deterministicScore: 1,
    deterministicRankerVersion: "ranker-v1",
    viewingMode: { privatePreference: "do-not-export" },
    eligibilityVersion: "eligible-v1",
    composerVersion: "composer-v1",
  },
  expiresAt,
}

describe("committed recommendation history codecs", () => {
  it.each([
    ["semantic", { sceneIndex: 2, similarity: 0.9 }, "sceneIndex"],
    [
      "curated",
      {
        poolVersion: "v1",
        poolKey: "watch",
        editorialRank: 3,
        similarity: null,
      },
      "poolKey",
    ],
    [
      "multi-interest-profile",
      {
        interestOrdinal: 1,
        interestKind: "session",
        projectionVersion: "v1",
        projectionDigest: "private",
      },
      "interestKind",
    ],
    [
      "directional-cowatch",
      {
        support: 8,
        confidence: 0.6,
        generation: "graph-v1",
        anchorMediaId: "video-0",
        graphGenerationId: "private-graph",
      },
      "anchorMediaId",
    ],
    [
      "mmr-composition-inputs",
      { version: "v1", missingSource: 2, selectedCount: 1 },
      "selectedCount",
    ],
  ] as const)(
    "exports reviewed %s source fields",
    (generator, evidence, retainedKey) => {
      const event = stageHistoryEvent(request.id, {
        id: `stage-${generator}`,
        runId: "run-1",
        stage: "scored",
        ordinal: 0,
        candidateKey: "semantic:1:video-1",
        targetMediaId: "video-1",
        sourceGenerator: generator,
        sourceRank: 1,
        sourceScore: 0.9,
        normalizedScore: 0.9,
        rrfScore: 0.1,
        deterministicScore: 1,
        finalPosition: 0,
        reasonCodes: [],
        createdAt,
        expiresAt,
        sourceEvidence: [
          {
            generator,
            generatorVersion: "v1",
            rank: 1,
            score: 0.9,
            rejectionReason: null,
            evidence,
          },
        ],
      })
      expect(JSON.stringify(event.payload.sourceEvidence)).toContain(
        retainedKey,
      )
      expect(JSON.stringify(event)).not.toContain("private-graph")
      expect(JSON.stringify(event)).not.toContain("projectionDigest")
    },
  )

  it("uses durable request identity, including failed issuance with null issuedAt", () => {
    const served = requestHistoryEvent(request)
    expect(served.occurredAt).toBe(createdAt.toISOString())
    expect(served.acceptedAt).toBe(createdAt.toISOString())
    expect(served.payload.issuedAt).toBe(issuedAt.toISOString())
    const failed = requestHistoryEvent({
      ...request,
      state: "FAILED",
      issuedAt: null,
    })
    expect(failed.payload.issuedAt).toBeNull()
    expect(failed.occurredAt).toBe(createdAt.toISOString())
  })

  it("gives packed and legacy served rows identical safe history", () => {
    const legacy = servedItemHistoryEvent(request, item)
    const packed = servedItemHistoryEvent(
      {
        ...request,
        servedItemPayload: {
          version: 1,
          items: {
            [item.id]: {
              presentation: item.presentation,
              candidateProvenance: item.candidateProvenance,
            },
          },
        },
      },
      { ...item, presentation: {}, candidateProvenance: {} },
    )
    expect(packed).toEqual(legacy)
    expect(JSON.stringify(legacy)).not.toContain("privatePreference")
    expect(JSON.stringify(legacy)).not.toContain("do-not-export")
    expect(legacy.payload.provenanceCoverage).toBe("redacted")
  })

  it("omits signed presentation URLs and reports only presentation redaction", () => {
    const event = servedItemHistoryEvent(request, {
      ...item,
      presentation: {
        ...item.presentation,
        imageUrl: "https://example.org/image.jpg?token=private",
      },
      candidateProvenance: {},
    })
    expect(event.payload.imageUrl).toBeUndefined()
    expect(event.payload.presentationCoverage).toBe("redacted")
    expect(event.payload.provenanceCoverage).toBe("complete")
    expect(JSON.stringify(event)).not.toContain("private")
  })

  it("retains precomputed delivery diagnostics and public choice provenance", () => {
    const precomputedRequest = {
      ...request,
      deliveryDiagnostics: {
        version: 1,
        assignedStrategy: "precomputed-watch-preview-v1",
        actualStrategy: "precomputed-watch-preview-v1",
        generationId: "generation-1",
        audioLanguageSlug: "en",
        coverageGap: "sparse",
      },
    }
    const precomputedItem = {
      ...item,
      candidateGenerator: "precomputed",
      candidateProvenance: {
        generationId: "generation-1",
        kind: "editorial",
        rank: 1,
      },
    }
    expect(requestHistoryEvent(precomputedRequest).payload).toMatchObject({
      diagnosticsCoverage: "complete",
      deliveryDiagnostics: {
        generationId: "generation-1",
        coverageGap: "sparse",
      },
    })
    expect(
      servedItemHistoryEvent(precomputedRequest, precomputedItem).payload,
    ).toMatchObject({
      provenanceCoverage: "complete",
      candidateProvenance: {
        generationId: "generation-1",
        kind: "editorial",
        rank: 1,
      },
    })
  })

  it("redacts private and unknown source evidence and bounds backfill pages", () => {
    const stage = {
      id: "stage-1",
      runId: "run-1",
      stage: "scored",
      ordinal: 0,
      candidateKey: "multi-interest:1:1:video-1",
      targetMediaId: "video-1",
      sourceGenerator: "multi-interest-profile",
      sourceRank: 1,
      sourceScore: 0.9,
      normalizedScore: 0.9,
      rrfScore: 0.1,
      deterministicScore: 1,
      finalPosition: 0,
      reasonCodes: [],
      createdAt,
      expiresAt,
      sourceEvidence: [
        {
          generator: "multi-interest-profile",
          generatorVersion: "profile-v1",
          rank: 1,
          score: 0.9,
          rejectionReason: null,
          evidence: {
            interestOrdinal: 1,
            projectionVersion: "v1",
            projectionDigest: "private-derived",
            unexpected: "secret",
          },
        },
      ],
    }
    const encoded = stageHistoryEvent(request.id, stage)
    expect(JSON.stringify(encoded)).not.toContain("private-derived")
    expect(JSON.stringify(encoded)).not.toContain("secret")
    expect(encoded.payload.traceCoverage).toBe("redacted")
    expect(
      stageHistoryEvent(request.id, {
        ...stage,
        candidateKey: stage.targetMediaId,
        sourceEvidence: [],
      }).payload.candidateKey,
    ).toBe(stage.targetMediaId)
    const run = {
      id: stage.runId,
      requestId: request.id,
      createdAt,
      expiresAt,
      purpose: "watch",
      contextVersion: "context-v1",
      generatorVersion: "generator-v1",
      unionVersion: "union-v1",
      eligibilityVersion: "eligibility-v1",
      rankerVersion: "ranker-v1",
      composerVersion: "composer-v1",
      candidateEligibilityParity: "passed",
      rankerParity: "passed",
      nominatedCount: 1,
      canonicalizedCount: 1,
      deduplicatedCount: 1,
      rejectedCount: 0,
      scoredCount: 1,
      orderedCount: 1,
      requestedCount: 6,
      composedCount: 1,
      shortfallReason: null,
      evidenceComplete: true,
      fallbackReason: null,
    }
    const packed = {
      ...run,
      tracePayload: {
        stages: [
          {
            ...stage,
            runId: undefined,
            expiresAt: undefined,
            createdAt: createdAt.toISOString(),
          },
        ],
      },
    }
    expect(
      stageHistoryEvent(request.id, storedCandidateStageRows(packed, [])[0]!),
    ).toEqual(encoded)
    expect(
      stageHistoryEvent(request.id, storedCandidateStageRows(run, [stage])[0]!),
    ).toEqual(encoded)
    expect(() =>
      storedCandidateStageRows(
        {
          ...run,
          traceFormatVersion: 2,
          stageIds: [stage.id],
          tracePayload: null,
        },
        [],
      ),
    ).toThrow("history_only_stage_payload_unavailable")
    expect(
      storedCandidateStageRows(
        {
          ...run,
          traceFormatVersion: 2,
          stageIds: [],
          tracePayload: null,
        },
        [],
      ),
    ).toEqual([])
    expect(() =>
      encodeRecommendationHistoryPage(
        Array.from({ length: 257 }, () => ({
          request,
          items: [],
          run: null,
          stages: [],
        })),
      ),
    ).toThrow()
  })
})
