import { createHash } from "node:crypto"

import {
  DEFAULT_SEARCH_EVAL_CALLER_TRACK,
  isSearchEvalModeSuitableForCallerTrack,
  isSearchEvalSearchMode,
  normalizeSearchEvalCallerTrack,
  searchEvalCallerTrackDefinition,
} from "./types"
import type {
  ComparisonOutcome,
  ExploratoryGeneratedOutcome,
  JudgeVerdict,
  MastraEvaluationProjection,
  ReportOutcomeKind,
  ReportTotals,
  SearchEvalCallerTrack,
  SearchFailure,
  SearchEvalReport,
} from "./types"

const REDACTED_TRACE_QUERY = "[redacted-trace-derived-query]"
const REDACTED_QUERY_TEXT = "[redacted-query-text]"
const REDACTED_RESULT_SNIPPET = "[redacted-result-snippet]"
const REDACTED_OPERATOR_NOTES = "[redacted-operator-notes]"
const REDACTED_JUDGE_RATIONALE = "[redacted-judge-rationale]"
const REDACTED_PROVIDER_MESSAGE = "[redacted-provider-message]"
const PROHIBITED_DOC_KEY_PATTERN =
  /(?:authorization|cookie|api[_-]?key|secret|bearer|password|raw(?:Trace|Provider|Payload)|providerPayload|embedding|vector)/i
