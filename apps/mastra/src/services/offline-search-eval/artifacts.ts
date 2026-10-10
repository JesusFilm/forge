import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import { z } from "zod"

import { env, getMastraStorageDir } from "../../config/env"
import {
  DEFAULT_SEARCH_EVAL_CALLER_TRACK,
  SEARCH_EVAL_CALLER_TRACK_IDS,
  SEARCH_EVAL_SEARCH_MODES,
  type BaselineArtifact,
  type SearchEvalReport,
} from "./types"

const SAFE_ARTIFACT_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/
const MAX_BASELINE_CASES = 150
const MAX_RESULT_COUNT = 50
const MAX_SAFE_TEXT = 1024
const MAX_TAGS = 20

const SearchEvalCallerTrackSchema = z.enum(SEARCH_EVAL_CALLER_TRACK_IDS)
const SearchEvalSearchModeSchema = z.enum(SEARCH_EVAL_SEARCH_MODES)

const SearchEvalResultSchema = z
  .object({
    type: z.enum(["video", "experience"]),
    id: z.string().max(128),
    slug: z.string().max(256),
    title: z.string().max(256),
    imageUrl: z.string().nullable(),
    snippet: z.string().max(MAX_SAFE_TEXT),
    startSeconds: z.number().nullable(),
    playbackId: z.string().nullable(),
    score: z.number(),
    label: z.string().nullable(),
    durationSeconds: z.number().nullable(),
    childCount: z.number().nullable(),
    canonicalVideoId: z.string().max(128).optional(),
    languageSlug: z.string().max(128).nullable().optional(),
  })
  .strict()

const SearchFailureSchema = z
  .object({
    code: z.enum([
      "config_missing",
      "auth_failed",
      "rate_limited",
      "rejected",
      "network_error",
      "parse_error",
      "search_failed",
      "judge_failed",
    ]),
    retryable: z.boolean(),
    status: z.number().optional(),
    message: z.string().optional(),
  })
  .strict()

const ReportOutcomeKindSchema = z.enum([
  "win",
  "loss",
  "tie",
  "both-irrelevant",
  "judge-disagreement",
  "judge-failure",
  "search-failure",
])

const JudgeVerdictSchema = z.enum([
  "clearly-A-better",
  "slightly-A-better",
  "tie",
  "slightly-B-better",
  "clearly-B-better",
  "both-irrelevant",
])

const SearchEvalMetadataSchema = z
  .object({
    mastraRunId: z.string(),
    startedAt: z.string(),
    finishedAt: z.string(),
    baselineName: z.string(),
    callerTrack: SearchEvalCallerTrackSchema.default(
      DEFAULT_SEARCH_EVAL_CALLER_TRACK,
    ),
    promptSetVersion: z.string(),
    adminSearchUrl: z.string().max(512).nullable(),
    servingRevision: z.string().min(1).max(128).nullable().default(null),
    judgeModel: z.string().nullable(),
    search: z
      .object({
        limit: z.number().int().positive(),
        mode: z.string().nullable(),
        contentType: z.enum(["video", "experience"]).nullable(),
      })
      .strict(),
  })
  .strict()

const BaselineCaseSchema = z
  .object({
    caseId: z.string().max(128),
    locale: z.string().max(32),
    languageSlug: z.string().max(128).optional(),
    websiteLocale: z.string().max(32).optional(),
    queryText: z.string().max(MAX_SAFE_TEXT),
    source: z.literal("seed"),
    callerTrack: SearchEvalCallerTrackSchema.default(
      DEFAULT_SEARCH_EVAL_CALLER_TRACK,
    ),
    tags: z.array(z.string().max(64)).max(MAX_TAGS),
    operatorNotes: z.string().max(MAX_SAFE_TEXT).optional(),
    serverRevision: z.string().min(1).max(128).optional(),
    results: z.array(SearchEvalResultSchema).max(MAX_RESULT_COUNT),
    searchFailure: SearchFailureSchema.optional(),
  })
  .strict()

