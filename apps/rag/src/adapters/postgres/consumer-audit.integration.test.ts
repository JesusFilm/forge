import { PrismaClient } from "../../generated/prisma/index.js"
import { afterAll, describe, expect, it } from "vitest"

import { PostgresConsumerAccess } from "./consumer-access.js"
import { PostgresConsumerAuthenticator } from "./consumer-auth.js"

const databaseUrl = process.env.DATABASE_URL
const db = new PrismaClient({ datasourceUrl: databaseUrl })
const access = new PostgresConsumerAccess(db)
const suffix = crypto.randomUUID().slice(0, 8)
afterAll(() => db.$disconnect())

describe.skipIf(!databaseUrl)("consumer audit compatibility", () => {
  it("records fresh admission for creation and owner lifecycle changes", async () => {
    const oldSha = "a".repeat(40)
    const freshSha = "b".repeat(40)
    const created = await access.create({
      name: "fresh-audit-" + suffix,
      actorGithubUserId: "4201",
      allowedSourceKeys: [],
      admissionSha: oldSha,
      verifyCurrentAdmission: async () => freshSha,
    })
    await access.transition({
      consumerId: created.consumer.consumerId,
      actorGithubUserId: "4201",
      state: "suspended",
      expectedVersion: 1,
      admissionSha: oldSha,
      verifyCurrentAdmission: async () => freshSha,
    })
    const audit = await db.$queryRaw<Array<{ admission_sha: string }>>`
      SELECT admission_sha FROM consumer_private.lifecycle_audit
      WHERE consumer_id = ${created.consumer.consumerId}::uuid
    `
    expect(audit).toHaveLength(3)
    expect(audit.every((entry) => entry.admission_sha === freshSha)).toBe(true)
  })

  it("deletes a pending foundation consumer without a credential", async () => {
    const pending = await db.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO consumer_private.consumers (name, allowed_source_keys)
        VALUES (${"pending-" + suffix}, ARRAY[]::text[]) RETURNING id
      `
      await tx.$executeRaw`
        INSERT INTO consumer_private.members (consumer_id, github_user_id, role)
        VALUES (${row.id}::uuid, 4201, 'owner')
      `
      return row
    })
    await expect(
      access.delete({
        consumerId: pending.id,
        actorGithubUserId: "4202",
        name: "pending-" + suffix,
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "forbidden" })
    await access.delete({
      consumerId: pending.id,
      actorGithubUserId: "4201",
      name: "pending-" + suffix,
      expectedVersion: 1,
    })
    const audit = await db.$queryRaw<
      Array<{ action: string; credential_version: bigint }>
    >`
      SELECT action, credential_version FROM consumer_private.lifecycle_audit
      WHERE consumer_id = ${pending.id}::uuid ORDER BY action
    `
    expect(audit).toEqual([
      { action: "deleted", credential_version: 0n },
      { action: "denied", credential_version: 0n },
    ])
  })

  it("issues a first key when recovering a revoked foundation consumer", async () => {
    const revoked = await db.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO consumer_private.consumers (name, state, allowed_source_keys)
        VALUES (${"revoked-foundation-" + suffix}, 'revoked', ARRAY[]::text[]) RETURNING id
      `
      await tx.$executeRaw`
        INSERT INTO consumer_private.members (consumer_id, github_user_id, role)
        VALUES (${row.id}::uuid, 4201, 'owner')
      `
      return row
    })
    const recovered = await access.recover({
      consumerId: revoked.id,
      actorGithubUserId: "4201",
      expectedVersion: 0,
      expectedLifecycleVersion: 1,
    })
    expect(recovered.credentialVersion).toBe(1)
    expect(
      await new PostgresConsumerAuthenticator(db).authenticate(
        recovered.secret,
      ),
    ).toMatchObject({
      consumerId: revoked.id,
    })
  })
})
