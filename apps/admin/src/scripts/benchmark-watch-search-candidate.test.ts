import { describe, expect, it, vi } from "vitest"
import {
  CandidateQualificationConfigurationError,
  parseCandidateQualificationEvidence,
} from "@/services/typesense-watch-search-candidate-qualification"

import {
  distinctCaseRelevance,
  evaluateWatchSearchCandidateJudgment,
  evaluateCandidateQualification,
  normalizeCandidateBenchmarkDiagnostics,
  parseCandidateBenchmarkEnvironment,
  productionJudgedCaseInventoryReasons,
  PRODUCTION_CASES,
  runPairedCandidateBenchmark,
  type CandidateBenchmarkAttempt,
  type CandidateBenchmarkIdentity,
  type CandidateCompareResponse,
} from "./benchmark-watch-search-candidate"
import { WATCH_SEARCH_COMMON_PHRASE_QRELS_REVISION } from "./watch-search-candidate-intent-eval-cases"

const allSlices = [
  "exact-title",
  "partial-title",
  "punctuation-title",
  "typo-title",
  "duplicate-title",
  "no-result",
  "language-correctness",
  "mixed-language",
  "native-title",
  "topical",
  "semantic",
  "broad-title",
] as const

const identity: CandidateBenchmarkIdentity = {
  generationId: "generation-a",
  applicationRevision: "revision-a",
  rankingRevision: "canonical-intent-v2",
  transcriptCollection: "watch_search_transcripts_1",
  transcriptProjectionRevision: "7",
  qrelsRevision: WATCH_SEARCH_COMMON_PHRASE_QRELS_REVISION,
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
          slug: "jesus",
          label: "FEATURE_FILM",
          languageSlug: "japanese",
          playbackId: "playback-1",
          availability: {
            kind: "target_audio" as const,
            languageSlug: "japanese",
          },
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
      logicalSubsearches: profile === "CANDIDATE" ? 6 : 5,
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
          ? identity.rankingRevision
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
      logicalSubsearches: candidate ? 6 : 5,
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
      rankingImplementation: candidate
        ? identity.rankingRevision
        : "legacy-rrf",
      rankingMode: "SEMANTIC",
      ...diagnostics,
    },
    identity,
  }
}

const passingEvidence = {
  relevance: "PASS",
  fixedLoadResources: "PASS",
  exactKeyRam: "PASS",
  incrementalNonVectorDisk: "PASS",
  steadyCapacity: "PASS",
  peakCapacity: "PASS",
  swapAndFreeDisk: "PASS",
  buildImportDuration: "PASS",
  currentInterference: "PASS",
  operatorReview: "PASS",
  artifacts: {
    relevance: "artifact://candidate-qualification-1/relevance",
    fixedLoadResources: "artifact://candidate-qualification-1/fixed-load",
    exactKeyRam: "artifact://candidate-qualification-1/exact-key-ram",
    incrementalNonVectorDisk:
      "artifact://candidate-qualification-1/incremental-disk",
    steadyCapacity: "artifact://candidate-qualification-1/steady-capacity",
    peakCapacity: "artifact://candidate-qualification-1/peak-capacity",
    swapAndFreeDisk: "artifact://candidate-qualification-1/swap-free-disk",
    buildImportDuration: "artifact://candidate-qualification-1/build-duration",
    currentInterference:
      "artifact://candidate-qualification-1/current-interference",
    operatorReview: "artifact://candidate-qualification-1/operator-review",
  },
} as const

const evidenceGates = [
  "relevance",
  "fixedLoadResources",
  "exactKeyRam",
  "incrementalNonVectorDisk",
  "steadyCapacity",
  "peakCapacity",
  "swapAndFreeDisk",
  "buildImportDuration",
  "currentInterference",
  "operatorReview",
] as const

