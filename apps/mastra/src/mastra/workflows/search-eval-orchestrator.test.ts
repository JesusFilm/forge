import { describe, expect, it, vi } from "vitest"

import {
  _internal,
  handleSearchEvalOrchestratorRouteRequest,
  runSearchEvalOrchestratorWorkflow,
  searchEvalOrchestratorWorkflow,
} from "./search-eval-orchestrator"
import { SEARCH_EVAL_SEED_PROMPT_LOCALES } from "../../services/offline-search-eval/seed-prompt-set"
import type { SearchEvalReport } from "../../services/offline-search-eval/types"

const DEFAULT_SEED_LOCALES = [...SEARCH_EVAL_SEED_PROMPT_LOCALES]

function customArtifactProjection(
  kind: SearchEvalReport["kind"],
  reportId: string,
): SearchEvalReport["mastraEvaluation"] {
  const baselineName = "seed-baseline"
  const mode = kind === "baseline-report" ? "baseline_capture" : "comparison"
  const verb = kind === "baseline-report" ? "baseline" : "compare"
  return {
    integrationStatus: "custom_artifact_only",
    dataset: {
      name: `search-eval:${baselineName}`,
      datasetId: null,
      source: "seed_prompt_set",
      version: "seed:v1",
      itemCount: 1,
      targetType: "workflow",
      targetId: "offline-search-eval",
    },
    scorers: [
      {
        id: "search-result-pairwise-judge",
        scorerId: null,
        status: "not_registered",
        kind: "pairwise_search_results",
      },
    ],
    experiment: {
      name: `search-eval-${verb}:${baselineName}:${reportId}`,
      experimentId: null,
      status: "not_created",
      mode,
      reportId,
      baselineName,
    },
  }
}

function nativeSyncedProjection(
  kind: SearchEvalReport["kind"],
  reportId: string,
): SearchEvalReport["mastraEvaluation"] {
  const baselineName = "seed-baseline"
  const mode = kind === "baseline-report" ? "baseline_capture" : "comparison"
  const verb = kind === "baseline-report" ? "baseline" : "compare"
  return {
    integrationStatus: "native_synced",
    dataset: {
      name: `search-eval:local:${baselineName}`,
      datasetId: "dataset-1",
      source: "seed_prompt_set",
      version: "seed:v1",
      itemCount: 1,
      targetType: "workflow",
      targetId: "offline-search-eval",
      environmentLabel: "local",
      nativeKey: `search-eval:local:${baselineName}:seed:v1`,
      status: "reused",
    },
    scorers: [
      {
        id: "search-result-pairwise-judge",
        scorerId: "scorer-1",
        status: "reused",
        kind: "pairwise_search_results",
      },
    ],
    experiment: {
      name: `search-eval-${verb}:local:${baselineName}:${reportId}`,
      experimentId: "experiment-1",
      status: "reused",
      mode,
      reportId,
      baselineName,
      environmentLabel: "local",
      nativeKey: `search-eval:local:${baselineName}:seed:v1:report:${reportId}`,
    },
  }
}

function report(
  options: {
    kind?: SearchEvalReport["kind"]
    reportId?: string
    losses?: number
    searchFailures?: number
    judgeFailures?: number
    judgeDisagreements?: number
    calibrationPassed?: boolean
    calibrationSkipped?: boolean
    judgeModel?: string | null
    netWinRate?: number
  } = {},
): SearchEvalReport {
  const kind = options.kind ?? "baseline-report"
  const reportId = options.reportId ?? "report-1"
  return {
    schemaVersion: "1",
    kind,
    reportId,
    metadata: {
      mastraRunId: "offline-run",
      startedAt: "2026-05-30T00:00:00.000Z",
      finishedAt: "2026-05-30T00:01:00.000Z",
      baselineName: "seed-baseline",
      promptSetVersion: "seed:v1",
      adminSearchUrl: "https://admin.internal/api/internal/search-eval/search",
      judgeModel:
        options.judgeModel === undefined ? "judge-model" : options.judgeModel,
      search: {
        limit: 20,
        mode: "hybrid",
        contentType: null,
      },
    },
    mastraEvaluation: customArtifactProjection(kind, reportId),
    baseline: {
      name: "seed-baseline",
      capturedAt: "2026-05-30T00:00:00.000Z",
      caseCount: 1,
      search: {
        limit: 20,
        mode: "hybrid",
        contentType: null,
      },
    },
    calibration: {
      passed: options.calibrationPassed ?? true,
      matched: 1,
      total: 1,
      skipped: options.calibrationSkipped ?? false,
    },
    totals: {
      queries: 1,
      wins: 0,
      losses: options.losses ?? 0,
      ties: 1,
      bothIrrelevant: 0,
      judgeDisagreements: options.judgeDisagreements ?? 0,
      judgeFailures: options.judgeFailures ?? 0,
      searchFailures: options.searchFailures ?? 0,
      netWinRate: options.netWinRate ?? 0,
    },
    localeMix: { en: 1 },
    promptSourceMix: { seed: 1 },
    generatedCandidateBehavior: {
      included: 0,
      searched: 0,
      traceDerived: 0,
      skippedTraceDerived: 0,
      searchFailures: 0,
    },
    cost: {
      inputTokens: 0,
      outputTokens: 0,
      totalUsd: null,
      pricingModel: null,
      estimated: true,
    },
    timings: {
      searchMs: 10,
      judgeMs: 5,
      totalMs: 15,
    },
    judgeFailures: [],
    outcomes: [],
    exploratoryGenerated: [],
  }
}

