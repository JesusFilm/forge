import type { PrismaClient } from "@prisma/client"
import { z } from "zod"
import type { Principal } from "@/auth/principal"
import { assertWebRecommendationCaller } from "./caller"
import { RECOMMENDATION_PROFILE_CONTRACT } from "./contracts"
import { RecommendationInputError } from "./errors"

export const RECOMMENDATION_CONSENT_CONTRACT =
  "recommendation-consent-v1" as const

const Digest = z.string().regex(/^[a-f0-9]{64}$/)

export type RecommendationProfileReceipt = Readonly<{
  state: "session_only" | "active"
  choice: "session_only" | "durable_allowed"
  privacyGeneration: number | null
  expiresAt: string | null
  erasureState: "not_required" | "pending" | "completed" | "failed" | null
  cookieDisposition: "keep" | "set" | "clear"
  consentChoice: "undecided" | "essential_only" | "personalization"
  consentContractVersion: typeof RECOMMENDATION_CONSENT_CONTRACT
  consentExpiresAt: string | null
  consentCookieDisposition: "keep" | "set" | "clear"
  profileId: string | null
  erasureGeneration: number | null
}>

type ProfileTransitionInput = {
  caller: Principal | null
  contractVersion: string
  consentContractVersion?: string
  action: "grant" | "reset" | "withdraw" | "delete"
  consentChoice?: "essential_only" | "personalization"
  sessionDigest: string
  existingConsentReceiptDigest?: string | null
  proposedConsentReceiptDigest?: string | null
  existingProfileDigest: string | null
  proposedProfileDigest: string | null
}

function retiredReceipt(): RecommendationProfileReceipt {
  return {
    state: "session_only",
    choice: "session_only",
    privacyGeneration: null,
    expiresAt: null,
    erasureState: null,
    cookieDisposition: "clear",
    consentChoice: "undecided",
    consentContractVersion: RECOMMENDATION_CONSENT_CONTRACT,
    consentExpiresAt: null,
    consentCookieDisposition: "clear",
    profileId: null,
    erasureGeneration: null,
  }
}

/** The public legacy contract remains readable while behavioral profiles are retired. */
export class RecommendationProfileService {
  async status(input: {
    caller: Principal | null
    contractVersion: string
    consentContractVersion?: string
    sessionDigest: string
    consentReceiptDigest?: string | null
    profileDigest: string | null
  }): Promise<RecommendationProfileReceipt> {
    assertWebRecommendationCaller(input.caller)
    if (
      input.contractVersion !== RECOMMENDATION_PROFILE_CONTRACT ||
      (input.consentContractVersion != null &&
        input.consentContractVersion !== RECOMMENDATION_CONSENT_CONTRACT) ||
      !Digest.safeParse(input.sessionDigest).success ||
      (input.consentReceiptDigest != null &&
        !Digest.safeParse(input.consentReceiptDigest).success) ||
      (input.profileDigest != null &&
        !Digest.safeParse(input.profileDigest).success)
    ) {
      throw new RecommendationInputError(
        "Recommendation profile status input is invalid",
      )
    }
    return retiredReceipt()
  }

  async transition(
    input: ProfileTransitionInput,
  ): Promise<RecommendationProfileReceipt> {
    assertWebRecommendationCaller(input.caller)
    const valid = z
      .object({
        contractVersion: z.literal(RECOMMENDATION_PROFILE_CONTRACT),
        consentContractVersion: z
          .literal(RECOMMENDATION_CONSENT_CONTRACT)
          .optional(),
        action: z.enum(["grant", "reset", "withdraw", "delete"]),
        consentChoice: z.enum(["essential_only", "personalization"]).optional(),
        sessionDigest: Digest,
        existingConsentReceiptDigest: Digest.nullable().optional(),
        proposedConsentReceiptDigest: Digest.nullable().optional(),
        existingProfileDigest: Digest.nullable(),
        proposedProfileDigest: Digest.nullable(),
      })
      .strict()
      .safeParse({
        contractVersion: input.contractVersion,
        consentContractVersion: input.consentContractVersion,
        action: input.action,
        consentChoice: input.consentChoice,
        sessionDigest: input.sessionDigest,
        existingConsentReceiptDigest: input.existingConsentReceiptDigest,
        proposedConsentReceiptDigest: input.proposedConsentReceiptDigest,
        existingProfileDigest: input.existingProfileDigest,
        proposedProfileDigest: input.proposedProfileDigest,
      })
    if (!valid.success) {
      throw new RecommendationInputError(
        "Recommendation profile transition input is invalid",
      )
    }
    return retiredReceipt()
  }
}

export function createRecommendationProfileService(_prisma?: PrismaClient) {
  return new RecommendationProfileService()
}
