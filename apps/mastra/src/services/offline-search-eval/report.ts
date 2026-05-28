import { createHash } from "node:crypto"

import type {
  ComparisonOutcome,
  ExploratoryGeneratedOutcome,
  JudgeVerdict,
  MastraEvaluationProjection,
  ReportOutcomeKind,
  ReportTotals,
  SearchFailure,
  SearchEvalReport,
} from "./types"

const REDACTED_TRACE_QUERY = "[redacted-trace-derived-query]"

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

  return {
    integrationStatus: "custom_artifact_only",
    dataset: {
      name: `search-eval:${report.metadata.baselineName}`,
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
      name: `search-eval-${experimentVerb}:${report.metadata.baselineName}:${report.reportId}`,
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
    generatedCandidateBehavior,
  }
}

export const _internal = {
  REDACTED_TRACE_QUERY,
}
