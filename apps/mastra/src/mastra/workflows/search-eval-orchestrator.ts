import { basename, extname } from "node:path"
import { randomUUID } from "node:crypto"

import { createStep, createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"

import { isValidServiceBearer } from "../../server/service-bearer"
import {
  checkSearchEvalBaselineReadiness,
  type SearchEvalBaselineReadiness,
} from "../../services/offline-search-eval/baseline-portability"
import { SEARCH_EVAL_SEED_PROMPT_LOCALES } from "../../services/offline-search-eval/seed-prompt-set"
import {
  DEFAULT_SEARCH_EVAL_CALLER_TRACK,
  SEARCH_EVAL_CALLER_TRACK_IDS,
  SEARCH_EVAL_SEARCH_MODES,
  defaultSearchEvalBaselineNameForCallerTrack,
  type SearchEvalReport,
} from "../../services/offline-search-eval/types"
import {
  launchEvalQueryGenerationWorkflow,
  type EvalQueryGenerationWorkflowResult,
} from "./eval-query-generation"
import { launchOfflineSearchEvalWorkflow } from "./offline-search-eval"
import {
  launchSearchEvalCandidateReviewWorkflow,
  type SearchEvalCandidateReviewWorkflowResult,
} from "./search-eval-candidate-review"
import {
  launchSearchEvalNativeSuiteWorkflow,
  type SearchEvalNativeSuiteWorkflowResult,
} from "./search-eval-native-suite"

export const SEARCH_EVAL_ORCHESTRATOR_MAX_BODY_BYTES = 12288
const WORKFLOW_FAILURE_ERROR_PREFIX = "SEARCH_EVAL_ORCHESTRATOR_FAILED:"
const DEFAULT_CONTENT_TYPE = "all"
const DEFAULT_MODE = "seed-baseline"

const SafeNameSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/)

const SourceSchema = z.enum(["catalog", "locale_quality", "trace"])

export const SearchEvalOrchestratorWorkflowInputSchema = z
  .object({
    mode: z
      .enum(["seed-baseline", "full", "compare", "release-gate"])
      .default(DEFAULT_MODE)
      .describe(
        "seed-baseline captures the production seed baseline; full coordinates general capture; compare compares against a baseline; release-gate compares and evaluates thresholds.",
      ),
    baselineName: SafeNameSchema.optional().describe(
      "Named baseline artifact to capture or compare against. Omit to use the caller-track default.",
    ),
    callerTrack: z
      .enum(SEARCH_EVAL_CALLER_TRACK_IDS)
      .default(DEFAULT_SEARCH_EVAL_CALLER_TRACK)
      .describe(
        "Caller lens for prompt selection and judging: public-watch, ai-experience-generation, or semantic-diagnostic.",
      ),
    locales: z
      .array(z.string().min(1).max(32))
      .min(1)
      .max(30)
      .default(() => [...SEARCH_EVAL_SEED_PROMPT_LOCALES])
      .describe("Locales to evaluate. Defaults to every seeded locale."),
    searchLimit: z.coerce
      .number()
      .int()
      .positive()
      .max(50)
      .default(20)
      .describe("Admin search result limit per prompt."),
    searchMode: z
      .enum(SEARCH_EVAL_SEARCH_MODES)
      .optional()
      .describe(
        "Admin search pipeline to evaluate. Omit to use the caller-track default.",
      ),
    contentType: z
      .enum(["all", "video", "experience"])
      .default(DEFAULT_CONTENT_TYPE)
      .describe("Content filter. all searches videos and experiences."),
    environmentLabel: z
      .string()
      .min(1)
      .max(64)
      .optional()
      .describe("Native Evaluation environment label."),
    nativeSync: z
      .boolean()
      .default(true)
      .describe("Sync the resulting report into native Evaluation."),
    syncPromoted: z
      .boolean()
      .default(false)
      .describe(
        "Sync already-promoted Admin candidates into native Evaluation.",
      ),
    promotedLimit: z.coerce
      .number()
      .int()
      .positive()
      .max(100)
      .default(100)
      .describe("Maximum promoted candidates to sync."),
    generateCandidates: z
      .boolean()
      .default(false)
      .describe("Optionally stage generated candidates before running eval."),
    generationSources: z
      .array(SourceSchema)
      .min(1)
      .max(3)
      .optional()
      .describe("Candidate-generation sources when generation is enabled."),
    traceLimit: z.coerce.number().int().positive().max(100).default(25),
    catalogLimit: z.coerce.number().int().positive().max(100).default(30),
    localeQueryCount: z.coerce.number().int().positive().max(10).default(2),
    submitSeedCandidates: z
      .boolean()
      .default(false)
      .describe("Submit committed seed prompts as pending Admin candidates."),
    resumeReportId: SafeNameSchema.optional().describe(
      "Existing report id to sync without rerunning offline search eval.",
    ),
    gateMaxLosses: z.coerce.number().int().nonnegative().max(100).default(0),
    gateMaxSearchFailures: z.coerce
      .number()
      .int()
      .nonnegative()
      .max(100)
      .default(0),
    gateMaxJudgeFailures: z.coerce
      .number()
      .int()
      .nonnegative()
      .max(100)
      .default(0),
    gateMaxJudgeDisagreements: z.coerce
      .number()
      .int()
      .nonnegative()
      .max(100)
      .default(0),
    gateRequireCalibration: z.boolean().default(true),
    gateRequireAssignedJudge: z.boolean().default(true),
    gateMinComparableQueries: z.coerce
      .number()
      .int()
      .nonnegative()
      .max(100)
      .default(1),
    gateMinNetWinRate: z.coerce.number().min(-1).max(1).default(0),
  })
  .strict()

