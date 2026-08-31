import { describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"
import { RecommendationConflictError, RecommendationInputError } from "./errors"
import { RecommendationProfileService } from "./profile.service"

const webCaller = {
  id: "forge-web",
  role: "CONSUMER_BEARER" as const,
  rateLimitBucketKey: "forge-web",
}

function profileFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "profile-1",
    tokenDigest: "a".repeat(64),
    privacyGeneration: 1,
    choice: "DURABLE_ALLOWED",
    state: "ACTIVE",
    purpose: "personalization",
    expiresAt: new Date("2027-08-25T00:00:00.000Z"),
    tombstonedAt: null,
    tombstoneReason: null,
    erasureState: "NOT_REQUIRED",
    erasureRequestedAt: null,
    erasureCompletedAt: null,
    erasureFailureCode: null,
    createdAt: new Date("2026-08-25T00:00:00.000Z"),
    updatedAt: new Date("2026-08-25T00:00:00.000Z"),
    ...overrides,
  }
}

function prismaHarness() {
  const profiles: Array<ReturnType<typeof profileFixture>> = []
  const consentReceipts: Array<Record<string, unknown>> = []
  const transitions: Array<Record<string, unknown>> = []
  const links: Array<Record<string, unknown>> = []
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    recommendationProfile: {
      findUnique: vi.fn(
        async ({ where }: { where: { tokenDigest?: string; id?: string } }) =>
          where.tokenDigest
            ? (profiles.find(
                ({ tokenDigest }) => tokenDigest === where.tokenDigest,
              ) ?? null)
            : (profiles.find(({ id }) => id === where.id) ?? null),
      ),
      create: vi.fn(
        async ({ data }: { data: ReturnType<typeof profileFixture> }) => {
          const row = profileFixture(data)
          profiles.push(row)
          return row
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string }
          data: Record<string, unknown>
        }) => {
          const row = profiles.find(({ id }) => id === where.id)!
          Object.assign(row, data)
          return row
        },
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: {
            id?: string
            privacyGeneration?: number
            state?: string
            tokenDigest?: { not: null }
          }
          data: Record<string, unknown>
        }) => {
          const row = profiles.find(
            (profile) =>
              (where.id == null || profile.id === where.id) &&
              (where.privacyGeneration == null ||
                profile.privacyGeneration === where.privacyGeneration) &&
              (where.state == null || profile.state === where.state) &&
              (where.tokenDigest == null || profile.tokenDigest != null),
          )
          if (!row) return { count: 0 }
          Object.assign(row, data)
          return { count: 1 }
        },
      ),
    },
    recommendationProfileSessionLink: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { sessionDigest: string; expiresAt: { gt: Date } }
        }) => {
          const link = links.find(
            (candidate) =>
              candidate.sessionDigest === where.sessionDigest &&
              (candidate.expiresAt as Date) > where.expiresAt.gt,
          )
          if (!link) return null
          const profile = profiles.find(({ id }) => id === link.profileId)
          return profile ? { ...link, profile } : null
        },
      ),
      findMany: vi.fn(async ({ where }: { where: { profileId: string } }) =>
        links
          .filter((link) => link.profileId === where.profileId)
          .map((link) => ({ sessionDigest: link.sessionDigest as string })),
      ),
      upsert: vi.fn(
        async ({
          create,
          update,
        }: {
          create: Record<string, unknown>
          update: Record<string, unknown>
        }) => {
          const existing = links.find(
            (link) =>
              link.profileId === create.profileId &&
              link.privacyGeneration === create.privacyGeneration &&
              link.sessionDigest === create.sessionDigest,
          )
          if (existing) {
            Object.assign(existing, update)
            return existing
          }
          const row = { id: `link-${links.length + 1}`, ...create }
          links.push(row)
          return row
        },
      ),
      deleteMany: vi.fn(async ({ where }: { where: { profileId: string } }) => {
        const count = links.filter(
          (link) => link.profileId === where.profileId,
        ).length
        for (let index = links.length - 1; index >= 0; index -= 1) {
          if (links[index]?.profileId === where.profileId)
            links.splice(index, 1)
        }
        return { count }
      }),
      count: vi.fn(
        async ({ where }: { where: { profileId: string } }) =>
          links.filter((link) => link.profileId === where.profileId).length,
      ),
    },
    recommendationExperimentAssignment: {
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    recommendationProfileProjectionGeneration: {
      deleteMany: vi.fn(async () => ({ count: 1 })),
      count: vi.fn(async () => 0),
    },
    recommendationProfileProjectionPointer: {
      deleteMany: vi.fn(async () => ({ count: 1 })),
      count: vi.fn(async () => 0),
    },
    recommendationProfileProjectionRun: {
      deleteMany: vi.fn(async () => ({ count: 1 })),
      count: vi.fn(async () => 0),
    },
    recommendationConsentTransition: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        transitions.push(data)
        return data
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { profileId: string }
          data: {
            profileId: null
            erasureState?: "COMPLETED"
          }
        }) => {
          let count = 0
          for (const transition of transitions) {
            if (transition.profileId === where.profileId) {
              transition.profileId = data.profileId
              if (data.erasureState) {
                transition.erasureState = data.erasureState
              }
              count += 1
            }
          }
          return { count }
        },
      ),
      count: vi.fn(
        async ({ where }: { where: { profileId: string } }) =>
          transitions.filter(
            (transition) => transition.profileId === where.profileId,
          ).length,
      ),
    },
    recommendationConsentReceipt: {
      findUnique: vi.fn(
        async ({ where }: { where: { tokenDigest?: string; id?: string } }) =>
          consentReceipts.find(
            (receipt) =>
              (where.tokenDigest != null &&
                receipt.tokenDigest === where.tokenDigest) ||
              (where.id != null && receipt.id === where.id),
          ) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `consent-${consentReceipts.length + 1}`,
          state: "ACTIVE",
          revokedAt: null,
          revokeReason: null,
          createdAt: new Date("2026-08-25T00:00:00.000Z"),
          updatedAt: new Date("2026-08-25T00:00:00.000Z"),
          ...data,
        }
        consentReceipts.push(row)
        return row
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>
          data: Record<string, unknown>
        }) => {
          let count = 0
          for (const receipt of consentReceipts) {
            if (
              (where.tokenDigest == null ||
                receipt.tokenDigest === where.tokenDigest) &&
              (where.id == null || receipt.id === where.id) &&
              (where.state == null || receipt.state === where.state) &&
              (where.profileId == null ||
                receipt.profileId === where.profileId) &&
              (where.privacyGeneration == null ||
                receipt.privacyGeneration === where.privacyGeneration)
            ) {
              Object.assign(receipt, data)
              count += 1
            }
          }
          return { count }
        },
      ),
    },
    recommendationShadowRun: {
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    recommendationShadowNomination: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  }
  const prisma = {
    ...tx,
    $transaction: vi.fn(async (work: (client: typeof tx) => unknown) =>
      work(tx),
    ),
  } as unknown as PrismaClient
  return { prisma, profiles, consentReceipts, transitions, links, tx }
}

