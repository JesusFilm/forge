import { PrismaClient } from "../src/generated/prisma/index.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  ConsumerRoleVerificationError,
  verifyConsumerRoles,
} from "../scripts/consumer-role-policy.js"

import { PostgresConsumerAccess } from "../src/adapters/postgres/consumer-access.js"
import { PostgresConsumerAuthenticator } from "../src/adapters/postgres/consumer-auth.js"

const writerUrl = process.env.RAG_CONSUMER_WRITER_DATABASE_URL
const readerUrl = process.env.RAG_CONSUMER_AUTH_DATABASE_URL
const writer = writerUrl ? new PrismaClient({ datasourceUrl: writerUrl }) : null
const reader = readerUrl ? new PrismaClient({ datasourceUrl: readerUrl }) : null

afterAll(async () => {
  await Promise.all([writer?.$disconnect(), reader?.$disconnect()])
})

const adminUrl = process.env.DATABASE_URL
describe.skipIf(!adminUrl || !writer || !reader)(
  "consumer role privilege denial",
  () => {
    const admin = adminUrl
      ? new PrismaClient({ datasourceUrl: adminUrl })
      : null
    const fixtureRole = `consumer_probe_${crypto.randomUUID().replaceAll("-", "")}`
    let fixture: PrismaClient
    beforeAll(async () => {
      if (!admin || !adminUrl) throw new ConsumerRoleVerificationError()
      await admin.$executeRawUnsafe(
        `CREATE ROLE ${fixtureRole} LOGIN PASSWORD 'synthetic-only-test-password'`,
      )
      await admin.$executeRawUnsafe(
        `GRANT USAGE ON SCHEMA consumer_private TO ${fixtureRole}`,
      )
      await admin.$executeRawUnsafe(
        `GRANT SELECT ON consumer_private.consumers, consumer_private.credentials TO ${fixtureRole}`,
      )
      const url = new URL(adminUrl)
      url.username = fixtureRole
      url.password = "synthetic-only-test-password"
      fixture = new PrismaClient({ datasourceUrl: url.toString() })
    })
    afterAll(async () => {
      await fixture?.$disconnect()
      if (admin) {
        await admin.$executeRawUnsafe(`DROP OWNED BY ${fixtureRole}`)
        await admin.$executeRawUnsafe(`DROP ROLE ${fixtureRole}`)
        await admin.$disconnect()
      }
    })
    it("accepts the exact read-only grants", async () => {
      if (!writer) throw new ConsumerRoleVerificationError()
      await expect(
        verifyConsumerRoles(writer, fixture),
      ).resolves.toBeUndefined()
    })
    const forbidden = [
      ...["consumers", "credentials"].flatMap((table) =>
        ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"].map(
          (privilege) => ({ table: `consumer_private.${table}`, privilege }),
        ),
      ),
      ...[
        "members",
        "lifecycle_audit",
        "allowlist_revisions",
        "usage_daily",
      ].flatMap((table) =>
        ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"].map(
          (privilege) => ({ table: `consumer_private.${table}`, privilege }),
        ),
      ),
      { table: "public.sources", privilege: "SELECT" },
      { table: "portal_private.sessions", privilege: "SELECT" },
    ]
    it.each(forbidden)(
      "rejects $privilege on $table independently",
      async ({ table, privilege }) => {
        if (!writer || !admin) throw new ConsumerRoleVerificationError()
        const schema = table.split(".")[0]
        await admin.$executeRawUnsafe(
          `GRANT USAGE ON SCHEMA ${schema} TO ${fixtureRole}`,
        )
        await admin.$executeRawUnsafe(
          `GRANT ${privilege} ON ${table} TO ${fixtureRole}`,
        )
        try {
          await expect(
            verifyConsumerRoles(writer, fixture),
          ).rejects.toBeInstanceOf(ConsumerRoleVerificationError)
        } finally {
          await admin.$executeRawUnsafe(
            `REVOKE ${privilege} ON ${table} FROM ${fixtureRole}`,
          )
        }
      },
    )
    it("rejects non-inherited writer privileges reachable with SET ROLE", async () => {
      if (!writer || !admin) throw new ConsumerRoleVerificationError()
      const [role] = await writer.$queryRaw<
        Array<{ name: string }>
      >`SELECT current_user AS name`
      const quotedRole = `"${role.name.replaceAll('"', '""')}"`
      await admin.$executeRawUnsafe(
        `GRANT ${quotedRole} TO ${fixtureRole} WITH INHERIT FALSE, SET TRUE`,
      )
      try {
        await expect(
          verifyConsumerRoles(writer, fixture),
        ).rejects.toBeInstanceOf(ConsumerRoleVerificationError)
      } finally {
        await admin.$executeRawUnsafe(
          `REVOKE ${quotedRole} FROM ${fixtureRole}`,
        )
      }
    })
    it.each([
      "pg_read_server_files",
      "pg_write_server_files",
      "pg_execute_server_program",
    ])("rejects SET-reachable predefined role %s", async (role) => {
      if (!writer || !admin) throw new ConsumerRoleVerificationError()
      await admin.$executeRawUnsafe(
        `GRANT ${role} TO ${fixtureRole} WITH INHERIT FALSE, SET TRUE`,
      )
      try {
        await expect(
          verifyConsumerRoles(writer, fixture),
        ).rejects.toBeInstanceOf(ConsumerRoleVerificationError)
      } finally {
        await admin.$executeRawUnsafe(`REVOKE ${role} FROM ${fixtureRole}`)
      }
    })
    it("rejects column-only writes", async () => {
      if (!writer || !admin) throw new ConsumerRoleVerificationError()
      await admin.$executeRawUnsafe(
        `GRANT UPDATE (verifier) ON consumer_private.credentials TO ${fixtureRole}`,
      )
      try {
        await expect(
          verifyConsumerRoles(writer, fixture),
        ).rejects.toBeInstanceOf(ConsumerRoleVerificationError)
      } finally {
        await admin.$executeRawUnsafe(
          `REVOKE UPDATE (verifier) ON consumer_private.credentials FROM ${fixtureRole}`,
        )
      }
    })
    it.each(["CREATEROLE", "CREATEDB", "REPLICATION", "BYPASSRLS"])(
      "rejects role flag %s",
      async (flag) => {
        if (!writer || !admin) throw new ConsumerRoleVerificationError()
        await admin.$executeRawUnsafe(`ALTER ROLE ${fixtureRole} ${flag}`)
        try {
          await expect(
            verifyConsumerRoles(writer, fixture),
          ).rejects.toBeInstanceOf(ConsumerRoleVerificationError)
        } finally {
          await admin.$executeRawUnsafe(`ALTER ROLE ${fixtureRole} NO${flag}`)
        }
      },
    )
    it.each([
      { table: "consumer_private.consumers", privilege: "DELETE" },
      { table: "consumer_private.credentials", privilege: "TRUNCATE" },
      { table: "consumer_private.members", privilege: "UPDATE" },
      { table: "consumer_private.lifecycle_audit", privilege: "UPDATE" },
      { table: "consumer_private.allowlist_revisions", privilege: "DELETE" },
    ])("rejects writer $privilege on $table", async ({ table, privilege }) => {
      if (!writer || !reader || !admin)
        throw new ConsumerRoleVerificationError()
      // Isolated inherited writer leaves other suites' roles untouched.
      const [role] = await writer.$queryRaw<
        Array<{ name: string }>
      >`SELECT current_user AS name`
      const quotedRole = `"${role.name.replaceAll('"', '""')}"`
      await admin.$executeRawUnsafe(
        `REVOKE SELECT ON consumer_private.consumers, consumer_private.credentials FROM ${fixtureRole}`,
      )
      await admin.$executeRawUnsafe(`GRANT ${quotedRole} TO ${fixtureRole}`)
      await admin.$executeRawUnsafe(
        `GRANT ${privilege} ON ${table} TO ${fixtureRole}`,
      )
      try {
        await expect(
          verifyConsumerRoles(fixture, reader),
        ).rejects.toBeInstanceOf(ConsumerRoleVerificationError)
      } finally {
        await admin.$executeRawUnsafe(
          `REVOKE ${privilege} ON ${table} FROM ${fixtureRole}`,
        )
        await admin.$executeRawUnsafe(
          `REVOKE ${quotedRole} FROM ${fixtureRole}`,
        )
        await admin.$executeRawUnsafe(
          `GRANT SELECT ON consumer_private.consumers, consumer_private.credentials TO ${fixtureRole}`,
        )
      }
    })
    it("rejects schema creation", async () => {
      if (!writer || !admin) throw new ConsumerRoleVerificationError()
      await admin.$executeRawUnsafe(
        `GRANT CREATE ON SCHEMA consumer_private TO ${fixtureRole}`,
      )
      try {
        await expect(
          verifyConsumerRoles(writer, fixture),
        ).rejects.toBeInstanceOf(ConsumerRoleVerificationError)
      } finally {
        await admin.$executeRawUnsafe(
          `REVOKE CREATE ON SCHEMA consumer_private FROM ${fixtureRole}`,
        )
      }
    })
  },
)

describe.skipIf(!writer || !reader)("restricted consumer roles", () => {
  it("issues through the writer and authenticates through the reader", async () => {
    if (!writer || !reader) throw new ConsumerRoleVerificationError()
    const access = new PostgresConsumerAccess(writer)
    const auth = new PostgresConsumerAuthenticator(reader)
    await access.recordAllowlistRevision("d".repeat(40))
    const created = await access.create({
      name: "restricted-" + crypto.randomUUID().slice(0, 8),
      actorGithubUserId: "4501",
      allowedSourceKeys: [],
    })
    expect(await auth.authenticate(created.secret)).toEqual({
      consumerId: created.consumer.consumerId,
      allowedSourceKeys: [],
    })
    const replacement = await access.rotate({
      consumerId: created.consumer.consumerId,
      actorGithubUserId: "4501",
      expectedVersion: 1,
    })
    expect(await auth.authenticate(created.secret)).toBeNull()
    expect(await auth.authenticate(replacement.secret)).toMatchObject({
      consumerId: created.consumer.consumerId,
    })
  })
})
