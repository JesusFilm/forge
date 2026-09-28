import { randomBytes } from "node:crypto"
import { withDeadline } from "../../contracts/deadline.js"

import { Prisma, type PrismaClient } from "../../generated/prisma/index.js"
import type {
  ConsumerAccess,
  ConsumerDirectoryEntry,
  IssuedConsumer,
  AddConsumerMemberMutation,
  RemoveConsumerMemberMutation,
  RotateConsumerCredential,
  TransitionConsumer,
} from "../../contracts/consumer-access.js"
import { ConsumerAccessError } from "../../contracts/consumer-access.js"
import { credentialVerifier } from "./consumer-auth.js"
import { withConsumerOwner } from "./consumer-access-ownership.js"
import {
  consumerRecord,
  githubId,
  type ConsumerRow,
  uniqueConflict,
} from "./consumer-access-validation.js"
import type { ConsumerMember } from "../../contracts/consumer-registry.js"
const secret = () => `rag_${randomBytes(32).toString("base64url")}`

export class PostgresConsumerAccess implements ConsumerAccess {
  constructor(private readonly writer: PrismaClient) {}

  async recordAllowlistRevision(sha: string): Promise<void> {
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new ConsumerAccessError("invalid")
    await this.writer.$executeRaw(Prisma.sql`
      INSERT INTO consumer_private.allowlist_revisions (sha)
      VALUES (${sha}) ON CONFLICT DO NOTHING
    `)
  }

  async list(actorGithubUserId: string): Promise<ConsumerDirectoryEntry[]> {
    const actor = githubId(actorGithubUserId)
    const rows = await this.writer.$queryRaw<ConsumerRow[]>(Prisma.sql`
      SELECT c.id, c.name, c.state, c.allowed_source_keys, c.created_at,
             c.credential_version, c.membership_version, EXISTS (
               SELECT 1 FROM consumer_private.members m
               WHERE m.consumer_id = c.id AND m.github_user_id = ${actor}::bigint
                 AND m.role = 'owner'
             ) AS owned
      FROM consumer_private.consumers c ORDER BY c.name
    `)
    return rows.map((row) => ({
      ...consumerRecord(row),
      owned: row.owned === true,
      credentialVersion: Number(row.credential_version),
      membershipVersion: Number(row.membership_version),
    }))
  }

  async create(input: {
    name: string
    actorGithubUserId: string
    allowedSourceKeys: string[]
    admissionSha?: string
    verifyCurrentAdmission?(signal?: AbortSignal): Promise<string | null>
  }): Promise<IssuedConsumer> {
    if (
      !/^[a-z0-9-]{1,80}$/.test(input.name) ||
      input.allowedSourceKeys.some((key) => !/^[a-z0-9-]{1,80}$/.test(key))
    )
      throw new ConsumerAccessError("invalid")
    const actor = githubId(input.actorGithubUserId)
    const issued = secret()
    const digest = credentialVerifier(issued)
    try {
      const consumer = await this.writer.$transaction(
        async (tx) => {
          const admissionSha = input.verifyCurrentAdmission
            ? await withDeadline(8_000, input.verifyCurrentAdmission)
            : input.admissionSha
          if (input.verifyCurrentAdmission && !admissionSha)
            throw new ConsumerAccessError("forbidden")
          const [row] = await tx.$queryRaw<ConsumerRow[]>(Prisma.sql`
          INSERT INTO consumer_private.consumers
            (name, state, allowed_source_keys, credential_version)
          VALUES (${input.name}, 'active', ${input.allowedSourceKeys}::text[], 1)
          RETURNING id, name, state, allowed_source_keys, created_at, credential_version
        `)
          await tx.$executeRaw(Prisma.sql`
          INSERT INTO consumer_private.members (consumer_id, github_user_id, role)
          VALUES (${row.id}::uuid, ${actor}::bigint, 'owner')
        `)
          await tx.$executeRaw(Prisma.sql`
          INSERT INTO consumer_private.credentials (consumer_id, verifier, version)
          VALUES (${row.id}::uuid, ${digest}, 1)
        `)
          await tx.$executeRaw(Prisma.sql`
          INSERT INTO consumer_private.lifecycle_audit
            (consumer_id, actor_github_user_id, action, admission_sha,
             membership_version, credential_version)
          VALUES (${row.id}::uuid, ${actor}::bigint, 'created', ${admissionSha ?? null}, 1, 1),
                 (${row.id}::uuid, ${actor}::bigint, 'credential_issued', ${admissionSha ?? null}, 1, 1)
        `)
          return consumerRecord(row)
        },
        { maxWait: 10_000, timeout: 20_000 },
      )
      return { consumer, secret: issued }
    } catch (error) {
      if (uniqueConflict(error)) throw new ConsumerAccessError("conflict")
      throw error
    }
  }