export type SearchEvalOrchestratorWorkflowInput = z.output<
  typeof SearchEvalOrchestratorWorkflowInputSchema
>

type NormalizedSearchEvalOrchestratorWorkflowInput =
  SearchEvalOrchestratorWorkflowInput & { baselineName: string }

const ChildWorkflowRunSchema = z
  .object({
    workflowId: z.enum([
      "eval-query-generation",
      "search-eval-candidate-review",
      "offline-search-eval",
      "search-eval-native-suite",
    ]),
    runId: z.string(),
    status: z.enum(["succeeded", "failed", "skipped"]),
    action: z.string().optional(),
    reason: z.string().optional(),
    retryable: z.boolean().optional(),
  })
  .strict()

const CountsSchema = z
  .object({
    generatedCandidates: z.number().int().nonnegative().optional(),
    storedCandidates: z.number().int().nonnegative().optional(),
    skippedCandidates: z.number().int().nonnegative().optional(),
    baselineCases: z.number().int().nonnegative().optional(),
    reportQueries: z.number().int().nonnegative().optional(),
    wins: z.number().int().nonnegative().optional(),
    losses: z.number().int().nonnegative().optional(),
    ties: z.number().int().nonnegative().optional(),
    bothIrrelevant: z.number().int().nonnegative().optional(),
    judgeDisagreements: z.number().int().nonnegative().optional(),
    judgeFailures: z.number().int().nonnegative().optional(),
    searchFailures: z.number().int().nonnegative().optional(),
    promotedReceived: z.number().int().nonnegative().optional(),
    promotedSkipped: z.number().int().nonnegative().optional(),
    nativeCreatedItems: z.number().int().nonnegative().optional(),
    nativeUpdatedItems: z.number().int().nonnegative().optional(),
  })
  .strict()

const NativeSummarySchema = z
  .object({
    reportSync: z
      .object({
        datasetId: z.string().optional(),
        datasetName: z.string().optional(),
        scorerIds: z.array(z.string()),
        experimentId: z.string().optional(),
        integrationStatus: z
          .enum(["custom_artifact_only", "native_synced"])
          .optional(),
      })
      .strict()
      .optional(),
    promotedSync: z
      .object({
        datasetId: z.string().optional(),
        datasetName: z.string().optional(),
        scorerIds: z.array(z.string()),
      })
      .strict()
      .optional(),
  })
  .strict()

const PassFailSchema = z
  .object({
    state: z.enum(["passed", "failed", "not_applicable"]),
    reasons: z.array(z.string()),
  })
  .strict()

const ReadinessSummarySchema = z
  .object({
    ok: z.boolean(),
    checks: z.array(
      z
        .object({
          name: z.string(),
          status: z.enum(["pass", "fail"]),
          reason: z.string().optional(),
        })
        .strict(),
    ),
  })
  .strict()

const ResumeSchema = z
  .object({
    reportId: z.string().optional(),
    reportPath: z.string().optional(),
    action: z.enum(["sync-report"]).optional(),
  })
  .strict()

const SummarySchema = z
  .object({
    mode: SearchEvalOrchestratorWorkflowInputSchema.shape.mode,
    baselineName: z.string(),
    childWorkflowRuns: z.array(ChildWorkflowRunSchema),
    artifacts: z
      .object({
        baselineName: z.string(),
        baselinePath: z.string().optional(),
        reportId: z.string().optional(),
        reportPath: z.string().optional(),
      })
      .strict(),
    nativeEvaluation: NativeSummarySchema,
    counts: CountsSchema,
    passFail: PassFailSchema,
    readiness: ReadinessSummarySchema.optional(),
    resume: ResumeSchema.optional(),
  })
  .strict()

const FailureReasonSchema = z.enum([
  "invalid_input",
  "candidate_generation_failed",
  "seed_submit_failed",
  "readiness_failed",
  "offline_eval_failed",
  "native_report_sync_failed",
  "promoted_sync_failed",
  "release_gate_failed",
  "orchestration_failed",
])

const SearchEvalOrchestratorResultSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      mastraRunId: z.string(),
      summary: SummarySchema,
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      reason: FailureReasonSchema,
      retryable: z.boolean(),
      mastraRunId: z.string(),
      summary: SummarySchema,
    })
    .strict(),
])

export type SearchEvalOrchestratorWorkflowResult = z.infer<
  typeof SearchEvalOrchestratorResultSchema
>
type SearchEvalOrchestratorFailure = Extract<
  SearchEvalOrchestratorWorkflowResult,
  { ok: false }
>
type OfflineSearchEvalWorkflowResult = Awaited<
  ReturnType<typeof launchOfflineSearchEvalWorkflow>
>

type WorkflowOptions = {
  runId?: string
  launchEvalQueryGeneration?: typeof launchEvalQueryGenerationWorkflow
  launchCandidateReview?: typeof launchSearchEvalCandidateReviewWorkflow
  launchOfflineSearchEval?: typeof launchOfflineSearchEvalWorkflow
  launchNativeSuite?: typeof launchSearchEvalNativeSuiteWorkflow
  checkReadiness?: () => Promise<SearchEvalBaselineReadiness>
}

type RouteHandlerInput = {
  authHeader: string | null | undefined
  serviceKeys: readonly string[]
  request?: Request
  readJson?: () => Promise<unknown>
  launch?: (
    input: SearchEvalOrchestratorWorkflowInput,
    options: { runId: string },
  ) => Promise<SearchEvalOrchestratorWorkflowResult>
}

export type SearchEvalOrchestratorRouteOutcome = {
  status: number
  body: { result?: SearchEvalOrchestratorWorkflowResult; error?: string }
}

class SearchEvalOrchestratorWorkflowFailureError extends Error {
  constructor(readonly result: SearchEvalOrchestratorFailure) {
    super(`${WORKFLOW_FAILURE_ERROR_PREFIX}${JSON.stringify(result)}`)
    this.name = "SearchEvalOrchestratorWorkflowFailureError"
  }
}

class OrchestratorRouteBodyError extends Error {
  constructor(readonly code: "payload_too_large" | "invalid_json") {
    super(code)
    this.name = "OrchestratorRouteBodyError"
  }
}

function parseFirstJsonObjectAfterPrefix(
  message: string,
  prefix: string,
): unknown | null {
  const prefixIndex = message.indexOf(prefix)
  if (prefixIndex < 0) return null

  const startIndex = message.indexOf("{", prefixIndex + prefix.length)
  if (startIndex < 0) return null

  let depth = 0
  let inString = false
  let escaped = false
  for (let index = startIndex; index < message.length; index += 1) {
    const char = message[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
    } else if (char === "{") {
      depth += 1
    } else if (char === "}") {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(message.slice(startIndex, index + 1))
        } catch {
          return null
        }
      }
    }
  }

  return null
}

function childRunId(parentRunId: string, suffix: string): string {
  return `${parentRunId}-${suffix}`.replace(/[^a-zA-Z0-9._-]/g, "-")
}

function reportIdFromPath(reportPath: string | undefined): string | undefined {
  if (!reportPath) return undefined
  const name = basename(reportPath)
  return extname(name) === ".json" ? name.slice(0, -5) : undefined
}

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null
}

function stringField(value: unknown, field: string): string | undefined {
  const container = record(value)
  const fieldValue = container?.[field]
  return typeof fieldValue === "string" ? fieldValue : undefined
}

function numberField(value: unknown, field: string): number | undefined {
  const container = record(value)
  const fieldValue = container?.[field]
  return typeof fieldValue === "number" ? fieldValue : undefined
}

function childFailureReason(result: { ok: false; reason: string }) {
  return result.reason
}

function childRetryable(result: { ok: false; retryable: boolean }) {
  return result.retryable
}

function normalizeOrchestratorInput(
  input: SearchEvalOrchestratorWorkflowInput,
): NormalizedSearchEvalOrchestratorWorkflowInput {
  return {
    ...input,
    baselineName:
      input.baselineName ??
      defaultSearchEvalBaselineNameForCallerTrack(input.callerTrack),
  }
}

function defaultOrchestratorInput(): NormalizedSearchEvalOrchestratorWorkflowInput {
  return normalizeOrchestratorInput(
    SearchEvalOrchestratorWorkflowInputSchema.parse({}),
  )
}

function initialSummary(
  input: NormalizedSearchEvalOrchestratorWorkflowInput,
): z.infer<typeof SummarySchema> {
  return {
    mode: input.mode,
    baselineName: input.baselineName,
    childWorkflowRuns: [],
    artifacts: { baselineName: input.baselineName },
    nativeEvaluation: {},
    counts: {},
    passFail: { state: "not_applicable", reasons: [] },
  }
}

function failure(
  reason: z.infer<typeof FailureReasonSchema>,
  options: {
    retryable: boolean
    mastraRunId: string
    summary: z.infer<typeof SummarySchema>
  },
): SearchEvalOrchestratorFailure {
  return {
    ok: false,
    reason,
    retryable: options.retryable,
    mastraRunId: options.mastraRunId,
    summary: options.summary,
  }
}