export const BaselineArtifactSchema = z
  .object({
    schemaVersion: z.literal("1"),
    kind: z.literal("baseline"),
    name: z.string(),
    capturedAt: z.string(),
    metadata: SearchEvalMetadataSchema,
    cases: z.array(BaselineCaseSchema).min(1).max(MAX_BASELINE_CASES),
  })
  .strict()
  .superRefine((baseline, context) => {
    const servingRevision = baseline.metadata.servingRevision
    if (servingRevision == null) return

    baseline.cases.forEach((entry, index) => {
      if (entry.serverRevision !== servingRevision) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cases", index, "serverRevision"],
          message: "baseline case revision must match metadata servingRevision",
        })
      }
    })
  })

const ArtifactOnlyMastraEvaluationProjectionSchema = z
  .object({
    integrationStatus: z.literal("custom_artifact_only"),
    dataset: z
      .object({
        name: z.string().max(256),
        datasetId: z.null(),
        source: z.literal("seed_prompt_set"),
        version: z.string().max(128),
        itemCount: z.number().int().nonnegative().max(MAX_BASELINE_CASES),
        targetType: z.literal("workflow"),
        targetId: z.literal("offline-search-eval"),
      })
      .strict(),
    scorers: z
      .array(
        z
          .object({
            id: z.literal("search-result-pairwise-judge"),
            scorerId: z.null(),
            status: z.literal("not_registered"),
            kind: z.literal("pairwise_search_results"),
          })
          .strict(),
      )
      .min(1)
      .max(10),
    experiment: z
      .object({
        name: z.string().max(256),
        experimentId: z.null(),
        status: z.literal("not_created"),
        mode: z.enum(["baseline_capture", "comparison"]),
        reportId: z.string().max(128),
        baselineName: z.string().max(128),
      })
      .strict(),
  })
  .strict()

const NativeSyncedMastraEvaluationProjectionSchema = z
  .object({
    integrationStatus: z.literal("native_synced"),
    dataset: z
      .object({
        name: z.string().max(256),
        datasetId: z.string().min(1).max(256),
        source: z.literal("seed_prompt_set"),
        version: z.string().max(128),
        itemCount: z.number().int().nonnegative().max(MAX_BASELINE_CASES),
        targetType: z.literal("workflow"),
        targetId: z.literal("offline-search-eval"),
        environmentLabel: z.string().min(1).max(64),
        nativeKey: z.string().min(1).max(512),
        status: z.enum(["created", "updated", "reused"]),
      })
      .strict(),
    scorers: z
      .array(
        z
          .object({
            id: z.literal("search-result-pairwise-judge"),
            scorerId: z.string().min(1).max(256),
            status: z.enum(["registered", "reused"]),
            kind: z.literal("pairwise_search_results"),
          })
          .strict(),
      )
      .min(1)
      .max(10),
    experiment: z
      .object({
        name: z.string().max(256),
        experimentId: z.string().min(1).max(256),
        status: z.enum(["created", "reused"]),
        mode: z.enum(["baseline_capture", "comparison"]),
        reportId: z.string().max(128),
        baselineName: z.string().max(128),
        environmentLabel: z.string().min(1).max(64),
        nativeKey: z.string().min(1).max(512),
      })
      .strict(),
  })
  .strict()

const MastraEvaluationProjectionSchema = z.discriminatedUnion(
  "integrationStatus",
  [
    ArtifactOnlyMastraEvaluationProjectionSchema,
    NativeSyncedMastraEvaluationProjectionSchema,
  ],
)

const ComparisonOutcomeSchema = z
  .object({
    kind: ReportOutcomeKindSchema,
    caseId: z.string().max(128),
    locale: z.string().max(32),
    languageSlug: z.string().max(128).optional(),
    websiteLocale: z.string().max(32).optional(),
    queryText: z.string().max(MAX_SAFE_TEXT),
    source: z.literal("seed"),
    callerTrack: SearchEvalCallerTrackSchema.default(
      DEFAULT_SEARCH_EVAL_CALLER_TRACK,
    ),
    baselineResults: z.array(SearchEvalResultSchema).max(MAX_RESULT_COUNT),
    currentResults: z.array(SearchEvalResultSchema).max(MAX_RESULT_COUNT),
    verdicts: z.tuple([JudgeVerdictSchema, JudgeVerdictSchema]).optional(),
    rationale: z.string().max(MAX_SAFE_TEXT).optional(),
    searchFailure: SearchFailureSchema.optional(),
  })
  .strict()

