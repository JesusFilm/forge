import { randomUUID } from "node:crypto"

import { env } from "../../config/env"
import {
  callAdminEvalSearch,
  type AdminSearchEvalClientResult,
  type AdminSearchResponse,
} from "../admin-search-eval-client"
import {
  ABSOLUTE_PUBLIC_WATCH_QUERY_SET_VERSION,
  absolutePublicWatchQuerySet,
  type AbsolutePublicWatchQueryCase,
  type AbsoluteSearchEvalSplit,
} from "./absolute-query-set"
import {
  computeAbsoluteSearchQuality,
  type AbsolutePointwiseRating,
  type AbsoluteSearchCaseObservation,
  type AbsoluteSearchQuality,
} from "./absolute-quality"
import {
  createAbsoluteSearchEvalArtifactWriter,
  type AbsoluteSearchEvalArtifactWriter,
} from "./absolute-artifacts"
import {
  repositoryAbsoluteRelevanceJudgmentSet,
  type AbsoluteRelevanceJudgmentSet,
  type AbsoluteRelevanceJudgments,
} from "./absolute-relevance-judgments"
import {
  createOfflineSearchEvalJudge,
  type OfflineSearchEvalJudge,
} from "./judge"

const DEFAULT_SEARCH_LIMIT = 10
const SEARCH_CONCURRENCY = 4
const JUDGE_CONCURRENCY = 2

export type AbsoluteCandidateIdentity = {
  revision: string
  collections: {
    catalog: string
    availability: string
    lexical: string
    transcripts: string
  }
}

export type AbsoluteOperatorReview = {
  approved: boolean
  reviewer: string
  notes: string
}

export type AbsoluteSearchEvalInput = {
  split?: AbsoluteSearchEvalSplit
  backendMode?: "modern" | "default"
  locales?: string[]
  searchLimit?: number
  runPointwiseJudge?: boolean
  acknowledgeHeldOutReleaseGate?: boolean
  relevanceJudgmentSet?: AbsoluteRelevanceJudgmentSet
  candidateIdentity?: AbsoluteCandidateIdentity
  operatorReview?: AbsoluteOperatorReview
}

export type AbsoluteSearchEvalObservation = AbsoluteSearchCaseObservation & {
  queryText: string
  languageSlug?: string
  roundTripLatencyMs: number
  serverLatencyMs: number | null
  requestId: string | null
  serverRevision: string | null
  laneStatuses: NonNullable<AdminSearchResponse["laneStatuses"]>
  searchFailure?: string
  judgeFailure?: string
  pointwiseRationale?: string
}

export type AbsoluteSearchEvalReport = {
  schemaVersion: "1"
  kind: "absolute-report"
  reportId: string
  querySetVersion: typeof ABSOLUTE_PUBLIC_WATCH_QUERY_SET_VERSION
  split: AbsoluteSearchEvalSplit
  backendMode: "modern" | "default"
  startedAt: string
  finishedAt: string
  adminSearchUrl: string | null
  relevanceJudgmentSetVersion: string
  judgeModel: string | null
  judgeProvider: string | null
  candidateIdentity: AbsoluteCandidateIdentity | null
  observedServerRevisions: string[]
  operatorReview: AbsoluteOperatorReview | null
  observations: AbsoluteSearchEvalObservation[]
  quality: AbsoluteSearchQuality
  relevanceCoverage: number
  gate: { passed: boolean; reasons: string[] }
  cost: {
    inputTokens: number
    outputTokens: number
    reportedUsd: number | null
  }
  timings: { searchMs: number; judgeMs: number; totalMs: number }
}

export type AbsoluteSearchEvalResult =
  | {
      ok: true
      reportPath: string
      report: AbsoluteSearchEvalReport
    }
  | {
      ok: false
      reason:
        | "invalid_input"
        | "config_missing"
        | "judge_config_missing"
        | "artifact_write_failed"
        | "held_out_acknowledgement_required"
      retryable: boolean
    }