function addFailedChild(
  summary: z.infer<typeof SummarySchema>,
  child: {
    workflowId: z.infer<typeof ChildWorkflowRunSchema>["workflowId"]
    runId: string
    action?: string
    result: { ok: false; reason: string; retryable: boolean }
  },
) {
  summary.childWorkflowRuns.push({
    workflowId: child.workflowId,
    runId: child.runId,
    status: "failed",
    action: child.action,
    reason: childFailureReason(child.result),
    retryable: childRetryable(child.result),
  })
}

function updateCountsFromCandidateGeneration(
  summary: z.infer<typeof SummarySchema>,
  result: Extract<EvalQueryGenerationWorkflowResult, { ok: true }>,
) {
  summary.counts.generatedCandidates = result.generatedCount
  summary.counts.storedCandidates = result.storedCount
  summary.counts.skippedCandidates = result.skippedCount
}

function updateCountsFromCandidateStore(
  summary: z.infer<typeof SummarySchema>,
  result: Extract<SearchEvalCandidateReviewWorkflowResult, { ok: true }>,
) {
  const storeResult = record(result.storeResult)
  const stored = numberField(storeResult, "storedCount")
  const skipped = numberField(storeResult, "skippedCount")
  if (stored != null) {
    summary.counts.storedCandidates =
      (summary.counts.storedCandidates ?? 0) + stored
  }
  if (skipped != null) {
    summary.counts.skippedCandidates =
      (summary.counts.skippedCandidates ?? 0) + skipped
  }
}

function updateFromOfflineResult(
  summary: z.infer<typeof SummarySchema>,
  result: Extract<OfflineSearchEvalWorkflowResult, { ok: true }>,
) {
  summary.artifacts.baselineName = result.baselineName
  summary.artifacts.baselinePath = result.baselinePath
  summary.artifacts.reportId = result.report.reportId
  summary.artifacts.reportPath = result.reportPath
  updateFromReport(summary, result.report)
}

function updateFromReport(
  summary: z.infer<typeof SummarySchema>,
  report: SearchEvalReport,
) {
  summary.counts.baselineCases = report.baseline?.caseCount
  summary.counts.reportQueries = report.totals.queries
  summary.counts.wins = report.totals.wins
  summary.counts.losses = report.totals.losses
  summary.counts.ties = report.totals.ties
  summary.counts.bothIrrelevant = report.totals.bothIrrelevant
  summary.counts.judgeDisagreements = report.totals.judgeDisagreements
  summary.counts.judgeFailures = report.totals.judgeFailures
  summary.counts.searchFailures = report.totals.searchFailures
}

function scorerIdsFrom(result: SearchEvalNativeSuiteWorkflowResult): string[] {
  const scorerId = stringField(
    result.ok ? result.scorer : undefined,
    "scorerId",
  )
  return scorerId ? [scorerId] : []
}

function updateFromNativeReportSync(
  summary: z.infer<typeof SummarySchema>,
  result: Extract<SearchEvalNativeSuiteWorkflowResult, { ok: true }>,
) {
  const report = record(result.report)
  const projection = record(report?.mastraEvaluation)
  if (result.report) {
    summary.artifacts.reportId = result.report.reportId
    updateFromReport(summary, result.report)
  }
  if (result.reportPath) {
    summary.artifacts.reportPath = result.reportPath
  }
  summary.nativeEvaluation.reportSync = {
    datasetId: stringField(result.dataset, "datasetId"),
    datasetName: stringField(result.dataset, "name"),
    scorerIds: scorerIdsFrom(result),
    experimentId: stringField(result.experiment, "experimentId"),
    integrationStatus:
      projection?.integrationStatus === "custom_artifact_only" ||
      projection?.integrationStatus === "native_synced"
        ? projection.integrationStatus
        : undefined,
  }
  summary.counts.nativeCreatedItems = numberField(
    result.dataset,
    "createdItems",
  )
  summary.counts.nativeUpdatedItems = numberField(
    result.dataset,
    "updatedItems",
  )
}

function updateFromPromotedSync(
  summary: z.infer<typeof SummarySchema>,
  result: Extract<SearchEvalNativeSuiteWorkflowResult, { ok: true }>,
) {
  const promoted = record(result.promoted)
  summary.nativeEvaluation.promotedSync = {
    datasetId: stringField(result.dataset, "datasetId"),
    datasetName: stringField(result.dataset, "name"),
    scorerIds: scorerIdsFrom(result),
  }
  summary.counts.promotedReceived = numberField(promoted, "received")
  summary.counts.promotedSkipped = result.skipped?.length
}