const ExploratoryGeneratedOutcomeSchema = z
  .object({
    candidateId: z.string().max(128),
    locale: z.string().max(32),
    source: z.enum([
      "generated_catalog",
      "generated_locale_quality",
      "generated_trace",
    ]),
    traceDerived: z.boolean(),
    queryText: z.string().max(MAX_SAFE_TEXT).nullable(),
    queryHash: z.string().max(128).nullable(),
    retentionExpiresAt: z.string().nullable(),
    skippedReason: z.literal("trace_derived_not_judged_or_searched").optional(),
    results: z.array(SearchEvalResultSchema).max(MAX_RESULT_COUNT),
    searchFailure: SearchFailureSchema.optional(),
  })
  .strict()

const TrackSummarySchema = z
  .object({
    callerTrack: SearchEvalCallerTrackSchema,
    caller: z.string().max(256),
    job: z.string().max(512),
    mode: z.string().max(64).nullable(),
    defaultMode: SearchEvalSearchModeSchema,
    suitableMode: z.boolean(),
    successCriteria: z.array(z.string().max(512)).max(10),
    totals: z
      .object({
        queries: z.number().int().nonnegative(),
        wins: z.number().int().nonnegative(),
        losses: z.number().int().nonnegative(),
        ties: z.number().int().nonnegative(),
        bothIrrelevant: z.number().int().nonnegative(),
        judgeDisagreements: z.number().int().nonnegative(),
        judgeFailures: z.number().int().nonnegative(),
        searchFailures: z.number().int().nonnegative(),
        netWinRate: z.number(),
      })
      .strict(),
    noResultCases: z.number().int().nonnegative(),
    representativeFailures: z
      .array(
        z
          .object({
            caseId: z.string().max(128),
            queryText: z.string().max(MAX_SAFE_TEXT),
            kind: ReportOutcomeKindSchema,
            rationale: z.string().max(MAX_SAFE_TEXT).optional(),
            topResults: z.array(z.string().max(256)).max(5),
          })
          .strict(),
      )
      .max(5),
  })
  .strict()

