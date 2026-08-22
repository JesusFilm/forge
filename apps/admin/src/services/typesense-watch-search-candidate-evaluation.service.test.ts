import { describe, expect, it, vi } from "vitest"

import type { TypesenseWatchSearchProfile } from "./typesense-watch-search-profile"
import {
  type CandidateSearchEvaluationDeps,
  CandidateSearchEvaluationError,
  candidateSearchEvaluationRevision,
  resolveServingCandidateWatchSearchProfile,
  TypesenseWatchSearchCandidateEvaluationService,
} from "./typesense-watch-search-candidate-evaluation.service"
import type { TypesenseWatchSearchDiagnostics } from "./typesense-watch-search.service"
import type { WatchSearchInput } from "./watch-search.service"

const currentProfile = {
  kind: "CURRENT",
  binding: {
    catalog: "watch_search_catalog_physical",
    availability: "watch_search_availability_physical",
    lexical: "watch_search_lexical_physical",
    transcript: "watch_search_transcripts_physical",
  },
  generationId: null,
  applicationRevision: null,
  rankingRevision: "legacy-rrf",
  transcriptProjectionRevision: null,
  fieldManifests: null,
  allowCompatibilityFallback: false,
} as const satisfies TypesenseWatchSearchProfile

const candidateProfile = {
  kind: "CANDIDATE",
  binding: {
    catalog: "watch_search_candidate_generation-1_catalog",
    availability: "watch_search_candidate_generation-1_availability",
    lexical: "watch_search_candidate_generation-1_lexical",
    transcript: "watch_search_transcripts_physical",
  },
  generationId: "generation-1",
  applicationRevision: "watch-search-candidate/v2",
  rankingRevision: "canonical-intent-v2",
  transcriptProjectionRevision: 7n,
  qrelsRevision: "qrels-reviewed-1",
  fieldManifests: {
    catalog: [{ name: "slug", type: "string" }],
    availability: [{ name: "videoId", type: "string" }],
    lexical: [{ name: "title_en", type: "string[]" }],
    transcript: [{ name: "embedding", type: "float[]" }],
  },
  allowCompatibilityFallback: false,
} as const satisfies TypesenseWatchSearchProfile

function searchResult(): {
  response: {
    query: string
    results: []
    hasMore: boolean
    nextOffset: number
    searchMode: string
    requestId: string
    degraded: boolean
    latencyMs: number
    laneStatuses: []
    languageInterpretation: {
      queryLanguageSlug: null
      queryNamedLanguageSlug: null
      targetLanguageSlug: string
      targetLanguageSource: "fallback"
      displayLanguageSlug: null
      routeLanguageSlug: null
      currentWatchLanguageSlug: null
      acceptLanguage: null
      acceptLanguageSlug: null
    }
  }
  diagnostics: TypesenseWatchSearchDiagnostics
} {
  return {
    response: {
      query: "Jesus",
      results: [],
      hasMore: false,
      nextOffset: 10,
      searchMode: "watch-search-typesense",
      requestId: "candidate-request-1",
      degraded: false,
      latencyMs: 20,
      laneStatuses: [],
      languageInterpretation: {
        queryLanguageSlug: null,
        queryNamedLanguageSlug: null,
        targetLanguageSlug: "english",
        targetLanguageSource: "fallback" as const,
        displayLanguageSlug: null,
        routeLanguageSlug: null,
        currentWatchLanguageSlug: null,
        acceptLanguage: null,
        acceptLanguageSlug: null,
      },
    },
    diagnostics: {
      profile: "CANDIDATE" as const,
      generationId: candidateProfile.generationId,
      applicationRevision: candidateProfile.applicationRevision,
      transcriptProjectionRevision:
        candidateProfile.transcriptProjectionRevision,
      binding: candidateProfile.binding,
      retrievalCalls: 2,
      logicalSubsearches: 5,
      queryFieldCount: 4,
      queryByBytes: 40,
      requestBytes: 100,
      parsedResponseBytes: 200,
      typesenseSearchTimeMs: 10,
      typesenseWallTimeMs: 12,
      retryCount: 0,
      groupedHits: 3,
      candidates: 3,
      hydratedRecords: 1,
      rankingImplementation: "canonical-intent-v2" as const,
      rankingMode: "SEMANTIC" as const,
      rankingAnchor: null,
      rankingTrace: [],
    },
  }
}