function evaluateReleaseGate(
  input: NormalizedSearchEvalOrchestratorWorkflowInput,
  report: SearchEvalReport | undefined,
): z.infer<typeof PassFailSchema> {
  if (input.mode !== "release-gate") {
    return { state: "not_applicable", reasons: [] }
  }
  if (!report) {
    return { state: "failed", reasons: ["comparison report was not produced"] }
  }
  if (report.kind !== "comparison-report") {
    return {
      state: "failed",
      reasons: ["release gate requires a comparison report"],
    }
  }

  const reasons: string[] = []
  const comparableQueries =
    report.totals.queries -
    report.totals.bothIrrelevant -
    report.totals.searchFailures -
    report.totals.judgeDisagreements -
    report.totals.judgeFailures
  const comparableLocales = new Set(
    report.outcomes
      .filter(
        (outcome) =>
          outcome.kind !== "both-irrelevant" &&
          outcome.kind !== "search-failure" &&
          outcome.kind !== "judge-disagreement" &&
          outcome.kind !== "judge-failure",
      )
      .map((outcome) => outcome.locale),
  )
  const evaluatedLocales = new Set(
    report.outcomes.map((outcome) => outcome.locale),
  )
  if (input.gateRequireAssignedJudge && !report.metadata.judgeModel) {
    reasons.push("assigned judge model is required")
  }
  if (
    input.gateRequireCalibration &&
    (!report.calibration.passed || report.calibration.skipped)
  ) {
    reasons.push("judge calibration did not pass")
  }
  if (comparableQueries < input.gateMinComparableQueries) {
    reasons.push(
      `comparable queries ${comparableQueries} below minimum ${input.gateMinComparableQueries}`,
    )
  }
  for (const locale of evaluatedLocales) {
    if (!comparableLocales.has(locale)) {
      reasons.push(`locale ${locale} has no comparable judged queries`)
    }
  }
  if (report.totals.netWinRate < input.gateMinNetWinRate) {
    reasons.push(
      `net win rate ${report.totals.netWinRate} below minimum ${input.gateMinNetWinRate}`,
    )
  }
  if (report.totals.losses > input.gateMaxLosses) {
    reasons.push(
      `losses ${report.totals.losses} exceeded max ${input.gateMaxLosses}`,
    )
  }
  if (report.totals.searchFailures > input.gateMaxSearchFailures) {
    reasons.push(
      `search failures ${report.totals.searchFailures} exceeded max ${input.gateMaxSearchFailures}`,
    )
  }
  if (report.totals.judgeFailures > input.gateMaxJudgeFailures) {
    reasons.push(
      `judge failures ${report.totals.judgeFailures} exceeded max ${input.gateMaxJudgeFailures}`,
    )
  }
  if (report.totals.judgeDisagreements > input.gateMaxJudgeDisagreements) {
    reasons.push(
      `judge disagreements ${report.totals.judgeDisagreements} exceeded max ${input.gateMaxJudgeDisagreements}`,
    )
  }

  return {
    state: reasons.length === 0 ? "passed" : "failed",
    reasons,
  }
}

function offlineInputFor(input: NormalizedSearchEvalOrchestratorWorkflowInput) {
  return {
    mode:
      input.mode === "full" || input.mode === "seed-baseline"
        ? ("capture-baseline" as const)
        : ("compare" as const),
    baselineName: input.baselineName,
    callerTrack: input.callerTrack,
    locales: input.locales,
    searchLimit: input.searchLimit,
    searchMode: input.searchMode,
    contentType: input.contentType,
  }
}

function seedBaselineInputViolation(
  input: SearchEvalOrchestratorWorkflowInput,
): string | null {
  if (input.mode !== "seed-baseline") return null
  if (input.generateCandidates)
    return "seed-baseline cannot generate candidates"
  if (input.generationSources)
    return "seed-baseline cannot set generation sources"
  if (input.submitSeedCandidates)
    return "seed-baseline cannot submit seed candidates"
  if (input.syncPromoted) return "seed-baseline cannot sync promoted candidates"
  if (!input.nativeSync) return "seed-baseline requires native report sync"
  if (input.resumeReportId)
    return "seed-baseline cannot resume an existing report"
  return null
}

function updateFromReadiness(
  summary: z.infer<typeof SummarySchema>,
  readiness: SearchEvalBaselineReadiness,
) {
  summary.readiness = {
    ok: readiness.ok,
    checks: readiness.checks.map((check) => ({
      name: check.name,
      status: check.status,
      reason: check.reason,
    })),
  }
}

function generationInputFor(input: SearchEvalOrchestratorWorkflowInput) {
  return {
    sources: input.generationSources,
    locales: input.locales,
    traceLimit: input.traceLimit,
    catalogLimit: input.catalogLimit,
    localeQueryCount: input.localeQueryCount,
  }
}

function resume(summary: z.infer<typeof SummarySchema>) {
  const reportId = summary.artifacts.reportId
  const reportPath = summary.artifacts.reportPath
  if (!reportId && !reportPath) return
  summary.resume = {
    reportId,
    reportPath,
    action: reportId ? "sync-report" : undefined,
  }
}

