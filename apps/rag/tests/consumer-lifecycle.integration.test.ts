import { PrismaClient } from "../src/generated/prisma/index.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { PostgresConsumerAccess } from "../src/adapters/postgres/consumer-access.js"
import { PostgresConsumerAuthenticator } from "../src/adapters/postgres/consumer-auth.js"

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl)
  throw new Error("DATABASE_URL is required for consumer lifecycle integration")
const db = new PrismaClient({ datasourceUrl: databaseUrl })
const access = new PostgresConsumerAccess(db)
const auth = new PostgresConsumerAuthenticator(db)
const suffix = crypto.randomUUID().slice(0, 8)
beforeAll(() => db.$connect())
afterAll(() => db.$disconnect())

describe("consumer revocation and restoration", () => {
  it("keeps owner changes, rotation, suspension, revocation and restoration isolated", async () => {
    const created = await access.create({
      name: "lifecycle-" + suffix,
      actorGithubUserId: "4301",
      allowedSourceKeys: ["synthetic-source"],
    })
    const id = created.consumer.consumerId
    await expect(
      access.rotate({
        consumerId: id,
        actorGithubUserId: "4302",
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "forbidden" })
    const denied = await db.$queryRaw<
      Array<{
        actor_github_user_id: bigint
        action: string
      }>
    >`
      SELECT actor_github_user_id, action FROM consumer_private.lifecycle_audit
      WHERE consumer_id = ${id}::uuid AND action = 'denied'
    `
    expect(denied).toEqual([{ actor_github_user_id: 4302n, action: "denied" }])
    await expect(
      access.rotate({
        consumerId: id,
        actorGithubUserId: "4301",
        expectedVersion: 1,
        verifyCurrentAdmission: async () => null,
      }),
    ).rejects.toMatchObject({ code: "forbidden" })
    expect(await auth.authenticate(created.secret)).toMatchObject({
      consumerId: id,
    })
    await expect(
      access.addMember({
        consumerId: id,
        actorGithubUserId: "4301",
        memberGithubUserId: "4302",
        expectedVersion: 1,
        verifyCurrentEligibility: async () => null,
      }),
    ).rejects.toMatchObject({ code: "forbidden" })
    expect(await access.members(id, "4301")).toEqual([
      { githubUserId: "4301", role: "owner" },
    ])
    await access.addMember({
      consumerId: id,
      actorGithubUserId: "4301",
      memberGithubUserId: "4302",
      expectedVersion: 1,
      verifyCurrentEligibility: async () => "c".repeat(40),
    })
    expect(await access.members(id, "4302")).toEqual([
      { githubUserId: "4301", role: "owner" },
      { githubUserId: "4302", role: "owner" },
    ])
    const replacement = await access.rotate({
      consumerId: id,
      actorGithubUserId: "4302",
      expectedVersion: 1,
    })
    expect(replacement.credentialVersion).toBe(2)
    expect(await auth.authenticate(created.secret)).toBeNull()
    expect(await auth.authenticate(replacement.secret)).toMatchObject({
      consumerId: id,
    })
    await expect(
      access.transition({
        consumerId: id,
        actorGithubUserId: "4301",
        state: "revoked",
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "conflict" })
    expect(await auth.authenticate(replacement.secret)).toMatchObject({
      consumerId: id,
    })
    await expect(
      access.rotate({
        consumerId: id,
        actorGithubUserId: "4301",
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "conflict" })
    await access.transition({
      consumerId: id,
      actorGithubUserId: "4301",
      state: "suspended",
      expectedVersion: 2,
    })
    expect(await auth.authenticate(replacement.secret)).toBeNull()
    await access.transition({
      consumerId: id,
      actorGithubUserId: "4302",
      state: "active",
      expectedVersion: 3,
    })
    expect(await auth.authenticate(replacement.secret)).toMatchObject({
      consumerId: id,
    })
    await access.removeMember({
      consumerId: id,
      actorGithubUserId: "4301",
      memberGithubUserId: "4302",
      expectedVersion: 2,
    })
    await expect(
      access.removeMember({
        consumerId: id,
        actorGithubUserId: "4301",
        memberGithubUserId: "4301",
        expectedVersion: 3,
      }),
    ).rejects.toMatchObject({ code: "conflict" })
    await access.transition({
      consumerId: id,
      actorGithubUserId: "4301",
      state: "revoked",
      expectedVersion: 4,
    })
    expect(await auth.authenticate(replacement.secret)).toBeNull()
    await expect(
      access.recover({
        consumerId: id,
        actorGithubUserId: "4302",
        expectedVersion: 2,
        expectedLifecycleVersion: 5,
      }),
    ).rejects.toMatchObject({ code: "forbidden" })
    await expect(
      access.recover({
        consumerId: id,
        actorGithubUserId: "4301",
        expectedVersion: 2,
        expectedLifecycleVersion: 4,
      }),
    ).rejects.toMatchObject({ code: "conflict" })
    await expect(
      access.rotate({
        consumerId: id,
        actorGithubUserId: "4301",
        expectedVersion: 2,
      }),
    ).rejects.toMatchObject({ code: "forbidden" })
    const recovered = await access.recover({
      consumerId: id,
      actorGithubUserId: "4301",
      expectedVersion: 2,
      expectedLifecycleVersion: 5,
    })
    expect(await auth.authenticate(replacement.secret)).toBeNull()
    expect(await auth.authenticate(recovered.secret)).toMatchObject({
      consumerId: id,
    })
    await db.$executeRaw`
      INSERT INTO consumer_private.usage_daily(consumer_id, day, outcome, request_count)
      VALUES (${id}::uuid, current_date, 'success', 1)
    `
    await expect(
      access.create({
        name: created.consumer.name,
        actorGithubUserId: "4301",
        allowedSourceKeys: [],
      }),
    ).rejects.toMatchObject({ code: "conflict" })
    await access.transition({
      consumerId: id,
      actorGithubUserId: "4301",
      state: "revoked",
      expectedVersion: 6,
    })
    expect(await auth.authenticate(recovered.secret)).toBeNull()
    expect(
      (await access.list("4301")).find((row) => row.consumerId === id),
    ).toMatchObject({ state: "revoked" })
    expect(
      (await access.listForUsage()).find((row) => row.consumerId === id),
    ).toMatchObject({
      name: created.consumer.name,
      state: "revoked",
    })
    const [history] = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM consumer_private.lifecycle_audit WHERE consumer_id = ${id}::uuid
    `
    expect(history.count).toBeGreaterThan(0n)
    const [usage] = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM consumer_private.usage_daily WHERE consumer_id = ${id}::uuid
    `
    expect(usage.count).toBe(1n)
  })

  it("revokes a suspended consumer without releasing its name or old key", async () => {
    const name = "suspended-revoke-" + suffix
    const created = await access.create({
      name,
      actorGithubUserId: "4301",
      allowedSourceKeys: [],
    })
    const consumerId = created.consumer.consumerId
    await access.transition({
      consumerId,
      actorGithubUserId: "4301",
      state: "suspended",
      expectedVersion: 1,
    })
    await access.transition({
      consumerId,
      actorGithubUserId: "4301",
      state: "revoked",
      expectedVersion: 2,
    })
    await expect(
      access.transition({
        consumerId,
        actorGithubUserId: "4301",
        state: "active",
        expectedVersion: 3,
      }),
    ).rejects.toMatchObject({ code: "forbidden" })
    expect(await auth.authenticate(created.secret)).toBeNull()
    await expect(
      access.create({ name, actorGithubUserId: "4301", allowedSourceKeys: [] }),
    ).rejects.toMatchObject({ code: "conflict" })
    const restored = await access.recover({
      consumerId,
      actorGithubUserId: "4301",
      expectedVersion: 1,
      expectedLifecycleVersion: 3,
    })
    expect(await auth.authenticate(created.secret)).toBeNull()
    expect(await auth.authenticate(restored.secret)).toMatchObject({
      consumerId,
    })
  })
})
