import { createHash, randomUUID } from "node:crypto"
import { pathToFileURL } from "node:url"

import { prisma } from "@/db/client"
import { TypesenseWatchSearchCandidateGenerationService } from "@/services/typesense-watch-search-candidate-generation"
import {
  DEFAULT_CANDIDATE_QUALIFICATION_EVIDENCE,
  WATCH_SEARCH_CANDIDATE_REQUIRED_EVIDENCE_GATES,
  candidateQualificationEvidenceReason,
  hasCandidateQualificationEvidenceArtifact,
  parseCandidateQualificationEvidence,
  type CandidateQualificationEvidence,
} from "@/services/typesense-watch-search-candidate-qualification"
import { resolveTypesenseWatchSearchApiKey } from "@/services/typesense-client-config"
import {
  candidateWatchSearchApplicationRevision,
  candidateWatchSearchRankingRevision,
} from "@/services/typesense-watch-search-candidate-identity"
import {
  assertQualificationProfilesMatchLease,
  createCandidateWatchSearchProfile,
  freezeCurrentWatchSearchProfile,
  watchSearchBindingMembers,
  type TypesenseWatchSearchCollectionBinding,
} from "@/services/typesense-watch-search-profile"
import type {
  WatchSearchRankingImplementation,
  WatchSearchRankingMode,
} from "@/services/typesense-watch-search-ranking"
import { TypesenseWatchSearchService } from "@/services/typesense-watch-search.service"
import { TypesenseClient } from "@/services/typesense-client"
import type {
  WatchSearchAvailabilityKind,
  WatchSearchInput,
} from "@/services/watch-search.service"
import {
  PRODUCTION_CANDIDATE_BENCHMARK_CASES,
  REQUIRED_CANDIDATE_BENCHMARK_SLICES,
  REQUIRED_CANDIDATE_JUDGED_CASES,
  type CandidateBenchmarkCase,
  type CandidateBenchmarkSlice,
} from "./watch-search-candidate-benchmark-cases"
import {
  WATCH_SEARCH_COMMON_PHRASE_QRELS_REVISION,
  type WatchSearchCandidateEvalTrack,
  type WatchSearchCandidateJudgment,
} from "./watch-search-candidate-intent-eval-cases"

export {
  PRODUCTION_CANDIDATE_BENCHMARK_CASES as PRODUCTION_CASES,
  type CandidateBenchmarkCase,
  type CandidateBenchmarkSlice,
}

const DEFAULT_PAIRS_PER_CASE = 1_000
const EVALUATION_LEASE_RESOURCE = "watch-search-candidate-qualification"
const EVALUATION_LEASE_TTL_MS = 60_000
const MAX_CANDIDATE_LOGICAL_SUBSEARCHES = 6
const MAX_CANDIDATE_QUERY_FIELDS = 64
const MAX_CANDIDATE_QUERY_BY_BYTES = 4_096
const MAX_CANDIDATE_REQUEST_BYTES = 32 * 1_024
const MAX_CANDIDATE_ADDITIONAL_PARSED_RESPONSE_BYTES = 256 * 1_024
const MAX_CANDIDATE_CALLER_P95_MS = 1_000

const REQUIRED_SLICES = REQUIRED_CANDIDATE_BENCHMARK_SLICES
export type CandidateBenchmarkIdentity = {
  generationId: string
  applicationRevision: string
  rankingRevision: ReturnType<typeof candidateWatchSearchRankingRevision>
  transcriptCollection: string
  transcriptProjectionRevision: string
  qrelsRevision: string
  currentBindings: TypesenseWatchSearchCollectionBinding
  candidateBindings: TypesenseWatchSearchCollectionBinding
}

type CandidateDiagnostics = {
  profile: "CURRENT" | "CANDIDATE"
  generationId: string | null
  applicationRevision: string | null
  transcriptProjectionRevision: string | null
  binding: TypesenseWatchSearchCollectionBinding
  retrievalCalls: number
  logicalSubsearches: number
  queryFieldCount: number
  queryByBytes: number
  requestBytes: number
  parsedResponseBytes: number
  typesenseSearchTimeMs: number
  typesenseWallTimeMs: number
  retryCount: number
  groupedHits: number
  candidates: number
  hydratedRecords: number
  rankingImplementation: WatchSearchRankingImplementation
  rankingMode: WatchSearchRankingMode
}

type CandidateCompareSuccess = {
  status: "success"
  callerObservedMs?: number
  response: {
    latencyMs: number
    degraded: boolean
    results: readonly CandidateBenchmarkResult[]
  }
  diagnostics: CandidateDiagnostics
}

type CandidateBenchmarkResult = {
  id: string
  slug: string
  label: string | null
  languageSlug: string | null
  playbackId: string | null
  availability: {
    kind: WatchSearchAvailabilityKind
    languageSlug: string | null
  }
}

type CandidateBenchmarkJudgmentVerdict = {
  passed: boolean
  matchedSlug: string | null
  matchedRank: number | null
  reasons: readonly string[]
}

type CandidateCompareError = {
  status: "error"
  callerObservedMs?: number
  error: { code: string; errorClass: string }
}

