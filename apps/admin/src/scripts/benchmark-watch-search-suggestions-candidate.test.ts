import { describe, expect, it, vi } from "vitest"

import {
  bindCandidateWatchSearchSuggestionsService,
  evaluateSuggestionCandidateQualification,
  suggestionPercentiles,
  type SuggestionBenchmarkSample,
  type SuggestionCapacityEvidence,
  type SuggestionRequestEnvelope,
} from "./benchmark-watch-search-suggestions-candidate"

const request: SuggestionRequestEnvelope = {
  retrievalHttpRequests: 1,
  retrievalSubsearches: 2,
  baselineQueryFields: 4,
  expansionQueryFields: 5,
  validationHttpRequests: 1,
  validationSubsearches: 4,
  hydrationQueries: 1,
  queryByBytes: 512,
  retrievalRequestBytes: 2_048,
  maxCandidateGroupsPerLane: 25,
  querySuggestions: 6,
  directMatches: 6,
  retries: 0,
}

function samples(
  v2Durations: Partial<SuggestionBenchmarkSample["durationMs"]> = {},
): SuggestionBenchmarkSample[] {
  return (["cold", "warm"] as const).flatMap((cacheState) =>
    (["v1-first", "v2-first"] as const).flatMap((order) =>
      (["v1", "v2"] as const).map((version) => ({
        version,
        cacheState,
        order,
        durationMs: {
          retrieval: version === "v1" ? 20 : (v2Durations.retrieval ?? 19),
          validation: version === "v1" ? 10 : (v2Durations.validation ?? 9),
          hydration: version === "v1" ? 15 : (v2Durations.hydration ?? 14),
          total: version === "v1" ? 50 : (v2Durations.total ?? 48),
        },
        request,
      })),
    ),
  )
}

const capacity: SuggestionCapacityEvidence = {
  currentPhysicalCollection: "watch_search_lexical_20260812",
  candidatePhysicalCollection: "watch_search_candidate_generation_01_lexical",
  currentSearchableBytesByFamily: {
    baselineTitleMetadata: 1_000,
    stemTitleMetadata: 0,
    exactTaxonomy: 0,
    stemTaxonomy: 0,
  },
  candidateSearchableBytesByFamily: {
    baselineTitleMetadata: 1_000,
    stemTitleMetadata: 300,
    exactTaxonomy: 100,
    stemTaxonomy: 100,
  },
  predictedCandidateSearchableBytes: 1_500,
  importedCandidateSearchableBytes: 1_575,
  serviceLimitBytes: 16_000,
  v1V2PeakRssBytes: 9_600,
  settledRssBytes: 8_000,
  publicationLockDurationMs: 12_000,
}

describe("suggestion candidate qualification", () => {
  it("computes stable p50/p95/p99 percentiles", () => {
    expect(suggestionPercentiles([9, 1, 5, 3, 7])).toEqual({
      p50: 5,
      p95: 9,
      p99: 9,
    })
  })

  it("admits complete alternating cold/warm evidence within latency, request, and capacity gates", () => {
    const report = evaluateSuggestionCandidateQualification({
      samples: samples(),
      capacity,
    })

    expect(report).toMatchObject({
      schemaVersion: "watch-search-suggestions-candidate-local/v1",
      status: "QUALIFIED",
      reasons: [],
      productionCandidateBenchmark: "NOT_RUN",
      aliasSmoke: "NOT_RUN",
      capacity: {
        predictedImportedDeltaRatio: 0.05,
        peakFreeRatio: 0.4,
        settledFreeRatio: 0.5,
        publicationLockDurationMs: 12_000,
      },
    })
    expect(report.latency.v2.cold.total).toEqual({
      p50: 48,
      p95: 48,
      p99: 48,
    })
  })

  it("fails closed for missing alternation, any percentile regression, or total p99 at the Web timeout", () => {
    const missing = evaluateSuggestionCandidateQualification({
      samples: samples().filter((sample) => sample.order === "v1-first"),
      capacity,
    })
    expect(missing.status).toBe("REJECTED")
    expect(missing.reasons).toContain(
      "missing v2/cold/v2-first benchmark sample",
    )

    const regression = evaluateSuggestionCandidateQualification({
      samples: samples({ validation: 11 }),
      capacity,
    })
    expect(regression.status).toBe("REJECTED")
    expect(regression.reasons).toContain(
      "v2 cold validation p50 regressed from 10ms to 11ms",
    )

    const timeout = evaluateSuggestionCandidateQualification({
      samples: samples({ total: 3_500 }),
      capacity,
    })
    expect(timeout.status).toBe("REJECTED")
    expect(timeout.reasons).toContain(
      "v2 cold total p99 3500ms reaches the 3500ms Web timeout",
    )
  })

  it("fails closed when request caps or capacity headroom drift", () => {
    const overRequest = samples()
    overRequest[0] = {
      ...overRequest[0]!,
      request: { ...request, expansionQueryFields: 6, retries: 1 },
    }
    const requestReport = evaluateSuggestionCandidateQualification({
      samples: overRequest,
      capacity,
    })
    expect(requestReport.reasons).toEqual(
      expect.arrayContaining([
        "v1/cold/v1-first expansion query fields 6 exceed 5",
        "v1/cold/v1-first retries 1 exceed 0",
      ]),
    )

    const capacityReport = evaluateSuggestionCandidateQualification({
      samples: samples(),
      capacity: {
        ...capacity,
        importedCandidateSearchableBytes: 1_700,
        v1V2PeakRssBytes: 9_601,
        settledRssBytes: 8_001,
      },
    })
    expect(capacityReport.reasons).toEqual(
      expect.arrayContaining([
        "predicted/imported searchable bytes differ by more than 10%",
        "v1+v2 peak RSS leaves less than 40% service memory free",
        "settled RSS leaves less than 50% service memory free",
      ]),
    )
  })

  it("binds the internal service to a physical candidate collection and rejects the serving alias", async () => {
    const multiSearchSettled = vi.fn(
      async (_searches: Array<{ collection: string }>) => [
        {
          status: "fulfilled" as const,
          value: {
            found: 0,
            out_of: 0,
            page: 1,
            search_time_ms: 1,
            grouped_hits: [],
          },
        },
        {
          status: "fulfilled" as const,
          value: {
            found: 0,
            out_of: 0,
            page: 1,
            search_time_ms: 1,
            grouped_hits: [],
          },
        },
      ],
    )
    const service = bindCandidateWatchSearchSuggestionsService({
      prisma: {
        language: {
          findFirst: vi.fn(async () => ({ bcp47: "en" })),
        },
        video: { findMany: vi.fn(async () => []) },
      } as never,
      typesense: {
        multiSearch: vi.fn(async () => []),
        multiSearchSettled,
      } as never,
      candidateLexicalCollection:
        "watch_search_candidate_generation_01_lexical",
      logger: { warn: vi.fn() },
    })

    await service.suggest({ query: "shorts", languageSlug: "english" })
    const retrievalSearches = multiSearchSettled.mock.calls[0]?.[0] ?? []
    expect(
      retrievalSearches.every(
        (search: { collection: string }) =>
          search.collection === "watch_search_candidate_generation_01_lexical",
      ),
    ).toBe(true)
    expect(() =>
      bindCandidateWatchSearchSuggestionsService({
        prisma: {} as never,
        typesense: {} as never,
        candidateLexicalCollection: "watch_search_lexical",
      }),
    ).toThrow(/physical candidate lexical collection/i)
  })
})
