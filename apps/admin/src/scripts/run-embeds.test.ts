import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  RunEmbedsConfigError,
  extractContentBackfillGateFromReport,
  extractFailedSceneRetryTargetsFromReport,
  isLocalBackfillDatabaseUrl,
  loadContentBackfillGateReport,
  pipelineErrorDetails,
  pipelineErrorMessage,
  requiresContentBackfillGateReport,
  resolveGateReportPath,
  resolveReportInPath,
  resolveReportOutPath,
  runSceneBranch,
  writeReportToPath,
} from "./run-embeds"

// feat-119 PR1 — `--report-out=<path>` flag tests. The path-resolve
// helper is pure; the file-write helper is async + I/O-bound, so use a
// real tmp dir per-test to avoid cross-test races.

function validGateReport(reportId = "report-1") {
  return {
    schemaVersion: "1",
    kind: "content-search-eval-gate-report",
    exportedAt: "2026-06-03T00:00:00.000Z",
    contentEmbeddingProvider: {
      provider: "jesus-film-ai-gateway",
      model: "embeddings",
      requestModel: "embeddings",
      nativeDimensions: 4096,
      finalDimensions: 1536,
      transformVersion: "matryoshka-truncate-1536-v1",
    },
    gate: {
      backfillReady: true,
      reasons: [],
      mastraRunId: "run-1",
      reportId,
      baselineName: "prod-seed-baseline-2026-06-02",
      judgeModel: "anthropic/claude-haiku-4-5",
      passFailState: "passed",
      netWinRate: 0.25,
      queries: 8,
      comparableQueries: 8,
      losses: 0,
      searchFailures: 0,
      judgeFailures: 0,
      judgeDisagreements: 0,
      calibrationPassed: true,
      calibrationSkipped: false,
    },
    orchestratorSummary: {
      passFail: { state: "passed", reasons: [] },
    },
    searchEvalReport: {
      schemaVersion: "1",
      kind: "comparison-report",
      reportId,
      metadata: {
        baselineName: "prod-seed-baseline-2026-06-02",
        judgeModel: "anthropic/claude-haiku-4-5",
      },
      calibration: { passed: true, skipped: false },
      totals: {
        queries: 8,
        wins: 2,
        losses: 0,
        ties: 6,
        bothIrrelevant: 0,
        judgeDisagreements: 0,
        judgeFailures: 0,
        searchFailures: 0,
        netWinRate: 0.25,
      },
    },
  }
}

describe("resolveReportOutPath", () => {
  it("returns undefined when the arg is unset", () => {
    expect(resolveReportOutPath(undefined)).toBeUndefined()
  })

  it("returns undefined when the arg is the empty string", () => {
    // `--report-out=` (no value) should NOT be treated as a request to
    // write a file — guards against an operator typing the flag with
    // no value and getting a write to `cwd()`.
    expect(resolveReportOutPath("")).toBeUndefined()
  })

  it("returns absolute paths verbatim", () => {
    const abs = "/tmp/some/where/report.json"
    expect(resolveReportOutPath(abs)).toBe(abs)
  })

  it("anchors relative paths to process.cwd()", () => {
    const rel = ".tmp/report.json"
    expect(resolveReportOutPath(rel)).toBe(resolve(process.cwd(), rel))
  })

  it("anchors relative paths with parent traversal correctly", () => {
    const rel = "../sibling-report.json"
    const result = resolveReportOutPath(rel)
    expect(result).toBe(resolve(process.cwd(), rel))
    // Sanity: no double-slash, no preserved `..` segment.
    expect(result?.includes("..")).toBe(false)
  })
})

describe("resolveReportInPath", () => {
  it("returns undefined when unset or empty", () => {
    expect(resolveReportInPath(undefined)).toBeUndefined()
    expect(resolveReportInPath("")).toBeUndefined()
  })

  it("anchors relative paths to process.cwd()", () => {
    expect(resolveReportInPath(".tmp/report.json")).toBe(
      resolve(process.cwd(), ".tmp/report.json"),
    )
  })
})

