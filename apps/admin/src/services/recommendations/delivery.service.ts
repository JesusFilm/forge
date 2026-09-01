import { randomUUID } from "node:crypto"
import {
  RecommendationAuditKind,
  RecommendationDeliveryResult,
  RecommendationRequestState,
} from "@prisma/client"
import { buildCanonicalWatchVideoPath } from "@forge/watch-url-policy/routes"
import type { Principal } from "@/auth/principal"
import {
  VideoNotFoundError,
  type SceneRecommendation,
} from "@/services/scene-recommendations.service"
import {
  DELIVERY_RETRIEVAL_BUDGET_MS,
  RECOMMENDATION_CONTRACTS,
  RECOMMENDATION_RAW_RETENTION_DAYS,
} from "./contracts"
import { DELIVERY_CAPABILITY_LIFETIME_SECONDS } from "./token.service"
import type { RecommendationAdmissionResult } from "./admission"
import { assertWebRecommendationCaller } from "./caller"
import { RecommendationInternalStateError } from "./errors"
import {
  type SemanticCandidatePoolItem,
  CANDIDATE_ELIGIBILITY_VERSION,
  HYBRID_CANDIDATE_GENERATOR_SET_VERSION,
  SEMANTIC_CANDIDATE_GENERATOR_VERSION,
  adaptSemanticCandidates,
} from "./candidate"
import {
  runCandidatePlatform,
  runSemanticCandidatePlatform,
  type CandidatePlatformResult,
} from "./orchestration"
import type { ExperimentAssignmentResolution } from "./experiment/assignment"
import type { RecommendationRecentContext } from "./recent-context.service"

import type {
  DeliveryDependencies,
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
  annotateComposedEvidence,
  appendSourceFailureEvidence,
  failedCandidatePlatform,
  lastKnownGoodSemanticCandidates,
  mergeBoundedHybridNominations,
  nullableDigest,
  preparedCandidatesFromPlatform,
  recommendationShortfallReason,
  selectedCandidateGenerator,
  type PreparedCandidate,
} from "./delivery-candidate-mapping"
import { issueRecommendationDelivery } from "./delivery-issuance"

export type {
  RecommendationPersonalizationDelivery,
  SemanticRecommendationDelivery,
  SemanticRecommendationDeliveryItem,
} from "./delivery.types"
export {
  invalidateRecommendationCandidatePools,
  runRecommendationRetrievalQuery,
} from "./delivery-runtime"
export class RecommendationDeliveryService {
  constructor(private readonly deps: DeliveryDependencies) {}

