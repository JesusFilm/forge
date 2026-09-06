import { randomUUID } from "node:crypto"
import {
  Prisma,
  RecommendationConsentChoice,
  RecommendationConsentReceiptState,
  RecommendationConsentTransitionKind,
  RecommendationExperimentAssignmentState,
  RecommendationProfileChoice,
  RecommendationProfileErasureState,
  RecommendationProfileState,
  type PrismaClient,
} from "@prisma/client"
import { z } from "zod"
import type { Principal } from "@/auth/principal"
import { prisma as defaultPrisma } from "@/db/client"
import { assertWebRecommendationCaller } from "./caller"
import {
  RECOMMENDATION_PROFILE_CONTRACT,
  RECOMMENDATION_PROFILE_SESSION_LINK_HOURS,
} from "./contracts"
import { RecommendationConflictError, RecommendationInputError } from "./errors"
import { redactShadowRunsForProfileGeneration } from "./shadow-evaluation/service"
import { eraseProfileProjectionInfluence } from "./profiles/privacy"

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

function daysAfter(now: Date, days: number) {
  return new Date(now.getTime() + days * 86_400_000)
}

function hoursAfter(now: Date, hours: number) {
  return new Date(now.getTime() + hours * 3_600_000)
}

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

function activeReceipt(
  profile: ActiveProfile,
  cookieDisposition: "keep" | "set",
  erasure?: { profileId: string; generation: number },
  consent: {
    expiresAt: Date | null
    cookieDisposition: RecommendationProfileReceipt["consentCookieDisposition"]
  } = { expiresAt: null, cookieDisposition: "keep" },
): RecommendationProfileReceipt {
  return {
    state: "active",
    choice: "durable_allowed",
    privacyGeneration: profile.privacyGeneration,
    expiresAt: profile.expiresAt.toISOString(),
    erasureState: erasure ? "pending" : "not_required",
    cookieDisposition,
    consentChoice: consent.expiresAt ? "personalization" : "undecided",
    consentContractVersion: RECOMMENDATION_CONSENT_CONTRACT,
    consentExpiresAt: consent.expiresAt?.toISOString() ?? null,
    consentCookieDisposition: consent.cookieDisposition,
    profileId: erasure?.profileId ?? profile.id,
    erasureGeneration: erasure?.generation ?? null,
  }
}

/**
 * Consent/profile control plane. No method is called by recommendation
 * delivery or player startup. Candidate projection consumers must call
 * assertPublishableGeneration immediately before atomic publication.
 */
