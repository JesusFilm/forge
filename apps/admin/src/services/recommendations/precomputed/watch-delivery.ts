import { randomUUID } from "node:crypto"
import { env } from "@/config/env"
import type { Principal } from "@/auth/principal"
import {
  RecommendationAuditKind,
  RecommendationDeliveryResult,
  RecommendationRequestState,
  type PrismaClient,
} from "@prisma/client"
import { buildCanonicalWatchVideoPath } from "@forge/watch-url-policy/routes"
import {
  MAX_DELIVERY_RESPONSE_BYTES,
  RECOMMENDATION_CONTRACTS,
  RECOMMENDATION_RAW_RETENTION_DAYS,
} from "../contracts"
import { runRecommendationDeliveryTransaction } from "../delivery-runtime"
import type {
  DeliveryTokenService,
  SemanticRecommendationDelivery,
} from "../delivery.types"
import { servedSnapshotCreate } from "../served-item-payload"
import { DELIVERY_CAPABILITY_LIFETIME_SECONDS } from "../token.service"
import {
  PrecomputedSourceEligibilityUnavailableError,
  readPrecomputedWatchChoices,
  verifyPrecomputedSourceEligibility,
} from "./watch-reader"
import { assertWebRecommendationCaller } from "../caller"
import { RecommendationAuthenticationError } from "../errors"

export const PRECOMPUTED_WATCH_PREVIEW_MANIFEST_ID =
  "precomputed-watch-preview-v1"

type PreviewDelivery = SemanticRecommendationDelivery & {
  generationId: string | null
}

function unavailable(
  reason: string,
  generationId: string | null = null,
): PreviewDelivery {
  return {
    contractVersion: RECOMMENDATION_CONTRACTS.delivery,
    surfaceVersion: RECOMMENDATION_CONTRACTS.surface,
    strategyVersion: PRECOMPUTED_WATCH_PREVIEW_MANIFEST_ID,
    classifierVersion: RECOMMENDATION_CONTRACTS.outcome,
    generationId,
    requestId: null,
    result: "unavailable",
    reason,
    expiresAt: null,
    requestedCount: 6,
    composedCount: 0,
    shortfallReason: null,
    items: [],
    personalization: null,
  }
}

