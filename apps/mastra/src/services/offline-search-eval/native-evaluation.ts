import { createScorer, type MastraScorer } from "@mastra/core/evals"
import type {
  DatasetItem,
  DatasetRecord,
  Experiment,
} from "@mastra/core/storage"
import { z } from "zod"

import type { AdminCandidateListResponse } from "../admin-search-eval-client"
import { env } from "../../config/env"
import { finalizeReport } from "./report"
import type {
  ComparisonOutcome,
  MastraEvaluationProjection,
  NativeSyncedMastraEvaluationProjection,
  ReportOutcomeKind,
  SearchEvalReport,
  SearchEvalResult,
} from "./types"

export const SEARCH_RESULT_PAIRWISE_SCORER_ID =
  "search-result-pairwise-judge" as const
const NATIVE_SEARCH_EVAL_TARGET_ID = "offline-search-eval" as const
const SAMPLE_PROMPT_SET_VERSION = "sample/search-eval/v1"
const NATIVE_LIST_PAGE_SIZE = 200
const MAX_NATIVE_LIST_PAGES = 25
const SEARCH_PIPELINE_MODES = [
  "hybrid",
  "keyword-first",
  "semantic-only",
] as const

type NativeScorer = MastraScorer<
  string,
  unknown,
  unknown,
  Record<string, unknown>
>

const SearchEvalNativeResultSchema = z
  .object({
    type: z.enum(["video", "experience"]),
    id: z.string(),
    slug: z.string(),
    title: z.string(),
    score: z.number(),
    label: z.string().nullable(),
  })
  .strict()

export const NativeSearchEvalInputSchema = z
  .object({
    query: z.string(),
    locale: z.string(),
    languageSlug: z.string().nullable().optional(),
    websiteLocale: z.string().nullable().optional(),
    source: z.enum([
      "seed",
      "generated_catalog",
      "generated_locale_quality",
      "generated_trace",
      "user_submitted",
      "promoted",
    ]),
    searchOptions: z
      .object({
        limit: z.number().int().positive(),
        mode: z.enum(SEARCH_PIPELINE_MODES),
        contentType: z.enum(["all", "video", "experience"]),
      })
      .strict(),
  })
  .strict()

export const NativeSearchEvalGroundTruthSchema = z
  .object({
    expectedResultNotes: z.string().nullable(),
    sourceAnchors: z.array(z.unknown()),
    baselineTopResults: z.array(SearchEvalNativeResultSchema).optional(),
  })
  .strict()

export const NativeSearchEvalOutputSchema = z
  .object({
    outcomeKind: z.enum([
      "win",
      "loss",
      "tie",
      "both-irrelevant",
      "judge-disagreement",
      "judge-failure",
      "search-failure",
    ]),
    caseId: z.string(),
    locale: z.string(),
    languageSlug: z.string().nullable().optional(),
    websiteLocale: z.string().nullable().optional(),
    query: z.string(),
    baselineTopResults: z.array(SearchEvalNativeResultSchema),
    currentTopResults: z.array(SearchEvalNativeResultSchema),
    rationale: z.string().nullable(),
    verdicts: z.array(z.string()).nullable(),
    failureCode: z.string().nullable(),
  })
  .strict()

export type NativeSearchEvalInput = z.infer<typeof NativeSearchEvalInputSchema>
export type NativeSearchEvalGroundTruth = z.infer<
  typeof NativeSearchEvalGroundTruthSchema
>
export type NativeSearchEvalOutput = z.infer<
  typeof NativeSearchEvalOutputSchema
>

