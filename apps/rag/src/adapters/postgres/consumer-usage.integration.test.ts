import {
  resetUsageTestDatabase,
  usageTestDatabaseUrl as url,
} from "./usage-fixture.test-support.js"
import { beforeEach, expect, it } from "vitest"
import { PrismaClient } from "../../generated/prisma/index.js"
import { PostgresConsumerAccess } from "./consumer-access.js"
import { PostgresUsageStore } from "./consumer-usage.js"

beforeEach(() => resetUsageTestDatabase("synthetic"))
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
      const instance = crypto.randomUUID()
      const store = new PostgresUsageStore(db, "synthetic")
      const start = new Date("2026-09-29T00:00:00Z")
      await store.open(instance, start)
      const attempts = await Promise.all(
        Array.from({ length: 3 }, () =>
          store.admit(
            instance,
            consumer.consumerId,
            new Date("2026-09-29T00:00:10Z"),
          ),
        ),
      )
      await Promise.all(
        attempts.flatMap((id) => [
          store.complete(id, true),
          store.complete(id, true),
        ]),
      )
      await store.checkpoint(instance, new Date("2026-09-29T00:01:00Z"))
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
        coverageStatus: "complete",
        lastActivityAt: "2026-09-29T00:00:10.000Z",
      })
      await access.rotate({
        consumerId: consumer.consumerId,
        actorGithubUserId: "4801",
        expectedVersion: 1,
      })
      const more = await Promise.all(
        Array.from({ length: 2 }, () =>
          store.admit(
            instance,
            consumer.consumerId,
            new Date("2026-09-29T00:01:20Z"),
          ),
        ),
      )
      await Promise.all(more.map((id) => store.complete(id, true)))
      await store.checkpoint(instance, new Date("2026-09-29T00:02:00Z"))
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

it.skipIf(!url)(
  "reports pending, historical gaps and crashed collectors honestly, and isolates consumers",
  async () => {
    const db = new PrismaClient({ datasourceUrl: url! })
    try {
      const access = new PostgresConsumerAccess(db)
      const first = await access.create({
        name: `coverage-${crypto.randomUUID()}`,
        actorGithubUserId: "4801",
        allowedSourceKeys: [],
      })
      const second = await access.create({
        name: `unused-${crypto.randomUUID()}`,
        actorGithubUserId: "4801",
        allowedSourceKeys: [],
      })
      const store = new PostgresUsageStore(db, "synthetic"),
        instance = crypto.randomUUID()
      const from = new Date("2027-01-01T00:00:00Z"),
        to = new Date("2027-01-01T00:01:00Z"),
        now = new Date("2027-01-01T00:01:01Z")
      await store.open(instance, from)
      const attempt = await store.admit(
        instance,
        first.consumer.consumerId,
        new Date("2027-01-01T00:00:10Z"),
      )
      await store.checkpoint(instance, to)
      expect(
        await store.report(
          { consumerId: first.consumer.consumerId, from, to },
          now,
        ),
      ).toMatchObject({
        requestCount: 1,
        successfulRequestCount: 0,
        coverageStatus: "partial",
      })
      await store.complete(attempt, false)
      expect(
        await store.report(
          { consumerId: second.consumer.consumerId, from, to },
          now,
        ),
      ).toMatchObject({
        requestCount: 0,
        successfulRequestCount: 0,
        lastActivityAt: null,
        coverageStatus: "complete",
      })
      const otherAttempt = await store.admit(
        instance,
        second.consumer.consumerId,
        new Date("2027-01-01T00:01:10Z"),
      )
      await store.complete(otherAttempt, true)
      await store.checkpoint(instance, new Date("2027-01-01T00:02:00Z"))
      expect(
        await store.report(
          {
            consumerId: second.consumer.consumerId,
            from,
            to: new Date("2027-01-01T00:02:00Z"),
          },
          new Date("2027-01-01T00:02:01Z"),
        ),
      ).toMatchObject({ requestCount: 1, successfulRequestCount: 1 })
      expect(
        await store.report(
          {
            consumerId: first.consumer.consumerId,
            from,
            to: new Date("2027-01-01T00:02:00Z"),
          },
          new Date("2027-01-01T00:02:01Z"),
        ),
      ).toMatchObject({ requestCount: 1, successfulRequestCount: 0 })
      expect(
        await store.report(
          { consumerId: second.consumer.consumerId, from, to },
          new Date("2027-01-01T00:03:00Z"),
        ),
      ).toMatchObject({
        requestCount: 0,
        successfulRequestCount: 0,
        coverageStatus: "complete",
      })
      await store.gap(
        instance,
        new Date("2027-01-01T00:00:20Z"),
        new Date("2027-01-01T00:00:30Z"),
      )
      expect(
        await store.report(
          { consumerId: second.consumer.consumerId, from, to },
          now,
        ),
      ).toMatchObject({ coverageStatus: "partial" })
      expect(
        await store.report(
          {
            consumerId: second.consumer.consumerId,
            from,
            to: new Date("2027-01-01T00:03:00Z"),
          },
          new Date("2027-01-01T00:03:00Z"),
        ),
      ).toMatchObject({ coverageStatus: "unavailable" })
      await store.reconcile(instance, new Date("2027-01-01T00:03:00Z"))
      expect(
        await store.report(
          { consumerId: second.consumer.consumerId, from, to },
          new Date("2027-01-01T00:02:01Z"),
        ),
      ).toMatchObject({ coverageStatus: "partial" })
      expect(
        await store.report(
          {
            consumerId: second.consumer.consumerId,
            from: new Date("2020-01-01T00:00:00Z"),
            to: new Date("2020-01-01T00:01:00Z"),
          },
          now,
        ),
      ).toMatchObject({ coverageStatus: "unavailable" })
      await expect(
        store.report({ consumerId: crypto.randomUUID(), from, to }, now),
      ).rejects.toMatchObject({ code: "unknown_consumer" })
    } finally {
      await db.$disconnect()
    }
  },
)
