export const SEARCH_EVAL_ARTIFACT_SCHEMA_VERSION = "1" as const

export const SEARCH_EVAL_SEARCH_MODES = [
  "hybrid",
  "keyword-first",
  "semantic-only",
] as const

export type SearchEvalSearchMode = (typeof SEARCH_EVAL_SEARCH_MODES)[number]

export const DEFAULT_SEARCH_EVAL_CALLER_TRACK = "public-watch" as const

export const SEARCH_EVAL_CALLER_TRACKS = {
  "public-watch": {
    id: "public-watch",
    caller: "Public Watch search reviewer",
    job: "Evaluate launch readiness for user-facing Watch website search.",
    defaultMode: "keyword-first",
    suitableModes: ["keyword-first"],
    successCriteria: [
      "Brand and product-title queries return the expected product family near the top.",
      "Common felt-need, Bible topic, typo, and multilingual queries return useful public Watch results.",
      "No-result and confusing queries degrade honestly without ranking irrelevant hits above clear matches.",
    ],
    judgeRubric:
      "Prefer results that satisfy a public Watch visitor's immediate query intent. Product and brand-title matches should outrank loosely related semantic matches; keyword typo tolerance and language handling matter for launch readiness.",
  },
  "ai-experience-generation": {
    id: "ai-experience-generation",
    caller: "AI experience-generation agent",
    job: "Find source videos an agent can use while creating devotionals, experiences, and related-content sections.",
    defaultMode: "hybrid",
    suitableModes: ["hybrid", "semantic-only"],
    successCriteria: [
      "Results give an agent strong candidate videos for the requested audience, topic, or devotional theme.",
      "Transcript and felt-need relevance matters more than exact title matching.",
      "Returned videos should include enough topical signal for a downstream agent to justify the selection.",
    ],
    judgeRubric:
      "Prefer result lists that would help an AI build a grounded devotional or experience. Deep topical fit, audience fit, and transcript relevance should beat exact keyword title matches when the prompt asks for material rather than a known product.",
  },
  "semantic-diagnostic": {
    id: "semantic-diagnostic",
    caller: "Search relevance engineer",
    job: "Diagnose semantic retrieval quality without keyword-first ranking effects.",
    defaultMode: "semantic-only",
    suitableModes: ["semantic-only"],
    successCriteria: [
      "Conceptual, paraphrased, and scene-like prompts retrieve genuinely related videos.",
      "Embeddings surface the right passages or episodes even when no exact query words are present.",
      "Poor or skewed semantic matches are visible without keyword ranking masking them.",
    ],
    judgeRubric:
      "Judge semantic retrieval quality only. Prefer lists whose meaning matches the query even if exact words differ, and penalize lexical-only coincidences or scene-vector skew that produces unrelated high-ranked results.",
  },
} as const

export type SearchEvalCallerTrack = keyof typeof SEARCH_EVAL_CALLER_TRACKS

export type SearchEvalCallerTrackDefinition = {
  id: SearchEvalCallerTrack
  caller: string
  job: string
  defaultMode: SearchEvalSearchMode
  suitableModes: readonly SearchEvalSearchMode[]
  successCriteria: readonly string[]
  judgeRubric: string
}

export const SEARCH_EVAL_CALLER_TRACK_IDS = [
  "public-watch",
  "ai-experience-generation",
  "semantic-diagnostic",
] as const satisfies readonly SearchEvalCallerTrack[]

export function isSearchEvalCallerTrack(
  value: unknown,
): value is SearchEvalCallerTrack {
  return (
    typeof value === "string" && Object.hasOwn(SEARCH_EVAL_CALLER_TRACKS, value)
  )
}

export function normalizeSearchEvalCallerTrack(
  value: string | null | undefined,
): SearchEvalCallerTrack {
  return isSearchEvalCallerTrack(value)
    ? value
    : DEFAULT_SEARCH_EVAL_CALLER_TRACK
}

export function searchEvalCallerTrackDefinition(
  callerTrack: SearchEvalCallerTrack,
): SearchEvalCallerTrackDefinition {
  return SEARCH_EVAL_CALLER_TRACKS[
    callerTrack
  ] as SearchEvalCallerTrackDefinition
}

export function defaultSearchEvalBaselineNameForCallerTrack(
  callerTrack: SearchEvalCallerTrack,
): string {
  if (callerTrack === "ai-experience-generation") {
    return "seed-baseline-ai-experience-generation"
  }
  if (callerTrack === "semantic-diagnostic") {
    return "seed-baseline-semantic-diagnostic"
  }
  return "seed-baseline"
}

export function isSearchEvalSearchMode(
  value: unknown,
): value is SearchEvalSearchMode {
  return (
    typeof value === "string" &&
    (SEARCH_EVAL_SEARCH_MODES as readonly string[]).includes(value)
  )
}

export function isSearchEvalModeSuitableForCallerTrack(
  callerTrack: SearchEvalCallerTrack,
  searchMode: SearchEvalSearchMode,
): boolean {
  return searchEvalCallerTrackDefinition(callerTrack).suitableModes.includes(
    searchMode,
  )
}

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

export type AdminSearchRetrieverTiming = {
  label: string
  status: "fulfilled" | "rejected"
  elapsedMs: number
  resultCount: number
}

export type AdminSearchTimingSummary = {
  totalMs: number
  retrievalsMs: number
  fusionMs: number
  dilutionCapMs: number
  dedupeMs: number
  mappingMs: number
  hydrationMs: number
  retrievers: AdminSearchRetrieverTiming[]
}

export type SeedPromptCase = {
  id: string
  locale: string
  languageSlug?: string
  websiteLocale?: string
  queryText: string
  source: "seed"
  callerTracks: SearchEvalCallerTrack[]
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
  callerTrack: SearchEvalCallerTrack
  tags: string[]
  operatorNotes?: string
  results: SearchEvalResult[]
  searchTimings?: AdminSearchTimingSummary
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
  callerTrack: SearchEvalCallerTrack
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
  callerTrack: SearchEvalCallerTrack
  baselineResults: SearchEvalResult[]
  currentResults: SearchEvalResult[]
  baselineSearchTimings?: AdminSearchTimingSummary
  currentSearchTimings?: AdminSearchTimingSummary
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
  searchTimings?: AdminSearchTimingSummary
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

export type SearchEvalTrackSummary = {
  callerTrack: SearchEvalCallerTrack
  caller: string
  job: string
  mode: string | null
  defaultMode: SearchEvalSearchMode
  suitableMode: boolean
  successCriteria: string[]
  totals: ReportTotals
  noResultCases: number
  representativeFailures: Array<{
    caseId: string
    queryText: string
    kind: ReportOutcomeKind
    rationale?: string
    topResults: string[]
  }>
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
  callerTrackMix: Record<string, number>
  trackSummaries: SearchEvalTrackSummary[]
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