type NativeDatasetLike = {
  id: string
  getDetails?: () => Promise<DatasetRecord>
  update?: (input: {
    name?: string
    description?: string
    metadata?: Record<string, unknown>
    inputSchema?: unknown
    groundTruthSchema?: unknown
    targetType?: "workflow"
    targetIds?: string[]
    scorerIds?: string[]
  }) => Promise<unknown>
  addItems: (input: {
    items: Array<{
      input: unknown
      groundTruth?: unknown
      metadata?: Record<string, unknown>
      source?: { type: "json"; referenceId?: string }
    }>
  }) => Promise<DatasetItem[]>
  updateItem: (input: {
    itemId: string
    input?: unknown
    groundTruth?: unknown
    metadata?: Record<string, unknown>
  }) => Promise<DatasetItem>
  listItems: (args?: {
    page?: number
    perPage?: number
  }) => Promise<DatasetItem[] | { items: DatasetItem[] }>
  listExperiments: (args?: {
    page?: number
    perPage?: number
  }) => Promise<{ experiments: Experiment[] }>
  startExperiment: <I = unknown, O = unknown, E = unknown>(config: {
    name?: string
    description?: string
    targetType?: "workflow"
    targetId?: string
    task?: (args: {
      input: I
      groundTruth?: E
      metadata?: Record<string, unknown>
    }) => O | Promise<O>
    scorers?: Array<string | NativeScorer>
    metadata?: Record<string, unknown>
    maxConcurrency?: number
    itemTimeout?: number
    maxRetries?: number
  }) => Promise<{
    experimentId: string
    status: "pending" | "running" | "completed" | "failed"
    totalItems: number
    succeededCount: number
    failedCount: number
    skippedCount: number
  }>
}

export type NativeSearchEvalMastra = {
  datasets: {
    list: (args?: {
      page?: number
      perPage?: number
    }) => Promise<{ datasets: DatasetRecord[] }>
    get: (args: { id: string }) => Promise<NativeDatasetLike>
    create: (input: {
      name: string
      description?: string
      inputSchema?: unknown
      groundTruthSchema?: unknown
      metadata?: Record<string, unknown>
      targetType?: "workflow"
      targetIds?: string[]
      scorerIds?: string[]
    }) => Promise<NativeDatasetLike>
  }
  listScorers?: () => Record<string, unknown> | undefined
  addScorer?: (scorer: NativeScorer, key?: string) => void
}

type SyncDatasetOutcome = {
  dataset: NativeDatasetLike
  datasetId: string
  name: string
  nativeKey: string
  itemCount: number
  status: "created" | "updated" | "reused"
  createdItems: number
  updatedItems: number
}

type ScorerRegistrationOutcome = {
  scorer: NativeScorer
  scorerId: typeof SEARCH_RESULT_PAIRWISE_SCORER_ID
  status: "registered" | "reused"
}

type ExperimentOutcome = {
  experimentId: string
  name: string
  nativeKey: string
  status: "created" | "reused"
}

export type NativeSearchEvalSyncResult = {
  projection: NativeSyncedMastraEvaluationProjection
  dataset: SyncDatasetOutcome
  scorer: ScorerRegistrationOutcome
  experiment: ExperimentOutcome
}

export type PromotedSearchEvalSyncResult = {
  dataset: SyncDatasetOutcome
  scorer: ScorerRegistrationOutcome
  skipped: Array<{ candidateId: string; reason: string }>
}

type Candidate = AdminCandidateListResponse["candidates"][number]

export function searchEvalNativeEnvironmentLabel(
  explicitLabel?: string,
): string {
  const raw =
    explicitLabel ??
    env.MASTRA_NATIVE_EVAL_ENVIRONMENT ??
    env.NODE_ENV ??
    "development"
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
  return normalized.length > 0 ? normalized.slice(0, 64) : "development"
}

export function isSampleNativeSearchEvalAllowed(environmentLabel: string) {
  if (env.NODE_ENV === "production") return false
  return !["prod", "production"].includes(environmentLabel)
}

export function scoreForOutcomeKind(kind: ReportOutcomeKind): number {
  if (kind === "win") return 1
  if (kind === "tie" || kind === "both-irrelevant") return 0.5
  if (kind === "judge-disagreement") return 0.5
  return 0
}

export const searchResultPairwiseJudgeScorer = createScorer({
  id: SEARCH_RESULT_PAIRWISE_SCORER_ID,
  name: "Search result pairwise judge",
  description:
    "Scores baseline-vs-current search eval outcomes while preserving search-specific result categories.",
  type: {
    input: NativeSearchEvalInputSchema,
    output: NativeSearchEvalOutputSchema,
  },
})
  .generateScore(({ run }) => scoreForOutcomeKind(run.output.outcomeKind))
  .generateReason(({ run, score }) => {
    const failure = run.output.failureCode
      ? ` Failure code: ${run.output.failureCode}.`
      : ""
    const rationale = run.output.rationale ? ` ${run.output.rationale}` : ""
    return `Outcome ${run.output.outcomeKind} mapped to native score ${score}.${failure}${rationale}`
  })

