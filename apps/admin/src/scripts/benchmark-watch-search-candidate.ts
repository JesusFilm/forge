import { createHash, randomUUID } from "node:crypto"
import { pathToFileURL } from "node:url"

import { prisma } from "@/db/client"
import { TypesenseWatchSearchCandidateGenerationService } from "@/services/typesense-watch-search-candidate-generation"
import { candidateWatchSearchApplicationRevision } from "@/services/typesense-watch-search-candidate-identity"
import {
  assertQualificationProfilesMatchLease,
  createCandidateWatchSearchProfile,
  freezeCurrentWatchSearchProfile,
  watchSearchBindingMembers,
  type TypesenseWatchSearchCollectionBinding,
} from "@/services/typesense-watch-search-profile"
import {
  resolveTypesenseWatchSearchApiKey,
  TypesenseWatchSearchService,
} from "@/services/typesense-watch-search.service"
import { TypesenseClient } from "@/services/typesense-client"
import type { WatchSearchInput } from "@/services/watch-search.service"

const DEFAULT_PAIRS_PER_CASE = 1_000
const EVALUATION_LEASE_RESOURCE = "watch-search-candidate-qualification"
const EVALUATION_LEASE_TTL_MS = 60_000
const MAX_CANDIDATE_LOGICAL_SUBSEARCHES = 5
const MAX_CANDIDATE_QUERY_FIELDS = 64
const MAX_CANDIDATE_QUERY_BY_BYTES = 4_096
const MAX_CANDIDATE_REQUEST_BYTES = 32 * 1_024

const REQUIRED_SLICES = [
  "exact-title",
  "mixed-language",
  "native-title",
  "topical",
  "semantic",
  "broad-title",
] as const

type CandidateBenchmarkSlice = (typeof REQUIRED_SLICES)[number]
type EvidenceStatus = "PASS" | "FAIL" | "NOT_RUN"

export type CandidateBenchmarkIdentity = {
  generationId: string
  applicationRevision: string
  transcriptCollection: string
  transcriptProjectionRevision: string
  qrelsRevision: string
  currentBindings: TypesenseWatchSearchCollectionBinding
  candidateBindings: TypesenseWatchSearchCollectionBinding
}

export type CandidateBenchmarkCase = {
  id: string
  query: string
  locale?: string
  languageSlug?: string
  slices: readonly CandidateBenchmarkSlice[]
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
}

type CandidateCompareSuccess = {
  status: "success"
  callerObservedMs?: number
  response: {
    latencyMs: number
    degraded: boolean
    results: readonly {
      id: string
      languageSlug?: string | null
      playbackId?: string | null
    }[]
  }
  diagnostics: CandidateDiagnostics
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
  degraded: boolean | null
  error: { code: string; errorClass: string } | null
  resultSignature: string | null
  diagnostics: CandidateDiagnostics | null
  identity: CandidateBenchmarkIdentity
}

export type CandidateQualificationEvidence = {
  relevance: EvidenceStatus
  fixedLoadResources: EvidenceStatus
  currentInterference: EvidenceStatus
  operatorReview: EvidenceStatus
  artifacts?: Readonly<Record<string, string>>
}

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

