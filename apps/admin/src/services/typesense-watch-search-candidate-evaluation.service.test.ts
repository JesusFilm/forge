import { describe, expect, it, vi } from "vitest"

import type { TypesenseWatchSearchProfile } from "./typesense-watch-search-profile"
import {
  type CandidateSearchEvaluationDeps,
  CandidateSearchEvaluationError,
  candidateSearchEvaluationRevision,
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
  transcriptProjectionRevision: 7n,
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
      rankingImplementation: "title-and-brand-v1" as const,
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
    async ({ evaluationId }) => ({
      resourceKey: `watch-search-candidate-eval:${evaluationId}`,
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
    resolveCurrentProfile: vi.fn(async () => currentProfile),
    resolveCandidateProfile: vi.fn(async () => candidateProfile),
    createSearch: vi.fn(() => ({ searchWithDiagnostics })),
    acquireLease,
    renewLease: vi.fn(async () => true),
    releaseLease: vi.fn(async () => true),
    rankingRevision: vi.fn(() => "title-and-brand-v1"),
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
  })

  it("changes the revision when any bound Candidate identity component changes", () => {
    const baseline = candidateSearchEvaluationRevision({
      profile: candidateProfile,
      currentProfile,
      rankingRevision: "title-and-brand-v1",
    })
    const revisions = [
      candidateSearchEvaluationRevision({
        profile: { ...candidateProfile, generationId: "generation-2" },
        currentProfile,
        rankingRevision: "title-and-brand-v1",
      }),
      candidateSearchEvaluationRevision({
        profile: {
          ...candidateProfile,
          applicationRevision: "watch-search-candidate/v3",
        },
        currentProfile,
        rankingRevision: "title-and-brand-v1",
      }),
      candidateSearchEvaluationRevision({
        profile: candidateProfile,
        currentProfile,
        rankingRevision: "title-and-brand-v2",
      }),
      candidateSearchEvaluationRevision({
        profile: { ...candidateProfile, transcriptProjectionRevision: 8n },
        currentProfile,
        rankingRevision: "title-and-brand-v1",
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
        rankingRevision: "title-and-brand-v1",
      }),
    ]

    expect(new Set([baseline, ...revisions]).size).toBe(revisions.length + 1)
  })

  it("changes the revision when a frozen Current binding changes", () => {
    const baseline = candidateSearchEvaluationRevision({
      profile: candidateProfile,
      currentProfile,
      rankingRevision: "title-and-brand-v1",
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
      rankingRevision: "title-and-brand-v1",
    })

    expect(movedCurrent).not.toBe(baseline)
  })

  it("uses a typed fail-closed error for non-Candidate profiles", () => {
    expect(() =>
      candidateSearchEvaluationRevision({
        profile: currentProfile,
        currentProfile,
        rankingRevision: "title-and-brand-v1",
      }),
    ).toThrow(CandidateSearchEvaluationError)
  })
})