type CandidateCompareSide = CandidateCompareSuccess | CandidateCompareError

export type CandidateCompareResponse = {
  comparisonId: string
  executionOrder: "current-first" | "candidate-first"
  current: CandidateCompareSide
  candidate: CandidateCompareSide
}

export type CandidateBenchmarkAttempt = {
  pairIndex: number
  caseId: string
  slices: readonly CandidateBenchmarkSlice[]
  order: "current-first" | "candidate-first"
  side: "current" | "candidate"
  outcome: "success" | "error"
  callerObservedMs: number
  serverMs: number | null
  typesenseWallMs: number | null
  typesenseServerMs: number | null
  degraded: boolean | null
  error: { code: string; errorClass: string } | null
  resultSignature: string | null
  track?: WatchSearchCandidateEvalTrack | null
  relevance?: CandidateBenchmarkJudgmentVerdict | null
  diagnostics: CandidateDiagnostics | null
  identity: CandidateBenchmarkIdentity
}

export type { CandidateQualificationEvidence }

type CandidateBenchmarkDeps = {
  acquireLease(): Promise<{ expiresAt: Date } | null>
  renewLease(): Promise<boolean>
  releaseLease(): Promise<boolean>
  compare(input: {
    benchmarkCase: CandidateBenchmarkCase
    pairIndex: number
    order: "current-first" | "candidate-first"
  }): Promise<CandidateCompareResponse>
  now?: () => Date
}

function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) return 0
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.max(0, Math.ceil(ordered.length * quantile) - 1)] ?? 0
}

function percentiles(values: readonly number[]) {
  return {
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    p99Ms: percentile(values, 0.99),
  }
}

export function evaluateWatchSearchCandidateJudgment(
  judgment: WatchSearchCandidateJudgment,
  results: readonly CandidateBenchmarkResult[],
): CandidateBenchmarkJudgmentVerdict {
  const reasons = new Set<string>()
  const acceptedCanonicalSlugs = [
    ...judgment.expectedCanonicalSlugs,
    ...judgment.acceptableCanonicalSlugs,
  ]
  const expected = results
    .map((result, index) => ({ result, rank: index + 1 }))
    .find(({ result }) => acceptedCanonicalSlugs.includes(result.slug))
  if (!expected) {
    reasons.add("expected_slug_missing")
  } else {
    if (expected.rank > judgment.maxRank) {
      reasons.add("expected_slug_rank_exceeded")
    }
    if (!judgment.allowedContentTypes.includes(expected.result.label ?? "")) {
      reasons.add("expected_slug_content_type_mismatch")
    }
    if (
      !judgment.allowedAvailabilityKinds.includes(
        expected.result.availability.kind,
      )
    ) {
      reasons.add("expected_slug_availability_mismatch")
    }
    if (
      !judgment.allowedLanguageSlugs.includes(
        expected.result.languageSlug ?? "",
      )
    ) {
      reasons.add("expected_slug_language_mismatch")
    }
    if (
      !judgment.allowedLanguageSlugs.includes(
        expected.result.availability.languageSlug ?? "",
      )
    ) {
      reasons.add("expected_slug_availability_language_mismatch")
    }
    if (judgment.requiresPlayback && !expected.result.playbackId) {
      reasons.add("expected_slug_playback_missing")
    }
  }

  if (judgment.requiredAlternate != null) {
    const alternate = results
      .map((result, index) => ({ result, rank: index + 1 }))
      .find(({ result }) =>
        judgment.requiredAlternate!.slugs.includes(result.slug),
      )
    if (!alternate) reasons.add("acceptable_alternate_missing")
    else if (alternate.rank > judgment.requiredAlternate.maxRank) {
      reasons.add("acceptable_alternate_rank_exceeded")
    }
  }

  return {
    passed: reasons.size === 0,
    matchedSlug: expected?.result.slug ?? null,
    matchedRank: expected?.rank ?? null,
    reasons: [...reasons].sort(),
  }
}

function resultSignature(
  results: CandidateCompareSuccess["response"]["results"],
) {
  const projection = results.map((result) => ({
    id: result.id,
    slug: result.slug,
    label: result.label,
    languageSlug: result.languageSlug,
    playbackId: result.playbackId,
    availability: result.availability,
  }))
  return createHash("sha256").update(JSON.stringify(projection)).digest("hex")
}

function sameBindings(
  left: TypesenseWatchSearchCollectionBinding,
  right: TypesenseWatchSearchCollectionBinding,
) {
  return (
    Object.keys(left) as (keyof TypesenseWatchSearchCollectionBinding)[]
  ).every((key) => left[key] === right[key])
}

