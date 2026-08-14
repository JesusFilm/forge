import type { PrismaClient } from "@prisma/client"

import type { TypesenseClient } from "@/services/typesense-client"
import { TYPESENSE_WATCH_SEARCH_CANDIDATE_APPLICATION_REVISION } from "@/services/typesense-watch-search-candidate-identity"
import { TypesenseWatchSearchSuggestionsService } from "@/services/typesense-watch-search-suggestions"

export type SuggestionBenchmarkVersion = "v1" | "v2"
export type SuggestionBenchmarkCacheState = "cold" | "warm"
export type SuggestionBenchmarkOrder = "v1-first" | "v2-first"
export type SuggestionBenchmarkPhase =
  | "retrieval"
  | "validation"
  | "hydration"
  | "total"

export type SuggestionRequestEnvelope = {
  retrievalHttpRequests: number
  retrievalSubsearches: number
  baselineQueryFields: number
  expansionQueryFields: number
  validationHttpRequests: number
  validationSubsearches: number
  hydrationQueries: number
  queryByBytes: number
  retrievalRequestBytes: number
  maxCandidateGroupsPerLane: number
  querySuggestions: number
  directMatches: number
  retries: number
}

export type SuggestionBenchmarkSample = {
  version: SuggestionBenchmarkVersion
  cacheState: SuggestionBenchmarkCacheState
  order: SuggestionBenchmarkOrder
  durationMs: Record<SuggestionBenchmarkPhase, number>
  request: SuggestionRequestEnvelope
}

type SearchableBytesByFamily = {
  baselineTitleMetadata: number
  stemTitleMetadata: number
  exactTaxonomy: number
  stemTaxonomy: number
}

export type SuggestionCapacityEvidence = {
  currentPhysicalCollection: string
  candidatePhysicalCollection: string
  currentSearchableBytesByFamily: SearchableBytesByFamily
  candidateSearchableBytesByFamily: SearchableBytesByFamily
  predictedCandidateSearchableBytes: number
  importedCandidateSearchableBytes: number
  serviceLimitBytes: number
  v1V2PeakRssBytes: number
  settledRssBytes: number
  publicationLockDurationMs: number
}

export type SuggestionPercentiles = {
  p50: number
  p95: number
  p99: number
}

const VERSIONS = ["v1", "v2"] as const
const CACHE_STATES = ["cold", "warm"] as const
const ORDERS = ["v1-first", "v2-first"] as const
const PHASES = ["retrieval", "validation", "hydration", "total"] as const
const PERCENTILES = ["p50", "p95", "p99"] as const
const WEB_SUGGESTION_TIMEOUT_MS = 3_500

const REQUEST_LIMITS: SuggestionRequestEnvelope = {
  retrievalHttpRequests: 1,
  retrievalSubsearches: 2,
  baselineQueryFields: 4,
  expansionQueryFields: 5,
  validationHttpRequests: 1,
  validationSubsearches: 6,
  hydrationQueries: 1,
  queryByBytes: 4_096,
  retrievalRequestBytes: 32_768,
  maxCandidateGroupsPerLane: 25,
  querySuggestions: 6,
  directMatches: 6,
  retries: 0,
}

const REQUEST_LABELS: Record<keyof SuggestionRequestEnvelope, string> = {
  retrievalHttpRequests: "retrieval HTTP requests",
  retrievalSubsearches: "retrieval subsearches",
  baselineQueryFields: "baseline query fields",
  expansionQueryFields: "expansion query fields",
  validationHttpRequests: "validation HTTP requests",
  validationSubsearches: "validation subsearches",
  hydrationQueries: "hydration queries",
  queryByBytes: "query_by bytes",
  retrievalRequestBytes: "retrieval request bytes",
  maxCandidateGroupsPerLane: "candidate groups per lane",
  querySuggestions: "query suggestions",
  directMatches: "direct matches",
  retries: "retries",
}

