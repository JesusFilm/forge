#!/usr/bin/env tsx
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, resolve } from "node:path"

import { getTranscriptEmbeddingProviderConfig } from "../config/env"
import { runSearchEvalOrchestratorWorkflow as defaultRunSearchEvalOrchestratorWorkflow } from "../mastra/workflows/search-eval-orchestrator"
import {
  EXPECTED_AI_GATEWAY_EMBEDDING_NATIVE_DIMENSIONS,
  EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
  requestModelForEndpoint,
} from "../services/embedding-provider"
import { createSearchEvalArtifactStore as defaultCreateSearchEvalArtifactStore } from "../services/offline-search-eval/artifacts"
import {
  buildContentSearchEvalGateDocsReport as defaultBuildContentSearchEvalGateDocsReport,
  type ContentSearchEvalGateAdjudicationInput,
  type ContentSearchEvalGateDocsReport,
} from "../services/offline-search-eval/report"

function parseSingle(
  argv: readonly string[],
  name: string,
): string | undefined {
  const flag = `--${name}=`
  const arg = argv.find((item) => item.startsWith(flag))
  return arg ? arg.slice(flag.length) : undefined
}

function parseRepeated(argv: readonly string[], name: string): string[] {
  const flag = `--${name}=`
  return argv
    .filter((item) => item.startsWith(flag))
    .map((item) => item.slice(flag.length))
    .filter((value) => value.length > 0)
}

function parseFlag(argv: readonly string[], name: string): boolean {
  return argv.includes(`--${name}`)
}

function parseNumber(
  argv: readonly string[],
  name: string,
): number | undefined {
  const value = parseSingle(argv, name)
  if (value == null || value === "") return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`--${name} must be a number`)
  }
  return parsed
}

function parseHumanAdjudications(
  argv: readonly string[],
): ContentSearchEvalGateAdjudicationInput[] {
  const currentBetterCaseIds = parseRepeated(argv, "adjudicate-current-better")
  if (currentBetterCaseIds.length === 0) return []

  const reviewer = parseSingle(argv, "adjudication-reviewer")
  const reason =
    parseSingle(argv, "adjudication-reason") ??
    parseSingle(argv, "adjudication-note")
  const reviewedAt = parseSingle(argv, "adjudication-reviewed-at")

  if (!reviewer?.trim()) {
    throw new Error(
      "--adjudication-reviewer is required when adjudicating judge disagreements",
    )
  }
  if (!reason?.trim()) {
    throw new Error(
      "--adjudication-reason or --adjudication-note is required when adjudicating judge disagreements",
    )
  }
  if (reviewedAt && !Number.isFinite(Date.parse(reviewedAt))) {
    throw new Error("--adjudication-reviewed-at must be an ISO timestamp")
  }

  return currentBetterCaseIds.map((caseId) => ({
    caseId,
    acceptedOutcome: "current-better",
    reviewer,
    reason,
    ...(reviewedAt ? { reviewedAt } : {}),
  }))
}

export function resolveContentEmbeddingSearchEvalOutPath(
  reportId: string,
  argv: readonly string[],
  cwd = process.cwd(),
): string {
  const arg = parseSingle(argv, "out")
  const value = arg ?? `docs/search-eval-reports/${reportId}.json`
  return isAbsolute(value) ? value : resolve(cwd, value)
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8")
}

export function defaultContentEmbeddingProviderForGate(): ContentSearchEvalGateDocsReport["contentEmbeddingProvider"] {
  const providerConfig = getTranscriptEmbeddingProviderConfig()
  if (!providerConfig.apiKey?.trim()) {
    throw new Error(
      "AI_GATEWAY_EMBEDDINGS_API_KEY is required for the content embedding search-eval gate",
    )
  }
  const provenance = {
    provider: providerConfig.provider,
    model: providerConfig.model,
    requestModel: requestModelForEndpoint(
      providerConfig.model,
      providerConfig.baseUrl,
    ),
    nativeDimensions:
      providerConfig.expectedNativeDimensions ??
      EXPECTED_AI_GATEWAY_EMBEDDING_NATIVE_DIMENSIONS,
    finalDimensions:
      providerConfig.truncateToDimensions ??
      EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
    transformVersion: providerConfig.transformVersion ?? "",
  }

  if (
    provenance.provider !== "jesus-film-ai-gateway" ||
    provenance.model !== "embeddings" ||
    provenance.requestModel !== "embeddings" ||
    provenance.nativeDimensions !==
      EXPECTED_AI_GATEWAY_EMBEDDING_NATIVE_DIMENSIONS ||
    provenance.finalDimensions !== EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS ||
    provenance.transformVersion !== "matryoshka-truncate-1536-v1"
  ) {
    throw new Error(
      "content embedding search-eval gate must run against the Jesus Film AI Gateway embeddings provider",
    )
  }

  return provenance
}

