import type { PrismaClient } from "@prisma/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  ConsumerLifecycleEventConflictError,
  ConsumerLifecycleService,
  ConsumerLifecycleUnavailableError,
} from "./consumer-lifecycle.service"

const now = new Date("2026-08-21T12:00:00.000Z")

describe("ConsumerLifecycleService", () => {
  const projection = {
    findUnique: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    findMany: vi.fn(),
  }
  const receipt = { findFirst: vi.fn() }
  const tx = {
    consumerLifecycleProjection: projection,
    userPlaylistErasureReceipt: receipt,
  }
  const prisma = {
    ...tx,
    $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)),
  } as unknown as PrismaClient
  const service = new ConsumerLifecycleService(prisma, { now: () => now })

  beforeEach(() => {
    vi.clearAllMocks()
    receipt.findFirst.mockResolvedValue(null)
  })

  it("creates a versioned ACTIVE projection with a bounded lease", async () => {
    projection.findUnique.mockResolvedValue(null)
    projection.create.mockResolvedValue({})

    await expect(
      service.apply({
        ownerSubject: "consumer-1",
        state: "ACTIVE",
        version: 3n,
        sourceEventId: "event-3",
        activeLeaseExpiresAt: new Date(now.getTime() + 5 * 60_000),
      }),
    ).resolves.toEqual({ applied: true, replayed: false, stale: false })
  })

  it("accepts an identical replay and ignores an older event", async () => {
    projection.findUnique.mockResolvedValue({
      ownerSubject: "consumer-1",
      state: "SUSPENDED",
      version: 4n,
      sourceEventId: "event-4",
      activeLeaseExpiresAt: null,
    })

    await expect(
      service.apply({
        ownerSubject: "consumer-1",
        state: "SUSPENDED",
        version: 4n,
        sourceEventId: "event-4",
        activeLeaseExpiresAt: null,
      }),
    ).resolves.toEqual({ applied: false, replayed: true, stale: false })
    await expect(
      service.apply({
        ownerSubject: "consumer-1",
        state: "ACTIVE",
        version: 3n,
        sourceEventId: "event-3",
        activeLeaseExpiresAt: new Date(now.getTime() + 60_000),
      }),
    ).resolves.toEqual({ applied: false, replayed: false, stale: true })
    expect(projection.updateMany).not.toHaveBeenCalled()
  })

  it("rejects a non-identical event at the current version", async () => {
    projection.findUnique.mockResolvedValue({
      ownerSubject: "consumer-1",
      state: "DISABLED",
      version: 5n,
      sourceEventId: "event-5",
      activeLeaseExpiresAt: null,
    })
    await expect(
      service.apply({
        ownerSubject: "consumer-1",
        state: "DELETING",
        version: 5n,
        sourceEventId: "event-other",
        activeLeaseExpiresAt: null,
      }),
    ).rejects.toBeInstanceOf(ConsumerLifecycleEventConflictError)
  })

  it("fails closed for missing, non-active, expired, and overlong leases", async () => {
    projection.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ state: "SUSPENDED", activeLeaseExpiresAt: null })
      .mockResolvedValueOnce({ state: "ACTIVE", activeLeaseExpiresAt: now })
      .mockResolvedValueOnce({
        state: "ACTIVE",
        activeLeaseExpiresAt: new Date(now.getTime() + 5 * 60_000 + 1),
      })

    for (let index = 0; index < 4; index += 1) {
      await expect(service.assertActive("consumer-1")).rejects.toBeInstanceOf(
        ConsumerLifecycleUnavailableError,
      )
    }
  })

  it("rejects ACTIVE ingestion without a future lease of at most five minutes", async () => {
    for (const activeLeaseExpiresAt of [
      null,
      now,
      new Date(now.getTime() + 5 * 60_000 + 1),
    ]) {
      await expect(
        service.apply({
          ownerSubject: "consumer-1",
          state: "ACTIVE",
          version: 1n,
          sourceEventId: "event-1",
          activeLeaseExpiresAt,
        }),
      ).rejects.toBeInstanceOf(ConsumerLifecycleEventConflictError)
    }
  })

  it("does not recreate a projection after a keyed erasure receipt exists", async () => {
    receipt.findFirst.mockResolvedValue({ id: "receipt-1" })
    const erasureAware = new ConsumerLifecycleService(prisma, {
      now: () => now,
      erasedSubjectDigest: () => Buffer.alloc(32, 7),
    })

    await expect(
      erasureAware.apply({
        ownerSubject: "consumer-1",
        state: "ACTIVE",
        version: 10n,
        sourceEventId: "event-10",
        activeLeaseExpiresAt: new Date(now.getTime() + 60_000),
      }),
    ).rejects.toBeInstanceOf(ConsumerLifecycleUnavailableError)
    expect(projection.create).not.toHaveBeenCalled()
  })
})