function sideIdentityMatches(
  side: CandidateCompareSuccess,
  expectedSide: "current" | "candidate",
  identity: CandidateBenchmarkIdentity,
) {
  if (expectedSide === "current") {
    return (
      side.diagnostics.profile === "CURRENT" &&
      side.diagnostics.rankingImplementation === "legacy-rrf" &&
      side.diagnostics.generationId == null &&
      sameBindings(side.diagnostics.binding, identity.currentBindings)
    )
  }
  return (
    side.diagnostics.profile === "CANDIDATE" &&
    side.diagnostics.rankingImplementation === identity.rankingRevision &&
    side.diagnostics.generationId === identity.generationId &&
    side.diagnostics.applicationRevision === identity.applicationRevision &&
    side.diagnostics.transcriptProjectionRevision ===
      identity.transcriptProjectionRevision &&
    sameBindings(side.diagnostics.binding, identity.candidateBindings)
  )
}

function attemptFromSide(input: {
  pairIndex: number
  benchmarkCase: CandidateBenchmarkCase
  order: "current-first" | "candidate-first"
  sideName: "current" | "candidate"
  side: CandidateCompareSide
  identity: CandidateBenchmarkIdentity
}): CandidateBenchmarkAttempt {
  const shared = {
    pairIndex: input.pairIndex,
    caseId: input.benchmarkCase.id,
    slices: input.benchmarkCase.slices,
    order: input.order,
    side: input.sideName,
    identity: input.identity,
    track: input.benchmarkCase.track ?? null,
  }
  const failedRelevance = (reason: string) =>
    input.benchmarkCase.judgment
      ? {
          passed: false,
          matchedSlug: null,
          matchedRank: null,
          reasons: [reason],
        }
      : null
  if (input.side.status === "error") {
    return {
      ...shared,
      outcome: "error",
      callerObservedMs: input.side.callerObservedMs ?? 0,
      serverMs: null,
      typesenseWallMs: null,
      typesenseServerMs: null,
      degraded: null,
      error: input.side.error,
      resultSignature: null,
      relevance: failedRelevance("search_attempt_error"),
      diagnostics: null,
    }
  }
  if (!sideIdentityMatches(input.side, input.sideName, input.identity)) {
    return {
      ...shared,
      outcome: "error",
      callerObservedMs: input.side.callerObservedMs ?? 0,
      serverMs: input.side.response.latencyMs,
      typesenseWallMs: input.side.diagnostics.typesenseWallTimeMs,
      typesenseServerMs: input.side.diagnostics.typesenseSearchTimeMs,
      degraded: input.side.response.degraded,
      error: { code: "identity_mismatch", errorClass: "IdentityDriftError" },
      resultSignature: null,
      relevance: failedRelevance("identity_mismatch"),
      diagnostics: input.side.diagnostics,
    }
  }
  return {
    ...shared,
    outcome: "success",
    callerObservedMs:
      input.side.callerObservedMs ?? input.side.response.latencyMs,
    serverMs: input.side.response.latencyMs,
    typesenseWallMs: input.side.diagnostics.typesenseWallTimeMs,
    typesenseServerMs: input.side.diagnostics.typesenseSearchTimeMs,
    degraded: input.side.response.degraded,
    error: null,
    resultSignature: resultSignature(input.side.response.results),
    relevance: input.benchmarkCase.judgment
      ? evaluateWatchSearchCandidateJudgment(
          input.benchmarkCase.judgment,
          input.side.response.results,
        )
      : null,
    diagnostics: input.side.diagnostics,
  }
}

function successful(
  attempts: readonly CandidateBenchmarkAttempt[],
  side: "current" | "candidate",
) {
  return attempts.filter(
    (attempt) => attempt.side === side && attempt.outcome === "success",
  )
}

function latencyFor(attempts: readonly CandidateBenchmarkAttempt[]) {
  const summarizeSide = (side: "current" | "candidate") => {
    const entries = successful(attempts, side)
    return {
      callerObserved: percentiles(
        entries.map((entry) => entry.callerObservedMs),
      ),
      server: percentiles(
        entries.flatMap((entry) =>
          entry.serverMs == null ? [] : [entry.serverMs],
        ),
      ),
      typesenseWall: percentiles(
        entries.flatMap((entry) =>
          entry.typesenseWallMs == null ? [] : [entry.typesenseWallMs],
        ),
      ),
      typesenseServer: percentiles(
        entries.flatMap((entry) =>
          entry.typesenseServerMs == null ? [] : [entry.typesenseServerMs],
        ),
      ),
    }
  }
  return {
    current: summarizeSide("current"),
    candidate: summarizeSide("candidate"),
  }
}

function pairKey(attempt: CandidateBenchmarkAttempt) {
  return `${attempt.caseId}:${attempt.pairIndex}`
}

function completePairCount(attempts: readonly CandidateBenchmarkAttempt[]) {
  const sides = new Map<string, Set<string>>()
  for (const attempt of attempts) {
    const values = sides.get(pairKey(attempt)) ?? new Set<string>()
    values.add(attempt.side)
    sides.set(pairKey(attempt), values)
  }
  return [...sides.values()].filter((values) => values.size === 2).length
}