function fixture() {
  const searchWithDiagnostics = vi.fn(async (_input: WatchSearchInput) =>
    searchResult(),
  )
  const acquireLease = vi.fn<CandidateSearchEvaluationDeps["acquireLease"]>(
    async ({ source, evaluationId }) => ({
      resourceKey: `watch-search-candidate-eval:${source.toLowerCase()}:${evaluationId}`,
      holderToken: `holder-${evaluationId}`,
      generationId: "generation-1",
      applicationRevision: "watch-search-candidate/v2",
      transcriptCollection: "watch_search_transcripts_physical",
      transcriptProjectionRevision: 7n,
      currentBindings: Object.values(currentProfile.binding),
      expiresAt: new Date(Date.now() + 60_000),
    }),
  )
  const deps = {
    source: "EVALUATION" as const,
    resolveCurrentProfile: vi.fn(async () => currentProfile),
    resolveCandidateProfile: vi.fn(async () => candidateProfile),
    createSearch: vi.fn(() => ({ searchWithDiagnostics })),
    acquireLease,
    renewLease: vi.fn(async () => true),
    releaseLease: vi.fn(async () => true),
    verifyCandidateProfile: vi.fn(async () => true),
    leaseReleaseTimeoutMs: 10,
    onCleanupFailure: vi.fn(),
  }
  return { deps, searchWithDiagnostics }
}