export async function runSearchEvalOrchestratorWorkflow(
  rawInput: unknown,
  options: WorkflowOptions = {},
): Promise<SearchEvalOrchestratorWorkflowResult> {
  const parsed = SearchEvalOrchestratorWorkflowInputSchema.safeParse(rawInput)
  const mastraRunId = options.runId ?? randomUUID()
  if (!parsed.success) {
    return failure("invalid_input", {
      retryable: false,
      mastraRunId,
      summary: initialSummary(defaultOrchestratorInput()),
    })
  }

  const input = normalizeOrchestratorInput(parsed.data)
  const summary = initialSummary(input)
  const launchGeneration =
    options.launchEvalQueryGeneration ?? launchEvalQueryGenerationWorkflow
  const launchCandidateReview =
    options.launchCandidateReview ?? launchSearchEvalCandidateReviewWorkflow
  const launchOffline =
    options.launchOfflineSearchEval ?? launchOfflineSearchEvalWorkflow
  const launchNative =
    options.launchNativeSuite ?? launchSearchEvalNativeSuiteWorkflow
  const checkReadiness =
    options.checkReadiness ?? checkSearchEvalBaselineReadiness

  const seedViolation = seedBaselineInputViolation(input)
  if (seedViolation) {
    summary.passFail = { state: "failed", reasons: [seedViolation] }
    return failure("invalid_input", {
      retryable: false,
      mastraRunId,
      summary,
    })
  }

  if (input.mode === "seed-baseline") {
    const readiness = await checkReadiness()
    updateFromReadiness(summary, readiness)
    if (!readiness.ok) {
      summary.passFail = {
        state: "failed",
        reasons: readiness.checks
          .filter((check) => check.status === "fail")
          .map((check) => check.reason ?? check.name),
      }
      return failure("readiness_failed", {
        retryable: false,
        mastraRunId,
        summary,
      })
    }
  }

  if (input.generateCandidates) {
    const runId = childRunId(mastraRunId, "eval-query-generation")
    const result = await launchGeneration(generationInputFor(input), { runId })
    if (!result.ok) {
      addFailedChild(summary, {
        workflowId: "eval-query-generation",
        runId,
        result,
      })
      return failure("candidate_generation_failed", {
        retryable: result.retryable,
        mastraRunId,
        summary,
      })
    }
    summary.childWorkflowRuns.push({
      workflowId: "eval-query-generation",
      runId,
      status: "succeeded",
    })
    updateCountsFromCandidateGeneration(summary, result)
  }

  if (input.submitSeedCandidates) {
    const runId = childRunId(mastraRunId, "submit-seed-candidates")
    const result = await launchCandidateReview(
      { action: "submit-seed", seedLocales: input.locales },
      { runId },
    )
    if (!result.ok) {
      addFailedChild(summary, {
        workflowId: "search-eval-candidate-review",
        runId,
        action: "submit-seed",
        result,
      })
      return failure("seed_submit_failed", {
        retryable: result.retryable,
        mastraRunId,
        summary,
      })
    }
    summary.childWorkflowRuns.push({
      workflowId: "search-eval-candidate-review",
      runId,
      status: "succeeded",
      action: "submit-seed",
    })
    updateCountsFromCandidateStore(summary, result)
  }

  let report: SearchEvalReport | undefined
  if (input.resumeReportId) {
    summary.artifacts.reportId = input.resumeReportId
    summary.resume = { reportId: input.resumeReportId, action: "sync-report" }
    summary.childWorkflowRuns.push({
      workflowId: "offline-search-eval",
      runId: childRunId(mastraRunId, "offline-search-eval"),
      status: "skipped",
      action: "resume-report",
    })
  } else {
    const runId = childRunId(mastraRunId, "offline-search-eval")
    const result = await launchOffline(offlineInputFor(input), { runId })
    if (!result.ok) {
      summary.artifacts.reportPath = result.reportPath
      summary.artifacts.reportId = reportIdFromPath(result.reportPath)
      addFailedChild(summary, {
        workflowId: "offline-search-eval",
        runId,
        action: offlineInputFor(input).mode,
        result,
      })
      resume(summary)
      return failure("offline_eval_failed", {
        retryable: result.retryable,
        mastraRunId,
        summary,
      })
    }
    summary.childWorkflowRuns.push({
      workflowId: "offline-search-eval",
      runId,
      status: "succeeded",
      action: result.mode,
    })
    updateFromOfflineResult(summary, result)
    report = result.report
  }

  if (input.nativeSync && summary.artifacts.reportId) {
    const runId = childRunId(mastraRunId, "native-report-sync")
    const result = await launchNative(
      {
        action: "sync-report",
        reportId: summary.artifacts.reportId,
        baselineName: input.baselineName,
        promotedLimit: input.promotedLimit,
        ...(input.environmentLabel
          ? { environmentLabel: input.environmentLabel }
          : {}),
      },
      { runId },
    )
    if (!result.ok) {
      addFailedChild(summary, {
        workflowId: "search-eval-native-suite",
        runId,
        action: "sync-report",
        result,
      })
      resume(summary)
      return failure("native_report_sync_failed", {
        retryable: result.retryable,
        mastraRunId,
        summary,
      })
    }
    summary.childWorkflowRuns.push({
      workflowId: "search-eval-native-suite",
      runId,
      status: "succeeded",
      action: "sync-report",
    })
    updateFromNativeReportSync(summary, result)
    if (result.report) report = result.report
  }

  if (input.syncPromoted) {
    const runId = childRunId(mastraRunId, "native-promoted-sync")
    const result = await launchNative(
      {
        action: "sync-promoted",
        baselineName: input.baselineName,
        promotedLimit: input.promotedLimit,
        ...(input.environmentLabel
          ? { environmentLabel: input.environmentLabel }
          : {}),
      },
      { runId },
    )
    if (!result.ok) {
      addFailedChild(summary, {
        workflowId: "search-eval-native-suite",
        runId,
        action: "sync-promoted",
        result,
      })
      resume(summary)
      return failure("promoted_sync_failed", {
        retryable: result.retryable,
        mastraRunId,
        summary,
      })
    }
    summary.childWorkflowRuns.push({
      workflowId: "search-eval-native-suite",
      runId,
      status: "succeeded",
      action: "sync-promoted",
    })
    updateFromPromotedSync(summary, result)
  }

  summary.passFail = evaluateReleaseGate(input, report)
  if (summary.passFail.state === "failed") {
    resume(summary)
    return failure("release_gate_failed", {
      retryable: false,
      mastraRunId,
      summary,
    })
  }

  return {
    ok: true,
    mastraRunId,
    summary,
  }
}

