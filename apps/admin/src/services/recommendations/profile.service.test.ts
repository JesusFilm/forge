import { describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"

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
    recommendationViewingModeEvidence: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
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

describe("retired RecommendationProfileService", () => {
  it.each(["grant", "reset", "withdraw", "delete"] as const)(
    "never creates a profile for %s",
    async (action) => {
      const h = prismaHarness()
      const service = new RecommendationProfileService({ prisma: h.prisma })
      const receipt = await service.transition({
        caller: webCaller,
        contractVersion: "recommendation-profile-v1",
        action,
        sessionDigest: "1".repeat(64),
        existingProfileDigest: null,
        proposedProfileDigest: "a".repeat(64),
        proposedConsentReceiptDigest: "b".repeat(64),
      })
      expect(receipt).toMatchObject({
        state: "session_only",
        cookieDisposition: "clear",
        consentCookieDisposition: "clear",
        consentChoice: "undecided",
        consentExpiresAt: null,
      })
      expect(h.profiles).toEqual([])
      expect(h.consentReceipts).toEqual([])
      expect(h.links).toEqual([])
      expect(h.tx.recommendationProfile.create).not.toHaveBeenCalled()
    },
  )

  it("fences historical state before clearing credentials on status", async () => {
    const h = prismaHarness()
    h.profiles.push(profileFixture())
    const service = new RecommendationProfileService({ prisma: h.prisma })
    const receipt = await service.status({
      caller: webCaller,
      contractVersion: "recommendation-profile-v1",
      sessionDigest: "1".repeat(64),
      profileDigest: "a".repeat(64),
      consentReceiptDigest: "b".repeat(64),
    })
    expect(receipt).toMatchObject({
      state: "session_only",
      cookieDisposition: "clear",
      consentCookieDisposition: "clear",
    })
    expect(receipt.erasureState).toBe("pending")
    expect(h.profiles[0]?.state).toBe("TOMBSTONED")
    expect(h.tx.recommendationProfile.create).not.toHaveBeenCalled()
  })

  it("still erases an existing historical profile on withdrawal", async () => {
    const h = prismaHarness()
    h.profiles.push(profileFixture())
    const service = new RecommendationProfileService({
      prisma: h.prisma,
      now: () => new Date("2026-10-29T00:00:00Z"),
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
      erasureState: "pending",
      profileId: "profile-1",
      erasureGeneration: 1,
    })
    expect(h.profiles[0]).toMatchObject({
      state: "TOMBSTONED",
      tokenDigest: null,
    })
    await expect(
      service.completeErasure({ profileId: "profile-1", privacyGeneration: 1 }),
    ).resolves.toBe(true)
    await expect(
      service.runDeletionDrill({
        profileId: "profile-1",
        privacyGeneration: 1,
      }),
    ).resolves.toBeUndefined()
  })

  it("refuses publishing even a previously active privacy generation", async () => {
    const h = prismaHarness()
    h.profiles.push(profileFixture())
    const service = new RecommendationProfileService({ prisma: h.prisma })
    await expect(
      service.assertPublishableGeneration("profile-1", 1),
    ).rejects.toThrow("retired")
  })

  it("retains caller and input validation", async () => {
    const h = prismaHarness()
    const service = new RecommendationProfileService({ prisma: h.prisma })
    await expect(
      service.status({
        caller: null,
        contractVersion: "recommendation-profile-v1",
        sessionDigest: "1".repeat(64),
        profileDigest: null,
      }),
    ).rejects.toThrow()
    await expect(
      service.status({
        caller: webCaller,
        contractVersion: "unknown",
        sessionDigest: "1".repeat(64),
        profileDigest: null,
      }),
    ).rejects.toThrow()
  })
})