  async members(id: string, actor: string): Promise<ConsumerMember[]> {
    return withConsumerOwner(
      this.writer,
      id,
      actor,
      undefined,
      async (tx, row) => {
        const rows = await tx.$queryRaw<
          Array<{ github_user_id: bigint; role: ConsumerMember["role"] }>
        >(Prisma.sql`
        SELECT github_user_id, role FROM consumer_private.members
        WHERE consumer_id = ${row.id}::uuid ORDER BY github_user_id
      `)
        return rows.map((member) => ({
          githubUserId: member.github_user_id.toString(),
          role: member.role,
        }))
      },
    )
  }

  async addMember(input: AddConsumerMemberMutation): Promise<void> {
    const member = githubId(input.memberGithubUserId)
    await withConsumerOwner(
      this.writer,
      input.consumerId,
      input.actorGithubUserId,
      input.admissionSha,
      async (tx, row) => {
        if (
          !Number.isSafeInteger(input.expectedVersion) ||
          input.expectedVersion < 1
        )
          throw new ConsumerAccessError("invalid")
        if (row.membership_version !== BigInt(input.expectedVersion))
          throw new ConsumerAccessError("conflict")
        if (row.state === "revoked" || row.state === "pending")
          throw new ConsumerAccessError("forbidden")
        const admissionSha = await withDeadline(
          8_000,
          input.verifyCurrentEligibility,
        )
        if (!admissionSha) throw new ConsumerAccessError("forbidden")
        try {
          await tx.$executeRaw(Prisma.sql`
          INSERT INTO consumer_private.members (consumer_id, github_user_id, role)
          VALUES (${row.id}::uuid, ${member}::bigint, 'owner')
        `)
        } catch (error) {
          if (uniqueConflict(error)) throw new ConsumerAccessError("conflict")
          throw error
        }
        await tx.$executeRaw(Prisma.sql`
        UPDATE consumer_private.consumers SET membership_version = membership_version + 1
        WHERE id = ${row.id}::uuid
      `)
        await tx.$executeRaw(Prisma.sql`
        INSERT INTO consumer_private.lifecycle_audit
          (consumer_id, actor_github_user_id, target_github_user_id, action, admission_sha, membership_version)
        VALUES (${row.id}::uuid, ${input.actorGithubUserId}::bigint,
                ${member}::bigint, 'member_added', ${admissionSha}, ${row.membership_version + 1n})
      `)
      },
    )
  }