function throwWorkflowFailure(result: SearchEvalOrchestratorFailure): never {
  throw new SearchEvalOrchestratorWorkflowFailureError(result)
}

function workflowFailureFromUnknown(
  value: unknown,
): SearchEvalOrchestratorFailure | null {
  const directParsed = SearchEvalOrchestratorResultSchema.safeParse(value)
  if (directParsed.success && !directParsed.data.ok) return directParsed.data

  if (value instanceof SearchEvalOrchestratorWorkflowFailureError) {
    return value.result
  }
  const texts =
    value instanceof Error
      ? [value.message, value.stack].filter((text): text is string =>
          Boolean(text),
        )
      : typeof value === "string"
        ? [value]
        : []
  for (const text of texts) {
    const payload = parseFirstJsonObjectAfterPrefix(
      text,
      WORKFLOW_FAILURE_ERROR_PREFIX,
    )
    if (payload == null) continue
    const parsed = SearchEvalOrchestratorResultSchema.safeParse(payload)
    if (parsed.success && !parsed.data.ok) return parsed.data
  }

  const valueRecord = record(value)
  if (!valueRecord) return null
  return (
    workflowFailureFromUnknown(valueRecord.result) ??
    workflowFailureFromUnknown(valueRecord.cause) ??
    workflowFailureFromUnknown(valueRecord.error)
  )
}

function workflowFailureFromRunResult(
  value: unknown,
): SearchEvalOrchestratorFailure | null {
  const direct = workflowFailureFromUnknown(value)
  if (direct) return direct
  const valueRecord = record(value)
  if (!valueRecord) return null
  return (
    workflowFailureFromUnknown(valueRecord.error) ??
    workflowFailureFromUnknown(valueRecord.result) ??
    workflowFailureFromUnknown(valueRecord.snapshot)
  )
}

const orchestratorStep = createStep({
  id: "run-search-eval-orchestrator",
  description:
    "Coordinate search eval baseline capture, comparison, native sync, and release-gate summaries.",
  inputSchema: SearchEvalOrchestratorWorkflowInputSchema,
  outputSchema: SearchEvalOrchestratorResultSchema,
  execute: async ({ inputData, runId }) => {
    const result = await runSearchEvalOrchestratorWorkflow(inputData, { runId })
    if (!result.ok) throwWorkflowFailure(result)
    return result
  },
})

export const searchEvalOrchestratorWorkflow = createWorkflow({
  id: "search-eval-orchestrator",
  description:
    "Coordinate Forge search eval artifacts and native Evaluation sync without entering the live search path.",
  inputSchema: SearchEvalOrchestratorWorkflowInputSchema,
  outputSchema: SearchEvalOrchestratorResultSchema,
})
  .then(orchestratorStep)
  .commit()