function pairedUpperRatio95(
  attempts: readonly CandidateBenchmarkAttempt[],
  metric:
    | "callerObservedMs"
    | "serverMs"
    | "typesenseWallMs"
    | "typesenseServerMs",
) {
  const pairs = new Map<
    string,
    Partial<Record<"current" | "candidate", CandidateBenchmarkAttempt>>
  >()
  for (const attempt of attempts) {
    if (attempt.outcome !== "success") continue
    const pair = pairs.get(pairKey(attempt)) ?? {}
    pair[attempt.side] = attempt
    pairs.set(pairKey(attempt), pair)
  }
  const ratios = [...pairs.values()].flatMap((pair) => {
    const current = pair.current?.[metric]
    const candidate = pair.candidate?.[metric]
    if (current == null || candidate == null || current <= 0) return []
    return [candidate / current]
  })
  if (ratios.length === 0) return null
  const mean = ratios.reduce((total, value) => total + value, 0) / ratios.length
  if (ratios.length === 1) return mean
  const variance =
    ratios.reduce((total, value) => total + (value - mean) ** 2, 0) /
    (ratios.length - 1)
  return mean + 1.645 * Math.sqrt(variance / ratios.length)
}

function latencyRegressionReasons(
  attempts: readonly CandidateBenchmarkAttempt[],
  label: string,
) {
  const reasons: string[] = []
  const summary = latencyFor(attempts)
  for (const surface of [
    "callerObserved",
    "server",
    "typesenseWall",
    "typesenseServer",
  ] as const) {
    for (const quantile of ["p50Ms", "p95Ms", "p99Ms"] as const) {
      if (
        summary.candidate[surface][quantile] >
        summary.current[surface][quantile]
      ) {
        reasons.push(`${label}_${surface}_${quantile}_regressed`)
      }
    }
  }
  if (summary.candidate.callerObserved.p95Ms >= MAX_CANDIDATE_CALLER_P95_MS) {
    reasons.push(`${label}_callerObserved_p95Ms_budget_exceeded`)
  }
  const callerUpper = pairedUpperRatio95(attempts, "callerObservedMs")
  const serverUpper = pairedUpperRatio95(attempts, "serverMs")
  const typesenseWallUpper = pairedUpperRatio95(attempts, "typesenseWallMs")
  const typesenseServerUpper = pairedUpperRatio95(attempts, "typesenseServerMs")
  if (callerUpper == null || callerUpper > 1.05) {
    reasons.push(`${label}_callerObserved_confidence_regressed`)
  }
  if (serverUpper == null || serverUpper > 1.05) {
    reasons.push(`${label}_server_confidence_regressed`)
  }
  if (typesenseWallUpper == null || typesenseWallUpper > 1.05) {
    reasons.push(`${label}_typesenseWall_confidence_regressed`)
  }
  if (typesenseServerUpper == null || typesenseServerUpper > 1.05) {
    reasons.push(`${label}_typesenseServer_confidence_regressed`)
  }
  return reasons
}

function boundedWorkReasons(attempts: readonly CandidateBenchmarkAttempt[]) {
  const reasons = new Set<string>()
  const byPair = new Map<
    string,
    Partial<Record<"current" | "candidate", CandidateBenchmarkAttempt>>
  >()
  for (const attempt of attempts) {
    const entry = byPair.get(pairKey(attempt)) ?? {}
    entry[attempt.side] = attempt
    byPair.set(pairKey(attempt), entry)
    if (attempt.side !== "candidate" || !attempt.diagnostics) continue
    const diagnostics = attempt.diagnostics
    if (diagnostics.retryCount !== 0) reasons.add("candidate_retries")
    if (diagnostics.retrievalCalls > 2) reasons.add("candidate_retrieval_calls")
    if (diagnostics.logicalSubsearches > MAX_CANDIDATE_LOGICAL_SUBSEARCHES) {
      reasons.add("candidate_logical_subsearches")
    }
    if (diagnostics.queryFieldCount > MAX_CANDIDATE_QUERY_FIELDS) {
      reasons.add("candidate_query_fields")
    }
    if (diagnostics.queryByBytes > MAX_CANDIDATE_QUERY_BY_BYTES) {
      reasons.add("candidate_query_by_bytes")
    }
    if (diagnostics.requestBytes > MAX_CANDIDATE_REQUEST_BYTES) {
      reasons.add("candidate_request_bytes")
    }
    if (diagnostics.candidates > 250) reasons.add("candidate_window")
    if (diagnostics.hydratedRecords > 250) reasons.add("candidate_hydration")
  }
  for (const pair of byPair.values()) {
    const current = pair.current?.diagnostics
    const candidate = pair.candidate?.diagnostics
    if (!current || !candidate) continue
    if (candidate.retrievalCalls !== current.retrievalCalls) {
      reasons.add("candidate_retrieval_calls_mismatch")
    }
    if (candidate.logicalSubsearches !== current.logicalSubsearches + 1) {
      reasons.add("candidate_logical_subsearches_mismatch")
    }
    if (
      candidate.parsedResponseBytes >
      current.parsedResponseBytes +
        MAX_CANDIDATE_ADDITIONAL_PARSED_RESPONSE_BYTES
    ) {
      reasons.add("candidate_response_bytes")
    }
    if (candidate.hydratedRecords > current.hydratedRecords) {
      reasons.add("candidate_hydrated_records")
    }
  }
  return [...reasons]
}

function reasonToken(value: string): string {
  return value
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase()
}

