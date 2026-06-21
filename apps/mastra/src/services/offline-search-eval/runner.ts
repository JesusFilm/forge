import { randomUUID } from "node:crypto"

import { env } from "../../config/env"
import {
  callAdminCandidateList,
  callAdminEvalSearch,
  type AdminCandidateListResponse,
  type AdminSearchEvalClientFailure,
  type AdminSearchEvalClientResult,
  type AdminSearchResponse,
} from "../admin-search-eval-client"
import {
  SEARCH_EVAL_SEED_PROMPT_SET_VERSION,
  SEARCH_EVAL_SEED_PROMPT_LOCALES,
  seedPromptsForLocales,
} from "./seed-prompt-set"
import {
  SearchEvalArtifactError,
  createSearchEvalArtifactStore,
  type SearchEvalArtifactStore,
} from "./artifacts"
import {
  createOfflineSearchEvalJudge,
  type OfflineSearchEvalJudge,
} from "./judge"
import { collapseSwapVerdicts, finalizeReport, hashQuery } from "./report"
import type {
  BaselineArtifact,
  BaselineCase,
  CalibrationReport,
  ComparisonOutcome,
  ExploratoryGeneratedOutcome,
  GeneratedPromptCase,
  SearchEvalMetadata,
  SearchEvalReport,
  SearchFailure,
  SeedPromptCase,
} from "./types"

const DEFAULT_SEARCH_LIMIT = 20
const DEFAULT_GENERATED_CANDIDATE_LIMIT = 10
const MAX_GENERATED_CANDIDATE_LIMIT = 50
const HAIKU_JUDGE_MODEL = "anthropic/claude-haiku-4-5"
const HAIKU_INPUT_USD_PER_TOKEN = 1.0 / 1_000_000
const HAIKU_OUTPUT_USD_PER_TOKEN = 5.0 / 1_000_000

export type OfflineSearchEvalMode = "capture-baseline" | "compare"

export type OfflineSearchEvalInput = {
  mode: OfflineSearchEvalMode
  baselineName?: string
  locales?: string[]
  searchLimit?: number
  searchMode?: string | null
  contentType?: "video" | "experience" | null
  includeGeneratedCandidates?: boolean
  generatedCandidateLimit?: number
}

export type OfflineSearchEvalSuccess = {
  ok: true
  mode: OfflineSearchEvalMode
  mastraRunId: string
  baselineName: string
  baselinePath?: string
  reportPath: string
  report: SearchEvalReport
}

export type OfflineSearchEvalFailure = {
  ok: false
  reason:
    | "invalid_input"
    | "admin_config_missing"
    | "admin_auth_failed"
    | "admin_read_failed"
    | "admin_read_rejected"
    | "artifact_not_found"
    | "artifact_invalid"
    | "artifact_read_failed"
    | "artifact_write_failed"
    | "judge_config_missing"
    | "judge_failed"
  retryable: boolean
  adminStatus?: string
  adminReason?: string
  reportPath?: string
}

export type OfflineSearchEvalResult =
  | OfflineSearchEvalSuccess
  | OfflineSearchEvalFailure

type RunnerOptions = {
  adminBearer?: string
  searchUrl?: string
  candidateListUrl?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
  artifactStore?: SearchEvalArtifactStore
  judge?: OfflineSearchEvalJudge
  now?: () => Date
  runId?: string
  searchClient?: typeof callAdminEvalSearch
  candidateListClient?: typeof callAdminCandidateList
}

type SearchTiming = { ms: number }

function failure(
  reason: OfflineSearchEvalFailure["reason"],
  options: {
    retryable: boolean
    adminStatus?: string
    adminReason?: string
    reportPath?: string
  } = { retryable: false },
): OfflineSearchEvalFailure {
  return { ok: false, reason, ...options }
}

function adminFailure(
  result: AdminSearchEvalClientFailure,
): OfflineSearchEvalFailure {
  if (result.reason === "config_missing") {
    return failure("admin_config_missing", { retryable: false })
  }
  if (result.reason === "auth_failed") {
    return failure("admin_auth_failed", {
      retryable: false,
      adminStatus: result.status == null ? undefined : String(result.status),
    })
  }
  if (result.reason === "rejected") {
    return failure("admin_read_rejected", {
      retryable: false,
      adminStatus: result.status == null ? undefined : String(result.status),
      adminReason: result.adminReason,
    })
  }
  return failure("admin_read_failed", {
    retryable: result.retryable,
    adminStatus: result.status == null ? undefined : String(result.status),
    adminReason: result.adminReason,
  })
}