type AbsoluteRunnerOptions = {
  cases?: readonly AbsolutePublicWatchQueryCase[]
  searchUrl?: string
  adminBearer?: string
  searchClient?: typeof callAdminEvalSearch
  judge?: OfflineSearchEvalJudge
  relevanceJudgments?: AbsoluteRelevanceJudgments
  artifactWriter?: AbsoluteSearchEvalArtifactWriter
  runId?: string
  now?: () => Date
}

async function mapConcurrent<T, TResult>(
  items: readonly T[],
  concurrency: number,
  transform: (item: T) => Promise<TResult>,
): Promise<TResult[]> {
  const results = new Array<TResult>(items.length)
  let nextIndex = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (true) {
        const index = nextIndex++
        const item = items[index]
        if (item == null) return
        results[index] = await transform(item)
      }
    }),
  )
  return results
}

function sanitizedUrl(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    url.username = ""
    url.password = ""
    url.search = ""
    url.hash = ""
    return url.toString()
  } catch {
    return null
  }
}

function failedObservation(
  entry: AbsolutePublicWatchQueryCase,
  relevance: AbsoluteRelevanceJudgments,
  elapsedMs: number,
  failure: string,
): AbsoluteSearchEvalObservation {
  return {
    caseId: entry.id,
    split: entry.split,
    intent: entry.intent,
    locale: entry.locale,
    expectedLanguageSlug: entry.languageSlug,
    expectedNoResult: entry.expectedNoResult,
    multilingual: entry.multilingual,
    queryText: entry.queryText,
    languageSlug: entry.languageSlug,
    results: [],
    relevance: relevance[entry.id] ?? {},
    latencyMs: elapsedMs,
    roundTripLatencyMs: elapsedMs,
    serverLatencyMs: null,
    requestId: null,
    serverRevision: null,
    laneStatuses: [],
    searchFailure: failure,
  }
}

function successfulObservation(
  entry: AbsolutePublicWatchQueryCase,
  relevance: AbsoluteRelevanceJudgments,
  elapsedMs: number,
  response: AdminSearchResponse,
): AbsoluteSearchEvalObservation {
  return {
    caseId: entry.id,
    split: entry.split,
    intent: entry.intent,
    locale: entry.locale,
    expectedLanguageSlug: entry.languageSlug,
    expectedNoResult: entry.expectedNoResult,
    multilingual: entry.multilingual,
    queryText: entry.queryText,
    languageSlug: entry.languageSlug,
    results: response.results,
    relevance: relevance[entry.id] ?? {},
    latencyMs: elapsedMs,
    roundTripLatencyMs: elapsedMs,
    serverLatencyMs: response.latencyMs ?? null,
    requestId: response.requestId ?? null,
    serverRevision: response.revision ?? null,
    laneStatuses: response.laneStatuses ?? [],
    degraded: response.degraded ?? false,
  }
}

