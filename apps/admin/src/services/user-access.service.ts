import { randomUUID } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { hasPermission } from "@/auth/permissions"
import { prisma as defaultPrisma } from "@/db/client"
import { ForbiddenError, NotFoundError } from "@/services/errors"

export type AdminAssignableRole = "EDITOR" | "ADMIN"

export type ReviewerRubricDimension =
  | "MEANING_ACCURACY"
  | "NATURALNESS"
  | "TIMING_READABILITY"
  | "SCRIPTURE_THEOLOGY"

type UserAccessTransactionStore = {
  user: Pick<PrismaClient["user"], "findUnique" | "update">
  managerMembership: Pick<
    PrismaClient["managerMembership"],
    "findUnique" | "upsert" | "updateMany"
  >
  language: Pick<PrismaClient["language"], "findUnique">
  managerReviewerLanguageGrant: Pick<
    PrismaClient["managerReviewerLanguageGrant"],
    "findUnique" | "upsert" | "updateMany"
  >
  managerAccessAuditEvent: Pick<
    PrismaClient["managerAccessAuditEvent"],
    "create"
  >
}

export type UserAccessStore = UserAccessTransactionStore & {
  $transaction<T>(
    callback: (tx: UserAccessTransactionStore) => Promise<T>,
  ): Promise<T>
}

async function assertCurrentAdmin(
  prisma: UserAccessTransactionStore,
  user: Principal | null,
) {
  if (!hasPermission(user, "admin:all") || !user?.id) {
    throw new ForbiddenError()
  }

  const currentUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { role: true },
  })
  if (currentUser?.role !== "ADMIN") {
    throw new ForbiddenError()
  }
}

async function assertTargetUserExists(
  prisma: UserAccessTransactionStore,
  userId: string,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  })

  if (!user) {
    throw new NotFoundError("User", userId)
  }
}

export async function approveUserRole(
  {
    user,
    targetUserId,
    role,
  }: {
    user: Principal | null
    targetUserId: string
    role: AdminAssignableRole
  },
  prisma: UserAccessStore = defaultPrisma,
) {
  await assertCurrentAdmin(prisma, user)

  return prisma.user.update({
    where: { id: targetUserId },
    data: { role },
    select: { id: true },
  })
}

export async function grantManagerAccess(
  {
    user,
    targetUserId,
  }: {
    user: Principal | null
    targetUserId: string
  },
  prisma: UserAccessStore = defaultPrisma,
) {
  return prisma.$transaction(async (tx) => {
    await assertCurrentAdmin(tx, user)
    await assertTargetUserExists(tx, targetUserId)
    const requestId = randomUUID()

    const existingMembership = await tx.managerMembership.findUnique({
      where: { userId: targetUserId },
      select: { id: true, role: true, revokedAt: true },
    })
    if (
      existingMembership?.role === "REVIEWER" &&
      !existingMembership.revokedAt
    ) {
      throw new ForbiddenError(
        "Revoke reviewer access before granting Manager operator access.",
      )
    }
    if (
      existingMembership?.role === "REVIEWER" &&
      existingMembership.revokedAt
    ) {
      const revokedGrants = await tx.managerReviewerLanguageGrant.updateMany({
        where: {
          managerMembershipId: existingMembership.id,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
          revokedById: user!.id!,
          revocationReason: "Manager role changed from reviewer to operator.",
        },
      })
      await tx.managerAccessAuditEvent.create({
        data: {
          eventType: "reviewer_language_grants_revoked_for_operator_conversion",
          actorId: user!.id!,
          targetUserId,
          managerMembershipId: existingMembership.id,
          requestId,
          reason: "Manager role changed from reviewer to operator.",
          metadata: { revokedGrantCount: revokedGrants.count },
        },
        select: { id: true },
      })
    }

    const membership = await tx.managerMembership.upsert({
      where: { userId: targetUserId },
      create: {
        userId: targetUserId,
        role: "OPERATOR",
      },
      update: {
        role: "OPERATOR",
        revokedAt: null,
      },
      select: { id: true },
    })
    await tx.managerAccessAuditEvent.create({
      data: {
        eventType: "manager_operator_access_granted",
        actorId: user!.id!,
        targetUserId,
        managerMembershipId: membership.id,
        requestId,
        reason: "Manager operator access granted via Admin user access.",
        metadata: { role: "OPERATOR" },
      },
      select: { id: true },
    })
    return membership
  })
}