function offlineSuccess(
  mode: "capture-baseline" | "compare",
  outputReport = report({
    kind: mode === "capture-baseline" ? "baseline-report" : "comparison-report",
  }),
) {
  return {
    ok: true as const,
    mode,
    mastraRunId: "offline-run",
    baselineName: "seed-baseline",
    baselinePath: "/tmp/search-eval/baselines/seed-baseline.json",
    reportPath: `/tmp/search-eval/reports/${outputReport.reportId}.json`,
    report: outputReport,
  }
}

function nativeReportSuccess(outputReport = report()) {
  return {
    ok: true as const,
    action: "sync-report" as const,
    mastraRunId: "native-report-run",
    environmentLabel: "local",
    reportId: outputReport.reportId,
    reportPath: `/tmp/search-eval/reports/${outputReport.reportId}.json`,
    report: {
      ...outputReport,
      mastraEvaluation: nativeSyncedProjection(
        outputReport.kind,
        outputReport.reportId,
      ),
    },
    dataset: {
      datasetId: "dataset-1",
      name: "search-eval:local:seed-baseline",
      status: "reused",
      itemCount: 1,
      createdItems: 0,
      updatedItems: 1,
    },
    scorer: {
      scorerId: "scorer-1",
      status: "reused",
    },
    experiment: {
      experimentId: "experiment-1",
      status: "reused",
    },
  }
}

function promotedSyncSuccess() {
  return {
    ok: true as const,
    action: "sync-promoted" as const,
    mastraRunId: "native-promoted-run",
    environmentLabel: "local",
    dataset: {
      datasetId: "dataset-promoted",
      name: "search-eval:local:promoted-regression",
      status: "reused",
      itemCount: 2,
      createdItems: 0,
      updatedItems: 2,
    },
    scorer: {
      scorerId: "scorer-1",
      status: "reused",
    },
    promoted: { received: 2 },
    skipped: [],
  }
}