describe("TypesenseWatchSearchCandidateEvaluationService", () => {
  it("runs four concurrent searches under unique leases with one immutable revision", async () => {
    const { deps, searchWithDiagnostics } = fixture()
    const service = new TypesenseWatchSearchCandidateEvaluationService(deps)

    const results = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        service.search({ query: `Jesus ${index}` }),
      ),
    )

    expect(searchWithDiagnostics).toHaveBeenCalledTimes(4)
    expect(deps.acquireLease).toHaveBeenCalledTimes(4)
    expect(deps.acquireLease).toHaveBeenCalledWith(
      expect.objectContaining({ source: "EVALUATION" }),
    )
    expect(deps.renewLease).toHaveBeenCalledTimes(8)
    expect(deps.verifyCandidateProfile).toHaveBeenCalledTimes(4)
    expect(deps.releaseLease).toHaveBeenCalledTimes(4)
    expect(
      new Set(deps.acquireLease.mock.calls.map(([input]) => input.evaluationId))
        .size,
    ).toBe(4)
    expect(new Set(results.map((result) => result.revision))).toEqual(
      new Set([expect.stringMatching(/^watch-search-candidate:[a-f0-9]{64}$/)]),
    )
  })

  it.each([
    "missing Evaluation pointer",
    "generation is not READY",
    "application revision is incompatible",
  ])("fails closed when the Candidate profile is unavailable: %s", async () => {
    const { deps } = fixture()
    deps.resolveCandidateProfile.mockRejectedValueOnce(new Error("unavailable"))

    await expect(
      new TypesenseWatchSearchCandidateEvaluationService(deps).search({
        query: "Jesus",
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "CandidateSearchEvaluationError",
        code: "profile_unavailable",
      }),
    )
    expect(deps.acquireLease).not.toHaveBeenCalled()
  })

  it("fails closed on admission or lease renewal loss and still releases acquired leases", async () => {
    const unavailable = fixture()
    unavailable.deps.acquireLease.mockResolvedValueOnce(null)
    await expect(
      new TypesenseWatchSearchCandidateEvaluationService(
        unavailable.deps,
      ).search({ query: "Jesus" }),
    ).rejects.toMatchObject({ code: "lease_unavailable" })
    expect(unavailable.deps.releaseLease).not.toHaveBeenCalled()

    const lost = fixture()
    lost.deps.renewLease.mockResolvedValueOnce(false)
    await expect(
      new TypesenseWatchSearchCandidateEvaluationService(lost.deps).search({
        query: "Jesus",
      }),
    ).rejects.toMatchObject({ code: "lease_lost" })
    expect(lost.deps.releaseLease).toHaveBeenCalledOnce()
  })

  it("fails closed when the lease is lost after search completion", async () => {
    const lost = fixture()
    lost.deps.renewLease
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)

    await expect(
      new TypesenseWatchSearchCandidateEvaluationService(lost.deps).search({
        query: "Jesus",
      }),
    ).rejects.toMatchObject({ code: "lease_lost" })
    expect(lost.searchWithDiagnostics).toHaveBeenCalledOnce()
    expect(lost.deps.releaseLease).toHaveBeenCalledOnce()
  })

  it("fails closed when the selected pointer moves during the search", async () => {
    const moved = fixture()
    moved.deps.verifyCandidateProfile.mockResolvedValueOnce(false)

    await expect(
      new TypesenseWatchSearchCandidateEvaluationService(moved.deps).search({
        query: "Jesus",
      }),
    ).rejects.toMatchObject({ code: "identity_mismatch" })
    expect(moved.searchWithDiagnostics).toHaveBeenCalledOnce()
    expect(moved.deps.releaseLease).toHaveBeenCalledOnce()
  })

  it("reports lease cleanup failures without masking a successful search", async () => {
    const failed = fixture()
    failed.deps.releaseLease.mockRejectedValueOnce(
      new Error("database unavailable"),
    )

    await expect(
      new TypesenseWatchSearchCandidateEvaluationService(failed.deps).search({
        query: "Jesus",
      }),
    ).resolves.toMatchObject({ response: { requestId: "candidate-request-1" } })
    expect(failed.deps.onCleanupFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceKey: expect.stringMatching(/^watch-search-candidate-eval:/),
        reason: "release_failed",
      }),
    )
  })

  it("bounds a stalled lease cleanup and reports its timeout", async () => {
    const stalled = fixture()
    stalled.deps.releaseLease.mockImplementationOnce(
      () => new Promise<boolean>(() => undefined),
    )

    await expect(
      new TypesenseWatchSearchCandidateEvaluationService(stalled.deps).search({
        query: "Jesus",
      }),
    ).resolves.toMatchObject({ response: { requestId: "candidate-request-1" } })
    expect(stalled.deps.onCleanupFailure).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "release_timeout" }),
    )
  })

  it("rejects lease or runtime identity drift before returning results", async () => {
    const staleLease = fixture()
    staleLease.deps.acquireLease.mockResolvedValueOnce({
      resourceKey: "watch-search-candidate-eval:stale",
      holderToken: "holder-stale",
      generationId: "generation-stale",
      applicationRevision: "watch-search-candidate/v2",
      transcriptCollection: "watch_search_transcripts_physical",
      transcriptProjectionRevision: 7n,
      currentBindings: Object.values(currentProfile.binding),
      expiresAt: new Date(Date.now() + 60_000),
    })
    await expect(
      new TypesenseWatchSearchCandidateEvaluationService(
        staleLease.deps,
      ).search({ query: "Jesus" }),
    ).rejects.toMatchObject({ code: "identity_mismatch" })
    expect(staleLease.searchWithDiagnostics).not.toHaveBeenCalled()
    expect(staleLease.deps.releaseLease).toHaveBeenCalledOnce()

    const driftedSearch = fixture()
    driftedSearch.searchWithDiagnostics.mockResolvedValueOnce({
      ...searchResult(),
      diagnostics: {
        ...searchResult().diagnostics,
        generationId: "generation-drifted",
      },
    })
    await expect(
      new TypesenseWatchSearchCandidateEvaluationService(
        driftedSearch.deps,
      ).search({ query: "Jesus" }),
    ).rejects.toMatchObject({ code: "identity_mismatch" })
    expect(driftedSearch.deps.releaseLease).toHaveBeenCalledOnce()

    const driftedRanking = fixture()
    driftedRanking.searchWithDiagnostics.mockResolvedValueOnce({
      ...searchResult(),
      diagnostics: {
        ...searchResult().diagnostics,
        rankingImplementation: "title-and-brand-v1",
      },
    })
    await expect(
      new TypesenseWatchSearchCandidateEvaluationService(
        driftedRanking.deps,
      ).search({ query: "Jesus" }),
    ).rejects.toMatchObject({ code: "identity_mismatch" })
  })

  it("changes the revision when any bound Candidate identity component changes", () => {
    const baseline = candidateSearchEvaluationRevision({
      profile: candidateProfile,
      currentProfile,
    })
    const revisions = [
      candidateSearchEvaluationRevision({
        profile: { ...candidateProfile, generationId: "generation-2" },
        currentProfile,
      }),
      candidateSearchEvaluationRevision({
        profile: {
          ...candidateProfile,
          applicationRevision: "watch-search-candidate/v3",
        },
        currentProfile,
      }),
      candidateSearchEvaluationRevision({
        profile: {
          ...candidateProfile,
          rankingRevision: "title-and-brand-v1",
        },
        currentProfile,
      }),
      candidateSearchEvaluationRevision({
        profile: { ...candidateProfile, transcriptProjectionRevision: 8n },
        currentProfile,
      }),
      candidateSearchEvaluationRevision({
        profile: { ...candidateProfile, qrelsRevision: "qrels-reviewed-2" },
        currentProfile,
      }),
      candidateSearchEvaluationRevision({
        profile: {
          ...candidateProfile,
          binding: {
            ...candidateProfile.binding,
            lexical: "watch_search_candidate_generation-1_lexical-v2",
          },
        },
        currentProfile,
      }),
    ]

    expect(new Set([baseline, ...revisions]).size).toBe(revisions.length + 1)
  })

  it("changes the revision when a frozen Current binding changes", () => {
    const baseline = candidateSearchEvaluationRevision({
      profile: candidateProfile,
      currentProfile,
    })
    const movedCurrent = candidateSearchEvaluationRevision({
      profile: candidateProfile,
      currentProfile: {
        ...currentProfile,
        binding: {
          ...currentProfile.binding,
          lexical: "watch_search_lexical_physical-v2",
        },
      },
    })

    expect(movedCurrent).not.toBe(baseline)
  })

  it("uses a typed fail-closed error for non-Candidate profiles", () => {
    expect(() =>
      candidateSearchEvaluationRevision({
        profile: currentProfile,
        currentProfile,
      }),
    ).toThrow(CandidateSearchEvaluationError)
  })

  it("resolves only the Serving pointer and requires exact accepted identity", async () => {
    const generations = {
      getPointer: vi.fn(async (kind: "EVALUATION" | "SERVING") => ({
        generationId:
          kind === "SERVING" ? "generation-serving" : "generation-evaluation",
      })),
      resolveGeneration: vi.fn(async (input) => ({
        generationId: input.generationId,
        applicationRevision: input.applicationRevision,
        transcriptProjectionRevision: input.transcriptProjectionRevision,
        collections: {
          catalog: `watch_search_candidate_${input.generationId}_catalog`,
          availability: `watch_search_candidate_${input.generationId}_availability`,
          lexical: `watch_search_candidate_${input.generationId}_lexical`,
          transcript: input.transcriptCollection,
        },
        fieldManifests: candidateProfile.fieldManifests!,
      })),
    }

    const profile = await resolveServingCandidateWatchSearchProfile({
      generations,
      currentProfile,
      applicationRevision: "watch-search-candidate/v2",
      rankingRevision: "title-and-brand-v1",
      transcriptProjectionRevision: 7n,
      qrelsRevision: "qrels-reviewed-1",
    })

    expect(profile.generationId).toBe("generation-serving")
    expect(profile.qrelsRevision).toBe("qrels-reviewed-1")
    expect(profile.rankingRevision).toBe("title-and-brand-v1")
    expect(generations.getPointer).toHaveBeenCalledOnce()
    expect(generations.getPointer).toHaveBeenCalledWith("SERVING")
    expect(generations.resolveGeneration).toHaveBeenCalledWith({
      generationId: "generation-serving",
      applicationRevision: "watch-search-candidate/v2",
      transcriptCollection: currentProfile.binding.transcript,
      transcriptProjectionRevision: 7n,
      requireQualified: true,
      currentBindings: Object.values(currentProfile.binding),
      qrelsRevision: "qrels-reviewed-1",
      rankingRevision: "title-and-brand-v1",
    })
  })

  it.each([
    ["missing Serving pointer", { generationId: null }, null],
    [
      "missing accepted qualification",
      { generationId: "generation-serving" },
      new Error("no exact passing qualification"),
    ],
    [
      "runtime identity drift",
      { generationId: "generation-serving" },
      new Error("candidate generation identity is stale"),
    ],
  ])(
    "fails closed for Serving profile: %s",
    async (_name, pointer, failure) => {
      const generations = {
        getPointer: vi.fn(async () => pointer),
        resolveGeneration: vi.fn(async () => {
          throw failure
        }),
      }

      await expect(
        resolveServingCandidateWatchSearchProfile({
          generations,
          currentProfile,
          applicationRevision: "watch-search-candidate/v2",
          rankingRevision: "title-and-brand-v1",
          transcriptProjectionRevision: 7n,
          qrelsRevision: "qrels-reviewed-1",
        }),
      ).rejects.toBeInstanceOf(CandidateSearchEvaluationError)
    },
  )
})
