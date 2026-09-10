import { randomUUID } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import { buildCanonicalWatchVideoPath } from "@forge/watch-url-policy/routes"
import { videoIdentityDuplicateReason } from "@/services/video-dedup"
import type { CandidateNomination } from "./candidate"
import { nominationEligibilityReasons } from "./eligibility"
import { assertWebRecommendationCaller } from "./caller"
import {
  RECOMMENDATION_CONTRACTS,
  MAX_DELIVERY_RESPONSE_BYTES,
} from "./contracts"
import { DELIVERY_CAPABILITY_LIFETIME_SECONDS } from "./token.service"
import { createRecommendationDeliveryDependencies } from "./delivery.factory"
import type { DeliveryDependencies, DeliveryInput } from "./delivery.types"
import {
  runRecommendationDeliveryTransaction,
  runRecommendationRetrievalQuery,
  withinDeadline,
} from "./delivery-runtime"
import { CuratedPoolsService } from "./curated-pools.service"
import {
  getUserWatchHistory,
  type UserWatchHistory,
} from "./user-history.service"

export const USER_RECOMMENDATION_SURFACE = "watch-for-you-v1" as const
export const USER_RECOMMENDATION_CONTRACT = "user-recommendation-v1" as const
export const MAX_USER_RECOMMENDATIONS = 20

type UserCandidate = {
  videoId: string
  videoCoreId?: string | null
  embeddingText?: string | null
  videoSlug: string
  videoTitle: string
  imageUrl: string | null
  description: string
  durationSeconds?: number | null
  playbackId: string
  generator: "multi-interest-profile" | "curated"
  poolVersion: string | null
  poolKey: string | null
}
export type UserRecommendationItem = Omit<
  UserCandidate,
  "videoCoreId" | "embeddingText"
> & {
  id: string
  position: number
  targetMediaId: string
  canonicalHref: string
  capability: string
}
export type UserRecommendationDelivery = {
  contractVersion: typeof USER_RECOMMENDATION_CONTRACT
  surfaceVersion: typeof USER_RECOMMENDATION_SURFACE
  requestId: string | null
  result: "served" | "unavailable"
  reason: string | null
  expiresAt: string | null
  requestedCount: number
  profileCount: number
  curatedCount: number
  cohort: "returning" | "cold_start"
  poolVersion: string | null
  items: UserRecommendationItem[]
}

/** Keeps the primary slate intact. Fallback is strictly an append operation;
 * it cannot displace eligible profile candidates, even with a better score.
 */
export function composeUserRecommendations(
  primary: readonly UserCandidate[],
  fallback: readonly UserCandidate[],
  history: UserWatchHistory,
  count: number,
): UserCandidate[] {
  const matchesHistory = (candidate: UserCandidate, completed: boolean) =>
    history.some(
      (item) =>
        item.completed === completed &&
        (item.mediaId === candidate.videoId ||
          videoIdentityDuplicateReason(candidate, item)),
    )
  const selected: UserCandidate[] = []
  for (const pool of [primary, fallback]) {
    // Stable ranking penalty within a source. Curated never jumps ahead of profile.
    const ranked = [...pool].sort(
      (a, b) =>
        Number(matchesHistory(a, false)) - Number(matchesHistory(b, false)),
    )
    for (const candidate of ranked) {
      if (selected.length >= count) return selected
      if (
        matchesHistory(candidate, true) ||
        !candidate.playbackId ||
        !candidate.imageUrl
      )
        continue
      if (
        selected.some(
          (kept) =>
            kept.videoId === candidate.videoId ||
            videoIdentityDuplicateReason(candidate, kept),
        )
      )
        continue
      selected.push(candidate)
    }
  }
  return selected
}