function searchFailure(result: AdminSearchEvalClientFailure): SearchFailure {
  return {
    code: result.reason,
    retryable: result.retryable,
    status: result.status,
    message: result.adminReason,
  }
}

function searchFailureToOfflineFailure(
  value: SearchFailure,
): OfflineSearchEvalFailure {
  if (
    value.code === "config_missing" ||
    value.code === "auth_failed" ||
    value.code === "network_error" ||
    value.code === "parse_error" ||
    value.code === "rate_limited" ||
    value.code === "rejected"
  ) {
    return adminFailure({
      ok: false,
      reason: value.code,
      retryable: value.retryable,
      status: value.status,
      adminReason: value.message,
    })
  }
  return failure("admin_read_failed", {
    retryable: value.retryable,
    adminStatus: value.status == null ? undefined : String(value.status),
    adminReason: value.message,
  })
}

function blockingSearchFailure(
  result: AdminSearchEvalClientFailure,
): OfflineSearchEvalFailure | null {
  return result.reason === "config_missing" ||
    result.reason === "auth_failed" ||
    result.reason === "parse_error"
    ? adminFailure(result)
    : null
}

function artifactFailure(error: unknown): OfflineSearchEvalFailure {
  if (error instanceof SearchEvalArtifactError) {
    if (error.code === "invalid_name") {
      return failure("invalid_input", { retryable: false })
    }
    if (error.code === "not_found") {
      return failure("artifact_not_found", { retryable: false })
    }
    if (error.code === "read_failed") {
      return failure("artifact_read_failed", { retryable: true })
    }
    if (error.code === "write_failed") {
      return failure("artifact_write_failed", { retryable: true })
    }
  }
  return failure("artifact_invalid", { retryable: false })
}

function metadataFor({
  baselineName,
  contentType,
  finishedAt,
  judgeModel,
  mastraRunId,
  mode,
  promptSetVersion = SEARCH_EVAL_SEED_PROMPT_SET_VERSION,
  searchLimit,
  searchUrl,
  startedAt,
}: {
  baselineName: string
  contentType: "video" | "experience" | null
  finishedAt: Date
  judgeModel: string | null
  mastraRunId: string
  mode: string | null
  promptSetVersion?: string
  searchLimit: number
  searchUrl: string | undefined
  startedAt: Date
}): SearchEvalMetadata {
  return {
    mastraRunId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    baselineName,
    promptSetVersion,
    adminSearchUrl: sanitizeAdminSearchUrl(searchUrl),
    judgeModel,
    search: {
      limit: searchLimit,
      mode,
      contentType,
    },
  }
}

function sanitizeAdminSearchUrl(url: string | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    parsed.username = ""
    parsed.password = ""
    parsed.search = ""
    parsed.hash = ""
    return parsed.toString()
  } catch {
    return null
  }
}

function generatedSourceFor(
  source: AdminCandidateListResponse["candidates"][number]["source"],
): GeneratedPromptCase["source"] {
  if (source === "catalog") return "generated_catalog"
  if (source === "locale_quality") return "generated_locale_quality"
  return "generated_trace"
}

function generatedCaseFor(
  candidate: AdminCandidateListResponse["candidates"][number],
): GeneratedPromptCase {
  const traceDerived = candidate.source === "trace"
  const queryText = traceDerived ? null : candidate.queryText
  return {
    id: `generated-${candidate.id}`,
    candidateId: candidate.id,
    locale: candidate.locale,
    queryText,
    source: generatedSourceFor(candidate.source),
    traceDerived,
    retentionExpiresAt: candidate.retentionExpiresAt,
    queryHash: queryText == null ? null : hashQuery(queryText),
  }
}

async function searchAdmin(
  prompt: { queryText: string; locale: string; languageSlug?: string },
  input: OfflineSearchEvalInput,
  options: RunnerOptions,
  timing?: SearchTiming,
): Promise<AdminSearchEvalClientResult<AdminSearchResponse>> {
  const startedAt = Date.now()
  const result = await (options.searchClient ?? callAdminEvalSearch)({
    url: options.searchUrl ?? env.ADMIN_SEARCH_EVAL_SEARCH_URL,
    bearer: options.adminBearer ?? env.ADMIN_SEARCH_EVAL_API_KEY,
    payload: {
      query: prompt.queryText,
      locale: prompt.locale,
      ...(prompt.languageSlug ? { languageSlug: prompt.languageSlug } : {}),
      limit: input.searchLimit ?? DEFAULT_SEARCH_LIMIT,
      mode: input.searchMode ?? null,
      contentType: input.contentType ?? null,
    },
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
  })
  if (timing) timing.ms += Date.now() - startedAt
  return result
}

