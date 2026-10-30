import { z } from "zod"
import {
  RECOMMENDATION_PROFILE_BODY_BYTES,
  RECOMMENDATION_PROFILE_CONTRACT,
} from "@/lib/recommendation-contracts"
import { transitionRecommendationProfile } from "@/lib/recommendations"
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
  clearRecommendationProfile,
  readRecommendationProfileCookie,
  ensureRecommendationSession,
} from "@/lib/recommendation-session"
import {
  RECOMMENDATION_CONSENT_CONTRACT,
  clearRecommendationConsent,
  readRecommendationConsentCookie,
} from "@/lib/recommendation-consent"
import { WATCH_CANONICAL_ORIGIN } from "@/lib/routes"
import { clearRecommendationExperimentBrowser } from "@/lib/recommendation-experiment-browser"
import {
  RECOMMENDATION_EXPERIMENT_TESTER_COOKIE,
  RECOMMENDATION_TESTER_COOKIE_PATH,
} from "@/lib/recommendation-tester-token"

export const dynamic = "force-dynamic"
export const revalidate = 0

const Input = z
  .object({
    contractVersion: z.literal(RECOMMENDATION_PROFILE_CONTRACT),
    action: z.enum(["status", "grant", "reset", "withdraw", "delete"]),
  })
  .strict()

/** Compatibility for cached clients. No operation can create a viewer profile. */
export async function POST(request: Request) {
  try {
    const parsed = Input.safeParse(
      await readStrictRecommendationJson(request, {
        expectedOrigin: WATCH_CANONICAL_ORIGIN,
        maxBytes: RECOMMENDATION_PROFILE_BODY_BYTES,
      }),
    )
    if (!parsed.success) throw new RecommendationRouteError(400, "invalid_body")
    await assertRecommendationMutationAdmission(
      request.headers,
      "privacy-control",
    )
    const session = ensureRecommendationSession(request)
    const profile = readRecommendationProfileCookie(request)
    const consent = readRecommendationConsentCookie(request)
    let erasureState: string | null = null
    if (profile.kind === "valid" || consent.kind === "valid") {
      const receipt = await transitionRecommendationProfile({
        contractVersion: RECOMMENDATION_PROFILE_CONTRACT,
        consentContractVersion: RECOMMENDATION_CONSENT_CONTRACT,
        action: "withdraw",
        consentChoice: "essential_only",
        sessionDigest: session.digest,
        existingConsentReceiptDigest:
          consent.kind === "valid" ? consent.digest : null,
        existingProfileDigest: profile.kind === "valid" ? profile.digest : null,
        proposedConsentReceiptDigest: null,
        proposedProfileDigest: null,
      })
      erasureState = receipt.erasureState
    }
    const response = recommendationJson({
      profile: {
        state: "session_only",
        choice: "session_only",
        privacyGeneration: null,
        expiresAt: null,
        erasureState,
        cookieDisposition: "clear",
        consentChoice: "undecided",
        consentContractVersion: RECOMMENDATION_CONSENT_CONTRACT,
        consentExpiresAt: null,
        consentCookieDisposition: "clear",
      },
    })
    clearRecommendationProfile(response)
    clearRecommendationConsent(response)
    if (parsed.data.action === "delete" || parsed.data.action === "reset") {
      clearRecommendationExperimentBrowser(response)
      response.cookies.set(RECOMMENDATION_EXPERIMENT_TESTER_COOKIE, "", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: RECOMMENDATION_TESTER_COOKIE_PATH,
        maxAge: 0,
      })
    }
    return response
  } catch (error) {
    return recommendationError(error)
  }
}
