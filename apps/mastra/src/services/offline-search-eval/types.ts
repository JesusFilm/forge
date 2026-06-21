export const SEARCH_EVAL_ARTIFACT_SCHEMA_VERSION = "1" as const

export type SearchEvalResult = {
  type: "video" | "experience"
  id: string
  slug: string
  title: string
  imageUrl: string | null
  snippet: string
  startSeconds: number | null
  playbackId: string | null
  score: number
  label: string | null
  durationSeconds: number | null
  childCount: number | null
}

export type SeedPromptCase = {
  id: string
  locale: string
  languageSlug?: string
  websiteLocale?: string
  queryText: string
  source: "seed"
  tags: string[]
  operatorNotes?: string
}

export type GeneratedPromptCase = {
  id: string
  candidateId: string
  locale: string
  queryText: string | null
  source: "generated_catalog" | "generated_locale_quality" | "generated_trace"
  traceDerived: boolean
  retentionExpiresAt: string | null
  queryHash: string | null
}

export type SearchEvalCase = SeedPromptCase | GeneratedPromptCase

export type BaselineCase = {
  caseId: string
  locale: string
  languageSlug?: string
  websiteLocale?: string
  queryText: string
  source: "seed"
  tags: string[]
  operatorNotes?: string
  results: SearchEvalResult[]
  searchFailure?: SearchFailure
}

export type SearchFailure = {
  code:
    | "config_missing"
    | "auth_failed"
    | "rate_limited"
    | "rejected"
    | "network_error"
    | "parse_error"
    | "search_failed"
    | "judge_failed"
  retryable: boolean
  status?: number
  message?: string
}

export type SearchEvalMetadata = {
  mastraRunId: string
  startedAt: string
  finishedAt: string
  baselineName: string
  promptSetVersion: string
  adminSearchUrl: string | null
  judgeModel: string | null
  search: {
    limit: number
    mode: string | null
    contentType: "video" | "experience" | null
  }
}

export type BaselineArtifact = {
  schemaVersion: typeof SEARCH_EVAL_ARTIFACT_SCHEMA_VERSION
  kind: "baseline"
  name: string
  capturedAt: string
  metadata: SearchEvalMetadata
  cases: BaselineCase[]
}

export type JudgeVerdict =
  | "clearly-A-better"
  | "slightly-A-better"
  | "tie"
  | "slightly-B-better"
  | "clearly-B-better"
  | "both-irrelevant"

export type ReportOutcomeKind =
  | "win"
  | "loss"
  | "tie"
  | "both-irrelevant"
  | "judge-disagreement"
  | "judge-failure"
  | "search-failure"

export type ComparisonOutcome = {
  kind: ReportOutcomeKind
  caseId: string
  locale: string
  languageSlug?: string
  websiteLocale?: string
  queryText: string
  source: "seed"
  baselineResults: SearchEvalResult[]
  currentResults: SearchEvalResult[]
  verdicts?: [JudgeVerdict, JudgeVerdict]
  rationale?: string
  searchFailure?: SearchFailure
}

export type ExploratoryGeneratedOutcome = {
  candidateId: string
  locale: string
  source: GeneratedPromptCase["source"]
  traceDerived: boolean
  queryText: string | null
  queryHash: string | null
  retentionExpiresAt: string | null
  skippedReason?: "trace_derived_not_judged_or_searched"
  results: SearchEvalResult[]
  searchFailure?: SearchFailure
}

export type CalibrationReport = {
  passed: boolean
  matched: number
  total: number
  skipped: boolean
}

export type ReportTotals = {
  queries: number
  wins: number
  losses: number
  ties: number
  bothIrrelevant: number
  judgeDisagreements: number
  judgeFailures: number
  searchFailures: number
  netWinRate: number
}

export type ArtifactOnlyMastraEvaluationProjection = {
  integrationStatus: "custom_artifact_only"
  dataset: {
    name: string
    datasetId: null
    source: "seed_prompt_set"
    version: string
    itemCount: number
    targetType: "workflow"
    targetId: "offline-search-eval"
  }
  scorers: Array<{
    id: "search-result-pairwise-judge"
    scorerId: null
    status: "not_registered"
    kind: "pairwise_search_results"
  }>
  experiment: {
    name: string
    experimentId: null
    status: "not_created"
    mode: "baseline_capture" | "comparison"
    reportId: string
    baselineName: string
  }
}

export type NativeSyncedMastraEvaluationProjection = {
  integrationStatus: "native_synced"
  dataset: {
    name: string
    datasetId: string
    source: "seed_prompt_set"
    version: string
    itemCount: number
    targetType: "workflow"
    targetId: "offline-search-eval"
    environmentLabel: string
    nativeKey: string
    status: "created" | "updated" | "reused"
  }
  scorers: Array<{
    id: "search-result-pairwise-judge"
    scorerId: string
    status: "registered" | "reused"
    kind: "pairwise_search_results"
  }>
  experiment: {
    name: string
    experimentId: string
    status: "created" | "reused"
    mode: "baseline_capture" | "comparison"
    reportId: string
    baselineName: string
    environmentLabel: string
    nativeKey: string
  }
}

export type MastraEvaluationProjection =
  | ArtifactOnlyMastraEvaluationProjection
  | NativeSyncedMastraEvaluationProjection

export type SearchEvalReport = {
  schemaVersion: typeof SEARCH_EVAL_ARTIFACT_SCHEMA_VERSION
  kind: "baseline-report" | "comparison-report"
  reportId: string
  metadata: SearchEvalMetadata
  mastraEvaluation: MastraEvaluationProjection
  baseline?: {
    name: string
    capturedAt: string
    caseCount: number
    search: SearchEvalMetadata["search"]
    searchConfigMismatch?: boolean
  }
  calibration: CalibrationReport
  totals: ReportTotals
  localeMix: Record<string, number>
  promptSourceMix: Record<string, number>
  generatedCandidateBehavior: {
    included: number
    searched: number
    traceDerived: number
    skippedTraceDerived: number
    searchFailures: number
    readFailure?: SearchFailure
  }
  cost: {
    inputTokens: number
    outputTokens: number
    totalUsd: number | null
    pricingModel: string | null
    estimated: boolean
  }
  timings: {
    searchMs: number
    judgeMs: number
    totalMs: number
  }
  judgeFailures: SearchFailure[]
  outcomes: ComparisonOutcome[]
  exploratoryGenerated: ExploratoryGeneratedOutcome[]
}
