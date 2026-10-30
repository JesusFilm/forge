import { timeRecommendationOperation } from "@/lib/recommendation-runtime-observation"
import type { PrismaClient } from "@prisma/client"
import { env } from "@/config/env"
import { prisma as defaultPrisma } from "@/db/client"
import { SceneRecommendationsService } from "@/services/scene-recommendations.service"
import { createRecommendationDeliveryAdmission } from "./admission"
import { retrieveCuratedFallback } from "./curated-fallback"
import { getSemanticDeliveryCandidatePool } from "./delivery-retriever"
import {
  runRecommendationDeliveryTransaction,
  runRecommendationRetrievalQuery,
} from "./delivery-runtime"
import type { DeliveryDependencies } from "./delivery.types"
import { RecommendationDeliveryService } from "./delivery.service"
import { getRecommendationServingState } from "./manifest.service"
import { createRuntimeRecommendationTokenService } from "./runtime-token"

export function createRecommendationDeliveryService(
  prisma: PrismaClient = defaultPrisma,
): RecommendationDeliveryService {
  return new RecommendationDeliveryService(
    createRecommendationDeliveryDependencies(prisma),
  )
}

function timed<Args extends unknown[], Result>(
  label: string,
  operation: (...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result> {
  return (...args) =>
    timeRecommendationOperation(label, () => operation(...args))
}

export function createRecommendationDeliveryDependencies(
  prisma: PrismaClient,
): DeliveryDependencies {
  const token = createRuntimeRecommendationTokenService(prisma)
  return {
    prisma,
    admission: createRecommendationDeliveryAdmission(),
    tokenService: token,
    retrieveCuratedFallback: timed("retrieveCuratedFallback", (input) =>
      retrieveCuratedFallback(prisma, input),
    ),
    getServingState: timed("getServingState", ({ deadlineAt }) =>
      runRecommendationDeliveryTransaction(
        prisma,
        deadlineAt,
        (tx) =>
          getRecommendationServingState({
            prisma: tx as unknown as PrismaClient,
            environmentEnabled:
              env.RECOMMENDATION_SEMANTIC_SERVING_ENABLED === "true",
            hasActiveSigner: token != null,
          }),
        Date.now,
      ),
    ),
    retrieve: timed(
      "retrieve",
      ({
        seedMediaId,
        locale,
        audioLanguageSlug,
        limit,
        deadlineAt,
        onDiagnostics,
      }) =>
        runRecommendationRetrievalQuery(prisma, deadlineAt, (scopedPrisma) =>
          getSemanticDeliveryCandidatePool(scopedPrisma, {
            seedMediaId,
            locale,
            audioLanguageSlug,
            limit,
            onDiagnostics,
          }),
        ),
    ),
    recheckCached: timed("recheckCached", (items, input) =>
      runRecommendationRetrievalQuery(
        prisma,
        input.deadlineAt,
        (scopedPrisma) =>
          new SceneRecommendationsService({
            prisma: scopedPrisma,
          }).recheckEligibility(items, input.locale, input.audioLanguageSlug),
      ),
    ),
  }
}
