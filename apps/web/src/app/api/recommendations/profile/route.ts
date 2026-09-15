import { z } from "zod"
import {
  RECOMMENDATION_PROFILE_BODY_BYTES,
  RECOMMENDATION_PROFILE_CONTRACT,
} from "@/lib/recommendation-contracts"
import {
  getRecommendationProfileStatus,
  transitionRecommendationProfile,
} from "@/lib/recommendations"
import {
  RecommendationRouteError,
  readStrictRecommendationJson,
} from "@/lib/recommendation-route-policy"
import { assertRecommendationMutationAdmission } from "@/lib/recommendation-mutation-admission"
import {
  recommendationError,
  recommendationJson,
} from "@/lib/recommendation-route-response"
import {
  attachRecommendationProfile,
  attachRecommendationSession,
  clearRecommendationProfile,
  createRecommendationProfileCookie,
  ensureRecommendationSession,
  readRecommendationProfileCookie,
} from "@/lib/recommendation-session"
import { WATCH_CANONICAL_ORIGIN } from "@/lib/routes"
import {
  RECOMMENDATION_CONSENT_CONTRACT,
  attachRecommendationConsent,
  bindRecommendationConsentProfile,
  clearRecommendationConsent,
  createRecommendationConsentCookie,
  readRecommendationConsentCookie,
} from "@/lib/recommendation-consent"

export const dynamic = "force-dynamic"
export const revalidate = 0

const Input = z
  .object({
    contractVersion: z.literal(RECOMMENDATION_PROFILE_CONTRACT),
    action: z.enum(["status", "grant", "reset", "withdraw", "delete"]),
  })
  .strict()

const Receipt = z
  .object({
    __typename: z.literal("RecommendationProfileReceipt").optional(),
    state: z.enum(["session_only", "active"]),
    choice: z.enum(["session_only", "durable_allowed"]),
    privacyGeneration: z.number().int().positive().nullable(),
    expiresAt: z.string().datetime({ offset: true }).nullable(),
    erasureState: z
      .enum(["not_required", "pending", "completed", "failed"])
      .nullable(),
    cookieDisposition: z.enum(["keep", "set", "clear"]),
    consentChoice: z.enum(["undecided", "essential_only", "personalization"]),
    consentContractVersion: z.literal(RECOMMENDATION_CONSENT_CONTRACT),
    consentExpiresAt: z.string().datetime({ offset: true }).nullable(),
    consentCookieDisposition: z.enum(["keep", "set", "clear"]),
  })
  .strict()
  .superRefine((profile, context) => {
    if (
      (profile.state === "active" &&
        (profile.choice !== "durable_allowed" ||
          profile.privacyGeneration == null ||
          profile.expiresAt == null)) ||
      (profile.state === "session_only" &&
        (profile.choice !== "session_only" ||
          profile.privacyGeneration != null ||
          profile.expiresAt != null))
    ) {
      context.addIssue({
        code: "custom",
        message: "Recommendation profile state is inconsistent",
      })
    }
    if (
      (profile.consentChoice === "undecided" &&
        profile.consentExpiresAt != null) ||
      (profile.consentChoice !== "undecided" &&
        profile.consentExpiresAt == null) ||
      (profile.state === "active" &&
        profile.consentChoice !== "personalization")
    ) {
      context.addIssue({
        code: "custom",
        message: "Recommendation consent state is inconsistent",
      })
    }
  })
  .transform(({ __typename: _typename, ...profile }) => profile)