export function registerSearchEvalScorer(
  mastra: NativeSearchEvalMastra,
): ScorerRegistrationOutcome {
  const existing = mastra.listScorers?.() ?? {}
  if (
    Object.hasOwn(existing, SEARCH_RESULT_PAIRWISE_SCORER_ID) ||
    Object.values(existing).some(
      (scorer) =>
        scorer != null &&
        typeof scorer === "object" &&
        "id" in scorer &&
        (scorer as { id?: unknown }).id === SEARCH_RESULT_PAIRWISE_SCORER_ID,
    )
  ) {
    return {
      scorer: searchResultPairwiseJudgeScorer as unknown as NativeScorer,
      scorerId: SEARCH_RESULT_PAIRWISE_SCORER_ID,
      status: "reused",
    }
  }

  mastra.addScorer?.(
    searchResultPairwiseJudgeScorer as unknown as NativeScorer,
    SEARCH_RESULT_PAIRWISE_SCORER_ID,
  )
  return {
    scorer: searchResultPairwiseJudgeScorer as unknown as NativeScorer,
    scorerId: SEARCH_RESULT_PAIRWISE_SCORER_ID,
    status: "registered",
  }
}

export async function syncSearchEvalReportToNativeEvaluation(input: {
  mastra: NativeSearchEvalMastra
  report: SearchEvalReport
  reportPath?: string
  environmentLabel?: string
}): Promise<NativeSearchEvalSyncResult> {
  const environmentLabel = searchEvalNativeEnvironmentLabel(
    input.environmentLabel,
  )
  const scorer = registerSearchEvalScorer(input.mastra)
  const desiredItems = input.report.outcomes.map((outcome) =>
    nativeDatasetItemFromOutcome({
      report: input.report,
      outcome,
      reportPath: input.reportPath,
      environmentLabel,
    }),
  )
  const dataset = await upsertNativeDataset({
    mastra: input.mastra,
    name: nativeReportDatasetName(input.report, environmentLabel),
    description:
      "Search eval seed prompt outcomes projected from Forge offline search-eval reports.",
    nativeKey: nativeReportDatasetKey(input.report, environmentLabel),
    metadata: nativeReportDatasetMetadata(input.report, environmentLabel),
    items: desiredItems,
  })
  const experiment = await upsertNativeExperiment({
    dataset: dataset.dataset,
    report: input.report,
    reportPath: input.reportPath,
    environmentLabel,
  })
  const projection = nativeProjectionFromSync({
    report: input.report,
    environmentLabel,
    dataset,
    scorer,
    experiment,
  })

  return { projection, dataset, scorer, experiment }
}

export async function syncPromotedCandidatesToNativeDataset(input: {
  mastra: NativeSearchEvalMastra
  candidates: readonly Candidate[]
  environmentLabel?: string
}): Promise<PromotedSearchEvalSyncResult> {
  const environmentLabel = searchEvalNativeEnvironmentLabel(
    input.environmentLabel,
  )
  const scorer = registerSearchEvalScorer(input.mastra)
  const skipped: Array<{ candidateId: string; reason: string }> = []
  const items = input.candidates.flatMap((candidate) => {
    const item = nativeDatasetItemFromPromotedCandidate({
      candidate,
      environmentLabel,
    })
    if (!item.ok) {
      skipped.push({ candidateId: candidate.id, reason: item.reason })
      return []
    }
    return [item.item]
  })
  const dataset = await upsertNativeDataset({
    mastra: input.mastra,
    name: `search-eval:${environmentLabel}:promoted-regression`,
    description:
      "Human-promoted sanitized search eval regression prompts synced from Admin.",
    nativeKey: `search-eval:${environmentLabel}:promoted-regression`,
    metadata: {
      forgeSearchEval: {
        nativeKey: `search-eval:${environmentLabel}:promoted-regression`,
        kind: "promoted_regression_dataset",
        environmentLabel,
        source: "admin_search_eval_candidates",
      },
    },
    items,
  })

  return { dataset, scorer, skipped }
}