export function distinctCaseRelevance(
  attempts: readonly CandidateBenchmarkAttempt[],
) {
  const tracks = ["exact-title", "intent-query"] as const
  const sides = ["current", "candidate"] as const
  const attemptsByTrackAndCase = new Map(
    tracks.map((track) => [
      track,
      new Map<
        string,
        Record<(typeof sides)[number], CandidateBenchmarkAttempt[]>
      >(),
    ]),
  )
  for (const attempt of attempts) {
    if (attempt.track !== "exact-title" && attempt.track !== "intent-query") {
      continue
    }
    const cases = attemptsByTrackAndCase.get(attempt.track)!
    const caseAttempts = cases.get(attempt.caseId) ?? {
      current: [],
      candidate: [],
    }
    caseAttempts[attempt.side].push(attempt)
    cases.set(attempt.caseId, caseAttempts)
  }

  return Object.fromEntries(
    tracks.map((track) => {
      const trackCases = attemptsByTrackAndCase.get(track)!
      const sideReports = Object.fromEntries(
        sides.map((side) => {
          const cases = [...trackCases].map(([caseId, attemptsBySide]) => {
            const caseAttempts = attemptsBySide[side]
            const failedReasons = [
              ...new Set(
                caseAttempts.flatMap((attempt) =>
                  attempt.relevance?.passed === false
                    ? attempt.relevance.reasons
                    : attempt.relevance == null
                      ? ["judgment_missing"]
                      : [],
                ),
              ),
            ].sort()
            return {
              caseId,
              passed:
                caseAttempts.length > 0 &&
                caseAttempts.every(
                  (attempt) => attempt.relevance?.passed === true,
                ),
              attempts: caseAttempts.length,
              failedAttempts: caseAttempts.filter(
                (attempt) => attempt.relevance?.passed !== true,
              ).length,
              reasons: failedReasons,
            }
          })
          const passedCases = cases.filter(({ passed }) => passed).length
          return [
            side,
            {
              totalCases: cases.length,
              passedCases,
              failedCases: cases.length - passedCases,
              successRate:
                cases.length === 0 ? null : passedCases / cases.length,
              cases,
            },
          ]
        }),
      )
      return [track, sideReports]
    }),
  ) as Record<
    WatchSearchCandidateEvalTrack,
    Record<
      "current" | "candidate",
      {
        totalCases: number
        passedCases: number
        failedCases: number
        successRate: number | null
        cases: Array<{
          caseId: string
          passed: boolean
          attempts: number
          failedAttempts: number
          reasons: string[]
        }>
      }
    >
  >
}

export function productionJudgedCaseInventoryReasons(
  cases: readonly CandidateBenchmarkCase[],
): readonly string[] {
  const reasons = new Set<string>()
  for (const required of REQUIRED_CANDIDATE_JUDGED_CASES) {
    const matches = cases.filter(({ id }) => id === required.id)
    if (matches.length === 0) {
      reasons.add(`judged_case_missing_${reasonToken(required.id)}`)
      continue
    }
    if (matches.length > 1) {
      reasons.add(`judged_case_duplicate_${reasonToken(required.id)}`)
    }
    if (
      matches.some(
        ({ track, judgment }) => track !== required.track || !judgment,
      )
    ) {
      reasons.add(`judged_case_malformed_${reasonToken(required.id)}`)
    }
  }
  return [...reasons].sort()
}