async function searchSeedCases(
  prompts: readonly SeedPromptCase[],
  input: OfflineSearchEvalInput,
  options: RunnerOptions,
  timing: SearchTiming,
): Promise<BaselineCase[] | OfflineSearchEvalFailure> {
  const cases: BaselineCase[] = []
  for (const prompt of prompts) {
    const result = await searchAdmin(prompt, input, options, timing)
    if (!result.ok) {
      return adminFailure(result)
    }
    cases.push({
      caseId: prompt.id,
      locale: prompt.locale,
      ...(prompt.languageSlug ? { languageSlug: prompt.languageSlug } : {}),
      ...(prompt.websiteLocale ? { websiteLocale: prompt.websiteLocale } : {}),
      queryText: prompt.queryText,
      source: "seed",
      tags: prompt.tags,
      operatorNotes: prompt.operatorNotes,
      results: result.ok ? result.result.results : [],
      ...(result.ok ? {} : { searchFailure: searchFailure(result) }),
    })
  }
  return cases
}

function baselineReportOutcomes(
  cases: readonly BaselineCase[],
): ComparisonOutcome[] {
  return cases.map((entry) => ({
    kind: entry.searchFailure ? "search-failure" : "tie",
    caseId: entry.caseId,
    locale: entry.locale,
    ...(entry.languageSlug ? { languageSlug: entry.languageSlug } : {}),
    ...(entry.websiteLocale ? { websiteLocale: entry.websiteLocale } : {}),
    queryText: entry.queryText,
    source: "seed",
    baselineResults: entry.results,
    currentResults: entry.results,
    ...(entry.searchFailure ? { searchFailure: entry.searchFailure } : {}),
  }))
}

async function readGeneratedCases(
  input: OfflineSearchEvalInput,
  options: RunnerOptions,
): Promise<{
  cases: GeneratedPromptCase[]
  readFailure?: SearchFailure
}> {
  if (!input.includeGeneratedCandidates) return { cases: [] }
  const limit = Math.min(
    MAX_GENERATED_CANDIDATE_LIMIT,
    Math.max(
      1,
      input.generatedCandidateLimit ?? DEFAULT_GENERATED_CANDIDATE_LIMIT,
    ),
  )
  const result = await (options.candidateListClient ?? callAdminCandidateList)({
    url: options.candidateListUrl ?? env.ADMIN_SEARCH_EVAL_CANDIDATES_URL,
    bearer: options.adminBearer ?? env.ADMIN_SEARCH_EVAL_API_KEY,
    filters: {
      limit,
      ...(input.locales ? { locales: input.locales } : {}),
    },
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
  })
  if (!result.ok) {
    return { cases: [], readFailure: searchFailure(result) }
  }
  return { cases: result.result.candidates.map(generatedCaseFor) }
}

async function exploratoryGeneratedOutcomes(
  cases: readonly GeneratedPromptCase[],
  input: OfflineSearchEvalInput,
  options: RunnerOptions,
  timing: SearchTiming,
): Promise<ExploratoryGeneratedOutcome[]> {
  const outcomes: ExploratoryGeneratedOutcome[] = []
  for (const entry of cases) {
    if (entry.traceDerived) {
      outcomes.push({
        candidateId: entry.candidateId,
        locale: entry.locale,
        source: entry.source,
        traceDerived: true,
        queryText: entry.queryText,
        queryHash: entry.queryHash,
        retentionExpiresAt: entry.retentionExpiresAt,
        skippedReason: "trace_derived_not_judged_or_searched",
        results: [],
      })
      continue
    }

    if (entry.queryText == null) {
      outcomes.push({
        candidateId: entry.candidateId,
        locale: entry.locale,
        source: entry.source,
        traceDerived: false,
        queryText: null,
        queryHash: null,
        retentionExpiresAt: entry.retentionExpiresAt,
        results: [],
        searchFailure: {
          code: "parse_error",
          retryable: true,
          message: "non-trace generated candidate omitted queryText",
        },
      })
      continue
    }

    const result = await searchAdmin(
      {
        queryText: entry.queryText,
        locale: entry.locale,
      },
      input,
      options,
      timing,
    )
    outcomes.push({
      candidateId: entry.candidateId,
      locale: entry.locale,
      source: entry.source,
      traceDerived: false,
      queryText: entry.queryText,
      queryHash: entry.queryHash,
      retentionExpiresAt: entry.retentionExpiresAt,
      results: result.ok ? result.result.results : [],
      ...(result.ok ? {} : { searchFailure: searchFailure(result) }),
    })
  }
  return outcomes
}