export function withNativeMastraEvaluationProjection(
  report: SearchEvalReport,
  projection: MastraEvaluationProjection,
): SearchEvalReport {
  return { ...report, mastraEvaluation: projection }
}

export function createSampleSearchEvalReport(input: {
  runId: string
  reportId?: string
  baselineName?: string
  now?: Date
}): SearchEvalReport {
  const startedAt = input.now ?? new Date()
  const finishedAt = new Date(startedAt.getTime() + 1120)
  const baselineName = input.baselineName ?? "local-smoke"
  return finalizeReport({
    schemaVersion: "1",
    kind: "comparison-report",
    reportId: input.reportId ?? input.runId,
    metadata: {
      mastraRunId: input.runId,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      baselineName,
      promptSetVersion: SAMPLE_PROMPT_SET_VERSION,
      adminSearchUrl: null,
      judgeModel: "sample-fixture",
      search: { limit: 5, mode: "hybrid", contentType: null },
    },
    calibration: { passed: true, matched: 3, total: 3, skipped: false },
    cost: {
      inputTokens: 0,
      outputTokens: 0,
      totalUsd: 0,
      pricingModel: "sample-fixture",
      estimated: false,
    },
    timings: { searchMs: 420, judgeMs: 700, totalMs: 1120 },
    judgeFailures: [],
    outcomes: sampleOutcomes(),
    exploratoryGenerated: [],
  })
}

function nativeReportDatasetName(
  report: SearchEvalReport,
  environmentLabel: string,
) {
  return `search-eval:${environmentLabel}:${report.metadata.baselineName}:${searchMode(
    report.metadata.search.mode,
  )}`
}

function nativeReportDatasetKey(
  report: SearchEvalReport,
  environmentLabel: string,
) {
  return `search-eval:${environmentLabel}:${report.metadata.baselineName}:${report.metadata.promptSetVersion}:mode:${searchMode(
    report.metadata.search.mode,
  )}`
}

function nativeReportExperimentName(
  report: SearchEvalReport,
  environmentLabel: string,
) {
  const verb = report.kind === "baseline-report" ? "baseline" : "compare"
  return `search-eval-${verb}:${environmentLabel}:${report.metadata.baselineName}:${searchMode(
    report.metadata.search.mode,
  )}:${report.reportId}`
}

function nativeReportExperimentKey(
  report: SearchEvalReport,
  environmentLabel: string,
) {
  return `${nativeReportDatasetKey(report, environmentLabel)}:report:${report.reportId}`
}

function nativeReportDatasetMetadata(
  report: SearchEvalReport,
  environmentLabel: string,
): Record<string, unknown> {
  return {
    forgeSearchEval: {
      nativeKey: nativeReportDatasetKey(report, environmentLabel),
      kind: "report_seed_prompt_dataset",
      environmentLabel,
      baselineName: report.metadata.baselineName,
      promptSetVersion: report.metadata.promptSetVersion,
      source: "search_eval_report",
      lastReportId: report.reportId,
      search: {
        limit: report.metadata.search.limit,
        mode: searchMode(report.metadata.search.mode),
        contentType: contentType(report.metadata.search.contentType),
      },
    },
  }
}

async function upsertNativeDataset(input: {
  mastra: NativeSearchEvalMastra
  name: string
  description: string
  nativeKey: string
  metadata: Record<string, unknown>
  items: Array<{
    input: NativeSearchEvalInput
    groundTruth: NativeSearchEvalGroundTruth
    metadata: Record<string, unknown>
    source?: { type: "json"; referenceId?: string }
  }>
}): Promise<SyncDatasetOutcome> {
  const existing = await findDatasetByNativeKey(input.mastra, input.nativeKey)
  const dataset =
    existing == null
      ? await input.mastra.datasets.create({
          name: input.name,
          description: input.description,
          inputSchema: NativeSearchEvalInputSchema,
          groundTruthSchema: NativeSearchEvalGroundTruthSchema,
          metadata: input.metadata,
          targetType: "workflow",
          targetIds: [NATIVE_SEARCH_EVAL_TARGET_ID],
          scorerIds: [SEARCH_RESULT_PAIRWISE_SCORER_ID],
        })
      : await input.mastra.datasets.get({ id: existing.id })

  let status: SyncDatasetOutcome["status"] =
    existing == null ? "created" : "reused"
  if (existing != null && dataset.update) {
    await dataset.update({
      name: input.name,
      description: input.description,
      inputSchema: NativeSearchEvalInputSchema,
      groundTruthSchema: NativeSearchEvalGroundTruthSchema,
      metadata: input.metadata,
      targetType: "workflow",
      targetIds: [NATIVE_SEARCH_EVAL_TARGET_ID],
      scorerIds: [SEARCH_RESULT_PAIRWISE_SCORER_ID],
    })
    status = "updated"
  }

  const itemResult = await upsertDatasetItems(dataset, input.items)
  return {
    dataset,
    datasetId: dataset.id,
    name: input.name,
    nativeKey: input.nativeKey,
    itemCount: input.items.length,
    status,
    ...itemResult,
  }
}