export const SearchEvalReportSchema = z
  .object({
    schemaVersion: z.literal("1"),
    kind: z.enum(["baseline-report", "comparison-report"]),
    reportId: z.string().max(128),
    metadata: SearchEvalMetadataSchema,
    mastraEvaluation: MastraEvaluationProjectionSchema,
    baseline: z
      .object({
        name: z.string().max(128),
        capturedAt: z.string(),
        caseCount: z.number().int().nonnegative().max(MAX_BASELINE_CASES),
        search: SearchEvalMetadataSchema.shape.search,
        searchConfigMismatch: z.boolean().optional(),
      })
      .strict()
      .optional(),
    calibration: z
      .object({
        passed: z.boolean(),
        matched: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
        skipped: z.boolean(),
      })
      .strict(),
    totals: z
      .object({
        queries: z.number().int().nonnegative(),
        wins: z.number().int().nonnegative(),
        losses: z.number().int().nonnegative(),
        ties: z.number().int().nonnegative(),
        bothIrrelevant: z.number().int().nonnegative(),
        judgeDisagreements: z.number().int().nonnegative(),
        judgeFailures: z.number().int().nonnegative(),
        searchFailures: z.number().int().nonnegative(),
        netWinRate: z.number(),
      })
      .strict(),
    localeMix: z.record(z.string(), z.number().int().nonnegative()),
    promptSourceMix: z.record(z.string(), z.number().int().nonnegative()),
    callerTrackMix: z
      .record(z.string(), z.number().int().nonnegative())
      .default({}),
    trackSummaries: z.array(TrackSummarySchema).max(10).default([]),
    generatedCandidateBehavior: z
      .object({
        included: z.number().int().nonnegative(),
        searched: z.number().int().nonnegative(),
        traceDerived: z.number().int().nonnegative(),
        skippedTraceDerived: z.number().int().nonnegative(),
        searchFailures: z.number().int().nonnegative(),
        readFailure: SearchFailureSchema.optional(),
      })
      .strict(),
    cost: z
      .object({
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
        totalUsd: z.number().nonnegative().nullable(),
        pricingModel: z.string().nullable(),
        estimated: z.boolean(),
      })
      .strict(),
    timings: z
      .object({
        searchMs: z.number().nonnegative(),
        judgeMs: z.number().nonnegative(),
        totalMs: z.number().nonnegative(),
      })
      .strict(),
    judgeFailures: z.array(SearchFailureSchema).max(MAX_BASELINE_CASES),
    outcomes: z.array(ComparisonOutcomeSchema).max(MAX_BASELINE_CASES),
    exploratoryGenerated: z
      .array(ExploratoryGeneratedOutcomeSchema)
      .max(MAX_BASELINE_CASES),
  })
  .strict()
  .superRefine((report, context) => {
    const expectedExperimentMode =
      report.kind === "baseline-report" ? "baseline_capture" : "comparison"
    const expectedExperimentVerb =
      report.kind === "baseline-report" ? "baseline" : "compare"
    const environmentLabel =
      report.mastraEvaluation.integrationStatus === "native_synced"
        ? report.mastraEvaluation.dataset.environmentLabel
        : null
    const callerTrack =
      report.metadata.callerTrack ?? DEFAULT_SEARCH_EVAL_CALLER_TRACK
    const pipelineMode =
      report.metadata.search.mode === "semantic-only"
        ? "semantic-only"
        : report.metadata.search.mode === "keyword-first"
          ? "keyword-first"
          : "hybrid"
    const legacyDatasetName =
      environmentLabel == null
        ? `search-eval:${report.metadata.baselineName}`
        : `search-eval:${environmentLabel}:${report.metadata.baselineName}`
    const modeAwareDatasetName = `${legacyDatasetName}:${pipelineMode}`
    const trackAwareDatasetName = `${legacyDatasetName}:${callerTrack}:${pipelineMode}`
    const expectedDatasetNames = [
      legacyDatasetName,
      modeAwareDatasetName,
      trackAwareDatasetName,
    ] as const
    const legacyExperimentName =
      environmentLabel == null
        ? `search-eval-${expectedExperimentVerb}:${report.metadata.baselineName}:${report.reportId}`
        : `search-eval-${expectedExperimentVerb}:${environmentLabel}:${report.metadata.baselineName}:${report.reportId}`
    const modeAwareExperimentName =
      environmentLabel == null
        ? `search-eval-${expectedExperimentVerb}:${report.metadata.baselineName}:${pipelineMode}:${report.reportId}`
        : `search-eval-${expectedExperimentVerb}:${environmentLabel}:${report.metadata.baselineName}:${pipelineMode}:${report.reportId}`
    const trackAwareExperimentName =
      environmentLabel == null
        ? `search-eval-${expectedExperimentVerb}:${report.metadata.baselineName}:${callerTrack}:${pipelineMode}:${report.reportId}`
        : `search-eval-${expectedExperimentVerb}:${environmentLabel}:${report.metadata.baselineName}:${callerTrack}:${pipelineMode}:${report.reportId}`
    const expectedExperimentNames = [
      legacyExperimentName,
      modeAwareExperimentName,
      trackAwareExperimentName,
    ] as const

    if (
      !(expectedDatasetNames as readonly string[]).includes(
        report.mastraEvaluation.dataset.name,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mastraEvaluation", "dataset", "name"],
        message: "dataset name must match the report baseline name and mode",
      })
    }
    if (
      report.mastraEvaluation.dataset.version !==
      report.metadata.promptSetVersion
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mastraEvaluation", "dataset", "version"],
        message: "dataset version must match the report prompt set version",
      })
    }
    if (report.mastraEvaluation.dataset.itemCount !== report.outcomes.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mastraEvaluation", "dataset", "itemCount"],
        message: "dataset item count must match report outcome count",
      })
    }
    if (
      !(expectedExperimentNames as readonly string[]).includes(
        report.mastraEvaluation.experiment.name,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mastraEvaluation", "experiment", "name"],
        message: "experiment name must match the report kind, mode, and id",
      })
    }
    if (report.mastraEvaluation.experiment.mode !== expectedExperimentMode) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mastraEvaluation", "experiment", "mode"],
        message: "experiment mode must match the report kind",
      })
    }
    if (report.mastraEvaluation.experiment.reportId !== report.reportId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mastraEvaluation", "experiment", "reportId"],
        message: "experiment report id must match the report id",
      })
    }
    if (
      report.mastraEvaluation.experiment.baselineName !==
      report.metadata.baselineName
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mastraEvaluation", "experiment", "baselineName"],
        message: "experiment baseline name must match report metadata",
      })
    }
    if (
      report.mastraEvaluation.integrationStatus === "native_synced" &&
      report.mastraEvaluation.experiment.environmentLabel !== environmentLabel
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mastraEvaluation", "experiment", "environmentLabel"],
        message: "experiment environment must match dataset environment",
      })
    }

    report.exploratoryGenerated.forEach((outcome, index) => {
      if (!outcome.traceDerived) return
      if (outcome.queryText !== "[redacted-trace-derived-query]") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["exploratoryGenerated", index, "queryText"],
          message: "trace-derived generated query text must be redacted",
        })
      }
      if (outcome.queryHash !== null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["exploratoryGenerated", index, "queryHash"],
          message: "trace-derived generated query hash must be redacted",
        })
      }
      if (outcome.results.length > 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["exploratoryGenerated", index, "results"],
          message: "trace-derived generated results must be redacted",
        })
      }
    })
  })