const PROHIBITED_DOC_STRING_PATTERN =
  /(?:Bearer\s+[A-Za-z0-9._~-]+|sk-[A-Za-z0-9_-]{8,}|https?:\/\/[^/?#\s]+:[^/?#\s]+@|[?&](?:api[_-]?key|access[_-]?token|token|key|secret|password)=|\b\d{1,3}(?:\.\d{1,3}){3}\b)/i

function isProhibitedDocsKey(key: string): boolean {
  if (key === "contentEmbeddingProvider") return false
  return PROHIBITED_DOC_KEY_PATTERN.test(key)
}

export function hashQuery(queryText: string): string {
  return createHash("sha256").update(queryText).digest("hex")
}

export function collapseSwapVerdicts(
  forward: JudgeVerdict,
  swapped: JudgeVerdict,
): Exclude<ReportOutcomeKind, "search-failure"> {
  if (forward === "both-irrelevant" || swapped === "both-irrelevant") {
    return forward === "both-irrelevant" && swapped === "both-irrelevant"
      ? "both-irrelevant"
      : "judge-disagreement"
  }

  const forwardCurrentBetter =
    forward === "clearly-B-better" || forward === "slightly-B-better"
  const forwardBaselineBetter =
    forward === "clearly-A-better" || forward === "slightly-A-better"
  const swappedCurrentBetter =
    swapped === "clearly-A-better" || swapped === "slightly-A-better"
  const swappedBaselineBetter =
    swapped === "clearly-B-better" || swapped === "slightly-B-better"

  if (forwardCurrentBetter && swappedCurrentBetter) return "win"
  if (forwardBaselineBetter && swappedBaselineBetter) return "loss"
  if (forward === "tie" && swapped === "tie") return "tie"
  return "judge-disagreement"
}

export function computeTotals(
  outcomes: readonly ComparisonOutcome[],
): ReportTotals {
  let wins = 0
  let losses = 0
  let ties = 0
  let bothIrrelevant = 0
  let judgeDisagreements = 0
  let judgeFailures = 0
  let searchFailures = 0

  for (const outcome of outcomes) {
    if (outcome.kind === "win") wins++
    if (outcome.kind === "loss") losses++
    if (outcome.kind === "tie") ties++
    if (outcome.kind === "both-irrelevant") bothIrrelevant++
    if (outcome.kind === "judge-disagreement") {
      judgeDisagreements++
    }
    if (outcome.kind === "judge-failure") judgeFailures++
    if (outcome.kind === "search-failure") searchFailures++
  }

  const denominator =
    outcomes.length -
    bothIrrelevant -
    searchFailures -
    judgeDisagreements -
    judgeFailures
  return {
    queries: outcomes.length,
    wins,
    losses,
    ties,
    bothIrrelevant,
    judgeDisagreements,
    judgeFailures,
    searchFailures,
    netWinRate: denominator > 0 ? (wins - losses) / denominator : 0,
  }
}

export function localeMix(
  outcomes: readonly ComparisonOutcome[],
  exploratory: readonly ExploratoryGeneratedOutcome[],
): Record<string, number> {
  const mix: Record<string, number> = {}
  for (const item of [...outcomes, ...exploratory]) {
    mix[item.locale] = (mix[item.locale] ?? 0) + 1
  }
  return mix
}

export function promptSourceMix(
  outcomes: readonly ComparisonOutcome[],
  exploratory: readonly ExploratoryGeneratedOutcome[],
): Record<string, number> {
  const mix: Record<string, number> = {}
  for (const item of [...outcomes, ...exploratory]) {
    mix[item.source] = (mix[item.source] ?? 0) + 1
  }
  return mix
}

export function callerTrackMix(
  outcomes: readonly ComparisonOutcome[],
  callerTrack: SearchEvalCallerTrack,
): Record<string, number> {
  return outcomes.reduce<Record<string, number>>((mix, outcome) => {
    const track = normalizeSearchEvalCallerTrack(
      outcome.callerTrack ?? callerTrack,
    )
    mix[track] = (mix[track] ?? 0) + 1
    return mix
  }, {})
}

function representativeFailures(
  outcomes: readonly ComparisonOutcome[],
): SearchEvalReport["trackSummaries"][number]["representativeFailures"] {
  return outcomes
    .filter(
      (outcome) =>
        outcome.currentResults.length === 0 ||
        outcome.kind === "loss" ||
        outcome.kind === "both-irrelevant" ||
        outcome.kind === "judge-disagreement" ||
        outcome.kind === "judge-failure" ||
        outcome.kind === "search-failure",
    )
    .slice(0, 5)
    .map((outcome) => ({
      caseId: outcome.caseId,
      queryText: outcome.queryText,
      kind: outcome.kind,
      ...(outcome.rationale ? { rationale: outcome.rationale } : {}),
      topResults: outcome.currentResults
        .slice(0, 3)
        .map((result) => result.title),
    }))
}

export function trackSummaries(
  outcomes: readonly ComparisonOutcome[],
  metadata: SearchEvalReportDraft["metadata"],
): SearchEvalReport["trackSummaries"] {
  const callerTrack = normalizeSearchEvalCallerTrack(metadata.callerTrack)
  const definition = searchEvalCallerTrackDefinition(callerTrack)
  const mode = metadata.search.mode
  const suitableMode =
    isSearchEvalSearchMode(mode) &&
    isSearchEvalModeSuitableForCallerTrack(callerTrack, mode)

  return [
    {
      callerTrack,
      caller: definition.caller,
      job: definition.job,
      mode,
      defaultMode: definition.defaultMode,
      suitableMode,
      successCriteria: [...definition.successCriteria],
      totals: computeTotals(outcomes),
      noResultCases: outcomes.filter(
        (outcome) =>
          outcome.currentResults.length === 0 ||
          outcome.kind === "search-failure",
      ).length,
      representativeFailures: representativeFailures(outcomes),
    },
  ]
}

export function redactExploratoryGenerated(
  outcomes: readonly ExploratoryGeneratedOutcome[],
): ExploratoryGeneratedOutcome[] {
  return outcomes.map((outcome) =>
    outcome.traceDerived
      ? {
          ...outcome,
          queryText: REDACTED_TRACE_QUERY,
          queryHash: null,
          results: [],
        }
      : outcome,
  )
}

type SearchEvalReportDraft = Omit<
  SearchEvalReport,
  | "totals"
  | "localeMix"
  | "promptSourceMix"
  | "callerTrackMix"
  | "trackSummaries"
  | "generatedCandidateBehavior"
  | "mastraEvaluation"
> & {
  generatedCandidateReadFailure?: SearchFailure
}

function mastraEvaluationProjection(
  report: SearchEvalReportDraft,
): MastraEvaluationProjection {
  const mode =
    report.kind === "baseline-report" ? "baseline_capture" : "comparison"
  const experimentVerb =
    report.kind === "baseline-report" ? "baseline" : "compare"
  const callerTrack = normalizeSearchEvalCallerTrack(
    report.metadata.callerTrack,
  )
  const searchMode = report.metadata.search.mode ?? "hybrid"

  return {
    integrationStatus: "custom_artifact_only",
    dataset: {
      name: `search-eval:${report.metadata.baselineName}:${callerTrack}:${searchMode}`,
      datasetId: null,
      source: "seed_prompt_set",
      version: report.metadata.promptSetVersion,
      itemCount: report.outcomes.length,
      targetType: "workflow",
      targetId: "offline-search-eval",
    },
    scorers: [
      {
        id: "search-result-pairwise-judge",
        scorerId: null,
        status: "not_registered",
        kind: "pairwise_search_results",
      },
    ],
    experiment: {
      name: `search-eval-${experimentVerb}:${report.metadata.baselineName}:${callerTrack}:${searchMode}:${report.reportId}`,
      experimentId: null,
      status: "not_created",
      mode,
      reportId: report.reportId,
      baselineName: report.metadata.baselineName,
    },
  }
}

export function finalizeReport(
  report: SearchEvalReportDraft,
): SearchEvalReport {
  const { generatedCandidateReadFailure, ...baseReport } = report
  const callerTrack = normalizeSearchEvalCallerTrack(
    baseReport.metadata.callerTrack ?? DEFAULT_SEARCH_EVAL_CALLER_TRACK,
  )
  const exploratoryGenerated = redactExploratoryGenerated(
    baseReport.exploratoryGenerated,
  )
  const generatedCandidateBehavior = {
    included: exploratoryGenerated.length,
    searched: exploratoryGenerated.filter(
      (outcome) => !outcome.traceDerived && outcome.queryText != null,
    ).length,
    traceDerived: exploratoryGenerated.filter((outcome) => outcome.traceDerived)
      .length,
    skippedTraceDerived: exploratoryGenerated.filter(
      (outcome) =>
        outcome.skippedReason === "trace_derived_not_judged_or_searched",
    ).length,
    searchFailures: exploratoryGenerated.filter(
      (outcome) => outcome.searchFailure,
    ).length,
    ...(generatedCandidateReadFailure
      ? { readFailure: generatedCandidateReadFailure }
      : {}),
  }

  return {
    ...baseReport,
    mastraEvaluation: mastraEvaluationProjection(baseReport),
    exploratoryGenerated,
    totals: computeTotals(baseReport.outcomes),
    localeMix: localeMix(baseReport.outcomes, exploratoryGenerated),
    promptSourceMix: promptSourceMix(baseReport.outcomes, exploratoryGenerated),
    callerTrackMix: callerTrackMix(baseReport.outcomes, callerTrack),
    trackSummaries: trackSummaries(baseReport.outcomes, baseReport.metadata),
    generatedCandidateBehavior,
  }
}

type GateSummary = {
  passFail?: {
    state?: string
    reasons?: readonly string[]
  }
  artifacts?: {
    reportPath?: string
  }
}

export type ContentSearchEvalGateAdjudicationInput = {
  caseId: string
  acceptedOutcome: "current-better"
  reviewer: string
  reason: string
  reviewedAt?: string
}

export type ContentSearchEvalGateAdjudication = {
  caseId: string
  locale: string
  acceptedOutcome: "current-better"
  reviewer: string
  reason: string
  reviewedAt: string
  rawOutcomeKind: "judge-disagreement"
  verdicts?: [JudgeVerdict, JudgeVerdict]
}

export type ContentSearchEvalGateDocsReport = {
  schemaVersion: "1"
  kind: "content-search-eval-gate-report"
  exportedAt: string
  contentEmbeddingProvider: {
    provider: string
    model: string
    requestModel: string
    nativeDimensions: number
    finalDimensions: number
    transformVersion: string | null
  }
  gate: {
    backfillReady: boolean
    reasons: string[]
    mastraRunId: string
    reportId: string
    reportPath?: string
    baselineName: string
    judgeModel: string | null
    passFailState: string
    netWinRate: number
    queries: number
    comparableQueries: number
    losses: number
    searchFailures: number
    judgeFailures: number
    judgeDisagreements: number
    rawJudgeDisagreements: number
    adjudicatedJudgeDisagreements: number
    calibrationPassed: boolean
    calibrationSkipped: boolean
    orchestratorPassFailState: string
  }
  humanAdjudications?: {
    judgeDisagreements: ContentSearchEvalGateAdjudication[]
  }
  orchestratorSummary: unknown
  searchEvalReport: unknown
}

type EffectiveGateMetrics = {
  netWinRate: number
  comparableQueries: number
  wins: number
  losses: number
  searchFailures: number
  judgeFailures: number
  judgeDisagreements: number
  rawJudgeDisagreements: number
  adjudicatedJudgeDisagreements: number
}

function materializeHumanAdjudications(
  report: SearchEvalReport,
  inputs: readonly ContentSearchEvalGateAdjudicationInput[],
  exportedAt: string,
): ContentSearchEvalGateAdjudication[] {
  const seen = new Set<string>()
  return inputs.map((input) => {
    const caseId = input.caseId.trim()
    const reviewer = input.reviewer.trim()
    const reason = input.reason.trim()
    if (!caseId || !reviewer || !reason) {
      throw new Error(
        "content search-eval gate adjudications require caseId, reviewer, and reason",
      )
    }
    if (seen.has(caseId)) {
      throw new Error(
        `content search-eval gate adjudication duplicates caseId: ${caseId}`,
      )
    }
    seen.add(caseId)

    const matches = report.outcomes.filter(
      (outcome) => outcome.caseId === caseId,
    )
    if (matches.length !== 1) {
      throw new Error(
        `content search-eval gate adjudication must match exactly one outcome: ${caseId}`,
      )
    }
    const outcome = matches[0]!
    if (outcome.kind !== "judge-disagreement") {
      throw new Error(
        `content search-eval gate adjudication can only cover judge disagreements: ${caseId}`,
      )
    }

    return {
      caseId,
      locale: outcome.locale,
      acceptedOutcome: input.acceptedOutcome,
      reviewer,
      reason,
      reviewedAt: input.reviewedAt ?? exportedAt,
      rawOutcomeKind: "judge-disagreement",
      ...(outcome.verdicts ? { verdicts: outcome.verdicts } : {}),
    }
  })
}

function effectiveGateMetrics(
  report: SearchEvalReport,
  adjudications: readonly ContentSearchEvalGateAdjudication[],
): EffectiveGateMetrics {
  const adjudicatedCurrentWins = adjudications.filter(
    (adjudication) => adjudication.acceptedOutcome === "current-better",
  ).length
  const judgeDisagreements =
    report.totals.judgeDisagreements - adjudications.length
  if (judgeDisagreements < 0) {
    throw new Error(
      "content search-eval gate adjudications exceed raw judge disagreements",
    )
  }
  const wins = report.totals.wins + adjudicatedCurrentWins
  const losses = report.totals.losses
  const comparableQueries =
    report.totals.queries -
    report.totals.bothIrrelevant -
    report.totals.searchFailures -
    judgeDisagreements -
    report.totals.judgeFailures

  return {
    netWinRate: comparableQueries > 0 ? (wins - losses) / comparableQueries : 0,
    comparableQueries,
    wins,
    losses,
    searchFailures: report.totals.searchFailures,
    judgeFailures: report.totals.judgeFailures,
    judgeDisagreements,
    rawJudgeDisagreements: report.totals.judgeDisagreements,
    adjudicatedJudgeDisagreements: adjudications.length,
  }
}

function migrationGateReasons(
  report: SearchEvalReport,
  summary: GateSummary,
  metrics: EffectiveGateMetrics,
): string[] {
  const filteredSummaryReasons = [...(summary.passFail?.reasons ?? [])].filter(
    (reason) =>
      !(
        metrics.adjudicatedJudgeDisagreements > 0 &&
        metrics.judgeDisagreements === 0 &&
        /^judge disagreements \d+ exceeded max \d+$/.test(reason)
      ),
  )
  const reasons = [...filteredSummaryReasons]
  if (
    summary.passFail?.state !== "passed" &&
    (filteredSummaryReasons.length > 0 ||
      (summary.passFail?.reasons?.length ?? 0) === 0)
  ) {
    reasons.push("orchestrator release gate did not pass")
  }
  if (report.kind !== "comparison-report") {
    reasons.push("migration gate requires a comparison report")
  }
  if (!report.metadata.judgeModel) {
    reasons.push("migration gate requires an assigned judge model")
  }
  if (!report.calibration.passed || report.calibration.skipped) {
    reasons.push("judge calibration did not pass")
  }
  if (metrics.netWinRate < 0) {
    reasons.push("net win rate is negative")
  }
  if (metrics.comparableQueries <= 0) {
    reasons.push("no comparable search-eval queries were judged")
  }
  if (metrics.searchFailures > 0) {
    reasons.push("search failures were present")
  }
  if (metrics.judgeFailures > 0) {
    reasons.push("judge failures were present")
  }
  if (
    metrics.judgeDisagreements > 0 &&
    !reasons.some((reason) => /judge disagreements?/.test(reason))
  ) {
    reasons.push("unadjudicated judge disagreements were present")
  }
  return [...new Set(reasons)]
}

function sanitizeSearchEvalReportForDocs(report: SearchEvalReport): unknown {
  const sanitizeUrlString = (value: string): string => {
    try {
      const url = new URL(value)
      url.username = ""
      url.password = ""
      url.search = ""
      url.hash = ""
      return url.toString()
    } catch {
      return value
    }
  }

  const sanitize = (value: unknown, key = ""): unknown => {
    if (key && isProhibitedDocsKey(key)) {
      throw new Error(`search eval docs report contains prohibited key: ${key}`)
    }
    if (key === "queryText" && typeof value === "string") {
      return REDACTED_QUERY_TEXT
    }
    if (key === "snippet" && typeof value === "string") {
      return REDACTED_RESULT_SNIPPET
    }
    if (key === "operatorNotes" && typeof value === "string") {
      return REDACTED_OPERATOR_NOTES
    }
    if (key === "rationale" && typeof value === "string") {
      return REDACTED_JUDGE_RATIONALE
    }
    if (key === "message" && typeof value === "string") {
      return REDACTED_PROVIDER_MESSAGE
    }
    if (typeof value === "string") {
      const sanitizedValue = /(?:url|uri)$/i.test(key)
        ? sanitizeUrlString(value)
        : value
      if (PROHIBITED_DOC_STRING_PATTERN.test(sanitizedValue)) {
        throw new Error(
          "search eval docs report contains a prohibited string pattern",
        )
      }
      return sanitizedValue
    }
    if (Array.isArray(value)) {
      return value.map((item) => sanitize(item))
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([entryKey, entryValue]) => [
          entryKey,
          sanitize(entryValue, entryKey),
        ]),
      )
    }
    return value
  }
  return sanitize(report)
}

