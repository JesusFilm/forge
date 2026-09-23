import { PrismaClient } from "../src/generated/prisma/index.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  ConsumerRegistryError,
  PostgresConsumerRegistry,
} from "../src/adapters/postgres/consumer-registry.js"

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl)
  throw new Error(
    "DATABASE_URL is required for consumer registry integration tests",
  )

const db = new PrismaClient({ datasourceUrl: databaseUrl })
const registry = new PostgresConsumerRegistry(db)
const suffix = crypto.randomUUID().slice(0, 8)

beforeAll(() => db.$connect())
afterAll(() => db.$disconnect())

describe("restricted consumer registry", () => {
  it("creates stable identity and an owner atomically", async () => {
    const consumer = await registry.create({
      name: `registry-${suffix}`,
      ownerGithubUserId: "101",
    })
    expect(consumer.state).toBe("pending")
    expect(consumer.allowedSourceKeys).toEqual([])
    expect(await registry.findById(consumer.consumerId)).toEqual(consumer)
    expect(await registry.listMembers(consumer.consumerId)).toEqual([
      { githubUserId: "101", role: "owner" },
    ])
    await expect(
      registry.create({ name: `registry-${suffix}`, ownerGithubUserId: "102" }),
    ).rejects.toThrow()
    const [count] = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM consumer_private.consumers WHERE name = ${`registry-${suffix}`}
    `
    expect(count.count).toBe(1n)
    await expect(db.$executeRaw`
      UPDATE consumer_private.consumers SET id = ${crypto.randomUUID()}::uuid
      WHERE id = ${consumer.consumerId}::uuid
    `).rejects.toThrow()
    await expect(db.$executeRaw`
      UPDATE consumer_private.consumers SET name = 'changed'
      WHERE id = ${consumer.consumerId}::uuid
    `).rejects.toThrow()
  })

  it("enforces owner authority and prevents removing the last owner", async () => {
    const consumer = await registry.create({
      name: `members-${suffix}`,
      ownerGithubUserId: "201",
    })
    await registry.addMember({
      consumerId: consumer.consumerId,
      actorGithubUserId: "201",
      memberGithubUserId: "202",
    })
    expect(await registry.listMembers(consumer.consumerId)).toEqual([
      { githubUserId: "201", role: "owner" },
      { githubUserId: "202", role: "member" },
    ])
    await expect(
      registry.addMember({
        consumerId: consumer.consumerId,
        actorGithubUserId: "202",
        memberGithubUserId: "203",
      }),
    ).rejects.toMatchObject({
      code: "forbidden",
    } satisfies Partial<ConsumerRegistryError>)
    await expect(
      registry.removeMember({
        consumerId: consumer.consumerId,
        actorGithubUserId: "201",
        memberGithubUserId: "201",
      }),
    ).rejects.toMatchObject({
      code: "not_found",
    } satisfies Partial<ConsumerRegistryError>)
    await expect(db.$executeRaw`
      DELETE FROM consumer_private.members WHERE consumer_id = ${consumer.consumerId}::uuid AND github_user_id = 201
    `).rejects.toThrow()
    await registry.removeMember({
      consumerId: consumer.consumerId,
      actorGithubUserId: "201",
      memberGithubUserId: "202",
    })
    expect(await registry.listMembers(consumer.consumerId)).toHaveLength(1)
  })

  it("keeps public corpus unchanged and metadata privileges closed", async () => {
    const [schema] = await db.$queryRaw<
      Array<{ public_grants: bigint; readonly_usage: boolean }>
    >`
      SELECT (SELECT count(*) FROM pg_namespace n,
                    LATERAL aclexplode(n.nspacl) grant_row
              WHERE n.nspname = 'consumer_private' AND grant_row.grantee = 0) AS public_grants,
             COALESCE((SELECT has_schema_privilege(oid, 'consumer_private', 'USAGE')
                       FROM pg_roles WHERE rolname = 'forge_rag_readonly'), false) AS readonly_usage
    `
    expect(schema).toEqual({ public_grants: 0n, readonly_usage: false })
    const [tables] = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('sources', 'documents', 'chunks', 'chunk_embeddings')
    `
    expect(tables.count).toBe(4n)
    const unused = await registry.create({
      name: `unused-${suffix}`,
      ownerGithubUserId: "601",
    })
    const [usage] = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM consumer_private.usage_daily
      WHERE consumer_id = ${unused.consumerId}::uuid
    `
    expect(usage.count).toBe(0n)
  })

  it("serializes competing owner removals and retains one owner", async () => {
    const consumer = await registry.create({
      name: `race-${suffix}`,
      ownerGithubUserId: "301",
    })
    await db.$executeRaw`
      INSERT INTO consumer_private.members (consumer_id, github_user_id, role)
      VALUES (${consumer.consumerId}::uuid, 302, 'owner')
    `
    const results = await Promise.allSettled([
      db.$executeRaw`
        DELETE FROM consumer_private.members
        WHERE consumer_id = ${consumer.consumerId}::uuid AND github_user_id = 301
      `,
      db.$executeRaw`
        DELETE FROM consumer_private.members
        WHERE consumer_id = ${consumer.consumerId}::uuid AND github_user_id = 302
      `,
    ])
    expect(results.map((result) => result.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ])
    expect(await registry.listMembers(consumer.consumerId)).toHaveLength(1)
  })

  it("has no environment table or environment discriminator in consumer metadata", async () => {
    const tables = await db.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'consumer_private' ORDER BY table_name
    `
    expect(tables.map((table) => table.table_name)).toEqual([
      "consumers",
      "lifecycle_audit",
      "members",
      "usage_daily",
    ])
    const columns = await db.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'consumer_private' AND column_name LIKE '%environment%'
    `
    expect(columns).toEqual([])
  })

  it("reads source grants and lifecycle directly from each consumer", async () => {
    const consumer = await registry.create({
      name: `scope-${suffix}`,
      ownerGithubUserId: "401",
    })
    const other = await registry.create({
      name: `other-scope-${suffix}`,
      ownerGithubUserId: "402",
    })
    await db.$executeRaw`
      UPDATE consumer_private.consumers
      SET allowed_source_keys = ARRAY['synthetic-source'], state = 'active'
      WHERE id = ${consumer.consumerId}::uuid
    `
    expect(await registry.findById(consumer.consumerId)).toEqual({
      ...consumer,
      state: "active",
      allowedSourceKeys: ["synthetic-source"],
    })
    expect(await registry.findById(other.consumerId)).toEqual(other)
    await expect(db.$executeRaw`
      UPDATE consumer_private.consumers SET allowed_source_keys = ARRAY[NULL]::text[]
      WHERE id = ${consumer.consumerId}::uuid
    `).rejects.toThrow()
    await expect(db.$executeRaw`
      UPDATE consumer_private.consumers SET allowed_source_keys = NULL
      WHERE id = ${consumer.consumerId}::uuid
    `).rejects.toThrow()
    await db.$executeRaw`
      UPDATE consumer_private.consumers SET state = 'suspended'
      WHERE id = ${consumer.consumerId}::uuid
    `
    expect(await registry.findById(consumer.consumerId)).toMatchObject({
      state: "suspended",
      allowedSourceKeys: ["synthetic-source"],
    })
  })

  it("accounts usage by consumer, day and outcome without environment provisioning", async () => {
    const consumer = await registry.create({
      name: `usage-${suffix}`,
      ownerGithubUserId: "501",
    })
    const other = await registry.create({
      name: `other-usage-${suffix}`,
      ownerGithubUserId: "502",
    })
    await db.$executeRaw`
      INSERT INTO consumer_private.usage_daily (consumer_id, day, outcome, request_count)
      VALUES (${consumer.consumerId}::uuid, '2026-09-23', 'success', 3),
             (${consumer.consumerId}::uuid, '2026-09-23', 'client_error', 1),
             (${consumer.consumerId}::uuid, '2026-09-24', 'success', 2),
             (${other.consumerId}::uuid, '2026-09-23', 'success', 1)
    `
    await db.$executeRaw`
      INSERT INTO consumer_private.usage_daily (consumer_id, day, outcome, request_count)
      VALUES (${consumer.consumerId}::uuid, '2026-09-23', 'success', 2)
      ON CONFLICT (consumer_id, day, outcome) DO UPDATE
      SET request_count = consumer_private.usage_daily.request_count + EXCLUDED.request_count
    `
    const rows = await db.$queryRaw<
      Array<{
        consumer_id: string
        day: string
        outcome: string
        request_count: bigint
      }>
    >`
      SELECT consumer_id, day::text, outcome, request_count FROM consumer_private.usage_daily
      WHERE consumer_id IN (${consumer.consumerId}::uuid, ${other.consumerId}::uuid)
      ORDER BY day, outcome, request_count DESC
    `
    expect(rows).toEqual([
      {
        consumer_id: consumer.consumerId,
        day: "2026-09-23",
        outcome: "client_error",
        request_count: 1n,
      },
      {
        consumer_id: consumer.consumerId,
        day: "2026-09-23",
        outcome: "success",
        request_count: 5n,
      },
      {
        consumer_id: other.consumerId,
        day: "2026-09-23",
        outcome: "success",
        request_count: 1n,
      },
      {
        consumer_id: consumer.consumerId,
        day: "2026-09-24",
        outcome: "success",
        request_count: 2n,
      },
    ])
    await expect(db.$executeRaw`
      INSERT INTO consumer_private.usage_daily (consumer_id, day, outcome)
      VALUES (${consumer.consumerId}::uuid, '2026-09-23', 'success')
    `).rejects.toThrow()
    await expect(db.$executeRaw`
      INSERT INTO consumer_private.usage_daily (consumer_id, day, outcome)
      VALUES (${crypto.randomUUID()}::uuid, '2026-09-23', 'success')
    `).rejects.toThrow()
    await expect(db.$executeRaw`
      INSERT INTO consumer_private.usage_daily (consumer_id, day, outcome, request_count)
      VALUES (${consumer.consumerId}::uuid, '2026-09-23', 'server_error', -1)
    `).rejects.toThrow()
    await expect(db.$executeRaw`
      INSERT INTO consumer_private.usage_daily (consumer_id, day, outcome)
      VALUES (${consumer.consumerId}::uuid, '2026-09-23', 'unknown')
    `).rejects.toThrow()
  })
})
