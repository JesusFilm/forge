import { persistCandidateStageEvidence } from "./candidate-evidence-persistence"
import {
  CANDIDATE_TRACE_FORMAT_VERSION,
  candidateTracePayload,
  type CandidateEvidenceRow,
} from "./candidate-trace"
import { env } from "@/config/env"
import {
  observeRecommendationRuntime,
  timeRecommendationOperation,
} from "@/lib/recommendation-runtime-observation"
import { randomUUID } from "node:crypto"
import {
  RecommendationAuditKind,
  RecommendationDeliveryResult,
  RecommendationRequestState,
} from "@prisma/client"
import { buildCanonicalWatchVideoPath } from "@forge/watch-url-policy/routes"
import {
  VideoNotFoundError,
  type SceneRecommendation,
} from "@/services/scene-recommendations.service"
import {
  DELIVERY_RETRIEVAL_BUDGET_MS,
  MAX_DELIVERY_ITEMS,
  MAX_DELIVERY_RESPONSE_BYTES,
  RECOMMENDATION_CONTRACTS,
  RECOMMENDATION_RAW_RETENTION_DAYS,
} from "./contracts"
import { DELIVERY_CAPABILITY_LIFETIME_SECONDS } from "./token.service"
import type { RecommendationAdmissionResult } from "./admission"
import { assertWebRecommendationCaller } from "./caller"
import {
  type SemanticCandidatePoolItem,
  CANDIDATE_ELIGIBILITY_VERSION,
  SEMANTIC_CANDIDATE_GENERATOR_VERSION,
} from "./candidate"
import {
  runCandidatePlatform,
  runSemanticCandidatePlatform,
  type CandidatePlatformResult,
} from "./orchestration"

import type {
  DeliveryDependencies,
  DeliveryInput,
  RecommendationPersonalizationDelivery,
  SemanticRecommendationDelivery,
} from "./delivery.types"
import {
  CACHED_RECHECK_RESERVE_MS,
  DELIVERY_ISSUANCE_RESERVE_MS,
  DELIVERY_RESPONSE_RESERVE_MS,
  readCandidatePool,
  RecommendationRetrievalTimeoutError,
  runRecommendationDeliveryTransaction,
  setCandidatePool,
  unavailable,
  withinDeadline,
} from "./delivery-runtime"
import {
  appendSourceFailureEvidence,
  failedCandidatePlatform,
  lastKnownGoodSemanticCandidates,
  nullableDigest,
  preparedCandidatesFromPlatform,
  recommendationShortfallReason,
  selectedCandidateGenerator,
  type PreparedCandidate,
} from "./delivery-candidate-mapping"
import { issueRecommendationDelivery } from "./delivery-issuance"
import { SEEDED_CURATED_FALLBACK_VERSION } from "./curated-fallback"
import { nominationEligibilityReasons } from "./eligibility"
import { servedSnapshotCreate } from "./served-item-payload"
import {
  readDeliveryDiagnostics,
  type SemanticRetrievalDiagnostics,
  type CuratedDeliveryDiagnostics,
  type DeliveryDiagnostics,
} from "./delivery-diagnostics"
import { resolveRecommendationLocaleIdentity } from "./locale-identity"

export type {
  RecommendationPersonalizationDelivery,
  SemanticRecommendationDelivery,
  SemanticRecommendationDeliveryItem,
} from "./delivery.types"
export {
  invalidateRecommendationCandidatePools,
  runRecommendationRetrievalQuery,
} from "./delivery-runtime"
import {
  recommendationTraffic,
  observeRecommendationTraffic,
  CONTEXTUAL_RECOMMENDATION_CAPABILITY,
} from "./traffic"

export class RecommendationDeliveryService {
  constructor(private readonly deps: DeliveryDependencies) {}

  async deliver(input: DeliveryInput): Promise<SemanticRecommendationDelivery> {
    const traffic = recommendationTraffic(input)
    observeRecommendationTraffic("seeded", traffic, "attempted")
    return observeRecommendationRuntime("seeded", async () => {
      const response = await this.deliverObserved(input)
      if (response.requestId)
        observeRecommendationTraffic("seeded", traffic, "committed")
      return response
    })
  }