async function calibrateJudge(
  judge: OfflineSearchEvalJudge,
  baselineCases: readonly BaselineCase[],
): Promise<{
  report: CalibrationReport
  tokens: { input: number; output: number }
}> {
  const first = baselineCases.find((entry) => entry.results.length > 0)
  if (!first) {
    return {
      report: { passed: true, matched: 0, total: 0, skipped: true },
      tokens: { input: 0, output: 0 },
    }
  }
  const result = await judge.judgePair({
    query: first.queryText,
    locale: first.locale,
    listA: first.results,
    listB: first.results,
  })
  return {
    report: {
      passed: result.verdict === "tie",
      matched: result.verdict === "tie" ? 1 : 0,
      total: 1,
      skipped: false,
    },
    tokens: result.tokens,
  }
}

async function compareBaselineCases({
  baselineCases,
  input,
  judge,
  options,
  timing,
}: {
  baselineCases: readonly BaselineCase[]
  input: OfflineSearchEvalInput
  judge: OfflineSearchEvalJudge
  options: RunnerOptions
  timing: SearchTiming
}): Promise<
  | {
      outcomes: ComparisonOutcome[]
      tokens: { input: number; output: number }
      judgeFailures: SearchFailure[]
    }
  | OfflineSearchEvalFailure
> {
  const outcomes: ComparisonOutcome[] = []
  const tokens = { input: 0, output: 0 }
  const judgeFailures: SearchFailure[] = []

  for (const entry of baselineCases) {
    const current = await searchAdmin(
      {
        queryText: entry.queryText,
        locale: entry.locale,
        languageSlug: entry.languageSlug,
      },
      input,
      options,
      timing,
    )
    if (!current.ok) {
      const blocking = blockingSearchFailure(current)
      if (blocking) return blocking
    }
    if (!current.ok || entry.searchFailure) {
      outcomes.push({
        kind: "search-failure",
        caseId: entry.caseId,
        locale: entry.locale,
        ...(entry.languageSlug ? { languageSlug: entry.languageSlug } : {}),
        ...(entry.websiteLocale ? { websiteLocale: entry.websiteLocale } : {}),
        queryText: entry.queryText,
        source: "seed",
        baselineResults: entry.results,
        currentResults: current.ok ? current.result.results : [],
        searchFailure: current.ok
          ? entry.searchFailure
          : searchFailure(current),
      })
      continue
    }

    try {
      const forward = await judge.judgePair({
        query: entry.queryText,
        locale: entry.locale,
        listA: entry.results,
        listB: current.result.results,
      })
      tokens.input += forward.tokens.input
      tokens.output += forward.tokens.output
      const swapped = await judge.judgePair({
        query: entry.queryText,
        locale: entry.locale,
        listA: current.result.results,
        listB: entry.results,
      })
      tokens.input += swapped.tokens.input
      tokens.output += swapped.tokens.output
      outcomes.push({
        kind: collapseSwapVerdicts(forward.verdict, swapped.verdict),
        caseId: entry.caseId,
        locale: entry.locale,
        ...(entry.languageSlug ? { languageSlug: entry.languageSlug } : {}),
        ...(entry.websiteLocale ? { websiteLocale: entry.websiteLocale } : {}),
        queryText: entry.queryText,
        source: "seed",
        baselineResults: entry.results,
        currentResults: current.result.results,
        verdicts: [forward.verdict, swapped.verdict],
        rationale: forward.rationale,
      })
    } catch (error) {
      const judgeFailure: SearchFailure = {
        code: "judge_failed",
        retryable: true,
        message:
          error instanceof Error
            ? error.name || "judge_failed"
            : "judge_failed",
      }
      judgeFailures.push(judgeFailure)
      outcomes.push({
        kind: "judge-failure",
        caseId: entry.caseId,
        locale: entry.locale,
        ...(entry.languageSlug ? { languageSlug: entry.languageSlug } : {}),
        ...(entry.websiteLocale ? { websiteLocale: entry.websiteLocale } : {}),
        queryText: entry.queryText,
        source: "seed",
        baselineResults: entry.results,
        currentResults: current.result.results,
        rationale: "judge_failed",
        searchFailure: judgeFailure,
      })
    }
  }

  return { outcomes, tokens, judgeFailures }
}

