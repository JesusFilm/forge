import { beforeEach, expect, it } from "vitest"
import { PrismaClient } from "../../generated/prisma/index.js"
import { PostgresConsumerAccess } from "./consumer-access.js"
import { PostgresUsageStore } from "./consumer-usage.js"
import {
  resetUsageTestDatabase,
  usageTestDatabaseUrl as url,
} from "./usage-fixture.test-support.js"

beforeEach(() => resetUsageTestDatabase())
it.skipIf(!url)(
  "returns recorded counts for the original range without deployment inventory or uninterrupted tracking",
  async () => {
    const db = new PrismaClient({ datasourceUrl: url! })
    try {
      const access = new PostgresConsumerAccess(db)
      const { consumer } = await access.create({
        name: `counts-${crypto.randomUUID()}`,
        actorGithubUserId: "4801",
        allowedSourceKeys: [],
      })
      const unused = await access.create({
        name: `unused-${crypto.randomUUID()}`,
        actorGithubUserId: "4801",
        allowedSourceKeys: [],
      })
      const at = new Date("2026-09-29T03:41:32Z")
      await db.$executeRaw`INSERT INTO usage_private.minutes(consumer_id, minute, request_count, successful_count, last_activity_at) VALUES(${consumer.consumerId}::uuid, date_trunc('minute', ${at}::timestamptz, 'UTC'), 5, 5, ${at})`
      const window = {
        consumerId: consumer.consumerId,
        from: new Date("2026-09-22T05:17:00Z"),
        to: new Date("2026-09-29T05:17:00Z"),
      }
      const report = await new PostgresUsageStore(db).report(window)
      expect(report).toMatchObject({
        requestCount: 5,
        successfulRequestCount: 5,
        windowStart: window.from.toISOString(),
        windowEnd: window.to.toISOString(),
        lastActivityAt: at.toISOString(),
      })
      expect(report).not.toHaveProperty("coverageStatus")
      expect(report).not.toHaveProperty("completeThrough")
      expect(
        await new PostgresUsageStore(db).report({
          ...window,
          consumerId: unused.consumer.consumerId,
        }),
      ).toMatchObject({
        requestCount: 0,
        successfulRequestCount: 0,
        lastActivityAt: null,
      })
    } finally {
      await db.$disconnect()
    }
  },
)

it.skipIf(!url)(
  "keeps admission date boundaries, incomplete attempts and old/new deployment writes without double counting",
  async () => {
    const db = new PrismaClient({ datasourceUrl: url! })
    try {
      const { consumer } = await new PostgresConsumerAccess(db).create({
        name: `boundaries-${crypto.randomUUID()}`,
        actorGithubUserId: "4801",
        allowedSourceKeys: [],
      })
      const store = new PostgresUsageStore(db)
      const from = new Date("2026-09-29T03:41:00Z"),
        to = new Date("2026-09-29T03:43:00Z")
      // A previous binary can still use its collector ID during the rolling migration.
      const collector = crypto.randomUUID(),
        legacyAttempt = crypto.randomUUID()
      await db.$executeRaw`INSERT INTO usage_private.collectors(id, started_at, complete_through, heartbeat_at) VALUES(${collector}::uuid, ${from}, ${from}, ${from})`
      await db.$executeRaw`INSERT INTO usage_private.pending(id, collector_id, consumer_id, admitted_at) VALUES(${legacyAttempt}::uuid, ${collector}::uuid, ${consumer.consumerId}::uuid, ${from})`
      await db.$executeRaw`INSERT INTO usage_private.minutes(consumer_id, minute, request_count, last_activity_at) VALUES(${consumer.consumerId}::uuid, ${from}, 1, ${from})`
      await db.$executeRaw`INSERT INTO usage_private.gaps(collector_id, started_at, ended_at) VALUES(${collector}::uuid, ${from}, ${to})`
      await store.complete(legacyAttempt, true)
      const before = await store.admit(
        consumer.consumerId,
        new Date(from.getTime() - 1),
      )
      await store.complete(before, true)
      // An unfinished request remains in requests without being guessed successful.
      await store.admit(consumer.consumerId, new Date("2026-09-29T03:42:10Z"))
      const atEnd = await store.admit(consumer.consumerId, to)
      await store.complete(atEnd, true)
      const report = await store.report({
        consumerId: consumer.consumerId,
        from,
        to,
      })
      expect(report).toMatchObject({
        requestCount: 2,
        successfulRequestCount: 1,
        lastActivityAt: "2026-09-29T03:42:10.000Z",
        windowStart: from.toISOString(),
        windowEnd: to.toISOString(),
      })
      expect(report).not.toHaveProperty("coverageStatus")
      const pending = await db.$queryRaw<
        Array<{ collector_id: string | null }>
      >`SELECT collector_id FROM usage_private.pending WHERE consumer_id=${consumer.consumerId}::uuid`
      expect(pending).toEqual([{ collector_id: null }])
      await store.complete(legacyAttempt, true)
      expect(
        await store.report({ consumerId: consumer.consumerId, from, to }),
      ).toMatchObject({ requestCount: 2, successfulRequestCount: 1 })
      expect(
        await store.report({
          consumerId: consumer.consumerId,
          from: new Date("2020-01-01T00:00:00Z"),
          to: new Date("2020-01-02T00:00:00Z"),
        }),
      ).toMatchObject({ requestCount: 0, successfulRequestCount: 0 })
      await expect(
        store.report({ consumerId: crypto.randomUUID(), from, to }),
      ).rejects.toMatchObject({ code: "unknown_consumer" })
    } finally {
      await db.$disconnect()
    }
  },
)