const DEFAULT_EVIDENCE: CandidateQualificationEvidence = {
  relevance: "NOT_RUN",
  fixedLoadResources: "NOT_RUN",
  currentInterference: "NOT_RUN",
  operatorReview: "NOT_RUN",
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

function resultSignature(
  results: CandidateCompareSuccess["response"]["results"],
) {
  const projection = results.map((result) => ({
    id: result.id,
    languageSlug: result.languageSlug ?? null,
    playbackId: result.playbackId ?? null,
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
      side.diagnostics.generationId == null &&
      sameBindings(side.diagnostics.binding, identity.currentBindings)
    )
  }
  return (
    side.diagnostics.profile === "CANDIDATE" &&
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
  }
  if (input.side.status === "error") {
    return {
      ...shared,
      outcome: "error",
      callerObservedMs: input.side.callerObservedMs ?? 0,
      serverMs: null,
      degraded: null,
      error: input.side.error,
      resultSignature: null,
      diagnostics: null,
    }
  }
  if (!sideIdentityMatches(input.side, input.sideName, input.identity)) {
    return {
      ...shared,
      outcome: "error",
      callerObservedMs: input.side.callerObservedMs ?? 0,
      serverMs: input.side.response.latencyMs,
      degraded: input.side.response.degraded,
      error: { code: "identity_mismatch", errorClass: "IdentityDriftError" },
      resultSignature: null,
      diagnostics: input.side.diagnostics,
    }
  }
  return {
    ...shared,
    outcome: "success",
    callerObservedMs:
      input.side.callerObservedMs ?? input.side.response.latencyMs,
    serverMs: input.side.response.latencyMs,
    degraded: input.side.response.degraded,
    error: null,
    resultSignature: resultSignature(input.side.response.results),
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
  metric: "callerObservedMs" | "serverMs",
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
  for (const surface of ["callerObserved", "server"] as const) {
    for (const quantile of ["p50Ms", "p95Ms", "p99Ms"] as const) {
      if (
        summary.candidate[surface][quantile] >
        summary.current[surface][quantile]
      ) {
        reasons.push(`${label}_${surface}_${quantile}_regressed`)
      }
    }
  }
  const callerUpper = pairedUpperRatio95(attempts, "callerObservedMs")
  const serverUpper = pairedUpperRatio95(attempts, "serverMs")
  if (callerUpper == null || callerUpper > 1.05) {
    reasons.push(`${label}_callerObserved_confidence_regressed`)
  }
  if (serverUpper == null || serverUpper > 1.05) {
    reasons.push(`${label}_server_confidence_regressed`)
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
    if (candidate.parsedResponseBytes > current.parsedResponseBytes) {
      reasons.add("candidate_response_bytes")
    }
    if (candidate.hydratedRecords > current.hydratedRecords) {
      reasons.add("candidate_hydrated_records")
    }
  }
  return [...reasons]
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
          },
        },
      ]
    }),
  )

  for (const reason of latencyRegressionReasons(input.attempts, "aggregate")) {
    reasons.add(reason)
  }
  for (const reason of boundedWorkReasons(input.attempts)) reasons.add(reason)
  for (const [gate, status] of Object.entries(input.evidence)) {
    if (gate === "artifacts") continue
    if (status !== "PASS")
      reasons.add(
        `${gate.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}_not_passed`,
      )
  }

  const invalid = [...reasons].some((reason) =>
    [
      "lease_unavailable",
      "lease_expired",
      "lease_lost",
      "identity_drift",
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
        },
      },
      slices,
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
    evidence: input.evidence ?? DEFAULT_EVIDENCE,
    invalidReasons,
  })
}

const PRODUCTION_CASES: readonly CandidateBenchmarkCase[] = [
  {
    id: "jesus-japanese-mixed",
    query: "Jesus Japanese",
    locale: "ja",
    languageSlug: "japanese",
    slices: ["exact-title", "mixed-language", "broad-title"],
  },
  {
    id: "jesus-chinese-native",
    query: "耶稣",
    locale: "zh-Hans",
    languageSlug: "mandarin-china",
    slices: ["exact-title", "native-title", "broad-title"],
  },
  {
    id: "jesus-arabic-native",
    query: "يسوع",
    locale: "ar",
    languageSlug: "arabic-modern-standard",
    slices: ["native-title", "broad-title"],
  },
  {
    id: "forgiveness-spanish-topic",
    query: "perdón después del fracaso",
    locale: "es",
    languageSlug: "spanish-latin-america",
    slices: ["topical"],
  },
  {
    id: "hope-when-heavy-semantic",
    query: "finding hope when life feels heavy",
    locale: "en",
    languageSlug: "english",
    slices: ["semantic"],
  },
] as const

function evidenceFromEnvironment(): CandidateQualificationEvidence {
  const raw = process.env.WATCH_SEARCH_CANDIDATE_EVIDENCE_JSON
  if (!raw) return DEFAULT_EVIDENCE
  const parsed = JSON.parse(raw) as CandidateQualificationEvidence
  for (const key of [
    "relevance",
    "fixedLoadResources",
    "currentInterference",
    "operatorReview",
  ] as const) {
    if (!["PASS", "FAIL", "NOT_RUN"].includes(parsed[key])) {
      throw new Error(`invalid evidence status for ${key}`)
    }
  }
  if (
    Object.values(parsed).some((value) => value === "PASS") &&
    (!parsed.artifacts || Object.keys(parsed.artifacts).length === 0)
  ) {
    throw new Error("PASS evidence requires artifact references")
  }
  return parsed
}

function normalizeDiagnostics(
  diagnostics: Awaited<
    ReturnType<TypesenseWatchSearchService["searchWithDiagnostics"]>
  >["diagnostics"],
): CandidateDiagnostics {
  return {
    ...diagnostics,
    transcriptProjectionRevision:
      diagnostics.transcriptProjectionRevision?.toString() ?? null,
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
          languageSlug: entry.languageSlug,
          playbackId: entry.playbackId,
        })),
      },
      diagnostics: normalizeDiagnostics(result.diagnostics),
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
  return { host, apiKey, qrelsRevision: qrelsRevision.trim() }
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
  )
  const identity: CandidateBenchmarkIdentity = {
    generationId: generation.id,
    applicationRevision,
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
      cases: PRODUCTION_CASES,
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
        schemaVersion: "watch-search-candidate-qualification/v1",
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
