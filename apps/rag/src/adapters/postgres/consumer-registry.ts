import { Prisma, type PrismaClient } from "../../generated/prisma/index.js"

import type {
  AddConsumerMember,
  ConsumerMember,
  ConsumerRecord,
  ConsumerRegistry,
  CreateConsumer,
  RemoveConsumerMember,
} from "../../contracts/consumer-registry.js"

export class ConsumerRegistryError extends Error {
  override readonly name = "ConsumerRegistryError"
  constructor(
    readonly code: "invalid_input" | "forbidden" | "not_found",
    message: string,
  ) {
    super(message)
  }
}

type ConsumerRow = {
  id: string
  name: string
  state: ConsumerRecord["state"]
  created_at: Date
}

const githubId = (value: string): string => {
  if (!/^[1-9][0-9]{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n)
    throw new ConsumerRegistryError(
      "invalid_input",
      "invalid GitHub account ID",
    )
  return value
}

const consumerId = (value: string): string => {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new ConsumerRegistryError("invalid_input", "invalid consumer ID")
  return value
}

const record = (row: ConsumerRow): ConsumerRecord => ({
  consumerId: row.id,
  name: row.name,
  state: row.state,
  createdAt: row.created_at,
})

/** Store operations are intentionally disconnected from HTTP and issuance in R1. */
export class PostgresConsumerRegistry implements ConsumerRegistry {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateConsumer): Promise<ConsumerRecord> {
    if (!/^[a-z0-9-]{1,80}$/.test(input.name))
      throw new ConsumerRegistryError("invalid_input", "invalid consumer name")
    const ownerId = githubId(input.ownerGithubUserId)
    return this.db.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<ConsumerRow[]>(Prisma.sql`
        INSERT INTO consumer_private.consumers (name)
        VALUES (${input.name})
        RETURNING id, name, state, created_at
      `)
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO consumer_private.members (consumer_id, github_user_id, role)
        VALUES (${row.id}::uuid, ${ownerId}::bigint, 'owner')
      `)
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO consumer_private.lifecycle_audit (consumer_id, actor_github_user_id, action)
        VALUES (${row.id}::uuid, ${ownerId}::bigint, 'created')
      `)
      return record(row)
    })
  }

  async findById(id: string): Promise<ConsumerRecord | null> {
    const rows = await this.db.$queryRaw<ConsumerRow[]>(Prisma.sql`
      SELECT id, name, state, created_at FROM consumer_private.consumers
      WHERE id = ${consumerId(id)}::uuid
    `)
    return rows[0] ? record(rows[0]) : null
  }

  async listMembers(id: string): Promise<ConsumerMember[]> {
    const rows = await this.db.$queryRaw<
      Array<{ github_user_id: bigint; role: ConsumerMember["role"] }>
    >(Prisma.sql`
      SELECT github_user_id, role FROM consumer_private.members
      WHERE consumer_id = ${consumerId(id)}::uuid ORDER BY github_user_id
    `)
    return rows.map((row) => ({
      githubUserId: row.github_user_id.toString(),
      role: row.role,
    }))
  }

  async addMember(input: AddConsumerMember): Promise<void> {
    const id = consumerId(input.consumerId)
    const actor = githubId(input.actorGithubUserId)
    const member = githubId(input.memberGithubUserId)
    await this.db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM consumer_private.consumers WHERE id = ${id}::uuid FOR UPDATE
      `)
      if (!locked.length)
        throw new ConsumerRegistryError("not_found", "consumer not found")
      const owners = await tx.$queryRaw<
        Array<{ github_user_id: bigint }>
      >(Prisma.sql`
        SELECT github_user_id FROM consumer_private.members
        WHERE consumer_id = ${id}::uuid AND github_user_id = ${actor}::bigint AND role = 'owner'
      `)
      if (!owners.length)
        throw new ConsumerRegistryError("forbidden", "owner required")
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO consumer_private.members (consumer_id, github_user_id, role)
        VALUES (${id}::uuid, ${member}::bigint, 'member')
      `)
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO consumer_private.lifecycle_audit (consumer_id, actor_github_user_id, action)
        VALUES (${id}::uuid, ${actor}::bigint, 'member_added')
      `)
    })
  }

  async removeMember(input: RemoveConsumerMember): Promise<void> {
    const id = consumerId(input.consumerId)
    const actor = githubId(input.actorGithubUserId)
    const member = githubId(input.memberGithubUserId)
    await this.db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM consumer_private.consumers WHERE id = ${id}::uuid FOR UPDATE
      `)
      if (!locked.length)
        throw new ConsumerRegistryError("not_found", "consumer not found")
      const owners = await tx.$queryRaw<
        Array<{ github_user_id: bigint }>
      >(Prisma.sql`
        SELECT github_user_id FROM consumer_private.members
        WHERE consumer_id = ${id}::uuid AND github_user_id = ${actor}::bigint AND role = 'owner'
      `)
      if (!owners.length)
        throw new ConsumerRegistryError("forbidden", "owner required")
      const deleted = await tx.$queryRaw<
        Array<{ github_user_id: bigint }>
      >(Prisma.sql`
        DELETE FROM consumer_private.members
        WHERE consumer_id = ${id}::uuid AND github_user_id = ${member}::bigint AND role = 'member'
        RETURNING github_user_id
      `)
      if (!deleted.length)
        throw new ConsumerRegistryError("not_found", "member not found")
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO consumer_private.lifecycle_audit (consumer_id, actor_github_user_id, action)
        VALUES (${id}::uuid, ${actor}::bigint, 'member_removed')
      `)
    })
  }
}
