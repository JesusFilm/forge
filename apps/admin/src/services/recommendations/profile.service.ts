import {
  Prisma,
  RecommendationConsentChoice,
  RecommendationConsentReceiptState,
  RecommendationExperimentAssignmentState,
  RecommendationProfileErasureState,
  RecommendationProfileState,
  type PrismaClient,
} from "@prisma/client"
import { z } from "zod"
import type { Principal } from "@/auth/principal"
import { prisma as defaultPrisma } from "@/db/client"
import { assertWebRecommendationCaller } from "./caller"
import { RECOMMENDATION_PROFILE_CONTRACT } from "./contracts"
import { RecommendationConflictError, RecommendationInputError } from "./errors"
import { redactShadowRunsForProfileGeneration } from "./shadow-evaluation/service"
import { eraseProfileProjectionInfluence } from "./profiles/privacy"
import { suppressCowatchForProfiles } from "./cowatch/privacy"

export const RECOMMENDATION_PROFILE_DAYS = 180
export const RECOMMENDATION_PROFILE_AUDIT_DAYS = 365
export const RECOMMENDATION_CONSENT_CONTRACT =
  "recommendation-consent-v1" as const

const Digest = z.string().regex(/^[a-f0-9]{64}$/)
const TransitionInput = z
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

type ProfileDependencies = {
  transaction?: Prisma.TransactionClient
  prisma: PrismaClient
  now?: () => Date
  newId?: () => string
  newAuditId?: () => string
}

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
  /** Internal scheduling key. This field is never exposed by GraphQL. */
  profileId: string | null
  /** Internal worker fence. This field is never exposed by GraphQL. */
  erasureGeneration: number | null
}>

type ActiveProfile = {
  id: string
  privacyGeneration: number
  expiresAt: Date
}

type TransitionAuthorityInput = Pick<
  z.infer<typeof TransitionInput>,
  | "action"
  | "sessionDigest"
  | "existingConsentReceiptDigest"
  | "existingProfileDigest"
>

function sessionOnly(
  cookieDisposition: RecommendationProfileReceipt["cookieDisposition"],
  erasure?: { profileId: string; generation: number },
  consent: {
    choice: RecommendationProfileReceipt["consentChoice"]
    expiresAt: Date | null
    cookieDisposition: RecommendationProfileReceipt["consentCookieDisposition"]
  } = {
    choice: "undecided",
    expiresAt: null,
    cookieDisposition: "keep",
  },
): RecommendationProfileReceipt {
  return {
    state: "session_only",
    choice: "session_only",
    privacyGeneration: null,
    expiresAt: null,
    erasureState: erasure ? "pending" : null,
    cookieDisposition,
    consentChoice: consent.choice,
    consentContractVersion: RECOMMENDATION_CONSENT_CONTRACT,
    consentExpiresAt: consent.expiresAt?.toISOString() ?? null,
    consentCookieDisposition: consent.cookieDisposition,
    profileId: erasure?.profileId ?? null,
    erasureGeneration: erasure?.generation ?? null,
  }
}

export class RecommendationProfileService {
  constructor(private readonly deps: ProfileDependencies) {}