function profileCandidates(
  nominations: readonly CandidateNomination[],
  locale: string,
  audioLanguageSlug: string,
): UserCandidate[] {
  return nominations
    .filter(
      (item) =>
        nominationEligibilityReasons(item, {
          surface: RECOMMENDATION_CONTRACTS.surface,
          purpose: "watch",
          locale,
          audioLanguageSlug,
        }).length === 0,
    )
    .map((item) => ({
      videoSlug: item.presentation.videoSlug,
      videoTitle: item.presentation.videoTitle,
      imageUrl: item.presentation.imageUrl,
      description: item.presentation.description,
      durationSeconds: item.presentation.durationSeconds,
      playbackId: item.presentation.playbackId,
      videoId: item.targetMediaId,
      videoCoreId: item.canonicalIdentity.videoCoreId,
      embeddingText: item.canonicalIdentity.embeddingText,
      generator: "multi-interest-profile",
      poolKey: null,
      poolVersion: null,
    }))
}

function publicCandidate(candidate: UserCandidate) {
  return {
    videoId: candidate.videoId,
    videoSlug: candidate.videoSlug,
    videoTitle: candidate.videoTitle,
    imageUrl: candidate.imageUrl,
    description: candidate.description,
    durationSeconds: candidate.durationSeconds,
    playbackId: candidate.playbackId,
    generator: candidate.generator,
    poolVersion: candidate.poolVersion,
    poolKey: candidate.poolKey,
  }
}

type UserDependencies = DeliveryDependencies & {
  enabled: boolean
  history(input: {
    sessionDigest: string
    profileTokenDigest: string | null
    now: Date
    deadlineAt: number
  }): Promise<UserWatchHistory>
  curated(input: {
    locale: string
    audioLanguageSlug: string
    interestVideoIds: string[]
    limit: number
    deadlineAt: number
  }): Promise<{ version: string | null; items: UserCandidate[] }>
}