function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)]!
}

export function suggestionPercentiles(
  values: readonly number[],
): SuggestionPercentiles {
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error(
      "suggestion benchmark durations must be finite and non-negative",
    )
  }
  return {
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
  }
}

type SuggestionLatencyReport = Record<
  SuggestionBenchmarkVersion,
  Record<
    SuggestionBenchmarkCacheState,
    Record<SuggestionBenchmarkPhase, SuggestionPercentiles>
  >
>

function latencyReport(
  samples: readonly SuggestionBenchmarkSample[],
): SuggestionLatencyReport {
  return Object.fromEntries(
    VERSIONS.map((version) => [
      version,
      Object.fromEntries(
        CACHE_STATES.map((cacheState) => [
          cacheState,
          Object.fromEntries(
            PHASES.map((phase) => [
              phase,
              suggestionPercentiles(
                samples
                  .filter(
                    (sample) =>
                      sample.version === version &&
                      sample.cacheState === cacheState,
                  )
                  .map((sample) => sample.durationMs[phase]),
              ),
            ]),
          ),
        ]),
      ),
    ]),
  ) as SuggestionLatencyReport
}

function maximumRequestEnvelope(
  samples: readonly SuggestionBenchmarkSample[],
): Record<SuggestionBenchmarkVersion, SuggestionRequestEnvelope> {
  return Object.fromEntries(
    VERSIONS.map((version) => {
      const versionSamples = samples.filter(
        (sample) => sample.version === version,
      )
      return [
        version,
        Object.fromEntries(
          (
            Object.keys(REQUEST_LIMITS) as Array<
              keyof SuggestionRequestEnvelope
            >
          ).map((key) => [
            key,
            Math.max(0, ...versionSamples.map((sample) => sample.request[key])),
          ]),
        ) as SuggestionRequestEnvelope,
      ]
    }),
  ) as Record<SuggestionBenchmarkVersion, SuggestionRequestEnvelope>
}

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}