function costFor(
  tokens: { input: number; output: number },
  judgeModel: string | null,
) {
  const priced = judgeModel === HAIKU_JUDGE_MODEL
  return {
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    totalUsd: priced
      ? tokens.input * HAIKU_INPUT_USD_PER_TOKEN +
        tokens.output * HAIKU_OUTPUT_USD_PER_TOKEN
      : tokens.input + tokens.output === 0
        ? 0
        : null,
    pricingModel: priced ? judgeModel : null,
    estimated: priced && tokens.input + tokens.output > 0,
  }
}

function searchConfigMismatch(
  left: SearchEvalMetadata["search"],
  right: SearchEvalMetadata["search"],
): boolean {
  return (
    left.limit !== right.limit ||
    left.mode !== right.mode ||
    left.contentType !== right.contentType
  )
}

function hasUnsupportedSeedLocales(locales: readonly string[] | undefined) {
  if (locales == null || locales.length === 0) return false
  const supported = new Set<string>(SEARCH_EVAL_SEED_PROMPT_LOCALES)
  return locales.some((locale) => !supported.has(locale))
}

function baselineCasesForLocales(
  cases: readonly BaselineCase[],
  locales: readonly string[] | undefined,
): BaselineCase[] {
  if (locales == null || locales.length === 0) return [...cases]
  const allowed = new Set(locales)
  return cases.filter((entry) => allowed.has(entry.locale))
}