  private async deliverContextual(
    input: DeliveryInput,
    traffic: ReturnType<typeof recommendationTraffic>,
    deadlineAt: number,
    nowMilliseconds: () => number,
  ): Promise<SemanticRecommendationDelivery> {
    const response = unavailable(
      traffic.disposition === "deferred"
        ? "traffic_deferred"
        : "traffic_contextual",
    )
    const seedMediaId = input.seedMediaId.trim()
    const { presentationLocale: locale, audioLanguageSlug } =
      resolveRecommendationLocaleIdentity(input.locale, input.audioLanguageSlug)
    if (
      !seedMediaId ||
      seedMediaId.length > 191 ||
      !locale ||
      locale.length > 32 ||
      !/^[a-z0-9-]{1,64}$/.test(audioLanguageSlug)
    )
      return unavailable("invalid_input")
    if (traffic.disposition === "deferred") {
      observeRecommendationTraffic("seeded", traffic, "deferred")
      return { ...response, result: "empty" }
    }
    try {
      const candidates = await withinDeadline(
        () =>
          this.deps.retrieveCuratedFallback?.({
            seedMediaId,
            locale,
            audioLanguageSlug,
            excludedMediaIds: [],
            deadlineAt,
          }) ?? Promise.resolve([]),
        deadlineAt,
        nowMilliseconds,
      )
      const items = candidates
        .filter(
          (candidate) =>
            nominationEligibilityReasons(candidate, {
              surface: RECOMMENDATION_CONTRACTS.surface,
              purpose: "watch",
              locale,
              audioLanguageSlug,
            }).length === 0,
        )
        .slice(0, MAX_DELIVERY_ITEMS)
        .map((candidate, index) => ({
          ...candidate.presentation,
          videoId: candidate.targetMediaId,
          id: `contextual:${index + 1}`,
          position: index,
          targetMediaId: candidate.targetMediaId,
          canonicalHref: `/watch${buildCanonicalWatchVideoPath(candidate.presentation.videoSlug, audioLanguageSlug)}`,
          candidateGenerator: "curated" as const,
          contributors: [],
          capability: CONTEXTUAL_RECOMMENDATION_CAPABILITY,
          sceneIndex: candidate.presentation.sceneIndex,
          durationSeconds: candidate.presentation.durationSeconds ?? null,
          similarity: 0,
        }))
      const result: SemanticRecommendationDelivery = {
        ...response,
        result: items.length ? "fallback" : "empty",
        requestedCount: MAX_DELIVERY_ITEMS,
        composedCount: items.length,
        shortfallReason:
          items.length < MAX_DELIVERY_ITEMS ? "insufficient_candidates" : null,
        personalization: null,
        items,
      }
      if (
        Buffer.byteLength(JSON.stringify(result)) > MAX_DELIVERY_RESPONSE_BYTES
      )
        return unavailable("response_too_large")
      observeRecommendationTraffic("seeded", traffic, "contextual_fallback")
      return result
    } catch {
      return unavailable("contextual_unavailable")
    }
  }

