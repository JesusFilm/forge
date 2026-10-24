import { describe, expect, it, vi } from "vitest"

import {
  SEARCH_EVAL_BASELINE_PORTABILITY_MAX_BODY_BYTES,
  SearchEvalPortabilityError,
  type SearchEvalBaselineExportArtifact,
  type SearchEvalPortabilityAudit,
} from "../../services/offline-search-eval/baseline-portability"
import { finalizeReport } from "../../services/offline-search-eval/report"
import { SEARCH_EVAL_SEED_PROMPT_SET_VERSION } from "../../services/offline-search-eval/seed-prompt-set"
import type {
  BaselineArtifact,
  SearchEvalReport,
  SearchEvalResult,
} from "../../services/offline-search-eval/types"
import {
  _internal,
  handleSearchEvalBaselinePortabilityRouteRequest,
  runSearchEvalBaselinePortabilityWorkflow,
} from "./search-eval-baseline-portability"

function searchResult(): SearchEvalResult {
  return {
    type: "video",
    id: "video-1",
    slug: "video-1",
    title: "Jesus",
    imageUrl: null,
    snippet: "A seed result.",
    startSeconds: null,
    playbackId: null,
    score: 1,
    label: null,
    durationSeconds: null,
    childCount: null,
  }
}

function baseline(): BaselineArtifact {
  return {
    schemaVersion: "1",
    kind: "baseline",
    name: "seed-baseline",
    capturedAt: "2026-06-02T00:00:00.000Z",
    metadata: {
      mastraRunId: "run-1",
      startedAt: "2026-06-02T00:00:00.000Z",
      finishedAt: "2026-06-02T00:00:01.000Z",
      baselineName: "seed-baseline",
      callerTrack: "public-watch",
      promptSetVersion: SEARCH_EVAL_SEED_PROMPT_SET_VERSION,
      adminSearchUrl: "https://admin.internal/api/internal/search-eval/search",
      servingRevision: null,
      judgeModel: null,
      search: { limit: 20, mode: "hybrid", contentType: null },
    },
    cases: [
      {
        caseId: "seed-jesus",
        locale: "en",
        queryText: "Jesus",
        source: "seed",
        callerTrack: "public-watch",
        tags: ["core-title"],
        results: [searchResult()],
      },
    ],
  }
}

function seedReport(): SearchEvalReport {
  const base = baseline()
  return finalizeReport({
    schemaVersion: "1",
    kind: "baseline-report",
    reportId: "report-1",
    metadata: base.metadata,
    baseline: {
      name: base.name,
      capturedAt: base.capturedAt,
      caseCount: base.cases.length,
      search: base.metadata.search,
    },
    calibration: { passed: true, matched: 0, total: 0, skipped: true },
    cost: {
      inputTokens: 0,
      outputTokens: 0,
      totalUsd: 0,
      pricingModel: null,
      estimated: false,
    },
    timings: { searchMs: 0, judgeMs: 0, totalMs: 0 },
    judgeFailures: [],
    outcomes: [
      {
        kind: "tie",
        caseId: "seed-jesus",
        locale: "en",
        queryText: "Jesus",
        source: "seed",
        callerTrack: "public-watch",
        baselineResults: [searchResult()],
        currentResults: [searchResult()],
        verdicts: ["tie", "tie"],
      },
    ],
    exploratoryGenerated: [],
  })
}

function artifact(): SearchEvalBaselineExportArtifact {
  const base = baseline()
  return {
    schemaVersion: "1",
    kind: "search-eval-baseline-export",
    exportId: "export-1",
    exportedAt: "2026-06-02T00:00:02.000Z",
    sourceEnvironment: "production",
    baselineName: base.name,
    promptSetVersion: base.metadata.promptSetVersion,
    baseline: base,
    reports: [seedReport()],
  }
}

function audit(
  action: SearchEvalPortabilityAudit["action"],
  result: SearchEvalPortabilityAudit["result"],
): SearchEvalPortabilityAudit {
  return {
    action,
    environment: "test",
    baselineName: "seed-baseline",
    reportIds: ["report-1"],
    artifactBytes: 100,
    result,
  }
}