export async function runOfflineSearchEval(
  input: OfflineSearchEvalInput,
  options: RunnerOptions = {},
): Promise<OfflineSearchEvalResult> {
  const now = options.now ?? (() => new Date())
  const startedAt = now()
  const mastraRunId = options.runId ?? randomUUID()
  const baselineName = input.baselineName ?? "default"
  const artifactStore = options.artifactStore ?? createSearchEvalArtifactStore()
  const searchUrl = options.searchUrl ?? env.ADMIN_SEARCH_EVAL_SEARCH_URL
  const adminBearer = options.adminBearer ?? env.ADMIN_SEARCH_EVAL_API_KEY
  if (!searchUrl || !adminBearer) {
    return failure("admin_config_missing", { retryable: false })
  }
  const searchTiming: SearchTiming = { ms: 0 }

  if (input.mode === "capture-baseline") {
    if (hasUnsupportedSeedLocales(input.locales)) {
      return failure("invalid_input", { retryable: false })
    }
    const seedPrompts = seedPromptsForLocales(input.locales)
    if (seedPrompts.length === 0) {
      return failure("invalid_input", { retryable: false })
    }
    const cases = await searchSeedCases(
      seedPrompts,
      input,
      options,
      searchTiming,
    )
    if (!Array.isArray(cases)) return cases
    const failedSeedCase = cases.find((entry) => entry.searchFailure)
    if (failedSeedCase?.searchFailure) {
      return searchFailureToOfflineFailure(failedSeedCase.searchFailure)
    }
    const generated = await readGeneratedCases(input, options)
    const exploratory = await exploratoryGeneratedOutcomes(
      generated.cases,
      input,
      options,
      searchTiming,
    )
    const finishedAt = now()
    const metadata = metadataFor({
      baselineName,
      contentType: input.contentType ?? null,
      finishedAt,
      judgeModel: null,
      mastraRunId,
      mode: input.searchMode ?? null,
      searchLimit: input.searchLimit ?? DEFAULT_SEARCH_LIMIT,
      searchUrl,
      startedAt,
    })
    const baseline: BaselineArtifact = {
      schemaVersion: "1",
      kind: "baseline",
      name: baselineName,
      capturedAt: finishedAt.toISOString(),
      metadata,
      cases,
    }
    const report = finalizeReport({
      schemaVersion: "1",
      kind: "baseline-report",
      reportId: `${mastraRunId}-baseline`,
      metadata,
      baseline: {
        name: baselineName,
        capturedAt: baseline.capturedAt,
        caseCount: cases.length,
        search: metadata.search,
      },
      calibration: { passed: true, matched: 0, total: 0, skipped: true },
      cost: costFor({ input: 0, output: 0 }, null),
      timings: {
        searchMs: searchTiming.ms,
        judgeMs: 0,
        totalMs: finishedAt.getTime() - startedAt.getTime(),
      },
      judgeFailures: [],
      outcomes: baselineReportOutcomes(cases),
      exploratoryGenerated: exploratory,
      generatedCandidateReadFailure: generated.readFailure,
    })
    let reportPath: Awaited<ReturnType<SearchEvalArtifactStore["writeReport"]>>
    try {
      reportPath = await artifactStore.writeReport(report)
    } catch (error) {
      return artifactFailure(error)
    }
    let baselinePath: Awaited<
      ReturnType<SearchEvalArtifactStore["writeBaseline"]>
    >
    try {
      baselinePath = await artifactStore.writeBaseline(baseline)
    } catch (error) {
      return artifactFailure(error)
    }
    return {
      ok: true,
      mode: input.mode,
      mastraRunId,
      baselineName,
      baselinePath: baselinePath.path,
      reportPath: reportPath.path,
      report,
    }
  }

  let baseline: BaselineArtifact
  try {
    baseline = await artifactStore.readBaseline(baselineName)
  } catch (error) {
    return artifactFailure(error)
  }

  let judge = options.judge
  if (!judge) {
    try {
      judge = createOfflineSearchEvalJudge()
    } catch {
      return failure("judge_config_missing", { retryable: false })
    }
  }

  const judgeStartedAt = Date.now()
  let calibration: Awaited<ReturnType<typeof calibrateJudge>>
  try {
    calibration = await calibrateJudge(judge, baseline.cases)
  } catch {
    return failure("judge_failed", { retryable: true })
  }
  if (!calibration.report.passed) {
    return failure("judge_failed", { retryable: true })
  }
  const generated = await readGeneratedCases(input, options)
  const exploratory = await exploratoryGeneratedOutcomes(
    generated.cases,
    input,
    options,
    searchTiming,
  )
  const baselineCases = baselineCasesForLocales(baseline.cases, input.locales)
  if (baselineCases.length === 0) {
    return failure("invalid_input", { retryable: false })
  }
  const compared = await compareBaselineCases({
    baselineCases,
    input,
    judge,
    options,
    timing: searchTiming,
  })
  if ("ok" in compared) return compared
  const judgeMs = Date.now() - judgeStartedAt
  const tokens = {
    input: calibration.tokens.input + compared.tokens.input,
    output: calibration.tokens.output + compared.tokens.output,
  }
  const finishedAt = now()
  const metadata = metadataFor({
    baselineName,
    contentType: input.contentType ?? null,
    finishedAt,
    judgeModel: judge.model,
    mastraRunId,
    mode: input.searchMode ?? null,
    promptSetVersion: baseline.metadata.promptSetVersion,
    searchLimit: input.searchLimit ?? DEFAULT_SEARCH_LIMIT,
    searchUrl,
    startedAt,
  })
  const report = finalizeReport({
    schemaVersion: "1",
    kind: "comparison-report",
    reportId: mastraRunId,
    metadata,
    baseline: {
      name: baseline.name,
      capturedAt: baseline.capturedAt,
      caseCount: baselineCases.length,
      search: baseline.metadata.search,
      searchConfigMismatch: searchConfigMismatch(
        baseline.metadata.search,
        metadata.search,
      ),
    },
    calibration: calibration.report,
    cost: costFor(tokens, judge.model),
    timings: {
      searchMs: searchTiming.ms,
      judgeMs,
      totalMs: finishedAt.getTime() - startedAt.getTime(),
    },
    judgeFailures: compared.judgeFailures,
    outcomes: compared.outcomes,
    exploratoryGenerated: exploratory,
    generatedCandidateReadFailure: generated.readFailure,
  })
  let reportPath: Awaited<ReturnType<SearchEvalArtifactStore["writeReport"]>>
  try {
    reportPath = await artifactStore.writeReport(report)
  } catch (error) {
    return artifactFailure(error)
  }
  if (compared.judgeFailures.length > 0) {
    return failure("judge_failed", {
      retryable: true,
      reportPath: reportPath.path,
    })
  }
  if (report.totals.searchFailures > 0) {
    return failure("admin_read_failed", {
      retryable: true,
      reportPath: reportPath.path,
    })
  }
  return {
    ok: true,
    mode: input.mode,
    mastraRunId,
    baselineName,
    reportPath: reportPath.path,
    report,
  }
}