async function findDatasetByNativeKey(
  mastra: NativeSearchEvalMastra,
  nativeKey: string,
): Promise<DatasetRecord | null> {
  for (let page = 0; page < MAX_NATIVE_LIST_PAGES; page++) {
    const listed = await mastra.datasets.list({
      page,
      perPage: NATIVE_LIST_PAGE_SIZE,
    })
    const match = listed.datasets.find(
      (dataset) =>
        forgeMetadata(dataset.metadata).nativeKey === nativeKey ||
        dataset.name === nativeKey,
    )
    if (match) return match
    if (listed.datasets.length < NATIVE_LIST_PAGE_SIZE) return null
  }
  return null
}

async function upsertDatasetItems(
  dataset: NativeDatasetLike,
  desiredItems: Array<{
    input: NativeSearchEvalInput
    groundTruth: NativeSearchEvalGroundTruth
    metadata: Record<string, unknown>
    source?: { type: "json"; referenceId?: string }
  }>,
): Promise<{ createdItems: number; updatedItems: number }> {
  const existingItems = await listAllDatasetItems(dataset)
  const bySourceKey = new Map(
    existingItems.flatMap((item) => {
      const sourceKey = forgeMetadata(item.metadata).sourceKey
      return typeof sourceKey === "string" ? [[sourceKey, item] as const] : []
    }),
  )
  let createdItems = 0
  let updatedItems = 0
  const toCreate: typeof desiredItems = []
  for (const item of desiredItems) {
    const sourceKey = forgeMetadata(item.metadata).sourceKey
    const existing =
      typeof sourceKey === "string" ? bySourceKey.get(sourceKey) : undefined
    if (!existing) {
      toCreate.push(item)
      continue
    }
    await dataset.updateItem({
      itemId: existing.id,
      input: item.input,
      groundTruth: item.groundTruth,
      metadata: item.metadata,
    })
    updatedItems++
  }
  if (toCreate.length > 0) {
    await dataset.addItems({ items: toCreate })
    createdItems = toCreate.length
  }
  return { createdItems, updatedItems }
}

async function upsertNativeExperiment(input: {
  dataset: NativeDatasetLike
  report: SearchEvalReport
  reportPath?: string
  environmentLabel: string
}): Promise<ExperimentOutcome> {
  const nativeKey = nativeReportExperimentKey(
    input.report,
    input.environmentLabel,
  )
  const name = nativeReportExperimentName(input.report, input.environmentLabel)
  const existing = await findExperimentByNativeKey(input.dataset, nativeKey)
  if (existing) {
    return {
      experimentId: existing.id,
      name: existing.name ?? name,
      nativeKey,
      status: "reused",
    }
  }

  const outputBySourceKey = new Map(
    input.report.outcomes.map((outcome) => [
      reportOutcomeSourceKey(input.report, outcome),
      nativeOutputFromOutcome(outcome),
    ]),
  )
  const summary = await input.dataset.startExperiment<
    NativeSearchEvalInput,
    NativeSearchEvalOutput,
    NativeSearchEvalGroundTruth
  >({
    name,
    description:
      "Native Mastra Evaluation experiment projected from a Forge search-eval report.",
    targetType: "workflow",
    targetId: NATIVE_SEARCH_EVAL_TARGET_ID,
    task: async ({ metadata }) => {
      const sourceKey = forgeMetadata(metadata).sourceKey
      const output =
        typeof sourceKey === "string"
          ? outputBySourceKey.get(sourceKey)
          : undefined
      if (!output) {
        throw new Error("search eval native output missing for dataset item")
      }
      return output
    },
    maxConcurrency: 4,
    itemTimeout: 10_000,
    maxRetries: 0,
    metadata: {
      forgeSearchEval: {
        nativeKey,
        kind: "report_experiment",
        environmentLabel: input.environmentLabel,
        reportId: input.report.reportId,
        reportPath: input.reportPath ?? null,
        baselineName: input.report.metadata.baselineName,
        promptSetVersion: input.report.metadata.promptSetVersion,
        totals: input.report.totals,
        localeMix: input.report.localeMix,
        promptSourceMix: input.report.promptSourceMix,
        generatedCandidateBehavior: input.report.generatedCandidateBehavior,
        cost: input.report.cost,
        timings: input.report.timings,
      },
    },
  })
  return {
    experimentId: summary.experimentId,
    name,
    nativeKey,
    status: "created",
  }
}

