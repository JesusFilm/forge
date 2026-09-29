import { randomBytes } from "node:crypto"
import { Prisma, type PrismaClient } from "../../generated/prisma/index.js"
import type {
  TransitionConsumer,
  RecoverConsumer,
} from "../../contracts/consumer-access.js"
import { ConsumerAccessError } from "../../contracts/consumer-access.js"
import { credentialVerifier } from "./consumer-auth.js"
import { withConsumerOwner } from "./consumer-access-ownership.js"

const secret = () => `rag_${randomBytes(32).toString("base64url")}`

export async function transitionConsumer(
  writer: PrismaClient,
  input: TransitionConsumer,
): Promise<void> {
  if (
    input.state !== "active" &&
    input.state !== "suspended" &&
    input.state !== "revoked"
  )
    throw new ConsumerAccessError("invalid")
  await withConsumerOwner(
    writer,
    input.consumerId,
    input.actorGithubUserId,
    input.admissionSha,
    async (tx, row, admissionSha) => {
      if (
        !Number.isSafeInteger(input.expectedVersion) ||
        input.expectedVersion < 1
      )
        throw new ConsumerAccessError("invalid")
      if (row.lifecycle_version !== BigInt(input.expectedVersion))
        throw new ConsumerAccessError("conflict")
      if (input.state === "active" && row.state !== "suspended")
        throw new ConsumerAccessError("forbidden")
      if (input.state === "suspended" && row.state !== "active")
        throw new ConsumerAccessError("forbidden")
      if (
        input.state === "revoked" &&
        row.state !== "active" &&
        row.state !== "suspended"
      )
        throw new ConsumerAccessError("forbidden")
      await tx.$executeRaw(Prisma.sql`
        UPDATE consumer_private.consumers SET state = ${input.state},
          lifecycle_version = lifecycle_version + 1, updated_at = now()
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

export async function recoverConsumer(
  writer: PrismaClient,
  input: RecoverConsumer,
): Promise<{ secret: string; credentialVersion: number }> {
  if (
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 0 ||
    !Number.isSafeInteger(input.expectedLifecycleVersion) ||
    input.expectedLifecycleVersion < 1
  )
    throw new ConsumerAccessError("invalid")
  const issued = secret()
  const digest = credentialVerifier(issued)
  return withConsumerOwner(
    writer,
    input.consumerId,
    input.actorGithubUserId,
    input.admissionSha,
    async (tx, row, admissionSha) => {
      if (row.state !== "revoked") throw new ConsumerAccessError("forbidden")
      if (
        row.credential_version !== BigInt(input.expectedVersion) ||
        row.lifecycle_version !== BigInt(input.expectedLifecycleVersion)
      )
        throw new ConsumerAccessError("conflict")
      const version = input.expectedVersion + 1
      const updated =
        row.credential_version === 0n
          ? await tx.$executeRaw(Prisma.sql`
              INSERT INTO consumer_private.credentials (consumer_id, verifier, version)
              VALUES (${row.id}::uuid, ${digest}, ${version})
            `)
          : await tx.$executeRaw(Prisma.sql`
              UPDATE consumer_private.credentials
              SET verifier = ${digest}, version = ${version}, issued_at = now(), revoked_at = NULL
              WHERE consumer_id = ${row.id}::uuid
            `)
      if (updated !== 1) throw new ConsumerAccessError("missing")
      await tx.$executeRaw(Prisma.sql`
          UPDATE consumer_private.consumers SET state = 'active',
            credential_version = ${version}, lifecycle_version = lifecycle_version + 1,
            updated_at = now() WHERE id = ${row.id}::uuid
        `)
      await tx.$executeRaw(Prisma.sql`
          INSERT INTO consumer_private.lifecycle_audit
            (consumer_id, actor_github_user_id, action, admission_sha,
             membership_version, credential_version)
          VALUES (${row.id}::uuid, ${input.actorGithubUserId}::bigint,
            'recovered', ${admissionSha ?? null}, ${row.membership_version}, ${version})
        `)
      return { secret: issued, credentialVersion: version }
    },
    input.verifyCurrentAdmission,
  )
}