export async function revokeManagerAccess(
  {
    user,
    targetUserId,
  }: {
    user: Principal | null
    targetUserId: string
  },
  prisma: UserAccessStore = defaultPrisma,
) {
  return prisma.$transaction(async (tx) => {
    await assertCurrentAdmin(tx, user)
    await assertTargetUserExists(tx, targetUserId)
    const membership = await tx.managerMembership.findUnique({
      where: { userId: targetUserId },
      select: { id: true, revokedAt: true, role: true },
    })
    if (!membership || membership.revokedAt) return { count: 0 }

    const revokedAt = new Date()
    const requestId = randomUUID()
    const result = await tx.managerMembership.updateMany({
      where: {
        id: membership.id,
        revokedAt: null,
      },
      data: {
        revokedAt,
      },
    })
    if (result.count > 0) {
      if (membership.role === "REVIEWER") {
        const revokedGrants = await tx.managerReviewerLanguageGrant.updateMany({
          where: {
            managerMembershipId: membership.id,
            revokedAt: null,
          },
          data: {
            revokedAt,
            revokedById: user!.id!,
            revocationReason:
              "Manager membership revoked via Admin user access.",
          },
        })
        await tx.managerAccessAuditEvent.create({
          data: {
            eventType: "reviewer_language_grants_revoked_with_membership",
            actorId: user!.id!,
            targetUserId,
            managerMembershipId: membership.id,
            requestId,
            reason: "Manager membership revoked via Admin user access.",
            metadata: { revokedGrantCount: revokedGrants.count },
          },
          select: { id: true },
        })
      }
      await tx.managerAccessAuditEvent.create({
        data: {
          eventType: "manager_access_revoked",
          actorId: user!.id!,
          targetUserId,
          managerMembershipId: membership.id,
          requestId,
          reason: "Manager access revoked via Admin user access.",
          metadata: { role: membership.role },
        },
        select: { id: true },
      })
    }
    return result
  })
}

export async function grantReviewerLanguageAccess(
  {
    user,
    targetUserId,
    languageId,
    targetProficiencyEvidence,
    sourceProficiencyEvidence,
    permittedRubricDimensions,
    scriptureSpecialist = false,
    theologySpecialist = false,
    reason,
    requestId,
  }: {
    user: Principal | null
    targetUserId: string
    languageId: string
    targetProficiencyEvidence: string
    sourceProficiencyEvidence?: string
    permittedRubricDimensions: ReviewerRubricDimension[]
    scriptureSpecialist?: boolean
    theologySpecialist?: boolean
    reason: string
    requestId?: string
  },
  prisma: UserAccessStore = defaultPrisma,
) {
  return prisma.$transaction(async (tx) => {
    await assertCurrentAdmin(tx, user)
    validateReviewerGrantInput({
      targetProficiencyEvidence,
      sourceProficiencyEvidence,
      permittedRubricDimensions,
      scriptureSpecialist,
      theologySpecialist,
      reason,
      requestId,
    })
    await assertTargetUserExists(tx, targetUserId)

    const language = await tx.language.findUnique({
      where: { id: languageId },
      select: { id: true, slug: true, deletedAt: true },
    })
    if (!language || language.deletedAt || !language.slug?.trim()) {
      throw new NotFoundError("Language", languageId)
    }

    const existingMembership = await tx.managerMembership.findUnique({
      where: { userId: targetUserId },
      select: { id: true, role: true, revokedAt: true },
    })
    if (
      existingMembership?.role === "OPERATOR" &&
      !existingMembership.revokedAt
    ) {
      throw new ForbiddenError(
        "An active Manager operator cannot be converted into a reviewer grant.",
      )
    }

    const membership = await tx.managerMembership.upsert({
      where: { userId: targetUserId },
      create: { userId: targetUserId, role: "REVIEWER" },
      update: { role: "REVIEWER", revokedAt: null },
      select: { id: true },
    })
    const existingGrant = await tx.managerReviewerLanguageGrant.findUnique({
      where: {
        managerMembershipId_languageId: {
          managerMembershipId: membership.id,
          languageId,
        },
      },
      select: { id: true, qualificationVersion: true },
    })
    const grant = await tx.managerReviewerLanguageGrant.upsert({
      where: {
        managerMembershipId_languageId: {
          managerMembershipId: membership.id,
          languageId,
        },
      },
      create: {
        managerMembershipId: membership.id,
        languageId,
        targetProficiencyEvidence: targetProficiencyEvidence.trim(),
        sourceProficiencyEvidence: sourceProficiencyEvidence?.trim() || null,
        permittedRubricDimensions: Array.from(
          new Set(permittedRubricDimensions),
        ),
        scriptureSpecialist,
        theologySpecialist,
        grantedById: user!.id!,
        grantReason: reason.trim(),
      },
      update: {
        targetProficiencyEvidence: targetProficiencyEvidence.trim(),
        sourceProficiencyEvidence: sourceProficiencyEvidence?.trim() || null,
        permittedRubricDimensions: Array.from(
          new Set(permittedRubricDimensions),
        ),
        scriptureSpecialist,
        theologySpecialist,
        qualificationVersion: { increment: 1 },
        grantedById: user!.id!,
        grantReason: reason.trim(),
        revokedById: null,
        revocationReason: null,
        revokedAt: null,
      },
      select: { id: true, qualificationVersion: true },
    })
    await tx.managerAccessAuditEvent.create({
      data: {
        eventType: existingGrant
          ? "reviewer_language_grant_updated"
          : "reviewer_language_grant_created",
        actorId: user!.id!,
        targetUserId,
        managerMembershipId: membership.id,
        languageId,
        requestId: requestId?.trim() || randomUUID(),
        reason: reason.trim(),
        metadata: {
          languageSlug: language.slug,
          qualificationVersion: grant.qualificationVersion,
          permittedRubricDimensions: Array.from(
            new Set(permittedRubricDimensions),
          ),
          specialistCapabilities: {
            scripture: scriptureSpecialist,
            theology: theologySpecialist,
          },
        },
      },
      select: { id: true },
    })

    return {
      id: grant.id,
      managerMembershipId: membership.id,
      languageId: language.id,
      languageSlug: language.slug,
      qualificationVersion: grant.qualificationVersion,
    }
  })
}

