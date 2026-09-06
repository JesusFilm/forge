import type { PrismaClient } from "@prisma/client"
import { env } from "@/config/env"
import { prisma as defaultPrisma } from "@/db/client"
import { SceneRecommendationsService } from "@/services/scene-recommendations.service"
import { createRecommendationDeliveryAdmission } from "./admission"
import { getLiveProfileCandidates } from "./candidates/profile-candidate.service"
import {
  RECOMMENDATION_CONTRACTS,
  RECOMMENDATION_PROFILE_SESSION_LINK_HOURS,
} from "./contracts"
import { getSemanticDeliveryCandidatePool } from "./delivery-retriever"
import {
  runRecommendationDeliveryTransaction,
  runRecommendationRetrievalQuery,
} from "./delivery-runtime"
import { RecommendationDeliveryService } from "./delivery.service"
import { getRecommendationServingState } from "./manifest.service"
import { getRecommendationRecentContext } from "./recent-context.service"
import { readRecommendationRetentionHealth } from "./retention.service"
import { createRuntimeRecommendationTokenService } from "./runtime-token"

export function createRecommendationDeliveryService(
  prisma: PrismaClient = defaultPrisma,
): RecommendationDeliveryService {
  const token = createRuntimeRecommendationTokenService(prisma)
  return new RecommendationDeliveryService({
    prisma,
    admission: createRecommendationDeliveryAdmission(),
    tokenService: token,
    getServingState: ({ deadlineAt }) =>
      runRecommendationDeliveryTransaction(
        prisma,
        deadlineAt,
        async (tx) => {
          const scopedPrisma = tx as unknown as PrismaClient
          const retention =
            await readRecommendationRetentionHealth(scopedPrisma)
          return getRecommendationServingState({
            prisma: scopedPrisma,
            environmentEnabled:
              env.RECOMMENDATION_SEMANTIC_SERVING_ENABLED === "true",
            hasActiveSigner: token != null,
            retentionHealthy: retention.healthy,
          })
        },
        Date.now,
      ),
    retrieve: ({ seedMediaId, locale, audioLanguageSlug, limit, deadlineAt }) =>
      runRecommendationRetrievalQuery(prisma, deadlineAt, (scopedPrisma) =>
        getSemanticDeliveryCandidatePool(scopedPrisma, {
          seedMediaId,
          locale,
          audioLanguageSlug,
          limit,
        }),
      ),
    recheckCached: (items, input) =>
      runRecommendationRetrievalQuery(
        prisma,
        input.deadlineAt,
        (scopedPrisma) =>
          new SceneRecommendationsService({
            prisma: scopedPrisma,
          }).recheckEligibility(items, input.locale, input.audioLanguageSlug),
      ),
    authorizeProfile: (input) =>
      runRecommendationDeliveryTransaction(
        prisma,
        input.deadlineAt,
        async (tx) => {
          const receipt = await tx.recommendationConsentReceipt.findUnique({
            where: { tokenDigest: input.consentReceiptDigest },
            include: { profile: true },
          })
          const authorized = Boolean(
            receipt &&
            receipt.state === "ACTIVE" &&
            receipt.contractVersion === "recommendation-consent-v1" &&
            receipt.choice === "PERSONALIZATION" &&
            receipt.expiresAt > input.now &&
            receipt.profile != null &&
            receipt.profile.tokenDigest === input.profileTokenDigest &&
            receipt.profile.state === "ACTIVE" &&
            receipt.profile.privacyGeneration === receipt.privacyGeneration &&
            receipt.profile.expiresAt > input.now,
          )
          if (!authorized || !receipt?.profile) return false
          const expiresAt = new Date(
            Math.min(
              receipt.expiresAt.getTime(),
              receipt.profile.expiresAt.getTime(),
              input.now.getTime() +
                RECOMMENDATION_PROFILE_SESSION_LINK_HOURS * 3_600_000,
            ),
          )
          await tx.recommendationProfileSessionLink.upsert({
            where: {
              profileId_privacyGeneration_sessionDigest: {
                profileId: receipt.profile.id,
                privacyGeneration: receipt.profile.privacyGeneration,
                sessionDigest: input.sessionDigest,
              },
            },
            create: {
              profileId: receipt.profile.id,
              privacyGeneration: receipt.profile.privacyGeneration,
              sessionDigest: input.sessionDigest,
              linkedAt: input.now,
              expiresAt,
            },
            update: { expiresAt },
          })
          return true
        },
        Date.now,
      ),
    retrieveProfile: (input) =>
      runRecommendationRetrievalQuery(
        prisma,
        input.deadlineAt,
        (scopedPrisma) =>
          getLiveProfileCandidates(scopedPrisma, {
            sessionDigest: input.sessionDigest,
            profileTokenDigest: input.profileTokenDigest,
            now: input.now,
            context: {
              surface: RECOMMENDATION_CONTRACTS.surface,
              purpose: "watch",
              locale: input.locale,
              audioLanguageSlug: input.audioLanguageSlug,
              seedMediaId: input.seedMediaId,
              manifestId: input.manifestId,
            },
          }),
      ),
    resolveRecentContext: (input) =>
      runRecommendationRetrievalQuery(
        prisma,
        input.deadlineAt,
        (scopedPrisma) =>
          getRecommendationRecentContext(scopedPrisma, {
            sessionDigest: input.sessionDigest,
            profileTokenDigest: input.profileTokenDigest,
            allowDurableProfileLinks: input.allowDurableProfileLinks,
            now: input.now,
          }),
      ),
  })
}
