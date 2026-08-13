import { describe, expect, it, vi } from "vitest"

import {
  evaluateCandidateQualification,
  normalizeCandidateBenchmarkDiagnostics,
  parseCandidateBenchmarkEnvironment,
  runPairedCandidateBenchmark,
  type CandidateBenchmarkAttempt,
  type CandidateBenchmarkIdentity,
  type CandidateCompareResponse,
} from "./benchmark-watch-search-candidate"

const allSlices = [
  "exact-title",
  "mixed-language",
  "native-title",
  "topical",
  "semantic",
  "broad-title",
] as const

const identity: CandidateBenchmarkIdentity = {
  generationId: "generation-a",
  applicationRevision: "revision-a",
  rankingRevision: "title-and-brand-v1",
  transcriptCollection: "watch_search_transcripts_1",
  transcriptProjectionRevision: "7",
  qrelsRevision: "qrels-1",
  currentBindings: {
    catalog: "watch_search_catalog_1",
    availability: "watch_search_availability_1",
    lexical: "watch_search_lexical_1",
    transcript: "watch_search_transcripts_1",
  },
  candidateBindings: {
    catalog: "watch_search_candidate_generation-a_catalog",
    availability: "watch_search_candidate_generation-a_availability",
    lexical: "watch_search_candidate_generation-a_lexical",
    transcript: "watch_search_transcripts_1",
  },
}

function successResponse(
  order: "current-first" | "candidate-first",
): CandidateCompareResponse {
  const side = (profile: "CURRENT" | "CANDIDATE", latencyMs: number) => ({
    status: "success" as const,
    response: {
      latencyMs,
      degraded: false,
      results: [
        {
          id: "video-1",
          languageSlug: "japanese",
          playbackId: "playback-1",
        },
      ],
    },
    diagnostics: {
      profile,
      generationId: profile === "CANDIDATE" ? "generation-a" : null,
      applicationRevision: profile === "CANDIDATE" ? "revision-a" : null,
      transcriptProjectionRevision: profile === "CANDIDATE" ? "7" : null,
      binding:
        profile === "CANDIDATE"
          ? identity.candidateBindings
          : identity.currentBindings,
      retrievalCalls: 2,
      logicalSubsearches: 5,
      queryFieldCount: 8,
      queryByBytes: 120,
      requestBytes: 400,
      parsedResponseBytes: 800,
      typesenseSearchTimeMs: 10,
      typesenseWallTimeMs: 20,
      retryCount: 0,
      groupedHits: 3,
      candidates: 10,
      hydratedRecords: 1,
      rankingImplementation:
        profile === "CANDIDATE"
          ? ("title-and-brand-v1" as const)
          : ("legacy-rrf" as const),
      rankingMode: "SEMANTIC" as const,
    },
  })
  return {
    comparisonId: `comparison-${order}`,
    executionOrder: order,
    current: side("CURRENT", 40),
    candidate: side("CANDIDATE", 39),
  }
}

function successfulAttempt(
  side: "current" | "candidate",
  diagnostics: Partial<
    NonNullable<CandidateBenchmarkAttempt["diagnostics"]>
  > = {},
): CandidateBenchmarkAttempt {
  const candidate = side === "candidate"
  return {
    pairIndex: 0,
    caseId: "all-slices",
    slices: allSlices,
    order: "current-first",
    side,
    outcome: "success",
    callerObservedMs: candidate ? 99 : 100,
    serverMs: candidate ? 49 : 50,
    typesenseWallMs: candidate ? 19 : 20,
    typesenseServerMs: candidate ? 9 : 10,
    degraded: false,
    error: null,
    resultSignature: "a".repeat(64),
    diagnostics: {
      profile: candidate ? "CANDIDATE" : "CURRENT",
      generationId: candidate ? identity.generationId : null,
      applicationRevision: candidate ? identity.applicationRevision : null,
      transcriptProjectionRevision: candidate
        ? identity.transcriptProjectionRevision
        : null,
      binding: candidate
        ? identity.candidateBindings
        : identity.currentBindings,
      retrievalCalls: 2,
      logicalSubsearches: 5,
      queryFieldCount: 8,
      queryByBytes: 120,
      requestBytes: 400,
      parsedResponseBytes: 800,
      typesenseSearchTimeMs: 10,
      typesenseWallTimeMs: 20,
      retryCount: 0,
      groupedHits: 3,
      candidates: 10,
      hydratedRecords: 1,
      rankingImplementation: candidate ? "title-and-brand-v1" : "legacy-rrf",
      rankingMode: "SEMANTIC",
      ...diagnostics,
    },
    identity,
  }
}

