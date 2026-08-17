import { describe, expect, it, vi } from "vitest"

import {
  SearchEvalArtifactError,
  type SearchEvalArtifactStore,
} from "./artifacts"
import { runOfflineSearchEval } from "./runner"
import type {
  BaselineArtifact,
  SearchEvalReport,
  SearchEvalResult,
} from "./types"

const result: SearchEvalResult = {
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

function memoryStore(): SearchEvalArtifactStore & {
  baselines: BaselineArtifact[]
  reports: SearchEvalReport[]
} {
  const baselines: BaselineArtifact[] = []
  const reports: SearchEvalReport[] = []
  return {
    rootDir: "/tmp/search-eval",
    baselines,
    reports,
    async writeBaseline(baseline) {
      baselines.push(baseline)
      return { path: `/tmp/search-eval/baselines/${baseline.name}.json` }
    },
    async writeBaselineCapture(baseline, report) {
      baselines.push(baseline)
      reports.push(report)
      return {
        baselinePath: `/tmp/search-eval/baselines/${baseline.name}.json`,
        reportPath: `/tmp/search-eval/reports/${report.reportId}.json`,
      }
    },
    async readBaseline(name) {
      throw new SearchEvalArtifactError(
        "not_found",
        `baseline '${name}' was not found`,
      )
    },
    async writeReport(report) {
      reports.push(report)
      return { path: `/tmp/search-eval/reports/${report.reportId}.json` }
    },
    async readReport(reportId) {
      throw new SearchEvalArtifactError(
        "not_found",
        `report '${reportId}' was not found`,
      )
    },
  }
}

describe("Serving baseline revision safety", () => {
  it("rejects a missing Serving revision before any write", async () => {
    const store = memoryStore()
    const outcome = await runOfflineSearchEval(
      { mode: "capture-baseline", baselineName: "default", locales: ["en"] },
      {
        runId: "run-missing-serving-revision",
        artifactStore: store,
        servingBearer: "serving-eval-key",
        servingUrl:
          "https://admin.internal/api/internal/search-eval/serving-search",
        searchClient: vi.fn(async () => ({
          ok: true as const,
          result: {
            results: [result],
            hasMore: false,
            query: "Jesus",
            searchMode: "hybrid" as const,
          },
        })),
      },
    )

    expect(outcome).toEqual({
      ok: false,
      reason: "admin_read_rejected",
      retryable: false,
      adminReason: "Serving search response omitted its revision",
    })
    expect(store.reports).toEqual([])
    expect(store.baselines).toEqual([])
  })

  it("rejects mixed Serving revisions before any write", async () => {
    const store = memoryStore()
    let searchCount = 0
    const outcome = await runOfflineSearchEval(
      { mode: "capture-baseline", baselineName: "default", locales: ["en"] },
      {
        runId: "run-mixed-serving-revision",
        artifactStore: store,
        servingBearer: "serving-eval-key",
        servingUrl:
          "https://admin.internal/api/internal/search-eval/serving-search",
        searchClient: vi.fn(async () => ({
          ok: true as const,
          result: {
            results: [result],
            hasMore: false,
            query: "Jesus",
            searchMode: "hybrid" as const,
            revision: searchCount++ === 0 ? "serving-a" : "serving-b",
          },
        })),
      },
    )

    expect(outcome).toEqual({
      ok: false,
      reason: "admin_read_rejected",
      retryable: false,
      adminReason: "Serving search responses used mixed revisions",
    })
    expect(store.reports).toEqual([])
    expect(store.baselines).toEqual([])
  })

  it("does not publish a baseline when the atomic capture fails", async () => {
    const store = memoryStore()
    store.writeBaselineCapture = vi.fn(async () => {
      throw new SearchEvalArtifactError("write_failed", "capture write failed")
    })

    const outcome = await runOfflineSearchEval(
      { mode: "capture-baseline", baselineName: "default", locales: ["en"] },
      {
        runId: "run-capture-write-failure",
        artifactStore: store,
        servingBearer: "serving-eval-key",
        servingUrl:
          "https://admin.internal/api/internal/search-eval/serving-search",
        searchClient: vi.fn(async () => ({
          ok: true as const,
          result: {
            results: [result],
            hasMore: false,
            query: "Jesus",
            searchMode: "hybrid" as const,
            revision: "serving-revision-write-fail",
          },
        })),
      },
    )

    expect(outcome).toEqual({
      ok: false,
      reason: "artifact_write_failed",
      retryable: true,
    })
    expect(store.reports).toEqual([])
    expect(store.baselines).toEqual([])
  })
})