describe("resolveGateReportPath", () => {
  it("returns undefined when unset or empty and anchors relative paths", () => {
    expect(resolveGateReportPath(undefined)).toBeUndefined()
    expect(resolveGateReportPath("")).toBeUndefined()
    expect(
      resolveGateReportPath("docs/search-eval-reports/run.json", "/repo"),
    ).toBe(resolve("/repo", "docs/search-eval-reports/run.json"))
  })

  it("rejects gate reports outside docs/search-eval-reports", () => {
    expect(() => resolveGateReportPath("/tmp/gate.json", "/repo")).toThrow(
      /docs\/search-eval-reports/,
    )
  })
})

describe("requiresContentBackfillGateReport", () => {
  it("requires no gate outside pipeline=all or when a gate report is already present", () => {
    expect(
      requiresContentBackfillGateReport({
        pipeline: "both",
        gateReportPath: undefined,
        allowUngatedLocalBackfill: false,
        nodeEnv: "production",
        databaseUrl: "postgresql://prod.example.com/forge_admin",
      }),
    ).toBe(false)
    expect(
      requiresContentBackfillGateReport({
        pipeline: "all",
        gateReportPath: "/repo/docs/search-eval-reports/report.json",
        allowUngatedLocalBackfill: false,
        nodeEnv: "production",
        databaseUrl: "postgresql://prod.example.com/forge_admin",
      }),
    ).toBe(false)
  })

  it("allows explicit ungated bypass only for local database targets outside production", () => {
    expect(
      isLocalBackfillDatabaseUrl(
        "postgresql://forge:forge@localhost:5433/forge_admin_test",
      ),
    ).toBe(true)
    expect(
      isLocalBackfillDatabaseUrl(
        "postgresql://forge:forge@db:5432/forge_admin_test",
      ),
    ).toBe(false)
    expect(
      isLocalBackfillDatabaseUrl(
        "postgresql://forge:forge@localhost:5433/forge_admin_prod",
      ),
    ).toBe(false)
    expect(
      isLocalBackfillDatabaseUrl("postgresql://prod.example.com/forge_admin"),
    ).toBe(false)

    expect(
      requiresContentBackfillGateReport({
        pipeline: "all",
        gateReportPath: undefined,
        allowUngatedLocalBackfill: true,
        nodeEnv: "development",
        databaseUrl: "postgresql://forge:forge@localhost:5433/forge_admin_test",
      }),
    ).toBe(false)
  })

  it("still requires a gate report for production or remote all-content targets", () => {
    expect(
      requiresContentBackfillGateReport({
        pipeline: "all",
        gateReportPath: undefined,
        allowUngatedLocalBackfill: true,
        nodeEnv: "production",
        databaseUrl: "postgresql://forge:forge@localhost:5433/forge_admin",
      }),
    ).toBe(true)
    expect(
      requiresContentBackfillGateReport({
        pipeline: "all",
        gateReportPath: undefined,
        allowUngatedLocalBackfill: true,
        nodeEnv: undefined,
        databaseUrl: "postgresql://prod.example.com/forge_admin",
      }),
    ).toBe(true)
    expect(
      requiresContentBackfillGateReport({
        pipeline: "all",
        gateReportPath: undefined,
        allowUngatedLocalBackfill: false,
        nodeEnv: "development",
        databaseUrl: "postgresql://forge:forge@localhost:5433/forge_admin",
      }),
    ).toBe(true)
  })
})