describe("RecommendationProfileService", () => {
  it("commits a versioned consent receipt with grant and requires it before profile status can be active", async () => {
    const harness = prismaHarness()
    const service = new RecommendationProfileService({
      prisma: harness.prisma,
      now: () => new Date("2026-08-25T00:00:00.000Z"),
      newId: () => "profile-1",
      newAuditId: () => "audit-grant",
    })

    const granted = await service.transition({
      caller: webCaller,
      contractVersion: "recommendation-profile-v1",
      consentContractVersion: "recommendation-consent-v1",
      action: "grant",
      consentChoice: "personalization",
      sessionDigest: "1".repeat(64),
      existingConsentReceiptDigest: null,
      proposedConsentReceiptDigest: "c".repeat(64),
      existingProfileDigest: null,
      proposedProfileDigest: "a".repeat(64),
    })
    expect(granted).toMatchObject({
      state: "active",
      consentChoice: "personalization",
      consentCookieDisposition: "set",
      privacyGeneration: 1,
    })
    expect(harness.consentReceipts).toEqual([
      expect.objectContaining({
        tokenDigest: "c".repeat(64),
        contractVersion: "recommendation-consent-v1",
        choice: "PERSONALIZATION",
        privacyGeneration: 1,
        profileId: "profile-1",
        state: "ACTIVE",
      }),
    ])

    await expect(
      service.status({
        caller: webCaller,
        contractVersion: "recommendation-profile-v1",
        consentContractVersion: "recommendation-consent-v1",
        sessionDigest: "1".repeat(64),
        consentReceiptDigest: null,
        profileDigest: "a".repeat(64),
      }),
    ).resolves.toMatchObject({
      state: "session_only",
      consentChoice: "undecided",
      cookieDisposition: "clear",
    })

    await expect(
      service.status({
        caller: webCaller,
        contractVersion: "recommendation-profile-v1",
        consentContractVersion: "recommendation-consent-v1",
        sessionDigest: "1".repeat(64),
        consentReceiptDigest: "c".repeat(64),
        profileDigest: "a".repeat(64),
      }),
    ).resolves.toMatchObject({
      state: "active",
      consentChoice: "personalization",
      consentCookieDisposition: "keep",
    })
  })

  it("persists Essential only without creating or resolving a durable profile", async () => {
    const harness = prismaHarness()
    const service = new RecommendationProfileService({
      prisma: harness.prisma,
      now: () => new Date("2026-08-25T00:00:00.000Z"),
    })

    await expect(
      service.transition({
        caller: webCaller,
        contractVersion: "recommendation-profile-v1",
        consentContractVersion: "recommendation-consent-v1",
        action: "withdraw",
        consentChoice: "essential_only",
        sessionDigest: "1".repeat(64),
        existingConsentReceiptDigest: null,
        proposedConsentReceiptDigest: "c".repeat(64),
        existingProfileDigest: null,
        proposedProfileDigest: null,
      }),
    ).resolves.toMatchObject({
      state: "session_only",
      consentChoice: "essential_only",
      consentCookieDisposition: "set",
    })
    expect(harness.profiles).toEqual([])
    expect(harness.tx.recommendationProfile.findUnique).not.toHaveBeenCalled()

    await expect(
      service.status({
        caller: webCaller,
        contractVersion: "recommendation-profile-v1",
        consentContractVersion: "recommendation-consent-v1",
        sessionDigest: "1".repeat(64),
        consentReceiptDigest: "c".repeat(64),
        profileDigest: "a".repeat(64),
      }),
    ).resolves.toMatchObject({
      state: "session_only",
      consentChoice: "essential_only",
      cookieDisposition: "clear",
    })
    expect(harness.tx.recommendationProfile.findUnique).not.toHaveBeenCalled()
  })

  it("keeps only one active personalized consent receipt per profile generation", async () => {
    const harness = prismaHarness()
    const service = new RecommendationProfileService({
      prisma: harness.prisma,
      now: () => new Date("2026-08-25T00:00:00.000Z"),
      newId: () => "profile-1",
      newAuditId: () => "audit-grant",
    })

    await service.transition({
      caller: webCaller,
      contractVersion: "recommendation-profile-v1",
      consentContractVersion: "recommendation-consent-v1",
      action: "grant",
      consentChoice: "personalization",
      sessionDigest: "1".repeat(64),
      existingConsentReceiptDigest: null,
      proposedConsentReceiptDigest: "c".repeat(64),
      existingProfileDigest: null,
      proposedProfileDigest: "a".repeat(64),
    })
    await service.transition({
      caller: webCaller,
      contractVersion: "recommendation-profile-v1",
      consentContractVersion: "recommendation-consent-v1",
      action: "grant",
      consentChoice: "personalization",
      sessionDigest: "2".repeat(64),
      existingConsentReceiptDigest: null,
      proposedConsentReceiptDigest: "d".repeat(64),
      existingProfileDigest: "a".repeat(64),
      proposedProfileDigest: null,
    })

    expect(harness.consentReceipts).toEqual([
      expect.objectContaining({
        tokenDigest: null,
        state: "REVOKED",
        revokeReason: "receipt_replaced",
      }),
      expect.objectContaining({
        tokenDigest: "d".repeat(64),
        profileId: "profile-1",
        privacyGeneration: 1,
        state: "ACTIVE",
      }),
    ])
  })

  it("reuses the session-linked profile when concurrent grants present stale cookies", async () => {
    const harness = prismaHarness()
    const newId = vi.fn(() => "profile-1")
    const newAuditId = vi.fn(() => "audit-grant")
    const service = new RecommendationProfileService({
      prisma: harness.prisma,
      now: () => new Date("2026-08-25T00:00:00.000Z"),
      newId,
      newAuditId,
    })
    const sessionDigest = "1".repeat(64)

    await service.transition({
      caller: webCaller,
      contractVersion: "recommendation-profile-v1",
      consentContractVersion: "recommendation-consent-v1",
      action: "grant",
      consentChoice: "personalization",
      sessionDigest,
      existingConsentReceiptDigest: null,
      proposedConsentReceiptDigest: "c".repeat(64),
      existingProfileDigest: null,
      proposedProfileDigest: "a".repeat(64),
    })
    const repeatedGrant = await service.transition({
      caller: webCaller,
      contractVersion: "recommendation-profile-v1",
      consentContractVersion: "recommendation-consent-v1",
      action: "grant",
      consentChoice: "personalization",
      sessionDigest,
      existingConsentReceiptDigest: null,
      proposedConsentReceiptDigest: "d".repeat(64),
      existingProfileDigest: null,
      proposedProfileDigest: "b".repeat(64),
    })

    expect(repeatedGrant).toMatchObject({
      state: "active",
      privacyGeneration: 1,
      cookieDisposition: "keep",
    })
    expect(harness.profiles).toHaveLength(1)
    expect(harness.links).toHaveLength(1)
    expect(
      harness.transitions.filter(({ kind }) => kind === "GRANT"),
    ).toHaveLength(1)
    expect(
      harness.consentReceipts.filter(({ state }) => state === "ACTIVE"),
    ).toEqual([
      expect.objectContaining({
        tokenDigest: "d".repeat(64),
        profileId: "profile-1",
        privacyGeneration: 1,
      }),
    ])
    expect(newId).toHaveBeenCalledOnce()
    expect(newAuditId).toHaveBeenCalledOnce()
  })

  it("grants a durable profile, resets to a new identity/generation, and fences stale workers", async () => {
    const harness = prismaHarness()
    const service = new RecommendationProfileService({
      prisma: harness.prisma,
      now: () => new Date("2026-08-25T00:00:00.000Z"),
      newId: vi
        .fn()
        .mockReturnValueOnce("profile-1")
        .mockReturnValueOnce("profile-2"),
      newAuditId: () => "non-linkable-audit",
    })

    const granted = await service.transition({
      caller: webCaller,
      contractVersion: "recommendation-profile-v1",
      action: "grant",
      sessionDigest: "1".repeat(64),
      existingProfileDigest: null,
      proposedProfileDigest: "a".repeat(64),
    })
    expect(granted).toMatchObject({
      state: "active",
      choice: "durable_allowed",
      privacyGeneration: 1,
      cookieDisposition: "set",
    })

    const reset = await service.transition({
      caller: webCaller,
      contractVersion: "recommendation-profile-v1",
      action: "reset",
      sessionDigest: "1".repeat(64),
      existingProfileDigest: "a".repeat(64),
      proposedProfileDigest: "b".repeat(64),
    })
    expect(reset).toMatchObject({
      state: "active",
      privacyGeneration: 2,
      cookieDisposition: "set",
      profileId: "profile-1",
      erasureGeneration: 1,
    })
    expect(harness.links).toEqual([
      expect.objectContaining({
        profileId: "profile-2",
        privacyGeneration: 2,
        sessionDigest: "1".repeat(64),
      }),
    ])

    await expect(
      service.assertPublishableGeneration("profile-1", 1),
    ).rejects.toBeInstanceOf(RecommendationConflictError)
    await expect(
      service.assertPublishableGeneration("profile-2", 2),
    ).resolves.toBeUndefined()
  })

  it("withdraws atomically, completes erasure, and passes a non-relinkable deletion drill", async () => {
    const harness = prismaHarness()
    const service = new RecommendationProfileService({
      prisma: harness.prisma,
      now: () => new Date("2026-08-25T00:00:00.000Z"),
      newId: () => "profile-1",
      newAuditId: vi
        .fn()
        .mockReturnValueOnce("audit-grant")
        .mockReturnValueOnce("audit-withdraw"),
    })
    await service.transition({
      caller: webCaller,
      contractVersion: "recommendation-profile-v1",
      action: "grant",
      sessionDigest: "1".repeat(64),
      existingProfileDigest: null,
      proposedProfileDigest: "a".repeat(64),
    })

    const receipt = await service.transition({
      caller: webCaller,
      contractVersion: "recommendation-profile-v1",
      action: "withdraw",
      sessionDigest: "1".repeat(64),
      existingProfileDigest: "a".repeat(64),
      proposedProfileDigest: null,
    })
    expect(receipt).toMatchObject({
      state: "session_only",
      cookieDisposition: "clear",
      erasureState: "pending",
      profileId: "profile-1",
      erasureGeneration: 1,
    })
    expect(harness.profiles[0]).toMatchObject({
      tokenDigest: null,
      state: "TOMBSTONED",
      tombstoneReason: "withdraw",
      erasureState: "PENDING",
    })
    expect(harness.links).toEqual([])
    expect(harness.tx.recommendationShadowRun.findMany).toHaveBeenCalledWith({
      where: { projectionProfileId: "profile-1", privacyGeneration: 1 },
      select: { id: true },
    })
    expect(
      harness.transitions.filter(({ kind }) => kind === "WITHDRAW"),
    ).toEqual([
      expect.objectContaining({
        profileId: "profile-1",
        erasureState: "PENDING",
      }),
    ])

    await expect(
      service.completeErasure({
        profileId: "profile-1",
        privacyGeneration: 1,
      }),
    ).resolves.toBe(true)
    await expect(
      service.runDeletionDrill({
        profileId: "profile-1",
        privacyGeneration: 1,
      }),
    ).resolves.toBeUndefined()
    expect(harness.profiles[0]).toMatchObject({
      erasureState: "COMPLETED",
      deletionDrillAt: new Date("2026-08-25T00:00:00.000Z"),
    })
    expect(
      harness.transitions.every(({ profileId }) => profileId == null),
    ).toBe(true)
    expect(
      harness.transitions.filter(({ kind }) => kind === "WITHDRAW"),
    ).toEqual([
      expect.objectContaining({
        profileId: null,
        erasureState: "COMPLETED",
      }),
    ])
  })

  it("uses the active consent receipt to withdraw when the profile cookie is missing", async () => {
    const harness = prismaHarness()
    const service = new RecommendationProfileService({
      prisma: harness.prisma,
      now: () => new Date("2026-08-25T00:00:00.000Z"),
      newId: () => "profile-1",
      newAuditId: vi
        .fn()
        .mockReturnValueOnce("audit-grant")
        .mockReturnValueOnce("audit-withdraw"),
    })
    await service.transition({
      caller: webCaller,
      contractVersion: "recommendation-profile-v1",
      consentContractVersion: "recommendation-consent-v1",
      action: "grant",
      consentChoice: "personalization",
      sessionDigest: "1".repeat(64),
      existingConsentReceiptDigest: null,
      proposedConsentReceiptDigest: "c".repeat(64),
      existingProfileDigest: null,
      proposedProfileDigest: "a".repeat(64),
    })

    await expect(
      service.transition({
        caller: webCaller,
        contractVersion: "recommendation-profile-v1",
        consentContractVersion: "recommendation-consent-v1",
        action: "withdraw",
        consentChoice: "essential_only",
        sessionDigest: "1".repeat(64),
        existingConsentReceiptDigest: "c".repeat(64),
        proposedConsentReceiptDigest: "d".repeat(64),
        existingProfileDigest: null,
        proposedProfileDigest: null,
      }),
    ).resolves.toMatchObject({
      state: "session_only",
      erasureState: "pending",
      profileId: "profile-1",
      erasureGeneration: 1,
      consentChoice: "essential_only",
    })
    expect(harness.profiles[0]).toMatchObject({
      state: "TOMBSTONED",
      tokenDigest: null,
      tombstoneReason: "withdraw",
      erasureState: "PENDING",
    })
  })

  it("rejects a profile cookie that identifies a different profile than the active consent receipt", async () => {
    const harness = prismaHarness()
    harness.profiles.push(
      profileFixture(),
      profileFixture({ id: "profile-2", tokenDigest: "b".repeat(64) }),
    )
    harness.consentReceipts.push({
      id: "consent-1",
      tokenDigest: "c".repeat(64),
      contractVersion: "recommendation-consent-v1",
      choice: "PERSONALIZATION",
      state: "ACTIVE",
      profileId: "profile-1",
      privacyGeneration: 1,
      expiresAt: new Date("2027-02-21T00:00:00.000Z"),
    })
    const service = new RecommendationProfileService({
      prisma: harness.prisma,
      now: () => new Date("2026-08-25T00:00:00.000Z"),
    })

    await expect(
      service.transition({
        caller: webCaller,
        contractVersion: "recommendation-profile-v1",
        consentContractVersion: "recommendation-consent-v1",
        action: "delete",
        consentChoice: "essential_only",
        sessionDigest: "1".repeat(64),
        existingConsentReceiptDigest: "c".repeat(64),
        proposedConsentReceiptDigest: "d".repeat(64),
        existingProfileDigest: "b".repeat(64),
        proposedProfileDigest: null,
      }),
    ).rejects.toBeInstanceOf(RecommendationConflictError)
    expect(harness.profiles).toEqual([
      expect.objectContaining({ id: "profile-1", state: "ACTIVE" }),
      expect.objectContaining({ id: "profile-2", state: "ACTIVE" }),
    ])
  })

  it("never adopts an unknown or reused proposed identity", async () => {
    const harness = prismaHarness()
    const service = new RecommendationProfileService({
      prisma: harness.prisma,
      newId: () => "profile-1",
    })

    await expect(
      service.status({
        caller: webCaller,
        contractVersion: "recommendation-profile-v1",
        sessionDigest: "1".repeat(64),
        profileDigest: "f".repeat(64),
      }),
    ).resolves.toMatchObject({
      state: "session_only",
      cookieDisposition: "clear",
    })
    await expect(
      service.transition({
        caller: webCaller,
        contractVersion: "recommendation-profile-v1",
        action: "grant",
        sessionDigest: "1".repeat(64),
        existingProfileDigest: "f".repeat(64),
        proposedProfileDigest: "f".repeat(64),
      }),
    ).rejects.toBeInstanceOf(RecommendationInputError)
    expect(harness.profiles).toEqual([])
  })

  it("expires a returned profile before it can link a new session", async () => {
    const harness = prismaHarness()
    harness.profiles.push(
      profileFixture({ expiresAt: new Date("2026-08-24T00:00:00.000Z") }),
    )
    harness.consentReceipts.push({
      id: "consent-1",
      tokenDigest: "c".repeat(64),
      contractVersion: "recommendation-consent-v1",
      choice: "PERSONALIZATION",
      state: "ACTIVE",
      profileId: "profile-1",
      privacyGeneration: 1,
      expiresAt: new Date("2027-02-21T00:00:00.000Z"),
    })
    const service = new RecommendationProfileService({
      prisma: harness.prisma,
      now: () => new Date("2026-08-25T00:00:00.000Z"),
      newAuditId: () => "audit-expire",
    })

    await expect(
      service.status({
        caller: webCaller,
        contractVersion: "recommendation-profile-v1",
        consentContractVersion: "recommendation-consent-v1",
        sessionDigest: "1".repeat(64),
        consentReceiptDigest: "c".repeat(64),
        profileDigest: "a".repeat(64),
      }),
    ).resolves.toMatchObject({
      state: "session_only",
      cookieDisposition: "clear",
      erasureState: "pending",
    })
    expect(harness.links).toEqual([])
    expect(harness.profiles[0]).toMatchObject({
      state: "EXPIRED",
      tokenDigest: null,
      tombstoneReason: "expire",
    })
    expect(harness.consentReceipts[0]).toMatchObject({
      state: "EXPIRED",
      tokenDigest: null,
      profileId: null,
      revokeReason: "profile_expired",
    })
  })

  it("revokes a stale consent/profile generation link and requires a fresh choice", async () => {
    const harness = prismaHarness()
    harness.profiles.push(profileFixture({ privacyGeneration: 2 }))
    harness.consentReceipts.push({
      id: "consent-stale",
      tokenDigest: "c".repeat(64),
      contractVersion: "recommendation-consent-v1",
      choice: "PERSONALIZATION",
      state: "ACTIVE",
      profileId: "profile-1",
      privacyGeneration: 1,
      expiresAt: new Date("2027-02-21T00:00:00.000Z"),
    })
    const service = new RecommendationProfileService({
      prisma: harness.prisma,
      now: () => new Date("2026-08-25T00:00:00.000Z"),
    })

    await expect(
      service.status({
        caller: webCaller,
        contractVersion: "recommendation-profile-v1",
        consentContractVersion: "recommendation-consent-v1",
        sessionDigest: "1".repeat(64),
        consentReceiptDigest: "c".repeat(64),
        profileDigest: "a".repeat(64),
      }),
    ).resolves.toMatchObject({
      state: "session_only",
      consentChoice: "undecided",
      consentCookieDisposition: "clear",
    })
    expect(harness.consentReceipts[0]).toMatchObject({
      state: "REVOKED",
      tokenDigest: null,
      profileId: null,
      revokeReason: "profile_generation_mismatch",
    })
    expect(harness.links).toEqual([])
  })
})