export class SearchEvalArtifactError extends Error {
  constructor(
    readonly code:
      | "invalid_name"
      | "not_found"
      | "read_failed"
      | "write_failed"
      | "invalid_artifact",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "SearchEvalArtifactError"
  }
}

export type SearchEvalArtifactStore = {
  readonly rootDir: string
  writeBaseline: (baseline: BaselineArtifact) => Promise<{ path: string }>
  writeBaselineCapture?: (
    baseline: BaselineArtifact,
    report: SearchEvalReport,
  ) => Promise<{ baselinePath: string; reportPath: string }>
  readBaseline: (name: string) => Promise<BaselineArtifact>
  writeReport: (report: SearchEvalReport) => Promise<{ path: string }>
  readReport: (reportId: string) => Promise<SearchEvalReport>
}

export function searchEvalArtifactRoot() {
  return (
    env.MASTRA_SEARCH_EVAL_ARTIFACT_DIR ??
    path.join(getMastraStorageDir(), "search-eval")
  )
}

function assertSafeName(name: string): string {
  const normalized = name.trim()
  if (
    normalized.length === 0 ||
    normalized.includes("..") ||
    path.basename(normalized) !== normalized ||
    !SAFE_ARTIFACT_NAME.test(normalized)
  ) {
    throw new SearchEvalArtifactError(
      "invalid_name",
      "artifact name must be a safe slug",
    )
  }
  return normalized
}

function baselinePath(rootDir: string, name: string): string {
  return path.join(rootDir, "baselines", `${assertSafeName(name)}.json`)
}

function reportPath(rootDir: string, reportId: string): string {
  return path.join(rootDir, "reports", `${assertSafeName(reportId)}.json`)
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  const dir = path.dirname(filePath)
  const tmpPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  )
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(tmpPath, JSON.stringify(value, null, 2) + "\n", "utf8")
    await rename(tmpPath, filePath)
  } catch (cause) {
    await rm(tmpPath, { force: true }).catch(() => undefined)
    throw new SearchEvalArtifactError(
      "write_failed",
      "failed to write search eval artifact",
      cause,
    )
  }
}

function isNodeErrorCode(cause: unknown, code: string): boolean {
  return (
    cause != null &&
    typeof cause === "object" &&
    "code" in cause &&
    (cause as { code?: unknown }).code === code
  )
}

