#!/usr/bin/env tsx
/**
 * Run transcript and/or experience embedding backfills from a
 * workstation against any DATABASE_URL.
 *
 * Bypasses the GraphQL `triggerTranscriptEmbeddingBackfill` /
 * `triggerExperienceEmbeddingBackfill` mutations (which are
 * ADMIN-gated and dispatch via the useworkflow runtime). Calls the
 * workflow functions directly with the in-process Prisma singleton
 * — same pattern apps/admin/src/scripts/run-sync.ts uses for
 * `runSync()`.
 *
 * Usage:
 *   DATABASE_URL='postgresql://forge:forge@db:5432/forge_admin' \
 *   MANAGER_ARTIFACTS_S3_ENDPOINT=... \
 *   MANAGER_ARTIFACTS_S3_REGION=... \
 *   MANAGER_ARTIFACTS_S3_BUCKET=... \
 *   MANAGER_ARTIFACTS_S3_ACCESS_KEY_ID=... \
 *   MANAGER_ARTIFACTS_S3_SECRET_ACCESS_KEY=... \
 *   MASTRA_BASE_URL=...
 *   MASTRA_SERVICE_API_KEY=...
 *   pnpm --filter @forge/admin run-embeds --pipeline=transcript
 *
 *   # Filters (all optional, repeatable):
 *   --pipeline=transcript|experience|both|all           # required
 *                                                       # `both` = transcript (legacy alias)
 *                                                       # `all` = transcript + experience
 *   --mapping-key=admin-migrations/core-id-mapping.json # transcript default
 *   --core-id=<id>                                      # transcript filter (repeatable)
 *   --locale=<bcp47>                                    # experience pipeline filter (repeatable)
 *   --language=<bcp47>                                  # transcript pipeline filter (repeatable)
 *   --transcript-mode=idempotent|repair|force|model-upgrade
 *   --experience-mode=idempotent|repair|force|model-upgrade
 *   --experience-id=<cuid>                              # experience pipeline filter (repeatable)
 *   --force                                             # experience pipeline only — re-embed
 *                                                       # rows that already have a non-NULL embedding
 *   --report-out=<path>                                 # optional; dump final report JSON
 *   --gate-report=<path>                                # required for --pipeline=all
 *
 * The mapping snapshot must already exist at the configured S3 key
 * (or the local-fallback path when RAILWAY_S3_BUCKET is unset).
 * Run `pnpm --filter @forge/admin pull:mapping` first to populate
 * it from prod admin S3.
 *
 * `--report-out=<path>` writes the final `run-embeds.complete` JSON
 * payload to a file in addition to stdout, so PR2's
 * `pnpm trigger-enrichment --from-report=<path>` (feat-119) has a
 * stable input format. Stdout output is unchanged.
 *
 * **Structured stdout/stderr events emitted (single grep target for
 * CI parsers and downstream tooling):**
 *
 *   stdout:
 *     - `run-embeds.start` — one line at startup with resolved config
 *     - `run-embeds.transcript.start`      (pipeline=transcript|both|all)
 *     - `run-embeds.transcript.complete`   (pipeline=transcript|both|all)
 *     - `run-embeds.transcript.error`      (pipeline=transcript|both|all, on error)
 *     - `run-embeds.experience.start`      (pipeline=experience|all)
 *     - `run-embeds.experience.complete`   (pipeline=experience|all)
 *     - `run-embeds.experience.error`      (pipeline=experience|all, on error)
 *     - `run-embeds.experience.skipped`    (pipeline=both — legacy transcript-only alias;
 *                                           experience is explicitly omitted)
 *     - `run-embeds.complete` — final aggregated report (pretty-printed JSON)
 *     - `run-embeds.report_out_written` — when --report-out succeeded
 *
 *   stderr:
 *     - `run-embeds.report_out_error` — write-to-file failed (NON-fatal)
 *     - `run-embeds.interrupted` — SIGINT/SIGTERM received
 *     - `run-embeds.fatal` — unhandled error in main()
 *
 * NOT run against prod by default — operator must set DATABASE_URL
 * explicitly. Local DB is the destination; the CLI does no safety
 * check beyond the explicit env var (mirrors run-sync.ts).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises"
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
} from "node:path"
import { DEFAULT_CORE_ID_MAPPING_S3_KEY } from "@/services/core-id-mapping.constants"

/**
 * Resolve a `--report-out=<path>` argument to an absolute path, or
 * `undefined` if not set. Bare relative paths are anchored to
 * `process.cwd()` (matches how an operator naturally types
 * `--report-out=.tmp/report.json` from the repo root).
 *
 * Exported for tests; used internally by `main()`.
 */