type ContentEmbeddingSearchEvalDeps = {
  runSearchEvalOrchestratorWorkflow: typeof defaultRunSearchEvalOrchestratorWorkflow
  createSearchEvalArtifactStore: typeof defaultCreateSearchEvalArtifactStore
  buildContentSearchEvalGateDocsReport: typeof defaultBuildContentSearchEvalGateDocsReport
  contentEmbeddingProviderForGate: typeof defaultContentEmbeddingProviderForGate
  writeJson: typeof writeJson
  stdout: (line: string) => void
}

export async function runContentEmbeddingSearchEvalCli({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  deps = {
    runSearchEvalOrchestratorWorkflow: defaultRunSearchEvalOrchestratorWorkflow,
    createSearchEvalArtifactStore: defaultCreateSearchEvalArtifactStore,
    buildContentSearchEvalGateDocsReport:
      defaultBuildContentSearchEvalGateDocsReport,
    contentEmbeddingProviderForGate: defaultContentEmbeddingProviderForGate,
    writeJson,
    stdout: (line) => process.stdout.write(line),
  },
}: {
  argv?: readonly string[]
  cwd?: string
  deps?: ContentEmbeddingSearchEvalDeps
} = {}): Promise<number> {
  const baselineName =
    parseSingle(argv, "baseline-name") ?? "prod-seed-baseline-2026-06-02"
  const environmentLabel = parseSingle(argv, "environment-label")
  const runId = parseSingle(argv, "run-id")
  const nativeSync = parseFlag(argv, "native-sync")
  const locales = parseRepeated(argv, "locale")
  const humanAdjudications = parseHumanAdjudications(argv)

  const result = await deps.runSearchEvalOrchestratorWorkflow(
    {
      mode: "release-gate",
      baselineName,
      ...(locales.length > 0 ? { locales } : {}),
      nativeSync,
      syncPromoted: false,
      gateRequireAssignedJudge: true,
      gateRequireCalibration: true,
      gateMaxLosses: parseNumber(argv, "gate-max-losses") ?? 0,
      gateMaxSearchFailures: parseNumber(argv, "gate-max-search-failures") ?? 0,
      gateMaxJudgeFailures: parseNumber(argv, "gate-max-judge-failures") ?? 0,
      gateMaxJudgeDisagreements:
        parseNumber(argv, "gate-max-judge-disagreements") ?? 0,
      gateMinComparableQueries:
        parseNumber(argv, "gate-min-comparable-queries") ?? 1,
      gateMinNetWinRate: parseNumber(argv, "gate-min-net-win-rate") ?? 0,
      ...(environmentLabel ? { environmentLabel } : {}),
    },
    runId ? { runId } : {},
  )

  const reportId = result.summary.artifacts.reportId
  if (!reportId) {
    deps.stdout(
      JSON.stringify({
        event: "content-embedding-search-eval.no_report",
        ok: result.ok,
        reason: result.ok ? undefined : result.reason,
        mastraRunId: result.mastraRunId,
      }) + "\n",
    )
    return 1
  }

  const report = await deps.createSearchEvalArtifactStore().readReport(reportId)
  const docsReport = deps.buildContentSearchEvalGateDocsReport({
    mastraRunId: result.mastraRunId,
    report,
    contentEmbeddingProvider: deps.contentEmbeddingProviderForGate(),
    summary: result.summary,
    humanAdjudications,
  })
  const outPath = resolveContentEmbeddingSearchEvalOutPath(
    report.reportId,
    argv,
    cwd,
  )
  await deps.writeJson(outPath, docsReport)

  deps.stdout(
    JSON.stringify({
      event: "content-embedding-search-eval.report_written",
      ok: docsReport.gate.backfillReady,
      orchestratorOk: result.ok,
      backfillReady: docsReport.gate.backfillReady,
      reason: result.ok ? undefined : result.reason,
      mastraRunId: result.mastraRunId,
      reportId: report.reportId,
      judgeModel: docsReport.gate.judgeModel,
      outPath,
      adjudicatedJudgeDisagreements:
        docsReport.gate.adjudicatedJudgeDisagreements,
    }) + "\n",
  )

  if (!docsReport.gate.backfillReady) {
    return 1
  }
  return 0
}

async function main(): Promise<void> {
  process.exitCode = await runContentEmbeddingSearchEvalCli()
}

if (
  typeof process.argv[1] === "string" &&
  import.meta.url === `file://${process.argv[1]}`
) {
  main().catch((error) => {
    process.stderr.write(
      JSON.stringify({
        event: "content-embedding-search-eval.fatal",
        error: error instanceof Error ? error.message : String(error),
      }) + "\n",
    )
    process.exit(1)
  })
}
