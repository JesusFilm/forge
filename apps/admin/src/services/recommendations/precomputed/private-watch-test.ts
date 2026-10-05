import type { Principal } from "@/auth/principal"
import { createRuntimeRecommendationTokenService } from "@/services/recommendations/runtime-token"
import { createRecommendationDeliveryService } from "@/services/recommendations/delivery.service"
import {
  runRecommendationDeliveryTransaction,
  unavailable,
} from "@/services/recommendations/delivery-runtime"
import type {
  DeliveryTokenService,
  SemanticRecommendationDelivery,
} from "@/services/recommendations/delivery.types"
import type { PrismaClient } from "@prisma/client"
import {
  admitPrivatePrecomputedVisit,
  recordPrivatePrecomputedVisitDelivery,
} from "./visit-admission"
import { deliverPrecomputedWatchPreview } from "./watch-delivery"
import { verifyPrecomputedSourceEligibility } from "./watch-reader"

type Input = {
  visitId: string
  browserDigest: string | null
  consentReceiptDigest: string | null
  profileTokenDigest: string | null
  seedMediaId: string
  locale: string
  audioLanguageSlug: string
  sessionDigest: string
  clientDeliveryContract: string | null
  trafficCategory:
    | "declared_crawler"
    | "speculative_prefetch"
    | "speculative_prerender"
    | "ordinary_browser"
    | "unknown"
  enrollmentMode: "private_test" | "preview" | "none"
  caller: Principal | null
}

/** One opt-in operation: persist admission before attempting either delivery. */
export async function deliverPrivatePrecomputedWatchVisit(
  prisma: PrismaClient,
  input: Input,
  tokenService: DeliveryTokenService | null = createRuntimeRecommendationTokenService(
    prisma,
  ),
): Promise<{
  status: "eligible" | "excluded" | "unavailable"
  visitId: string
  experimentId: string | null
  generationId: string | null
  arm: "control" | "challenger" | null
  reason: string | null
  qualification: string | null
  measurementStatus: "recorded" | "conflict" | "unavailable" | "not_applicable"
  delivery: SemanticRecommendationDelivery | null
}> {
  const deadlineAt = Date.now() + 3_000
  const deliveryDeadlineAt = deadlineAt - 250
  const admission = await admitPrivatePrecomputedVisit(prisma, {
    ...input,
    deadlineAt: deliveryDeadlineAt,
  })
  const base = {
    status: admission.status,
    visitId: admission.visitId,
    experimentId: admission.experimentId,
    generationId: admission.generationId,
    arm: admission.arm,
    reason: admission.reason,
    qualification: admission.qualification,
  }
  if (admission.status !== "eligible" || !input.browserDigest)
    return { ...base, measurementStatus: "not_applicable", delivery: null }

  const deliverControl = () =>
    createRecommendationDeliveryService(prisma).deliver({
      caller: input.caller,
      seedMediaId: input.seedMediaId,
      locale: input.locale,
      audioLanguageSlug: input.audioLanguageSlug,
      sessionDigest: input.sessionDigest,
      consentReceiptDigest: input.consentReceiptDigest,
      profileTokenDigest: input.profileTokenDigest,
      eligibleHuman: true,
      // Preserve ordinary consented personalization and owner routing while
      // preventing a second, unrelated experiment from assigning this visit.
      suppressExperimentEnrollment: true,
      trafficCategory: input.trafficCategory,
      clientDeliveryContract: input.clientDeliveryContract,
      deadlineAt: deliveryDeadlineAt,
    })
  let delivery: SemanticRecommendationDelivery
  let fallbackReason: string | null = null
  try {
    if (Date.now() >= deliveryDeadlineAt) {
      delivery = unavailable("private_test_deadline_exhausted")
    } else if (admission.arm === "challenger") {
      delivery = await deliverPrecomputedWatchPreview(
        prisma,
        {
          seedMediaId: input.seedMediaId,
          locale: input.locale,
          audioLanguageSlug: input.audioLanguageSlug,
          sessionDigest: input.sessionDigest,
          generationId: admission.generationId!,
          deadlineAt: deliveryDeadlineAt,
          caller: input.caller,
        },
        tokenService,
      )
      if (
        delivery.result === "unavailable" &&
        delivery.reason !== "source_unavailable" &&
        delivery.reason !== "source_eligibility_unavailable"
      ) {
        fallbackReason = delivery.reason ?? "precomputed_unavailable"
        const sourceEligible = await runRecommendationDeliveryTransaction(
          prisma,
          Math.min(deliveryDeadlineAt, Date.now() + 350),
          (tx) => verifyPrecomputedSourceEligibility(tx, input),
          Date.now,
        )
        if (sourceEligible && Date.now() < deliveryDeadlineAt)
          delivery = await deliverControl()
      }
    } else {
      delivery = await deliverControl()
    }
  } catch {
    delivery = unavailable("private_test_delivery_unavailable")
  }
  const measurementStatus = await recordPrivatePrecomputedVisitDelivery(
    prisma,
    {
      visitId: input.visitId,
      browserDigest: input.browserDigest,
      consentReceiptDigest: input.consentReceiptDigest,
      profileTokenDigest: input.profileTokenDigest,
      result: delivery.result,
      actualStrategy:
        delivery.result === "unavailable" ? null : delivery.strategyVersion,
      requestId: delivery.requestId,
      fallbackReason,
      caller: input.caller,
      deadlineAt,
    },
  )
  return { ...base, measurementStatus, delivery }
}
