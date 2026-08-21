import { describe, expect, it, vi } from "vitest"

import {
  ConsumerEligibilityService,
  ConsumerLifecycleReconciliationService,
} from "./consumer-eligibility.service"

function buildHarness(
  user: Record<string, unknown> = {
    id: "consumer-1",
    actorType: "HUMAN",
    emailVerified: true,
    membershipStatus: "INVITED",
    consumerLifecycleState: "DISABLED",
    consumerLifecycleVersion: 0n,
    consumerLifecycleRenewedAt: null,
    accounts: [{ providerId: "google", accountId: "google-subject" }],
  },
) {
  const findUnique = vi.fn(async () => user)
  const update = vi.fn(async ({ data }) => ({ ...user, ...data }))
  const create = vi.fn(async ({ data }) => data)
  const tx = {
    user: { findUnique, update },
    consumerLifecycleOutbox: { create },
    oauthAccessToken: { deleteMany: vi.fn() },
    oauthRefreshToken: { updateMany: vi.fn() },
    oauthConsent: { deleteMany: vi.fn() },
    deviceCode: { deleteMany: vi.fn() },
    tokenRecord: { updateMany: vi.fn() },
    appGrant: { updateMany: vi.fn() },
    session: { deleteMany: vi.fn() },
  }
  const prisma = {
    $transaction: vi.fn(async (callback) => callback(tx)),
  }
  return { service: new ConsumerEligibilityService(prisma as never), tx }
}