export function createSearchEvalArtifactStore(
  rootDir = searchEvalArtifactRoot(),
): SearchEvalArtifactStore {
  return {
    rootDir,
    async writeBaseline(baseline) {
      const parsed = BaselineArtifactSchema.safeParse(baseline)
      if (!parsed.success) {
        throw new SearchEvalArtifactError(
          "invalid_artifact",
          "search eval baseline failed artifact validation",
          parsed.error,
        )
      }
      const filePath = baselinePath(rootDir, baseline.name)
      await writeJson(filePath, parsed.data)
      return { path: filePath }
    },
    async writeBaselineCapture(baseline, report) {
      const parsedBaseline = BaselineArtifactSchema.safeParse(baseline)
      const parsedReport = SearchEvalReportSchema.safeParse(report)
      if (!parsedBaseline.success || !parsedReport.success) {
        throw new SearchEvalArtifactError(
          "invalid_artifact",
          "search eval baseline capture failed artifact validation",
          parsedBaseline.success ? parsedReport.error : parsedBaseline.error,
        )
      }
      const baselineFilePath = baselinePath(rootDir, baseline.name)
      const reportFilePath = reportPath(rootDir, report.reportId)
      let previousReport: string | null = null
      try {
        previousReport = await readFile(reportFilePath, "utf8")
      } catch (cause) {
        if (!isNodeErrorCode(cause, "ENOENT")) {
          throw new SearchEvalArtifactError(
            "read_failed",
            "existing search eval report could not be preserved",
            cause,
          )
        }
      }

      await writeJson(reportFilePath, parsedReport.data)
      try {
        await writeJson(baselineFilePath, parsedBaseline.data)
      } catch (cause) {
        try {
          if (previousReport == null) {
            await rm(reportFilePath, { force: true })
          } else {
            await writeFile(reportFilePath, previousReport, "utf8")
          }
        } catch (rollbackCause) {
          throw new SearchEvalArtifactError(
            "write_failed",
            "baseline capture failed and its report rollback also failed",
            { cause, rollbackCause },
          )
        }
        throw cause
      }
      return {
        baselinePath: baselineFilePath,
        reportPath: reportFilePath,
      }
    },
    async readBaseline(name) {
      const filePath = baselinePath(rootDir, name)
      let text: string
      try {
        text = await readFile(filePath, "utf8")
      } catch (cause) {
        if (!isNodeErrorCode(cause, "ENOENT")) {
          throw new SearchEvalArtifactError(
            "read_failed",
            `baseline '${name}' could not be read`,
            cause,
          )
        }
        throw new SearchEvalArtifactError(
          "not_found",
          `baseline '${name}' was not found`,
          cause,
        )
      }

      let payload: unknown
      try {
        payload = JSON.parse(text)
      } catch (cause) {
        throw new SearchEvalArtifactError(
          "invalid_artifact",
          `baseline '${name}' is not valid JSON`,
          cause,
        )
      }
      const parsed = BaselineArtifactSchema.safeParse(payload)
      if (!parsed.success) {
        throw new SearchEvalArtifactError(
          "invalid_artifact",
          `baseline '${name}' failed artifact validation`,
          parsed.error,
        )
      }
      return parsed.data
    },
    async writeReport(report) {
      const parsed = SearchEvalReportSchema.safeParse(report)
      if (!parsed.success) {
        throw new SearchEvalArtifactError(
          "invalid_artifact",
          "search eval report failed artifact validation",
          parsed.error,
        )
      }
      const filePath = reportPath(rootDir, report.reportId)
      await writeJson(filePath, parsed.data)
      return { path: filePath }
    },
    async readReport(reportId) {
      const filePath = reportPath(rootDir, reportId)
      let text: string
      try {
        text = await readFile(filePath, "utf8")
      } catch (cause) {
        if (!isNodeErrorCode(cause, "ENOENT")) {
          throw new SearchEvalArtifactError(
            "read_failed",
            `report '${reportId}' could not be read`,
            cause,
          )
        }
        throw new SearchEvalArtifactError(
          "not_found",
          `report '${reportId}' was not found`,
          cause,
        )
      }

      let payload: unknown
      try {
        payload = JSON.parse(text)
      } catch (cause) {
        throw new SearchEvalArtifactError(
          "invalid_artifact",
          `report '${reportId}' is not valid JSON`,
          cause,
        )
      }
      const parsed = SearchEvalReportSchema.safeParse(payload)
      if (!parsed.success) {
        throw new SearchEvalArtifactError(
          "invalid_artifact",
          `report '${reportId}' failed artifact validation`,
          parsed.error,
        )
      }
      return parsed.data
    },
  }
}

export const _internal = {
  assertSafeName,
  baselinePath,
  reportPath,
}
