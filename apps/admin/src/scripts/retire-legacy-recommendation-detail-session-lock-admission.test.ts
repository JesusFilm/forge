import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import type { PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import { env } from "../config/env"
import {
  actualDatabaseGate,
  assertPermit,
} from "./retire-legacy-recommendation-detail-session"

vi.mock("../config/env", () => ({ env: { DD_VERSION: "a".repeat(40) } }))
vi.mock("../services/recommendations/legacy-quality-holds", () => ({
  assertOriginalQualityHolds: vi.fn(),
}))

const sourceFiles = [
  "src/scripts/retire-legacy-recommendation-campaign.ts",
  "src/services/recommendations/legacy-detail-retirement-campaign.ts",
  "src/scripts/retire-legacy-recommendation-detail.ts",
  "src/services/recommendations/legacy-detail-retirement.service.ts",
  "src/services/recommendations/legacy-candidate-trace-conversion.service.ts",
  "src/services/recommendations/legacy-quality-holds.ts",
  "src/scripts/retire-legacy-recommendation-detail-session.ts",
]
const sha = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex")
const identity = "owned-db:public:127.0.0.1:5432"
const source = () => ({
  revision: env.DD_VERSION!,
  targetDatabaseHash: sha(identity),
  sourceHashes: Object.fromEntries(
    sourceFiles.map((path) => [path, sha(readFileSync(path))]),
  ),
  reviewedAt: new Date().toISOString(),
  reviewReceiptSha256: "a".repeat(64),
})

function harness(samples: Array<{ wal_bytes: string; lock_waiters: number }>) {
  const tx = {
    $executeRawUnsafe: vi.fn(async (_sql: string) => 0),
    $queryRaw: vi.fn(async () => [{ identity }]),
    $queryRawUnsafe: vi.fn(async () => [samples.shift()]),
  }
  const db = {
    $transaction: vi.fn(
      async (
        operation: (value: typeof tx) => Promise<unknown>,
        _options?: { timeout: number },
      ) => operation(tx),
    ),
  }
  return { db: db as unknown as PrismaClient, transaction: db.$transaction, tx }
}

describe("legacy session read-only lock admission", () => {
  it("binds a finite unattended lease to the original source review on every permit check", () => {
    const now = Date.now()
    const clock = vi.spyOn(Date, "now").mockReturnValue(now)
    const reviewedAt = new Date(now - 3 * 60_000).toISOString()
    const campaignSource = { ...source(), reviewedAt }
    const campaignLease = {
      reviewedAt,
      expiresAt: new Date(now + 11 * 60 * 60_000).toISOString(),
      canonicalRegistrySha256: "c".repeat(64),
      reviewReceiptSha256: "d".repeat(64),
      holds: {
        qualitySelectorSha256:
          "c983ec02830d1b2df637c04e47fd75bdd66c26bd4e0caba0c38ff851561589a1",
        qualityRunIds: Array.from({ length: 64 }, (_, i) => `synthetic-${i}`),
        activeInvestigationRunIds: [],
      },
      authorization: {
        kind: "unattended-finite-v1" as const,
        scopeSha256: "e".repeat(64),
      },
    }
    const stopBefore = new Date(now + 20 * 60_000).toISOString()
    const campaignPermit = {
      measuredAt: new Date(now - 1_000).toISOString(),
      targetDatabaseHash: campaignSource.targetDatabaseHash,
      revision: campaignSource.revision,
      registrySha256: campaignLease.canonicalRegistrySha256,
      receiptSha256: "f".repeat(64),
      filesystemAvailableBytes: 10_000_000_000,
      walBytes: 100_000_000,
      httpHealthy: true as const,
      workerHealthy: true as const,
      compactWritersConverged: true as const,
      retentionHealthy: true as const,
      serving: {
        lastRequestAt: new Date(now - 1_000).toISOString(),
        requests: 1,
        latencySamples: 1,
        p95Ms: 100,
        maxMs: 100,
        unexpectedResultCount: 0 as const,
      },
      locks: {
        waiters: 0 as const,
        targetSessions: 0 as const,
        assignedWriteXidSessions: 0 as const,
      },
    }
    const check = (lease: unknown = campaignLease, reviewed = campaignSource) =>
      assertPermit(
        campaignPermit,
        reviewed,
        lease as typeof campaignLease,
        stopBefore,
      )
    try {
      expect(check).not.toThrow()
      expect(() =>
        check(campaignLease, {
          ...campaignSource,
          reviewedAt: new Date(now - 1_000).toISOString(),
        }),
      ).toThrow("lease")
      expect(() =>
        check({
          ...campaignLease,
          expiresAt: new Date(
            Date.parse(reviewedAt) + 12 * 60 * 60_000 + 1,
          ).toISOString(),
        }),
      ).toThrow("lease")
      expect(() => check({ ...campaignLease, expiresAt: reviewedAt })).toThrow(
        "lease",
      )
      expect(() =>
        check({ ...campaignLease, authorization: undefined }),
      ).toThrow("lease")
      expect(() => check({ ...campaignLease, authorization: null })).toThrow(
        "lease",
      )
      expect(() =>
        check({
          ...campaignLease,
          authorization: { kind: "other", scopeSha256: "e".repeat(64) },
        }),
      ).toThrow("lease")
      expect(() =>
        check({
          ...campaignLease,
          authorization: { ...campaignLease.authorization, extra: true },
        }),
      ).toThrow("lease")
      expect(() =>
        check({
          ...campaignLease,
          authorization: { ...campaignLease.authorization, scopeSha256: "bad" },
        }),
      ).toThrow("lease")
      clock.mockReturnValue(Date.parse(campaignLease.expiresAt))
      expect(check).toThrow("lease")
    } finally {
      clock.mockRestore()
    }
  })

  it("continues on the first zero-waiter sample without delaying", async () => {
    const { db, transaction, tx } = harness([
      { wal_bytes: "1000000", lock_waiters: 0 },
    ])
    await actualDatabaseGate(db, source())
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(tx.$queryRawUnsafe).toHaveBeenCalledTimes(1)
    expect(tx.$executeRawUnsafe.mock.calls.map(([sql]) => sql)).toEqual([
      "SET TRANSACTION READ ONLY",
      "SET LOCAL lock_timeout='1s'",
      "SET LOCAL statement_timeout='10s'",
      "SET LOCAL idle_in_transaction_session_timeout='15s'",
    ])
  })

  it("takes fresh read-only transactions until a transient waiter clears", async () => {
    const { db, transaction, tx } = harness([
      { wal_bytes: "1000000", lock_waiters: 1 },
      { wal_bytes: "1000000", lock_waiters: 1 },
      { wal_bytes: "1000000", lock_waiters: 0 },
    ])
    await actualDatabaseGate(db, source())
    expect(transaction).toHaveBeenCalledTimes(3)
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3)
    expect(tx.$queryRawUnsafe).toHaveBeenCalledTimes(3)
    expect(tx.$executeRawUnsafe).toHaveBeenCalledTimes(12)
    expect(
      transaction.mock.calls.every(
        ([, options]) => options?.timeout === 30_000,
      ),
    ).toBe(true)
  })

  it("refuses persistent waiters after exactly two additional samples", async () => {
    const { db, transaction, tx } = harness([
      { wal_bytes: "1000000", lock_waiters: 1 },
      { wal_bytes: "1000000", lock_waiters: 1 },
      { wal_bytes: "1000000", lock_waiters: 1 },
    ])
    await expect(actualDatabaseGate(db, source())).rejects.toThrow(
      "database-capacity",
    )
    expect(transaction).toHaveBeenCalledTimes(3)
    expect(tx.$queryRawUnsafe).toHaveBeenCalledTimes(3)
  })

  it.each(["2000000001", "not-a-wal-sample"])(
    "rejects WAL %s on its first sample even when a waiter exists",
    async (wal_bytes) => {
      const { db, transaction, tx } = harness([
        { wal_bytes, lock_waiters: 1 },
        { wal_bytes: "1000000", lock_waiters: 0 },
      ])
      await expect(actualDatabaseGate(db, source())).rejects.toThrow(
        "database-capacity",
      )
      expect(transaction).toHaveBeenCalledTimes(1)
      expect(tx.$queryRawUnsafe).toHaveBeenCalledTimes(1)
    },
  )

  it("rejects a changed target or source before any capacity grace", async () => {
    const target = harness([{ wal_bytes: "1000000", lock_waiters: 1 }])
    await expect(
      actualDatabaseGate(target.db, {
        ...source(),
        targetDatabaseHash: "b".repeat(64),
      }),
    ).rejects.toThrow("target")
    expect(target.transaction).toHaveBeenCalledTimes(1)
    expect(target.tx.$queryRawUnsafe).not.toHaveBeenCalled()

    const changed = harness([{ wal_bytes: "1000000", lock_waiters: 1 }])
    const badSource = source()
    badSource.sourceHashes[sourceFiles[0]!] = "b".repeat(64)
    await expect(actualDatabaseGate(changed.db, badSource)).rejects.toThrow(
      "source",
    )
    expect(changed.transaction).not.toHaveBeenCalled()
  })

  it("refuses a permit that ages out during grace and a future permit before admission", async () => {
    const originalNow = Date.now()
    let currentNow = originalNow
    const clock = vi.spyOn(Date, "now").mockImplementation(() => currentNow)
    const lease = {
      reviewedAt: new Date(originalNow - 60_000).toISOString(),
      expiresAt: new Date(originalNow + 29 * 60_000).toISOString(),
      canonicalRegistrySha256: "c".repeat(64),
      reviewReceiptSha256: "d".repeat(64),
      holds: {
        qualitySelectorSha256:
          "c983ec02830d1b2df637c04e47fd75bdd66c26bd4e0caba0c38ff851561589a1",
        qualityRunIds: Array.from({ length: 64 }, (_, i) => `synthetic-${i}`),
        activeInvestigationRunIds: [],
      },
    }
    const stopBefore = new Date(originalNow + 20 * 60_000).toISOString()
    const validSource = source()
    const permit = {
      measuredAt: new Date(originalNow - 89_900).toISOString(),
      targetDatabaseHash: validSource.targetDatabaseHash,
      revision: validSource.revision,
      registrySha256: lease.canonicalRegistrySha256,
      receiptSha256: "e".repeat(64),
      filesystemAvailableBytes: 10_000_000_000,
      walBytes: 100_000_000,
      httpHealthy: true as const,
      workerHealthy: true as const,
      compactWritersConverged: true as const,
      retentionHealthy: true as const,
      serving: {
        lastRequestAt: new Date(originalNow).toISOString(),
        requests: 10,
        latencySamples: 10,
        p95Ms: 100,
        maxMs: 200,
        unexpectedResultCount: 0 as const,
      },
      locks: {
        waiters: 0 as const,
        targetSessions: 0 as const,
        assignedWriteXidSessions: 0 as const,
      },
    }
    try {
      expect(() =>
        assertPermit(permit, validSource, lease, stopBefore),
      ).not.toThrow()
      const { db, tx } = harness([
        { wal_bytes: "1000000", lock_waiters: 1 },
        { wal_bytes: "1000000", lock_waiters: 0 },
      ])
      tx.$queryRawUnsafe
        .mockImplementationOnce(async () => [
          { wal_bytes: "1000000", lock_waiters: 1 },
        ])
        .mockImplementationOnce(async () => {
          currentNow = originalNow + 200
          return [{ wal_bytes: "1000000", lock_waiters: 0 }]
        })
      await actualDatabaseGate(db, validSource)
      expect(() =>
        assertPermit(permit, validSource, lease, stopBefore),
      ).toThrow("permit")
      expect(
        tx.$executeRawUnsafe.mock.calls.every(([sql]) =>
          String(sql).startsWith("SET "),
        ),
      ).toBe(true)

      const future = {
        ...permit,
        measuredAt: new Date(currentNow + 1_000).toISOString(),
      }
      expect(() =>
        assertPermit(future, validSource, lease, stopBefore),
      ).toThrow("permit")
    } finally {
      clock.mockRestore()
    }
  })
})
