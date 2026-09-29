import {
  resetUsageTestDatabase,
  usageTestDatabaseUrl as url,
} from "./usage-fixture.test-support.js"
import { PostgresUsageInventory } from "./usage-inventory.js"
import { beforeEach, expect, it } from "vitest"
import { PrismaClient } from "../../generated/prisma/index.js"
import { PostgresConsumerAccess } from "./consumer-access.js"
import { PostgresUsageStore } from "./consumer-usage.js"

beforeEach(() => resetUsageTestDatabase("synthetic"))
it.skipIf(!url)(
  "refuses complete coverage until every independently declared replica is instrumented",
  async () => {
    const db = new PrismaClient({ datasourceUrl: url! })
    try {
      const inventory = new PostgresUsageInventory(db)
      await inventory.close("synthetic", new Date("2020-01-01T00:00:00Z"))
      const from = new Date("2028-01-01T00:00:00Z"),
        to = new Date("2028-01-01T00:01:00Z"),
        now = new Date("2028-01-01T00:01:01Z")
      await inventory.declare("two-replicas", from, 2)
      const { consumer } = await new PostgresConsumerAccess(db).create({
        name: `replicas-${crypto.randomUUID()}`,
        actorGithubUserId: "4801",
        allowedSourceKeys: [],
      })
      const store = new PostgresUsageStore(db, "two-replicas"),
        first = crypto.randomUUID(),
        second = crypto.randomUUID()
      await store.open(first, from)
      await store.checkpoint(first, to)
      expect(
        await store.report({ consumerId: consumer.consumerId, from, to }, now),
      ).toMatchObject({ requestCount: 0, coverageStatus: "unavailable" })
      await store.open(second, from)
      const pending = await store.admit(
        second,
        consumer.consumerId,
        new Date("2028-01-01T00:00:10Z"),
      )
      expect(
        await store.report({ consumerId: consumer.consumerId, from, to }, now),
      ).toMatchObject({ coverageStatus: "unavailable" })
      await store.complete(pending, true)
      await store.checkpoint(second, to)
      expect(
        await store.report({ consumerId: consumer.consumerId, from, to }, now),
      ).toMatchObject({
        requestCount: 1,
        successfulRequestCount: 1,
        coverageStatus: "complete",
      })
      await inventory.close("two-replicas", to)
      await store.checkpoint(first, to, true)
      await store.checkpoint(second, to, true)
      expect(
        await store.report(
          {
            consumerId: consumer.consumerId,
            from: to,
            to: new Date("2028-01-01T00:02:00Z"),
          },
          now,
        ),
      ).toMatchObject({ coverageStatus: "unavailable" })
    } finally {
      await db.$disconnect()
    }
  },
)
