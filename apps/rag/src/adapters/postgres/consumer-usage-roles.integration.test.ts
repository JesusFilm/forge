import {
  resetUsageTestDatabase,
  usageTestDatabaseUrl as url,
} from "./usage-fixture.test-support.js"
import { UsageError } from "../../contracts/consumer-usage.js"
import { PostgresUsageInventory } from "./usage-inventory.js"
import { beforeEach, expect, it } from "vitest"
import { PrismaClient } from "../../generated/prisma/index.js"
import { PostgresConsumerAccess } from "./consumer-access.js"
import { PostgresUsageStore } from "./consumer-usage.js"

beforeEach(() => resetUsageTestDatabase())
it.skipIf(!url)(
  "report and usage roles cannot read secrets or corpus and expose only approved capabilities",
  async () => {
    const { verifyUsageRoles, verifyUsageInventoryRole } =
      await import("../../../scripts/consumer-role-policy.js")
    const db = new PrismaClient({ datasourceUrl: url! })
    const suffix = crypto.randomUUID().replaceAll("-", "")
    const writerRole = `usage_writer_${suffix}`,
      readerRole = `usage_reader_${suffix}`,
      inventoryRole = `usage_inventory_${suffix}`
    const clients: PrismaClient[] = []
    try {
      for (const role of [writerRole, readerRole, inventoryRole]) {
        await db.$executeRawUnsafe(
          `CREATE ROLE ${role} LOGIN PASSWORD 'synthetic-only-test-password'`,
        )
        await db.$executeRawUnsafe(
          `GRANT USAGE ON SCHEMA usage_private TO ${role}`,
        )
        const connection = new URL(url!)
        connection.username = role
        connection.password = "synthetic-only-test-password"
        clients.push(new PrismaClient({ datasourceUrl: connection.toString() }))
      }
      await db.$executeRawUnsafe(
        `GRANT SELECT, INSERT, UPDATE ON usage_private.minutes, usage_private.collectors, usage_private.gaps, usage_private.denials TO ${writerRole}`,
      )
      await db.$executeRawUnsafe(
        `GRANT SELECT, INSERT, DELETE ON usage_private.pending TO ${writerRole}`,
      )
      await db.$executeRawUnsafe(
        `GRANT SELECT ON usage_private.consumer_labels, usage_private.report_minutes, usage_private.report_collectors, usage_private.report_pending, usage_private.report_gaps, usage_private.report_inventory TO ${readerRole}`,
      )
      await db.$executeRawUnsafe(
        `GRANT SELECT, INSERT, UPDATE ON usage_private.deployment_inventory TO ${inventoryRole}`,
      )
      await expect(
        verifyUsageInventoryRole(clients[2]),
      ).resolves.toBeUndefined()
      await expect(
        verifyUsageRoles(clients[0], clients[1]),
      ).resolves.toBeUndefined()
      const store = new PostgresUsageStore(clients[0])
      await new PostgresUsageInventory(clients[2]).declare(
        "unconfigured",
        new Date("2025-01-01T00:00:00Z"),
        1,
      )
      const { UsageCollector } = await import("../../serving/http/usage.js")
      const created = await new PostgresConsumerAccess(db).create({
        name: `outage-${crypto.randomUUID()}`,
        actorGithubUserId: "4801",
        allowedSourceKeys: [],
      })
      let clock = new Date("2025-01-01T00:00:00Z")
      const collector = new UsageCollector(store, () => clock)
      await collector.start()
      const reportReader = new PostgresUsageStore(clients[1])
      const window = {
        consumerId: created.consumer.consumerId,
        from: clock,
        to: new Date("2025-01-01T00:01:00Z"),
      }
      await db.$executeRawUnsafe(
        `REVOKE INSERT ON usage_private.minutes FROM ${writerRole}`,
      )
      clock = new Date("2025-01-01T00:00:10Z")
      await collector.admit(created.consumer.consumerId)
      expect(await reportReader.report(window, clock)).toMatchObject({
        coverageStatus: "unavailable",
      })
      await db.$executeRawUnsafe(
        `GRANT INSERT ON usage_private.minutes TO ${writerRole}`,
      )
      clock = new Date("2025-01-01T00:01:00Z")
      await collector.flush()
      expect(await reportReader.report(window, clock)).toMatchObject({
        requestCount: 0,
        successfulRequestCount: 0,
        coverageStatus: "partial",
      })
      // Completion loss remains pending/partial; finished HTTP retrieval is not blocked.
      const { serve } = await import("@hono/node-server")
      const { createApp } = await import("../../serving/http/app.js")
      const app = createApp({
        tokens: new Map(),
        usage: collector,
        consumerAuth: {
          authenticate: async () => ({
            consumerId: created.consumer.consumerId,
            allowedSourceKeys: [],
          }),
        },
        retriever: { search: async () => [] },
      })
      const server = serve({ fetch: app.fetch, port: 0 })
      await new Promise<void>((resolve) =>
        server.listening ? resolve() : server.once("listening", resolve),
      )
      const address = server.address()
      if (!address || typeof address === "string")
        throw new UsageError("unavailable")
      try {
        await db.$executeRawUnsafe(
          `REVOKE DELETE ON usage_private.pending FROM ${writerRole}`,
        )
        clock = new Date("2025-01-01T00:01:10Z")
        const response = await fetch(
          `http://127.0.0.1:${address.port}/v1/search`,
          {
            method: "POST",
            headers: { authorization: "Bearer rag_synthetic" },
            body: '{"query":"synthetic"}',
          },
        )
        expect(response.status).toBe(200)
        await collector.flush()
        await db.$executeRawUnsafe(
          `GRANT DELETE ON usage_private.pending TO ${writerRole}`,
        )
        await db.$executeRawUnsafe(
          `REVOKE UPDATE ON usage_private.collectors FROM ${writerRole}`,
        )
        clock = new Date("2025-01-01T00:01:20Z")
        await collector.flush()
        await db.$executeRawUnsafe(
          `GRANT UPDATE ON usage_private.collectors TO ${writerRole}`,
        )
        await db.$executeRawUnsafe(
          `REVOKE INSERT ON usage_private.gaps FROM ${writerRole}`,
        )
        clock = new Date("2025-01-01T00:02:00Z")
        await collector.flush()
        const extended = { ...window, to: clock }
        expect(await reportReader.report(extended, clock)).toMatchObject({
          requestCount: 1,
          successfulRequestCount: 0,
          coverageStatus: "unavailable",
        })
        await db.$executeRawUnsafe(
          `GRANT INSERT ON usage_private.gaps TO ${writerRole}`,
        )
        await collector.flush()
        expect(await reportReader.report(extended, clock)).toMatchObject({
          requestCount: 1,
          successfulRequestCount: 0,
          coverageStatus: "partial",
        })
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
      await collector.stop()
      await new PostgresUsageInventory(clients[2]).close("unconfigured", clock)
      await expect(
        clients[2].$executeRawUnsafe(
          "UPDATE usage_private.deployment_inventory SET expected_replicas=2",
        ),
      ).rejects.toThrow()
      for (const client of clients.slice(0, 2)) {
        await expect(
          client.$executeRawUnsafe(
            "UPDATE usage_private.deployment_inventory SET expected_replicas=1",
          ),
        ).rejects.toThrow()

        await expect(
          client.$queryRawUnsafe(
            "SELECT verifier FROM consumer_private.credentials",
          ),
        ).rejects.toThrow()
        await expect(
          client.$queryRawUnsafe("SELECT text FROM public.chunks"),
        ).rejects.toThrow()
        await expect(
          client.$queryRawUnsafe(
            "SELECT github_user_id FROM consumer_private.members",
          ),
        ).rejects.toThrow()
      }
      await expect(
        clients[1].$executeRawUnsafe("DELETE FROM usage_private.minutes"),
      ).rejects.toThrow()
      await db.$executeRawUnsafe(
        `GRANT UPDATE ON usage_private.minutes TO ${readerRole}`,
      )
      await expect(verifyUsageRoles(clients[0], clients[1])).rejects.toThrow()
    } finally {
      await Promise.all(clients.map((c) => c.$disconnect()))
      for (const role of [writerRole, readerRole, inventoryRole]) {
        await db.$executeRawUnsafe(`DROP OWNED BY ${role}`)
        await db.$executeRawUnsafe(`DROP ROLE ${role}`)
      }
      await db.$disconnect()
    }
  },
)