async function findExperimentByNativeKey(
  dataset: NativeDatasetLike,
  nativeKey: string,
): Promise<Experiment | null> {
  for (let page = 0; page < MAX_NATIVE_LIST_PAGES; page++) {
    const listed = await dataset.listExperiments({
      page,
      perPage: NATIVE_LIST_PAGE_SIZE,
    })
    const match = listed.experiments.find(
      (experiment) =>
        forgeMetadata(experiment.metadata).nativeKey === nativeKey,
    )
    if (match) return match
    if (listed.experiments.length < NATIVE_LIST_PAGE_SIZE) return null
  }
  return null
}

function nativeProjectionFromSync(input: {
  report: SearchEvalReport
  environmentLabel: string
  dataset: SyncDatasetOutcome
  scorer: ScorerRegistrationOutcome
  experiment: ExperimentOutcome
}): NativeSyncedMastraEvaluationProjection {
  const mode =
    input.report.kind === "baseline-report" ? "baseline_capture" : "comparison"
  return {
    integrationStatus: "native_synced",
    dataset: {
      name: input.dataset.name,
      datasetId: input.dataset.datasetId,
      source: "seed_prompt_set",
      version: input.report.metadata.promptSetVersion,
      itemCount: input.report.outcomes.length,
      targetType: "workflow",
      targetId: NATIVE_SEARCH_EVAL_TARGET_ID,
      environmentLabel: input.environmentLabel,
      nativeKey: input.dataset.nativeKey,
      status: input.dataset.status,
    },
    scorers: [
      {
        id: SEARCH_RESULT_PAIRWISE_SCORER_ID,
        scorerId: input.scorer.scorerId,
        status: input.scorer.status,
        kind: "pairwise_search_results",
      },
    ],
    experiment: {
      name: input.experiment.name,
      experimentId: input.experiment.experimentId,
      status: input.experiment.status,
      mode,
      reportId: input.report.reportId,
      baselineName: input.report.metadata.baselineName,
      environmentLabel: input.environmentLabel,
      nativeKey: input.experiment.nativeKey,
    },
  }
}

function nativeDatasetItemFromOutcome(input: {
  report: SearchEvalReport
  outcome: ComparisonOutcome
  reportPath?: string
  environmentLabel: string
}) {
  const sourceKey = reportOutcomeSourceKey(input.report, input.outcome)
  return {
    input: {
      query: input.outcome.queryText,
      locale: input.outcome.locale,
      languageSlug: input.outcome.languageSlug ?? null,
      websiteLocale: input.outcome.websiteLocale ?? null,
      source: input.outcome.source,
      searchOptions: {
        limit: input.report.metadata.search.limit,
        mode: searchMode(input.report.metadata.search.mode),
        contentType: contentType(input.report.metadata.search.contentType),
      },
    },
    groundTruth: {
      expectedResultNotes: input.outcome.rationale ?? null,
      sourceAnchors: input.outcome.baselineResults
        .slice(0, 5)
        .map(resultAnchor),
      baselineTopResults: input.outcome.baselineResults
        .slice(0, 5)
        .map(nativeResult),
    },
    source: { type: "json" as const, referenceId: input.report.reportId },
    metadata: {
      forgeSearchEval: {
        sourceKey,
        kind: "report_outcome_item",
        environmentLabel: input.environmentLabel,
        reportId: input.report.reportId,
        reportPath: input.reportPath ?? null,
        baselineName: input.report.metadata.baselineName,
        promptSetVersion: input.report.metadata.promptSetVersion,
        caseId: input.outcome.caseId,
        locale: input.outcome.locale,
        languageSlug: input.outcome.languageSlug ?? null,
        websiteLocale: input.outcome.websiteLocale ?? null,
        promptSource: input.outcome.source,
        outcomeKind: input.outcome.kind,
        generatedCandidate: false,
        verdicts: input.outcome.verdicts ?? null,
        searchFailureCode: input.outcome.searchFailure?.code ?? null,
      },
    },
  }
}