describe("ConsumerEligibilityService", () => {
  it.each(["google", "apple"])(
    "activates a persisted verified %s identity and writes the lifecycle event atomically",
    async (providerId) => {
      const { service, tx } = buildHarness({
        id: "consumer-1",
        actorType: "HUMAN",
        emailVerified: true,
        membershipStatus: "INVITED",
        consumerLifecycleState: "DISABLED",
        consumerLifecycleVersion: 0n,
        consumerLifecycleRenewedAt: null,
        accounts: [{ providerId, accountId: `${providerId}-subject` }],
      })

      await expect(service.reconcile("consumer-1")).resolves.toMatchObject({
        eligible: true,
        state: "ACTIVE",
        version: 1n,
      })
      expect(tx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "consumer-1" },
          data: expect.objectContaining({
            membershipStatus: "ACTIVE",
            consumerLifecycleState: "ACTIVE",
            consumerLifecycleVersion: { increment: 1 },
          }),
        }),
      )
      expect(tx.consumerLifecycleOutbox.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ownerSubject: "consumer-1",
            state: "ACTIVE",
            version: 1n,
          }),
        }),
      )
    },
  )

  it.each([
    ["credential", true],
    ["google", false],
    ["facebook", true],
  ])(
    "does not activate provider=%s verified=%s",
    async (providerId, emailVerified) => {
      const { service, tx } = buildHarness({
        id: "consumer-1",
        actorType: "HUMAN",
        emailVerified,
        membershipStatus: "INVITED",
        consumerLifecycleState: "DISABLED",
        consumerLifecycleVersion: 0n,
        consumerLifecycleRenewedAt: null,
        accounts: [{ providerId, accountId: "persisted-subject" }],
      })

      await expect(service.reconcile("consumer-1")).resolves.toMatchObject({
        eligible: false,
      })
      expect(tx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ membershipStatus: "ACTIVE" }),
        }),
      )
      expect(tx.consumerLifecycleOutbox.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ state: "DISABLED" }),
        }),
      )
    },
  )

  it("disables playlist lifecycle and revokes only playlist-bearing token families when social eligibility is lost", async () => {
    const { service, tx } = buildHarness({
      id: "consumer-1",
      actorType: "HUMAN",
      emailVerified: true,
      membershipStatus: "ACTIVE",
      consumerLifecycleState: "ACTIVE",
      consumerLifecycleVersion: 3n,
      consumerLifecycleRenewedAt: new Date("2026-08-21T12:00:00.000Z"),
      accounts: [{ providerId: "credential", accountId: "consumer-1" }],
    })

    await expect(service.reconcile("consumer-1")).resolves.toMatchObject({
      eligible: false,
      membershipStatus: "ACTIVE",
      state: "DISABLED",
      version: 4n,
    })
    expect(tx.oauthAccessToken.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: "consumer-1",
        scopes: {
          hasSome: ["playlist:read", "playlist:write", "playlist:share"],
        },
      },
    })
    expect(tx.oauthRefreshToken.updateMany).toHaveBeenCalledWith({
      where: {
        userId: "consumer-1",
        revoked: null,
        scopes: {
          hasSome: ["playlist:read", "playlist:write", "playlist:share"],
        },
      },
      data: { revoked: expect.any(Date) },
    })
    expect(tx.session.deleteMany).not.toHaveBeenCalled()
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ membershipStatus: "DISABLED" }),
      }),
    )
    expect(tx.consumerLifecycleOutbox.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerSubject: "consumer-1",
          state: "DISABLED",
          version: 4n,
        }),
      }),
    )
  })

  it("bootstraps an ineligible ordinary ACTIVE member as lifecycle DISABLED without disabling membership", async () => {
    const { service, tx } = buildHarness({
      id: "consumer-1",
      actorType: "HUMAN",
      emailVerified: true,
      membershipStatus: "ACTIVE",
      consumerLifecycleState: "DISABLED",
      consumerLifecycleVersion: 0n,
      consumerLifecycleRenewedAt: null,
      accounts: [{ providerId: "credential", accountId: "consumer-1" }],
    })

    await expect(service.reconcile("consumer-1")).resolves.toMatchObject({
      eligible: false,
      membershipStatus: "ACTIVE",
      state: "DISABLED",
      version: 1n,
    })
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ membershipStatus: "DISABLED" }),
      }),
    )
  })

  it("re-revokes a newly-created session for an already suspended member without duplicating the lifecycle event", async () => {
    const { service, tx } = buildHarness({
      id: "consumer-1",
      actorType: "HUMAN",
      emailVerified: true,
      membershipStatus: "SUSPENDED",
      consumerLifecycleState: "SUSPENDED",
      consumerLifecycleVersion: 5n,
      consumerLifecycleRenewedAt: null,
      accounts: [{ providerId: "google", accountId: "google-subject" }],
    })

    await expect(service.reconcile("consumer-1")).resolves.toMatchObject({
      eligible: false,
      state: "SUSPENDED",
      version: 5n,
    })
    expect(tx.session.deleteMany).toHaveBeenCalledWith({
      where: { userId: "consumer-1" },
    })
    expect(tx.user.update).not.toHaveBeenCalled()
    expect(tx.consumerLifecycleOutbox.create).not.toHaveBeenCalled()
  })

  it("revokes current token families before emitting a non-active state", async () => {
    const { service, tx } = buildHarness({
      id: "consumer-1",
      actorType: "HUMAN",
      emailVerified: true,
      membershipStatus: "ACTIVE",
      consumerLifecycleState: "ACTIVE",
      consumerLifecycleVersion: 3n,
      consumerLifecycleRenewedAt: new Date("2026-08-21T12:00:00.000Z"),
      accounts: [{ providerId: "google", accountId: "google-subject" }],
    })

    await service.transition("consumer-1", "SUSPENDING")

    expect(tx.oauthAccessToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: "consumer-1" },
    })
    expect(tx.oauthRefreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "consumer-1", revoked: null },
      data: { revoked: expect.any(Date) },
    })
    expect(tx.session.deleteMany).toHaveBeenCalledWith({
      where: { userId: "consumer-1" },
    })
    expect(tx.oauthConsent.deleteMany).toHaveBeenCalledWith({
      where: { userId: "consumer-1" },
    })
    expect(tx.deviceCode.deleteMany).toHaveBeenCalledWith({
      where: { userId: "consumer-1" },
    })
    expect(tx.tokenRecord.updateMany).toHaveBeenCalledWith({
      where: { userId: "consumer-1", status: "ACTIVE" },
      data: {
        status: "REVOKED",
        revokedAt: expect.any(Date),
        revocationReason: "consumer_lifecycle_SUSPENDING",
      },
    })
    expect(tx.appGrant.updateMany).toHaveBeenCalledWith({
      where: {
        userId: "consumer-1",
        status: { in: ["PENDING", "APPROVED"] },
      },
      data: {
        status: "REVOKED",
        revokedAt: expect.any(Date),
        reason: "consumer_lifecycle_SUSPENDING",
      },
    })
    expect(tx.user.update.mock.invocationCallOrder[0]).toBeGreaterThan(
      tx.session.deleteMany.mock.invocationCallOrder[0]!,
    )
    expect(tx.consumerLifecycleOutbox.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: "SUSPENDING",
          version: 4n,
          activeLeaseExpiresAt: null,
        }),
      }),
    )
  })

  it("retries DELETING without advancing its lifecycle version or duplicating its outbox event", async () => {
    const { service, tx } = buildHarness({
      id: "consumer-1",
      actorType: "HUMAN",
      emailVerified: true,
      membershipStatus: "ACTIVE",
      consumerLifecycleState: "DELETING",
      consumerLifecycleVersion: 7n,
      consumerLifecycleRenewedAt: null,
      accounts: [{ providerId: "apple", accountId: "apple-subject" }],
    })

    await expect(service.transition("consumer-1", "DELETING")).resolves.toEqual(
      {
        eligible: false,
        membershipStatus: "ACTIVE",
        state: "DELETING",
        version: 7n,
      },
    )
    expect(tx.session.deleteMany).toHaveBeenCalledWith({
      where: { userId: "consumer-1" },
    })
    expect(tx.user.update).not.toHaveBeenCalled()
    expect(tx.consumerLifecycleOutbox.create).not.toHaveBeenCalled()
  })

  it.each(["SUSPENDING", "SUSPENDED", "DELETING", "DELETED"])(
    "does not implicitly reactivate an explicitly %s lifecycle",
    async (consumerLifecycleState) => {
      const { service, tx } = buildHarness({
        id: "consumer-1",
        actorType: "HUMAN",
        emailVerified: true,
        membershipStatus: "ACTIVE",
        consumerLifecycleState,
        consumerLifecycleVersion: 4n,
        consumerLifecycleRenewedAt: null,
        accounts: [{ providerId: "google", accountId: "google-subject" }],
      })

      await expect(service.reconcile("consumer-1")).resolves.toMatchObject({
        eligible: false,
        state: consumerLifecycleState,
        version: 4n,
      })
      expect(tx.user.update).not.toHaveBeenCalled()
      expect(tx.consumerLifecycleOutbox.create).not.toHaveBeenCalled()
    },
  )
})

