import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { DatasetItem, DatasetRecord } from "@mastra/core/storage"
import { describe, expect, it, vi } from "vitest"

import {
  _internal,
  handleSearchEvalNativeSuiteRouteRequest,
  runSearchEvalNativeSuiteWorkflow,
} from "./search-eval-native-suite"
import { createSearchEvalArtifactStore } from "../../services/offline-search-eval/artifacts"
import {
  importSearchEvalBaselineArtifact,
  type SearchEvalBaselineExportArtifact,
} from "../../services/offline-search-eval/baseline-portability"
import { finalizeReport } from "../../services/offline-search-eval/report"
import { SEARCH_EVAL_SEED_PROMPT_SET_VERSION } from "../../services/offline-search-eval/seed-prompt-set"
import type { NativeSearchEvalMastra } from "../../services/offline-search-eval/native-evaluation"
import type {
  BaselineArtifact,
  SearchEvalReport,
  SearchEvalResult,
} from "../../services/offline-search-eval/types"

function fakeMastra(): NativeSearchEvalMastra & {
  records: DatasetRecord[]
  items: DatasetItem[]
} {
  const now = new Date("2026-05-28T00:00:00.000Z")
  const records: DatasetRecord[] = []
  const items: DatasetItem[] = []
  const experiments: Array<{
    id: string
    name: string
    metadata: Record<string, unknown>
  }> = []
  const scorers: Record<string, unknown> = {}
  async function addItems(input: {
    items: Array<{
      input: unknown
      groundTruth?: unknown
      metadata?: Record<string, unknown>
    }>
  }) {
    const added = input.items.map((item, index) => ({
      id: `item-${index + 1}`,
      datasetId: "dataset-1",
      datasetVersion: 1,
      input: item.input,
      groundTruth: item.groundTruth,
      metadata: item.metadata,
      createdAt: now,
      updatedAt: now,
    }))
    items.push(...added)
    return added
  }

  async function updateItem(input: { itemId: string }) {
    const item = items.find((candidate) => candidate.id === input.itemId)
    if (!item) throw new Error("not expected")
    return item
  }

  const dataset = {
    id: "dataset-1",
    addItems,
    updateItem,
    async listItems() {
      return { items }
    },
    async listExperiments() {
      return { experiments }
    },
    async startExperiment(input: {
      name: string
      metadata?: Record<string, unknown>
    }) {
      const experiment = {
        id: `experiment-${experiments.length + 1}`,
        name: input.name,
        metadata: input.metadata ?? {},
      }
      experiments.push(experiment)
      return { experimentId: experiment.id }
    },
  }

  return {
    records,
    items,
    datasets: {
      async list() {
        return { datasets: records }
      },
      async get() {
        return dataset
      },
      async create(input: {
        name: string
        metadata?: Record<string, unknown>
      }) {
        records.push({
          id: "dataset-1",
          name: input.name,
          metadata: input.metadata,
          targetType: "workflow",
          targetIds: ["offline-search-eval"],
          scorerIds: ["search-result-pairwise-judge"],
          version: 1,
          createdAt: now,
          updatedAt: now,
        })
        return dataset
      },
    },
    listScorers() {
      return scorers
    },
    addScorer(scorer: unknown, key?: string) {
      scorers[key ?? "unknown"] = scorer
    },
  } as unknown as NativeSearchEvalMastra & {
    records: DatasetRecord[]
    items: DatasetItem[]
  }
}

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

function portabilityArtifact(): SearchEvalBaselineExportArtifact {
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

describe("search eval native suite workflow", () => {
  it("syncs promoted candidates through Admin HTTP with promoted filters", async () => {
    const listClient = vi.fn(async () => ({
      ok: true as const,
      result: {
        candidates: [],
        generatedAt: "2026-05-28T00:00:00.000Z",
      },
    }))
    const result = await runSearchEvalNativeSuiteWorkflow(
      { action: "sync-promoted", promotedLimit: 7, environmentLabel: "local" },
      {
        mastra: fakeMastra(),
        adminBearer: "eval-key",
        candidateUrl:
          "https://admin.internal/api/internal/search-eval/candidates",
        listClient,
        runId: "run-native",
      },
    )

    expect(result).toMatchObject({
      ok: true,
      action: "sync-promoted",
      dataset: expect.objectContaining({
        name: "search-eval:local:promoted-regression",
      }),
    })
    expect(listClient).toHaveBeenCalledWith(
      expect.objectContaining({
        bearer: "eval-key",
        url: "https://admin.internal/api/internal/search-eval/candidates",
        filters: { statuses: ["promoted"], limit: 7 },
      }),
    )
  })

  it("rejects sample data creation for production-like environment labels", async () => {
    await expect(
      runSearchEvalNativeSuiteWorkflow(
        { action: "create-sample-report", environmentLabel: "production" },
        { mastra: fakeMastra(), runId: "run-native" },
      ),
    ).resolves.toEqual({
      ok: false,
      reason: "sample_not_allowed",
      retryable: false,
      reportPath: undefined,
      adminStatus: undefined,
      adminReason: undefined,
    })
  })

  it("syncs an imported seed baseline report into local native Evaluation", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "forge-native-import-"))
    try {
      const artifactStore = createSearchEvalArtifactStore(rootDir)
      const imported = await importSearchEvalBaselineArtifact({
        artifact: portabilityArtifact(),
        options: { artifactStore },
      })
      const mastra = fakeMastra()

      const result = await runSearchEvalNativeSuiteWorkflow(
        {
          action: "sync-report",
          reportId: imported.reportIds[0],
          environmentLabel: "local",
        },
        { mastra, artifactStore, runId: "run-native" },
      )

      expect(result).toMatchObject({
        ok: true,
        action: "sync-report",
        reportId: "report-1",
        dataset: {
          name: "search-eval:local:seed-baseline:public-watch:hybrid",
          status: "created",
          itemCount: 1,
        },
        experiment: {
          name: "search-eval-baseline:local:seed-baseline:public-watch:hybrid:report-1",
          status: "created",
        },
        report: {
          mastraEvaluation: {
            integrationStatus: "native_synced",
            dataset: {
              name: "search-eval:local:seed-baseline:public-watch:hybrid",
              itemCount: 1,
            },
          },
        },
      })
      await expect(artifactStore.readReport("report-1")).resolves.toMatchObject(
        {
          mastraEvaluation: { integrationStatus: "native_synced" },
        },
      )
      expect(mastra.records).toHaveLength(1)
      expect(mastra.items).toHaveLength(1)
    } finally {
      await rm(rootDir, { recursive: true, force: true })
    }
  })

  it("requires service bearer auth on the route", async () => {
    const outcome = await handleSearchEvalNativeSuiteRouteRequest({
      authHeader: null,
      serviceKeys: ["service-key"],
      readJson: async () => ({ action: "sync-promoted" }),
    })

    expect(outcome).toEqual({
      status: 401,
      body: { error: "Service bearer required" },
    })
  })

  it("ignores malformed workflow failure envelopes", () => {
    expect(
      _internal.workflowFailureFromUnknown(
        new Error("SEARCH_EVAL_NATIVE_SUITE_FAILED:{not-json"),
      ),
    ).toBeNull()
  })
})
