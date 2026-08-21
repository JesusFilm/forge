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
        findFirst: vi.fn(async () => null),
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

    await expect(service.deliverBatch("worker-1", 1)).resolves.toEqual({
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

  it("leases just in time so another worker cannot reclaim a slow in-flight owner version", async () => {
    const now = new Date("2026-08-21T12:00:00.000Z")
    const rows = [
      {
        id: "event-1",
        ownerSubject: "consumer-1",
        state: "ACTIVE" as const,
        version: 1n,
        activeLeaseExpiresAt: new Date("2026-08-21T12:05:00.000Z"),
        attempts: 0,
        status: "PENDING",
        nextAttemptAt: now,
        leaseOwner: null as string | null,
        leaseExpiresAt: null as Date | null,
        createdAt: now,
      },
      {
        id: "event-2",
        ownerSubject: "consumer-1",
        state: "ACTIVE" as const,
        version: 2n,
        activeLeaseExpiresAt: new Date("2026-08-21T12:05:00.000Z"),
        attempts: 0,
        status: "PENDING",
        nextAttemptAt: now,
        leaseOwner: null as string | null,
        leaseExpiresAt: null as Date | null,
        createdAt: new Date(now.getTime() + 1),
      },
    ]
    const outbox = {
      findMany: vi.fn(async () =>
        rows.filter(
          (row) =>
            (row.status === "PENDING" && row.nextAttemptAt <= now) ||
            (row.status === "LEASED" &&
              row.leaseExpiresAt !== null &&
              row.leaseExpiresAt <= now),
        ),
      ),
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { ownerSubject: string; version: { lt: bigint } }
        }) =>
          rows.find(
            (row) =>
              row.ownerSubject === where.ownerSubject &&
              row.version < where.version.lt &&
              row.status !== "DELIVERED",
          ) ?? null,
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; leaseOwner?: string; status?: string }
          data: Record<string, unknown>
        }) => {
          const row = rows.find((candidate) => candidate.id === where.id)
          if (!row) return { count: 0 }
          if (where.leaseOwner && row.leaseOwner !== where.leaseOwner) {
            return { count: 0 }
          }
          if (where.status && row.status !== where.status) return { count: 0 }
          if (!where.leaseOwner && row.status !== "PENDING") return { count: 0 }
          Object.assign(row, data)
          return { count: 1 }
        },
      ),
    }
    const prisma = {
      $transaction: vi.fn(async (callback) =>
        callback({ consumerLifecycleOutbox: outbox }),
      ),
      consumerLifecycleOutbox: outbox,
    }
    let releaseSend!: () => void
    const slowSend = vi.fn(
      () => new Promise<void>((resolve) => (releaseSend = resolve)),
    )
    const first = new ConsumerLifecycleOutboxService(prisma as never, {
      send: slowSend,
      now: () => now,
    })
    const second = new ConsumerLifecycleOutboxService(prisma as never, {
      send: vi.fn().mockResolvedValue(undefined),
      now: () => now,
    })

    const firstRun = first.deliverBatch("worker-1", 1)
    await vi.waitFor(() => expect(slowSend).toHaveBeenCalledTimes(1))
    expect(rows[0]?.status).toBe("LEASED")
    await expect(
      outbox.findFirst({
        where: { ownerSubject: "consumer-1", version: { lt: 2n } },
      }),
    ).resolves.toMatchObject({ id: "event-1" })

    await expect(second.deliverBatch("worker-2", 1)).resolves.toEqual({
      delivered: 0,
      failed: 0,
    })
    expect(rows[1]?.status).toBe("PENDING")

    releaseSend()
    await expect(firstRun).resolves.toEqual({ delivered: 1, failed: 0 })
  })

  it("does not count a delivery when lease ownership was lost before acknowledgement", async () => {
    const now = new Date("2026-08-21T12:00:00.000Z")
    const row = {
      id: "event-1",
      ownerSubject: "consumer-1",
      state: "ACTIVE" as const,
      version: 1n,
      activeLeaseExpiresAt: new Date("2026-08-21T12:05:00.000Z"),
      attempts: 0,
    }
    const tx = {
      consumerLifecycleOutbox: {
        findMany: vi.fn().mockResolvedValueOnce([row]).mockResolvedValue([]),
        findFirst: vi.fn(async () => null),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    }
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
      consumerLifecycleOutbox: {
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    }
    const service = new ConsumerLifecycleOutboxService(prisma as never, {
      send: vi.fn().mockResolvedValue(undefined),
      now: () => now,
    })

    await expect(service.deliverBatch("worker-1", 1)).resolves.toEqual({
      delivered: 0,
      failed: 0,
    })
  })

  it("does not count a failed delivery when lease ownership was lost before requeue", async () => {
    const now = new Date("2026-08-21T12:00:00.000Z")
    const row = {
      id: "event-1",
      ownerSubject: "consumer-1",
      state: "ACTIVE" as const,
      version: 1n,
      activeLeaseExpiresAt: new Date("2026-08-21T12:05:00.000Z"),
      attempts: 0,
    }
    const tx = {
      consumerLifecycleOutbox: {
        findMany: vi.fn(async () => [row]),
        findFirst: vi.fn(async () => null),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    }
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
      consumerLifecycleOutbox: {
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    }
    const service = new ConsumerLifecycleOutboxService(prisma as never, {
      send: vi.fn(async () => {
        throw new ConsumerLifecycleDeliveryError("network")
      }),
      now: () => now,
    })

    await expect(service.deliverBatch("worker-1", 1)).resolves.toEqual({
      delivered: 0,
      failed: 0,
    })
  })

  it("reports pending, leased, due, and DEAD backlog health", async () => {
    const now = new Date("2026-08-21T12:00:00.000Z")
    const count = vi
      .fn()
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(3)
    const service = new ConsumerLifecycleOutboxService(
      { consumerLifecycleOutbox: { count } } as never,
      { send: vi.fn(), now: () => now },
    )

    await expect(service.getHealth()).resolves.toEqual({
      pending: 4,
      leased: 2,
      dead: 1,
      due: 3,
      backlog: 7,
    })
    expect(count).toHaveBeenLastCalledWith({
      where: {
        OR: [
          { status: "PENDING", nextAttemptAt: { lte: now } },
          { status: "LEASED", leaseExpiresAt: { lte: now } },
        ],
      },
    })
  })

  it("retries a serializable lease conflict between workers", async () => {
    const conflict = Object.assign(new Error("write conflict"), {
      code: "P2034",
    })
    const transaction = vi
      .fn()
      .mockRejectedValueOnce(conflict)
      .mockImplementationOnce(async (callback) =>
        callback({
          consumerLifecycleOutbox: {
            findMany: vi.fn(async () => []),
          },
        }),
      )
    const service = new ConsumerLifecycleOutboxService(
      {
        $transaction: transaction,
        consumerLifecycleOutbox: { updateMany: vi.fn() },
      } as never,
      { send: vi.fn() },
    )

    await expect(service.deliverBatch("worker-1", 1)).resolves.toEqual({
      delivered: 0,
      failed: 0,
    })
    expect(transaction).toHaveBeenCalledTimes(2)
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
        findFirst: vi.fn(async () => null),
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

    await expect(service.deliverBatch("worker-1", 1)).resolves.toEqual({
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