describe("ConsumerLifecycleReconciliationService", () => {
  it("renews eligible ACTIVE leases from a scheduled batch without owner traffic", async () => {
    const reconcile = vi.fn(async () => ({
      eligible: true,
      state: "ACTIVE" as const,
      version: 9n,
    }))
    const findMany = vi.fn(async () => [
      {
        id: "consumer-1",
        membershipStatus: "ACTIVE",
        consumerLifecycleState: "ACTIVE",
        consumerLifecycleVersion: 8n,
      },
    ])
    const service = new ConsumerLifecycleReconciliationService(
      { user: { findMany } } as never,
      { reconcile, transition: vi.fn() } as never,
    )

    await expect(service.reconcileBatch({ limit: 100 })).resolves.toEqual({
      processed: 1,
      nextCursor: null,
    })
    expect(reconcile).toHaveBeenCalledWith("consumer-1")
  })

  it("bootstraps a durable inactive projection for suspended consumers", async () => {
    const transition = vi.fn(async () => ({
      eligible: false,
      state: "SUSPENDED" as const,
      version: 1n,
    }))
    const service = new ConsumerLifecycleReconciliationService(
      {
        user: {
          findMany: vi.fn(async () => [
            {
              id: "consumer-2",
              membershipStatus: "SUSPENDED",
              consumerLifecycleState: "DISABLED",
              consumerLifecycleVersion: 0n,
            },
          ]),
        },
      } as never,
      { reconcile: vi.fn(), transition } as never,
    )

    await service.reconcileBatch({})

    expect(transition).toHaveBeenCalledWith("consumer-2", "SUSPENDED")
  })

  it("reconciles a page with bounded concurrency", async () => {
    let active = 0
    let maxActive = 0
    const reconcile = vi.fn(async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise<void>((resolve) => queueMicrotask(resolve))
      active -= 1
      return { eligible: true, state: "ACTIVE" as const, version: 1n }
    })
    const users = Array.from({ length: 23 }, (_, index) => ({
      id: `consumer-${index}`,
      membershipStatus: "ACTIVE" as const,
      consumerLifecycleState: "ACTIVE" as const,
      consumerLifecycleVersion: 1n,
    }))
    const service = new ConsumerLifecycleReconciliationService(
      { user: { findMany: vi.fn(async () => users) } } as never,
      { reconcile, transition: vi.fn() } as never,
      { concurrency: 10 },
    )

    await expect(service.reconcileBatch({ limit: 23 })).resolves.toEqual({
      processed: 23,
      nextCursor: null,
    })
    expect(reconcile).toHaveBeenCalledTimes(23)
    expect(maxActive).toBe(10)
  })
})