export function buildContentSearchEvalGateDocsReport({
  exportedAt = new Date().toISOString(),
  mastraRunId,
  report,
  summary,
  contentEmbeddingProvider,
  humanAdjudications = [],
}: {
  exportedAt?: string
  mastraRunId: string
  report: SearchEvalReport
  summary: GateSummary
  contentEmbeddingProvider: ContentSearchEvalGateDocsReport["contentEmbeddingProvider"]
  humanAdjudications?: readonly ContentSearchEvalGateAdjudicationInput[]
}): ContentSearchEvalGateDocsReport {
  const appliedAdjudications = materializeHumanAdjudications(
    report,
    humanAdjudications,
    exportedAt,
  )
  const metrics = effectiveGateMetrics(report, appliedAdjudications)
  const reasons = migrationGateReasons(report, summary, metrics)
  const orchestratorPassFailState = summary.passFail?.state ?? "unknown"
  const gate = {
    backfillReady: reasons.length === 0,
    reasons,
    mastraRunId,
    reportId: report.reportId,
    ...(summary.artifacts?.reportPath
      ? { reportPath: summary.artifacts.reportPath }
      : {}),
    baselineName: report.metadata.baselineName,
    judgeModel: report.metadata.judgeModel,
    passFailState: reasons.length === 0 ? "passed" : orchestratorPassFailState,
    netWinRate: metrics.netWinRate,
    queries: report.totals.queries,
    comparableQueries: metrics.comparableQueries,
    losses: metrics.losses,
    searchFailures: metrics.searchFailures,
    judgeFailures: metrics.judgeFailures,
    judgeDisagreements: metrics.judgeDisagreements,
    rawJudgeDisagreements: metrics.rawJudgeDisagreements,
    adjudicatedJudgeDisagreements: metrics.adjudicatedJudgeDisagreements,
    calibrationPassed: report.calibration.passed,
    calibrationSkipped: report.calibration.skipped,
    orchestratorPassFailState,
  }
  const docsReport: ContentSearchEvalGateDocsReport = {
    schemaVersion: "1",
    kind: "content-search-eval-gate-report",
    exportedAt,
    contentEmbeddingProvider,
    gate,
    ...(appliedAdjudications.length > 0
      ? {
          humanAdjudications: {
            judgeDisagreements: appliedAdjudications,
          },
        }
      : {}),
    orchestratorSummary: summary,
    searchEvalReport: sanitizeSearchEvalReportForDocs(report),
  }
  assertContentSearchEvalGateDocsReportIsSafe(docsReport)
  return docsReport
}

export function assertContentSearchEvalGateDocsReportIsSafe(
  value: unknown,
): void {
  const check = (input: unknown, key = ""): void => {
    if (key && isProhibitedDocsKey(key)) {
      throw new Error(`search eval docs report contains prohibited key: ${key}`)
    }
    if (typeof input === "string") {
      if (PROHIBITED_DOC_STRING_PATTERN.test(input)) {
        throw new Error(
          "search eval docs report contains a prohibited string pattern",
        )
      }
      return
    }
    if (Array.isArray(input)) {
      input.forEach((item) => check(item))
      return
    }
    if (input && typeof input === "object") {
      Object.entries(input).forEach(([entryKey, entryValue]) =>
        check(entryValue, entryKey),
      )
    }
  }
  check(value)
}

export const _internal = {
  REDACTED_TRACE_QUERY,
  REDACTED_QUERY_TEXT,
  REDACTED_RESULT_SNIPPET,
}
