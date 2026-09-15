import { createHash, randomBytes } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import {
  RecommendationAuthenticationError,
  RecommendationInputError,
} from "./errors"
import { assertWebRecommendationCaller } from "./caller"
import { RECOMMENDATION_PROFILE_CONTRACT } from "./contracts"
import {
  createRecommendationProfileService,
  RecommendationProfileService,
  RECOMMENDATION_CONSENT_CONTRACT,
} from "./profile.service"
import { dispatchRecommendationProfileProjection } from "./profiles/job"

const TOKEN = /^[A-Za-z0-9_-]{43}$/
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex")
const mint = () => randomBytes(32).toString("base64url")

function consumer(caller: Principal | null): Principal {
  if (caller?.role !== "CONSUMER_BEARER" || !caller.rateLimitBucketKey) {
    throw new RecommendationAuthenticationError()
  }
  return { ...caller, recommendationViewerVerified: true }
}

/** The handle proves possession of this installation's server-owned profile.
 * A separate random session token keeps operational playback sessions bounded;
 * clients retain it through playback and rotate it after 24 hours of inactivity.
 * Neither credential is an account ID or a device fingerprint.
 */
export class RecommendationViewerService {
  constructor(private readonly prisma: PrismaClient) {}

  async resolve(
    caller: Principal | null,
    viewerToken: string,
    sessionToken: string,
  ) {
    const verifiedCaller = consumer(caller)
    if (!TOKEN.test(viewerToken) || !TOKEN.test(sessionToken)) {
      throw new RecommendationAuthenticationError()
    }
    const viewer = await this.prisma.recommendationViewer.findUnique({
      where: { tokenDigest: digest(viewerToken) },
    })
    if (!viewer || viewer.expiresAt <= new Date())
      throw new RecommendationAuthenticationError()
    return {
      caller: verifiedCaller,
      sessionDigest: digest(sessionToken),
      profileTokenDigest: viewer.profileDigest,
      consentReceiptDigest: viewer.consentReceiptDigest,
      viewer,
    }
  }

  async bootstrap(caller: Principal | null) {
    const verifiedCaller = consumer(caller)
    const viewerToken = mint()
    const sessionToken = mint()
    const consentReceiptDigest = digest(mint())
    const profileDigest = digest(mint())
    const expiresAt = new Date(Date.now() + 180 * 86_400_000)
    // The identity and its initial profile commit together. A failed response
    // cannot expose an orphan handle with authority over a partial profile.
    await this.prisma.$transaction(async (tx) => {
      const service = new RecommendationProfileService({
        prisma: this.prisma,
        transaction: tx,
      })
      await service.transition({
        caller: verifiedCaller,
        contractVersion: RECOMMENDATION_PROFILE_CONTRACT,
        consentContractVersion: RECOMMENDATION_CONSENT_CONTRACT,
        action: "grant",
        consentChoice: "personalization",
        sessionDigest: digest(sessionToken),
        existingProfileDigest: null,
        proposedProfileDigest: profileDigest,
        proposedConsentReceiptDigest: consentReceiptDigest,
      })
      await tx.recommendationViewer.create({
        data: {
          tokenDigest: digest(viewerToken),
          profileDigest,
          consentReceiptDigest,
          expiresAt,
        },
      })
    })
    return {
      viewerToken,
      sessionToken,
      expiresAt: expiresAt.toISOString(),
      personalization: true,
    }
  }