describe("extractContentBackfillGateFromReport", () => {
  const passingReport = validGateReport("report-1")

  it("extracts the backfill gate summary", () => {
    expect(extractContentBackfillGateFromReport(passingReport)).toEqual({
      reportId: "report-1",
      mastraRunId: "run-1",
      baselineName: "prod-seed-baseline-2026-06-02",
      judgeModel: "anthropic/claude-haiku-4-5",
      netWinRate: 0.25,
      comparableQueries: 8,
      contentEmbeddingProvider: {
        provider: "jesus-film-ai-gateway",
        model: "embeddings",
        requestModel: "embeddings",
        nativeDimensions: 4096,
        finalDimensions: 1536,
        transformVersion: "matryoshka-truncate-1536-v1",
      },
    })
  })

  it("rejects failed, unjudged, or non-comparable gate reports", () => {
    expect(() =>
      extractContentBackfillGateFromReport({
        ...passingReport,
        gate: {
          ...passingReport.gate,
          backfillReady: false,
          reasons: ["assigned judge model is required"],
        },
      }),
    ).toThrow(/not backfill-ready/)

    expect(() =>
      extractContentBackfillGateFromReport({
        ...passingReport,
        gate: { ...passingReport.gate, judgeModel: null },
      }),
    ).toThrow(/missing string judgeModel/)

    expect(() =>
      extractContentBackfillGateFromReport({
        ...passingReport,
        gate: { ...passingReport.gate, comparableQueries: 0 },
      }),
    ).toThrow(/quality metrics/)
  })

  it("accepts a gate with an auditable current-better judge-disagreement adjudication", () => {
    const reportId = "report-adjudicated"
    const report = {
      ...validGateReport(reportId),
      gate: {
        ...validGateReport(reportId).gate,
        netWinRate: 1,
        comparableQueries: 8,
        judgeDisagreements: 0,
        rawJudgeDisagreements: 1,
        adjudicatedJudgeDisagreements: 1,
        orchestratorPassFailState: "failed",
      },
      humanAdjudications: {
        judgeDisagreements: [
          {
            caseId: "seed-new-believer",
            locale: "en",
            acceptedOutcome: "current-better",
            reviewer: "search-quality-review",
            reason:
              "Current results include the exact course and related follow-up resources.",
            reviewedAt: "2026-06-03T00:00:00.000Z",
            rawOutcomeKind: "judge-disagreement",
          },
        ],
      },
      searchEvalReport: {
        ...validGateReport(reportId).searchEvalReport,
        totals: {
          ...validGateReport(reportId).searchEvalReport.totals,
          wins: 7,
          judgeDisagreements: 1,
          netWinRate: 1,
        },
        outcomes: [
          {
            kind: "judge-disagreement",
            caseId: "seed-new-believer",
            locale: "en",
          },
        ],
      },
    }

    expect(extractContentBackfillGateFromReport(report)).toMatchObject({
      reportId,
      netWinRate: 1,
      comparableQueries: 8,
    })
  })

  it("rejects adjudications that do not match a judge-disagreement outcome", () => {
    const report = {
      ...validGateReport("report-adjudication-mismatch"),
      gate: {
        ...validGateReport("report-adjudication-mismatch").gate,
        judgeDisagreements: 0,
        rawJudgeDisagreements: 1,
        adjudicatedJudgeDisagreements: 1,
      },
      humanAdjudications: {
        judgeDisagreements: [
          {
            caseId: "seed-new-believer",
            locale: "en",
            acceptedOutcome: "current-better",
            reviewer: "search-quality-review",
            reason: "Reviewed current results.",
            reviewedAt: "2026-06-03T00:00:00.000Z",
            rawOutcomeKind: "judge-disagreement",
          },
        ],
      },
      searchEvalReport: {
        ...validGateReport("report-adjudication-mismatch").searchEvalReport,
        totals: {
          ...validGateReport("report-adjudication-mismatch").searchEvalReport
            .totals,
          judgeDisagreements: 1,
        },
        outcomes: [
          {
            kind: "win",
            caseId: "seed-new-believer",
            locale: "en",
          },
        ],
      },
    }

    expect(() => extractContentBackfillGateFromReport(report)).toThrow(
      /does not match a judge-disagreement outcome/,
    )
  })
})