export class UserRecommendationDeliveryService {
  constructor(private readonly deps: UserDependencies) {}
  async deliver(
    input: Omit<DeliveryInput, "seedMediaId"> & { count?: number },
  ): Promise<UserRecommendationDelivery> {
    assertWebRecommendationCaller(input.caller)
    const count = input.count ?? 6
    const startedAt = Date.now()
    const observe = (response: UserRecommendationDelivery) => {
      console.info(
        JSON.stringify({
          event: "recommendation.user_delivery",
          result: response.result,
          reason: response.reason,
          cohort: response.cohort,
          profileCount: response.profileCount,
          curatedCount: response.curatedCount,
          requestedCount: response.requestedCount,
          durationMs: Date.now() - startedAt,
        }),
      )
      return response
    }
    const unavailable = (reason: string): UserRecommendationDelivery =>
      observe({
        contractVersion: USER_RECOMMENDATION_CONTRACT,
        surfaceVersion: USER_RECOMMENDATION_SURFACE,
        requestId: null,
        result: "unavailable",
        reason,
        expiresAt: null,
        requestedCount: count,
        profileCount: 0,
        curatedCount: 0,
        cohort: "cold_start",
        poolVersion: null,
        items: [],
      })
    if (
      !Number.isInteger(count) ||
      count < 1 ||
      count > MAX_USER_RECOMMENDATIONS ||
      !/^[a-f0-9]{64}$/.test(input.sessionDigest) ||
      !/^[a-z0-9-]{1,64}$/.test(input.audioLanguageSlug) ||
      !input.locale ||
      input.locale.length > 32
    )
      return unavailable("invalid_input")
    if (!this.deps.enabled) return unavailable("environment_disabled")
    const start = Date.now(),
      deadline = start + 1500,
      candidateDeadline = deadline - 300
    const now = new Date()
    let leaseId: string | null = null
    try {
      const admission = await withinDeadline(
        () =>
          this.deps.admission.acquire({
            sessionDigest: input.sessionDigest,
            webConsumerBucketKey: input.caller!.rateLimitBucketKey!,
            seedMediaId: "user",
            locale: input.locale,
          }),
        deadline,
        Date.now,
      )
      if (!admission.allowed) return unavailable(admission.reason)
      leaseId = admission.leaseId
      const state = await this.deps.getServingState({
        deadlineAt: candidateDeadline,
      })
      const token = this.deps.tokenService
      if (!state.canIssue || !state.manifest || !token)
        return unavailable(state.reason)
      const manifest = state.manifest
      let profileTokenDigest: string | null = null
      if (
        input.profileTokenDigest &&
        input.consentReceiptDigest &&
        this.deps.authorizeProfile
      ) {
        try {
          if (
            await withinDeadline(
              () =>
                this.deps.authorizeProfile!({
                  sessionDigest: input.sessionDigest,
                  profileTokenDigest: input.profileTokenDigest!,
                  consentReceiptDigest: input.consentReceiptDigest!,
                  now,
                  deadlineAt: Math.min(candidateDeadline, start + 450),
                }),
              Math.min(candidateDeadline, start + 450),
              Date.now,
            )
          ) {
            profileTokenDigest = input.profileTokenDigest
          }
        } catch {
          /* Unavailable authority only permits cold-start recommendations. */
        }
      }
      const history = profileTokenDigest
        ? await this.deps.history({
            sessionDigest: input.sessionDigest,
            profileTokenDigest,
            now,
            deadlineAt: candidateDeadline,
          })
        : []
      let profile: Awaited<
        ReturnType<NonNullable<DeliveryDependencies["retrieveProfile"]>>
      > = null
      if (profileTokenDigest && this.deps.retrieveProfile) {
        try {
          profile = await withinDeadline(
            () =>
              this.deps.retrieveProfile!({
                sessionDigest: input.sessionDigest,
                profileTokenDigest,
                seedMediaId: null,
                locale: input.locale,
                audioLanguageSlug: input.audioLanguageSlug,
                manifestId: manifest.id,
                now,
                deadlineAt: Math.min(candidateDeadline, start + 800),
              }),
            Math.min(candidateDeadline, start + 800),
            Date.now,
          )
        } catch {
          /* Leave at least 400ms for curated retrieval and 300ms for issuance. */
        }
      }
      // Click-only session intent must not personalize this surface before a
      // qualified watch has established a durable interest.
      if (profile?.projection.qualifiedInterestCount === 0) profile = null
      const primary = profileCandidates(
        profile?.nominations ?? [],
        input.locale,
        input.audioLanguageSlug,
      )
      let selected = composeUserRecommendations(primary, [], history, count)
      let poolVersion: string | null = null
      if (selected.length < count) {
        const fallback = await withinDeadline(
          () =>
            this.deps.curated({
              locale: input.locale,
              audioLanguageSlug: input.audioLanguageSlug,
              interestVideoIds: [
                ...new Set([
                  ...history.map((item) => item.mediaId),
                  ...primary.map((item) => item.videoId),
                ]),
              ].slice(0, 40),
              limit: 64,
              deadlineAt: candidateDeadline,
            }),
          candidateDeadline,
          Date.now,
        )
        poolVersion = fallback.version
        selected = composeUserRecommendations(
          primary,
          fallback.items,
          history,
          count,
        )
      }
      // A coverage failure is explicit and observable. Never silently insert a
      // wrong-language/repeated card or return a normal undersized slate.
      if (selected.length < count) return unavailable("coverage_unavailable")
      const requestId = randomUUID(),
        expiresAt = new Date(now.getTime() + 29 * 86_400_000)
      const prepared = selected.map((candidate, position) => ({
        candidate,
        position,
        id: randomUUID(),
        capabilityJti: randomUUID(),
        canonicalHref: `/watch${buildCanonicalWatchVideoPath(candidate.videoSlug, input.audioLanguageSlug)}`,
      }))
      const items = await withinDeadline(
        () =>
          Promise.all(
            prepared.map(async (item) => ({
              ...publicCandidate(item.candidate),
              id: item.id,
              position: item.position,
              targetMediaId: item.candidate.videoId,
              canonicalHref: item.canonicalHref,
              capability: await token.signDeliveryCapability({
                jti: item.capabilityJti,
                requestId,
                itemId: item.id,
                sessionDigest: input.sessionDigest,
                surface: USER_RECOMMENDATION_SURFACE,
                manifestId: manifest.id,
              }),
            })),
          ),
        deadline - 25,
        Date.now,
      )
      const profileCount = selected.filter(
        (item) => item.generator === "multi-interest-profile",
      ).length
      const response: UserRecommendationDelivery = {
        contractVersion: USER_RECOMMENDATION_CONTRACT,
        surfaceVersion: USER_RECOMMENDATION_SURFACE,
        requestId,
        result: "served",
        reason: null,
        expiresAt: new Date(
          now.getTime() + DELIVERY_CAPABILITY_LIFETIME_SECONDS * 1000,
        ).toISOString(),
        requestedCount: count,
        profileCount,
        curatedCount: count - profileCount,
        cohort: profile || history.length ? "returning" : "cold_start",
        poolVersion,
        items,
      }
      const responseBytes = Buffer.byteLength(JSON.stringify(response))
      if (responseBytes > MAX_DELIVERY_RESPONSE_BYTES)
        return unavailable("response_oversized")
      await runRecommendationDeliveryTransaction(
        this.deps.prisma,
        deadline - 25,
        async (tx) => {
          await tx.recommendationRequest.create({
            data: {
              id: requestId,
              purpose: "user",
              seedMediaId: null,
              sessionDigest: input.sessionDigest,
              locale: input.locale,
              contractVersion: USER_RECOMMENDATION_CONTRACT,
              surfaceVersion: USER_RECOMMENDATION_SURFACE,
              manifestId: manifest.id,
              strategyVersion: "profile-first-curated-fill-v1",
              classifierVersion: RECOMMENDATION_CONTRACTS.outcome,
              expectedItemCount: count,
              state: "ISSUED",
              result: "SERVED",
              deliveryJti: randomUUID(),
              signingKid: token.activeKid,
              retrievalLatencyMs: Date.now() - start,
              responseBytes,
              issuedAt: now,
              expiresAt,
              items: {
                create: prepared.map((item) => ({
                  id: item.id,
                  position: item.position,
                  targetMediaId: item.candidate.videoId,
                  canonicalHref: item.canonicalHref,
                  candidateGenerator: item.candidate.generator,
                  candidateProvenance: {
                    poolVersion: item.candidate.poolVersion,
                    poolKey: item.candidate.poolKey,
                    cohort: response.cohort,
                    profileCount,
                    curatedCount: count - profileCount,
                    projectionId: profile?.projection.id ?? null,
                  },
                  presentation: {
                    videoSlug: item.candidate.videoSlug,
                    videoTitle: item.candidate.videoTitle,
                    imageUrl: item.candidate.imageUrl,
                    description: item.candidate.description,
                    durationSeconds: item.candidate.durationSeconds ?? null,
                    playbackId: item.candidate.playbackId,
                    audioLanguageSlug: input.audioLanguageSlug,
                    startSeconds: 0,
                  },
                  capabilityJti: item.capabilityJti,
                  signingKid: token.activeKid,
                  expiresAt,
                })),
              },
            },
          })
          await tx.recommendationEvidenceAudit.create({
            data: {
              requestId,
              kind: "DELIVERY_SUCCESS",
              reasonCode: "served",
              expiresAt,
            },
          })
        },
        Date.now,
      )
      return observe(response)
    } catch {
      return unavailable(
        Date.now() >= candidateDeadline
          ? "delivery_timeout"
          : "service_unavailable",
      )
    } finally {
      if (leaseId)
        await this.deps.admission.release(leaseId).catch(() => undefined)
    }
  }
}

export function createUserRecommendationDeliveryService(
  prisma: PrismaClient,
  enabled: boolean,
) {
  return new UserRecommendationDeliveryService({
    ...createRecommendationDeliveryDependencies(prisma),
    enabled,
    history: (input) =>
      runRecommendationRetrievalQuery(prisma, input.deadlineAt, (db) =>
        getUserWatchHistory(db, input),
      ),
    curated: (input) =>
      new CuratedPoolsService({ prisma }).getCandidates(input),
  })
}