function nativeOutputFromOutcome(
  outcome: ComparisonOutcome,
): NativeSearchEvalOutput {
  return {
    outcomeKind: outcome.kind,
    caseId: outcome.caseId,
    locale: outcome.locale,
    languageSlug: outcome.languageSlug ?? null,
    websiteLocale: outcome.websiteLocale ?? null,
    query: outcome.queryText,
    baselineTopResults: outcome.baselineResults.slice(0, 5).map(nativeResult),
    currentTopResults: outcome.currentResults.slice(0, 5).map(nativeResult),
    rationale: outcome.rationale ?? null,
    verdicts: outcome.verdicts ? [...outcome.verdicts] : null,
    failureCode: outcome.searchFailure?.code ?? null,
  }
}

function nativeDatasetItemFromPromotedCandidate(input: {
  candidate: Candidate
  environmentLabel: string
}):
  | {
      ok: true
      item: {
        input: NativeSearchEvalInput
        groundTruth: NativeSearchEvalGroundTruth
        metadata: Record<string, unknown>
        source: { type: "json"; referenceId: string }
      }
    }
  | { ok: false; reason: string } {
  const { candidate } = input
  if (candidate.promotionStatus !== "promoted") {
    return { ok: false, reason: "not_promoted" }
  }
  if (candidate.sanitizationStatus !== "sanitized") {
    return { ok: false, reason: "not_sanitized" }
  }
  if (!candidate.sanitizedQueryText) {
    return { ok: false, reason: "missing_sanitized_query" }
  }
  return {
    ok: true,
    item: {
      input: {
        query: candidate.sanitizedQueryText,
        locale: candidate.locale,
        source: promotedSource(candidate.source),
        searchOptions: { limit: 20, mode: "hybrid", contentType: "all" },
      },
      groundTruth: {
        expectedResultNotes: candidate.sanitizedExpectedResultNotes ?? null,
        sourceAnchors: Array.isArray(candidate.sanitizedSourceAnchors)
          ? candidate.sanitizedSourceAnchors
          : [],
      },
      source: { type: "json", referenceId: candidate.id },
      metadata: {
        forgeSearchEval: {
          sourceKey: `admin-candidate:${candidate.id}`,
          kind: "promoted_candidate_item",
          environmentLabel: input.environmentLabel,
          candidateId: candidate.id,
          source: candidate.source,
          sanitizationStatus: candidate.sanitizationStatus,
          reviewerIdentity: candidate.reviewerIdentity ?? null,
          reviewedAt: candidate.reviewedAt ?? null,
          promotedAt: candidate.promotedAt ?? null,
          mastraRunId: candidate.mastraRunId ?? null,
          promotionRunContextKeys: objectKeys(candidate.promotionRunContext),
        },
      },
    },
  }
}

function reportOutcomeSourceKey(
  report: SearchEvalReport,
  outcome: ComparisonOutcome,
) {
  return `prompt-set:${report.metadata.promptSetVersion}:mode:${searchMode(
    report.metadata.search.mode,
  )}:case:${outcome.caseId}`
}

function nativeResult(result: SearchEvalResult) {
  return {
    type: result.type,
    id: result.id,
    slug: result.slug,
    title: result.title,
    score: result.score,
    label: result.label,
  }
}

function resultAnchor(result: SearchEvalResult) {
  return {
    type: result.type,
    id: result.id,
    slug: result.slug,
    title: result.title,
  }
}

function searchMode(
  mode: string | null,
): "hybrid" | "keyword-first" | "semantic-only" {
  if (mode === "semantic-only") return "semantic-only"
  return mode === "keyword-first" ? "keyword-first" : "hybrid"
}