const passingEvidence = {
  relevance: "PASS",
  fixedLoadResources: "PASS",
  currentInterference: "PASS",
  operatorReview: "PASS",
  artifacts: { reviewedReport: "artifact://candidate-qualification-1" },
} as const

describe("paired candidate qualification benchmark", () => {
  it("requires a dedicated search key and an explicit qrels revision", () => {
    expect(() =>
      parseCandidateBenchmarkEnvironment({
        TYPESENSE_HOST: "typesense.internal",
        TYPESENSE_API_KEY: "legacy-operator-key",
        WATCH_SEARCH_CANDIDATE_QRELS_REVISION: "qrels-1",
      }),
    ).toThrow(/TYPESENSE_SEARCH_API_KEY/)
    expect(() =>
      parseCandidateBenchmarkEnvironment({
        TYPESENSE_HOST: "typesense.internal",
        TYPESENSE_SEARCH_API_KEY: "search-only-key",
      }),
    ).toThrow(/QRELS_REVISION/)
    expect(
      parseCandidateBenchmarkEnvironment({
        TYPESENSE_HOST: "typesense.internal",
        TYPESENSE_SEARCH_API_KEY: "search-only-key",
        TYPESENSE_API_KEY: "legacy-operator-key",
        WATCH_SEARCH_CANDIDATE_QRELS_REVISION: " qrels-1 ",
      }),
    ).toEqual({
      host: "typesense.internal",
      apiKey: "search-only-key",
      qrelsRevision: "qrels-1",
    })
  })

  it("renews the exact lease, alternates order, and retains every attempt", async () => {
    const orders: string[] = []
    const result = await runPairedCandidateBenchmark(
      {
        identity,
        cases: [
          {
            id: "jesus-japanese",
            query: "Jesus Japanese",
            locale: "ja",
            languageSlug: "japanese",
            slices: ["exact-title", "mixed-language"],
          },
        ],
        pairsPerCase: 2,
      },
      {
        acquireLease: vi.fn(async () => ({
          expiresAt: new Date(Date.now() + 60_000),
        })),
        renewLease: vi.fn(async () => true),
        releaseLease: vi.fn(async () => true),
        compare: vi.fn(async ({ order }) => {
          orders.push(order)
          if (order === "candidate-first") {
            return {
              ...successResponse(order),
              candidate: {
                status: "error" as const,
                error: { code: "search_failed", errorClass: "Error" },
              },
            }
          }
          return successResponse(order)
        }),
      },
    )

    expect(orders).toEqual(["current-first", "candidate-first"])
    expect(result.attempts).toHaveLength(4)
    expect(
      result.attempts.filter((entry) => entry.outcome === "error"),
    ).toHaveLength(1)
    expect(result.attempts[0]).toMatchObject({
      caseId: "jesus-japanese",
      order: "current-first",
      side: "current",
      resultSignature: expect.stringMatching(/^[a-f0-9]{64}$/),
      diagnostics: { retrievalCalls: 2, requestBytes: 400 },
    })
    expect(result.status).toBe("NOT_QUALIFIED")
    expect(result.reasons).toContain("attempt_failures")
  })

  it("fails closed and stops when lease renewal is lost", async () => {
    const compare = vi.fn(async () => successResponse("current-first"))
    const result = await runPairedCandidateBenchmark(
      {
        identity,
        cases: [
          {
            id: "native-title",
            query: "耶稣",
            locale: "zh-Hans",
            languageSlug: "mandarin-china",
            slices: ["native-title"],
          },
        ],
        pairsPerCase: 2,
      },
      {
        acquireLease: vi.fn(async () => ({
          expiresAt: new Date(Date.now() + 60_000),
        })),
        renewLease: vi.fn().mockResolvedValueOnce(false),
        releaseLease: vi.fn(async () => true),
        compare,
      },
    )

    expect(compare).not.toHaveBeenCalled()
    expect(result.status).toBe("INVALID")
    expect(result.reasons).toContain("lease_lost")
  })

  it("fails closed when execution order or response identity drifts", async () => {
    const releaseLease = vi.fn(async () => true)
    const wrongOrder = await runPairedCandidateBenchmark(
      {
        identity,
        cases: [
          { id: "native-title", query: "耶稣", slices: ["native-title"] },
        ],
        pairsPerCase: 1,
      },
      {
        acquireLease: vi.fn(async () => ({
          expiresAt: new Date(Date.now() + 60_000),
        })),
        renewLease: vi.fn(async () => true),
        releaseLease,
        compare: vi.fn(async () => successResponse("candidate-first")),
      },
    )
    expect(wrongOrder.status).toBe("INVALID")
    expect(wrongOrder.reasons).toContain("identity_drift")
    expect(releaseLease).toHaveBeenCalledOnce()

    const mismatched = successResponse("current-first")
    if (mismatched.candidate.status === "success") {
      mismatched.candidate.diagnostics.generationId = "generation-b"
    }
    const wrongIdentity = await runPairedCandidateBenchmark(
      {
        identity,
        cases: [
          { id: "native-title", query: "耶稣", slices: ["native-title"] },
        ],
        pairsPerCase: 1,
      },
      {
        acquireLease: vi.fn(async () => ({
          expiresAt: new Date(Date.now() + 60_000),
        })),
        renewLease: vi.fn(async () => true),
        releaseLease: vi.fn(async () => true),
        compare: vi.fn(async () => mismatched),
      },
    )
    expect(wrongIdentity.status).toBe("INVALID")
    expect(wrongIdentity.reasons).toContain("identity_drift")
  })

  it("reports p50/p95/p99 but refuses qualification without production evidence", () => {
    const attempts = Array.from({ length: 2_000 }, (_, index) => ({
      pairIndex: Math.floor(index / 2),
      caseId: "all-slices",
      slices: [
        "exact-title",
        "mixed-language",
        "native-title",
        "topical",
        "semantic",
        "broad-title",
      ] as const,
      order:
        Math.floor(index / 2) % 2 === 0
          ? ("current-first" as const)
          : ("candidate-first" as const),
      side: index % 2 === 0 ? ("current" as const) : ("candidate" as const),
      outcome: "success" as const,
      callerObservedMs: index % 2 === 0 ? 100 : 99,
      serverMs: index % 2 === 0 ? 50 : 49,
      typesenseWallMs: index % 2 === 0 ? 20 : 19,
      typesenseServerMs: index % 2 === 0 ? 10 : 9,
      degraded: false,
      error: null,
      resultSignature: "a".repeat(64),
      diagnostics: null,
      identity,
    }))

    const evaluation = evaluateCandidateQualification({
      identity,
      attempts,
      requiredPairs: 1_000,
      requiredSlices: [
        "exact-title",
        "mixed-language",
        "native-title",
        "topical",
        "semantic",
        "broad-title",
      ],
      evidence: {
        relevance: "NOT_RUN",
        fixedLoadResources: "NOT_RUN",
        currentInterference: "NOT_RUN",
        operatorReview: "NOT_RUN",
      },
    })

    expect(evaluation.latency.aggregate.current.callerObserved).toEqual({
      p50Ms: 100,
      p95Ms: 100,
      p99Ms: 100,
    })
    expect(evaluation.latency.aggregate.candidate.typesenseWall).toEqual({
      p50Ms: 19,
      p95Ms: 19,
      p99Ms: 19,
    })
    expect(evaluation.status).toBe("NOT_QUALIFIED")
    expect(evaluation.reasons).toEqual(
      expect.arrayContaining([
        "relevance_not_passed",
        "fixed_load_resources_not_passed",
        "current_interference_not_passed",
        "operator_review_not_passed",
      ]),
    )
  })

  it("qualifies only a complete, non-regressing, reviewed candidate", () => {
    const evaluation = evaluateCandidateQualification({
      identity,
      attempts: [successfulAttempt("current"), successfulAttempt("candidate")],
      requiredPairs: 1,
      requiredSlices: allSlices,
      evidence: passingEvidence,
    })

    expect(evaluation.status).toBe("QUALIFIED")
    expect(evaluation.reasons).toEqual([])
  })

  it("rejects Typesense p95 regressions even when application latency improves", () => {
    const current = successfulAttempt("current")
    const candidate = {
      ...successfulAttempt("candidate"),
      typesenseWallMs: 21,
      typesenseServerMs: 11,
    }
    const evaluation = evaluateCandidateQualification({
      identity,
      attempts: [current, candidate],
      requiredPairs: 1,
      requiredSlices: allSlices,
      evidence: passingEvidence,
    })

    expect(evaluation.status).toBe("NOT_QUALIFIED")
    expect(evaluation.reasons).toEqual(
      expect.arrayContaining([
        "aggregate_typesenseWall_p95Ms_regressed",
        "aggregate_typesenseServer_p95Ms_regressed",
      ]),
    )
  })

  it("rejects a Candidate p95 at or above the one-second budget", () => {
    const evaluation = evaluateCandidateQualification({
      identity,
      attempts: [
        { ...successfulAttempt("current"), callerObservedMs: 1_100 },
        { ...successfulAttempt("candidate"), callerObservedMs: 1_000 },
      ],
      requiredPairs: 1,
      requiredSlices: allSlices,
      evidence: passingEvidence,
    })

    expect(evaluation.status).toBe("NOT_QUALIFIED")
    expect(evaluation.reasons).toContain(
      "aggregate_callerObserved_p95Ms_budget_exceeded",
    )
  })

  it("allowlists benchmark diagnostics and excludes query-derived ranking evidence", () => {
    const normalized = normalizeCandidateBenchmarkDiagnostics({
      ...successfulAttempt("candidate").diagnostics!,
      transcriptProjectionRevision: 7n,
      rankingAnchor: {
        normalized: "private sentinel query",
        core: "private sentinel query",
        compactCore: "privatesentinelquery",
        coreTokens: ["private", "sentinel", "query"],
        sourceCanonicalVideoId: "core:sentinel",
        matchKind: "NORMALIZED_WHOLE_TITLE",
      },
      rankingTrace: [],
    })

    expect(normalized).not.toHaveProperty("rankingAnchor")
    expect(normalized).not.toHaveProperty("rankingTrace")
    expect(JSON.stringify(normalized)).not.toContain("private sentinel query")
  })

  it("requires candidate calls and logical subsearches to match Current", () => {
    const evaluation = evaluateCandidateQualification({
      identity,
      attempts: [
        successfulAttempt("current"),
        successfulAttempt("candidate", {
          retrievalCalls: 1,
          logicalSubsearches: 4,
        }),
      ],
      requiredPairs: 1,
      requiredSlices: allSlices,
      evidence: passingEvidence,
    })

    expect(evaluation.reasons).toEqual(
      expect.arrayContaining([
        "candidate_retrieval_calls_mismatch",
        "candidate_logical_subsearches_mismatch",
      ]),
    )
  })

  it.each([
    ["logicalSubsearches", 6, "candidate_logical_subsearches"],
    ["queryFieldCount", 65, "candidate_query_fields"],
    ["queryByBytes", 4_097, "candidate_query_by_bytes"],
    ["requestBytes", 32_769, "candidate_request_bytes"],
  ] as const)(
    "rejects candidate work beyond the %s bound",
    (field, value, reason) => {
      const evaluation = evaluateCandidateQualification({
        identity,
        attempts: [
          successfulAttempt("current"),
          successfulAttempt("candidate", { [field]: value }),
        ],
        requiredPairs: 1,
        requiredSlices: allSlices,
        evidence: passingEvidence,
      })

      expect(evaluation.status).toBe("NOT_QUALIFIED")
      expect(evaluation.reasons).toContain(reason)
    },
  )
})
