import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  SearchEvalArtifactError,
  createSearchEvalArtifactStore,
  _internal,
} from "./artifacts"
import { finalizeReport } from "./report"
import type { BaselineArtifact, SearchEvalReport } from "./types"

let rootDir: string

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "forge-mastra-search-eval-"))
})

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true })
})

function baseline(): BaselineArtifact {
  return {
    schemaVersion: "1",
    kind: "baseline",
    name: "default",
    capturedAt: "2026-05-27T00:00:00.000Z",
    metadata: {
      mastraRunId: "run-1",
      startedAt: "2026-05-27T00:00:00.000Z",
      finishedAt: "2026-05-27T00:00:01.000Z",
      baselineName: "default",
      promptSetVersion: "seed/v1",
      adminSearchUrl: "https://admin.internal/api/internal/search-eval/search",
      judgeModel: null,
      search: { limit: 20, mode: null, contentType: null },
    },
    cases: [
      {
        caseId: "seed-jesus",
        locale: "en",
        queryText: "Jesus",
        source: "seed",
        tags: ["core"],
        results: [],
      },
    ],
  }
}

function report(): SearchEvalReport {
  return finalizeReport({
    schemaVersion: "1",
    kind: "comparison-report",
    reportId: "run-1",
    metadata: baseline().metadata,
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
    outcomes: [],
    exploratoryGenerated: [],
  })
}