export function resolveReportOutPath(
  arg: string | undefined,
): string | undefined {
  if (arg === undefined || arg === "") return undefined
  return isAbsolute(arg) ? arg : resolve(process.cwd(), arg)
}

/**
 * Write the final `run-embeds.complete` JSON to disk. Creates parent
 * directories as needed. On failure, logs a structured
 * `run-embeds.report_out_error` event to stderr but does NOT throw —
 * the report is already on stdout, so a side-channel write failure
 * (ENOSPC, EACCES, broken path) is a logging concern, not a workflow
 * outcome. PR2's `pnpm trigger-enrichment --from-report=<path>`
 * (feat-119) consumes the file format produced here.
 *
 * Exported for tests.
 */
export async function writeReportToPath(
  reportOutPath: string,
  finalReport: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await mkdir(dirname(reportOutPath), { recursive: true })
    await writeFile(reportOutPath, JSON.stringify(finalReport, null, 2) + "\n")
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export class RunEmbedsConfigError extends Error {
  constructor(
    message: string,
    readonly exitCode: 2 = 2,
  ) {
    super(message)
    this.name = "RunEmbedsConfigError"
  }
}

export type ContentBackfillGateSummary = {
  reportId: string
  mastraRunId: string
  baselineName: string
  judgeModel: string
  netWinRate: number
  comparableQueries: number
  contentEmbeddingProvider: {
    provider: string
    model: string
    requestModel: string
    nativeDimensions: number
    finalDimensions: number
    transformVersion: string | null
  }
}

export type EmbeddingBackfillMode =
  | "idempotent"
  | "repair"
  | "force"
  | "model-upgrade"

const EXPECTED_CONTENT_GATE_NATIVE_DIMENSIONS = 1536
const EXPECTED_CONTENT_GATE_FINAL_DIMENSIONS = 1536
const EXPECTED_CONTENT_GATE_TRANSFORM_VERSION =
  EXPECTED_CONTENT_GATE_NATIVE_DIMENSIONS ===
  EXPECTED_CONTENT_GATE_FINAL_DIMENSIONS
    ? null
    : "matryoshka-truncate-1536-v1"

const EXPECTED_CONTENT_GATE_PROVIDER = {
  provider: "jesus-film-ai-gateway",
  model: "embeddings",
  requestModel: "embeddings",
  nativeDimensions: EXPECTED_CONTENT_GATE_NATIVE_DIMENSIONS,
  finalDimensions: EXPECTED_CONTENT_GATE_FINAL_DIMENSIONS,
  transformVersion: EXPECTED_CONTENT_GATE_TRANSFORM_VERSION,
} as const

const GATE_REPORT_SECRET_STRING_PATTERN =
  /(?:Bearer\s+[A-Za-z0-9._~-]+|sk-[A-Za-z0-9_-]{8,}|https?:\/\/[^/?#\s]+:[^/?#\s]+@|[?&](?:api[_-]?key|access[_-]?token|token|key|secret|password)=|\b\d{1,3}(?:\.\d{1,3}){3}\b)/i

function gateReportField(value: Record<string, unknown>, key: string): unknown {
  return value[key]
}

function gateReportRecord(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const field = gateReportField(value, key)
  if (!field || typeof field !== "object" || Array.isArray(field)) {
    throw new RunEmbedsConfigError(`[run-embeds] --gate-report missing ${key}`)
  }
  return field as Record<string, unknown>
}

function assertGateReportHasNoSecretStrings(value: unknown): void {
  const check = (input: unknown): void => {
    if (typeof input === "string") {
      if (GATE_REPORT_SECRET_STRING_PATTERN.test(input)) {
        throw new RunEmbedsConfigError(
          "[run-embeds] --gate-report contains a prohibited secret-like string",
        )
      }
      return
    }
    if (Array.isArray(input)) {
      input.forEach(check)
      return
    }
    if (input && typeof input === "object") {
      Object.values(input).forEach(check)
    }
  }
  check(value)
}

function finiteNumberField(
  value: Record<string, unknown>,
  key: string,
): number {
  const field = gateReportField(value, key)
  if (typeof field !== "number" || !Number.isFinite(field)) {
    throw new RunEmbedsConfigError(
      `[run-embeds] --gate-report missing numeric ${key}`,
    )
  }
  return field
}

function optionalFiniteNumberField(
  value: Record<string, unknown>,
  key: string,
): number | undefined {
  const field = gateReportField(value, key)
  if (field === undefined) return undefined
  if (typeof field !== "number" || !Number.isFinite(field)) {
    throw new RunEmbedsConfigError(
      `[run-embeds] --gate-report ${key} must be numeric when present`,
    )
  }
  return field
}

function stringField(value: Record<string, unknown>, key: string): string {
  const field = gateReportField(value, key)
  if (typeof field !== "string" || field.length === 0) {
    throw new RunEmbedsConfigError(
      `[run-embeds] --gate-report missing string ${key}`,
    )
  }
  return field
}

function nullableStringField(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const field = gateReportField(value, key)
  if (field === null) return null
  if (typeof field !== "string" || field.length === 0) {
    throw new RunEmbedsConfigError(
      `[run-embeds] --gate-report missing string or null ${key}`,
    )
  }
  return field
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-12
}

function validateContentEmbeddingProvider(
  provider: Record<string, unknown>,
): ContentBackfillGateSummary["contentEmbeddingProvider"] {
  const actual = {
    provider: stringField(provider, "provider"),
    model: stringField(provider, "model"),
    requestModel: stringField(provider, "requestModel"),
    nativeDimensions: finiteNumberField(provider, "nativeDimensions"),
    finalDimensions: finiteNumberField(provider, "finalDimensions"),
    transformVersion: nullableStringField(provider, "transformVersion"),
  }
  for (const [key, expected] of Object.entries(
    EXPECTED_CONTENT_GATE_PROVIDER,
  )) {
    if (actual[key as keyof typeof actual] !== expected) {
      throw new RunEmbedsConfigError(
        `[run-embeds] --gate-report contentEmbeddingProvider.${key} does not match the AI Gateway migration contract`,
      )
    }
  }
  return actual
}

function validateHumanJudgeDisagreementAdjudications(args: {
  report: Record<string, unknown>
  searchEvalReport: Record<string, unknown>
  expectedCount: number
}): number {
  if (!Number.isInteger(args.expectedCount) || args.expectedCount < 0) {
    throw new RunEmbedsConfigError(
      "[run-embeds] --gate-report adjudicatedJudgeDisagreements must be a non-negative integer",
    )
  }
  if (args.expectedCount === 0) return 0

  const humanAdjudications = gateReportField(args.report, "humanAdjudications")
  if (
    !humanAdjudications ||
    typeof humanAdjudications !== "object" ||
    Array.isArray(humanAdjudications)
  ) {
    throw new RunEmbedsConfigError(
      "[run-embeds] --gate-report missing humanAdjudications for adjudicated judge disagreements",
    )
  }

  const judgeDisagreements = gateReportField(
    humanAdjudications as Record<string, unknown>,
    "judgeDisagreements",
  )
  if (!Array.isArray(judgeDisagreements)) {
    throw new RunEmbedsConfigError(
      "[run-embeds] --gate-report missing humanAdjudications.judgeDisagreements",
    )
  }
  if (judgeDisagreements.length !== args.expectedCount) {
    throw new RunEmbedsConfigError(
      "[run-embeds] --gate-report adjudicatedJudgeDisagreements does not match humanAdjudications",
    )
  }

  const outcomes = gateReportField(args.searchEvalReport, "outcomes")
  if (!Array.isArray(outcomes)) {
    throw new RunEmbedsConfigError(
      "[run-embeds] --gate-report searchEvalReport missing outcomes for adjudication validation",
    )
  }
  const disagreementKeys = new Set<string>()
  for (const outcome of outcomes) {
    if (!outcome || typeof outcome !== "object" || Array.isArray(outcome)) {
      continue
    }
    const record = outcome as Record<string, unknown>
    if (record.kind !== "judge-disagreement") continue
    const caseId = gateReportField(record, "caseId")
    const locale = gateReportField(record, "locale")
    if (typeof caseId === "string" && typeof locale === "string") {
      disagreementKeys.add(`${caseId}\0${locale}`)
    }
  }

  const seen = new Set<string>()
  for (const [index, adjudication] of judgeDisagreements.entries()) {
    if (
      !adjudication ||
      typeof adjudication !== "object" ||
      Array.isArray(adjudication)
    ) {
      throw new RunEmbedsConfigError(
        `[run-embeds] --gate-report humanAdjudications.judgeDisagreements[${index}] must be an object`,
      )
    }
    const record = adjudication as Record<string, unknown>
    const caseId = stringField(record, "caseId")
    const locale = stringField(record, "locale")
    const reviewer = stringField(record, "reviewer")
    const reason = stringField(record, "reason")
    const reviewedAt = stringField(record, "reviewedAt")
    if (reviewer.trim() !== reviewer || reason.trim() !== reason) {
      throw new RunEmbedsConfigError(
        "[run-embeds] --gate-report adjudication reviewer and reason must be trimmed non-empty strings",
      )
    }
    if (!Number.isFinite(Date.parse(reviewedAt))) {
      throw new RunEmbedsConfigError(
        "[run-embeds] --gate-report adjudication reviewedAt must be an ISO timestamp",
      )
    }
    if (record.acceptedOutcome !== "current-better") {
      throw new RunEmbedsConfigError(
        "[run-embeds] --gate-report only current-better judge-disagreement adjudications are accepted",
      )
    }
    if (record.rawOutcomeKind !== "judge-disagreement") {
      throw new RunEmbedsConfigError(
        "[run-embeds] --gate-report adjudications must cover judge-disagreement outcomes",
      )
    }

    const key = `${caseId}\0${locale}`
    if (seen.has(key)) {
      throw new RunEmbedsConfigError(
        "[run-embeds] --gate-report duplicate judge-disagreement adjudication",
      )
    }
    seen.add(key)
    if (!disagreementKeys.has(key)) {
      throw new RunEmbedsConfigError(
        "[run-embeds] --gate-report adjudication does not match a judge-disagreement outcome",
      )
    }
  }

  return judgeDisagreements.length
}

export function extractContentBackfillGateFromReport(
  report: unknown,
  reportPath?: string,
): ContentBackfillGateSummary {
  if (!report || typeof report !== "object") {
    throw new RunEmbedsConfigError(
      "[run-embeds] --gate-report is not an object",
    )
  }
  const record = report as Record<string, unknown>
  assertGateReportHasNoSecretStrings(record)
  if (record.schemaVersion !== "1") {
    throw new RunEmbedsConfigError(
      "[run-embeds] --gate-report schemaVersion must be 1",
    )
  }
  if (record.kind !== "content-search-eval-gate-report") {
    throw new RunEmbedsConfigError(
      "[run-embeds] --gate-report must be a content-search-eval-gate-report",
    )
  }
  if (
    typeof record.exportedAt !== "string" ||
    !Number.isFinite(Date.parse(record.exportedAt))
  ) {
    throw new RunEmbedsConfigError(
      "[run-embeds] --gate-report exportedAt must be an ISO timestamp",
    )
  }
  const contentEmbeddingProvider = validateContentEmbeddingProvider(
    gateReportRecord(record, "contentEmbeddingProvider"),
  )
  const g = gateReportRecord(record, "gate")
  const searchEvalReport = gateReportRecord(record, "searchEvalReport")
  const searchEvalMetadata = gateReportRecord(searchEvalReport, "metadata")
  const searchEvalTotals = gateReportRecord(searchEvalReport, "totals")
  const searchEvalCalibration = gateReportRecord(
    searchEvalReport,
    "calibration",
  )
  gateReportRecord(record, "orchestratorSummary")
  const reasons = gateReportField(g, "reasons")
  if (g.backfillReady !== true) {
    throw new RunEmbedsConfigError(
      `[run-embeds] --gate-report is not backfill-ready: ${
        Array.isArray(reasons) ? reasons.join(", ") : "unknown reason"
      }`,
    )
  }
  if (g.passFailState !== "passed") {
    throw new RunEmbedsConfigError(
      "[run-embeds] --gate-report passFailState must be passed",
    )
  }
  if (g.calibrationPassed !== true || g.calibrationSkipped !== false) {
    throw new RunEmbedsConfigError(
      "[run-embeds] --gate-report requires non-skipped passing calibration",
    )
  }
  const reportId = stringField(g, "reportId")
  const mastraRunId = stringField(g, "mastraRunId")
  const baselineName = stringField(g, "baselineName")
  const judgeModel = stringField(g, "judgeModel")
  const netWinRate = finiteNumberField(g, "netWinRate")
  const queries = finiteNumberField(g, "queries")
  const comparableQueries = finiteNumberField(g, "comparableQueries")
  const losses = finiteNumberField(g, "losses")
  const searchFailures = finiteNumberField(g, "searchFailures")
  const judgeFailures = finiteNumberField(g, "judgeFailures")
  const judgeDisagreements = finiteNumberField(g, "judgeDisagreements")
  const rawJudgeDisagreements =
    optionalFiniteNumberField(g, "rawJudgeDisagreements") ?? judgeDisagreements
  const adjudicatedJudgeDisagreements =
    optionalFiniteNumberField(g, "adjudicatedJudgeDisagreements") ?? 0
  const adjudicatedCurrentWins = validateHumanJudgeDisagreementAdjudications({
    report: record,
    searchEvalReport,
    expectedCount: adjudicatedJudgeDisagreements,
  })
  if (netWinRate < 0 || comparableQueries <= 0 || queries <= 0) {
    throw new RunEmbedsConfigError(
      "[run-embeds] --gate-report quality metrics do not permit all-content backfill",
    )
  }
  if (
    losses !== 0 ||
    searchFailures !== 0 ||
    judgeFailures !== 0 ||
    judgeDisagreements !== 0
  ) {
    throw new RunEmbedsConfigError(
      "[run-embeds] --gate-report must have zero losses, search failures, judge failures, and unadjudicated judge disagreements",
    )
  }
  if (searchEvalReport.kind !== "comparison-report") {
    throw new RunEmbedsConfigError(
      "[run-embeds] --gate-report searchEvalReport must be a comparison-report",
    )
  }
  const searchEvalWins = finiteNumberField(searchEvalTotals, "wins")
  const searchEvalJudgeDisagreements = finiteNumberField(
    searchEvalTotals,
    "judgeDisagreements",
  )
  if (
    rawJudgeDisagreements !== searchEvalJudgeDisagreements ||
    rawJudgeDisagreements - adjudicatedJudgeDisagreements !==
      judgeDisagreements ||
    adjudicatedCurrentWins !== adjudicatedJudgeDisagreements
  ) {
    throw new RunEmbedsConfigError(
      "[run-embeds] --gate-report adjudicated judge-disagreement counts do not match searchEvalReport",
    )
  }
  if (
    searchEvalReport.reportId !== reportId ||
    searchEvalMetadata.baselineName !== baselineName ||
    searchEvalMetadata.judgeModel !== judgeModel ||
    finiteNumberField(searchEvalTotals, "queries") !== queries ||
    finiteNumberField(searchEvalTotals, "losses") !== losses ||
    finiteNumberField(searchEvalTotals, "searchFailures") !== searchFailures ||
    finiteNumberField(searchEvalTotals, "judgeFailures") !== judgeFailures ||
    searchEvalCalibration.passed !== true ||
    searchEvalCalibration.skipped !== false
  ) {
    throw new RunEmbedsConfigError(
      "[run-embeds] --gate-report gate fields do not match searchEvalReport",
    )
  }
  const bothIrrelevant = finiteNumberField(searchEvalTotals, "bothIrrelevant")
  const computedComparable =
    queries -
    bothIrrelevant -
    searchFailures -
    judgeDisagreements -
    judgeFailures
  if (computedComparable !== comparableQueries) {
    throw new RunEmbedsConfigError(
      "[run-embeds] --gate-report comparableQueries does not match searchEvalReport totals",
    )
  }
  const computedNetWinRate =
    comparableQueries > 0
      ? (searchEvalWins + adjudicatedCurrentWins - losses) / comparableQueries
      : 0
  if (!nearlyEqual(computedNetWinRate, netWinRate)) {
    throw new RunEmbedsConfigError(
      "[run-embeds] --gate-report netWinRate does not match effective searchEvalReport totals",
    )
  }
  if (reportPath && basename(reportPath) !== `${reportId}.json`) {
    throw new RunEmbedsConfigError(
      "[run-embeds] --gate-report filename must match gate.reportId",
    )
  }
  return {
    reportId,
    mastraRunId,
    baselineName,
    judgeModel,
    netWinRate,
    comparableQueries,
    contentEmbeddingProvider,
  }
}

function assertGateReportPathAllowed(reportPath: string, cwd: string): void {
  const reportsDir = resolve(cwd, "docs/search-eval-reports")
  const relativePath = relative(reportsDir, reportPath)
  if (
    relativePath === "" ||
    relativePath.startsWith("..") ||
    isAbsolute(relativePath) ||
    dirname(reportPath) !== reportsDir ||
    extname(reportPath) !== ".json"
  ) {
    throw new RunEmbedsConfigError(
      "[run-embeds] --gate-report must point at docs/search-eval-reports/<reportId>.json",
    )
  }
}

export function resolveGateReportPath(
  arg: string | undefined,
  cwd = process.cwd(),
): string | undefined {
  if (arg === undefined || arg === "") return undefined
  const reportPath = isAbsolute(arg) ? arg : resolve(cwd, arg)
  assertGateReportPathAllowed(reportPath, cwd)
  return reportPath
}

export async function loadContentBackfillGateReport(
  reportPath: string,
  cwd = process.cwd(),
): Promise<ContentBackfillGateSummary> {
  assertGateReportPathAllowed(reportPath, cwd)
  let raw: string
  try {
    raw = await readFile(reportPath, "utf8")
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new RunEmbedsConfigError(
      `[run-embeds] failed to read --gate-report=${reportPath}: ${message}`,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    throw new RunEmbedsConfigError(
      `[run-embeds] --gate-report=${reportPath} is not valid JSON`,
    )
  }
  return extractContentBackfillGateFromReport(parsed, reportPath)
}

type Pipeline = "transcript" | "experience" | "both" | "all"

const LOCAL_BACKFILL_DATABASE_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
])
const LOCAL_BACKFILL_DATABASE_NAME_PATTERN =
  /(?:^|_)(?:local|test|dev|development)(?:_|$)/i

export function isLocalBackfillDatabaseUrl(databaseUrl: string): boolean {
  try {
    const parsed = new URL(databaseUrl)
    const hostname = parsed.hostname.toLowerCase()
    const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""))
    return (
      LOCAL_BACKFILL_DATABASE_HOSTS.has(hostname) &&
      LOCAL_BACKFILL_DATABASE_NAME_PATTERN.test(databaseName)
    )
  } catch {
    return false
  }
}

