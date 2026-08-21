import { createHmac } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import {
  ConsumerLifecycleDeliveryError,
  ConsumerLifecycleOutboxService,
  SignedConsumerLifecycleSender,
} from "./consumer-lifecycle-outbox.service"

describe("SignedConsumerLifecycleSender", () => {
  it("signs a bounded lifecycle payload without putting the subject in headers", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(null, { status: 204 }),
    )
    const now = new Date("2026-08-21T12:00:00.000Z")
    const sender = new SignedConsumerLifecycleSender({
      endpoint:
        "https://admin.example.test/api/internal/user-playlists/lifecycle",
      secret: "lifecycle-secret",
      fetchImpl: fetchImpl as typeof fetch,
      now: () => now,
    })

    await sender.send({
      id: "event-1",
      ownerSubject: "consumer-1",
      state: "ACTIVE",
      version: 7n,
      activeLeaseExpiresAt: new Date("2026-08-21T12:05:00.000Z"),
    })

    const [, init] = fetchImpl.mock.calls[0]!
    const body = String(init?.body)
    const timestamp = String(
      (init?.headers as Record<string, string>)["x-forge-lifecycle-timestamp"],
    )
    expect(JSON.parse(body)).toEqual({
      ownerSubject: "consumer-1",
      state: "ACTIVE",
      version: "7",
      sourceEventId: "event-1",
      activeLeaseExpiresAt: "2026-08-21T12:05:00.000Z",
    })
    expect(init?.headers).not.toHaveProperty("authorization")
    expect(
      (init?.headers as Record<string, string>)["x-forge-lifecycle-signature"],
    ).toBe(
      `v1=${createHmac("sha256", "lifecycle-secret")
        .update(`${timestamp}.${body}`)
        .digest("hex")}`,
    )
  })
})

describe("ConsumerLifecycleOutboxService", () => {
  it("leases due work and acknowledges successes", async () => {
    const now = new Date("2026-08-21T12:00:00.000Z")
    const rows = [
      {
        id: "event-1",
        ownerSubject: "consumer-1",
        state: "ACTIVE",
        version: 1n,
        activeLeaseExpiresAt: new Date("2026-08-21T12:05:00.000Z"),
        attempts: 0,
      },
    ]
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
    const tx = {
      consumerLifecycleOutbox: {
        findMany: vi.fn(async () => rows),
        updateMany,
      },
    }
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
      consumerLifecycleOutbox: { updateMany },
    }
    const send = vi.fn().mockResolvedValue(undefined)
    const service = new ConsumerLifecycleOutboxService(prisma as never, {
      send,
      now: () => now,
    })

    await expect(service.deliverBatch("worker-1")).resolves.toEqual({
      delivered: 1,
      failed: 0,
    })
    expect(send).toHaveBeenCalledWith(rows[0])
    expect(tx.consumerLifecycleOutbox.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { status: "PENDING", nextAttemptAt: { lte: now } },
            { status: "LEASED", leaseExpiresAt: { lte: now } },
          ],
        },
      }),
    )
    expect(updateMany).toHaveBeenLastCalledWith({
      where: { id: "event-1", leaseOwner: "worker-1", status: "LEASED" },
      data: expect.objectContaining({
        status: "DELIVERED",
        deliveredAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
      }),
    })
  })

  it("requeues a transient failure with bounded backoff after reclaiming due work", async () => {
    const now = new Date("2026-08-21T12:00:00.000Z")
    const row = {
      id: "event-1",
      ownerSubject: "consumer-1",
      state: "ACTIVE",
      version: 1n,
      activeLeaseExpiresAt: new Date("2026-08-21T12:05:00.000Z"),
      attempts: 0,
    }
    const updateMany = vi.fn(async () => ({ count: 1 }))
    const tx = {
      consumerLifecycleOutbox: {
        findMany: vi.fn(async () => [row]),
        updateMany,
      },
    }
    const service = new ConsumerLifecycleOutboxService(
      {
        $transaction: vi.fn(async (callback) => callback(tx)),
        consumerLifecycleOutbox: { updateMany },
      } as never,
      {
        send: vi.fn(async () => {
          throw new ConsumerLifecycleDeliveryError("network")
        }),
        now: () => now,
      },
    )

    await expect(service.deliverBatch("worker-1")).resolves.toEqual({
      delivered: 0,
      failed: 1,
    })
    expect(updateMany).toHaveBeenLastCalledWith({
      where: { id: "event-1", leaseOwner: "worker-1", status: "LEASED" },
      data: {
        status: "PENDING",
        attempts: 1,
        nextAttemptAt: new Date("2026-08-21T12:00:02.000Z"),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: "network",
      },
    })
  })
})