export class RecommendationProfileService {
  constructor(private readonly deps: ProfileDependencies) {}

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
    const now = this.deps.now?.() ?? new Date()
    if (!input.consentReceiptDigest) return sessionOnly("clear")
    const consent =
      await this.deps.prisma.recommendationConsentReceipt.findUnique({
        where: { tokenDigest: input.consentReceiptDigest },
      })
    if (
      !consent ||
      consent.state !== RecommendationConsentReceiptState.ACTIVE ||
      consent.tokenDigest == null ||
      consent.contractVersion !== RECOMMENDATION_CONSENT_CONTRACT ||
      consent.expiresAt <= now
    ) {
      if (consent?.state === RecommendationConsentReceiptState.ACTIVE) {
        await this.deps.prisma.recommendationConsentReceipt.updateMany({
          where: {
            id: consent.id,
            state: RecommendationConsentReceiptState.ACTIVE,
          },
          data: {
            tokenDigest: null,
            profileId: null,
            state: RecommendationConsentReceiptState.EXPIRED,
            revokedAt: now,
            revokeReason: "expired_or_contract_stale",
          },
        })
      }
      return sessionOnly("clear", undefined, {
        choice: "undecided",
        expiresAt: null,
        cookieDisposition: "clear",
      })
    }
    if (consent.choice === RecommendationConsentChoice.ESSENTIAL_ONLY) {
      return sessionOnly("clear", undefined, {
        choice: "essential_only",
        expiresAt: consent.expiresAt,
        cookieDisposition: "keep",
      })
    }
    if (!input.profileDigest) {
      await this.revokeConsentReceipt(
        consent.id,
        "missing_profile_receipt",
        now,
      )
      return sessionOnly("clear", undefined, {
        choice: "undecided",
        expiresAt: null,
        cookieDisposition: "clear",
      })
    }
    const profile = await this.deps.prisma.recommendationProfile.findUnique({
      where: { tokenDigest: input.profileDigest },
    })
    if (
      !profile ||
      consent.profileId !== profile.id ||
      consent.privacyGeneration !== profile.privacyGeneration ||
      profile.state !== RecommendationProfileState.ACTIVE ||
      profile.tokenDigest == null
    ) {
      await this.revokeConsentReceipt(
        consent.id,
        "profile_generation_mismatch",
        now,
      )
      return sessionOnly("clear", undefined, {
        choice: "undecided",
        expiresAt: null,
        cookieDisposition: "clear",
      })
    }
    return this.deps.prisma.$transaction(async (tx) => {
      await this.lockProfileAuthority(tx, profile.id)
      const [lockedProfile, lockedConsent] = await Promise.all([
        tx.recommendationProfile.findUnique({ where: { id: profile.id } }),
        tx.recommendationConsentReceipt.findUnique({
          where: { id: consent.id },
        }),
      ])
      if (
        !lockedProfile ||
        lockedProfile.state !== RecommendationProfileState.ACTIVE ||
        lockedProfile.tokenDigest == null ||
        lockedProfile.tokenDigest !== input.profileDigest ||
        !lockedConsent ||
        lockedConsent.state !== RecommendationConsentReceiptState.ACTIVE ||
        lockedConsent.tokenDigest == null ||
        lockedConsent.profileId !== lockedProfile.id ||
        lockedConsent.privacyGeneration !== lockedProfile.privacyGeneration ||
        lockedConsent.expiresAt <= now
      ) {
        await this.revokeConsentReceipt(
          consent.id,
          "profile_generation_mismatch",
          now,
          tx,
        )
        return sessionOnly("clear", undefined, {
          choice: "undecided",
          expiresAt: null,
          cookieDisposition: "clear",
        })
      }
      if (lockedProfile.expiresAt <= now) {
        await this.fenceProfile(tx, lockedProfile, "expire", now)
        await tx.recommendationConsentReceipt.updateMany({
          where: {
            id: lockedConsent.id,
            state: RecommendationConsentReceiptState.ACTIVE,
          },
          data: {
            tokenDigest: null,
            profileId: null,
            state: RecommendationConsentReceiptState.EXPIRED,
            revokedAt: now,
            revokeReason: "profile_expired",
          },
        })
        await tx.recommendationConsentTransition.create({
          data: {
            auditId: this.deps.newAuditId?.() ?? randomUUID(),
            profileId: lockedProfile.id,
            kind: RecommendationConsentTransitionKind.EXPIRE,
            fromGeneration: lockedProfile.privacyGeneration,
            toGeneration: null,
            erasureState: RecommendationProfileErasureState.PENDING,
            occurredAt: now,
            expiresAt: daysAfter(now, RECOMMENDATION_PROFILE_AUDIT_DAYS),
          },
        })
        return sessionOnly(
          "clear",
          {
            profileId: lockedProfile.id,
            generation: lockedProfile.privacyGeneration,
          },
          {
            choice: "undecided",
            expiresAt: null,
            cookieDisposition: "clear",
          },
        )
      }
      await this.linkSession(tx, lockedProfile, input.sessionDigest, now)
      return activeReceipt(lockedProfile, "keep", undefined, {
        expiresAt: lockedConsent.expiresAt,
        cookieDisposition: "keep",
      })
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
    if (
      parsed.proposedProfileDigest != null &&
      parsed.proposedProfileDigest === parsed.existingProfileDigest
    ) {
      throw new RecommendationInputError(
        "A proposed recommendation profile identity must be freshly generated",
      )
    }
    if (
      parsed.consentChoice != null &&
      (parsed.consentContractVersion !== RECOMMENDATION_CONSENT_CONTRACT ||
        parsed.proposedConsentReceiptDigest == null ||
        parsed.proposedConsentReceiptDigest ===
          parsed.existingConsentReceiptDigest ||
        (parsed.action === "grant" &&
          parsed.consentChoice !== "personalization") ||
        ((parsed.action === "withdraw" || parsed.action === "delete") &&
          parsed.consentChoice !== "essential_only") ||
        (parsed.action === "reset" &&
          parsed.consentChoice !== "personalization"))
    ) {
      throw new RecommendationInputError(
        "The recommendation consent transition is invalid",
      )
    }
    const now = this.deps.now?.() ?? new Date()
    return this.deps.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`recommendation-profile:${parsed.sessionDigest}`}, 378)
        )
      `
      let authority = await this.resolveTransitionAuthority(tx, parsed, now)
      const lockedProfileId = authority.profileId
      if (lockedProfileId) {
        await this.lockProfileAuthority(tx, lockedProfileId)
        authority = await this.resolveTransitionAuthority(tx, parsed, now)
        if (
          authority.profileId != null &&
          authority.profileId !== lockedProfileId
        ) {
          throw new RecommendationConflictError(
            "The recommendation profile authority changed during the transition",
          )
        }
      }
      const active = authority.active

      const commitConsent = async (
        receipt: RecommendationProfileReceipt,
        profile: ActiveProfile | null,
      ): Promise<RecommendationProfileReceipt> => {
        if (parsed.consentChoice == null) return receipt
        if (profile) {
          await tx.recommendationConsentReceipt.updateMany({
            where: {
              profileId: profile.id,
              privacyGeneration: profile.privacyGeneration,
              state: RecommendationConsentReceiptState.ACTIVE,
            },
            data: {
              tokenDigest: null,
              profileId: null,
              state: RecommendationConsentReceiptState.REVOKED,
              revokedAt: now,
              revokeReason: "receipt_replaced",
            },
          })
        }
        if (parsed.existingConsentReceiptDigest) {
          await tx.recommendationConsentReceipt.updateMany({
            where: {
              tokenDigest: parsed.existingConsentReceiptDigest,
              state: RecommendationConsentReceiptState.ACTIVE,
            },
            data: {
              tokenDigest: null,
              profileId: null,
              state: RecommendationConsentReceiptState.REVOKED,
              revokedAt: now,
              revokeReason: `choice_${parsed.consentChoice}`,
            },
          })
        }
        const expiresAt = daysAfter(now, RECOMMENDATION_PROFILE_DAYS)
        await tx.recommendationConsentReceipt.create({
          data: {
            tokenDigest: parsed.proposedConsentReceiptDigest!,
            contractVersion: RECOMMENDATION_CONSENT_CONTRACT,
            choice:
              parsed.consentChoice === "personalization"
                ? RecommendationConsentChoice.PERSONALIZATION
                : RecommendationConsentChoice.ESSENTIAL_ONLY,
            state: RecommendationConsentReceiptState.ACTIVE,
            profileId: profile?.id ?? null,
            privacyGeneration: profile?.privacyGeneration ?? 0,
            expiresAt,
          },
        })
        return {
          ...receipt,
          consentChoice: parsed.consentChoice,
          consentExpiresAt: expiresAt.toISOString(),
          consentCookieDisposition: "set",
        }
      }

      if (parsed.action === "grant") {
        if (active) {
          await this.linkSession(tx, active, parsed.sessionDigest, now)
          return commitConsent(activeReceipt(active, "keep"), active)
        }
        if (!parsed.proposedProfileDigest) {
          throw new RecommendationInputError(
            "A fresh recommendation profile identity is required",
          )
        }
        const created = await tx.recommendationProfile.create({
          data: {
            id: this.deps.newId?.() ?? randomUUID(),
            tokenDigest: parsed.proposedProfileDigest,
            privacyGeneration: 1,
            choice: RecommendationProfileChoice.DURABLE_ALLOWED,
            state: RecommendationProfileState.ACTIVE,
            purpose: "personalization",
            expiresAt: daysAfter(now, RECOMMENDATION_PROFILE_DAYS),
            erasureState: RecommendationProfileErasureState.NOT_REQUIRED,
          },
        })
        await this.linkSession(tx, created, parsed.sessionDigest, now)
        await tx.recommendationConsentTransition.create({
          data: {
            auditId: this.deps.newAuditId?.() ?? randomUUID(),
            profileId: created.id,
            kind: RecommendationConsentTransitionKind.GRANT,
            fromGeneration: null,
            toGeneration: 1,
            choice: RecommendationProfileChoice.DURABLE_ALLOWED,
            occurredAt: now,
            expiresAt: daysAfter(now, RECOMMENDATION_PROFILE_AUDIT_DAYS),
          },
        })
        return commitConsent(activeReceipt(created, "set"), created)
      }

      if (!active) {
        if (parsed.action === "withdraw" || parsed.action === "delete") {
          return commitConsent(sessionOnly("clear"), null)
        }
        throw new RecommendationConflictError(
          "The active recommendation profile identity is unavailable",
        )
      }

      if (parsed.action === "reset") {
        if (!parsed.proposedProfileDigest) {
          throw new RecommendationInputError(
            "A fresh recommendation profile identity is required",
          )
        }
        const oldGeneration = active.privacyGeneration
        await this.fenceProfile(tx, active, "reset", now)
        const created = await tx.recommendationProfile.create({
          data: {
            id: this.deps.newId?.() ?? randomUUID(),
            tokenDigest: parsed.proposedProfileDigest,
            privacyGeneration: oldGeneration + 1,
            choice: RecommendationProfileChoice.DURABLE_ALLOWED,
            state: RecommendationProfileState.ACTIVE,
            purpose: "personalization",
            expiresAt: daysAfter(now, RECOMMENDATION_PROFILE_DAYS),
            erasureState: RecommendationProfileErasureState.NOT_REQUIRED,
          },
        })
        await this.linkSession(tx, created, parsed.sessionDigest, now)
        await tx.recommendationConsentTransition.create({
          data: {
            auditId: this.deps.newAuditId?.() ?? randomUUID(),
            profileId: active.id,
            kind: RecommendationConsentTransitionKind.RESET,
            fromGeneration: oldGeneration,
            toGeneration: oldGeneration + 1,
            choice: RecommendationProfileChoice.DURABLE_ALLOWED,
            erasureState: RecommendationProfileErasureState.PENDING,
            occurredAt: now,
            expiresAt: daysAfter(now, RECOMMENDATION_PROFILE_AUDIT_DAYS),
          },
        })
        return commitConsent(
          activeReceipt(created, "set", {
            profileId: active.id,
            generation: oldGeneration,
          }),
          created,
        )
      }

      const generation = active.privacyGeneration
      await this.fenceProfile(tx, active, parsed.action, now)
      await tx.recommendationConsentTransition.create({
        data: {
          auditId: this.deps.newAuditId?.() ?? randomUUID(),
          profileId: active.id,
          kind:
            parsed.action === "withdraw"
              ? RecommendationConsentTransitionKind.WITHDRAW
              : RecommendationConsentTransitionKind.DELETE,
          fromGeneration: generation,
          toGeneration: null,
          choice: null,
          erasureState: RecommendationProfileErasureState.PENDING,
          occurredAt: now,
          expiresAt: daysAfter(now, RECOMMENDATION_PROFILE_AUDIT_DAYS),
        },
      })
      return commitConsent(
        sessionOnly("clear", {
          profileId: active.id,
          generation,
        }),
        null,
      )
    })
  }

  async assertPublishableGeneration(
    profileId: string,
    privacyGeneration: number,
  ): Promise<void> {
    if (
      !profileId ||
      !Number.isInteger(privacyGeneration) ||
      privacyGeneration < 1
    ) {
      throw new RecommendationInputError(
        "Recommendation profile generation fence is invalid",
      )
    }
    const now = this.deps.now?.() ?? new Date()
    const profile = await this.deps.prisma.recommendationProfile.findUnique({
      where: { id: profileId },
    })
    if (
      profile?.state === RecommendationProfileState.ACTIVE &&
      profile.tokenDigest != null &&
      profile.privacyGeneration === privacyGeneration &&
      profile.expiresAt > now
    ) {
      return
    }
    await this.deps.prisma.recommendationProfile
      .updateMany({
        where: { id: profileId },
        data: { staleWorkerRejections: { increment: 1 } },
      })
      .catch(() => undefined)
    throw new RecommendationConflictError(
      "Recommendation profile generation is stale or revoked",
    )
  }

  async completeErasure(input: {
    profileId: string
    privacyGeneration: number
  }): Promise<boolean> {
    const now = this.deps.now?.() ?? new Date()
    return this.deps.prisma.$transaction(async (tx) => {
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

  private async revokeConsentReceipt(
    id: string,
    reason: string,
    now: Date,
    client: Pick<PrismaClient, "recommendationConsentReceipt"> = this.deps
      .prisma,
  ): Promise<void> {
    await client.recommendationConsentReceipt.updateMany({
      where: { id, state: RecommendationConsentReceiptState.ACTIVE },
      data: {
        tokenDigest: null,
        profileId: null,
        state: RecommendationConsentReceiptState.REVOKED,
        revokedAt: now,
        revokeReason: reason,
      },
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

  private async linkSession(
    client: Pick<PrismaClient, "recommendationProfileSessionLink">,
    profile: ActiveProfile,
    sessionDigest: string,
    now: Date,
  ) {
    const expiresAt = new Date(
      Math.min(
        profile.expiresAt.getTime(),
        hoursAfter(now, RECOMMENDATION_PROFILE_SESSION_LINK_HOURS).getTime(),
      ),
    )
    await client.recommendationProfileSessionLink.upsert({
      where: {
        profileId_privacyGeneration_sessionDigest: {
          profileId: profile.id,
          privacyGeneration: profile.privacyGeneration,
          sessionDigest,
        },
      },
      create: {
        profileId: profile.id,
        privacyGeneration: profile.privacyGeneration,
        sessionDigest,
        linkedAt: now,
        expiresAt,
      },
      update: { expiresAt },
    })
  }
}

export function createRecommendationProfileService(
  prisma: PrismaClient = defaultPrisma,
) {
  return new RecommendationProfileService({ prisma })
}