describe("search eval artifact store", () => {
  it("round-trips baselines and writes reports under safe names", async () => {
    const store = createSearchEvalArtifactStore(rootDir)

    await expect(store.writeBaseline(baseline())).resolves.toMatchObject({
      path: expect.stringContaining("baselines/default.json"),
    })
    await expect(store.readBaseline("default")).resolves.toEqual(baseline())
    await expect(store.writeReport(report())).resolves.toMatchObject({
      path: expect.stringContaining("reports/run-1.json"),
    })
    await expect(store.readReport("run-1")).resolves.toEqual(report())
  })

  it("accepts reports after real native Evaluation records are synced", async () => {
    const store = createSearchEvalArtifactStore(rootDir)
    const syncedReport: SearchEvalReport = {
      ...report(),
      mastraEvaluation: {
        integrationStatus: "native_synced",
        dataset: {
          name: "search-eval:local:default:hybrid",
          datasetId: "dataset-1",
          source: "seed_prompt_set",
          version: "seed/v1",
          itemCount: 0,
          targetType: "workflow",
          targetId: "offline-search-eval",
          environmentLabel: "local",
          nativeKey: "search-eval:local:default:seed/v1:mode:hybrid",
          status: "created",
        },
        scorers: [
          {
            id: "search-result-pairwise-judge",
            scorerId: "search-result-pairwise-judge",
            status: "registered",
            kind: "pairwise_search_results",
          },
        ],
        experiment: {
          name: "search-eval-compare:local:default:hybrid:run-1",
          experimentId: "experiment-1",
          status: "created",
          mode: "comparison",
          reportId: "run-1",
          baselineName: "default",
          environmentLabel: "local",
          nativeKey:
            "search-eval:local:default:seed/v1:mode:hybrid:report:run-1",
        },
      },
    }

    await expect(store.writeReport(syncedReport)).resolves.toMatchObject({
      path: expect.stringContaining("reports/run-1.json"),
    })
    await expect(store.readReport("run-1")).resolves.toEqual(syncedReport)
  })

  it("rejects unsafe artifact names", () => {
    for (const name of ["", "../default", "default/other", "bad name"]) {
      expect(() => _internal.assertSafeName(name)).toThrow(
        SearchEvalArtifactError,
      )
    }
  })

  it("returns typed failures for missing baselines", async () => {
    const store = createSearchEvalArtifactStore(rootDir)

    await expect(store.readBaseline("missing")).rejects.toMatchObject({
      code: "not_found",
    })
  })

  it("rejects malformed baseline artifacts", async () => {
    const { writeFile, mkdir } = await import("node:fs/promises")
    await mkdir(join(rootDir, "baselines"), { recursive: true })
    await writeFile(
      join(rootDir, "baselines", "default.json"),
      JSON.stringify({
        ...baseline(),
        cases: [{ caseId: "seed-1", source: "seed" }],
      }),
      "utf8",
    )
    const store = createSearchEvalArtifactStore(rootDir)

    await expect(store.readBaseline("default")).rejects.toMatchObject({
      code: "invalid_artifact",
    })
  })

  it("rejects malformed baseline artifacts before writing", async () => {
    const store = createSearchEvalArtifactStore(rootDir)

    await expect(
      store.writeBaseline({
        ...baseline(),
        cases: [{ caseId: "seed-1", source: "seed" }],
      } as BaselineArtifact),
    ).rejects.toMatchObject({
      code: "invalid_artifact",
    })
  })

  it("rejects malformed report artifacts before writing", async () => {
    const store = createSearchEvalArtifactStore(rootDir)

    await expect(
      store.writeReport({
        ...report(),
        outcomes: [
          {
            kind: "win",
            caseId: "seed-1",
          },
        ],
      } as SearchEvalReport),
    ).rejects.toMatchObject({
      code: "invalid_artifact",
    })
  })

  it.each([
    [
      "integration status",
      (validReport: SearchEvalReport) => ({
        ...validReport,
        mastraEvaluation: {
          ...validReport.mastraEvaluation,
          integrationStatus: "native_records_created",
        },
      }),
    ],
    [
      "dataset id",
      (validReport: SearchEvalReport) => ({
        ...validReport,
        mastraEvaluation: {
          ...validReport.mastraEvaluation,
          dataset: {
            ...validReport.mastraEvaluation.dataset,
            datasetId: "dataset-1",
          },
        },
      }),
    ],
    [
      "scorer id",
      (validReport: SearchEvalReport) => ({
        ...validReport,
        mastraEvaluation: {
          ...validReport.mastraEvaluation,
          scorers: [
            {
              ...validReport.mastraEvaluation.scorers[0],
              scorerId: "scorer-1",
            },
          ],
        },
      }),
    ],
    [
      "experiment id",
      (validReport: SearchEvalReport) => ({
        ...validReport,
        mastraEvaluation: {
          ...validReport.mastraEvaluation,
          experiment: {
            ...validReport.mastraEvaluation.experiment,
            experimentId: "experiment-1",
          },
        },
      }),
    ],
    [
      "scorer status",
      (validReport: SearchEvalReport) => ({
        ...validReport,
        mastraEvaluation: {
          ...validReport.mastraEvaluation,
          scorers: [
            {
              ...validReport.mastraEvaluation.scorers[0],
              status: "registered",
            },
          ],
        },
      }),
    ],
    [
      "experiment status",
      (validReport: SearchEvalReport) => ({
        ...validReport,
        mastraEvaluation: {
          ...validReport.mastraEvaluation,
          experiment: {
            ...validReport.mastraEvaluation.experiment,
            status: "created",
          },
        },
      }),
    ],
    [
      "experiment mode",
      (validReport: SearchEvalReport) => ({
        ...validReport,
        mastraEvaluation: {
          ...validReport.mastraEvaluation,
          experiment: {
            ...validReport.mastraEvaluation.experiment,
            mode: "baseline_capture",
          },
        },
      }),
    ],
    [
      "experiment report id",
      (validReport: SearchEvalReport) => ({
        ...validReport,
        mastraEvaluation: {
          ...validReport.mastraEvaluation,
          experiment: {
            ...validReport.mastraEvaluation.experiment,
            reportId: "other-run",
          },
        },
      }),
    ],
    [
      "dataset item count",
      (validReport: SearchEvalReport) => ({
        ...validReport,
        mastraEvaluation: {
          ...validReport.mastraEvaluation,
          dataset: {
            ...validReport.mastraEvaluation.dataset,
            itemCount: 1,
          },
        },
      }),
    ],
  ] satisfies Array<[string, (validReport: SearchEvalReport) => unknown]>)(
    "rejects malformed native Evaluation %s metadata",
    async (_name, mutate) => {
      const store = createSearchEvalArtifactStore(rootDir)
      const validReport = report()

      await expect(
        store.writeReport(mutate(validReport) as SearchEvalReport),
      ).rejects.toMatchObject({
        code: "invalid_artifact",
      })
    },
  )

  it.each([
    [
      "raw query text",
      {
        queryText: "raw trace query",
        queryHash: null,
        results: [],
      },
    ],
    [
      "query hash",
      {
        queryText: "[redacted-trace-derived-query]",
        queryHash: "trace-query-hash",
        results: [],
      },
    ],
    [
      "results",
      {
        queryText: "[redacted-trace-derived-query]",
        queryHash: null,
        results: [
          {
            type: "video",
            id: "video-1",
            slug: "jesus",
            title: "JESUS",
            imageUrl: null,
            snippet: "raw-ish trace result",
            startSeconds: null,
            playbackId: null,
            score: 1,
            label: null,
            durationSeconds: null,
            childCount: null,
          },
        ],
      },
    ],
  ] satisfies Array<
    [string, Partial<SearchEvalReport["exploratoryGenerated"][number]>]
  >)(
    "rejects trace-derived report artifacts with %s",
    async (_name, partial) => {
      const store = createSearchEvalArtifactStore(rootDir)
      const validReport = report()

      await expect(
        store.writeReport({
          ...validReport,
          exploratoryGenerated: [
            {
              candidateId: "candidate-trace",
              locale: "en",
              source: "generated_trace",
              traceDerived: true,
              retentionExpiresAt: "2026-06-01T00:00:00.000Z",
              skippedReason: "trace_derived_not_judged_or_searched",
              ...partial,
            },
          ],
        }),
      ).rejects.toMatchObject({
        code: "invalid_artifact",
      })
    },
  )
})