describe("extractFailedSceneRetryTargetsFromReport", () => {
  it("extracts and dedupes failed scene outcomes in deterministic order", () => {
    const report = {
      reports: {
        scene: {
          outcomes: [
            {
              status: "failed",
              locale: "es",
              target: {
                coreId: "core-b",
                videoEditionId: "edition-b",
                cmsVideoId: 2,
              },
            },
            {
              status: "failed",
              locale: "en",
              target: {
                coreId: "core-a",
                videoEditionId: "edition-a",
                cmsVideoId: 1,
              },
            },
            {
              status: "failed",
              locale: "en",
              target: {
                coreId: "core-a",
                videoEditionId: "edition-a",
                cmsVideoId: 1,
              },
            },
            {
              status: "skipped",
              locale: "fr",
              target: {
                coreId: "core-c",
                videoEditionId: "edition-c",
                cmsVideoId: 3,
              },
            },
          ],
        },
      },
    }

    expect(extractFailedSceneRetryTargetsFromReport(report)).toEqual([
      {
        coreId: "core-a",
        videoEditionId: "edition-a",
        locale: "en",
        cmsVideoId: 1,
      },
      {
        coreId: "core-b",
        videoEditionId: "edition-b",
        locale: "es",
        cmsVideoId: 2,
      },
    ])
  })

  it("throws a config error when the report is missing scene outcomes", () => {
    expect(() =>
      extractFailedSceneRetryTargetsFromReport({ reports: { scene: {} } }),
    ).toThrow(RunEmbedsConfigError)
  })

  it("throws a config error instead of skipping malformed failed scene outcomes", () => {
    expect(() =>
      extractFailedSceneRetryTargetsFromReport({
        reports: {
          scene: {
            outcomes: [
              {
                status: "failed",
                locale: "en",
                target: {
                  coreId: "core-a",
                  cmsVideoId: 1,
                },
              },
            ],
          },
        },
      }),
    ).toThrow(/reports\.scene\.outcomes\[0\].*videoEditionId/)
  })

  it("returns an empty retry set when there are no failed outcomes", () => {
    expect(
      extractFailedSceneRetryTargetsFromReport({
        reports: { scene: { outcomes: [{ status: "succeeded" }] } },
      }),
    ).toEqual([])
  })
})

describe("pipelineErrorDetails", () => {
  it("preserves scene retry selection details from stale retry errors", () => {
    const retrySelection = {
      requested: 2,
      matched: 1,
      unmatched: 1,
      unmatchedRetryTargets: [
        { coreId: "core-a", videoEditionId: "stale-edition", locale: "en" },
      ],
    }
    const error = Object.assign(new Error("Scene retry selector mismatch"), {
      retrySelection,
    })

    expect(pipelineErrorMessage(error)).toBe("Scene retry selector mismatch")
    expect(pipelineErrorDetails(error)).toEqual({ retrySelection })
  })

  it("ignores malformed retry selection details", () => {
    expect(
      pipelineErrorDetails({
        retrySelection: {
          requested: 1,
          matched: 0,
          unmatched: 1,
          unmatchedRetryTargets: [{ coreId: "core-a" }],
        },
      }),
    ).toBeUndefined()
  })
})

