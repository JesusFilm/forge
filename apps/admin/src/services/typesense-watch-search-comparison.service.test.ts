import { describe, expect, it, vi } from "vitest"

import type { TypesenseWatchSearchProfile } from "./typesense-watch-search-profile"
import { TypesenseWatchSearchComparisonService } from "./typesense-watch-search-comparison.service"
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
  ...currentProfile,
  kind: "CANDIDATE",
  binding: {
    catalog: "watch_search_candidate_generation-1_catalog",
    availability: "watch_search_candidate_generation-1_availability",
    lexical: "watch_search_candidate_generation-1_lexical",
    transcript: "watch_search_transcripts_physical",
  },
  generationId: "generation-1",
  applicationRevision: "revision-1",
  transcriptProjectionRevision: 7n,
  fieldManifests: {
    catalog: [{ name: "slug", type: "string" }],
    availability: [{ name: "videoId", type: "string" }],
    lexical: [{ name: "title_en", type: "string[]" }],
    transcript: [{ name: "embedding", type: "float[]" }],
  },
} as const satisfies TypesenseWatchSearchProfile

function searchResult(profile: "CURRENT" | "CANDIDATE") {
  return {
    response: {
      query: "Jesus",
      results: [],
      hasMore: false,
      nextOffset: 10,
      searchMode: "watch-search-typesense",
      requestId: "comparison-request-1",
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
      profile,
      generationId: profile === "CANDIDATE" ? "generation-1" : null,
      applicationRevision: profile === "CANDIDATE" ? "revision-1" : null,
      transcriptProjectionRevision: profile === "CANDIDATE" ? 7n : null,
      binding:
        profile === "CANDIDATE"
          ? candidateProfile.binding
          : currentProfile.binding,
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
    },
  }
}

function fixture() {
  const calls: string[] = []
  const currentSearch = vi.fn(async (_input: WatchSearchInput) => {
    calls.push("current")
    return searchResult("CURRENT")
  })
  const candidateSearch = vi.fn(async (_input: WatchSearchInput) => {
    calls.push("candidate")
    return searchResult("CANDIDATE")
  })
  const enabled = vi.fn(() => true)
  const lease = {
    holderToken: "holder-1",
    generationId: "generation-1",
    applicationRevision: "revision-1",
    transcriptCollection: "watch_search_transcripts_physical",
    transcriptProjectionRevision: 7n,
    currentBindings: Object.values(currentProfile.binding),
    expiresAt: new Date(Date.now() + 60_000),
  }
  const deps = {
    resolveCurrentProfile: vi.fn(async () => currentProfile),
    resolveCandidateProfile: vi.fn(async () => candidateProfile),
    createSearch: vi.fn((profile: TypesenseWatchSearchProfile) => ({
      searchWithDiagnostics:
        profile.kind === "CURRENT" ? currentSearch : candidateSearch,
    })),
    acquireLease: vi.fn(async (): Promise<typeof lease | null> => lease),
    renewLease: vi.fn(async () => true),
    releaseLease: vi.fn(async () => true),
    candidateEnabled: enabled,
    admitActor: vi.fn(async () => true),
    recordTrace: vi.fn(async () => undefined),
  }
  return { calls, currentSearch, candidateSearch, enabled, lease, deps }
}

describe("TypesenseWatchSearchComparisonService", () => {
  it("rejects blank input with the typed comparison error", async () => {
    const { deps } = fixture()
    await expect(
      new TypesenseWatchSearchComparisonService(deps).compare({
        actorKey: "evaluator-1",
        input: { query: "   " },
      }),
    ).rejects.toMatchObject({
      name: "ComparisonError",
      code: "invalid_input",
    })
  })

  it("runs one normalized input through current then candidate under one lease", async () => {
    const { calls, currentSearch, candidateSearch, deps } = fixture()
    const service = new TypesenseWatchSearchComparisonService(deps)

    const result = await service.compare({
      actorKey: "evaluator-1",
      input: { query: "  Jesus  ", limit: 10, offset: 0 },
    })

    expect(calls).toEqual(["current", "candidate"])
    expect(currentSearch.mock.calls[0]?.[0]).toEqual(
      candidateSearch.mock.calls[0]?.[0],
    )
    expect(currentSearch.mock.calls[0]?.[0]).toMatchObject({
      query: "Jesus",
      limit: 10,
      offset: 0,
      clientRequestId: result.comparisonId,
    })
    expect(result.current.status).toBe("success")
    expect(result.candidate.status).toBe("success")
    expect(deps.renewLease).toHaveBeenCalledOnce()
    expect(deps.releaseLease).toHaveBeenCalledOnce()
  })

  it("preserves current results when candidate execution fails", async () => {
    const { deps, candidateSearch } = fixture()
    candidateSearch.mockRejectedValueOnce(new Error("candidate unavailable"))
    const service = new TypesenseWatchSearchComparisonService(deps)

    const result = await service.compare({
      actorKey: "evaluator-1",
      input: { query: "Jesus" },
    })

    expect(result.current.status).toBe("success")
    expect(result.candidate).toEqual({
      status: "error",
      error: { code: "search_failed", errorClass: "Error" },
    })
  })

  it("fails candidate closed when admission or the mid-action kill switch fails", async () => {
    const first = fixture()
    first.deps.admitActor.mockResolvedValueOnce(false)
    const denied = await new TypesenseWatchSearchComparisonService(
      first.deps,
    ).compare({ actorKey: "evaluator-1", input: { query: "Jesus" } })
    expect(denied.current.status).toBe("success")
    expect(denied.candidate).toMatchObject({
      status: "error",
      error: { code: "admission_denied" },
    })
    expect(first.candidateSearch).not.toHaveBeenCalled()

    const second = fixture()
    second.enabled.mockReturnValueOnce(true).mockReturnValueOnce(false)
    const disabled = await new TypesenseWatchSearchComparisonService(
      second.deps,
    ).compare({ actorKey: "evaluator-1", input: { query: "Jesus" } })
    expect(disabled.current.status).toBe("success")
    expect(disabled.candidate).toMatchObject({
      status: "error",
      error: { code: "candidate_disabled" },
    })
    expect(second.candidateSearch).not.toHaveBeenCalled()
  })

  it("fails candidate closed on lease contention while still running current", async () => {
    const { deps, candidateSearch } = fixture()
    deps.acquireLease.mockResolvedValueOnce(null)
    const result = await new TypesenseWatchSearchComparisonService(
      deps,
    ).compare({ actorKey: "evaluator-1", input: { query: "Jesus" } })

    expect(result.current.status).toBe("success")
    expect(result.candidate).toMatchObject({
      status: "error",
      error: { code: "lease_unavailable" },
    })
    expect(candidateSearch).not.toHaveBeenCalled()
  })

  it("fails candidate closed when lease renewal is lost", async () => {
    const { deps, candidateSearch } = fixture()
    deps.renewLease.mockResolvedValueOnce(false)
    const result = await new TypesenseWatchSearchComparisonService(
      deps,
    ).compare({ actorKey: "evaluator-1", input: { query: "Jesus" } })

    expect(result.current.status).toBe("success")
    expect(result.candidate).toMatchObject({
      status: "error",
      error: { code: "lease_lost" },
    })
    expect(candidateSearch).not.toHaveBeenCalled()
    expect(deps.releaseLease).toHaveBeenCalledOnce()
  })
})
