import { describe, expect, it, vi } from "vitest"

import { PushInputError } from "./errors"
import {
  PUSH_RETENTION_MAX_BATCH_SIZE,
  purgeExpiredPushRows,
  readPushRetentionHealth,
} from "./retention.service"

const NOW = new Date("2026-09-21T10:30:00.000Z")

function buildPrisma(options: { locked?: boolean } = {}) {
  const deleteMany = (count: number) => vi.fn(async () => ({ count }))
  const transaction = {
    $queryRaw: vi.fn(async () => [{ locked: options.locked ?? true }]),
    pushAttribution: {
      findMany: vi.fn(async () => [{ id: "attribution-1" }]),
      deleteMany: deleteMany(1),
      findFirst: vi.fn(async (): Promise<{ createdAt: Date } | null> => null),
    },
    pushOpen: {
      findMany: vi.fn(async () => [{ id: "open-1" }, { id: "open-2" }]),
      deleteMany: deleteMany(2),
      findFirst: vi.fn(async (): Promise<{ createdAt: Date } | null> => null),
    },
    pushDelivery: {
      findMany: vi.fn(async () => [{ id: "delivery-1" }]),
      deleteMany: deleteMany(1),
      findFirst: vi.fn(async (): Promise<{ createdAt: Date } | null> => null),
    },
    pushRegistration: {
      findMany: vi
        .fn()
        .mockResolvedValueOnce([{ id: "stale-1" }])
        .mockResolvedValueOnce([{ id: "retired-1" }, { id: "retired-2" }]),
      updateMany: vi.fn(async () => ({ count: 1 })),
      deleteMany: deleteMany(2),
    },
  }
  const prisma = {
    $transaction: vi.fn(async (run: (tx: typeof transaction) => unknown) =>
      run(transaction),
    ),
  }
  return { prisma, transaction }
}

describe("push retention purge", () => {
  it("deletes expired rows and retires stale registrations in one locked pass", async () => {
    const { prisma, transaction } = buildPrisma()

    const result = await purgeExpiredPushRows(prisma as never, NOW, 5_000)

    expect(result.status).toBe("succeeded")
    expect(result.rowCounts).toEqual({
      expiredAttributions: 1,
      expiredOpens: 2,
      expiredDeliveries: 1,
      registrationsMarkedInactive: 1,
      retiredRegistrationsDeleted: 2,
    })
    expect(result.overdueAfterRun).toBe(false)
    expect(result.oldestExpiredAtAfter).toBeNull()
    // Children first: an open's delivery must outlive the open's own delete.
    const order = [
      transaction.pushAttribution.deleteMany,
      transaction.pushOpen.deleteMany,
      transaction.pushDelivery.deleteMany,
    ].map((spy) => spy.mock.invocationCallOrder[0])
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it("purges rows older than 90 days and retires registrations at 180 days", async () => {
    const { prisma, transaction } = buildPrisma()

    await purgeExpiredPushRows(prisma as never, NOW, 5_000)

    const rowCutoff = new Date("2026-06-23T10:30:00.000Z")
    expect(transaction.pushOpen.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { createdAt: { lte: rowCutoff } } }),
    )
    expect(transaction.pushRegistration.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          refreshedAt: { lte: new Date("2026-03-25T10:30:00.000Z") },
        }),
      }),
    )
    expect(transaction.pushRegistration.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["retired-1", "retired-2"] } },
    })
  })

  it("keeps every delete inside the batch size", async () => {
    const { prisma, transaction } = buildPrisma()

    await purgeExpiredPushRows(prisma as never, NOW, 250)

    for (const spy of [
      transaction.pushAttribution.findMany,
      transaction.pushOpen.findMany,
      transaction.pushDelivery.findMany,
    ]) {
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ take: 250 }))
    }
  })

  it("skips the pass when another worker holds the lock", async () => {
    const { prisma, transaction } = buildPrisma({ locked: false })

    const result = await purgeExpiredPushRows(prisma as never, NOW)

    expect(result.status).toBe("skipped")
    expect(result.rowCounts).toEqual({})
    expect(transaction.pushDelivery.deleteMany).not.toHaveBeenCalled()
    expect(transaction.pushRegistration.deleteMany).not.toHaveBeenCalled()
  })

  it("reports more work when expired rows remain after the pass", async () => {
    const { prisma, transaction } = buildPrisma()
    transaction.pushOpen.findFirst.mockResolvedValue({
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    })

    const result = await purgeExpiredPushRows(prisma as never, NOW, 5_000)

    expect(result.overdueAfterRun).toBe(true)
    expect(result.oldestExpiredAtAfter).toBe("2026-01-01T00:00:00.000Z")
  })

  it.each([0, -1, 1.5, PUSH_RETENTION_MAX_BATCH_SIZE + 1])(
    "refuses the invalid batch size %s",
    async (batchSize) => {
      const { prisma } = buildPrisma()

      await expect(
        purgeExpiredPushRows(prisma as never, NOW, batchSize),
      ).rejects.toBeInstanceOf(PushInputError)
      expect(prisma.$transaction).not.toHaveBeenCalled()
    },
  )
})

describe("push retention health", () => {
  function healthPrisma(rows: {
    latestSuccessAt: Date | null
    oldestOverdueAt: Date | null
  }) {
    return {
      workflowRun: {
        findFirst: vi.fn(async () =>
          rows.latestSuccessAt ? { finishedAt: rows.latestSuccessAt } : null,
        ),
      },
      pushDelivery: {
        findFirst: vi.fn(async () =>
          rows.oldestOverdueAt ? { createdAt: rows.oldestOverdueAt } : null,
        ),
      },
      pushOpen: { findFirst: vi.fn(async () => null) },
      pushAttribution: { findFirst: vi.fn(async () => null) },
    }
  }

  it("is healthy when the purge ran recently and nothing is overdue", async () => {
    const prisma = healthPrisma({
      latestSuccessAt: new Date("2026-09-21T00:00:00.000Z"),
      oldestOverdueAt: null,
    })

    await expect(
      readPushRetentionHealth(prisma as never, NOW),
    ).resolves.toEqual({
      healthy: true,
      reason: "healthy",
      latestSuccessAt: new Date("2026-09-21T00:00:00.000Z"),
      oldestOverdueAt: null,
    })
  })

  it("reports the oldest overdue row before it reports a stale watermark", async () => {
    const prisma = healthPrisma({
      latestSuccessAt: null,
      oldestOverdueAt: new Date("2026-01-01T00:00:00.000Z"),
    })

    await expect(
      readPushRetentionHealth(prisma as never, NOW),
    ).resolves.toMatchObject({
      healthy: false,
      reason: "retention_overdue",
      oldestOverdueAt: new Date("2026-01-01T00:00:00.000Z"),
    })
  })

  it("reports a missing watermark when no purge succeeded in 36 hours", async () => {
    const prisma = healthPrisma({
      latestSuccessAt: new Date("2026-09-18T00:00:00.000Z"),
      oldestOverdueAt: null,
    })

    await expect(
      readPushRetentionHealth(prisma as never, NOW),
    ).resolves.toMatchObject({
      healthy: false,
      reason: "missing_success_watermark",
    })
  })
})
