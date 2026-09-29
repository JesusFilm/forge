import {
  resetUsageTestDatabase,
  usageTestDatabaseUrl as url,
} from "./usage-fixture.test-support.js"
import { beforeEach, expect, it } from "vitest"
import { PrismaClient } from "../../generated/prisma/index.js"
import { PostgresConsumerAccess } from "./consumer-access.js"
import { PostgresUsageInventory } from "./usage-inventory.js"
import { PostgresUsageStore } from "./consumer-usage.js"

beforeEach(() => resetUsageTestDatabase("synthetic"))

it.skipIf(!url)(
  "rejects terminal reconciliation retries without changing historical or replacement coverage",
  async () => {
    const db = new PrismaClient({ datasourceUrl: url! })
    try {
      const { consumer } = await new PostgresConsumerAccess(db).create({
        name: `retry-${crypto.randomUUID()}`,
        actorGithubUserId: "4801",
        allowedSourceKeys: [],
      })
      const store = new PostgresUsageStore(db, "synthetic")
      const inventory = new PostgresUsageInventory(db)
      const instance = crypto.randomUUID()
      const from = new Date("2029-01-01T00:00:00Z")
      const flushed = new Date("2029-01-01T00:01:00Z")
      const stopped = new Date("2029-01-01T00:02:00Z")
      const end = new Date("2029-01-01T00:03:00Z")
      const now = new Date("2029-01-01T00:04:00Z")
      await store.open(instance, from)
      const completed = await store.admit(
        instance,
        consumer.consumerId,
        new Date("2029-01-01T00:00:10Z"),
      )
      await store.complete(completed, true)
      await store.checkpoint(instance, flushed)
      await store.admit(
        instance,
        consumer.consumerId,
        new Date("2029-01-01T00:01:10Z"),
      )
      await store.reconcile(instance, stopped)
      await inventory.close("synthetic", stopped)
      await inventory.declare("replacement", stopped, 1)
      const replacement = new PostgresUsageStore(db, "replacement")
      const replacementId = crypto.randomUUID()
      await replacement.open(replacementId, stopped)
      const replacementAttempt = await replacement.admit(
        replacementId,
        consumer.consumerId,
        new Date("2029-01-01T00:02:10Z"),
      )
      await replacement.complete(replacementAttempt, true)
      await replacement.checkpoint(replacementId, end, true)
      await inventory.close("replacement", end)
      const windows = [
        { consumerId: consumer.consumerId, from, to: flushed },
        { consumerId: consumer.consumerId, from: flushed, to: stopped },
        { consumerId: consumer.consumerId, from: stopped, to: end },
      ]
      const before = await Promise.all(
        windows.map((window) => store.report(window, now)),
      )
      expect(before).toMatchObject([
        {
          requestCount: 1,
          successfulRequestCount: 1,
          coverageStatus: "complete",
          completeThrough: "2029-01-01T00:01:00.000Z",
        },
        {
          requestCount: 1,
          successfulRequestCount: 0,
          coverageStatus: "partial",
          completeThrough: "2029-01-01T00:01:00.000Z",
        },
        {
          requestCount: 1,
          successfulRequestCount: 1,
          coverageStatus: "complete",
          completeThrough: "2029-01-01T00:03:00.000Z",
        },
      ])
      await expect(store.reconcile(instance, now)).rejects.toMatchObject({
        code: "unavailable",
      })
      expect(
        await Promise.all(windows.map((window) => store.report(window, now))),
      ).toEqual(before)
      await expect(
        store.admit(instance, consumer.consumerId, now),
      ).rejects.toMatchObject({ code: "unavailable" })
    } finally {
      await db.$disconnect()
    }
  },
)