function contentType(
  value: "video" | "experience" | null,
): "all" | "video" | "experience" {
  return value ?? "all"
}

function promotedSource(
  source: Candidate["source"],
): NativeSearchEvalInput["source"] {
  if (source === "catalog") return "generated_catalog"
  if (source === "locale_quality") return "generated_locale_quality"
  if (source === "trace") return "generated_trace"
  return source
}

function normalizeItemsList(
  value: DatasetItem[] | { items: DatasetItem[] },
): DatasetItem[] {
  return Array.isArray(value) ? value : value.items
}

async function listAllDatasetItems(
  dataset: NativeDatasetLike,
): Promise<DatasetItem[]> {
  const items: DatasetItem[] = []
  for (let page = 0; page < MAX_NATIVE_LIST_PAGES; page++) {
    const current = normalizeItemsList(
      await dataset.listItems({ page, perPage: NATIVE_LIST_PAGE_SIZE }),
    )
    items.push(...current)
    if (current.length < NATIVE_LIST_PAGE_SIZE) break
  }
  return items
}

function forgeMetadata(metadata: unknown): Record<string, unknown> {
  if (metadata == null || typeof metadata !== "object") return {}
  const forge = (metadata as { forgeSearchEval?: unknown }).forgeSearchEval
  return forge != null && typeof forge === "object" && !Array.isArray(forge)
    ? (forge as Record<string, unknown>)
    : {}
}

function objectKeys(value: unknown): string[] {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return []
  }
  return Object.keys(value).slice(0, 20)
}

function sampleResult(input: {
  type: "video" | "experience"
  id: string
  slug: string
  title: string
  snippet: string
  score: number
  label?: string | null
}): SearchEvalResult {
  return {
    type: input.type,
    id: input.id,
    slug: input.slug,
    title: input.title,
    imageUrl: null,
    snippet: input.snippet,
    startSeconds: null,
    playbackId: null,
    score: input.score,
    label: input.label ?? null,
    durationSeconds: null,
    childCount: null,
  }
}

function sampleOutcomes(): ComparisonOutcome[] {
  return [
    {
      kind: "win",
      caseId: "sample-who-is-jesus",
      locale: "en",
      queryText: "Who is Jesus?",
      source: "seed",
      baselineResults: [
        sampleResult({
          type: "video",
          id: "video-baseline-jesus",
          slug: "jesus-film-clip",
          title: "JESUS Film Clip",
          snippet: "A baseline clip about Jesus from the JESUS film.",
          score: 0.72,
        }),
      ],
      currentResults: [
        sampleResult({
          type: "experience",
          id: "experience-current-jesus",
          slug: "who-is-jesus",
          title: "Who Is Jesus?",
          snippet: "A stronger experience explaining who Jesus is.",
          score: 0.93,
        }),
      ],
      verdicts: ["clearly-B-better", "clearly-A-better"],
      rationale:
        "Current results put the direct explanatory experience first and better match the query intent.",
    },
    {
      kind: "tie",
      caseId: "sample-bible-project",
      locale: "en",
      queryText: "Bible Project",
      source: "seed",
      baselineResults: [
        sampleResult({
          type: "video",
          id: "video-baseline-bible-project",
          slug: "bible-project-overview",
          title: "BibleProject Overview",
          snippet: "A relevant overview for BibleProject searches.",
          score: 0.88,
        }),
      ],
      currentResults: [
        sampleResult({
          type: "video",
          id: "video-current-bible-project",
          slug: "bible-project-overview",
          title: "BibleProject Overview",
          snippet: "The same strong BibleProject overview remains first.",
          score: 0.9,
        }),
      ],
      verdicts: ["tie", "tie"],
      rationale:
        "Both result sets satisfy the branded query with the same primary result.",
    },
    {
      kind: "both-irrelevant",
      caseId: "sample-vague-query",
      locale: "en",
      queryText: "random ocean clip",
      source: "seed",
      baselineResults: [],
      currentResults: [],
      verdicts: ["both-irrelevant", "both-irrelevant"],
      rationale:
        "Neither result set contains a safe search result for the deliberately out-of-domain query.",
    },
  ]
}