  private async deliverObserved(
    input: DeliveryInput,
  ): Promise<SemanticRecommendationDelivery> {
    const nowMilliseconds = this.deps.nowMilliseconds ?? Date.now
    const deliveryStartedAt = nowMilliseconds()
    const serviceDeadlineAt = Math.min(
      deliveryStartedAt + DELIVERY_RETRIEVAL_BUDGET_MS,
      input.deadlineAt ?? Number.POSITIVE_INFINITY,
    )
    const candidateDeadlineAt = serviceDeadlineAt - DELIVERY_ISSUANCE_RESERVE_MS
    const issuanceDeadlineAt = serviceDeadlineAt - DELIVERY_RESPONSE_RESERVE_MS
    assertWebRecommendationCaller(input.caller)
    const webConsumerBucketKey = input.caller.rateLimitBucketKey
    const traffic = recommendationTraffic(input)
    if (traffic.disposition !== "measured") {
      observeRecommendationTraffic("seeded", traffic, "persistence_avoided")
      return this.deliverContextual(
        input,
        traffic,
        serviceDeadlineAt,
        nowMilliseconds,
      )
    }
    if (!/^[a-f0-9]{64}$/.test(input.sessionDigest)) {
      return unavailable("invalid_session")
    }
    const seedMediaId = input.seedMediaId.trim()
    const {
      transcriptLocale,
      presentationLocale: locale,
      audioLanguageSlug,
    } = resolveRecommendationLocaleIdentity(
      input.locale,
      input.audioLanguageSlug,
    )
    if (
      !seedMediaId ||
      seedMediaId.length > 191 ||
      !locale ||
      locale.length > 32 ||
      !/^[a-z0-9-]{1,64}$/.test(audioLanguageSlug)
    ) {
      return unavailable("invalid_input")
    }

    let admission: RecommendationAdmissionResult
    try {
      admission = await withinDeadline(
        () =>
          this.deps.admission.acquire({
            sessionDigest: input.sessionDigest,
            webConsumerBucketKey,
            seedMediaId,
            locale,
          }),
        serviceDeadlineAt,
        nowMilliseconds,
      )
    } catch (error) {
      return unavailable(
        error instanceof RecommendationRetrievalTimeoutError
          ? "delivery_timeout"
          : "admission_unavailable",
      )
    }
    if (!admission.allowed) return unavailable(admission.reason)

    try {
      const state = await withinDeadline(
        () => this.deps.getServingState({ deadlineAt: serviceDeadlineAt }),
        serviceDeadlineAt,
        nowMilliseconds,
      )
      if (!state.canIssue || !state.manifest || !this.deps.tokenService) {
        return unavailable(state.reason)
      }
      const manifest = state.manifest

      const poolKey = `${manifest.id}\0${seedMediaId}\0${transcriptLocale}\0${locale}\0${audioLanguageSlug}`
      let result: "served" | "fallback" | "empty" | "unavailable" = "served"
      let reason: string | null = null
      let candidates: SemanticCandidatePoolItem[]
      let retrievalFailureReason: string | null = null
      let retrievalDiagnostics: SemanticRetrievalDiagnostics | null = null
      let curatedDiagnostics: CuratedDeliveryDiagnostics | null = null
      let candidateSource: DeliveryDiagnostics["candidateSource"] =
        "unavailable"
      const retrievalStartedAt = nowMilliseconds()
      const now = this.deps.now?.() ?? new Date()
      const cached = readCandidatePool(poolKey)
      const hasLiveCachedPool =
        cached !== undefined && cached.expiresAt > nowMilliseconds()
      const freshRetrievalDeadlineAt = hasLiveCachedPool
        ? candidateDeadlineAt - CACHED_RECHECK_RESERVE_MS
        : candidateDeadlineAt
      try {
        candidates = await withinDeadline(
          () =>
            this.deps.retrieve({
              seedMediaId,
              locale,
              audioLanguageSlug,
              limit: manifest.maxItems,
              deadlineAt: freshRetrievalDeadlineAt,
              onDiagnostics: (diagnostics) => {
                retrievalDiagnostics = diagnostics
              },
            }),
          freshRetrievalDeadlineAt,
          nowMilliseconds,
        )
        setCandidatePool(poolKey, candidates, nowMilliseconds())
        candidateSource = "fresh"
      } catch (error) {
        if (error instanceof VideoNotFoundError) {
          candidates = []
          result = "empty"
          reason = "seed_embedding_unavailable"
          retrievalFailureReason = reason
        } else {
          if (!cached) {
            candidates = []
            result = "unavailable"
            reason =
              error instanceof RecommendationRetrievalTimeoutError
                ? "retrieval_timeout"
                : "retrieval_unavailable"
            retrievalFailureReason = reason
          } else if (cached.expiresAt <= nowMilliseconds()) {
            candidates = []
            result = "unavailable"
            reason = "candidate_pool_stale"
            retrievalFailureReason = reason
          } else {
            try {
              const rechecked = await withinDeadline(
                () =>
                  this.deps.recheckCached(cached.items, {
                    locale,
                    audioLanguageSlug,
                    deadlineAt: candidateDeadlineAt,
                  }),
                candidateDeadlineAt,
                nowMilliseconds,
              )
              const eligibleIds = new Set(
                rechecked.map((candidate) => candidate.videoId),
              )
              candidateSource = "cached"
              candidates = cached.items.map((candidate) =>
                eligibleIds.has(candidate.videoId)
                  ? candidate
                  : {
                      ...candidate,
                      sourceRejectionReason: "cached_candidate_ineligible",
                    },
              )
              result = rechecked.length > 0 ? "fallback" : "empty"
              reason =
                rechecked.length > 0
                  ? "candidate_pool_fallback"
                  : "candidate_pool_ineligible"
              if (rechecked.length === 0) retrievalFailureReason = reason
            } catch (fallbackError) {
              candidates = []
              result = "unavailable"
              reason =
                fallbackError instanceof RecommendationRetrievalTimeoutError
                  ? "retrieval_timeout"
                  : "retrieval_unavailable"
              retrievalFailureReason = reason
            }
          }
        }
      }

      const context = {
        surface: RECOMMENDATION_CONTRACTS.surface,
        purpose: "watch" as const,
        locale,
        audioLanguageSlug,
      }
      // Recommendations now depend only on the current video and catalog.
      // Old credentials and behavioral authority cannot affect this slate.
      const recentContext = { videos: [] }
      const orchestrate = this.deps.orchestrate ?? runSemanticCandidatePlatform
      let platform: CandidatePlatformResult
      let selected: PreparedCandidate[]
      let evidenceComplete = true
      let candidateRunFallbackReason = reason
      try {
        platform = orchestrate({
          candidates,
          context,
          limit: manifest.maxItems,
          composition: {
            currentVideoId: seedMediaId,
            recentVideos: recentContext.videos,
          },
        })
        if (retrievalFailureReason) {
          platform = appendSourceFailureEvidence(
            platform,
            retrievalFailureReason,
          )
          evidenceComplete = false
        }
        selected = platform.composed.map((candidate) => ({
          candidate: {
            videoId: candidate.targetMediaId,
            videoSlug: candidate.presentation.videoSlug,
            videoTitle: candidate.presentation.videoTitle,
            imageUrl: candidate.presentation.imageUrl,
            sceneIndex: candidate.presentation.sceneIndex,
            description: candidate.presentation.description,
            startSeconds: candidate.presentation.startSeconds,
            endSeconds: candidate.presentation.endSeconds,
            durationSeconds: candidate.presentation.durationSeconds ?? null,
            similarity: Math.max(
              ...candidate.sources.map((source) => source.score),
            ),
            themes: candidate.presentation.themes,
            demographics: candidate.presentation.demographics,
            spiritualContext: candidate.presentation.spiritualContext,
            playbackId: candidate.presentation.playbackId,
          },
          sources: candidate.sources.map((source) => ({
            generator: "semantic" as const,
            generatorVersion: SEMANTIC_CANDIDATE_GENERATOR_VERSION,
            rank: source.rank,
            score: source.score,
            evidence: {
              sceneIndex: candidate.presentation.sceneIndex,
              similarity: source.score,
            },
            rejectionReason: source.rejectionReason,
          })),
          normalizedSemanticScore: candidate.normalizedSemanticScore,
          rrfBenchmark: candidate.rrfBenchmark,
          deterministicScore: candidate.deterministicScore,
        }))
        if (
          platform.parity.candidateEligibility === "failed" ||
          platform.parity.ranker === "failed"
        ) {
          selected = lastKnownGoodSemanticCandidates(
            candidates,
            context,
            manifest.maxItems,
            seedMediaId,
            recentContext.videos,
          )
          result = selected.length > 0 ? "fallback" : "empty"
          reason = "semantic_parity_mismatch"
          candidateRunFallbackReason = reason
        }
      } catch {
        selected = lastKnownGoodSemanticCandidates(
          candidates,
          context,
          manifest.maxItems,
          seedMediaId,
          recentContext.videos,
        )
        platform = failedCandidatePlatform("candidate_platform_unavailable")
        result = selected.length > 0 ? "fallback" : "unavailable"
        reason = state.lastKnownGoodManifestId
          ? "last_known_good_semantic_fallback"
          : "candidate_platform_unavailable"
        candidateRunFallbackReason = "candidate_platform_unavailable"
        evidenceComplete = false
      }

      if (selected.length === 0 && result === "served") {
        result = "empty"
        reason = "no_candidates"
        candidateRunFallbackReason = reason
      }
      let personalization: RecommendationPersonalizationDelivery = {
        contractVersion: "anonymous-profile-personalization-v1",
        lane: "semantic_control",
        executionMode: "semantic_contextual",
        effectiveManifestId: manifest.id,
        profileState: null,
        projectionVersion: null,
        projectionGeneration: null,
        interestCount: 0,
        sessionIntentPresent: false,
        reason: null,
      }
      if (selected.length === 0 && this.deps.retrieveCuratedFallback) {
        const emptyReason = reason ?? "no_candidates"
        try {
          const nominations = await withinDeadline(
            () =>
              this.deps.retrieveCuratedFallback!({
                seedMediaId,
                locale,
                audioLanguageSlug,
                excludedMediaIds: [],
                deadlineAt: candidateDeadlineAt,
                onDiagnostics: (diagnostics) => {
                  curatedDiagnostics = diagnostics
                },
              }),
            candidateDeadlineAt,
            nowMilliseconds,
          )
          const fallbackPlatform = runCandidatePlatform({
            nominations,
            context,
            limit: manifest.maxItems,
            generatorVersion: SEEDED_CURATED_FALLBACK_VERSION,
            composition: {
              currentVideoId: seedMediaId,
              recentVideos: recentContext.videos,
            },
          })
          const fallback = preparedCandidatesFromPlatform(fallbackPlatform)
          if (fallback.length > 0) {
            platform = appendSourceFailureEvidence(
              fallbackPlatform,
              emptyReason,
              "semantic",
            )
            selected = fallback
            result = "fallback"
            reason = emptyReason
            candidateRunFallbackReason = emptyReason
            evidenceComplete = false
            personalization = {
              ...personalization,
              lane: "semantic_fallback",
              executionMode: "curated_fallback",
              profileState: null,
              projectionVersion: null,
              projectionGeneration: null,
              interestCount: 0,
              sessionIntentPresent: false,
              reason: emptyReason,
            }
          }
        } catch {
          // The original empty/unavailable result survives a slow or missing
          // approved pool. Neither retrieval nor fallback can delay Watch.
          platform = appendSourceFailureEvidence(
            platform,
            "curated_fallback_unavailable",
            "curated",
          )
        }
      }
      const newId = this.deps.newId ?? randomUUID
      const requestId = newId()
      const candidateRunId = newId()
      const deliveryJti = result === "unavailable" ? null : newId()
      const expiresAt = new Date(
        now.getTime() + RECOMMENDATION_RAW_RETENTION_DAYS * 86_400_000,
      )
      const deliveryExpiresAt = new Date(
        now.getTime() + DELIVERY_CAPABILITY_LIFETIME_SECONDS * 1_000,
      )
      const prepared = selected.map((selectedCandidate, position) => ({
        ...selectedCandidate,
        id: newId(),
        position,
        capabilityJti: newId(),
        canonicalHref: this.buildCanonicalTarget(
          selectedCandidate.candidate,
          audioLanguageSlug,
        ),
      }))
      const requestedCount = manifest.maxItems
      const composedCount = prepared.length
      const shortfallReason = recommendationShortfallReason({
        requestedCount,
        composedCount,
        reason,
        nominatedCount: platform.counts.nominated,
        rejectedCount: platform.counts.rejected,
      })
      const dbResult =
        result === "served"
          ? RecommendationDeliveryResult.SERVED
          : result === "fallback"
            ? RecommendationDeliveryResult.FALLBACK
            : result === "empty"
              ? RecommendationDeliveryResult.EMPTY
              : RecommendationDeliveryResult.UNAVAILABLE

      const persistRequest = (
        requestState: RecommendationRequestState,
        responseBytes: number | null,
      ) =>
        runRecommendationDeliveryTransaction(
          this.deps.prisma,
          issuanceDeadlineAt,
          async (tx) => {
            await tx.recommendationRequest.create({
              data: {
                id: requestId,
                contractVersion: RECOMMENDATION_CONTRACTS.delivery,
                surfaceVersion: RECOMMENDATION_CONTRACTS.surface,
                manifestId: manifest.id,
                strategyVersion: manifest.strategyVersion,
                classifierVersion: RECOMMENDATION_CONTRACTS.outcome,
                sessionDigest: input.sessionDigest,
                seedMediaId,
                locale,
                expectedItemCount: prepared.length,
                deliveryDiagnostics:
                  readDeliveryDiagnostics({
                    version: 1,
                    transcriptLocale,
                    presentationLocale: locale,
                    audioLanguageSlug,
                    retrieval: retrievalDiagnostics,
                    curated: curatedDiagnostics,
                    candidateSource,
                    requestedCount: manifest.maxItems,
                    composedCount: prepared.length,
                  }) ?? undefined,
                state: requestState,
                result: dbResult,
                fallbackReason: reason,
                deliveryJti,
                signingKid: this.deps.tokenService!.activeKid,
                retrievalLatencyMs: Math.max(
                  0,
                  nowMilliseconds() - retrievalStartedAt,
                ),
                responseBytes,
                issuedAt:
                  requestState === RecommendationRequestState.ISSUED
                    ? now
                    : null,
                expiresAt,
                ...servedSnapshotCreate(
                  prepared.map(
                    ({
                      candidate,
                      sources,
                      normalizedSemanticScore,
                      rrfBenchmark,
                      deterministicScore,
                      id,
                      position,
                      capabilityJti,
                      canonicalHref,
                    }) => ({
                      id,
                      position,
                      targetMediaId: candidate.videoId,
                      canonicalHref,
                      candidateGenerator: selectedCandidateGenerator(sources),
                      candidateProvenance: {
                        sceneIndex: candidate.sceneIndex,
                        similarity:
                          selectedCandidateGenerator(sources) === "curated"
                            ? null
                            : candidate.similarity,
                        sources: sources.map((source) => ({
                          generator: source.generator,
                          generatorVersion: source.generatorVersion,
                          sourceRank: source.rank,
                          sourceScore: source.score,
                          evidence: source.evidence,
                          rejectionReason: source.rejectionReason,
                        })),
                        normalizedSemanticScore,
                        rrfBenchmark,
                        deterministicScore,
                        deterministicRankerVersion: platform.versions.ranker,
                        eligibilityVersion: CANDIDATE_ELIGIBILITY_VERSION,
                        composerVersion: platform.versions.composer,
                      },
                      presentation: {
                        videoSlug: candidate.videoSlug,
                        videoTitle: candidate.videoTitle,
                        imageUrl: candidate.imageUrl,
                        description: candidate.description,
                        startSeconds: candidate.startSeconds,
                        endSeconds: candidate.endSeconds,
                        durationSeconds: candidate.durationSeconds ?? null,
                        themes: candidate.themes,
                        demographics: candidate.demographics,
                        spiritualContext: candidate.spiritualContext,
                        playbackId: candidate.playbackId,
                        audioLanguageSlug,
                      },
                      capabilityJti,
                      signingKid: this.deps.tokenService!.activeKid,
                      expiresAt,
                    }),
                  ),
                  this.deps.servedItemFormat ??
                    env.RECOMMENDATION_SERVED_ITEM_FORMAT,
                ),
              },
            })
            const evidenceCreatedAt = new Date()
            const evidenceRows: CandidateEvidenceRow[] = platform.evidence.map(
              (entry) => ({
                id: newId(),
                runId: candidateRunId,
                stage: entry.stage,
                ordinal: entry.ordinal,
                candidateKey: entry.candidateKey.slice(0, 191),
                targetMediaId: entry.targetMediaId?.slice(0, 191) ?? null,
                sourceGenerator: entry.sourceGenerator,
                sourceRank: entry.sourceRank,
                sourceScore: entry.sourceScore,
                normalizedScore: entry.normalizedScore,
                rrfScore: entry.rrfScore,
                deterministicScore: entry.deterministicScore,
                finalPosition: entry.finalPosition,
                reasonCodes: entry.reasonCodes.slice(0, 16),
                sourceEvidence: entry.sourceEvidence
                  .slice(0, 16)
                  .map((source) => ({
                    generator: source.generator,
                    generatorVersion: source.generatorVersion,
                    rank: source.rank,
                    score: source.score,
                    evidence: source.evidence,
                    rejectionReason: source.rejectionReason,
                  })),
                createdAt: evidenceCreatedAt,
                expiresAt,
              }),
            )
            const compactTrace =
              (this.deps.candidateTraceFormat ??
                env.RECOMMENDATION_CANDIDATE_TRACE_FORMAT) === "compact"
            const tracePayload = compactTrace
              ? candidateTracePayload(evidenceRows)
              : null
            const createCandidateRun = () =>
              tx.recommendationCandidateRun.create({
                select: { id: true },
                data: {
                  id: candidateRunId,
                  requestId,
                  purpose: context.purpose,
                  contextVersion: platform.versions.context,
                  generatorVersion: platform.versions.generator,
                  unionVersion: platform.versions.union,
                  eligibilityVersion: platform.versions.eligibility,
                  rankerVersion: platform.versions.ranker,
                  composerVersion: platform.versions.composer,
                  candidateEligibilityParity:
                    platform.parity.candidateEligibility,
                  rankerParity: platform.parity.ranker,
                  baselineDigest: nullableDigest(
                    platform.parity.baselineDigest,
                  ),
                  platformDigest: nullableDigest(
                    platform.parity.platformDigest,
                  ),
                  nominatedCount: platform.counts.nominated,
                  canonicalizedCount: platform.counts.canonicalized,
                  deduplicatedCount: platform.counts.deduplicated,
                  rejectedCount: platform.counts.rejected,
                  scoredCount: platform.counts.scored,
                  orderedCount: platform.counts.ordered,
                  requestedCount,
                  composedCount,
                  shortfallReason,
                  evidenceComplete,
                  fallbackReason: candidateRunFallbackReason,
                  traceFormatVersion: compactTrace
                    ? CANDIDATE_TRACE_FORMAT_VERSION
                    : null,
                  tracePayload: tracePayload ?? undefined,
                  expiresAt,
                },
              })
            if (compactTrace) {
              await timeRecommendationOperation(
                "candidate_evidence.insert",
                createCandidateRun,
                evidenceRows.length,
              )
            } else {
              await createCandidateRun()
            }
            if (!compactTrace && evidenceRows.length > 0) {
              await persistCandidateStageEvidence(tx, evidenceRows)
            }
            if (requestState === RecommendationRequestState.ISSUED) {
              await tx.recommendationEvidenceAudit.create({
                data: {
                  requestId,
                  kind: RecommendationAuditKind.DELIVERY_SUCCESS,
                  reasonCode: result,
                  expiresAt,
                },
              })
            }
          },
          nowMilliseconds,
        )

      const persistObservedRequest = (
        state: Parameters<typeof persistRequest>[0],
        bytes: number | null,
      ) =>
        timeRecommendationOperation("persistence", () =>
          persistRequest(state, bytes),
        )

      let response: SemanticRecommendationDelivery
      let responseBytes: number
      try {
        const issued = await issueRecommendationDelivery({
          prepared,
          tokenService: this.deps.tokenService,
          sessionDigest: input.sessionDigest,
          manifestId: manifest.id,
          assignment: null,
          requestId,
          result,
          reason,
          deliveryExpiresAt,
          requestedCount,
          composedCount,
          shortfallReason,
          personalization,
          issuanceDeadlineAt,
          nowMilliseconds,
        })
        response = issued.response
        responseBytes = issued.responseBytes
      } catch (error) {
        if (!(error instanceof RecommendationRetrievalTimeoutError)) {
          await persistObservedRequest(
            RecommendationRequestState.ISSUANCE_FAILED,
            null,
          ).catch(() => undefined)
        }
        return unavailable(
          error instanceof RecommendationRetrievalTimeoutError
            ? "delivery_timeout"
            : "issuance_failed",
        )
      }
      try {
        await persistObservedRequest(
          RecommendationRequestState.ISSUED,
          responseBytes,
        )
        return response
      } catch (error) {
        return unavailable(
          error instanceof RecommendationRetrievalTimeoutError
            ? "delivery_timeout"
            : "persistence_unavailable",
        )
      }
    } catch (error) {
      return unavailable(
        error instanceof RecommendationRetrievalTimeoutError
          ? "delivery_timeout"
          : "persistence_unavailable",
      )
    } finally {
      try {
        await withinDeadline(
          () => this.deps.admission.release(admission.leaseId),
          serviceDeadlineAt,
          nowMilliseconds,
        )
      } catch {
        // The distributed lease has a TTL; release failure must not turn a
        // valid bounded delivery response into an unclassified GraphQL error.
      }
    }
  }

  private buildCanonicalTarget(
    item: SceneRecommendation,
    audioLanguageSlug: string,
  ): string {
    const builder =
      this.deps.buildCanonicalTarget ??
      ((input: { videoSlug: string; audioLanguageSlug: string }) =>
        `/watch${buildCanonicalWatchVideoPath(
          input.videoSlug,
          input.audioLanguageSlug,
        )}`)
    return builder({ videoSlug: item.videoSlug, audioLanguageSlug })
  }
}
export { createRecommendationDeliveryService } from "./delivery.factory"
