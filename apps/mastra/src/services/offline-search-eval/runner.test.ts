import { describe, expect, it, vi } from "vitest"

import { runOfflineSearchEval } from "./runner"
import {
  SearchEvalArtifactError,
  type SearchEvalArtifactStore,
} from "./artifacts"
import type {
  BaselineArtifact,
  SearchEvalReport,
  SearchEvalResult,
} from "./types"

const resultA: SearchEvalResult = {
  type: "video",
  id: "video-a",
  slug: "jesus-a",
  title: "JESUS A",
  imageUrl: null,
  snippet: "baseline",
  startSeconds: null,
  playbackId: null,
  score: 1,
  label: "FEATURE_FILM",
  durationSeconds: 120,
  childCount: null,
}

const resultB: SearchEvalResult = {
  ...resultA,
  id: "video-b",
  title: "JESUS B",
  snippet: "current",
}

function baselineArtifact(): BaselineArtifact {
  return {
    schemaVersion: "1",
    kind: "baseline",
    name: "default",
    capturedAt: "2026-05-27T00:00:00.000Z",
    metadata: {
      mastraRunId: "baseline-run",
      startedAt: "2026-05-27T00:00:00.000Z",
      finishedAt: "2026-05-27T00:00:00.000Z",
      baselineName: "default",
      callerTrack: "public-watch",
      promptSetVersion: "seed/v1",
      adminSearchUrl: "https://admin.internal/api/internal/search-eval/search",
      servingRevision: null,
      judgeModel: null,
      search: { limit: 20, mode: null, contentType: null },
    },
    cases: [
      {
        caseId: "seed-jesus",
        locale: "en",
        queryText: "Jesus",
        source: "seed",
        callerTrack: "public-watch",
        tags: ["core"],
        results: [resultA],
      },
    ],
  }
}

function memoryStore(baseline?: BaselineArtifact): SearchEvalArtifactStore & {
  baselines: BaselineArtifact[]
  reports: unknown[]
} {
  const baselines: BaselineArtifact[] = baseline ? [baseline] : []
  const reports: unknown[] = []
  return {
    rootDir: "/tmp/search-eval",
    baselines,
    reports,
    async writeBaselineCapture(next, report) {
      baselines.push(next)
      reports.push(report)
      return {
        baselinePath: `/tmp/search-eval/baselines/${next.name}.json`,
        reportPath: `/tmp/search-eval/reports/${report.reportId}.json`,
      }
    },
    async writeBaseline(next) {
      baselines.push(next)
      return { path: `/tmp/search-eval/baselines/${next.name}.json` }
    },
    async readBaseline(name) {
      const found = baselines.find((entry) => entry.name === name)
      if (!found) {
        throw new SearchEvalArtifactError(
          "not_found",
          `baseline '${name}' was not found`,
        )
      }
      return found
    },
    async writeReport(report) {
      reports.push(report)
      return { path: `/tmp/search-eval/reports/${report.reportId}.json` }
    },
    async readReport(reportId) {
      const found = reports.find(
        (entry): entry is SearchEvalReport =>
          typeof entry === "object" &&
          entry !== null &&
          "reportId" in entry &&
          (entry as { reportId?: unknown }).reportId === reportId,
      )
      if (!found) {
        throw new SearchEvalArtifactError(
          "not_found",
          `report '${reportId}' was not found`,
        )
      }
      return found
    },
  }
}