export function requiresContentBackfillGateReport(args: {
  pipeline: Pipeline
  gateReportPath: string | undefined
  allowUngatedLocalBackfill: boolean
  nodeEnv: string | undefined
  databaseUrl: string
}): boolean {
  return (
    args.pipeline === "all" &&
    args.gateReportPath === undefined &&
    (!args.allowUngatedLocalBackfill ||
      args.nodeEnv === "production" ||
      !isLocalBackfillDatabaseUrl(args.databaseUrl))
  )
}

function parseSingle(name: string): string | undefined {
  const flag = `--${name}=`
  const arg = process.argv.find((a) => a.startsWith(flag))
  return arg ? arg.slice(flag.length) : undefined
}

function parseRepeated(name: string): string[] {
  const flag = `--${name}=`
  return process.argv
    .filter((a) => a.startsWith(flag))
    .map((a) => a.slice(flag.length))
    .filter((v) => v.length > 0)
}

function parseFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

function isPipeline(v: string): v is Pipeline {
  return v === "transcript" || v === "experience" || v === "both" || v === "all"
}

function isEmbeddingBackfillMode(v: string): v is EmbeddingBackfillMode {
  return (
    v === "idempotent" ||
    v === "repair" ||
    v === "force" ||
    v === "model-upgrade"
  )
}