  async deliver(input: {
    caller: Principal | null
    seedMediaId: string
    locale: string
    audioLanguageSlug: string
    sessionDigest: string
    consentReceiptDigest?: string | null
    profileTokenDigest?: string | null
    eligibleHuman?: boolean
  }): Promise<SemanticRecommendationDelivery> {
    const nowMilliseconds = this.deps.nowMilliseconds ?? Date.now
    const deliveryStartedAt = nowMilliseconds()
    const serviceDeadlineAt = deliveryStartedAt + DELIVERY_RETRIEVAL_BUDGET_MS
    const candidateDeadlineAt = serviceDeadlineAt - DELIVERY_ISSUANCE_RESERVE_MS
    const issuanceDeadlineAt = serviceDeadlineAt - DELIVERY_RESPONSE_RESERVE_MS
    assertWebRecommendationCaller(input.caller)
    const webConsumerBucketKey = input.caller.rateLimitBucketKey
    if (!/^[a-f0-9]{64}$/.test(input.sessionDigest)) {
      return unavailable("invalid_session")
    }
    const seedMediaId = input.seedMediaId.trim()
    const locale = input.locale.trim()
    const audioLanguageSlug = input.audioLanguageSlug.trim()
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

      const poolKey = `${manifest.id}\0${seedMediaId}\0${locale}\0${audioLanguageSlug}`
      let result: "served" | "fallback" | "empty" | "unavailable" = "served"
      let reason: string | null = null
      let candidates: SemanticCandidatePoolItem[]
      let retrievalFailureReason: string | null = null
      const retrievalStartedAt = nowMilliseconds()
      const now = this.deps.now?.() ?? new Date()
      const profileTokenDigestPromise = (async (): Promise<string | null> => {
        if (
          !input.consentReceiptDigest ||
          !input.profileTokenDigest ||
          !/^[a-f0-9]{64}$/.test(input.consentReceiptDigest) ||
          !/^[a-f0-9]{64}$/.test(input.profileTokenDigest) ||
          !this.deps.authorizeProfile
        ) {
          return null
        }
        try {
          return (await withinDeadline(
            () =>
              this.deps.authorizeProfile!({
                consentReceiptDigest: input.consentReceiptDigest!,
                profileTokenDigest: input.profileTokenDigest!,
                now,
                deadlineAt: candidateDeadlineAt,
              }),
            candidateDeadlineAt,
            nowMilliseconds,
          ))
            ? input.profileTokenDigest
            : null
        } catch {
          return null
        }
      })()
      const experimentPromise = profileTokenDigestPromise.then(
        (profileTokenDigest) => {
          if (profileTokenDigest != null) {
            return { assignment: null, bypassReason: null }
          }
          return this.resolveExperiment(
            {
              ...input,
              profileTokenDigest,
              eligibleHuman: input.eligibleHuman !== false,
            },
            now,
            candidateDeadlineAt,
            nowMilliseconds,
          )
        },
      )
      const profilePromise = profileTokenDigestPromise.then(
        async (profileTokenDigest) => {
          if (profileTokenDigest == null) {
            return { profile: null, failureReason: null, latencyMs: null }
          }
          const profileStartedAt = nowMilliseconds()
          try {
            const profile = this.deps.retrieveProfile
              ? await withinDeadline(
                  () =>
                    this.deps.retrieveProfile!({
                      sessionDigest: input.sessionDigest,
                      profileTokenDigest,
                      seedMediaId,
                      locale,
                      audioLanguageSlug,
                      manifestId: manifest.id,
                      deadlineAt: candidateDeadlineAt,
                      now,
                    }),
                  candidateDeadlineAt,
                  nowMilliseconds,
                )
              : null
            return {
              profile,
              failureReason: profile ? null : ("profile_cold_start" as const),
              latencyMs: Math.max(0, nowMilliseconds() - profileStartedAt),
            }
          } catch (error) {
            return {
              profile: null,
              failureReason:
                error instanceof RecommendationRetrievalTimeoutError
                  ? ("profile_retrieval_timeout" as const)
                  : ("profile_projection_unavailable" as const),
              latencyMs: Math.max(0, nowMilliseconds() - profileStartedAt),
            }
          }
        },
      )
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
            }),
          freshRetrievalDeadlineAt,
          nowMilliseconds,
        )
        setCandidatePool(poolKey, candidates, nowMilliseconds())
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
          composition: { currentVideoId: seedMediaId },
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
      const [experiment, profileResolution, profileTokenDigest] =
        await Promise.all([
          experimentPromise,
          profilePromise,
          profileTokenDigestPromise,
        ])
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
        reason: experiment.bypassReason,
      }
      let profileProjectionId: string | null = null
      let profileRetrievalLatencyMs: number | null = null
      const profileColdStart =
        profileTokenDigest != null &&
        !profileResolution.profile &&
        profileResolution.failureReason === "profile_cold_start"
      if (profileTokenDigest != null) {
        profileRetrievalLatencyMs = profileResolution.latencyMs
      }
      if (profileColdStart) {
        personalization = {
          ...personalization,
          reason: "profile_cold_start",
        }
      }
      if (profileTokenDigest != null && !profileColdStart) {
        try {
          if (!profileResolution.profile) {
            throw new RecommendationInternalStateError(
              profileResolution.failureReason ??
                "profile_projection_unavailable",
            )
          }
          const profile = profileResolution.profile
          if (profile.nominations.length === 0) {
            throw new RecommendationInternalStateError(
              "profile_candidates_sparse",
            )
          }
          if (selected.length === 0) {
            throw new RecommendationInternalStateError(
              "semantic_candidates_unavailable",
            )
          }
          const semanticNominations = adaptSemanticCandidates(
            candidates,
            context,
          ).nominations
          let recentContext: RecommendationRecentContext = { videos: [] }
          let recentContextFailureReason: string | null = null
          if (this.deps.resolveRecentContext) {
            try {
              recentContext = await withinDeadline(
                () =>
                  this.deps.resolveRecentContext!({
                    sessionDigest: input.sessionDigest,
                    profileTokenDigest,
                    allowDurableProfileLinks:
                      profile.projection.scope === "durable",
                    now,
                    deadlineAt: candidateDeadlineAt,
                  }),
                candidateDeadlineAt,
                nowMilliseconds,
              )
            } catch (error) {
              recentContextFailureReason =
                error instanceof RecommendationRetrievalTimeoutError
                  ? "recent_context_timeout"
                  : "recent_context_unavailable"
              evidenceComplete = false
              candidateRunFallbackReason ??= recentContextFailureReason
            }
          }
          const orchestrateHybrid =
            this.deps.orchestrateHybrid ?? runCandidatePlatform
          let hybridPlatform: CandidatePlatformResult
          try {
            hybridPlatform = orchestrateHybrid({
              nominations: mergeBoundedHybridNominations(
                semanticNominations,
                profile.nominations,
              ),
              context,
              limit: manifest.maxItems,
              generatorVersion: HYBRID_CANDIDATE_GENERATOR_SET_VERSION,
              composition: {
                currentVideoId: seedMediaId,
                recentVideos: recentContext.videos,
              },
            })
          } catch {
            throw new RecommendationInternalStateError(
              "hybrid_candidate_platform_unavailable",
            )
          }
          const hasEligibleProfileCandidate = hybridPlatform.ordered.some(
            (candidate) =>
              candidate.sources.some(
                (source) =>
                  source.generator === "multi-interest-profile" &&
                  source.rejectionReason == null,
              ),
          )
          if (!hasEligibleProfileCandidate) {
            throw new RecommendationInternalStateError(
              "profile_candidates_sparse",
            )
          }
          if (hybridPlatform.composition.suppressions.length > 0) {
            hybridPlatform = annotateComposedEvidence(
              hybridPlatform,
              "bounded_reserve_refill",
            )
          }
          if (recentContextFailureReason) {
            hybridPlatform = appendSourceFailureEvidence(
              hybridPlatform,
              recentContextFailureReason,
              "recent-context",
            )
          }
          platform = hybridPlatform
          const hybridSelected = preparedCandidatesFromPlatform(hybridPlatform)
          if (hybridSelected.length === 0) {
            throw new RecommendationInternalStateError("hybrid_slate_empty")
          }
          selected = hybridSelected
          profileProjectionId = profile.projection.id
          personalization = {
            contractVersion: "anonymous-profile-personalization-v1",
            lane: "profile_challenger",
            executionMode: "hybrid_personalized",
            effectiveManifestId: manifest.id,
            profileState: profile.projection.scope ?? "session",
            projectionVersion: profile.projection.projectionVersion,
            projectionGeneration: profile.projection.generation ?? null,
            interestCount: profile.projection.interestCount,
            sessionIntentPresent:
              profile.projection.sessionIntentPresent ?? false,
            reason: null,
          }
          if (result === "served") {
            reason = null
            if (!recentContextFailureReason) {
              candidateRunFallbackReason = null
            }
          }
        } catch (error) {
          const fallbackReason = hybridFallbackReason(error)
          platform = appendSourceFailureEvidence(
            platform,
            fallbackReason,
            error instanceof Error &&
              error.message === "semantic_candidates_unavailable"
              ? "semantic"
              : "multi-interest-profile",
          )
          evidenceComplete = false
          candidateRunFallbackReason ??= fallbackReason
          result = selected.length > 0 ? "fallback" : result
          reason ??= fallbackReason
          personalization = {
            ...personalization,
            lane: "semantic_fallback",
            executionMode: "semantic_fallback",
            reason: fallbackReason,
          }
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
                experimentAssignmentId:
                  experiment.assignment?.assignmentId ?? null,
                experimentBypassReason: experiment.bypassReason,
                items: {
                  create: prepared.map(
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
                        similarity: candidate.similarity,
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
                },
              },
            })
            await tx.recommendationCandidateRun.create({
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
                baselineDigest: nullableDigest(platform.parity.baselineDigest),
                platformDigest: nullableDigest(platform.parity.platformDigest),
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
                expiresAt,
              },
            })
            await tx.recommendationPersonalizationDecision.create({
              data: {
                requestId,
                effectiveManifestId: personalization.effectiveManifestId,
                lane: personalization.lane,
                executionMode: personalization.executionMode,
                reasonCode: personalization.reason,
                projectionGenerationId: profileProjectionId,
                projectionScope: personalization.profileState,
                projectionVersion: personalization.projectionVersion,
                projectionGenerationNumber:
                  personalization.projectionGeneration,
                interestCount: personalization.interestCount,
                sessionIntentPresent: personalization.sessionIntentPresent,
                profileRetrievalLatencyMs,
                expiresAt,
              },
            })
            if (platform.evidence.length > 0) {
              await tx.recommendationCandidateStageEvidence.createMany({
                data: platform.evidence.map((entry) => ({
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
                  expiresAt,
                })),
              })
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

      let response: SemanticRecommendationDelivery
      let responseBytes: number
      try {
        const issued = await issueRecommendationDelivery({
          prepared,
          tokenService: this.deps.tokenService,
          sessionDigest: input.sessionDigest,
          manifestId: manifest.id,
          assignment: experiment.assignment,
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
          await persistRequest(
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
        await persistRequest(RecommendationRequestState.ISSUED, responseBytes)
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

  private async resolveExperiment(
    input: {
      sessionDigest: string
      profileTokenDigest?: string | null
      eligibleHuman?: boolean
    },
    now: Date,
    deadlineAt: number,
    nowMilliseconds: () => number,
  ): Promise<ExperimentAssignmentResolution> {
    if (!this.deps.assignExperiment) {
      return { assignment: null, bypassReason: null }
    }
    try {
      return await withinDeadline(
        () =>
          this.deps.assignExperiment!({
            surfaceVersion: RECOMMENDATION_CONTRACTS.surface,
            sessionDigest: input.sessionDigest,
            profileTokenDigest: input.profileTokenDigest ?? null,
            eligibleHuman: input.eligibleHuman !== false,
            now,
            deadlineAt,
          }),
        deadlineAt,
        nowMilliseconds,
      )
    } catch {
      return { assignment: null, bypassReason: "assignment_unavailable" }
    }
  }
}

function hybridFallbackReason(error: unknown) {
  if (!(error instanceof RecommendationInternalStateError)) {
    return "profile_projection_unavailable" as const
  }
  switch (error.code) {
    case "profile_retrieval_timeout":
    case "profile_candidates_sparse":
    case "semantic_candidates_unavailable":
    case "hybrid_candidate_platform_unavailable":
    case "hybrid_slate_empty":
      return error.code
    default:
      return "profile_projection_unavailable" as const
  }
}
export { createRecommendationDeliveryService } from "./delivery.factory"
