import type { RecommendationShortfallReason } from "./contracts"
import {
  MAX_DELIVERY_RESPONSE_BYTES,
  RECOMMENDATION_CONTRACTS,
  boundedRecommendationContributors,
} from "./contracts"
import {
  selectedCandidateGenerator,
  type PreparedCandidate,
} from "./delivery-candidate-mapping"
import type {
  DeliveryTokenService,
  RecommendationPersonalizationDelivery,
  SemanticRecommendationDelivery,
} from "./delivery.types"
import { withinDeadline } from "./delivery-runtime"
import { RecommendationInternalStateError } from "./errors"
import type { ExperimentAssignmentResolution } from "./experiment/assignment"

type PreparedDeliveryCandidate = PreparedCandidate &
  Readonly<{
    id: string
    position: number
    capabilityJti: string
    canonicalHref: string
  }>

/**
 * Complete the bounded capability-signing and response-size phase after the
 * candidate slate has been prepared. Persistence remains the caller's next
 * step so an issuance failure can still be recorded without exposing a
 * partially issued response.
 */
export async function issueRecommendationDelivery(input: {
  prepared: readonly PreparedDeliveryCandidate[]
  tokenService: DeliveryTokenService
  sessionDigest: string
  manifestId: string
  assignment: ExperimentAssignmentResolution["assignment"]
  requestId: string
  result: SemanticRecommendationDelivery["result"]
  reason: string | null
  deliveryExpiresAt: Date
  requestedCount: number
  composedCount: number
  shortfallReason: RecommendationShortfallReason | null
  personalization: RecommendationPersonalizationDelivery
  issuanceDeadlineAt: number
  nowMilliseconds: () => number
}): Promise<{
  response: SemanticRecommendationDelivery
  responseBytes: number
}> {
  const items = await withinDeadline(
    () =>
      Promise.all(
        input.prepared.map(
          async ({
            candidate,
            sources,
            id,
            position,
            capabilityJti,
            canonicalHref,
          }) => ({
            ...candidate,
            id,
            position,
            targetMediaId: candidate.videoId,
            canonicalHref,
            candidateGenerator: selectedCandidateGenerator(sources),
            contributors: boundedRecommendationContributors(
              sources.map((source) => ({
                generator: source.generator,
                generatorVersion: source.generatorVersion,
                rank: source.rank,
              })),
            ),
            capability: await input.tokenService.signDeliveryCapability({
              jti: capabilityJti,
              requestId: input.requestId,
              itemId: id,
              sessionDigest: input.sessionDigest,
              surface: RECOMMENDATION_CONTRACTS.surface,
              manifestId: input.manifestId,
              ...(input.assignment
                ? {
                    assignmentId: input.assignment.assignmentId,
                    experimentId: input.assignment.experimentId,
                    experimentVersion: input.assignment.experimentVersion,
                    experimentGeneration: input.assignment.experimentGeneration,
                    experimentArm: input.assignment.arm,
                    effectiveManifestId: input.assignment.effectiveManifestId,
                    assignmentProbability:
                      input.assignment.assignmentProbability,
                    assignmentConfigurationDigest:
                      input.assignment.configurationDigest,
                  }
                : {}),
            }),
          }),
        ),
      ),
    input.issuanceDeadlineAt,
    input.nowMilliseconds,
  )
  const response: SemanticRecommendationDelivery = {
    contractVersion: RECOMMENDATION_CONTRACTS.delivery,
    surfaceVersion: RECOMMENDATION_CONTRACTS.surface,
    strategyVersion: RECOMMENDATION_CONTRACTS.strategy,
    classifierVersion: RECOMMENDATION_CONTRACTS.outcome,
    requestId: input.requestId,
    result: input.result,
    reason: input.reason,
    expiresAt:
      input.result === "unavailable"
        ? null
        : input.deliveryExpiresAt.toISOString(),
    requestedCount: input.requestedCount,
    composedCount: input.composedCount,
    shortfallReason: input.shortfallReason,
    items,
    personalization: input.personalization,
  }
  const responseBytes = Buffer.byteLength(JSON.stringify(response))
  if (responseBytes > MAX_DELIVERY_RESPONSE_BYTES) {
    throw new RecommendationInternalStateError("delivery_response_oversized")
  }
  return { response, responseBytes }
}