async function main(): Promise<void> {
  const pipelineArg = parseSingle("pipeline")
  if (!pipelineArg) {
    process.stderr.write(
      "[run-embeds] --pipeline=transcript|experience|both|all is required\n",
    )
    process.exit(2)
  }
  if (!isPipeline(pipelineArg)) {
    process.stderr.write(
      `[run-embeds] invalid --pipeline=${pipelineArg}; expected transcript|experience|both|all\n`,
    )
    process.exit(2)
  }

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    process.stderr.write("[run-embeds] DATABASE_URL is required\n")
    process.exit(2)
  }

  const mappingS3Key =
    parseSingle("mapping-key") ?? DEFAULT_CORE_ID_MAPPING_S3_KEY
  const coreIds = parseRepeated("core-id")
  const locales = parseRepeated("locale")
  const languages = parseRepeated("language")
  const transcriptMode = parseSingle("transcript-mode")
  const experienceMode = parseSingle("experience-mode")
  const experienceIds = parseRepeated("experience-id")
  const force = parseFlag("force")
  // feat-119 PR1 — operators piping the report into PR2's
  // `pnpm trigger-enrichment --from-report=<path>` need a stable
  // file format. When unset, behavior is unchanged (stdout only).
  const reportOutPath = resolveReportOutPath(parseSingle("report-out"))
  const gateReportPath = resolveGateReportPath(parseSingle("gate-report"))
  const allowUngatedLocalBackfill = parseFlag("allow-ungated-local-backfill")

  if (parseSingle("from-report") !== undefined) {
    process.stderr.write(
      "[run-embeds] --from-report is no longer supported; scene embedding backfills have been retired\n",
    )
    process.exit(2)
  }
  if (parseSingle("scene-mode") !== undefined) {
    process.stderr.write(
      "[run-embeds] --scene-mode is no longer supported; scene embedding backfills have been retired\n",
    )
    process.exit(2)
  }
  if (
    transcriptMode !== undefined &&
    !isEmbeddingBackfillMode(transcriptMode)
  ) {
    process.stderr.write(
      `[run-embeds] invalid --transcript-mode=${transcriptMode}; expected idempotent|repair|force|model-upgrade\n`,
    )
    process.exit(1)
  }
  if (
    experienceMode !== undefined &&
    !isEmbeddingBackfillMode(experienceMode)
  ) {
    process.stderr.write(
      `[run-embeds] invalid --experience-mode=${experienceMode}; expected idempotent|repair|force|model-upgrade\n`,
    )
    process.exit(1)
  }
  if (
    requiresContentBackfillGateReport({
      pipeline: pipelineArg,
      gateReportPath,
      allowUngatedLocalBackfill,
      nodeEnv: undefined,
      databaseUrl,
    })
  ) {
    process.stderr.write(
      "[run-embeds] --pipeline=all requires --gate-report=<docs/search-eval-reports/*.json>\n",
    )
    process.exit(2)
  }

  let contentBackfillGate: ContentBackfillGateSummary | undefined
  if (gateReportPath !== undefined) {
    try {
      contentBackfillGate = await loadContentBackfillGateReport(gateReportPath)
    } catch (err) {
      if (err instanceof RunEmbedsConfigError) {
        process.stderr.write(err.message + "\n")
        process.exit(err.exitCode)
      }
      throw err
    }
  }

  // Lazy-import the workflow modules AFTER the DATABASE_URL guard
  // above so a missing var produces our friendly stderr line instead
  // of zod's validation crash on the transitive `@/config/env` import.
  // Imports happen BEFORE the try/finally so the finally always sees
  // a bound prisma reference. Importing the workflows here also pulls
  // in the validated `env` and the workflow defaults — single source
  // of truth for both the CLI's start-event log and the workflow body.
  const {
    runTranscriptEmbeddingBackfill,
    DEFAULT_TRANSCRIPT_EMBEDDING_CONCURRENCY,
  } = await import("@/workflows/transcriptEmbeddingBackfill")
  const { runExperienceEmbeddingBackfill } =
    await import("@/workflows/experienceEmbeddingBackfill")
  const { prisma } = await import("@/db/client")
  const { env } = await import("@/config/env")

  if (
    requiresContentBackfillGateReport({
      pipeline: pipelineArg,
      gateReportPath,
      allowUngatedLocalBackfill,
      nodeEnv: env.NODE_ENV,
      databaseUrl,
    })
  ) {
    process.stderr.write(
      "[run-embeds] --pipeline=all requires --gate-report=<docs/search-eval-reports/*.json>\n",
    )
    process.exit(2)
  }

  const transcriptConcurrency =
    env.TRANSCRIPT_EMBEDDING_CONCURRENCY ??
    DEFAULT_TRANSCRIPT_EMBEDDING_CONCURRENCY
  const resolvedExperienceMode =
    experienceMode ?? (force ? "force" : "idempotent")
  const resolvedExperienceForce =
    experienceMode === undefined
      ? force
      : resolvedExperienceMode !== "idempotent"

  const redacted = databaseUrl.replace(/:\/\/[^@]+@/, "://***:***@")
  process.stdout.write(
    JSON.stringify({
      event: "run-embeds.start",
      pipeline: pipelineArg,
      databaseUrl: redacted,
      mappingS3Key,
      coreIds: coreIds.length > 0 ? coreIds : null,
      locales: locales.length > 0 ? locales : null,
      languages: languages.length > 0 ? languages : null,
      transcriptMode: transcriptMode ?? null,
      experienceMode: resolvedExperienceMode,
      experienceIds: experienceIds.length > 0 ? experienceIds : null,
      force: resolvedExperienceForce,
      transcriptConcurrency,
      managerArtifactsBucket:
        process.env.MANAGER_ARTIFACTS_S3_BUCKET ?? "(unset)",
      gateReport: gateReportPath ?? null,
      contentBackfillGate: contentBackfillGate ?? null,
      contentBackfillGateBypass:
        pipelineArg === "all" && contentBackfillGate == null
          ? {
              allowed: true,
              reason: "explicit_local_backfill",
              databaseHost: new URL(databaseUrl).hostname,
            }
          : null,
    }) + "\n",
  )

  // SIGINT/SIGTERM handler so Ctrl-C / docker stop / Railway stop
  // doesn't leak the prisma connection. Workflow upserts are
  // idempotent (composite-key), so partial work is safe to resume
  // by re-running.
  let interrupted = false
  const onSignal = (signal: NodeJS.Signals) => {
    if (interrupted) return
    interrupted = true
    process.stderr.write(
      JSON.stringify({
        event: "run-embeds.interrupted",
        signal,
      }) + "\n",
    )
    void prisma.$disconnect().finally(() => process.exit(130))
  }
  process.once("SIGINT", onSignal)
  process.once("SIGTERM", onSignal)

  const startedAt = Date.now()

  const reports: Record<string, unknown> = {}
  const errors: Record<string, string> = {}

  try {
    if (
      pipelineArg === "transcript" ||
      pipelineArg === "both" ||
      pipelineArg === "all"
    ) {
      try {
        process.stdout.write(
          JSON.stringify({
            event: "run-embeds.transcript.start",
            mappingS3Key,
          }) + "\n",
        )
        const transcriptReport = await runTranscriptEmbeddingBackfill({
          mappingS3Key,
          coreIds: coreIds.length > 0 ? coreIds : undefined,
          languages: languages.length > 0 ? languages : undefined,
          mode: transcriptMode as
            | "idempotent"
            | "repair"
            | "force"
            | "model-upgrade"
            | undefined,
        })
        reports.transcript = transcriptReport
        process.stdout.write(
          JSON.stringify({
            event: "run-embeds.transcript.complete",
            totalTargets: transcriptReport.totalTargets,
            succeeded: transcriptReport.succeeded,
            skipped: transcriptReport.skipped,
            failed: transcriptReport.failed,
          }) + "\n",
        )
      } catch (err) {
        errors.transcript = err instanceof Error ? err.message : String(err)
        process.stdout.write(
          JSON.stringify({
            event: "run-embeds.transcript.error",
            error: errors.transcript,
          }) + "\n",
        )
      }
    }

    // `pipeline=both` deliberately runs the original R1+R2 pair only.
    // Emit a structured `experience.skipped` event so agents/operators
    // parsing the event stream see the omission as an explicit signal
    // rather than absence-of-event. Use `--pipeline=experience` or
    // `--pipeline=all` to also run R3.
    if (pipelineArg === "both") {
      process.stdout.write(
        JSON.stringify({
          event: "run-embeds.experience.skipped",
          reason: "pipeline_both_excludes_experience",
        }) + "\n",
      )
    }

    if (pipelineArg === "experience" || pipelineArg === "all") {
      try {
        process.stdout.write(
          JSON.stringify({
            event: "run-embeds.experience.start",
            experienceIds: experienceIds.length > 0 ? experienceIds : null,
            locales: locales.length > 0 ? locales : null,
            force: resolvedExperienceForce,
            mode: resolvedExperienceMode,
          }) + "\n",
        )
        const experienceReport = await runExperienceEmbeddingBackfill({
          experienceIds: experienceIds.length > 0 ? experienceIds : undefined,
          bcp47Locales: locales.length > 0 ? locales : undefined,
          force: resolvedExperienceForce,
          mode: experienceMode as
            | "idempotent"
            | "repair"
            | "force"
            | "model-upgrade"
            | undefined,
        })
        reports.experience = experienceReport
        process.stdout.write(
          JSON.stringify({
            event: "run-embeds.experience.complete",
            totalTargets: experienceReport.totalTargets,
            succeeded: experienceReport.succeeded,
            failed: experienceReport.failed,
          }) + "\n",
        )
      } catch (err) {
        errors.experience = err instanceof Error ? err.message : String(err)
        process.stdout.write(
          JSON.stringify({
            event: "run-embeds.experience.error",
            error: errors.experience,
          }) + "\n",
        )
      }
    }

    const finalReport = {
      event: "run-embeds.complete" as const,
      pipeline: pipelineArg,
      wallClockMs: Date.now() - startedAt,
      reports,
      contentBackfillGate,
      contentBackfillGateBypass:
        pipelineArg === "all" && contentBackfillGate == null
          ? {
              allowed: true,
              reason: "explicit_local_backfill",
              databaseHost: new URL(databaseUrl).hostname,
            }
          : null,
      errors: Object.keys(errors).length > 0 ? errors : undefined,
    }

    process.stdout.write(JSON.stringify(finalReport, null, 2) + "\n")

    // feat-119 PR1 — optional file dump. Side-channel write failures
    // do NOT alter the script's exit code (the report is already on
    // stdout). See `writeReportToPath`.
    if (reportOutPath !== undefined) {
      const writeResult = await writeReportToPath(reportOutPath, finalReport)
      if (writeResult.ok) {
        process.stdout.write(
          JSON.stringify({
            event: "run-embeds.report_out_written",
            path: reportOutPath,
          }) + "\n",
        )
      } else {
        process.stderr.write(
          JSON.stringify({
            event: "run-embeds.report_out_error",
            path: reportOutPath,
            error: writeResult.error,
          }) + "\n",
        )
      }
    }

    if (Object.keys(errors).length > 0) {
      process.exit(1)
    }
  } finally {
    process.off("SIGINT", onSignal)
    process.off("SIGTERM", onSignal)
    await prisma.$disconnect()
  }
}

if (
  typeof process.argv[1] === "string" &&
  import.meta.url === `file://${process.argv[1]}`
) {
  main().catch((err) => {
    process.stderr.write(
      JSON.stringify({
        event: "run-embeds.fatal",
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      }) + "\n",
    )
    process.exit(1)
  })
}