export async function revokeReviewerLanguageAccess(
  {
    user,
    targetUserId,
    languageId,
    reason,
    requestId,
  }: {
    user: Principal | null
    targetUserId: string
    languageId: string
    reason: string
    requestId?: string
  },
  prisma: UserAccessStore = defaultPrisma,
) {
  return prisma.$transaction(async (tx) => {
    await assertCurrentAdmin(tx, user)
    validateBoundedText(reason, "reason", 1, 500)
    if (requestId) validateBoundedText(requestId, "requestId", 1, 200)
    await assertTargetUserExists(tx, targetUserId)
    const membership = await tx.managerMembership.findUnique({
      where: { userId: targetUserId },
      select: { id: true, role: true, revokedAt: true },
    })
    if (!membership || membership.role !== "REVIEWER") return { count: 0 }

    const result = await tx.managerReviewerLanguageGrant.updateMany({
      where: {
        managerMembershipId: membership.id,
        languageId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
        revokedById: user!.id!,
        revocationReason: reason.trim(),
      },
    })
    if (result.count > 0) {
      await tx.managerAccessAuditEvent.create({
        data: {
          eventType: "reviewer_language_grant_revoked",
          actorId: user!.id!,
          targetUserId,
          managerMembershipId: membership.id,
          languageId,
          requestId: requestId?.trim() || randomUUID(),
          reason: reason.trim(),
          metadata: {},
        },
        select: { id: true },
      })
    }
    return result
  })
}

function validateReviewerGrantInput({
  targetProficiencyEvidence,
  sourceProficiencyEvidence,
  permittedRubricDimensions,
  scriptureSpecialist,
  theologySpecialist,
  reason,
  requestId,
}: {
  targetProficiencyEvidence: string
  sourceProficiencyEvidence?: string
  permittedRubricDimensions: ReviewerRubricDimension[]
  scriptureSpecialist: boolean
  theologySpecialist: boolean
  reason: string
  requestId?: string
}) {
  validateBoundedText(
    targetProficiencyEvidence,
    "targetProficiencyEvidence",
    1,
    2_000,
  )
  if (sourceProficiencyEvidence) {
    validateBoundedText(
      sourceProficiencyEvidence,
      "sourceProficiencyEvidence",
      1,
      2_000,
    )
  }
  validateBoundedText(reason, "reason", 1, 500)
  if (requestId) validateBoundedText(requestId, "requestId", 1, 200)
  const uniqueDimensions = new Set(permittedRubricDimensions)
  if (
    uniqueDimensions.size === 0 ||
    uniqueDimensions.size !== permittedRubricDimensions.length
  ) {
    throw new Error("permittedRubricDimensions must be non-empty and unique")
  }
  if (
    uniqueDimensions.has("SCRIPTURE_THEOLOGY") &&
    !scriptureSpecialist &&
    !theologySpecialist
  ) {
    throw new Error(
      "SCRIPTURE_THEOLOGY requires scripture or theology specialist qualification",
    )
  }
}

function validateBoundedText(
  value: string,
  field: string,
  minimum: number,
  maximum: number,
) {
  const length = value.trim().length
  if (length < minimum || length > maximum) {
    throw new Error(`${field} must be ${minimum}-${maximum} characters`)
  }
}