describe("search eval orchestrator workflow", () => {
  it("defaults to a constrained seed-baseline capture without non-seed inputs", () => {
    expect(
      _internal.SearchEvalOrchestratorWorkflowInputSchema.parse({}),
    ).toEqual({
      mode: "seed-baseline",
      baselineName: "seed-baseline",
      locales: DEFAULT_SEED_LOCALES,
      searchLimit: 20,
      searchMode: "hybrid",
      contentType: "all",
      nativeSync: true,
      syncPromoted: false,
      promotedLimit: 100,
      generateCandidates: false,
      traceLimit: 25,
      catalogLimit: 30,
      localeQueryCount: 2,
      submitSeedCandidates: false,
      gateMaxLosses: 0,
      gateMaxSearchFailures: 0,
      gateMaxJudgeFailures: 0,
      gateMaxJudgeDisagreements: 0,
      gateRequireCalibration: true,
      gateRequireAssignedJudge: true,
      gateMinComparableQueries: 1,
      gateMinNetWinRate: 0,
    })
    expect(searchEvalOrchestratorWorkflow.inputSchema).toBe(
      _internal.SearchEvalOrchestratorWorkflowInputSchema,
    )
  })

  it("accepts semantic-only but rejects Algolia-backed search modes", () => {
    expect(
      _internal.SearchEvalOrchestratorWorkflowInputSchema.parse({
        searchMode: "semantic-only",
      }).searchMode,
    ).toBe("semantic-only")
    expect(
      _internal.SearchEvalOrchestratorWorkflowInputSchema.safeParse({
        searchMode: "algolia-backed",
      }).success,
    ).toBe(false)
  })

  it("runs seed-baseline mode as offline baseline capture plus native report sync", async () => {
    const outputReport = report()
    const launchOffline = vi.fn(async (input) =>
      offlineSuccess(input.mode, outputReport),
    )
    const launchNative = vi.fn(async () => nativeReportSuccess(outputReport))

    const result = await runSearchEvalOrchestratorWorkflow(
      {},
      {
        runId: "run-orchestrator",
        checkReadiness: async () => ({
          ok: true,
          artifactRoot: null,
          checks: [],
        }),
        launchOfflineSearchEval: launchOffline,
        launchNativeSuite: launchNative,
      },
    )

    expect(result).toMatchObject({
      ok: true,
      mastraRunId: "run-orchestrator",
      summary: {
        mode: "seed-baseline",
        artifacts: {
          baselineName: "seed-baseline",
          reportId: "report-1",
          reportPath: "/tmp/search-eval/reports/report-1.json",
        },
        nativeEvaluation: {
          reportSync: {
            datasetId: "dataset-1",
            scorerIds: ["scorer-1"],
            experimentId: "experiment-1",
            integrationStatus: "native_synced",
          },
        },
        passFail: { state: "not_applicable", reasons: [] },
        readiness: { ok: true, checks: [] },
      },
    })
    expect(launchOffline).toHaveBeenCalledWith(
      {
        mode: "capture-baseline",
        baselineName: "seed-baseline",
        locales: DEFAULT_SEED_LOCALES,
        searchLimit: 20,
        searchMode: "hybrid",
        contentType: "all",
      },
      { runId: "run-orchestrator-offline-search-eval" },
    )
    expect(launchNative).toHaveBeenCalledTimes(1)
    expect(launchNative).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sync-report",
        reportId: "report-1",
      }),
      { runId: "run-orchestrator-native-report-sync" },
    )
  })

  it("runs explicit full mode as offline baseline capture plus native report and promoted sync", async () => {
    const outputReport = report()
    const launchOffline = vi.fn(async (input) =>
      offlineSuccess(input.mode, outputReport),
    )
    const launchNative = vi.fn(async (input) =>
      input.action === "sync-report"
        ? nativeReportSuccess(outputReport)
        : promotedSyncSuccess(),
    )

    const result = await runSearchEvalOrchestratorWorkflow(
      { mode: "full", syncPromoted: true },
      {
        runId: "run-orchestrator",
        launchOfflineSearchEval: launchOffline,
        launchNativeSuite: launchNative,
      },
    )

    expect(result).toMatchObject({
      ok: true,
      mastraRunId: "run-orchestrator",
      summary: {
        artifacts: {
          baselineName: "seed-baseline",
          reportId: "report-1",
          reportPath: "/tmp/search-eval/reports/report-1.json",
        },
        nativeEvaluation: {
          reportSync: {
            datasetId: "dataset-1",
            scorerIds: ["scorer-1"],
            experimentId: "experiment-1",
            integrationStatus: "native_synced",
          },
          promotedSync: {
            datasetId: "dataset-promoted",
            scorerIds: ["scorer-1"],
          },
        },
        counts: {
          reportQueries: 1,
          promotedReceived: 2,
          nativeCreatedItems: 0,
          nativeUpdatedItems: 1,
        },
        passFail: { state: "not_applicable", reasons: [] },
      },
    })
    expect(launchOffline).toHaveBeenCalledWith(
      {
        mode: "capture-baseline",
        baselineName: "seed-baseline",
        locales: DEFAULT_SEED_LOCALES,
        searchLimit: 20,
        searchMode: "hybrid",
        contentType: "all",
      },
      { runId: "run-orchestrator-offline-search-eval" },
    )
    expect(launchNative).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: "sync-report",
        reportId: "report-1",
      }),
      { runId: "run-orchestrator-native-report-sync" },
    )
    expect(launchNative).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: "sync-promoted",
        promotedLimit: 100,
      }),
      { runId: "run-orchestrator-native-promoted-sync" },
    )
  })

  it("rejects stale non-seed flags in seed-baseline mode", async () => {
    const launchOffline = vi.fn()

    const result = await runSearchEvalOrchestratorWorkflow(
      {
        mode: "seed-baseline",
        generateCandidates: true,
      },
      {
        runId: "run-orchestrator",
        checkReadiness: async () => ({
          ok: true,
          artifactRoot: null,
          checks: [],
        }),
        launchOfflineSearchEval: launchOffline,
      },
    )

    expect(result).toMatchObject({
      ok: false,
      reason: "invalid_input",
      retryable: false,
      summary: {
        passFail: {
          state: "failed",
          reasons: ["seed-baseline cannot generate candidates"],
        },
      },
    })
    expect(launchOffline).not.toHaveBeenCalled()
  })

  it("fails seed-baseline mode before offline eval when readiness fails", async () => {
    const launchOffline = vi.fn()

    const result = await runSearchEvalOrchestratorWorkflow(
      {},
      {
        runId: "run-orchestrator",
        checkReadiness: async () => ({
          ok: false,
          artifactRoot: null,
          checks: [
            {
              name: "admin_search_bearer",
              status: "fail",
              reason: "missing_admin_search_eval_api_key",
            },
          ],
        }),
        launchOfflineSearchEval: launchOffline,
      },
    )

    expect(result).toMatchObject({
      ok: false,
      reason: "readiness_failed",
      retryable: false,
      summary: {
        readiness: {
          ok: false,
          checks: [
            {
              name: "admin_search_bearer",
              status: "fail",
              reason: "missing_admin_search_eval_api_key",
            },
          ],
        },
        passFail: {
          state: "failed",
          reasons: ["missing_admin_search_eval_api_key"],
        },
      },
    })
    expect(launchOffline).not.toHaveBeenCalled()
  })

  it("resumes native report sync by report id without rerunning offline eval", async () => {
    const launchOffline = vi.fn()
    const launchNative = vi.fn(async () => nativeReportSuccess(report()))

    const result = await runSearchEvalOrchestratorWorkflow(
      {
        mode: "full",
        resumeReportId: "report-1",
        syncPromoted: false,
      },
      {
        runId: "run-orchestrator",
        launchOfflineSearchEval: launchOffline,
        launchNativeSuite: launchNative,
      },
    )

    expect(result).toMatchObject({
      ok: true,
      summary: {
        childWorkflowRuns: expect.arrayContaining([
          expect.objectContaining({
            workflowId: "offline-search-eval",
            status: "skipped",
            action: "resume-report",
          }),
        ]),
        resume: { reportId: "report-1", action: "sync-report" },
      },
    })
    expect(launchOffline).not.toHaveBeenCalled()
    expect(launchNative).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sync-report",
        reportId: "report-1",
      }),
      { runId: "run-orchestrator-native-report-sync" },
    )
  })

  it("evaluates release-gate thresholds from a resumed synced report", async () => {
    const outputReport = report({
      kind: "comparison-report",
      reportId: "report-pass",
    })
    const launchOffline = vi.fn()
    const launchNative = vi.fn(async () => nativeReportSuccess(outputReport))

    const result = await runSearchEvalOrchestratorWorkflow(
      {
        mode: "release-gate",
        resumeReportId: "report-pass",
        syncPromoted: false,
      },
      {
        runId: "run-orchestrator",
        launchOfflineSearchEval: launchOffline,
        launchNativeSuite: launchNative,
      },
    )

    expect(result).toMatchObject({
      ok: true,
      summary: {
        artifacts: {
          reportId: "report-pass",
          reportPath: "/tmp/search-eval/reports/report-pass.json",
        },
        counts: {
          reportQueries: 1,
          losses: 0,
          searchFailures: 0,
        },
        passFail: { state: "passed", reasons: [] },
      },
    })
    expect(launchOffline).not.toHaveBeenCalled()
  })

  it("fails release-gate mode when comparison losses exceed the threshold", async () => {
    const outputReport = report({
      kind: "comparison-report",
      losses: 1,
      reportId: "report-loss",
    })
    const launchOffline = vi.fn(async (input) =>
      offlineSuccess(input.mode, outputReport),
    )

    const result = await runSearchEvalOrchestratorWorkflow(
      {
        mode: "release-gate",
        nativeSync: false,
        syncPromoted: false,
      },
      {
        runId: "run-orchestrator",
        launchOfflineSearchEval: launchOffline,
      },
    )

    expect(result).toMatchObject({
      ok: false,
      reason: "release_gate_failed",
      retryable: false,
      summary: {
        artifacts: {
          reportId: "report-loss",
          reportPath: "/tmp/search-eval/reports/report-loss.json",
        },
        passFail: {
          state: "failed",
          reasons: ["losses 1 exceeded max 0"],
        },
        resume: {
          reportId: "report-loss",
          reportPath: "/tmp/search-eval/reports/report-loss.json",
          action: "sync-report",
        },
      },
    })
    expect(launchOffline).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "compare" }),
      { runId: "run-orchestrator-offline-search-eval" },
    )
  })

  it.each([
    [
      "calibration",
      { calibrationPassed: false },
      "judge calibration did not pass",
    ],
    [
      "skipped calibration",
      { calibrationSkipped: true },
      "judge calibration did not pass",
    ],
    [
      "missing assigned judge",
      { judgeModel: null },
      "assigned judge model is required",
    ],
    [
      "negative net win rate",
      { netWinRate: -0.1 },
      "net win rate -0.1 below minimum 0",
    ],
    [
      "search failures",
      { searchFailures: 1 },
      "search failures 1 exceeded max 0",
    ],
    ["judge failures", { judgeFailures: 1 }, "judge failures 1 exceeded max 0"],
    [
      "judge disagreements",
      { judgeDisagreements: 1 },
      "judge disagreements 1 exceeded max 0",
    ],
  ] as const)(
    "fails release-gate mode when %s violates the gate",
    async (_name, reportOptions, expectedReason) => {
      const outputReport = report({
        kind: "comparison-report",
        reportId: "report-gate",
        ...reportOptions,
      })

      const result = await runSearchEvalOrchestratorWorkflow(
        {
          mode: "release-gate",
          nativeSync: false,
          syncPromoted: false,
        },
        {
          runId: "run-orchestrator",
          launchOfflineSearchEval: vi.fn(async (input) =>
            offlineSuccess(input.mode, outputReport),
          ),
        },
      )

      expect(result).toMatchObject({
        ok: false,
        reason: "release_gate_failed",
        summary: {
          passFail: {
            state: "failed",
            reasons: expect.arrayContaining([expectedReason]),
          },
        },
      })
    },
  )

  it("fails release-gate mode when an evaluated locale has no comparable judged query", async () => {
    const baseReport = report({
      kind: "comparison-report",
      reportId: "report-locale-coverage",
    })
    const outputReport: SearchEvalReport = {
      ...baseReport,
      totals: {
        ...baseReport.totals,
        queries: 2,
        ties: 1,
        bothIrrelevant: 1,
      },
      localeMix: { en: 1, es: 1 },
      outcomes: [
        {
          kind: "tie",
          caseId: "seed-en",
          locale: "en",
          queryText: "hope",
          source: "seed",
          baselineResults: [],
          currentResults: [],
          verdicts: ["tie", "tie"],
        },
        {
          kind: "both-irrelevant",
          caseId: "seed-es",
          locale: "es",
          queryText: "esperanza",
          source: "seed",
          baselineResults: [],
          currentResults: [],
          verdicts: ["both-irrelevant", "both-irrelevant"],
        },
      ],
    }

    const result = await runSearchEvalOrchestratorWorkflow(
      {
        mode: "release-gate",
        nativeSync: false,
        syncPromoted: false,
      },
      {
        runId: "run-orchestrator",
        launchOfflineSearchEval: vi.fn(async (input) =>
          offlineSuccess(input.mode, outputReport),
        ),
      },
    )

    expect(result).toMatchObject({
      ok: false,
      reason: "release_gate_failed",
      summary: {
        passFail: {
          state: "failed",
          reasons: expect.arrayContaining([
            "locale es has no comparable judged queries",
          ]),
        },
      },
    })
  })

  it("passes release-gate mode when comparison report stays within thresholds", async () => {
    const outputReport = report({
      kind: "comparison-report",
      reportId: "report-pass",
    })

    const result = await runSearchEvalOrchestratorWorkflow(
      {
        mode: "release-gate",
        nativeSync: false,
        syncPromoted: false,
      },
      {
        runId: "run-orchestrator",
        launchOfflineSearchEval: vi.fn(async (input) =>
          offlineSuccess(input.mode, outputReport),
        ),
      },
    )

    expect(result).toMatchObject({
      ok: true,
      summary: {
        passFail: { state: "passed", reasons: [] },
      },
    })
  })

  it("preserves report resume details when native report sync fails", async () => {
    const outputReport = report({ reportId: "report-sync" })
    const launchOffline = vi.fn(async (input) =>
      offlineSuccess(input.mode, outputReport),
    )
    const launchNative = vi.fn(async () => ({
      ok: false as const,
      reason: "native_sync_failed" as const,
      retryable: true,
    }))

    const result = await runSearchEvalOrchestratorWorkflow(
      { syncPromoted: false },
      {
        runId: "run-orchestrator",
        checkReadiness: async () => ({
          ok: true,
          artifactRoot: null,
          checks: [],
        }),
        launchOfflineSearchEval: launchOffline,
        launchNativeSuite: launchNative,
      },
    )

    expect(result).toMatchObject({
      ok: false,
      reason: "native_report_sync_failed",
      retryable: true,
      summary: {
        artifacts: {
          reportId: "report-sync",
          reportPath: "/tmp/search-eval/reports/report-sync.json",
        },
        resume: {
          reportId: "report-sync",
          reportPath: "/tmp/search-eval/reports/report-sync.json",
          action: "sync-report",
        },
      },
    })
  })

  it("preserves report resume details when offline eval writes a partial report before failing", async () => {
    const launchOffline = vi.fn(async () => ({
      ok: false as const,
      reason: "judge_failed" as const,
      retryable: true,
      reportPath: "/tmp/search-eval/reports/report-partial.json",
    }))
    const launchNative = vi.fn()

    const result = await runSearchEvalOrchestratorWorkflow(
      {},
      {
        runId: "run-orchestrator",
        checkReadiness: async () => ({
          ok: true,
          artifactRoot: null,
          checks: [],
        }),
        launchOfflineSearchEval: launchOffline,
        launchNativeSuite: launchNative,
      },
    )

    expect(result).toMatchObject({
      ok: false,
      reason: "offline_eval_failed",
      retryable: true,
      summary: {
        childWorkflowRuns: [
          expect.objectContaining({
            workflowId: "offline-search-eval",
            status: "failed",
            action: "capture-baseline",
            reason: "judge_failed",
            retryable: true,
          }),
        ],
        artifacts: {
          reportId: "report-partial",
          reportPath: "/tmp/search-eval/reports/report-partial.json",
        },
        resume: {
          reportId: "report-partial",
          reportPath: "/tmp/search-eval/reports/report-partial.json",
          action: "sync-report",
        },
      },
    })
    expect(launchNative).not.toHaveBeenCalled()
  })

  it("preserves report resume details when promoted native sync fails", async () => {
    const outputReport = report({ reportId: "report-promoted" })
    const launchNative = vi.fn(async (input) =>
      input.action === "sync-report"
        ? nativeReportSuccess(outputReport)
        : {
            ok: false as const,
            reason: "runtime_unavailable" as const,
            retryable: true,
          },
    )

    const result = await runSearchEvalOrchestratorWorkflow(
      { mode: "full", syncPromoted: true },
      {
        runId: "run-orchestrator",
        launchOfflineSearchEval: vi.fn(async (input) =>
          offlineSuccess(input.mode, outputReport),
        ),
        launchNativeSuite: launchNative,
      },
    )

    expect(result).toMatchObject({
      ok: false,
      reason: "promoted_sync_failed",
      retryable: true,
      summary: {
        childWorkflowRuns: expect.arrayContaining([
          expect.objectContaining({
            workflowId: "search-eval-native-suite",
            status: "failed",
            action: "sync-promoted",
            reason: "runtime_unavailable",
          }),
        ]),
        artifacts: {
          reportId: "report-promoted",
          reportPath: "/tmp/search-eval/reports/report-promoted.json",
        },
        resume: {
          reportId: "report-promoted",
          reportPath: "/tmp/search-eval/reports/report-promoted.json",
          action: "sync-report",
        },
      },
    })
  })

  it("short-circuits with child metadata when candidate generation fails", async () => {
    const launchOffline = vi.fn()

    const result = await runSearchEvalOrchestratorWorkflow(
      { mode: "full", generateCandidates: true },
      {
        runId: "run-orchestrator",
        launchEvalQueryGeneration: vi.fn(async () => ({
          ok: false as const,
          reason: "generation_config_missing" as const,
          retryable: false,
        })),
        launchOfflineSearchEval: launchOffline,
      },
    )

    expect(result).toMatchObject({
      ok: false,
      reason: "candidate_generation_failed",
      retryable: false,
      summary: {
        childWorkflowRuns: [
          {
            workflowId: "eval-query-generation",
            runId: "run-orchestrator-eval-query-generation",
            status: "failed",
            reason: "generation_config_missing",
            retryable: false,
          },
        ],
      },
    })
    expect(launchOffline).not.toHaveBeenCalled()
  })

  it("short-circuits with child metadata when seed candidate submission fails", async () => {
    const launchOffline = vi.fn()

    const result = await runSearchEvalOrchestratorWorkflow(
      { mode: "full", submitSeedCandidates: true },
      {
        runId: "run-orchestrator",
        launchCandidateReview: vi.fn(async () => ({
          ok: false as const,
          reason: "admin_store_rejected" as const,
          retryable: false,
        })),
        launchOfflineSearchEval: launchOffline,
      },
    )

    expect(result).toMatchObject({
      ok: false,
      reason: "seed_submit_failed",
      retryable: false,
      summary: {
        childWorkflowRuns: [
          {
            workflowId: "search-eval-candidate-review",
            runId: "run-orchestrator-submit-seed-candidates",
            status: "failed",
            action: "submit-seed",
            reason: "admin_store_rejected",
            retryable: false,
          },
        ],
      },
    })
    expect(launchOffline).not.toHaveBeenCalled()
  })

  it("stages generated and seed candidates without calling promote", async () => {
    const launchGeneration = vi.fn(async () => ({
      ok: true as const,
      mastraRunId: "generation-run",
      storedCount: 2,
      skippedCount: 1,
      generatedCount: 3,
      sourceCounts: { catalog: 1, locale_quality: 1, trace: 1 },
    }))
    const launchCandidateReview = vi.fn(async (input) => ({
      ok: true as const,
      action: input.action,
      mastraRunId: "seed-run",
      storeResult: {
        storedCount: 3,
        skippedCount: 0,
        candidates: [],
        skipped: [],
      },
      nativeDatasetItemShape: {},
    }))
    const launchOffline = vi.fn(async (input) => offlineSuccess(input.mode))

    const result = await runSearchEvalOrchestratorWorkflow(
      {
        mode: "full",
        generateCandidates: true,
        submitSeedCandidates: true,
        nativeSync: false,
        syncPromoted: false,
      },
      {
        runId: "run-orchestrator",
        launchEvalQueryGeneration: launchGeneration,
        launchCandidateReview,
        launchOfflineSearchEval: launchOffline,
      },
    )

    expect(result).toMatchObject({
      ok: true,
      summary: {
        counts: {
          generatedCandidates: 3,
          storedCandidates: 5,
          skippedCandidates: 1,
        },
      },
    })
    expect(launchCandidateReview).toHaveBeenCalledWith(
      { action: "submit-seed", seedLocales: DEFAULT_SEED_LOCALES },
      { runId: "run-orchestrator-submit-seed-candidates" },
    )
    expect(
      launchCandidateReview.mock.calls.some(
        ([input]) => input.action === "promote",
      ),
    ).toBe(false)
  })

  it("requires service bearer auth before launching from the route", async () => {
    const launch = vi.fn()
    const response = await handleSearchEvalOrchestratorRouteRequest({
      authHeader: "Bearer wrong",
      serviceKeys: ["service-key"],
      readJson: async () => ({}),
      launch,
    })

    expect(response).toEqual({
      status: 401,
      body: { error: "Service bearer required" },
    })
    expect(launch).not.toHaveBeenCalled()
  })

  it("launches parsed default input for a valid service bearer", async () => {
    const launch = vi.fn(async (input, { runId }) => ({
      ok: true as const,
      mastraRunId: runId,
      summary: {
        mode: input.mode,
        baselineName: input.baselineName,
        childWorkflowRuns: [],
        artifacts: { baselineName: input.baselineName },
        nativeEvaluation: {},
        counts: {},
        passFail: { state: "not_applicable" as const, reasons: [] },
      },
    }))

    const response = await handleSearchEvalOrchestratorRouteRequest({
      authHeader: "Bearer service-key",
      serviceKeys: ["service-key"],
      readJson: async () => ({}),
      launch,
    })

    expect(response.status).toBe(200)
    expect(response.body.result).toMatchObject({ ok: true })
    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "seed-baseline",
        baselineName: "seed-baseline",
        nativeSync: true,
        syncPromoted: false,
      }),
      { runId: expect.any(String) },
    )
  })

  it.each([
    [
      "offline missing baseline",
      "offline_eval_failed",
      "artifact_not_found",
      404,
    ],
    [
      "native runtime unavailable",
      "native_report_sync_failed",
      "runtime_unavailable",
      503,
    ],
    ["seed submit rejected", "seed_submit_failed", "admin_store_rejected", 409],
  ] as const)(
    "maps %s child failure to HTTP %i",
    async (_name, reason, childReason, status) => {
      const launch = vi.fn(async (input, { runId }) => ({
        ok: false as const,
        reason,
        retryable: childReason !== "admin_store_rejected",
        mastraRunId: runId,
        summary: {
          mode: input.mode,
          baselineName: input.baselineName,
          childWorkflowRuns: [
            {
              workflowId: "offline-search-eval" as const,
              runId: `${runId}-offline-search-eval`,
              status: "failed" as const,
              reason: childReason,
              retryable: childReason !== "admin_store_rejected",
            },
          ],
          artifacts: { baselineName: input.baselineName },
          nativeEvaluation: {},
          counts: {},
          passFail: { state: "not_applicable" as const, reasons: [] },
        },
      }))

      const response = await handleSearchEvalOrchestratorRouteRequest({
        authHeader: "Bearer service-key",
        serviceKeys: ["service-key"],
        readJson: async () => ({}),
        launch,
      })

      expect(response.status).toBe(status)
      expect(response.body.result).toMatchObject({
        ok: false,
        reason,
        summary: {
          childWorkflowRuns: [expect.objectContaining({ reason: childReason })],
        },
      })
    },
  )

  it("extracts Mastra-wrapped workflow failures with trailing stack text", () => {
    const failure = {
      ok: false as const,
      reason: "offline_eval_failed" as const,
      retryable: false,
      mastraRunId: "run-real-data",
      summary: {
        mode: "full" as const,
        baselineName: "real-world-smoke",
        childWorkflowRuns: [
          {
            workflowId: "offline-search-eval" as const,
            runId: "run-real-data-offline-search-eval",
            status: "failed" as const,
            action: "capture-baseline",
            reason: "admin_config_missing",
            retryable: false,
          },
        ],
        artifacts: { baselineName: "real-world-smoke" },
        nativeEvaluation: {},
        counts: {},
        passFail: { state: "not_applicable" as const, reasons: [] },
      },
    }
    const wrapped = new Error(
      `Error executing step workflow.search-eval-orchestrator: ` +
        `SearchEvalOrchestratorWorkflowFailureError: ` +
        `SEARCH_EVAL_ORCHESTRATOR_FAILED:${JSON.stringify(failure)}\n` +
        "    at executeStep (chunk.js:1:1)",
    )

    expect(_internal.workflowFailureFromUnknown(wrapped)).toEqual(failure)
    expect(_internal.routeStatusForResult(failure)).toBe(503)

    const stackWrapped = new Error("Error executing workflow step")
    stackWrapped.stack =
      `Error: Error executing workflow step\n` +
      `Caused by: SearchEvalOrchestratorWorkflowFailureError: ` +
      `SEARCH_EVAL_ORCHESTRATOR_FAILED:${JSON.stringify(failure)}\n` +
      "    at executeStep (chunk.js:1:1)"

    expect(_internal.workflowFailureFromUnknown(stackWrapped)).toEqual(failure)
    expect(
      _internal.workflowFailureFromRunResult({
        status: "failed",
        error: {
          message: `SEARCH_EVAL_ORCHESTRATOR_FAILED:${JSON.stringify(failure)}`,
          name: "SearchEvalOrchestratorWorkflowFailureError",
          result: failure,
        },
      }),
    ).toEqual(failure)
  })

  it("rejects oversized route bodies before launching", async () => {
    const launch = vi.fn()
    const response = await handleSearchEvalOrchestratorRouteRequest({
      authHeader: "Bearer service-key",
      serviceKeys: ["service-key"],
      request: new Request(
        "https://mastra.test/forge-search-eval-orchestrator",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          duplex: "half",
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(12289))
              controller.close()
            },
          }),
        } as RequestInit & { duplex: "half" },
      ),
      launch,
    })

    expect(response.status).toBe(413)
    expect(response.body.result).toMatchObject({
      ok: false,
      reason: "invalid_input",
    })
    expect(launch).not.toHaveBeenCalled()
  })
})