function gateFor({
  input,
  observations,
  quality,
  relevanceCoverage,
  candidateIdentity,
  operatorReview,
  observedServerRevisions,
}: {
  input: Required<Pick<AbsoluteSearchEvalInput, "split" | "runPointwiseJudge">>
  observations: readonly AbsoluteSearchEvalObservation[]
  quality: AbsoluteSearchQuality
  relevanceCoverage: number
  candidateIdentity: AbsoluteCandidateIdentity | null
  operatorReview: AbsoluteOperatorReview | null
  observedServerRevisions: readonly string[]
}) {
  const reasons: string[] = []
  if (input.split !== "held-out")
    reasons.push("development_split_not_promotable")
  if (operatorReview?.approved !== true)
    reasons.push("operator_review_required")
  if (observations.some((entry) => entry.searchFailure)) {
    reasons.push("search_failures")
  }
  if (observations.some((entry) => entry.judgeFailure)) {
    reasons.push("judge_failures")
  }
  if (!input.runPointwiseJudge) reasons.push("pointwise_judge_not_run")
  if (relevanceCoverage < 1) reasons.push("relevance_judgments_incomplete")
  if (quality.ndcgAt10 < 0.8) reasons.push("ndcg_at_10_below_0_80")
  if (quality.mrr < 0.85) reasons.push("mrr_below_0_85")
  if (quality.successAt10 < 0.9) reasons.push("success_at_10_below_0_90")
  if (quality.productTitleSuccessAt1 < 0.9) {
    reasons.push("product_title_success_at_1_below_0_90")
  }
  if (quality.semanticIntentSuccessAt10 < 0.8) {
    reasons.push("semantic_intent_success_at_10_below_0_80")
  }
  if (quality.multilingualSuccessAt10 < 0.9) {
    reasons.push("multilingual_success_at_10_below_0_90")
  }
  if (
    quality.expectedNoResultCases === 0 ||
    quality.expectedNoResultAccuracy < 1
  ) {
    reasons.push("expected_no_result_accuracy_below_1_00")
  }
  if (quality.languageCorrectness < 1) reasons.push("language_incorrect")
  if (quality.canonicalDuplicateRate > 0) reasons.push("canonical_duplicates")
  if (quality.pointwiseUsefulRate < 0.85)
    reasons.push("pointwise_useful_below_0_85")
  if (quality.pointwiseUnacceptableRate > 0.05) {
    reasons.push("pointwise_unacceptable_above_0_05")
  }
  if (quality.latency.p95Ms > 550) reasons.push("round_trip_p95_above_550ms")
  if (input.split === "held-out") {
    if (candidateIdentity == null) reasons.push("candidate_identity_required")
    if (
      candidateIdentity != null &&
      (observedServerRevisions.length !== 1 ||
        observedServerRevisions[0] !== candidateIdentity.revision)
    ) {
      reasons.push("candidate_revision_mismatch")
    }
  }
  return { passed: reasons.length === 0, reasons }
}