export async function deliverPrecomputedWatchPreview(
  prisma: PrismaClient,
  input: {
    seedMediaId: string
    locale: string
    audioLanguageSlug: string
    sessionDigest: string
    caller: Principal | null
  },
  tokenService: DeliveryTokenService | null,
): Promise<PreviewDelivery> {
  assertWebRecommendationCaller(input.caller)
  if (env.RECOMMENDATION_PRECOMPUTED_PREVIEW_ENABLED !== "1")
    throw new RecommendationAuthenticationError()
  if (!tokenService) return unavailable("signing_unavailable")
  const deadlineAt = Date.now() + 1_500
  let read: Awaited<ReturnType<typeof readPrecomputedWatchChoices>>
  try {
    read = await runRecommendationDeliveryTransaction(
      prisma,
      deadlineAt,
      (tx) => readPrecomputedWatchChoices(tx, input),
      Date.now,
    )
  } catch (error) {
    return unavailable(
      error instanceof PrecomputedSourceEligibilityUnavailableError
        ? "source_eligibility_unavailable"
        : "precomputed_read_unavailable",
    )
  }
  if (read.state === "generation_unavailable")
    return unavailable("generation_unavailable")
  if (read.state === "not_in_generation")
    return unavailable("not_in_generation", read.generationId)
  if (read.state === "source_incomplete")
    return unavailable("source_incomplete", read.generationId)
  if (read.state === "source_unavailable")
    return unavailable("source_unavailable", read.generationId)

  const now = new Date()
  const requestId = randomUUID()
  const deliveryJti = randomUUID()
  const expiresAt = new Date(
    now.getTime() + RECOMMENDATION_RAW_RETENTION_DAYS * 86_400_000,
  )
  const deliveryExpiresAt = new Date(
    now.getTime() + DELIVERY_CAPABILITY_LIFETIME_SECONDS * 1_000,
  )
  const prepared = read.items.map((choice, position) => ({
    choice,
    id: randomUUID(),
    position,
    capabilityJti: randomUUID(),
    canonicalHref: `/watch${buildCanonicalWatchVideoPath(
      choice.videoSlug,
      input.audioLanguageSlug,
    )}`,
  }))
  let sourceRecheckStarted = false
  let sourceRecheckPassed = false
  try {
    const items = await Promise.all(
      prepared.map(
        async ({ choice, id, position, capabilityJti, canonicalHref }) => ({
          id,
          position,
          targetMediaId: choice.videoId,
          canonicalHref,
          candidateGenerator: "precomputed" as const,
          contributors: [
            {
              generator: "precomputed",
              generatorVersion: PRECOMPUTED_WATCH_PREVIEW_MANIFEST_ID,
              rank: choice.rank,
            },
          ],
          capability: await tokenService.signDeliveryCapability({
            jti: capabilityJti,
            requestId,
            itemId: id,
            sessionDigest: input.sessionDigest,
            surface: RECOMMENDATION_CONTRACTS.surface,
            manifestId: PRECOMPUTED_WATCH_PREVIEW_MANIFEST_ID,
          }),
          videoId: choice.videoId,
          videoSlug: choice.videoSlug,
          videoTitle: choice.videoTitle,
          imageUrl: choice.imageUrl,
          sceneIndex: 0,
          description: choice.description,
          startSeconds: 0,
          endSeconds: null,
          durationSeconds: choice.durationSeconds,
          similarity: 0,
          themes: [],
          demographics: [],
          spiritualContext: [],
          playbackId: choice.playbackId,
        }),
      ),
    )
    const response: PreviewDelivery = {
      contractVersion: RECOMMENDATION_CONTRACTS.delivery,
      surfaceVersion: RECOMMENDATION_CONTRACTS.surface,
      strategyVersion: PRECOMPUTED_WATCH_PREVIEW_MANIFEST_ID,
      classifierVersion: RECOMMENDATION_CONTRACTS.outcome,
      generationId: read.generationId,
      requestId,
      result: items.length ? "served" : "empty",
      reason: read.coverageGap,
      expiresAt: deliveryExpiresAt.toISOString(),
      requestedCount: 6,
      composedCount: items.length,
      shortfallReason: items.length < 6 ? "insufficient_candidates" : null,
      items,
      personalization: null,
    }
    const responseBytes = Buffer.byteLength(JSON.stringify(response))
    if (responseBytes > MAX_DELIVERY_RESPONSE_BYTES)
      return unavailable("precomputed_response_oversized", read.generationId)
    sourceRecheckStarted = true
    await runRecommendationDeliveryTransaction(
      prisma,
      deadlineAt,
      async (tx) => {
        // A seed that lost visibility between the read and issued snapshot must
        // not produce cards or permit incumbent recovery from this preview.
        if (!(await verifyPrecomputedSourceEligibility(tx, input)))
          throw new Error("source_unavailable")
        sourceRecheckPassed = true
        await tx.recommendationRequest.create({
          data: {
            id: requestId,
            contractVersion: RECOMMENDATION_CONTRACTS.delivery,
            surfaceVersion: RECOMMENDATION_CONTRACTS.surface,
            manifestId: PRECOMPUTED_WATCH_PREVIEW_MANIFEST_ID,
            strategyVersion: PRECOMPUTED_WATCH_PREVIEW_MANIFEST_ID,
            classifierVersion: RECOMMENDATION_CONTRACTS.outcome,
            sessionDigest: input.sessionDigest,
            seedMediaId: input.seedMediaId,
            locale: input.locale,
            purpose: "seeded",
            deliveryDiagnostics: {
              version: 1,
              assignedStrategy: PRECOMPUTED_WATCH_PREVIEW_MANIFEST_ID,
              actualStrategy: PRECOMPUTED_WATCH_PREVIEW_MANIFEST_ID,
              generationId: read.generationId,
              audioLanguageSlug: input.audioLanguageSlug,
              coverageGap: read.coverageGap,
            },
            expectedItemCount: items.length,
            state: RecommendationRequestState.ISSUED,
            result: items.length
              ? RecommendationDeliveryResult.SERVED
              : RecommendationDeliveryResult.EMPTY,
            fallbackReason: read.coverageGap,
            deliveryJti,
            signingKid: tokenService.activeKid,
            retrievalLatencyMs: Math.max(0, Date.now() - now.getTime()),
            responseBytes,
            issuedAt: now,
            expiresAt,
            ...servedSnapshotCreate(
              prepared.map(
                ({ choice, id, position, capabilityJti, canonicalHref }) => ({
                  id,
                  position,
                  targetMediaId: choice.videoId,
                  canonicalHref,
                  candidateGenerator: "precomputed",
                  candidateProvenance: {
                    generationId: read.generationId,
                    kind: choice.kind,
                    rank: choice.rank,
                  },
                  presentation: {
                    videoSlug: choice.videoSlug,
                    videoTitle: choice.videoTitle,
                    imageUrl: choice.imageUrl,
                    description: choice.description,
                    startSeconds: 0,
                    endSeconds: null,
                    durationSeconds: choice.durationSeconds,
                    themes: [],
                    demographics: [],
                    spiritualContext: [],
                    playbackId: choice.playbackId,
                    audioLanguageSlug: input.audioLanguageSlug,
                  },
                  capabilityJti,
                  signingKid: tokenService.activeKid,
                  expiresAt,
                }),
              ),
              "packed",
            ),
          },
        })
        await tx.recommendationEvidenceAudit.create({
          data: {
            requestId,
            kind: RecommendationAuditKind.DELIVERY_SUCCESS,
            reasonCode: response.result,
            expiresAt,
          },
        })
      },
      Date.now,
    )
    return response
  } catch (error) {
    return unavailable(
      error instanceof Error && error.message === "source_unavailable"
        ? "source_unavailable"
        : error instanceof PrecomputedSourceEligibilityUnavailableError ||
            (sourceRecheckStarted && !sourceRecheckPassed)
          ? "source_eligibility_unavailable"
          : "precomputed_delivery_unavailable",
      read.generationId,
    )
  }
}
