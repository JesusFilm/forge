import { resolve } from "node:path"
import { describe, expect, it, vi } from "vitest"

import {
  resolveContentEmbeddingSearchEvalOutPath,
  runContentEmbeddingSearchEvalCli,
} from "./run-content-embedding-search-eval"

type CliDeps = NonNullable<
  NonNullable<Parameters<typeof runContentEmbeddingSearchEvalCli>[0]>["deps"]
>

function depsFor(input?: {
  workflowResult?: unknown
  docsReport?: unknown
  report?: unknown
}) {
  const workflowResult =
    input?.workflowResult ??
    ({
      ok: true,
      mastraRunId: "mastra-run-1",
      summary: {
        artifacts: { reportId: "report-1" },
        passFail: { state: "passed", reasons: [] },
      },
    } as const)
  const report = input?.report ?? { reportId: "report-1" }
  const docsReport =
    input?.docsReport ??
    ({
      kind: "content-search-eval-gate-report",
      gate: {
        backfillReady: true,
        judgeModel: "anthropic/claude-haiku-4-5",
      },
    } as const)

  const readReport = vi.fn(async () => report)
  const deps = {
    runSearchEvalOrchestratorWorkflow: vi.fn(async () => workflowResult),
    createSearchEvalArtifactStore: vi.fn(() => ({ readReport })),
    buildContentSearchEvalGateDocsReport: vi.fn(() => docsReport),
    contentEmbeddingProviderForGate: vi.fn(() => ({
      provider: "jesus-film-ai-gateway",
      model: "embeddings",
      requestModel: "embeddings",
      nativeDimensions: 1536,
      finalDimensions: 1536,
      transformVersion: null,
    })),
    writeJson: vi.fn(async () => undefined),
    stdout: vi.fn(),
  } as unknown as CliDeps
  return { deps, readReport }
}

describe("resolveContentEmbeddingSearchEvalOutPath", () => {
  it("defaults docs report output under docs/search-eval-reports", () => {
    expect(
      resolveContentEmbeddingSearchEvalOutPath("report-1", [], "/repo"),
    ).toBe(resolve("/repo", "docs/search-eval-reports/report-1.json"))
  })

  it("honors absolute and relative --out paths", () => {
    expect(
      resolveContentEmbeddingSearchEvalOutPath(
        "report-1",
        ["--out=/tmp/report.json"],
        "/repo",
      ),
    ).toBe("/tmp/report.json")
    expect(
      resolveContentEmbeddingSearchEvalOutPath(
        "report-1",
        ["--out=.tmp/report.json"],
        "/repo",
      ),
    ).toBe(resolve("/repo", ".tmp/report.json"))
  })
})

