import { beforeEach, expect, it, vi } from "vitest"
import { PrismaClient } from "../../generated/prisma/index.js"
import { PostgresConsumerAccess } from "./consumer-access.js"
import { PostgresUsageStore } from "./consumer-usage.js"
import { verifyUsageRoles } from "../../../scripts/consumer-role-policy.js"
import {
  resetUsageTestDatabase,
  usageTestDatabaseUrl as url,
} from "./usage-fixture.test-support.js"

beforeEach(() => resetUsageTestDatabase())
it.skipIf(!url)(
  "minimal usage roles work without coverage privileges; write failure does not suppress stored counts",
  async () => {
    const admin = new PrismaClient({ datasourceUrl: url! })
    const suffix = crypto.randomUUID().replaceAll("-", "")
    const roles = [`usage_writer_${suffix}`, `usage_reader_${suffix}`]
    const clients: PrismaClient[] = []
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      for (const role of roles) {
        await admin.$executeRawUnsafe(
          `CREATE ROLE ${role} LOGIN PASSWORD 'synthetic-only'`,
        )
        await admin.$executeRawUnsafe(
          `GRANT USAGE ON SCHEMA usage_private TO ${role}`,
        )
        const connection = new URL(url!)
        connection.username = role
        connection.password = "synthetic-only"
        clients.push(new PrismaClient({ datasourceUrl: connection.toString() }))
      }
      await admin.$executeRawUnsafe(
        `GRANT SELECT, INSERT, UPDATE ON usage_private.minutes, usage_private.denials TO ${roles[0]}`,
      )
      await admin.$executeRawUnsafe(
        `GRANT SELECT, INSERT, DELETE ON usage_private.pending TO ${roles[0]}`,
      )
      await admin.$executeRawUnsafe(
        `GRANT SELECT ON usage_private.consumer_labels, usage_private.report_minutes TO ${roles[1]}`,
      )
      await verifyUsageRoles(clients[0], clients[1])
      const { consumer } = await new PostgresConsumerAccess(admin).create({
        name: `roles-${suffix}`,
        actorGithubUserId: "4801",
        allowedSourceKeys: [],
      })
      const writer = new PostgresUsageStore(clients[0]),
        reader = new PostgresUsageStore(clients[1])
      const at = new Date("2026-09-29T03:41:10Z"),
        window = {
          consumerId: consumer.consumerId,
          from: new Date("2026-09-22T05:17:00Z"),
          to: new Date("2026-09-29T05:17:00Z"),
        }
      const id = await writer.admit(consumer.consumerId, at)
      await writer.complete(id, true)
      await admin.$executeRawUnsafe(
        `REVOKE INSERT ON usage_private.minutes FROM ${roles[0]}`,
      )
      await expect(writer.admit(consumer.consumerId, at)).rejects.toThrow()
      expect(await reader.report(window)).toMatchObject({
        requestCount: 1,
        successfulRequestCount: 1,
      })
      await admin.$executeRawUnsafe(
        `GRANT INSERT ON usage_private.minutes TO ${roles[0]}`,
      )
      const pending = await writer.admit(consumer.consumerId, at)
      await admin.$executeRawUnsafe(
        `REVOKE DELETE ON usage_private.pending FROM ${roles[0]}`,
      )
      await expect(writer.complete(pending, true)).rejects.toThrow()
      expect(await reader.report(window)).toMatchObject({
        requestCount: 2,
        successfulRequestCount: 1,
      })
      await admin.$executeRawUnsafe(
        `GRANT DELETE ON usage_private.pending TO ${roles[0]}`,
      )
      await writer.complete(pending, true)
      expect(await reader.report(window)).toMatchObject({
        requestCount: 2,
        successfulRequestCount: 2,
      })
      for (const client of clients) {
        await expect(
          client.$queryRawUnsafe("SELECT * FROM consumer_private.credentials"),
        ).rejects.toThrow()
        await expect(
          client.$queryRawUnsafe("SELECT * FROM public.chunks"),
        ).rejects.toThrow()
        await expect(
          client.$executeRawUnsafe(
            "UPDATE usage_private.deployment_inventory SET expected_replicas=2",
          ),
        ).rejects.toThrow()
      }
      // Existing deployments retain optional historical metadata grants without requiring upkeep.
      await admin.$executeRawUnsafe(
        `GRANT SELECT, INSERT, UPDATE ON usage_private.collectors, usage_private.gaps TO ${roles[0]}`,
      )
      await admin.$executeRawUnsafe(
        `GRANT SELECT ON usage_private.report_collectors, usage_private.report_pending, usage_private.report_gaps, usage_private.report_inventory TO ${roles[1]}`,
      )
      await verifyUsageRoles(clients[0], clients[1])
      await admin.$executeRawUnsafe(
        `GRANT SELECT ON public.chunks TO ${roles[1]}`,
      )
      await expect(verifyUsageRoles(clients[0], clients[1])).rejects.toThrow()
    } finally {
      log.mockRestore()
      await Promise.all(clients.map((client) => client.$disconnect()))
      for (const role of roles) {
        await admin.$executeRawUnsafe(`DROP OWNED BY ${role}`)
        await admin.$executeRawUnsafe(`DROP ROLE ${role}`)
      }
      await admin.$disconnect()
    }
  },
)
