import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  SearchEvalArtifactError,
  createSearchEvalArtifactStore,
  type SearchEvalArtifactStore,
} from "./artifacts"
import {
  SEARCH_EVAL_BASELINE_PORTABILITY_SCHEMA_VERSION,
  checkSearchEvalBaselineReadiness,
  exportSearchEvalBaselineArtifact,
  importSearchEvalBaselineArtifact,
} from "./baseline-portability"
import { finalizeReport } from "./report"
import { SEARCH_EVAL_SEED_PROMPT_SET_VERSION } from "./seed-prompt-set"
import type {
  BaselineArtifact,
  SearchEvalReport,
  SearchEvalResult,
} from "./types"

let rootDir: string

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "forge-mastra-search-eval-portable-"))
})

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.resetModules()
  await rm(rootDir, { recursive: true, force: true })
})

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
        rationale: "Seed baseline snapshot.",
      },
    ],
    exploratoryGenerated: [],
  })
}

function generatedReport(): SearchEvalReport {
  const report = seedReport()
  return finalizeReport({
    ...report,
    exploratoryGenerated: [
      {
        candidateId: "candidate-1",
        locale: "en",
        source: "generated_catalog",
        traceDerived: false,
        queryText: "Jesus videos",
        queryHash: "hash-1",
        retentionExpiresAt: null,
        results: [],
      },
    ],
  })
}

async function exportedFixture() {
  const store = createSearchEvalArtifactStore(rootDir)
  await store.writeBaseline(baseline())
  await store.writeReport(seedReport())
  return exportSearchEvalBaselineArtifact({
    baselineName: "seed-baseline",
    reportIds: ["report-1"],
    options: {
      artifactStore: store,
      exportId: "export-1",
      now: () => new Date("2026-06-02T00:00:02.000Z"),
      sourceEnvironment: "production",
    },
  })
}

describe("search eval baseline portability service", () => {
  it("exports a seed-only baseline artifact with provenance", async () => {
    const exported = await exportedFixture()

    expect(exported.artifact).toMatchObject({
      schemaVersion: SEARCH_EVAL_BASELINE_PORTABILITY_SCHEMA_VERSION,
      kind: "search-eval-baseline-export",
      exportId: "export-1",
      exportedAt: "2026-06-02T00:00:02.000Z",
      sourceEnvironment: "production",
      baselineName: "seed-baseline",
      promptSetVersion: SEARCH_EVAL_SEED_PROMPT_SET_VERSION,
      reports: [{ reportId: "report-1" }],
    })
    expect(exported.audit).toMatchObject({
      action: "export-baseline",
      baselineName: "seed-baseline",
      reportIds: ["report-1"],
      result: "exported",
    })
    expect(exported.audit.artifactBytes).toBeGreaterThan(0)
  })

  it("imports reports before writing the baseline marker", async () => {
    const exported = await exportedFixture()
    const calls: string[] = []
    const artifactStore: SearchEvalArtifactStore = {
      rootDir,
      async readBaseline() {
        throw new Error("unused")
      },
      async readReport() {
        throw new Error("unused")
      },
      async writeReport(report) {
        calls.push(`report:${report.reportId}`)
        return { path: join(rootDir, "reports", `${report.reportId}.json`) }
      },
      async writeBaseline(input) {
        calls.push(`baseline:${input.name}`)
        return { path: join(rootDir, "baselines", `${input.name}.json`) }
      },
    }

    await expect(
      importSearchEvalBaselineArtifact({
        artifact: exported.artifact,
        options: { artifactStore },
      }),
    ).resolves.toMatchObject({
      baselineName: "seed-baseline",
      reportIds: ["report-1"],
    })
    expect(calls).toEqual(["report:report-1", "baseline:seed-baseline"])
  })

  it("does not activate the imported baseline when the marker write fails", async () => {
    const exported = await exportedFixture()
    const calls: string[] = []
    const artifactStore: SearchEvalArtifactStore = {
      rootDir,
      async readBaseline() {
        throw new Error("unused")
      },
      async readReport() {
        throw new Error("unused")
      },
      async writeReport(report) {
        calls.push(`report:${report.reportId}`)
        return { path: join(rootDir, "reports", `${report.reportId}.json`) }
      },
      async writeBaseline(input) {
        calls.push(`baseline:${input.name}`)
        throw new SearchEvalArtifactError(
          "write_failed",
          "failed to activate baseline",
        )
      },
    }

    await expect(
      importSearchEvalBaselineArtifact({
        artifact: exported.artifact,
        options: { artifactStore },
      }),
    ).rejects.toMatchObject({ code: "artifact_write_failed" })
    expect(calls).toEqual(["report:report-1", "baseline:seed-baseline"])
  })

  it("rejects exports that include generated-query data", async () => {
    const store = createSearchEvalArtifactStore(rootDir)
    await store.writeBaseline(baseline())
    await store.writeReport(generatedReport())

    await expect(
      exportSearchEvalBaselineArtifact({
        baselineName: "seed-baseline",
        reportIds: ["report-1"],
        options: { artifactStore: store },
      }),
    ).rejects.toMatchObject({ code: "not_seed_only" })
  })

  it("blocks production imports unless explicitly allowed", async () => {
    const exported = await exportedFixture()
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("MASTRA_SEARCH_EVAL_ALLOW_PROD_IMPORT", "false")
    vi.resetModules()
    const { importSearchEvalBaselineArtifact: importWithProdEnv } =
      await import("./baseline-portability")

    await expect(
      importWithProdEnv({
        artifact: exported.artifact,
        options: { artifactStore: createSearchEvalArtifactStore(rootDir) },
      }),
    ).rejects.toMatchObject({ code: "import_disabled" })
  })

  it("can explicitly override the production import guard", async () => {
    const exported = await exportedFixture()
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("MASTRA_SEARCH_EVAL_ALLOW_PROD_IMPORT", "false")
    vi.resetModules()
    const { importSearchEvalBaselineArtifact: importWithProdEnv } =
      await import("./baseline-portability")

    await expect(
      importWithProdEnv({
        artifact: exported.artifact,
        options: {
          allowProductionImport: true,
          artifactStore: createSearchEvalArtifactStore(rootDir),
        },
      }),
    ).resolves.toMatchObject({
      baselineName: "seed-baseline",
      reportIds: ["report-1"],
    })
  })

  it("probes the configured artifact root during readiness checks", async () => {
    const readiness = await checkSearchEvalBaselineReadiness({
      artifactRoot: rootDir,
    })

    expect(readiness.checks).toContainEqual({
      name: "artifact_store_probe",
      status: "pass",
    })
  })

  it("passes production readiness when search, auth, storage, and artifacts are configured", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv(
      "ADMIN_SEARCH_EVAL_SEARCH_URL",
      "https://admin.internal/api/internal/search-eval/search",
    )
    vi.stubEnv("ADMIN_SEARCH_EVAL_API_KEY", "search-key")
    vi.stubEnv("MASTRA_SERVICE_API_KEYS", "service-key")
    vi.stubEnv("MASTRA_STORAGE_BACKEND", "postgres")
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://postgres:postgres@localhost:5432/forge_mastra_gateway",
    )
    vi.stubEnv("MASTRA_SEARCH_EVAL_ARTIFACT_DIR", rootDir)
    vi.resetModules()
    const { checkSearchEvalBaselineReadiness: checkWithProdEnv } =
      await import("./baseline-portability")

    await expect(
      checkWithProdEnv({ artifactRoot: rootDir }),
    ).resolves.toMatchObject({
      ok: true,
      artifactRoot: rootDir,
    })
  })
})
