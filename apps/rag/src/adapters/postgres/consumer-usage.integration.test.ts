import {
  resetUsageTestDatabase,
  usageTestDatabaseUrl as url,
} from "./usage-fixture.test-support.js"
import { beforeEach, expect, it } from "vitest"
import { PrismaClient } from "../../generated/prisma/index.js"
import { PostgresConsumerAccess } from "./consumer-access.js"
import { PostgresUsageStore } from "./consumer-usage.js"

beforeEach(() => resetUsageTestDatabase())
it.skipIf(!url)(
  "reports exact concurrent admissions and idempotent completions across rotation",
  async () => {
    const db = new PrismaClient({ datasourceUrl: url! })
    try {
      const access = new PostgresConsumerAccess(db)
      const { consumer } = await access.create({
        name: `usage-${crypto.randomUUID()}`,
        actorGithubUserId: "4801",
        allowedSourceKeys: [],
      })
      const store = new PostgresUsageStore(db)
      const start = new Date("2026-09-29T00:00:00Z")
      const attempts = await Promise.all(
        Array.from({ length: 3 }, () =>
          store.admit(consumer.consumerId, new Date("2026-09-29T00:00:10Z")),
        ),
      )
      await Promise.all(
        attempts.flatMap((id) => [
          store.complete(id, true),
          store.complete(id, true),
        ]),
      )
      expect(
        await store.report(
          {
            consumerId: consumer.consumerId,
            from: start,
            to: new Date("2026-09-29T00:01:00Z"),
          },
          new Date("2026-09-29T00:01:01Z"),
        ),
      ).toMatchObject({
        requestCount: 3,
        successfulRequestCount: 3,
        lastActivityAt: "2026-09-29T00:00:10.000Z",
      })
      await access.rotate({
        consumerId: consumer.consumerId,
        actorGithubUserId: "4801",
        expectedVersion: 1,
      })
      const more = await Promise.all(
        Array.from({ length: 2 }, () =>
          store.admit(consumer.consumerId, new Date("2026-09-29T00:01:20Z")),
        ),
      )
      await Promise.all(more.map((id) => store.complete(id, true)))
      expect(
        await store.report(
          {
            consumerId: consumer.consumerId,
            from: start,
            to: new Date("2026-09-29T00:02:00Z"),
          },
          new Date("2026-09-29T00:02:01Z"),
        ),
      ).toMatchObject({ requestCount: 5, successfulRequestCount: 5 })
    } finally {
      await db.$disconnect()
    }
  },
)