describe("runOfflineSearchEval", () => {
  it("captures seed-only baselines while keeping generated candidates exploratory", async () => {
    const store = memoryStore()
    const searchClient = vi.fn(
      async (_input: { payload: Record<string, unknown> }) => ({
        ok: true as const,
        result: {
          results: [resultA],
          hasMore: false,
          query: "Jesus",
          searchMode: "hybrid" as const,
          revision: "serving-revision-1",
        },
      }),
    )
    const candidateListClient = vi.fn(async () => ({
      ok: true as const,
      result: {
        candidates: [
          {
            id: "candidate-catalog",
            source: "catalog" as const,
            locale: "en",
            queryText: "catalog generated",
            expectedResultHints: [],
            sourceAnchors: [],
            labelProvenance: {},
            generationModel: "model",
            generationProvider: "mastra",
            judgeSummary: null,
            mastraRunId: "gen-run",
            retentionExpiresAt: null,
            generatedAt: "2026-05-27T00:00:00.000Z",
            createdAt: "2026-05-27T00:00:00.000Z",
          },
        ],
        generatedAt: "2026-05-27T00:00:00.000Z",
      },
    }))

    const result = await runOfflineSearchEval(
      {
        mode: "capture-baseline",
        baselineName: "default",
        locales: ["en"],
        searchMode: "keyword-first",
        includeGeneratedCandidates: true,
      },
      {
        runId: "run-1",
        artifactStore: store,
        servingBearer: "serving-eval-key",
        servingUrl:
          "https://admin.internal/api/internal/search-eval/serving-search",
        adminBearer: "shared-eval-key",
        candidateListUrl:
          "https://admin.internal/api/internal/search-eval/candidates",
        searchClient,
        candidateListClient,
        now: () => new Date("2026-05-27T00:00:00.000Z"),
      },
    )

    expect(result).toMatchObject({ ok: true, baselinePath: expect.any(String) })
    expect(
      store.baselines[0]?.cases.every((entry) => entry.source === "seed"),
    ).toBe(true)
    expect(
      store.baselines[0]?.cases.some((entry) =>
        entry.queryText.includes("generated"),
      ),
    ).toBe(false)
    expect(store.baselines[0]?.metadata.servingRevision).toBe(
      "serving-revision-1",
    )
    expect(
      store.baselines[0]?.cases.every(
        (entry) => entry.serverRevision === "serving-revision-1",
      ),
    ).toBe(true)
    expect(store.baselines[0]?.cases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          caseId: "seed-french-route-english-who-is-jesus",
          locale: "en",
          languageSlug: "english",
          websiteLocale: "fr",
        }),
      ]),
    )
    expect(searchClient).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://admin.internal/api/internal/search-eval/serving-search",
        bearer: "serving-eval-key",
        payload: expect.objectContaining({
          query: "bible project",
          locale: "en",
          languageSlug: "english",
          mode: "modern",
        }),
      }),
    )
    expect(candidateListClient).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://admin.internal/api/internal/search-eval/candidates",
        bearer: "shared-eval-key",
      }),
    )
    expect(
      searchClient.mock.calls.every(
        (call) => call[0]?.payload.mode === "modern",
      ),
    ).toBe(true)
    expect(result.ok && result.report.metadata.search.mode).toBe(
      "keyword-first",
    )
    for (const call of searchClient.mock.calls) {
      expect(call[0]?.payload).not.toHaveProperty("websiteLocale")
    }
    expect(result.ok && result.report.generatedCandidateBehavior).toMatchObject(
      {
        included: 1,
        searched: 1,
      },
    )
  })

  it("uses caller-track defaults for AI experience-generation captures", async () => {
    const store = memoryStore()
    const searchClient = vi.fn(
      async (_input: { payload: Record<string, unknown> }) => ({
        ok: true as const,
        result: {
          results: [resultA],
          hasMore: false,
          query: "agent query",
          searchMode: "hybrid" as const,
          revision: "serving-revision-ai",
        },
      }),
    )

    const result = await runOfflineSearchEval(
      {
        mode: "capture-baseline",
        callerTrack: "ai-experience-generation",
        locales: ["en"],
      },
      {
        runId: "run-ai-track",
        artifactStore: store,
        servingBearer: "eval-key",
        servingUrl: "https://admin.internal/api/internal/search-eval/search",
        searchClient,
        now: () => new Date("2026-05-27T00:00:00.000Z"),
      },
    )

    expect(result).toMatchObject({
      ok: true,
      baselineName: "seed-baseline-ai-experience-generation",
      report: {
        metadata: {
          callerTrack: "ai-experience-generation",
          search: { mode: "hybrid" },
        },
        callerTrackMix: { "ai-experience-generation": expect.any(Number) },
      },
    })
    expect(store.baselines[0]).toMatchObject({
      name: "seed-baseline-ai-experience-generation",
      metadata: { callerTrack: "ai-experience-generation" },
    })
    expect(
      store.baselines[0]?.cases.every(
        (entry) => entry.callerTrack === "ai-experience-generation",
      ),
    ).toBe(true)
    expect(
      searchClient.mock.calls.every(
        (call) => call[0]?.payload.mode === "modern",
      ),
    ).toBe(true)
    expect(result.ok && result.report.metadata.search.mode).toBe("hybrid")
  })

  it("rejects caller-track and search-mode combinations before Admin search", async () => {
    const searchClient = vi.fn()
    const result = await runOfflineSearchEval(
      {
        mode: "capture-baseline",
        callerTrack: "ai-experience-generation",
        searchMode: "keyword-first",
        locales: ["en"],
      },
      {
        runId: "run-invalid-track-mode",
        artifactStore: memoryStore(),
        servingBearer: "eval-key",
        servingUrl: "https://admin.internal/api/internal/search-eval/search",
        searchClient,
      },
    )

    expect(result).toEqual({
      ok: false,
      reason: "invalid_input",
      retryable: false,
      adminReason:
        "searchMode 'keyword-first' is not suitable for callerTrack 'ai-experience-generation'",
    })
    expect(searchClient).not.toHaveBeenCalled()
  })

  it("rejects comparing a baseline under a different caller track", async () => {
    const searchClient = vi.fn()
    const judgePair = vi.fn()
    const result = await runOfflineSearchEval(
      {
        mode: "compare",
        baselineName: "default",
        callerTrack: "semantic-diagnostic",
      },
      {
        runId: "run-wrong-track",
        artifactStore: memoryStore(baselineArtifact()),
        servingBearer: "eval-key",
        servingUrl: "https://admin.internal/api/internal/search-eval/search",
        searchClient,
        judge: { model: "judge", judgePair },
      },
    )

    expect(result).toMatchObject({
      ok: false,
      reason: "invalid_input",
      retryable: false,
      adminReason:
        "baseline 'default' belongs to callerTrack 'public-watch', not 'semantic-diagnostic'",
    })
    expect(searchClient).not.toHaveBeenCalled()
    expect(judgePair).not.toHaveBeenCalled()
  })

  it("compares seed baselines and keeps trace-derived candidates away from search and judge", async () => {
    const store = memoryStore(baselineArtifact())
    const searchClient = vi.fn(async (input) => ({
      ok: true as const,
      result: {
        results:
          input.payload.query === "catalog generated" ? [resultA] : [resultB],
        hasMore: false,
        query: input.payload.query,
        searchMode: "hybrid" as const,
      },
    }))
    const candidateListClient = vi.fn(async () => ({
      ok: true as const,
      result: {
        candidates: [
          {
            id: "candidate-trace",
            source: "trace" as const,
            locale: "en",
            queryText: null,
            expectedResultHints: [],
            sourceAnchors: [],
            labelProvenance: {},
            generationModel: "trace:v1",
            generationProvider: "admin",
            judgeSummary: null,
            mastraRunId: "gen-run",
            retentionExpiresAt: "2026-06-01T00:00:00.000Z",
            generatedAt: "2026-05-27T00:00:00.000Z",
            createdAt: "2026-05-27T00:00:00.000Z",
          },
          {
            id: "candidate-catalog",
            source: "catalog" as const,
            locale: "en",
            queryText: "catalog generated",
            expectedResultHints: [],
            sourceAnchors: [],
            labelProvenance: {},
            generationModel: "catalog:v1",
            generationProvider: "mastra",
            judgeSummary: null,
            mastraRunId: "gen-run",
            retentionExpiresAt: null,
            generatedAt: "2026-05-27T00:00:00.000Z",
            createdAt: "2026-05-27T00:00:00.000Z",
          },
        ],
        generatedAt: "2026-05-27T00:00:00.000Z",
      },
    }))
    const judgePair = vi
      .fn()
      .mockResolvedValueOnce({
        verdict: "tie",
        rationale: "calibration",
        tokens: { input: 1, output: 1 },
        model: "judge",
      })
      .mockResolvedValueOnce({
        verdict: "clearly-B-better",
        rationale: "current better",
        tokens: { input: 2, output: 1 },
        model: "judge",
      })
      .mockResolvedValueOnce({
        verdict: "clearly-A-better",
        rationale: "current better",
        tokens: { input: 2, output: 1 },
        model: "judge",
      })

    const result = await runOfflineSearchEval(
      {
        mode: "compare",
        baselineName: "default",
        includeGeneratedCandidates: true,
      },
      {
        runId: "run-compare",
        artifactStore: store,
        servingBearer: "eval-key",
        servingUrl: "https://admin.internal/api/internal/search-eval/search",
        candidateListUrl:
          "https://admin.internal/api/internal/search-eval/candidates",
        searchClient,
        candidateListClient,
        judge: { model: "judge", judgePair },
        now: () => new Date("2026-05-27T00:00:00.000Z"),
      },
    )

    expect(result).toMatchObject({
      ok: true,
      report: {
        totals: { queries: 1, wins: 1 },
        generatedCandidateBehavior: {
          included: 2,
          searched: 1,
          traceDerived: 1,
          skippedTraceDerived: 1,
        },
      },
    })
    if (!result.ok) throw new Error("expected compare to succeed")
    expect(result.report.outcomes).toHaveLength(1)
    expect(
      result.report.outcomes.every((entry) => entry.source === "seed"),
    ).toBe(true)
    expect(JSON.stringify(result.report.outcomes)).not.toContain(
      "catalog generated",
    )
    expect(searchClient).not.toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ query: "raw trace query" }),
      }),
    )
    expect(JSON.stringify(result)).not.toContain("raw trace query")
    expect(judgePair).not.toHaveBeenCalledWith(
      expect.objectContaining({ query: "raw trace query" }),
    )
  })

  it("keeps seed baseline capture running when exploratory candidate reads fail", async () => {
    const store = memoryStore()
    const searchClient = vi.fn(async () => ({
      ok: true as const,
      result: {
        results: [resultA],
        hasMore: false,
        query: "Jesus",
        searchMode: "hybrid" as const,
        revision: "serving-revision-read-fail",
      },
    }))
    const candidateListClient = vi.fn(async () => ({
      ok: false as const,
      reason: "network_error" as const,
      retryable: true,
      status: 503,
      adminReason: "unavailable",
    }))

    const result = await runOfflineSearchEval(
      {
        mode: "capture-baseline",
        baselineName: "default",
        locales: ["en"],
        includeGeneratedCandidates: true,
      },
      {
        runId: "run-read-fail",
        artifactStore: store,
        servingBearer: "eval-key",
        servingUrl: "https://admin.internal/api/internal/search-eval/search",
        searchClient,
        candidateListClient,
        now: () => new Date("2026-05-27T00:00:00.000Z"),
      },
    )

    expect(result).toMatchObject({
      ok: true,
      report: {
        generatedCandidateBehavior: {
          included: 0,
          readFailure: { code: "network_error", status: 503 },
        },
      },
    })
    if (!result.ok) throw new Error("expected capture to succeed")
    expect("generatedCandidateReadFailure" in result.report).toBe(false)
    expect(store.baselines[0]?.cases.length).toBeGreaterThan(0)
  })

  it("rejects unsupported locale filters instead of writing an empty baseline", async () => {
    const store = memoryStore()

    const result = await runOfflineSearchEval(
      { mode: "capture-baseline", baselineName: "default", locales: ["zz"] },
      {
        runId: "run-empty",
        artifactStore: store,
        servingBearer: "eval-key",
        servingUrl: "https://admin.internal/api/internal/search-eval/search",
        searchClient: vi.fn(),
      },
    )

    expect(result).toEqual({
      ok: false,
      reason: "invalid_input",
      retryable: false,
    })
    expect(store.baselines).toEqual([])
  })

  it("rejects mixed unsupported locale filters instead of writing a partial baseline", async () => {
    const store = memoryStore()
    const searchClient = vi.fn()

    const result = await runOfflineSearchEval(
      {
        mode: "capture-baseline",
        baselineName: "default",
        locales: ["en", "zz"],
        includeGeneratedCandidates: true,
      },
      {
        runId: "run-partial-locale",
        artifactStore: store,
        servingBearer: "eval-key",
        servingUrl: "https://admin.internal/api/internal/search-eval/search",
        searchClient,
        candidateListClient: vi.fn(),
      },
    )

    expect(result).toEqual({
      ok: false,
      reason: "invalid_input",
      retryable: false,
    })
    expect(searchClient).not.toHaveBeenCalled()
    expect(store.baselines).toEqual([])
  })

  it("reports missing baselines with a typed artifact failure", async () => {
    const candidateListClient = vi.fn()
    const result = await runOfflineSearchEval(
      {
        mode: "compare",
        baselineName: "missing",
        includeGeneratedCandidates: true,
      },
      {
        runId: "run-missing",
        artifactStore: memoryStore(),
        servingBearer: "eval-key",
        servingUrl: "https://admin.internal/api/internal/search-eval/search",
        judge: { model: "judge", judgePair: vi.fn() },
        candidateListClient,
      },
    )

    expect(result).toEqual({
      ok: false,
      reason: "artifact_not_found",
      retryable: false,
    })
    expect(candidateListClient).not.toHaveBeenCalled()
  })

  it("records current search failures as search-failure outcomes without judging", async () => {
    const store = memoryStore(baselineArtifact())
    const judgePair = vi.fn(async () => ({
      verdict: "tie" as const,
      rationale: "calibration",
      tokens: { input: 1, output: 1 },
      model: "judge",
    }))
    const result = await runOfflineSearchEval(
      { mode: "compare", baselineName: "default" },
      {
        runId: "run-search-failed",
        artifactStore: store,
        servingBearer: "eval-key",
        servingUrl: "https://admin.internal/api/internal/search-eval/search",
        searchClient: vi.fn(async () => ({
          ok: false as const,
          reason: "network_error" as const,
          retryable: true,
          status: 503,
          adminReason: "Search is temporarily unavailable",
        })),
        judge: { model: "judge", judgePair },
        now: () => new Date("2026-05-27T00:00:00.000Z"),
      },
    )

    expect(result).toMatchObject({
      ok: false,
      reason: "admin_read_failed",
      retryable: true,
      reportPath: "/tmp/search-eval/reports/run-search-failed.json",
    })
    expect(store.reports[0]).toMatchObject({
      totals: { searchFailures: 1 },
      outcomes: [{ kind: "search-failure" }],
    })
    expect(judgePair).toHaveBeenCalledOnce()
  })

  it("does not write a baseline when seed search has a transient failure", async () => {
    const store = memoryStore()
    const searchClient = vi.fn(async () => ({
      ok: false as const,
      reason: "network_error" as const,
      retryable: true,
      status: 503,
    }))
    const result = await runOfflineSearchEval(
      { mode: "capture-baseline", baselineName: "default", locales: ["en"] },
      {
        runId: "run-seed-failure",
        artifactStore: store,
        servingBearer: "eval-key",
        servingUrl: "https://admin.internal/api/internal/search-eval/search",
        searchClient,
      },
    )

    expect(result).toEqual({
      ok: false,
      reason: "admin_read_failed",
      retryable: true,
      adminStatus: "503",
    })
    expect(searchClient).toHaveBeenCalledOnce()
    expect(store.baselines).toEqual([])
  })

  it("marks comparison reports when baseline and current search config differ", async () => {
    const baseline = baselineArtifact()
    baseline.metadata.promptSetVersion = "seed/old"
    const judgePair = vi
      .fn()
      .mockResolvedValueOnce({
        verdict: "tie",
        rationale: "calibration",
        tokens: { input: 1, output: 1 },
        model: "judge",
      })
      .mockResolvedValueOnce({
        verdict: "tie",
        rationale: "same",
        tokens: { input: 1, output: 1 },
        model: "judge",
      })
      .mockResolvedValueOnce({
        verdict: "tie",
        rationale: "same",
        tokens: { input: 1, output: 1 },
        model: "judge",
      })

    const result = await runOfflineSearchEval(
      { mode: "compare", baselineName: "default", searchLimit: 10 },
      {
        runId: "run-config-mismatch",
        artifactStore: memoryStore(baseline),
        servingBearer: "eval-key",
        servingUrl:
          "https://user:pass@admin.internal/api/internal/search-eval/search?token=secret",
        searchClient: vi.fn(async () => ({
          ok: true as const,
          result: {
            results: [resultA],
            hasMore: false,
            query: "Jesus",
            searchMode: "hybrid" as const,
          },
        })),
        judge: { model: "judge", judgePair },
        now: () => new Date("2026-05-27T00:00:00.000Z"),
      },
    )

    expect(result).toMatchObject({
      ok: true,
      report: {
        metadata: {
          promptSetVersion: "seed/old",
          adminSearchUrl:
            "https://admin.internal/api/internal/search-eval/search",
        },
        baseline: {
          search: { limit: 20, mode: null, contentType: null },
          searchConfigMismatch: true,
        },
      },
    })
    expect(JSON.stringify(result)).not.toContain("secret")
  })

  it("returns judge_failed when calibration cannot verify the baseline", async () => {
    const store = memoryStore(baselineArtifact())
    const judgePair = vi.fn(async () => {
      throw new Error("judge unavailable")
    })
    const searchClient = vi.fn()

    const result = await runOfflineSearchEval(
      { mode: "compare", baselineName: "default" },
      {
        runId: "run-calibration-fail",
        artifactStore: store,
        servingBearer: "eval-key",
        servingUrl: "https://admin.internal/api/internal/search-eval/search",
        searchClient,
        judge: { model: "judge", judgePair },
      },
    )

    expect(result).toEqual({
      ok: false,
      reason: "judge_failed",
      retryable: true,
    })
    expect(searchClient).not.toHaveBeenCalled()
    expect(store.reports).toEqual([])
  })

  it("returns judge_failed when calibration disagrees with itself", async () => {
    const store = memoryStore(baselineArtifact())
    const candidateListClient = vi.fn()
    const searchClient = vi.fn()
    const judgePair = vi.fn(async () => ({
      verdict: "clearly-A-better" as const,
      rationale: "calibration drift",
      tokens: { input: 1, output: 1 },
      model: "judge",
    }))

    const result = await runOfflineSearchEval(
      {
        mode: "compare",
        baselineName: "default",
        includeGeneratedCandidates: true,
      },
      {
        runId: "run-calibration-disagreement",
        artifactStore: store,
        servingBearer: "eval-key",
        servingUrl: "https://admin.internal/api/internal/search-eval/search",
        candidateListClient,
        searchClient,
        judge: { model: "judge", judgePair },
      },
    )

    expect(result).toEqual({
      ok: false,
      reason: "judge_failed",
      retryable: true,
    })
    expect(candidateListClient).not.toHaveBeenCalled()
    expect(searchClient).not.toHaveBeenCalled()
    expect(store.reports).toEqual([])
  })

  it("records malformed generated candidates without counting them as searched", async () => {
    const store = memoryStore(baselineArtifact())
    const searchClient = vi.fn(async () => ({
      ok: true as const,
      result: {
        results: [resultB],
        hasMore: false,
        query: "Jesus",
        searchMode: "hybrid" as const,
      },
    }))
    const candidateListClient = vi.fn(async () => ({
      ok: true as const,
      result: {
        candidates: [
          {
            id: "candidate-missing-query",
            source: "catalog" as const,
            locale: "en",
            queryText: null,
            expectedResultHints: [],
            sourceAnchors: [],
            labelProvenance: {},
            generationModel: "catalog:v1",
            generationProvider: "mastra",
            judgeSummary: null,
            mastraRunId: "gen-run",
            retentionExpiresAt: null,
            generatedAt: "2026-05-27T00:00:00.000Z",
            createdAt: "2026-05-27T00:00:00.000Z",
          },
        ],
        generatedAt: "2026-05-27T00:00:00.000Z",
      },
    }))
    const judgePair = vi
      .fn()
      .mockResolvedValueOnce({
        verdict: "tie",
        rationale: "calibration",
        tokens: { input: 1, output: 1 },
        model: "judge",
      })
      .mockResolvedValueOnce({
        verdict: "tie",
        rationale: "same",
        tokens: { input: 1, output: 1 },
        model: "judge",
      })
      .mockResolvedValueOnce({
        verdict: "tie",
        rationale: "same",
        tokens: { input: 1, output: 1 },
        model: "judge",
      })

    const result = await runOfflineSearchEval(
      {
        mode: "compare",
        baselineName: "default",
        includeGeneratedCandidates: true,
      },
      {
        runId: "run-malformed-generated",
        artifactStore: store,
        servingBearer: "eval-key",
        servingUrl: "https://admin.internal/api/internal/search-eval/search",
        candidateListClient,
        searchClient,
        judge: { model: "judge", judgePair },
        now: () => new Date("2026-05-27T00:00:00.000Z"),
      },
    )

    expect(result).toMatchObject({
      ok: true,
      report: {
        generatedCandidateBehavior: {
          included: 1,
          searched: 0,
          searchFailures: 1,
        },
        exploratoryGenerated: [
          {
            candidateId: "candidate-missing-query",
            queryText: null,
            searchFailure: { code: "parse_error" },
          },
        ],
      },
    })
    expect(searchClient).toHaveBeenCalledOnce()
    expect(searchClient).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ query: "Jesus" }),
      }),
    )
  })

  it("records judge provider failures separately from judge disagreements", async () => {
    const store = memoryStore(baselineArtifact())
    const judgePair = vi
      .fn()
      .mockResolvedValueOnce({
        verdict: "tie",
        rationale: "calibration",
        tokens: { input: 1, output: 1 },
        model: "judge",
      })
      .mockResolvedValueOnce({
        verdict: "clearly-B-better",
        rationale: "forward spent tokens",
        tokens: { input: 7, output: 3 },
        model: "judge",
      })
      .mockRejectedValueOnce(new Error("provider down"))

    const result = await runOfflineSearchEval(
      { mode: "compare", baselineName: "default" },
      {
        runId: "run-judge-fail",
        artifactStore: store,
        servingBearer: "eval-key",
        servingUrl: "https://admin.internal/api/internal/search-eval/search",
        searchClient: vi.fn(async () => ({
          ok: true as const,
          result: {
            results: [resultB],
            hasMore: false,
            query: "Jesus",
            searchMode: "hybrid" as const,
          },
        })),
        judge: { model: "judge", judgePair },
        now: () => new Date("2026-05-27T00:00:00.000Z"),
      },
    )

    expect(result).toMatchObject({
      ok: false,
      reason: "judge_failed",
      retryable: true,
      reportPath: "/tmp/search-eval/reports/run-judge-fail.json",
    })
    expect(store.reports[0]).toMatchObject({
      cost: {
        inputTokens: 8,
        outputTokens: 4,
      },
      totals: { judgeFailures: 1, judgeDisagreements: 0 },
      judgeFailures: [{ code: "judge_failed" }],
      outcomes: [{ kind: "judge-failure" }],
    })
  })
})