export function evaluateCandidateQualification(input: {
  identity: CandidateBenchmarkIdentity
  attempts: readonly CandidateBenchmarkAttempt[]
  requiredPairs: number
  requiredSlices: readonly CandidateBenchmarkSlice[]
  evidence: CandidateQualificationEvidence
  invalidReasons?: readonly string[]
}) {
  const reasons = new Set(input.invalidReasons ?? [])
  if (
    input.identity.qrelsRevision !== WATCH_SEARCH_COMMON_PHRASE_QRELS_REVISION
  ) {
    reasons.add("qrels_revision_mismatch")
  }
  const failures = input.attempts.filter(
    (attempt) => attempt.outcome === "error",
  )
  if (failures.length > 0) reasons.add("attempt_failures")
  if (input.attempts.some((attempt) => attempt.degraded === true)) {
    reasons.add("degraded_attempts")
  }
  if (completePairCount(input.attempts) < input.requiredPairs) {
    reasons.add("aggregate_pair_quota_incomplete")
  }

  const slices = Object.fromEntries(
    input.requiredSlices.map((slice) => {
      const attempts = input.attempts.filter((attempt) =>
        attempt.slices.includes(slice),
      )
      if (completePairCount(attempts) < input.requiredPairs) {
        reasons.add(`${slice}_pair_quota_incomplete`)
      }
      for (const reason of latencyRegressionReasons(attempts, slice)) {
        reasons.add(reason)
      }
      return [
        slice,
        {
          pairs: completePairCount(attempts),
          ...latencyFor(attempts),
          pairedUpperRatio95: {
            callerObserved: pairedUpperRatio95(attempts, "callerObservedMs"),
            server: pairedUpperRatio95(attempts, "serverMs"),
            typesenseWall: pairedUpperRatio95(attempts, "typesenseWallMs"),
            typesenseServer: pairedUpperRatio95(attempts, "typesenseServerMs"),
          },
        },
      ]
    }),
  )

  for (const reason of latencyRegressionReasons(input.attempts, "aggregate")) {
    reasons.add(reason)
  }
  for (const reason of boundedWorkReasons(input.attempts)) reasons.add(reason)
  const relevance = distinctCaseRelevance(input.attempts)
  for (const track of ["exact-title", "intent-query"] as const) {
    for (const evalCase of relevance[track].candidate.cases) {
      if (evalCase.passed) continue
      if (evalCase.reasons.length === 0) {
        reasons.add(
          `candidate_${reasonToken(track)}_${reasonToken(evalCase.caseId)}_failed`,
        )
      }
      for (const reason of evalCase.reasons) {
        reasons.add(
          `candidate_${reasonToken(track)}_${reasonToken(evalCase.caseId)}_${reasonToken(reason)}`,
        )
      }
    }
  }
  for (const gate of WATCH_SEARCH_CANDIDATE_REQUIRED_EVIDENCE_GATES) {
    if (input.evidence[gate] !== "PASS") {
      reasons.add(`${candidateQualificationEvidenceReason(gate)}_not_passed`)
      continue
    }
    if (!hasCandidateQualificationEvidenceArtifact(input.evidence, gate)) {
      reasons.add(
        `${candidateQualificationEvidenceReason(gate)}_artifact_missing`,
      )
    }
  }

  const invalid = [...reasons].some((reason) =>
    [
      "lease_unavailable",
      "lease_expired",
      "lease_lost",
      "identity_drift",
      "qrels_revision_mismatch",
    ].includes(reason),
  )
  return {
    status: invalid
      ? ("INVALID" as const)
      : reasons.size === 0
        ? ("QUALIFIED" as const)
        : ("NOT_QUALIFIED" as const),
    reasons: [...reasons].sort(),
    identity: input.identity,
    attempts: input.attempts,
    attemptedPairs: completePairCount(input.attempts),
    failures: failures.length,
    degraded: input.attempts.filter((attempt) => attempt.degraded === true)
      .length,
    latency: {
      aggregate: {
        ...latencyFor(input.attempts),
        pairedUpperRatio95: {
          callerObserved: pairedUpperRatio95(
            input.attempts,
            "callerObservedMs",
          ),
          server: pairedUpperRatio95(input.attempts, "serverMs"),
          typesenseWall: pairedUpperRatio95(input.attempts, "typesenseWallMs"),
          typesenseServer: pairedUpperRatio95(
            input.attempts,
            "typesenseServerMs",
          ),
        },
      },
      slices,
    },
    relevance: {
      qrelsRevision: input.identity.qrelsRevision,
      tracks: relevance,
    },
    evidence: input.evidence,
  }
}

export async function runPairedCandidateBenchmark(
  input: {
    identity: CandidateBenchmarkIdentity
    cases: readonly CandidateBenchmarkCase[]
    pairsPerCase: number
    evidence?: CandidateQualificationEvidence
  },
  deps: CandidateBenchmarkDeps,
) {
  const attempts: CandidateBenchmarkAttempt[] = []
  const invalidReasons: string[] = []
  const qualificationReasons = productionJudgedCaseInventoryReasons(input.cases)
  const now = deps.now ?? (() => new Date())
  const lease = await deps.acquireLease()
  if (!lease) invalidReasons.push("lease_unavailable")
  else if (lease.expiresAt.getTime() <= now().getTime()) {
    invalidReasons.push("lease_expired")
  }

  try {
    if (invalidReasons.length === 0) {
      let globalPairIndex = 0
      benchmark: for (const benchmarkCase of input.cases) {
        for (let casePair = 0; casePair < input.pairsPerCase; casePair++) {
          const order =
            globalPairIndex % 2 === 0 ? "current-first" : "candidate-first"
          if (!(await deps.renewLease())) {
            invalidReasons.push("lease_lost")
            break benchmark
          }
          let comparison: CandidateCompareResponse
          try {
            comparison = await deps.compare({
              benchmarkCase,
              pairIndex: globalPairIndex,
              order,
            })
          } catch (error) {
            const failedSide = (side: "current" | "candidate") =>
              attemptFromSide({
                pairIndex: globalPairIndex,
                benchmarkCase,
                order,
                sideName: side,
                side: {
                  status: "error",
                  error: {
                    code: "comparison_failed",
                    errorClass:
                      error instanceof Error
                        ? error.constructor.name
                        : "UnknownError",
                  },
                },
                identity: input.identity,
              })
            attempts.push(failedSide("current"), failedSide("candidate"))
            globalPairIndex++
            continue
          }
          if (comparison.executionOrder !== order) {
            invalidReasons.push("identity_drift")
            break benchmark
          }
          const pairAttempts = (["current", "candidate"] as const).map((side) =>
            attemptFromSide({
              pairIndex: globalPairIndex,
              benchmarkCase,
              order,
              sideName: side,
              side: comparison[side],
              identity: input.identity,
            }),
          )
          attempts.push(...pairAttempts)
          if (
            pairAttempts.some(
              (attempt) => attempt.error?.code === "identity_mismatch",
            )
          ) {
            invalidReasons.push("identity_drift")
            break benchmark
          }
          globalPairIndex++
        }
      }
    }
  } finally {
    if (lease) await deps.releaseLease().catch(() => false)
  }

  return evaluateCandidateQualification({
    identity: input.identity,
    attempts,
    requiredPairs: input.pairsPerCase,
    requiredSlices: REQUIRED_SLICES,
    evidence: input.evidence ?? DEFAULT_CANDIDATE_QUALIFICATION_EVIDENCE,
    invalidReasons: [...invalidReasons, ...qualificationReasons],
  })
}

