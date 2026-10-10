import { PrismaClient } from "../src/generated/prisma/index.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { PostgresConsumerAccess } from "../src/adapters/postgres/consumer-access.js"
import { PostgresConsumerAuthenticator } from "../src/adapters/postgres/consumer-auth.js"

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl)
  throw new Error("DATABASE_URL is required for consumer access integration")
const db = new PrismaClient({ datasourceUrl: databaseUrl })
const access = new PostgresConsumerAccess(db)
const auth = new PostgresConsumerAuthenticator(db)
const suffix = crypto.randomUUID().slice(0, 8)

beforeAll(() => db.$connect())
afterAll(() => db.$disconnect())

describe("registered consumer lifecycle", () => {
  it("creates one owner and verifier atomically, with global name uniqueness", async () => {
    const created = await access.create({
      name: "access-" + suffix,
      actorGithubUserId: "4201",
      allowedSourceKeys: ["synthetic-source"],
    })
    expect(created.consumer.state).toBe("active")
    expect(await auth.authenticate(created.secret)).toEqual({
      consumerId: created.consumer.consumerId,
      allowedSourceKeys: ["synthetic-source"],
    })
    const [stored] = await db.$queryRaw<Array<{ verifier: string }>>`
      SELECT verifier FROM consumer_private.credentials
      WHERE consumer_id = ${created.consumer.consumerId}::uuid
    `
    expect(stored.verifier).not.toBe(created.secret)
    expect(stored.verifier).toMatch(/^[0-9a-f]{64}$/)
    expect(
      (await access.list("4201")).find(
        (row) => row.consumerId === created.consumer.consumerId,
      ),
    ).toMatchObject({ owned: true, credentialVersion: 1 })
    expect(
      (await access.list("4202")).find(
        (row) => row.consumerId === created.consumer.consumerId,
      ),
    ).toMatchObject({ owned: false })
    await expect(
      access.create({
        name: "access-" + suffix,
        actorGithubUserId: "4202",
        allowedSourceKeys: [],
      }),
    ).rejects.toMatchObject({ code: "conflict" })
    const race = await Promise.allSettled([
      access.create({
        name: "name-race-" + suffix,
        actorGithubUserId: "4201",
        allowedSourceKeys: [],
      }),
      access.create({
        name: "name-race-" + suffix,
        actorGithubUserId: "4202",
        allowedSourceKeys: [],
      }),
    ])
    expect(race.map((result) => result.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ])
  })

  it("serializes competing key rotations and owner removals", async () => {
    const created = await access.create({
      name: "race-" + suffix,
      actorGithubUserId: "4401",
      allowedSourceKeys: [],
    })
    const id = created.consumer.consumerId
    await access.addMember({
      consumerId: id,
      actorGithubUserId: "4401",
      memberGithubUserId: "4402",
      expectedVersion: 1,
      verifyCurrentEligibility: async () => "c".repeat(40),
    })
    const rotations = await Promise.allSettled([
      access.rotate({
        consumerId: id,
        actorGithubUserId: "4401",
        expectedVersion: 1,
      }),
      access.rotate({
        consumerId: id,
        actorGithubUserId: "4402",
        expectedVersion: 1,
      }),
    ])
    expect(rotations.map((result) => result.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ])
    const winner = rotations.find((result) => result.status === "fulfilled")
    if (!winner || winner.status !== "fulfilled")
      throw new Error("rotation did not succeed")
    expect(await auth.authenticate(created.secret)).toBeNull()
    expect(await auth.authenticate(winner.value.secret)).toMatchObject({
      consumerId: id,
    })

    const removals = await Promise.allSettled([
      access.removeMember({
        consumerId: id,
        actorGithubUserId: "4401",
        memberGithubUserId: "4402",
        expectedVersion: 2,
      }),
      access.removeMember({
        consumerId: id,
        actorGithubUserId: "4402",
        memberGithubUserId: "4401",
        expectedVersion: 2,
      }),
    ])
    expect(removals.map((result) => result.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ])
    const [remaining] = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM consumer_private.members
      WHERE consumer_id = ${id}::uuid AND role = 'owner'
    `
    expect(remaining.count).toBe(1n)
  })

  it("recovers a lost issuance response by rotating without revealing storage", async () => {
    await access.recordAllowlistRevision("a".repeat(40))
    await access.recordAllowlistRevision("a".repeat(40))
    const [revision] = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM consumer_private.allowlist_revisions
      WHERE sha = ${"a".repeat(40)}
    `
    expect(revision.count).toBe(1n)
    const created = await access.create({
      name: "lost-" + suffix,
      actorGithubUserId: "4601",
      allowedSourceKeys: [],
      admissionSha: "a".repeat(40),
    })
    const consumerId = created.consumer.consumerId
    const oldSecret = created.secret
    const replacement = await access.rotate({
      consumerId,
      actorGithubUserId: "4601",
      expectedVersion: 1,
      admissionSha: "b".repeat(40),
      reason: "lost",
    })
    expect(await auth.authenticate(oldSecret)).toBeNull()
    expect(await auth.authenticate(replacement.secret)).toMatchObject({
      consumerId,
    })
    const audit = await db.$queryRaw<
      Array<{
        action: string
        admission_sha: string | null
      }>
    >`
      SELECT action, admission_sha FROM consumer_private.lifecycle_audit
      WHERE consumer_id = ${consumerId}::uuid ORDER BY occurred_at, action
    `
    expect(audit).toEqual(
      expect.arrayContaining([
        { action: "credential_issued", admission_sha: "a".repeat(40) },
        { action: "recovery", admission_sha: "b".repeat(40) },
      ]),
    )
    const columns = await db.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'consumer_private' AND table_name = 'lifecycle_audit'
    `
    const forbidden = new Set(["secret", "query", "ip", "token", "verifier"])
    expect(columns.filter((row) => forbidden.has(row.column_name))).toEqual([])
  })
})