describe("runSceneBranch", () => {
  it("runs preflight with the retry sample asset before invoking the scene workflow", async () => {
    const writes: string[] = []
    const preflight = vi.fn(async () => ({
      ok: true,
      checks: [
        { name: "manager_artifact_storage", status: "passed", reason: "ok" },
      ],
    }))
    const runScene = vi.fn(async () => ({
      totalTargets: 1,
      succeeded: 1,
      skipped: 0,
      failed: 0,
      retrySelection: null,
      groupedFailures: [],
    }))

    const result = await runSceneBranch({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
      coreIds: [],
      locales: [],
      sceneRetryTargets: [
        {
          coreId: "core-a",
          videoEditionId: "edition-a",
          locale: "en",
          cmsVideoId: 123,
        },
      ],
      runManagerArtifactsPreflight: preflight,
      runSceneEmbeddingBackfill: runScene,
      writeStdout: (line) => writes.push(line),
    })

    expect(result.ok).toBe(true)
    expect(preflight).toHaveBeenCalledWith({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
      sampleSceneAssetId: 123,
    })
    expect(runScene).toHaveBeenCalledWith({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
      coreIds: undefined,
      locales: undefined,
      retryTargets: [
        {
          coreId: "core-a",
          videoEditionId: "edition-a",
          locale: "en",
          cmsVideoId: 123,
        },
      ],
      mode: undefined,
    })
    expect(writes.map((line) => JSON.parse(line).event)).toEqual([
      "run-embeds.scene.preflight",
      "run-embeds.scene.start",
      "run-embeds.scene.complete",
    ])
  })

  it("does not invoke the scene workflow when preflight fails", async () => {
    const writes: string[] = []
    const runScene = vi.fn()

    const result = await runSceneBranch({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
      coreIds: ["core-a"],
      locales: ["en"],
      sceneRetryTargets: undefined,
      runManagerArtifactsPreflight: vi.fn(async () => ({
        ok: false,
        checks: [
          {
            name: "manager_artifact_storage",
            status: "failed",
            reason: "dns_failed",
          },
        ],
      })),
      runSceneEmbeddingBackfill: runScene,
      writeStdout: (line) => writes.push(line),
    })

    expect(result).toEqual({
      ok: false,
      error: "scene preflight failed: manager_artifact_storage:dns_failed",
    })
    expect(runScene).not.toHaveBeenCalled()
    expect(writes.map((line) => JSON.parse(line).event)).toEqual([
      "run-embeds.scene.preflight",
      "run-embeds.scene.error",
    ])
  })

  it("preserves stale retry selection details from workflow errors", async () => {
    const retrySelection = {
      requested: 1,
      matched: 0,
      unmatched: 1,
      unmatchedRetryTargets: [
        { coreId: "core-a", videoEditionId: "stale-edition", locale: "en" },
      ],
    }

    const result = await runSceneBranch({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
      coreIds: [],
      locales: [],
      sceneRetryTargets: undefined,
      runManagerArtifactsPreflight: vi.fn(async () => ({
        ok: true,
        checks: [],
      })),
      runSceneEmbeddingBackfill: vi.fn(async () => {
        throw Object.assign(new Error("Scene retry selector mismatch"), {
          retrySelection,
        })
      }),
      writeStdout: () => undefined,
    })

    expect(result).toEqual({
      ok: false,
      error: "Scene retry selector mismatch",
      details: { retrySelection },
    })
  })

  it("passes scene overwrite mode through to the scene workflow branch", async () => {
    const writes: string[] = []
    const runScene = vi.fn(async () => ({
      totalTargets: 1,
      succeeded: 1,
      skipped: 0,
      failed: 0,
    }))

    await runSceneBranch({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
      coreIds: ["core-a"],
      locales: ["en"],
      sceneMode: "repair",
      sceneRetryTargets: undefined,
      runManagerArtifactsPreflight: vi.fn(async () => ({
        ok: true,
        checks: [],
      })),
      runSceneEmbeddingBackfill: runScene,
      writeStdout: (line) => writes.push(line),
    })

    expect(runScene).toHaveBeenCalledWith({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
      coreIds: ["core-a"],
      locales: ["en"],
      retryTargets: undefined,
      mode: "repair",
    })
    expect(JSON.parse(writes[1]!).mode).toBe("repair")
  })
})