export async function runAbsoluteSearchEval(
  input: AbsoluteSearchEvalInput,
  options: AbsoluteRunnerOptions = {},
): Promise<AbsoluteSearchEvalResult> {
  const split = input.split ?? "development"
  const backendMode = input.backendMode ?? "modern"
  const searchLimit = input.searchLimit ?? DEFAULT_SEARCH_LIMIT
  const runPointwiseJudge = input.runPointwiseJudge ?? true
  const relevanceJudgmentSet =
    input.relevanceJudgmentSet ?? repositoryAbsoluteRelevanceJudgmentSet
  const candidateIdentity = input.candidateIdentity ?? null
  const operatorReview = input.operatorReview ?? null
  if (!Number.isInteger(searchLimit) || searchLimit < 1 || searchLimit > 50) {
    return { ok: false, reason: "invalid_input", retryable: false }
  }
  if (split === "held-out" && !input.acknowledgeHeldOutReleaseGate) {
    return {
      ok: false,
      reason: "held_out_acknowledgement_required",
      retryable: false,
    }
  }

  const searchUrl = options.searchUrl ?? env.ADMIN_SEARCH_EVAL_SEARCH_URL
  const adminBearer = options.adminBearer ?? env.ADMIN_SEARCH_EVAL_API_KEY
  if (!searchUrl || !adminBearer) {
    return { ok: false, reason: "config_missing", retryable: false }
  }
  const localeFilter = input.locales ? new Set(input.locales) : null
  const cases = (options.cases ?? absolutePublicWatchQuerySet()).filter(
    (entry) =>
      entry.split === split &&
      (localeFilter == null || localeFilter.has(entry.locale)),
  )
  if (cases.length === 0) {
    return { ok: false, reason: "invalid_input", retryable: false }
  }

  let judge = options.judge
  if (runPointwiseJudge && judge == null) {
    try {
      judge = createOfflineSearchEvalJudge()
    } catch {
      return { ok: false, reason: "judge_config_missing", retryable: false }
    }
  }

  const now = options.now ?? (() => new Date())
  const startedAt = now()
  const totalStartedAt = performance.now()
  const relevance = options.relevanceJudgments ?? relevanceJudgmentSet.judgments
  const searchClient = options.searchClient ?? callAdminEvalSearch
  const searchStartedAt = performance.now()
  let observations = await mapConcurrent(
    cases,
    SEARCH_CONCURRENCY,
    async (entry): Promise<AbsoluteSearchEvalObservation> => {
      const requestStartedAt = Date.now()
      const response: AdminSearchEvalClientResult<AdminSearchResponse> =
        await searchClient({
          url: searchUrl,
          bearer: adminBearer,
          payload: {
            query: entry.queryText,
            locale: entry.locale,
            ...(entry.languageSlug ? { languageSlug: entry.languageSlug } : {}),
            limit: searchLimit,
            mode: backendMode,
            contentType: "video",
          },
        })
      const elapsedMs = Date.now() - requestStartedAt
      return response.ok
        ? successfulObservation(entry, relevance, elapsedMs, response.result)
        : failedObservation(entry, relevance, elapsedMs, response.reason)
    },
  )
  const searchMs = performance.now() - searchStartedAt

  const tokens = { inputTokens: 0, outputTokens: 0, reportedUsd: 0 }
  let hasReportedUsd = false
  const judgeStartedAt = performance.now()
  if (runPointwiseJudge && judge != null) {
    observations = await mapConcurrent(
      observations,
      JUDGE_CONCURRENCY,
      async (observation) => {
        if (observation.searchFailure) return observation
        try {
          const judged = await judge.judgePointwise({
            query: observation.queryText,
            locale: observation.locale,
            intent: observation.intent,
            results: observation.results,
          })
          tokens.inputTokens += judged.tokens.input
          tokens.outputTokens += judged.tokens.output
          if (judged.reportedUsd != null) {
            tokens.reportedUsd += judged.reportedUsd
            hasReportedUsd = true
          }
          return {
            ...observation,
            pointwiseRating: judged.rating as AbsolutePointwiseRating,
            pointwiseRationale: judged.rationale,
          }
        } catch (error) {
          return {
            ...observation,
            judgeFailure:
              error instanceof Error ? error.name : "pointwise_judge_failed",
          }
        }
      },
    )
  }
  const judgeMs = performance.now() - judgeStartedAt

  const quality = computeAbsoluteSearchQuality(observations)
  const relevanceCoverage =
    observations.filter(
      (entry) =>
        entry.expectedNoResult ||
        Object.values(entry.relevance).some((grade) => grade > 0),
    ).length / observations.length
  const observedServerRevisions = [
    ...new Set(
      observations.flatMap((entry) =>
        entry.serverRevision == null ? [] : [entry.serverRevision],
      ),
    ),
  ].sort()
  const finishedAt = now()
  const report: AbsoluteSearchEvalReport = {
    schemaVersion: "1",
    kind: "absolute-report",
    reportId: options.runId ?? randomUUID(),
    querySetVersion: ABSOLUTE_PUBLIC_WATCH_QUERY_SET_VERSION,
    split,
    backendMode,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    adminSearchUrl: sanitizedUrl(searchUrl),
    relevanceJudgmentSetVersion: relevanceJudgmentSet.version,
    judgeModel: judge?.model ?? null,
    judgeProvider: judge?.provider ?? null,
    candidateIdentity,
    observedServerRevisions,
    operatorReview,
    observations,
    quality,
    relevanceCoverage,
    gate: gateFor({
      input: { split, runPointwiseJudge },
      observations,
      quality,
      relevanceCoverage,
      candidateIdentity,
      operatorReview,
      observedServerRevisions,
    }),
    cost: {
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
      reportedUsd: hasReportedUsd ? tokens.reportedUsd : null,
    },
    timings: {
      searchMs,
      judgeMs,
      totalMs: performance.now() - totalStartedAt,
    },
  }

  try {
    const artifactWriter =
      options.artifactWriter ?? createAbsoluteSearchEvalArtifactWriter()
    const written = await artifactWriter.writeReport(report)
    return { ok: true, reportPath: written.path, report }
  } catch {
    return { ok: false, reason: "artifact_write_failed", retryable: true }
  }
}
