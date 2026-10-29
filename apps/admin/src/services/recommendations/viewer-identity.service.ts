import { createHash, randomBytes } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import {
  RecommendationAuthenticationError,
  RecommendationInputError,
} from "./errors"
import { assertWebRecommendationCaller } from "./caller"
import {
  unlinkPushViewerIdentities,
  type PushIdentityUnlinkResult,
} from "@/services/push/identity-unlink.service"

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

/** The handle proves possession of this installation's operational identity.
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
      profileTokenDigest: null,
      consentReceiptDigest: null,
      viewer,
    }
  }

  async bootstrap(caller: Principal | null) {
    consumer(caller)
    const viewerToken = mint()
    const sessionToken = mint()
    const expiresAt = new Date(Date.now() + 180 * 86_400_000)
    await this.prisma.recommendationViewer.create({
      data: {
        tokenDigest: digest(viewerToken),
        profileDigest: null,
        // Legacy non-null column; no consent receipt is created or used.
        consentReceiptDigest: digest(mint()),
        expiresAt,
      },
    })
    return {
      viewerToken,
      sessionToken,
      expiresAt: expiresAt.toISOString(),
      personalization: false,
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
    let pushUnlink: PushIdentityUnlinkResult | null = null
    if (input.action !== "status") {
      await this.prisma.$transaction(async (tx) => {
        // Serialize pointer changes across all sessions for this installation.
        await tx.$executeRaw`SELECT token_digest FROM recommendation_viewer WHERE token_digest = ${identity.viewer.tokenDigest} FOR UPDATE`
        const current = await tx.recommendationViewer.findUniqueOrThrow({
          where: { tokenDigest: identity.viewer.tokenDigest },
        })
        await tx.recommendationViewer.update({
          where: { tokenDigest: current.tokenDigest },
          data: {
            profileDigest: null,
            consentReceiptDigest: digest(mint()),
          },
        })
        // A deletion is an erasure, so the push link ends with it. A
        // withdrawal is a consent choice and leaves every push row alone.
        if (input.action === "delete") {
          pushUnlink = await unlinkPushViewerIdentities(tx, [
            current.tokenDigest,
          ])
        }
      })
    }
    // Logged after the transaction commits, and with counts only: a digest is
    // an identifier and never reaches a log line.
    if (pushUnlink) {
      const unlinked: PushIdentityUnlinkResult = pushUnlink
      console.info(
        `[push] event=identity_unlinked reason=viewer_delete registrations=${unlinked.registrationsUnlinked} opens=${unlinked.opensDeleted} attributions=${unlinked.attributionsDeleted}`,
      )
    }
    return {
      state: "session_only",
      personalization: false,
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