describe("writeReportToPath", () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "run-embeds-test-"))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it("writes the JSON-stringified report to the path", async () => {
    const path = join(tmpDir, "report.json")
    const report = {
      event: "run-embeds.complete",
      pipeline: "scene",
      reports: {
        scene: { totalTargets: 3, succeeded: 3, missingArtifacts: [] },
      },
    }

    const result = await writeReportToPath(path, report)
    expect(result).toEqual({ ok: true })

    const written = await readFile(path, "utf8")
    // Trailing newline is part of the contract.
    expect(written.endsWith("\n")).toBe(true)
    expect(JSON.parse(written)).toEqual(report)
  })

  it("creates parent directories recursively when missing", async () => {
    const path = join(tmpDir, "nested", "deeper", "report.json")
    const report = { event: "run-embeds.complete", pipeline: "transcript" }

    const result = await writeReportToPath(path, report)
    expect(result).toEqual({ ok: true })

    const written = await readFile(path, "utf8")
    expect(JSON.parse(written)).toEqual(report)
  })

  it("returns ok:false with the error message when the path is invalid", async () => {
    // Inside the tmp dir, the parent we want to write into is itself
    // a regular FILE rather than a directory — so writing to
    // `<tmp>/notadir/inside.json` triggers ENOTDIR, which is a real
    // failure mode operators could hit if they mistype the path.
    const fileAsDir = join(tmpDir, "notadir")
    await import("node:fs/promises").then((fs) => fs.writeFile(fileAsDir, "x"))
    const path = join(fileAsDir, "inside.json")

    const result = await writeReportToPath(path, { event: "x" })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      // Assert the original errno token reaches the caller — guards
      // against a refactor that swallows the underlying error and
      // substitutes a generic placeholder. The exact code varies by
      // platform: macOS surfaces ENOTDIR ("not a directory"); Linux's
      // mkdir surfaces EEXIST ("file already exists, mkdir ...") when
      // the intermediate path component is a regular file. Either
      // token proves the original error provenance is preserved.
      expect(result.error).toMatch(/ENOTDIR|EEXIST|not a directory/i)
    }
  })

  it("preserves the report shape — operator can JSON.parse the file end-to-end", async () => {
    // PR2's `pnpm trigger-enrichment --from-report=<path>` will parse
    // this file. Lock in that the JSON shape round-trips exactly so
    // a future contract change here is a deliberate breaking choice.
    const path = join(tmpDir, "round-trip.json")
    const report = {
      event: "run-embeds.complete",
      pipeline: "both",
      wallClockMs: 12345,
      reports: {
        scene: {
          totalTargets: 12,
          succeeded: 10,
          skipped: 2,
          failed: 0,
          missingArtifacts: [
            { assetId: 790, coreId: "2_0-Crushing", kind: "scene-analysis" },
          ],
        },
        transcript: {
          totalTargets: 12,
          succeeded: 11,
          skipped: 1,
          failed: 0,
          missingArtifacts: [
            { assetId: 790, coreId: "2_0-Crushing", kind: "transcript" },
          ],
        },
      },
    }

    await writeReportToPath(path, report)
    const written = await readFile(path, "utf8")
    expect(JSON.parse(written)).toEqual(report)
  })

  it("loads a content backfill gate report from disk", async () => {
    const path = join(tmpDir, "docs", "search-eval-reports", "report-1.json")
    await writeReportToPath(path, validGateReport("report-1"))

    await expect(loadContentBackfillGateReport(path, tmpDir)).resolves.toEqual({
      reportId: "report-1",
      mastraRunId: "run-1",
      baselineName: "prod-seed-baseline-2026-06-02",
      judgeModel: "anthropic/claude-haiku-4-5",
      netWinRate: 0.25,
      comparableQueries: 8,
      contentEmbeddingProvider: {
        provider: "jesus-film-ai-gateway",
        model: "embeddings",
        requestModel: "embeddings",
        nativeDimensions: 4096,
        finalDimensions: 1536,
        transformVersion: "matryoshka-truncate-1536-v1",
      },
    })
  })

  it("rejects synthetic or mismatched content backfill gate reports", () => {
    expect(() =>
      extractContentBackfillGateFromReport({
        kind: "content-search-eval-gate-report",
        gate: {
          backfillReady: true,
          passFailState: "passed",
          calibrationPassed: true,
          calibrationSkipped: false,
          reportId: "report-1",
          mastraRunId: "run-1",
          judgeModel: "judge",
          netWinRate: 1,
          comparableQueries: 1,
        },
      }),
    ).toThrow(/schemaVersion/)

    expect(() =>
      extractContentBackfillGateFromReport({
        ...validGateReport("report-1"),
        contentEmbeddingProvider: {
          ...validGateReport("report-1").contentEmbeddingProvider,
          nativeDimensions: 1536,
        },
      }),
    ).toThrow(/contentEmbeddingProvider\.nativeDimensions/)

    expect(() =>
      extractContentBackfillGateFromReport(
        validGateReport("report-1"),
        join(tmpDir, "docs", "search-eval-reports", "other-report.json"),
      ),
    ).toThrow(/filename/)
  })
})
