import { describe, expect, it, vi } from "vitest"
import type { Principal } from "@/auth/principal"
import { ForbiddenError, NotFoundError } from "@/services/errors"
import {
  approveUserRole,
  grantManagerAccess,
  grantReviewerLanguageAccess,
  revokeManagerAccess,
  revokeReviewerLanguageAccess,
  type UserAccessStore,
} from "@/services/user-access.service"

const adminUser = {
  id: "admin-user-1",
  role: "ADMIN",
} as const satisfies Principal

const editorUser = {
  id: "editor-user-1",
  role: "EDITOR",
} as const satisfies Principal

function makeMockPrisma() {
  const prisma = {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    managerMembership: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
    language: {
      findUnique: vi.fn(),
    },
    managerReviewerLanguageGrant: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
    managerAccessAuditEvent: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  }
  prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof prisma) => Promise<unknown>) =>
      callback(prisma),
  )
  return prisma as typeof prisma & UserAccessStore
}

function mockCurrentAdmin(prisma: ReturnType<typeof makeMockPrisma>) {
  prisma.user.findUnique.mockResolvedValueOnce({ role: "ADMIN" })
}

describe("user-access.service", () => {
  it("approves an admin-local user role for Admin principals", async () => {
    const prisma = makeMockPrisma()
    mockCurrentAdmin(prisma)
    prisma.user.update.mockResolvedValueOnce({ id: "target-user-1" })

    await approveUserRole(
      {
        user: adminUser,
        targetUserId: "target-user-1",
        role: "EDITOR",
      },
      prisma,
    )

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "target-user-1" },
      data: { role: "EDITOR" },
      select: { id: true },
    })
  })

  it("rejects role approvals for non-Admin principals", async () => {
    const prisma = makeMockPrisma()

    await expect(
      approveUserRole(
        {
          user: editorUser,
          targetUserId: "target-user-1",
          role: "ADMIN",
        },
        prisma,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError)

    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it("grants Manager operator access by upserting an active membership", async () => {
    const prisma = makeMockPrisma()
    mockCurrentAdmin(prisma)
    prisma.user.findUnique.mockResolvedValueOnce({ id: "target-user-1" })
    prisma.managerMembership.upsert.mockResolvedValueOnce({
      id: "membership-1",
    })
    prisma.managerAccessAuditEvent.create.mockResolvedValueOnce({
      id: "audit-1",
    })

    await grantManagerAccess(
      {
        user: adminUser,
        targetUserId: "target-user-1",
      },
      prisma,
    )

    expect(prisma.user.findUnique).toHaveBeenNthCalledWith(1, {
      where: { id: "admin-user-1" },
      select: { role: true },
    })
    expect(prisma.user.findUnique).toHaveBeenNthCalledWith(2, {
      where: { id: "target-user-1" },
      select: { id: true },
    })
    expect(prisma.managerAccessAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: "manager_operator_access_granted",
        actorId: "admin-user-1",
        targetUserId: "target-user-1",
        managerMembershipId: "membership-1",
        requestId: expect.any(String),
      }),
      select: { id: true },
    })
    expect(prisma.managerMembership.upsert).toHaveBeenCalledWith({
      where: { userId: "target-user-1" },
      create: {
        userId: "target-user-1",
        role: "OPERATOR",
      },
      update: {
        role: "OPERATOR",
        revokedAt: null,
      },
      select: { id: true },
    })
  })

  it("rejects Manager grants for non-Admin principals before reading users", async () => {
    const prisma = makeMockPrisma()

    await expect(
      grantManagerAccess(
        {
          user: editorUser,
          targetUserId: "target-user-1",
        },
        prisma,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError)

    expect(prisma.user.findUnique).not.toHaveBeenCalled()
    expect(prisma.managerMembership.upsert).not.toHaveBeenCalled()
  })

  it("throws NotFoundError instead of writing when the Manager grant target user is missing", async () => {
    const prisma = makeMockPrisma()
    mockCurrentAdmin(prisma)
    prisma.user.findUnique.mockResolvedValueOnce(null)

    await expect(
      grantManagerAccess(
        {
          user: adminUser,
          targetUserId: "missing-user",
        },
        prisma,
      ),
    ).rejects.toBeInstanceOf(NotFoundError)

    expect(prisma.managerMembership.upsert).not.toHaveBeenCalled()
  })

  it("rejects Manager grants when a stale Admin session has been downgraded", async () => {
    const prisma = makeMockPrisma()
    prisma.user.findUnique.mockResolvedValueOnce({ role: "EDITOR" })

    await expect(
      grantManagerAccess(
        {
          user: adminUser,
          targetUserId: "target-user-1",
        },
        prisma,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError)

    expect(prisma.managerMembership.upsert).not.toHaveBeenCalled()
  })

  it("does not convert an active reviewer into an operator with latent grants", async () => {
    const prisma = makeMockPrisma()
    mockCurrentAdmin(prisma)
    prisma.user.findUnique.mockResolvedValueOnce({ id: "target-user-1" })
    prisma.managerMembership.findUnique.mockResolvedValueOnce({
      id: "membership-1",
      role: "REVIEWER",
      revokedAt: null,
    })

    await expect(
      grantManagerAccess(
        {
          user: adminUser,
          targetUserId: "target-user-1",
        },
        prisma,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError)

    expect(prisma.managerMembership.upsert).not.toHaveBeenCalled()
  })

  it("retires dormant reviewer grants before converting to operator", async () => {
    const prisma = makeMockPrisma()
    mockCurrentAdmin(prisma)
    prisma.user.findUnique.mockResolvedValueOnce({ id: "target-user-1" })
    prisma.managerMembership.findUnique.mockResolvedValueOnce({
      id: "membership-1",
      role: "REVIEWER",
      revokedAt: new Date("2026-08-01T00:00:00.000Z"),
    })
    prisma.managerReviewerLanguageGrant.updateMany.mockResolvedValueOnce({
      count: 2,
    })
    prisma.managerMembership.upsert.mockResolvedValueOnce({
      id: "membership-1",
    })
    prisma.managerAccessAuditEvent.create.mockResolvedValue({ id: "audit-1" })

    await grantManagerAccess(
      {
        user: adminUser,
        targetUserId: "target-user-1",
      },
      prisma,
    )

    expect(prisma.managerReviewerLanguageGrant.updateMany).toHaveBeenCalledWith(
      {
        where: {
          managerMembershipId: "membership-1",
          revokedAt: null,
        },
        data: {
          revokedAt: expect.any(Date),
          revokedById: "admin-user-1",
          revocationReason: "Manager role changed from reviewer to operator.",
        },
      },
    )
    expect(prisma.managerAccessAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: "reviewer_language_grants_revoked_for_operator_conversion",
        requestId: expect.any(String),
        metadata: { revokedGrantCount: 2 },
      }),
      select: { id: true },
    })
  })

  it("revokes only an active Manager membership", async () => {
    const prisma = makeMockPrisma()
    mockCurrentAdmin(prisma)
    prisma.user.findUnique.mockResolvedValueOnce({ id: "target-user-1" })
    prisma.managerMembership.findUnique.mockResolvedValueOnce({
      id: "membership-1",
      role: "OPERATOR",
      revokedAt: null,
    })
    prisma.managerMembership.updateMany.mockResolvedValueOnce({ count: 1 })
    prisma.managerAccessAuditEvent.create.mockResolvedValueOnce({
      id: "audit-1",
    })

    await revokeManagerAccess(
      {
        user: adminUser,
        targetUserId: "target-user-1",
      },
      prisma,
    )

    expect(prisma.managerMembership.updateMany).toHaveBeenCalledTimes(1)
    const arg = prisma.managerMembership.updateMany.mock.calls[0]![0]!
    expect(arg.where).toEqual({
      id: "membership-1",
      revokedAt: null,
    })
    expect(arg.data.revokedAt).toBeInstanceOf(Date)
    expect(prisma.managerAccessAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: "manager_access_revoked",
        actorId: "admin-user-1",
        targetUserId: "target-user-1",
        requestId: expect.any(String),
      }),
      select: { id: true },
    })
  })

  it("keeps already-revoked Manager membership revokes idempotent", async () => {
    const prisma = makeMockPrisma()
    mockCurrentAdmin(prisma)
    prisma.user.findUnique.mockResolvedValueOnce({ id: "target-user-1" })
    prisma.managerMembership.findUnique.mockResolvedValueOnce({
      id: "membership-1",
      role: "OPERATOR",
      revokedAt: new Date("2026-08-01T00:00:00.000Z"),
    })

    const result = await revokeManagerAccess(
      {
        user: adminUser,
        targetUserId: "target-user-1",
      },
      prisma,
    )

    expect(result).toEqual({ count: 0 })
    expect(prisma.managerMembership.updateMany).not.toHaveBeenCalled()
    expect(prisma.managerAccessAuditEvent.create).not.toHaveBeenCalled()
  })

  it("revokes every active language grant with a reviewer membership", async () => {
    const prisma = makeMockPrisma()
    mockCurrentAdmin(prisma)
    prisma.user.findUnique.mockResolvedValueOnce({ id: "target-user-1" })
    prisma.managerMembership.findUnique.mockResolvedValueOnce({
      id: "membership-1",
      role: "REVIEWER",
      revokedAt: null,
    })
    prisma.managerMembership.updateMany.mockResolvedValueOnce({ count: 1 })
    prisma.managerReviewerLanguageGrant.updateMany.mockResolvedValueOnce({
      count: 2,
    })
    prisma.managerAccessAuditEvent.create.mockResolvedValue({ id: "audit-1" })

    await expect(
      revokeManagerAccess(
        {
          user: adminUser,
          targetUserId: "target-user-1",
        },
        prisma,
      ),
    ).resolves.toEqual({ count: 1 })

    expect(prisma.managerReviewerLanguageGrant.updateMany).toHaveBeenCalledWith(
      {
        where: {
          managerMembershipId: "membership-1",
          revokedAt: null,
        },
        data: {
          revokedAt: expect.any(Date),
          revokedById: "admin-user-1",
          revocationReason: "Manager membership revoked via Admin user access.",
        },
      },
    )
    expect(prisma.managerAccessAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: "reviewer_language_grants_revoked_with_membership",
        actorId: "admin-user-1",
        targetUserId: "target-user-1",
        managerMembershipId: "membership-1",
        requestId: expect.any(String),
        metadata: { revokedGrantCount: 2 },
      }),
      select: { id: true },
    })
  })

  it("creates an exact-language reviewer grant and an actor-bound audit event", async () => {
    const prisma = makeMockPrisma()
    mockCurrentAdmin(prisma)
    prisma.user.findUnique.mockResolvedValueOnce({ id: "target-user-1" })
    prisma.language.findUnique.mockResolvedValueOnce({
      id: "language-es",
      slug: "spanish-latin-america",
      deletedAt: null,
    })
    prisma.managerMembership.findUnique.mockResolvedValueOnce(null)
    prisma.managerMembership.upsert.mockResolvedValueOnce({
      id: "membership-1",
    })
    prisma.managerReviewerLanguageGrant.findUnique.mockResolvedValueOnce(null)
    prisma.managerReviewerLanguageGrant.upsert.mockResolvedValueOnce({
      id: "grant-es",
      qualificationVersion: 1,
    })
    prisma.managerAccessAuditEvent.create.mockResolvedValueOnce({
      id: "audit-1",
    })

    await expect(
      grantReviewerLanguageAccess(
        {
          user: adminUser,
          targetUserId: "target-user-1",
          languageId: "language-es",
          targetProficiencyEvidence: "Native Spanish reviewer",
          sourceProficiencyEvidence: "Professional English fluency",
          permittedRubricDimensions: [
            "MEANING_ACCURACY",
            "NATURALNESS",
            "TIMING_READABILITY",
          ],
          reason: "Qualified by localization lead",
          requestId: "request-123",
        },
        prisma,
      ),
    ).resolves.toEqual({
      id: "grant-es",
      managerMembershipId: "membership-1",
      languageId: "language-es",
      languageSlug: "spanish-latin-america",
      qualificationVersion: 1,
    })

    expect(prisma.managerMembership.upsert).toHaveBeenCalledWith({
      where: { userId: "target-user-1" },
      create: { userId: "target-user-1", role: "REVIEWER" },
      update: { role: "REVIEWER", revokedAt: null },
      select: { id: true },
    })
    expect(prisma.managerReviewerLanguageGrant.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          managerMembershipId: "membership-1",
          languageId: "language-es",
          grantedById: "admin-user-1",
        }),
      }),
    )
    expect(prisma.managerAccessAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: "reviewer_language_grant_created",
        actorId: "admin-user-1",
        targetUserId: "target-user-1",
        languageId: "language-es",
        requestId: "request-123",
      }),
      select: { id: true },
    })
  })

  it("refuses to infer reviewer authority from BCP-47 or a missing stable slug", async () => {
    const prisma = makeMockPrisma()
    mockCurrentAdmin(prisma)
    prisma.user.findUnique.mockResolvedValueOnce({ id: "target-user-1" })
    prisma.language.findUnique.mockResolvedValueOnce({
      id: "language-es",
      slug: null,
      bcp47: "es-419",
      deletedAt: null,
    })

    await expect(
      grantReviewerLanguageAccess(
        {
          user: adminUser,
          targetUserId: "target-user-1",
          languageId: "language-es",
          targetProficiencyEvidence: "Native Spanish reviewer",
          permittedRubricDimensions: ["MEANING_ACCURACY"],
          reason: "Qualification pending stable identity",
        },
        prisma,
      ),
    ).rejects.toBeInstanceOf(NotFoundError)

    expect(prisma.managerMembership.upsert).not.toHaveBeenCalled()
  })

  it("revokes only the exact reviewer language grant and audits the actor", async () => {
    const prisma = makeMockPrisma()
    mockCurrentAdmin(prisma)
    prisma.user.findUnique.mockResolvedValueOnce({ id: "target-user-1" })
    prisma.managerMembership.findUnique.mockResolvedValueOnce({
      id: "membership-1",
      role: "REVIEWER",
      revokedAt: null,
    })
    prisma.managerReviewerLanguageGrant.updateMany.mockResolvedValueOnce({
      count: 1,
    })
    prisma.managerAccessAuditEvent.create.mockResolvedValueOnce({
      id: "audit-1",
    })

    await expect(
      revokeReviewerLanguageAccess(
        {
          user: adminUser,
          targetUserId: "target-user-1",
          languageId: "language-es",
          reason: "Qualification expired",
        },
        prisma,
      ),
    ).resolves.toEqual({ count: 1 })

    expect(prisma.managerReviewerLanguageGrant.updateMany).toHaveBeenCalledWith(
      {
        where: {
          managerMembershipId: "membership-1",
          languageId: "language-es",
          revokedAt: null,
        },
        data: expect.objectContaining({
          revokedById: "admin-user-1",
          revocationReason: "Qualification expired",
          revokedAt: expect.any(Date),
        }),
      },
    )
    expect(prisma.managerAccessAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: "reviewer_language_grant_revoked",
        actorId: "admin-user-1",
        languageId: "language-es",
      }),
      select: { id: true },
    })
  })

  it("rejects Manager revokes for non-Admin principals before reading users", async () => {
    const prisma = makeMockPrisma()

    await expect(
      revokeManagerAccess(
        {
          user: editorUser,
          targetUserId: "target-user-1",
        },
        prisma,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError)

    expect(prisma.user.findUnique).not.toHaveBeenCalled()
    expect(prisma.managerMembership.updateMany).not.toHaveBeenCalled()
  })
})