export function evaluateSuggestionCandidateQualification(input: {
  samples: readonly SuggestionBenchmarkSample[]
  capacity: SuggestionCapacityEvidence
}) {
  const reasons = new Set<string>()
  for (const version of VERSIONS) {
    for (const cacheState of CACHE_STATES) {
      for (const order of ORDERS) {
        if (
          !input.samples.some(
            (sample) =>
              sample.version === version &&
              sample.cacheState === cacheState &&
              sample.order === order,
          )
        ) {
          reasons.add(
            `missing ${version}/${cacheState}/${order} benchmark sample`,
          )
        }
      }
    }
  }

  for (const sample of input.samples) {
    for (const phase of PHASES) {
      if (!finiteNonNegative(sample.durationMs[phase])) {
        reasons.add(
          `${sample.version}/${sample.cacheState}/${sample.order} ${phase} duration is invalid`,
        )
      }
    }
    for (const key of Object.keys(REQUEST_LIMITS) as Array<
      keyof SuggestionRequestEnvelope
    >) {
      const observed = sample.request[key]
      if (!finiteNonNegative(observed) || observed > REQUEST_LIMITS[key]) {
        reasons.add(
          `${sample.version}/${sample.cacheState}/${sample.order} ${REQUEST_LABELS[key]} ${observed} exceed ${REQUEST_LIMITS[key]}`,
        )
      }
    }
  }

  const latency = latencyReport(input.samples)
  for (const cacheState of CACHE_STATES) {
    for (const phase of PHASES) {
      for (const key of PERCENTILES) {
        const baseline = latency.v1[cacheState][phase][key]
        const candidate = latency.v2[cacheState][phase][key]
        if (candidate > baseline) {
          reasons.add(
            `v2 ${cacheState} ${phase} ${key} regressed from ${baseline}ms to ${candidate}ms`,
          )
        }
      }
    }
    const totalP99 = latency.v2[cacheState].total.p99
    if (totalP99 >= WEB_SUGGESTION_TIMEOUT_MS) {
      reasons.add(
        `v2 ${cacheState} total p99 ${totalP99}ms reaches the ${WEB_SUGGESTION_TIMEOUT_MS}ms Web timeout`,
      )
    }
  }

  const capacityValues = [
    ...Object.values(input.capacity.currentSearchableBytesByFamily),
    ...Object.values(input.capacity.candidateSearchableBytesByFamily),
    input.capacity.predictedCandidateSearchableBytes,
    input.capacity.importedCandidateSearchableBytes,
    input.capacity.serviceLimitBytes,
    input.capacity.v1V2PeakRssBytes,
    input.capacity.settledRssBytes,
    input.capacity.publicationLockDurationMs,
  ]
  if (
    capacityValues.some((value) => !finiteNonNegative(value)) ||
    input.capacity.serviceLimitBytes <= 0
  ) {
    reasons.add("capacity evidence contains invalid values")
  }
  if (
    input.capacity.currentPhysicalCollection ===
      input.capacity.candidatePhysicalCollection ||
    !input.capacity.currentPhysicalCollection.trim() ||
    !input.capacity.candidatePhysicalCollection.trim()
  ) {
    reasons.add("current and candidate physical collections must be distinct")
  }
  const predictedImportedDeltaRatio =
    input.capacity.predictedCandidateSearchableBytes === 0
      ? input.capacity.importedCandidateSearchableBytes === 0
        ? 0
        : Number.POSITIVE_INFINITY
      : Math.abs(
          input.capacity.importedCandidateSearchableBytes -
            input.capacity.predictedCandidateSearchableBytes,
        ) / input.capacity.predictedCandidateSearchableBytes
  if (predictedImportedDeltaRatio > 0.1) {
    reasons.add("predicted/imported searchable bytes differ by more than 10%")
  }
  const peakFreeRatio =
    1 - input.capacity.v1V2PeakRssBytes / input.capacity.serviceLimitBytes
  if (peakFreeRatio < 0.4) {
    reasons.add("v1+v2 peak RSS leaves less than 40% service memory free")
  }
  const settledFreeRatio =
    1 - input.capacity.settledRssBytes / input.capacity.serviceLimitBytes
  if (settledFreeRatio < 0.5) {
    reasons.add("settled RSS leaves less than 50% service memory free")
  }

  return {
    schemaVersion: "watch-search-suggestions-candidate-local/v1" as const,
    status: reasons.size === 0 ? ("QUALIFIED" as const) : ("REJECTED" as const),
    reasons: [...reasons],
    productionCandidateBenchmark: "NOT_RUN" as const,
    aliasSmoke: "NOT_RUN" as const,
    latency,
    requestEnvelope: maximumRequestEnvelope(input.samples),
    capacity: {
      ...input.capacity,
      predictedImportedDeltaRatio,
      peakFreeRatio,
      settledFreeRatio,
    },
  }
}

export function bindCandidateWatchSearchSuggestionsService(input: {
  prisma: Pick<PrismaClient, "language" | "video">
  typesense: Pick<TypesenseClient, "multiSearch" | "multiSearchSettled">
  candidateLexicalCollection: string
  logger?: Pick<Console, "warn">
}): TypesenseWatchSearchSuggestionsService {
  if (
    !/^watch_search_candidate_[A-Za-z0-9][A-Za-z0-9_-]{0,63}_lexical$/.test(
      input.candidateLexicalCollection,
    )
  ) {
    throw new Error(
      "suggestion qualification requires an exact physical candidate lexical collection",
    )
  }
  return new TypesenseWatchSearchSuggestionsService(
    input.prisma,
    input.typesense,
    input.logger,
    TYPESENSE_WATCH_SEARCH_CANDIDATE_APPLICATION_REVISION,
    input.candidateLexicalCollection,
  )
}