  async removeMember(input: RemoveConsumerMemberMutation): Promise<void> {
    const member = githubId(input.memberGithubUserId)
    await withConsumerOwner(
      this.writer,
      input.consumerId,
      input.actorGithubUserId,
      input.admissionSha,
      async (tx, row, admissionSha) => {
        if (
          !Number.isSafeInteger(input.expectedVersion) ||
          input.expectedVersion < 1
        )
          throw new ConsumerAccessError("invalid")
        if (row.membership_version !== BigInt(input.expectedVersion))
          throw new ConsumerAccessError("conflict")
        const [count] = await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT count(*) AS count FROM consumer_private.members
        WHERE consumer_id = ${row.id}::uuid AND role = 'owner'
      `)
        if (count.count <= 1n) throw new ConsumerAccessError("conflict")
        const deleted = await tx.$queryRaw<
          Array<{ github_user_id: bigint }>
        >(Prisma.sql`
        DELETE FROM consumer_private.members
        WHERE consumer_id = ${row.id}::uuid AND github_user_id = ${member}::bigint
        RETURNING github_user_id
      `)
        if (!deleted.length) throw new ConsumerAccessError("missing")
        await tx.$executeRaw(Prisma.sql`
        UPDATE consumer_private.consumers SET membership_version = membership_version + 1
        WHERE id = ${row.id}::uuid
      `)
        await tx.$executeRaw(Prisma.sql`
        INSERT INTO consumer_private.lifecycle_audit
          (consumer_id, actor_github_user_id, target_github_user_id, action, admission_sha, membership_version)
        VALUES (${row.id}::uuid, ${input.actorGithubUserId}::bigint,
                ${member}::bigint, 'member_removed', ${admissionSha ?? null}, ${row.membership_version + 1n})
      `)
      },
      input.verifyCurrentAdmission,
    )
  }

  async rotate(
    input: RotateConsumerCredential,
  ): Promise<{ secret: string; credentialVersion: number }> {
    if (
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 1
    )
      throw new ConsumerAccessError("invalid")
    const issued = secret()
    const digest = credentialVerifier(issued)
    return withConsumerOwner(
      this.writer,
      input.consumerId,
      input.actorGithubUserId,
      input.admissionSha,
      async (tx, row, admissionSha) => {
        if (row.state === "revoked" || row.state === "pending")
          throw new ConsumerAccessError("forbidden")
        if (row.credential_version !== BigInt(input.expectedVersion))
          throw new ConsumerAccessError("conflict")
        const version = input.expectedVersion + 1
        const updated = await tx.$executeRaw(Prisma.sql`
        UPDATE consumer_private.credentials
        SET verifier = ${digest}, version = ${version}, issued_at = now(), revoked_at = NULL
        WHERE consumer_id = ${row.id}::uuid
      `)
        if (updated !== 1) throw new ConsumerAccessError("missing")
        await tx.$executeRaw(Prisma.sql`
        UPDATE consumer_private.consumers
        SET credential_version = ${version}, updated_at = now()
        WHERE id = ${row.id}::uuid
      `)
        await tx.$executeRaw(Prisma.sql`
        INSERT INTO consumer_private.lifecycle_audit
          (consumer_id, actor_github_user_id, action, admission_sha, credential_version)
        VALUES (${row.id}::uuid, ${input.actorGithubUserId}::bigint,
                ${input.reason === "lost" ? "recovery" : "credential_rotated"},
                ${admissionSha ?? null}, ${version})
      `)
        return { secret: issued, credentialVersion: version }
      },
      input.verifyCurrentAdmission,
    )
  }

  async transition(input: TransitionConsumer): Promise<void> {
    await withConsumerOwner(
      this.writer,
      input.consumerId,
      input.actorGithubUserId,
      input.admissionSha,
      async (tx, row, admissionSha) => {
        if (
          row.state === "revoked" ||
          (input.state === "active" && row.state !== "suspended")
        )
          throw new ConsumerAccessError("forbidden")
        if (input.state === "suspended" && row.state !== "active")
          throw new ConsumerAccessError("forbidden")
        await tx.$executeRaw(Prisma.sql`
        UPDATE consumer_private.consumers SET state = ${input.state}, updated_at = now()
        WHERE id = ${row.id}::uuid
      `)
        if (input.state === "revoked") {
          await tx.$executeRaw(Prisma.sql`
          UPDATE consumer_private.credentials SET revoked_at = now()
          WHERE consumer_id = ${row.id}::uuid
        `)
        }
        const action =
          input.state === "active"
            ? "resumed"
            : input.state === "suspended"
              ? "suspended"
              : "revoked"
        await tx.$executeRaw(Prisma.sql`
        INSERT INTO consumer_private.lifecycle_audit
          (consumer_id, actor_github_user_id, action, admission_sha,
           membership_version, credential_version)
        VALUES (${row.id}::uuid, ${input.actorGithubUserId}::bigint,
                ${action}, ${admissionSha ?? null},
                ${row.membership_version}, ${row.credential_version})
      `)
      },
      input.verifyCurrentAdmission,
    )
  }
}