function evidenceFromEnvironment(): CandidateQualificationEvidence {
  return parseCandidateQualificationEvidence(
    process.env.WATCH_SEARCH_CANDIDATE_EVIDENCE_JSON,
  )
}

export function normalizeCandidateBenchmarkDiagnostics(
  diagnostics: Awaited<
    ReturnType<TypesenseWatchSearchService["searchWithDiagnostics"]>
  >["diagnostics"],
): CandidateDiagnostics {
  return {
    profile: diagnostics.profile,
    generationId: diagnostics.generationId,
    applicationRevision: diagnostics.applicationRevision,
    transcriptProjectionRevision:
      diagnostics.transcriptProjectionRevision?.toString() ?? null,
    binding: diagnostics.binding,
    retrievalCalls: diagnostics.retrievalCalls,
    logicalSubsearches: diagnostics.logicalSubsearches,
    queryFieldCount: diagnostics.queryFieldCount,
    queryByBytes: diagnostics.queryByBytes,
    requestBytes: diagnostics.requestBytes,
    parsedResponseBytes: diagnostics.parsedResponseBytes,
    typesenseSearchTimeMs: diagnostics.typesenseSearchTimeMs,
    typesenseWallTimeMs: diagnostics.typesenseWallTimeMs,
    retryCount: diagnostics.retryCount,
    groupedHits: diagnostics.groupedHits,
    candidates: diagnostics.candidates,
    hydratedRecords: diagnostics.hydratedRecords,
    rankingImplementation: diagnostics.rankingImplementation,
    rankingMode: diagnostics.rankingMode,
  }
}

async function executeProfile(
  service: TypesenseWatchSearchService,
  input: WatchSearchInput,
): Promise<CandidateCompareSide> {
  const startedAt = performance.now()
  try {
    const result = await service.searchWithDiagnostics(input)
    return {
      status: "success",
      callerObservedMs: performance.now() - startedAt,
      response: {
        latencyMs: result.response.latencyMs,
        degraded: result.response.degraded,
        results: result.response.results.map((entry) => ({
          id: entry.id,
          slug: entry.slug,
          label: entry.label,
          languageSlug: entry.languageSlug,
          playbackId: entry.playbackId,
          availability: {
            kind: entry.availability.kind,
            languageSlug: entry.availability.languageSlug,
          },
        })),
      },
      diagnostics: normalizeCandidateBenchmarkDiagnostics(result.diagnostics),
    }
  } catch (error) {
    return {
      status: "error",
      callerObservedMs: performance.now() - startedAt,
      error: {
        code: "search_failed",
        errorClass:
          error instanceof Error ? error.constructor.name : "UnknownError",
      },
    }
  }
}

export function parseCandidateBenchmarkEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): { host: string; apiKey: string; qrelsRevision: string } {
  const host = environment.TYPESENSE_HOST
  const apiKey = resolveTypesenseWatchSearchApiKey({
    searchApiKey: environment.TYPESENSE_SEARCH_API_KEY,
    legacyApiKey: environment.TYPESENSE_API_KEY,
    allowLegacyFallback: false,
  })
  const qrelsRevision = environment.WATCH_SEARCH_CANDIDATE_QRELS_REVISION
  if (!host || !apiKey || !qrelsRevision?.trim()) {
    throw new Error(
      "TYPESENSE_HOST, TYPESENSE_SEARCH_API_KEY, and WATCH_SEARCH_CANDIDATE_QRELS_REVISION are required",
    )
  }
  const normalizedQrelsRevision = qrelsRevision.trim()
  if (normalizedQrelsRevision !== WATCH_SEARCH_COMMON_PHRASE_QRELS_REVISION) {
    throw new Error(
      `WATCH_SEARCH_CANDIDATE_QRELS_REVISION does not match code-owned revision ${WATCH_SEARCH_COMMON_PHRASE_QRELS_REVISION}`,
    )
  }
  return { host, apiKey, qrelsRevision: normalizedQrelsRevision }
}

