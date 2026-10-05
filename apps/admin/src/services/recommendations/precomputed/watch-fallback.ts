import type { PrismaClient } from "@prisma/client"
import { env } from "@/config/env"
import { assertWebRecommendationCaller } from "../caller"
import type {
  DeliveryInput,
  SemanticRecommendationDelivery,
} from "../delivery.types"
import {
  runRecommendationDeliveryTransaction,
  unavailable,
} from "../delivery-runtime"
import { RecommendationAuthenticationError } from "../errors"
import { verifyPrecomputedSourceEligibility } from "./watch-reader"

/** Private recovery cannot inherit the ordinary incumbent's unverified seed. */
export async function deliverPrecomputedWatchFallback(
  prisma: PrismaClient,
  input: Pick<
    DeliveryInput,
    | "caller"
    | "seedMediaId"
    | "locale"
    | "audioLanguageSlug"
    | "sessionDigest"
    | "trafficCategory"
  >,
  deliverIncumbent: (
    input: DeliveryInput,
  ) => Promise<SemanticRecommendationDelivery>,
): Promise<SemanticRecommendationDelivery> {
  assertWebRecommendationCaller(input.caller)
  if (env.RECOMMENDATION_PRECOMPUTED_PREVIEW_ENABLED !== "1")
    throw new RecommendationAuthenticationError()

  let sourceEligible: boolean
  try {
    sourceEligible = await runRecommendationDeliveryTransaction(
      prisma,
      Date.now() + 350,
      (tx) => verifyPrecomputedSourceEligibility(tx, input),
      Date.now,
    )
  } catch {
    return unavailable("source_eligibility_unavailable")
  }
  if (!sourceEligible) return unavailable("source_unavailable")

  return deliverIncumbent({
    ...input,
    consentReceiptDigest: null,
    profileTokenDigest: null,
    eligibleHuman: false,
    clientDeliveryContract: null,
  })
}
