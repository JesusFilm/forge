import { spawnSync } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  extractContentBackfillGateFromReport,
  isLocalBackfillDatabaseUrl,
  loadContentBackfillGateReport,
  requiresContentBackfillGateReport,
  resolveGateReportPath,
  resolveReportOutPath,
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
      nativeDimensions: 1536,
      finalDimensions: 1536,
      transformVersion: null,
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

function runCli(args: string[]) {
  return spawnSync(
    "pnpm",
    ["exec", "tsx", "src/scripts/run-embeds.ts", ...args],
    {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL:
          "postgresql://forge:forge@localhost:5433/forge_admin_test",
      },
    },
  )
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

describe("run-embeds CLI retired scene arguments", () => {
  it("rejects pipeline=scene at the entrypoint", () => {
    const result = runCli(["--pipeline=scene"])

    expect(result.status, result.stderr).toBe(2)
    expect(result.stderr).toContain("invalid --pipeline=scene")
  })

  it("rejects --scene-mode at the entrypoint", () => {
    const result = runCli([
      "--pipeline=transcript",
      "--scene-mode=model-upgrade",
    ])

    expect(result.status, result.stderr).toBe(2)
    expect(result.stderr).toContain("--scene-mode is no longer supported")
    expect(result.stderr).toContain(
      "scene embedding backfills have been retired",
    )
  })

  it("rejects --from-report at the entrypoint", () => {
    const result = runCli([
      "--pipeline=transcript",
      "--from-report=.tmp/scene-report.json",
    ])

    expect(result.status, result.stderr).toBe(2)
    expect(result.stderr).toContain("--from-report is no longer supported")
    expect(result.stderr).toContain(
      "scene embedding backfills have been retired",
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
        nativeDimensions: 1536,
        finalDimensions: 1536,
        transformVersion: null,
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
      pipeline: "transcript",
      reports: {
        transcript: { totalTargets: 3, succeeded: 3, missingArtifacts: [] },
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
    // Lock in that the JSON shape round-trips exactly so a future
    // contract change here is a deliberate breaking choice.
    const path = join(tmpDir, "round-trip.json")
    const report = {
      event: "run-embeds.complete",
      pipeline: "all",
      wallClockMs: 12345,
      reports: {
        transcript: {
          totalTargets: 12,
          succeeded: 11,
          skipped: 1,
          failed: 0,
          missingArtifacts: [
            { assetId: 790, coreId: "2_0-Crushing", kind: "transcript" },
          ],
        },
        experience: {
          totalTargets: 4,
          succeeded: 4,
          skipped: 0,
          failed: 0,
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
        nativeDimensions: 1536,
        finalDimensions: 1536,
        transformVersion: null,
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
          nativeDimensions: 1024,
        },
      }),
    ).toThrow(/contentEmbeddingProvider\.nativeDimensions/)

    expect(() =>
      extractContentBackfillGateFromReport({
        ...validGateReport("report-1"),
        contentEmbeddingProvider: {
          ...validGateReport("report-1").contentEmbeddingProvider,
          nativeDimensions: 4096,
          transformVersion: "matryoshka-truncate-1536-v1",
        },
      }),
    ).toThrow(/contentEmbeddingProvider\.nativeDimensions/)

    expect(() =>
      extractContentBackfillGateFromReport({
        ...validGateReport("report-1"),
        contentEmbeddingProvider: {
          ...validGateReport("report-1").contentEmbeddingProvider,
          transformVersion: "matryoshka-truncate-1536-v1",
        },
      }),
    ).toThrow(/contentEmbeddingProvider\.transformVersion/)

    expect(() =>
      extractContentBackfillGateFromReport(
        validGateReport("report-1"),
        join(tmpDir, "docs", "search-eval-reports", "other-report.json"),
      ),
    ).toThrow(/filename/)
  })
})