describe("runContentEmbeddingSearchEvalCli", () => {
  it("runs release-gate mode, writes the docs report, and returns success", async () => {
    const { deps, readReport } = depsFor()

    const exitCode = await runContentEmbeddingSearchEvalCli({
      argv: [
        "--baseline-name=baseline-1",
        "--environment-label=local",
        "--native-sync",
        "--run-id=run-override",
        "--locale=en",
        "--locale=es",
        "--gate-max-losses=2",
        "--gate-min-comparable-queries=4",
        "--gate-min-net-win-rate=0.25",
        "--adjudicate-current-better=seed-new-believer",
        "--adjudication-reviewer=search-quality-review",
        "--adjudication-note=Current list includes the exact course and related beginner resources.",
        "--out=.tmp/report.json",
      ],
      cwd: "/repo",
      deps,
    })

    expect(exitCode).toBe(0)
    expect(deps.runSearchEvalOrchestratorWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "release-gate",
        baselineName: "baseline-1",
        environmentLabel: "local",
        locales: ["en", "es"],
        nativeSync: true,
        gateRequireAssignedJudge: true,
        gateRequireCalibration: true,
        gateMaxLosses: 2,
        gateMinComparableQueries: 4,
        gateMinNetWinRate: 0.25,
      }),
      { runId: "run-override" },
    )
    expect(readReport).toHaveBeenCalledWith("report-1")
    expect(deps.contentEmbeddingProviderForGate).toHaveBeenCalled()
    expect(deps.buildContentSearchEvalGateDocsReport).toHaveBeenCalledWith(
      expect.objectContaining({
        contentEmbeddingProvider: expect.objectContaining({
          provider: "jesus-film-ai-gateway",
          nativeDimensions: 1536,
          finalDimensions: 1536,
        }),
        humanAdjudications: [
          {
            caseId: "seed-new-believer",
            acceptedOutcome: "current-better",
            reviewer: "search-quality-review",
            reason:
              "Current list includes the exact course and related beginner resources.",
          },
        ],
      }),
    )
    expect(deps.writeJson).toHaveBeenCalledWith(
      resolve("/repo", ".tmp/report.json"),
      expect.objectContaining({
        kind: "content-search-eval-gate-report",
      }),
    )
    expect(deps.stdout).toHaveBeenCalledWith(
      expect.stringContaining("content-embedding-search-eval.report_written"),
    )
  })

  it("returns failure without reading artifacts when no report is produced", async () => {
    const { deps, readReport } = depsFor({
      workflowResult: {
        ok: false,
        reason: "comparison report was not produced",
        mastraRunId: "mastra-run-1",
        summary: { artifacts: {} },
      },
    })

    const exitCode = await runContentEmbeddingSearchEvalCli({
      argv: [],
      deps,
    })

    expect(exitCode).toBe(1)
    expect(readReport).not.toHaveBeenCalled()
    expect(deps.writeJson).not.toHaveBeenCalled()
    expect(deps.stdout).toHaveBeenCalledWith(
      expect.stringContaining("content-embedding-search-eval.no_report"),
    )
  })

  it("writes blocked gate reports and returns failure", async () => {
    const { deps } = depsFor({
      docsReport: {
        kind: "content-search-eval-gate-report",
        gate: {
          backfillReady: false,
          judgeModel: "anthropic/claude-haiku-4-5",
        },
      },
    })

    const exitCode = await runContentEmbeddingSearchEvalCli({
      argv: [],
      cwd: "/repo",
      deps,
    })

    expect(exitCode).toBe(1)
    expect(deps.writeJson).toHaveBeenCalledWith(
      resolve("/repo", "docs/search-eval-reports/report-1.json"),
      expect.objectContaining({
        gate: expect.objectContaining({ backfillReady: false }),
      }),
    )
  })

  it("requires reviewer and reason for human adjudications", async () => {
    const { deps } = depsFor()

    await expect(
      runContentEmbeddingSearchEvalCli({
        argv: ["--adjudicate-current-better=seed-new-believer"],
        deps,
      }),
    ).rejects.toThrow(/--adjudication-reviewer/)
  })
})

describe("defaultContentEmbeddingProviderForGate", () => {
  it("requires the AI Gateway API key before stamping a backfill gate report", async () => {
    vi.resetModules()
    vi.stubEnv("MASTRA_CONTENT_EMBEDDINGS_PROVIDER_MODE", "gateway")
    vi.stubEnv("AI_GATEWAY_EMBEDDINGS_API_KEY", "")

    const module = await import("./run-content-embedding-search-eval")

    expect(() => module.defaultContentEmbeddingProviderForGate()).toThrow(
      /AI_GATEWAY_EMBEDDINGS_API_KEY is required/,
    )

    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("stamps the expected AI Gateway provider tuple when the key is configured", async () => {
    vi.resetModules()
    vi.stubEnv("MASTRA_CONTENT_EMBEDDINGS_PROVIDER_MODE", "gateway")
    vi.stubEnv("AI_GATEWAY_EMBEDDINGS_API_KEY", "gateway-key")

    const module = await import("./run-content-embedding-search-eval")

    expect(module.defaultContentEmbeddingProviderForGate()).toEqual({
      provider: "jesus-film-ai-gateway",
      model: "embeddings",
      requestModel: "embeddings",
      nativeDimensions: 1536,
      finalDimensions: 1536,
      transformVersion: null,
    })

    vi.unstubAllEnvs()
    vi.resetModules()
  })
})