async function main() {
  const { host, apiKey, qrelsRevision } = parseCandidateBenchmarkEnvironment(
    process.env,
  )
  const pairsPerCase = Number(
    process.env.WATCH_SEARCH_CANDIDATE_PAIRS_PER_CASE ?? DEFAULT_PAIRS_PER_CASE,
  )
  if (
    !Number.isInteger(pairsPerCase) ||
    pairsPerCase < 1 ||
    pairsPerCase > 10_000
  ) {
    throw new Error("WATCH_SEARCH_CANDIDATE_PAIRS_PER_CASE must be 1..10000")
  }

  const applicationRevision = candidateWatchSearchApplicationRevision()
  const rankingRevision = candidateWatchSearchRankingRevision()
  const typesense = new TypesenseClient({ host, apiKey, timeoutMs: 2_000 })
  const generations = new TypesenseWatchSearchCandidateGenerationService(
    prisma,
    typesense,
  )
  const pointer = await generations.getPointer("EVALUATION")
  if (!pointer.generationId) throw new Error("evaluation pointer is empty")
  const generation = await generations.getGeneration(pointer.generationId)
  const current = await freezeCurrentWatchSearchProfile(typesense)
  const candidate = createCandidateWatchSearchProfile(
    await generations.resolveGeneration({
      generationId: generation.id,
      applicationRevision,
      transcriptCollection: generation.transcriptCollection,
      transcriptProjectionRevision: generation.transcriptProjectionRevision,
      requireQualified: false,
    }),
    { qrelsRevision, rankingRevision },
  )
  const identity: CandidateBenchmarkIdentity = {
    generationId: generation.id,
    applicationRevision,
    rankingRevision,
    transcriptCollection: candidate.binding.transcript,
    transcriptProjectionRevision:
      candidate.transcriptProjectionRevision!.toString(),
    qrelsRevision,
    currentBindings: current.binding,
    candidateBindings: candidate.binding,
  }
  const holderToken = randomUUID()
  let expiresAt = new Date(0)
  const currentSearch = new TypesenseWatchSearchService(prisma, typesense, {
    profile: current,
  })
  const candidateSearch = new TypesenseWatchSearchService(prisma, typesense, {
    profile: candidate,
  })

  const report = await runPairedCandidateBenchmark(
    {
      identity,
      cases: PRODUCTION_CANDIDATE_BENCHMARK_CASES,
      pairsPerCase,
      evidence: evidenceFromEnvironment(),
    },
    {
      acquireLease: async () => {
        const lease = await generations.acquireLease({
          resourceKey: EVALUATION_LEASE_RESOURCE,
          kind: "EVALUATION",
          holderToken,
          ttlMs: EVALUATION_LEASE_TTL_MS,
          generationId: identity.generationId,
          applicationRevision: identity.applicationRevision,
          transcriptCollection: identity.transcriptCollection,
          transcriptProjectionRevision: BigInt(
            identity.transcriptProjectionRevision,
          ),
          currentBindings: watchSearchBindingMembers(current),
        })
        if (!lease) return null
        expiresAt = lease.expiresAt
        return { expiresAt }
      },
      renewLease: async () => {
        const renewed = await generations.renewLease({
          resourceKey: EVALUATION_LEASE_RESOURCE,
          holderToken,
          ttlMs: EVALUATION_LEASE_TTL_MS,
        })
        if (renewed) expiresAt = new Date(Date.now() + EVALUATION_LEASE_TTL_MS)
        return renewed
      },
      releaseLease: () =>
        generations.releaseLease({
          resourceKey: EVALUATION_LEASE_RESOURCE,
          holderToken,
        }),
      compare: async ({ benchmarkCase, pairIndex, order }) => {
        assertQualificationProfilesMatchLease({
          current,
          candidate,
          lease: {
            generationId: identity.generationId,
            applicationRevision: identity.applicationRevision,
            transcriptCollection: identity.transcriptCollection,
            transcriptProjectionRevision: BigInt(
              identity.transcriptProjectionRevision,
            ),
            currentBindings: watchSearchBindingMembers(current),
            expiresAt,
          },
        })
        const input: WatchSearchInput = {
          query: benchmarkCase.query,
          targetLanguageSlug: benchmarkCase.languageSlug,
          displayLanguageSlug: benchmarkCase.languageSlug,
          acceptLanguage: benchmarkCase.locale,
          resultTypes: ["video"],
          limit: 10,
          clientRequestId: `candidate-qualification-${pairIndex}-${randomUUID()}`,
        }
        let currentResult: CandidateCompareSide
        let candidateResult: CandidateCompareSide
        if (order === "current-first") {
          currentResult = await executeProfile(currentSearch, input)
          candidateResult = await executeProfile(candidateSearch, input)
        } else {
          candidateResult = await executeProfile(candidateSearch, input)
          currentResult = await executeProfile(currentSearch, input)
        }
        return {
          comparisonId: input.clientRequestId!,
          executionOrder: order,
          current: currentResult,
          candidate: candidateResult,
        }
      },
    },
  )

  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: "watch-search-candidate-qualification/v2",
        generatedAt: new Date().toISOString(),
        ...report,
      },
      null,
      2,
    )}\n`,
  )
  if (report.status !== "QUALIFIED") process.exitCode = 2
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(
      `[watch-search-candidate-benchmark] ${error instanceof Error ? error.stack : String(error)}\n`,
    )
    process.exitCode = 1
  })
}