export async function POST(request: Request) {
  try {
    const raw = await readStrictRecommendationJson(request, {
      expectedOrigin: WATCH_CANONICAL_ORIGIN,
      maxBytes: RECOMMENDATION_PROFILE_BODY_BYTES,
    })
    const parsed = Input.safeParse(raw)
    if (!parsed.success) {
      throw new RecommendationRouteError(400, "invalid_body")
    }
    await assertRecommendationMutationAdmission(
      request.headers,
      parsed.data.action === "status"
        ? "profile-status"
        : parsed.data.action === "withdraw" || parsed.data.action === "delete"
          ? "privacy-control"
          : "profile-mutation",
    )

    const session = ensureRecommendationSession(request)
    const current = readRecommendationProfileCookie(request)
    const currentConsent = readRecommendationConsentCookie(request)
    const existingProfileDigest =
      current.kind === "valid" ? current.digest : null
    let proposed =
      parsed.data.action === "grant" || parsed.data.action === "reset"
        ? createRecommendationProfileCookie()
        : null
    let proposedConsent =
      parsed.data.action === "status"
        ? null
        : createRecommendationConsentCookie()
    const consentChoice =
      parsed.data.action === "grant" || parsed.data.action === "reset"
        ? "personalization"
        : parsed.data.action === "status"
          ? undefined
          : "essential_only"
    let upstreamProfile =
      parsed.data.action === "status"
        ? await getRecommendationProfileStatus({
            contractVersion: RECOMMENDATION_PROFILE_CONTRACT,
            consentContractVersion: RECOMMENDATION_CONSENT_CONTRACT,
            sessionDigest: session.digest,
            consentReceiptDigest:
              currentConsent.kind === "valid" ? currentConsent.digest : null,
            profileDigest: existingProfileDigest,
          })
        : await transitionRecommendationProfile({
            contractVersion: RECOMMENDATION_PROFILE_CONTRACT,
            consentContractVersion: RECOMMENDATION_CONSENT_CONTRACT,
            action: parsed.data.action,
            consentChoice,
            sessionDigest: session.digest,
            existingConsentReceiptDigest:
              currentConsent.kind === "valid" ? currentConsent.digest : null,
            proposedConsentReceiptDigest: proposedConsent?.digest ?? null,
            existingProfileDigest,
            proposedProfileDigest: proposed?.digest ?? null,
          })
    let parsedReceipt = Receipt.safeParse(upstreamProfile)
    if (!parsedReceipt.success) {
      throw new RecommendationRouteError(502, "invalid_admin_response")
    }
    let profile = parsedReceipt.data

    if (
      parsed.data.action === "grant" &&
      profile.state === "active" &&
      profile.cookieDisposition === "keep" &&
      current.kind !== "valid"
    ) {
      // A concurrent first-visit grant can create the profile before this
      // request acquires Admin's session lock. The active identity is then
      // known only by digest, so Web cannot safely attach it. Rotate through
      // reset in the same response and return one self-consistent cookie set.
      const replacementProfile = createRecommendationProfileCookie()
      const replacementConsent = createRecommendationConsentCookie()
      upstreamProfile = await transitionRecommendationProfile({
        contractVersion: RECOMMENDATION_PROFILE_CONTRACT,
        consentContractVersion: RECOMMENDATION_CONSENT_CONTRACT,
        action: "reset",
        consentChoice: "personalization",
        sessionDigest: session.digest,
        existingConsentReceiptDigest: proposedConsent?.digest ?? null,
        proposedConsentReceiptDigest: replacementConsent.digest,
        existingProfileDigest: null,
        proposedProfileDigest: replacementProfile.digest,
      })
      parsedReceipt = Receipt.safeParse(upstreamProfile)
      if (!parsedReceipt.success) {
        throw new RecommendationRouteError(502, "invalid_admin_response")
      }
      proposed = replacementProfile
      proposedConsent = replacementConsent
      profile = parsedReceipt.data
    }

    const response = recommendationJson({ profile })
    attachRecommendationSession(response, session)
    if (profile.cookieDisposition === "set") {
      if (!proposed) {
        throw new RecommendationRouteError(502, "invalid_admin_response")
      }
      attachRecommendationProfile(response, proposed)
    } else if (
      profile.cookieDisposition === "clear" ||
      current.kind === "invalid"
    ) {
      clearRecommendationProfile(response)
    }
    if (profile.consentCookieDisposition === "set") {
      if (!proposedConsent) {
        throw new RecommendationRouteError(502, "invalid_admin_response")
      }
      const consentProfileValue =
        profile.state === "active"
          ? profile.cookieDisposition === "set"
            ? proposed?.value
            : current.kind === "valid"
              ? current.value
              : null
          : null
      if (profile.state === "active" && consentProfileValue == null) {
        throw new RecommendationRouteError(502, "invalid_admin_response")
      }
      attachRecommendationConsent(
        response,
        bindRecommendationConsentProfile(
          proposedConsent,
          consentProfileValue ?? null,
        ),
      )
    } else if (
      profile.consentCookieDisposition === "clear" ||
      currentConsent.kind === "invalid"
    ) {
      clearRecommendationConsent(response)
    }
    return response
  } catch (error) {
    return recommendationError(error)
  }
}