export async function launchSearchEvalOrchestratorWorkflow(
  rawInput: SearchEvalOrchestratorWorkflowInput,
  options: { runId?: string } = {},
): Promise<SearchEvalOrchestratorWorkflowResult> {
  const parsed = SearchEvalOrchestratorWorkflowInputSchema.safeParse(rawInput)
  const runId = options.runId ?? randomUUID()
  if (!parsed.success) {
    return failure("invalid_input", {
      retryable: false,
      mastraRunId: runId,
      summary: initialSummary(defaultOrchestratorInput()),
    })
  }
  const input = normalizeOrchestratorInput(parsed.data)
  const run = await searchEvalOrchestratorWorkflow.createRun({ runId })
  let result: Awaited<ReturnType<typeof run.start>>
  try {
    result = await run.start({ inputData: input })
  } catch (error) {
    return (
      workflowFailureFromUnknown(error) ??
      failure("orchestration_failed", {
        retryable: true,
        mastraRunId: runId,
        summary: initialSummary(input),
      })
    )
  }
  if (result?.status === "success") {
    return result.result as SearchEvalOrchestratorWorkflowResult
  }
  return (
    workflowFailureFromRunResult(result) ??
    failure("orchestration_failed", {
      retryable: true,
      mastraRunId: runId,
      summary: initialSummary(input),
    })
  )
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const contentLength = request.headers.get("content-length")
  if (contentLength != null) {
    const declaredBytes = Number(contentLength)
    if (
      !Number.isFinite(declaredBytes) ||
      declaredBytes < 0 ||
      declaredBytes > SEARCH_EVAL_ORCHESTRATOR_MAX_BODY_BYTES
    ) {
      throw new OrchestratorRouteBodyError("payload_too_large")
    }
  }

  const body = request.body
  if (body == null) throw new OrchestratorRouteBodyError("invalid_json")
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > SEARCH_EVAL_ORCHESTRATOR_MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new OrchestratorRouteBodyError("payload_too_large")
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new OrchestratorRouteBodyError("invalid_json")
  }
}

function invalidInput(runId = randomUUID()): SearchEvalOrchestratorFailure {
  return failure("invalid_input", {
    retryable: false,
    mastraRunId: runId,
    summary: initialSummary(defaultOrchestratorInput()),
  })
}

function childFailureStatus(reason: string): number | null {
  if (reason === "invalid_input") return 400
  if (reason === "readiness_failed") return 503
  if (reason === "artifact_invalid") return 400
  if (reason === "sample_not_allowed") return 403
  if (reason === "artifact_not_found") return 404
  if (reason.endsWith("_rejected")) return 409
  if (
    reason === "admin_config_missing" ||
    reason === "generation_config_missing" ||
    reason === "judge_config_missing" ||
    reason === "runtime_unavailable" ||
    reason === "artifact_read_failed" ||
    reason === "artifact_write_failed"
  ) {
    return 503
  }
  return null
}

function routeStatusForResult(result: SearchEvalOrchestratorWorkflowResult) {
  if (result.ok) return 200
  if (result.reason === "invalid_input") return 400
  if (result.reason === "readiness_failed") return 503
  if (result.reason === "release_gate_failed") return 409
  const failedChild = result.summary.childWorkflowRuns.find(
    (child) => child.status === "failed" && child.reason,
  )
  const childStatus = failedChild?.reason
    ? childFailureStatus(failedChild.reason)
    : null
  if (childStatus != null) return childStatus
  return 502
}

export async function handleSearchEvalOrchestratorRouteRequest({
  authHeader,
  serviceKeys,
  request,
  readJson,
  launch = launchSearchEvalOrchestratorWorkflow,
}: RouteHandlerInput): Promise<SearchEvalOrchestratorRouteOutcome> {
  if (!isValidServiceBearer({ authHeader, allowlist: serviceKeys })) {
    return {
      status: 401,
      body: { error: "Service bearer required" },
    }
  }

  const runId = randomUUID()
  let body: unknown
  try {
    body = request ? await readBoundedJson(request) : await readJson?.()
  } catch (error) {
    return {
      status:
        error instanceof OrchestratorRouteBodyError &&
        error.code === "payload_too_large"
          ? 413
          : 400,
      body: { result: invalidInput(runId) },
    }
  }
  const parsed = SearchEvalOrchestratorWorkflowInputSchema.safeParse(body)
  let result: SearchEvalOrchestratorWorkflowResult
  if (parsed.success) {
    const input = normalizeOrchestratorInput(parsed.data)
    result = await launch(input, { runId }).catch(() =>
      failure("orchestration_failed", {
        retryable: true,
        mastraRunId: runId,
        summary: initialSummary(input),
      }),
    )
  } else {
    result = invalidInput(runId)
  }

  return {
    status: routeStatusForResult(result),
    body: { result },
  }
}

export const _internal = {
  SearchEvalOrchestratorWorkflowInputSchema,
  SearchEvalOrchestratorResultSchema,
  workflowFailureFromUnknown,
  workflowFailureFromRunResult,
  evaluateReleaseGate,
  reportIdFromPath,
  routeStatusForResult,
}