  async transition(
    caller: Principal | null,
    input: {
      viewerToken: string
      sessionToken: string
      action: string
    },
  ) {
    if (
      !["status", "reset", "withdraw", "grant", "delete"].includes(input.action)
    ) {
      throw new RecommendationInputError("Unknown viewer action")
    }
    const identity = await this.resolve(
      caller,
      input.viewerToken,
      input.sessionToken,
    )
    const service = createRecommendationProfileService(this.prisma)
    const receipt =
      input.action === "status"
        ? await service.status({
            caller: identity.caller,
            contractVersion: RECOMMENDATION_PROFILE_CONTRACT,
            sessionDigest: identity.sessionDigest,
            consentReceiptDigest: identity.consentReceiptDigest,
            profileDigest: identity.profileTokenDigest,
          })
        : await this.prisma.$transaction(async (tx) => {
            // Serialize pointer changes across all sessions for this installation.
            await tx.$executeRaw`SELECT token_digest FROM recommendation_viewer WHERE token_digest = ${identity.viewer.tokenDigest} FOR UPDATE`
            const current = await tx.recommendationViewer.findUniqueOrThrow({
              where: { tokenDigest: identity.viewer.tokenDigest },
            })
            const proposedProfileDigest = digest(mint())
            const proposedConsentReceiptDigest = digest(mint())
            const result = await new RecommendationProfileService({
              prisma: this.prisma,
              transaction: tx,
            }).transition({
              caller: identity.caller,
              contractVersion: RECOMMENDATION_PROFILE_CONTRACT,
              consentContractVersion: RECOMMENDATION_CONSENT_CONTRACT,
              action: input.action as "grant" | "reset" | "withdraw" | "delete",
              consentChoice:
                input.action === "withdraw" || input.action === "delete"
                  ? "essential_only"
                  : "personalization",
              sessionDigest: identity.sessionDigest,
              existingProfileDigest: current.profileDigest,
              existingConsentReceiptDigest: current.consentReceiptDigest,
              proposedProfileDigest,
              proposedConsentReceiptDigest,
            })
            await tx.recommendationViewer.update({
              where: { tokenDigest: current.tokenDigest },
              data: {
                profileDigest:
                  result.cookieDisposition === "set"
                    ? proposedProfileDigest
                    : result.cookieDisposition === "clear"
                      ? null
                      : current.profileDigest,
                consentReceiptDigest: proposedConsentReceiptDigest,
              },
            })
            return result
          })
    if (receipt.profileId && receipt.erasureGeneration != null) {
      void service
        .completeErasure({
          profileId: receipt.profileId,
          privacyGeneration: receipt.erasureGeneration,
        })
        .catch(() => undefined)
    }
    if (
      receipt.profileId &&
      receipt.privacyGeneration != null &&
      receipt.state === "active" &&
      receipt.erasureGeneration == null
    ) {
      void dispatchRecommendationProfileProjection({
        sessionDigest: identity.sessionDigest,
        profileId: receipt.profileId,
        privacyGeneration: receipt.privacyGeneration,
      }).catch(() => undefined)
    }
    return {
      state: receipt.state,
      personalization: receipt.consentChoice === "personalization",
    }
  }
}

/** Legacy digests remain available only to the trusted Web backend. Fleet
 * callers must prove a viewer handle before any existing lifecycle service runs.
 */
export async function resolveRecommendationIdentity(
  prisma: PrismaClient,
  caller: Principal | null,
  args: {
    viewerToken?: string | null
    sessionToken?: string | null
    sessionDigest?: string | null
  },
) {
  if (args.viewerToken != null || args.sessionToken != null) {
    if (!args.viewerToken || !args.sessionToken || args.sessionDigest != null) {
      throw new RecommendationInputError(
        "Supply viewer and session tokens without a session digest",
      )
    }
    return new RecommendationViewerService(prisma).resolve(
      caller,
      args.viewerToken,
      args.sessionToken,
    )
  }
  assertWebRecommendationCaller(caller)
  if (!args.sessionDigest || !/^[a-f0-9]{64}$/.test(args.sessionDigest)) {
    throw new RecommendationInputError(
      "A valid recommendation session is required",
    )
  }
  return {
    caller,
    sessionDigest: args.sessionDigest,
    profileTokenDigest: null,
    consentReceiptDigest: null,
  }
}

export async function resolveRecommendationSessionIdentity(
  prisma: PrismaClient,
  caller: Principal | null,
  args: Parameters<typeof resolveRecommendationIdentity>[2],
) {
  const identity = await resolveRecommendationIdentity(prisma, caller, args)
  return { caller: identity.caller, sessionDigest: identity.sessionDigest }
}