describe("paired candidate qualification benchmark", () => {
  it("uses a typed configuration error for malformed evidence", () => {
    expect(() => parseCandidateQualificationEvidence("not-json")).toThrow(
      CandidateQualificationConfigurationError,
    )
    expect(() =>
      parseCandidateQualificationEvidence(
        JSON.stringify({ ...passingEvidence, operatorReview: "PASS" }),
      ),
    ).not.toThrow()
  })
  it("covers multilingual and adverse production query slices", () => {
    const coveredSlices = new Set(
      PRODUCTION_CASES.flatMap((benchmarkCase) => benchmarkCase.slices),
    )
    expect(coveredSlices).toEqual(new Set(allSlices))
    expect(PRODUCTION_CASES.map(({ query }) => query)).toEqual(
      expect.arrayContaining(["Иисус", "耶稣", "耶穌", "イエス", "يسوع"]),
    )
    expect(
      PRODUCTION_CASES.filter(({ track }) => track === "exact-title").map(
        ({ id }) => id,
      ),
    ).toEqual([
      "jesus-japanese-mixed",
      "jesus-chinese-native",
      "jesus-chinese-traditional",
      "jesus-japanese-native",
      "jesus-russian-native",
      "jesus-arabic-native",
      "jesus-latin-exact",
    ])
    expect(
      PRODUCTION_CASES.find(({ id }) => id === "who-is-jesus")?.track,
    ).toBe("intent-query")
    expect(productionJudgedCaseInventoryReasons(PRODUCTION_CASES)).toEqual([])
    expect(
      productionJudgedCaseInventoryReasons(
        PRODUCTION_CASES.filter(({ id }) => id !== "jesus-for-kids"),
      ),
    ).toContain("judged_case_missing_jesus_for_kids")
    expect(
      productionJudgedCaseInventoryReasons(
        PRODUCTION_CASES.map((benchmarkCase) =>
          benchmarkCase.id === "jesus-latin-exact"
            ? { ...benchmarkCase, judgment: undefined }
            : benchmarkCase,
        ),
      ),
    ).toContain("judged_case_malformed_jesus_latin_exact")
  })
  it("requires a dedicated search key and the exact code-owned qrels revision", () => {
    expect(() =>
      parseCandidateBenchmarkEnvironment({
        TYPESENSE_HOST: "typesense.internal",
        TYPESENSE_API_KEY: "legacy-operator-key",
        WATCH_SEARCH_CANDIDATE_QRELS_REVISION:
          WATCH_SEARCH_COMMON_PHRASE_QRELS_REVISION,
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
        WATCH_SEARCH_CANDIDATE_QRELS_REVISION: ` ${WATCH_SEARCH_COMMON_PHRASE_QRELS_REVISION} `,
      }),
    ).toEqual({
      host: "typesense.internal",
      apiKey: "search-only-key",
      qrelsRevision: WATCH_SEARCH_COMMON_PHRASE_QRELS_REVISION,
    })
    expect(() =>
      parseCandidateBenchmarkEnvironment({
        TYPESENSE_HOST: "typesense.internal",
        TYPESENSE_SEARCH_API_KEY: "search-only-key",
        WATCH_SEARCH_CANDIDATE_QRELS_REVISION: "stale-qrels-v0",
      }),
    ).toThrow(/does not match code-owned revision/)
  })

  it.each([
    ["wrong slug", [{ slug: "not-jesus", rank: 1 }], "expected_slug_missing"],
    ["wrong rank", [{ slug: "jesus", rank: 2 }], "expected_slug_rank_exceeded"],
    [
      "wrong language",
      [{ slug: "jesus", languageSlug: "spanish-latin-america" }],
      "expected_slug_language_mismatch",
    ],
    [
      "wrong type",
      [{ slug: "jesus", label: "EPISODE" }],
      "expected_slug_content_type_mismatch",
    ],
    [
      "wrong availability",
      [{ slug: "jesus", availabilityKind: "unavailable" }],
      "expected_slug_availability_mismatch",
    ],
    [
      "missing playback",
      [{ slug: "jesus", playbackId: null }],
      "expected_slug_playback_missing",
    ],
  ] as const)(
    "reports a precise relevance reason for %s",
    (_label, changes, reason) => {
      const change = changes[0]
      const matchingResult = {
        id: "video-1",
        slug: change.slug,
        label: "label" in change ? change.label : "FEATURE_FILM",
        languageSlug:
          "languageSlug" in change ? change.languageSlug : "english",
        playbackId: "playbackId" in change ? change.playbackId : "playback-1",
        availability: {
          kind:
            "availabilityKind" in change
              ? change.availabilityKind
              : ("target_audio" as const),
          languageSlug: "english",
        },
      }
      const results =
        "rank" in change && change.rank === 2
          ? [
              {
                ...matchingResult,
                id: "video-before",
                slug: "another-video",
              },
              matchingResult,
            ]
          : [matchingResult]
      const verdict = evaluateWatchSearchCandidateJudgment(
        {
          expectedCanonicalSlugs: ["jesus"],
          acceptableCanonicalSlugs: [],
          maxRank: 1,
          allowedAvailabilityKinds: ["target_audio"],
          allowedContentTypes: ["FEATURE_FILM"],
          allowedLanguageSlugs: ["english"],
          requiresPlayback: true,
        },
        results,
      )

      expect(verdict.passed).toBe(false)
      expect(verdict.reasons).toContain(reason)
    },
  )

  it("accepts a reviewed alternate as the canonical outcome when no follower bound is declared", () => {
    const verdict = evaluateWatchSearchCandidateJudgment(
      {
        expectedCanonicalSlugs: ["expected-episode"],
        acceptableCanonicalSlugs: ["reviewed-alternate"],
        maxRank: 2,
        allowedAvailabilityKinds: ["target_audio"],
        allowedContentTypes: ["EPISODE"],
        allowedLanguageSlugs: ["english"],
        requiresPlayback: true,
      },
      [
        {
          id: "alternate",
          slug: "reviewed-alternate",
          label: "EPISODE",
          languageSlug: "english",
          playbackId: "playback-1",
          availability: {
            kind: "target_audio",
            languageSlug: "english",
          },
        },
      ],
    )

    expect(verdict).toMatchObject({
      passed: true,
      matchedSlug: "reviewed-alternate",
      matchedRank: 1,
      reasons: [],
    })
  })

  it("requires the named children alternate within its independent top-five bound", () => {
    const judgment = {
      expectedCanonicalSlugs: ["the-story-of-jesus-for-children"],
      acceptableCanonicalSlugs: [],
      maxRank: 1,
      requiredAlternate: {
        slugs: ["storyclubs-childhood-of-jesus"],
        maxRank: 5,
      },
      allowedAvailabilityKinds: ["target_audio" as const],
      allowedContentTypes: ["FEATURE_FILM"],
      allowedLanguageSlugs: ["english"],
      requiresPlayback: true,
    }
    const canonical = {
      id: "canonical",
      slug: "the-story-of-jesus-for-children",
      label: "FEATURE_FILM",
      languageSlug: "english",
      playbackId: "playback-1",
      availability: {
        kind: "target_audio" as const,
        languageSlug: "english",
      },
    }
    expect(
      evaluateWatchSearchCandidateJudgment(judgment, [canonical]).reasons,
    ).toContain("acceptable_alternate_missing")
    const filler = (slug: string) => ({ ...canonical, id: slug, slug })
    expect(
      evaluateWatchSearchCandidateJudgment(judgment, [
        canonical,
        filler("two"),
        filler("three"),
        filler("four"),
        filler("five"),
        filler("storyclubs-childhood-of-jesus"),
      ]).reasons,
    ).toContain("acceptable_alternate_rank_exceeded")
  })

  it("reduces repeated attempts to one distinct case and fails on one inconsistency", () => {
    const attempts = Array.from({ length: 1_000 }, (_, pairIndex) => ({
      ...successfulAttempt("candidate"),
      pairIndex,
      caseId: "jesus-for-kids",
      track: "intent-query" as const,
      relevance: {
        passed: pairIndex !== 999,
        matchedSlug: "the-story-of-jesus-for-children",
        matchedRank: pairIndex === 999 ? 2 : 1,
        reasons:
          pairIndex === 999
            ? ["expected_slug_rank_exceeded"]
            : ([] as string[]),
      },
    }))

    expect(distinctCaseRelevance(attempts)["intent-query"].candidate).toEqual({
      totalCases: 1,
      passedCases: 0,
      failedCases: 1,
      successRate: 0,
      cases: [
        {
          caseId: "jesus-for-kids",
          passed: false,
          attempts: 1_000,
          failedAttempts: 1,
          reasons: ["expected_slug_rank_exceeded"],
        },
      ],
    })
  })

  it("shows the Current children failure without using it as a qualification gate", () => {
    const current = {
      ...successfulAttempt("current"),
      caseId: "jesus-for-kids",
      track: "intent-query" as const,
      relevance: {
        passed: false,
        matchedSlug: "the-story-of-jesus-for-children",
        matchedRank: 4,
        reasons: ["expected_slug_rank_exceeded"],
      },
    }
    const candidate = {
      ...successfulAttempt("candidate"),
      caseId: "jesus-for-kids",
      track: "intent-query" as const,
      relevance: {
        passed: true,
        matchedSlug: "the-story-of-jesus-for-children",
        matchedRank: 1,
        reasons: [] as string[],
      },
    }

    const evaluation = evaluateCandidateQualification({
      identity,
      attempts: [current, candidate],
      requiredPairs: 1,
      requiredSlices: allSlices,
      evidence: passingEvidence,
    })

    expect(evaluation.status).toBe("QUALIFIED")
    expect(
      evaluation.relevance.tracks["intent-query"].current.cases[0],
    ).toMatchObject({ passed: false, attempts: 1 })
    expect(
      evaluation.relevance.tracks["intent-query"].candidate.cases[0],
    ).toMatchObject({ passed: true, attempts: 1 })
  })

  it("fails qualification with a case-specific Candidate relevance reason", () => {
    const current = {
      ...successfulAttempt("current"),
      caseId: "jesus-for-kids",
      track: "intent-query" as const,
      relevance: {
        passed: false,
        matchedSlug: "the-story-of-jesus-for-children",
        matchedRank: 4,
        reasons: ["expected_slug_rank_exceeded"],
      },
    }
    const candidate = {
      ...successfulAttempt("candidate"),
      caseId: "jesus-for-kids",
      track: "intent-query" as const,
      relevance: {
        passed: false,
        matchedSlug: "the-story-of-jesus-for-children",
        matchedRank: 2,
        reasons: ["expected_slug_rank_exceeded"],
      },
    }

    const evaluation = evaluateCandidateQualification({
      identity,
      attempts: [current, candidate],
      requiredPairs: 1,
      requiredSlices: allSlices,
      evidence: passingEvidence,
    })

    expect(evaluation.status).toBe("NOT_QUALIFIED")
    expect(evaluation.reasons).toContain(
      "candidate_intent_query_jesus_for_kids_expected_slug_rank_exceeded",
    )
  })

  it("invalidates a programmatic qualification with stale qrels identity", () => {
    const evaluation = evaluateCandidateQualification({
      identity: { ...identity, qrelsRevision: "stale-qrels-v0" },
      attempts: [successfulAttempt("current"), successfulAttempt("candidate")],
      requiredPairs: 1,
      requiredSlices: allSlices,
      evidence: passingEvidence,
    })

    expect(evaluation.status).toBe("INVALID")
    expect(evaluation.reasons).toContain("qrels_revision_mismatch")
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
        exactKeyRam: "NOT_RUN",
        incrementalNonVectorDisk: "NOT_RUN",
        steadyCapacity: "NOT_RUN",
        peakCapacity: "NOT_RUN",
        swapAndFreeDisk: "NOT_RUN",
        buildImportDuration: "NOT_RUN",
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
        "exact_key_ram_not_passed",
        "incremental_non_vector_disk_not_passed",
        "steady_capacity_not_passed",
        "peak_capacity_not_passed",
        "swap_and_free_disk_not_passed",
        "build_import_duration_not_passed",
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

  it.each(
    (
      [
        ["callerObserved", "callerObservedMs"],
        ["server", "serverMs"],
        ["typesenseWall", "typesenseWallMs"],
        ["typesenseServer", "typesenseServerMs"],
      ] as const
    ).flatMap(([surface, field]) =>
      (["p50Ms", "p95Ms", "p99Ms"] as const).map(
        (quantile) => [surface, field, quantile] as const,
      ),
    ),
  )("rejects an isolated %s %s regression", (surface, field, quantile) => {
    const attempts = Array.from({ length: 100 }, (_, pairIndex) => {
      const currentValue =
        pairIndex < 50 ? 10 : pairIndex < 95 ? 100 : pairIndex < 99 ? 200 : 300
      const candidateValue =
        (quantile === "p50Ms" && pairIndex < 50) ||
        (quantile === "p95Ms" && pairIndex >= 50 && pairIndex < 95) ||
        (quantile === "p99Ms" && pairIndex >= 95 && pairIndex < 99)
          ? currentValue + 1
          : currentValue
      const order =
        pairIndex % 2 === 0
          ? ("current-first" as const)
          : ("candidate-first" as const)
      return [
        {
          ...successfulAttempt("current"),
          pairIndex,
          order,
          [field]: currentValue,
        },
        {
          ...successfulAttempt("candidate"),
          pairIndex,
          order,
          [field]: candidateValue,
        },
      ]
    }).flat()
    const evaluation = evaluateCandidateQualification({
      identity,
      attempts,
      requiredPairs: 100,
      requiredSlices: allSlices,
      evidence: passingEvidence,
    })

    expect(evaluation.status).toBe("NOT_QUALIFIED")
    expect(evaluation.reasons).toContain(
      `aggregate_${surface}_${quantile}_regressed`,
    )
    for (const otherQuantile of ["p50Ms", "p95Ms", "p99Ms"] as const) {
      if (otherQuantile === quantile) continue
      expect(evaluation.reasons).not.toContain(
        `aggregate_${surface}_${otherQuantile}_regressed`,
      )
    }
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

  it("requires equal HTTP calls and exactly one extra Candidate subsearch", () => {
    const evaluation = evaluateCandidateQualification({
      identity,
      attempts: [
        successfulAttempt("current"),
        successfulAttempt("candidate", {
          retrievalCalls: 1,
          logicalSubsearches: 5,
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

  it("allows exactly one extra Candidate subsearch and 256 KiB response growth", () => {
    const current = successfulAttempt("current", {
      retrievalCalls: 2,
      logicalSubsearches: 5,
      parsedResponseBytes: 800,
    })
    const candidate = successfulAttempt("candidate", {
      retrievalCalls: 2,
      logicalSubsearches: 6,
      requestBytes: 32 * 1_024,
      parsedResponseBytes: 800 + 256 * 1_024,
    })

    const evaluation = evaluateCandidateQualification({
      identity,
      attempts: [current, candidate],
      requiredPairs: 1,
      requiredSlices: allSlices,
      evidence: passingEvidence,
    })

    expect(evaluation.status).toBe("QUALIFIED")
    expect(evaluation.reasons).toEqual([])
  })

  it("rejects Candidate response growth above 256 KiB", () => {
    const evaluation = evaluateCandidateQualification({
      identity,
      attempts: [
        successfulAttempt("current", { parsedResponseBytes: 800 }),
        successfulAttempt("candidate", {
          parsedResponseBytes: 800 + 256 * 1_024 + 1,
        }),
      ],
      requiredPairs: 1,
      requiredSlices: allSlices,
      evidence: passingEvidence,
    })

    expect(evaluation.status).toBe("NOT_QUALIFIED")
    expect(evaluation.reasons).toContain("candidate_response_bytes")
  })

  it.each([
    ["retrievalCalls", 3, "candidate_retrieval_calls"],
    ["logicalSubsearches", 7, "candidate_logical_subsearches"],
    ["queryFieldCount", 65, "candidate_query_fields"],
    ["queryByBytes", 4_097, "candidate_query_by_bytes"],
    ["requestBytes", 32_769, "candidate_request_bytes"],
    ["retryCount", 1, "candidate_retries"],
    ["hydratedRecords", 251, "candidate_hydration"],
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

  it("rejects Candidate hydration above its paired Current request", () => {
    const evaluation = evaluateCandidateQualification({
      identity,
      attempts: [
        successfulAttempt("current", { hydratedRecords: 1 }),
        successfulAttempt("candidate", { hydratedRecords: 2 }),
      ],
      requiredPairs: 1,
      requiredSlices: allSlices,
      evidence: passingEvidence,
    })

    expect(evaluation.status).toBe("NOT_QUALIFIED")
    expect(evaluation.reasons).toContain("candidate_hydrated_records")
  })

  it.each(evidenceGates)("fails closed when %s evidence fails", (gate) => {
    const evaluation = evaluateCandidateQualification({
      identity,
      attempts: [successfulAttempt("current"), successfulAttempt("candidate")],
      requiredPairs: 1,
      requiredSlices: allSlices,
      evidence: { ...passingEvidence, [gate]: "FAIL" },
    })

    expect(evaluation.status).toBe("NOT_QUALIFIED")
    expect(evaluation.reasons).toContain(
      `${gate.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}_not_passed`,
    )
  })

  it.each(evidenceGates)(
    "requires an artifact for passing %s evidence",
    (gate) => {
      const artifacts = { ...passingEvidence.artifacts }
      delete artifacts[gate]
      const evaluation = evaluateCandidateQualification({
        identity,
        attempts: [
          successfulAttempt("current"),
          successfulAttempt("candidate"),
        ],
        requiredPairs: 1,
        requiredSlices: allSlices,
        evidence: { ...passingEvidence, artifacts },
      })

      expect(evaluation.status).toBe("NOT_QUALIFIED")
      expect(evaluation.reasons).toContain(
        `${gate.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}_artifact_missing`,
      )
    },
  )
})