  private transaction<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.deps.transaction
      ? operation(this.deps.transaction)
      : this.deps.prisma.$transaction(operation)
  }

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
      !(
        input.consentReceiptDigest == null ||
        Digest.safeParse(input.consentReceiptDigest).success
      ) ||
      !(
        input.profileDigest == null ||
        Digest.safeParse(input.profileDigest).success
      )
    ) {
      throw new RecommendationInputError(
        "Recommendation profile status input is invalid",
      )
    }
    return this.transition({
      caller: input.caller,
      contractVersion: input.contractVersion,
      consentContractVersion: input.consentContractVersion,
      action: "withdraw",
      sessionDigest: input.sessionDigest,
      existingConsentReceiptDigest: input.consentReceiptDigest,
      existingProfileDigest: input.profileDigest,
      proposedProfileDigest: null,
      proposedConsentReceiptDigest: null,
    })
  }

  async transition(
    input: ProfileTransitionInput,
  ): Promise<RecommendationProfileReceipt> {
    assertWebRecommendationCaller(input.caller)
    const parsed = TransitionInput.parse({
      contractVersion: input.contractVersion,
      consentContractVersion: input.consentContractVersion,
      action: input.action,
      consentChoice: input.consentChoice,
      sessionDigest: input.sessionDigest,
      existingConsentReceiptDigest: input.existingConsentReceiptDigest ?? null,
      proposedConsentReceiptDigest: input.proposedConsentReceiptDigest ?? null,
      existingProfileDigest: input.existingProfileDigest,
      proposedProfileDigest: input.proposedProfileDigest,
    })
    const now = this.deps.now?.() ?? new Date()
    // Retired clients may still send grant/reset. They can erase old state but
    // can never create a new profile or renew a session link.
    let erasure: { profileId: string; generation: number } | undefined
    if (parsed.existingProfileDigest || parsed.existingConsentReceiptDigest) {
      await this.transaction(async (tx) => {
        const authority = await this.resolveTransitionAuthority(
          tx,
          { ...parsed, action: "withdraw" },
          now,
        )
        if (authority.profileId) {
          await this.lockProfileAuthority(tx, authority.profileId)
          const current = await tx.recommendationProfile.findUnique({
            where: { id: authority.profileId },
          })
          if (
            current?.state === RecommendationProfileState.ACTIVE &&
            current.tokenDigest
          ) {
            await this.fenceProfile(tx, current, "withdraw", now)
            erasure = {
              profileId: current.id,
              generation: current.privacyGeneration,
            }
          }
        }
        if (parsed.existingConsentReceiptDigest) {
          await tx.recommendationConsentReceipt.updateMany({
            where: { tokenDigest: parsed.existingConsentReceiptDigest },
            data: {
              tokenDigest: null,
              profileId: null,
              state: RecommendationConsentReceiptState.REVOKED,
              revokedAt: now,
              revokeReason: "behavioral_recommendations_retired",
            },
          })
        }
      })
    }
    return sessionOnly("clear", erasure, {
      choice: "undecided",
      expiresAt: null,
      cookieDisposition: "clear",
    })
  }

  async assertPublishableGeneration(
    _profileId: string,
    _privacyGeneration: number,
  ): Promise<void> {
    throw new RecommendationConflictError(
      "Behavioral recommendations have been retired",
    )
  }

  async completeErasure(input: {
    profileId: string
    privacyGeneration: number
  }): Promise<boolean> {
    const now = this.deps.now?.() ?? new Date()
    return this.transaction(async (tx) => {
      const profile = await tx.recommendationProfile.findUnique({
        where: { id: input.profileId },
      })
      if (
        !profile ||
        profile.state === RecommendationProfileState.ACTIVE ||
        profile.tokenDigest != null ||
        profile.privacyGeneration !== input.privacyGeneration
      ) {
        return false
      }
      await eraseProfileProjectionInfluence(tx, input)
      await suppressCowatchForProfiles(tx, [profile.id])
      await tx.recommendationProfileSessionLink.deleteMany({
        where: { profileId: profile.id },
      })
      await tx.recommendationConsentTransition.updateMany({
        where: { profileId: profile.id },
        data: {
          profileId: null,
          erasureState: RecommendationProfileErasureState.COMPLETED,
        },
      })
      await tx.recommendationProfile.update({
        where: { id: profile.id },
        data: {
          erasureState: RecommendationProfileErasureState.COMPLETED,
          erasureCompletedAt: now,
          erasureFailureCode: null,
        },
      })
      return true
    })
  }

  async runDeletionDrill(input: {
    profileId: string
    privacyGeneration: number
  }): Promise<void> {
    const [
      profile,
      linkedSessions,
      linkedTransitions,
      projectionGenerations,
      projectionPointers,
      projectionRuns,
    ] = await Promise.all([
      this.deps.prisma.recommendationProfile.findUnique({
        where: { id: input.profileId },
      }),
      this.deps.prisma.recommendationProfileSessionLink.count({
        where: { profileId: input.profileId },
      }),
      this.deps.prisma.recommendationConsentTransition.count({
        where: { profileId: input.profileId },
      }),
      this.deps.prisma.recommendationProfileProjectionGeneration.count({
        where: {
          profileId: input.profileId,
          privacyGeneration: input.privacyGeneration,
        },
      }),
      this.deps.prisma.recommendationProfileProjectionPointer.count({
        where: {
          profileId: input.profileId,
          privacyGeneration: input.privacyGeneration,
        },
      }),
      this.deps.prisma.recommendationProfileProjectionRun.count({
        where: {
          profileId: input.profileId,
          privacyGeneration: input.privacyGeneration,
        },
      }),
    ])
    if (
      !profile ||
      profile.privacyGeneration !== input.privacyGeneration ||
      profile.state === RecommendationProfileState.ACTIVE ||
      profile.tokenDigest != null ||
      profile.erasureState !== RecommendationProfileErasureState.COMPLETED ||
      linkedSessions !== 0 ||
      linkedTransitions !== 0 ||
      projectionGenerations !== 0 ||
      projectionPointers !== 0 ||
      projectionRuns !== 0
    ) {
      throw new RecommendationConflictError(
        "Recommendation profile deletion drill did not clear future influence",
      )
    }
    await this.deps.prisma.recommendationProfile.update({
      where: { id: profile.id },
      data: { deletionDrillAt: this.deps.now?.() ?? new Date() },
    })
  }

  private async fenceProfile(
    tx: Pick<
      PrismaClient,
      | "recommendationProfile"
      | "recommendationProfileSessionLink"
      | "recommendationConsentTransition"
      | "recommendationShadowRun"
      | "recommendationShadowNomination"
      | "recommendationExperimentAssignment"
      | "recommendationProfileProjectionGeneration"
      | "recommendationProfileProjectionPointer"
      | "recommendationProfileProjectionRun"
      | "recommendationViewingModeEvidence"
      | "$executeRaw"
    >,
    profile: ActiveProfile,
    reason: "reset" | "withdraw" | "delete" | "expire",
    now: Date,
  ) {
    const fenced = await tx.recommendationProfile.updateMany({
      where: {
        id: profile.id,
        privacyGeneration: profile.privacyGeneration,
        state: RecommendationProfileState.ACTIVE,
        tokenDigest: { not: null },
      },
      data: {
        tokenDigest: null,
        state:
          reason === "expire"
            ? RecommendationProfileState.EXPIRED
            : RecommendationProfileState.TOMBSTONED,
        tombstonedAt: now,
        tombstoneReason: reason,
        erasureState: RecommendationProfileErasureState.PENDING,
        erasureRequestedAt: now,
      },
    })
    if (fenced.count !== 1) {
      throw new RecommendationConflictError(
        "The recommendation profile generation was already fenced",
      )
    }
    await eraseProfileProjectionInfluence(tx, {
      profileId: profile.id,
      privacyGeneration: profile.privacyGeneration,
    })
    await suppressCowatchForProfiles(tx, [profile.id])
    await tx.recommendationProfileSessionLink.deleteMany({
      where: { profileId: profile.id },
    })
    await redactShadowRunsForProfileGeneration(tx, {
      profileId: profile.id,
      privacyGeneration: profile.privacyGeneration,
      now,
    })
    await tx.recommendationExperimentAssignment.updateMany({
      where: {
        profileId: profile.id,
        privacyGeneration: profile.privacyGeneration,
        state: RecommendationExperimentAssignmentState.ACTIVE,
      },
      data: {
        state: RecommendationExperimentAssignmentState.FENCED,
        fencedAt: now,
        fenceReason: `profile_${reason}`,
      },
    })
    await tx.recommendationConsentTransition.updateMany({
      where: { profileId: profile.id },
      data: { profileId: null },
    })
  }

  private async lockProfileAuthority(
    tx: Prisma.TransactionClient,
    profileId: string,
  ): Promise<void> {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`recommendation-profile-authority:${profileId}`}, 378)
      )
    `
  }

  private async resolveTransitionAuthority(
    tx: Prisma.TransactionClient,
    input: TransitionAuthorityInput,
    now: Date,
  ): Promise<{ profileId: string | null; active: ActiveProfile | null }> {
    const [current, consent, sessionLink] = await Promise.all([
      input.existingProfileDigest
        ? tx.recommendationProfile.findUnique({
            where: { tokenDigest: input.existingProfileDigest },
          })
        : null,
      (input.action === "withdraw" || input.action === "delete") &&
      input.existingConsentReceiptDigest
        ? tx.recommendationConsentReceipt.findUnique({
            where: { tokenDigest: input.existingConsentReceiptDigest },
          })
        : null,
      tx.recommendationProfileSessionLink.findFirst({
        where: {
          sessionDigest: input.sessionDigest,
          expiresAt: { gt: now },
        },
        orderBy: [{ linkedAt: "desc" }, { id: "desc" }],
        include: { profile: true },
      }),
    ])
    const linkedConsent =
      consent?.state === RecommendationConsentReceiptState.ACTIVE &&
      consent.choice === RecommendationConsentChoice.PERSONALIZATION &&
      consent.contractVersion === RECOMMENDATION_CONSENT_CONTRACT &&
      consent.tokenDigest != null &&
      consent.profileId != null &&
      consent.expiresAt > now
        ? consent
        : null
    const receiptProfile = linkedConsent
      ? await tx.recommendationProfile.findUnique({
          where: { id: linkedConsent.profileId! },
        })
      : null
    if (
      linkedConsent &&
      (!receiptProfile ||
        receiptProfile.state !== RecommendationProfileState.ACTIVE ||
        receiptProfile.tokenDigest == null ||
        receiptProfile.expiresAt <= now ||
        receiptProfile.privacyGeneration !== linkedConsent.privacyGeneration)
    ) {
      throw new RecommendationConflictError(
        "The active recommendation consent profile generation is unavailable",
      )
    }
    const sessionProfile =
      sessionLink &&
      sessionLink.profile.state === RecommendationProfileState.ACTIVE &&
      sessionLink.profile.tokenDigest != null &&
      sessionLink.profile.expiresAt > now &&
      sessionLink.profile.privacyGeneration === sessionLink.privacyGeneration
        ? sessionLink.profile
        : null
    const authorities = [current, receiptProfile, sessionProfile].filter(
      (profile): profile is NonNullable<typeof profile> => profile != null,
    )
    const first = authorities[0] ?? null
    if (
      first &&
      authorities.some(
        (profile) =>
          profile.id !== first.id ||
          profile.privacyGeneration !== first.privacyGeneration,
      )
    ) {
      throw new RecommendationConflictError(
        "The recommendation consent, profile, and session identities do not match",
      )
    }
    const active =
      first?.state === RecommendationProfileState.ACTIVE &&
      first.tokenDigest != null &&
      first.expiresAt > now
        ? first
        : null
    return { profileId: first?.id ?? null, active }
  }
}

export function createRecommendationProfileService(
  prisma: PrismaClient = defaultPrisma,
) {
  return new RecommendationProfileService({ prisma })
}