describe("search eval baseline portability workflow", () => {
  it("defaults to a seed-baseline preflight", () => {
    expect(
      _internal.SearchEvalBaselinePortabilityInputSchema.parse({}),
    ).toEqual({
      action: "preflight",
      baselineName: "seed-baseline",
      reportIds: [],
    })
  })

  it("returns preflight readiness without launching export or import", async () => {
    await expect(
      runSearchEvalBaselinePortabilityWorkflow(
        {},
        {
          runId: "run-1",
          checkReadiness: async () => ({
            ok: false,
            artifactRoot: "/tmp/search-eval",
            checks: [
              {
                name: "admin_search_url",
                status: "fail",
                reason: "missing_admin_search_eval_search_url",
              },
            ],
          }),
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      action: "preflight",
      mastraRunId: "run-1",
      readiness: { ok: false },
      audit: { action: "preflight", result: "not_ready" },
    })
  })

  it("exports a bounded seed baseline artifact", async () => {
    const exportBaseline = vi.fn(async () => ({
      artifact: artifact(),
      audit: audit("export-baseline", "exported"),
    }))

    await expect(
      runSearchEvalBaselinePortabilityWorkflow(
        { action: "export-baseline", reportIds: ["report-1"] },
        { runId: "run-1", exportBaseline },
      ),
    ).resolves.toMatchObject({
      ok: true,
      action: "export-baseline",
      baselineName: "seed-baseline",
      reportIds: ["report-1"],
      artifact: { exportId: "export-1" },
    })
    expect(exportBaseline).toHaveBeenCalledWith({
      baselineName: "seed-baseline",
      reportIds: ["report-1"],
    })
  })

  it("imports a sanitized seed baseline artifact", async () => {
    const importBaseline = vi.fn(async () => ({
      baselineName: "seed-baseline",
      reportIds: ["report-1"],
      audit: audit("import-baseline", "imported"),
    }))

    await expect(
      runSearchEvalBaselinePortabilityWorkflow(
        { action: "import-baseline", artifact: artifact() },
        { runId: "run-1", importBaseline },
      ),
    ).resolves.toMatchObject({
      ok: true,
      action: "import-baseline",
      baselineName: "seed-baseline",
      reportIds: ["report-1"],
      audit: { result: "imported" },
    })
    expect(importBaseline).toHaveBeenCalledWith({ artifact: artifact() })
  })

  it("maps seed-only enforcement failures to route-safe workflow failures", async () => {
    await expect(
      runSearchEvalBaselinePortabilityWorkflow(
        { action: "export-baseline" },
        {
          runId: "run-1",
          exportBaseline: async () => {
            throw new SearchEvalPortabilityError(
              "not_seed_only",
              "report contains generated data",
            )
          },
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      reason: "not_seed_only",
      retryable: false,
      audit: { action: "export-baseline", result: "failed" },
    })
  })
})

describe("search eval baseline portability route", () => {
  it("requires service bearer before launching", async () => {
    const launch = vi.fn()
    const response = await handleSearchEvalBaselinePortabilityRouteRequest({
      authHeader: "Bearer wrong",
      serviceKeys: ["service-key"],
      readJson: async () => ({ action: "preflight" }),
      launch,
    })

    expect(response).toEqual({
      status: 401,
      body: { error: "Service bearer required" },
    })
    expect(launch).not.toHaveBeenCalled()
  })

  it("launches with parsed export input for a valid service bearer", async () => {
    const launch = vi.fn(async () => ({
      ok: true as const,
      action: "export-baseline" as const,
      mastraRunId: "run-1",
      artifact: artifact(),
      baselineName: "seed-baseline",
      reportIds: ["report-1"],
      audit: audit("export-baseline", "exported"),
    }))

    const response = await handleSearchEvalBaselinePortabilityRouteRequest({
      authHeader: "Bearer service-key",
      serviceKeys: ["service-key"],
      readJson: async () => ({ action: "export-baseline" }),
      launch,
    })

    expect(response.status).toBe(200)
    expect(response.body.result).toMatchObject({ ok: true })
    expect(launch).toHaveBeenCalledWith(
      {
        action: "export-baseline",
        baselineName: "seed-baseline",
        reportIds: [],
      },
      { runId: expect.any(String) },
    )
  })

  it("rejects import requests without an artifact", async () => {
    const launch = vi.fn()
    const response = await handleSearchEvalBaselinePortabilityRouteRequest({
      authHeader: "Bearer service-key",
      serviceKeys: ["service-key"],
      readJson: async () => ({ action: "import-baseline" }),
      launch,
    })

    expect(response.status).toBe(400)
    expect(response.body.result).toMatchObject({
      ok: false,
      reason: "invalid_input",
    })
    expect(launch).not.toHaveBeenCalled()
  })

  it("rejects oversized artifact uploads before launching", async () => {
    const launch = vi.fn()
    const response = await handleSearchEvalBaselinePortabilityRouteRequest({
      authHeader: "Bearer service-key",
      serviceKeys: ["service-key"],
      request: new Request(
        "https://mastra.test/forge-search-eval-baseline-portability",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": String(
              SEARCH_EVAL_BASELINE_PORTABILITY_MAX_BODY_BYTES + 1,
            ),
          },
          body: "{}",
        },
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

  it.each([
    ["artifact_invalid", 400],
    ["artifact_not_found", 404],
    ["import_disabled", 403],
    ["not_seed_only", 409],
    ["artifact_too_large", 413],
    ["readiness_failed", 503],
  ] as const)("maps %s to HTTP %i", async (reason, status) => {
    const response = await handleSearchEvalBaselinePortabilityRouteRequest({
      authHeader: "Bearer service-key",
      serviceKeys: ["service-key"],
      readJson: async () => ({ action: "export-baseline" }),
      launch: vi.fn(async () => ({
        ok: false as const,
        reason,
        retryable: false,
        mastraRunId: "run-1",
      })),
    })

    expect(response.status).toBe(status)
    expect(response.body.result).toMatchObject({ ok: false, reason })
  })
})
