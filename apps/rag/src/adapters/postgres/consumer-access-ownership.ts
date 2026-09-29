import { Prisma, type PrismaClient } from "../../generated/prisma/index.js"
import { withDeadline } from "../../contracts/deadline.js"
import { ConsumerAccessError } from "../../contracts/consumer-access.js"
import {
  consumerId,
  githubId,
  type ConsumerRow,
} from "./consumer-access-validation.js"

/** Locks the consumer before checking owner authority and changing its state. */
export async function withConsumerOwner<T>(
  db: PrismaClient,
  id: string,
  actor: string,
  admissionSha: string | undefined,
  operation: (
    tx: Prisma.TransactionClient,
    row: ConsumerRow,
    admissionSha: string | undefined,
  ) => Promise<T>,
  verifyCurrentAdmission?: (signal?: AbortSignal) => Promise<string | null>,
): Promise<T> {
  const target = consumerId(id)
  const owner = githubId(actor)
  let currentSha = admissionSha
  try {
    return await db.$transaction(
      async (tx) => {
        const [row] = await tx.$queryRaw<ConsumerRow[]>(Prisma.sql`
        SELECT id, name, state, allowed_source_keys, created_at,
               credential_version, membership_version, lifecycle_version
        FROM consumer_private.consumers WHERE id = ${target}::uuid FOR UPDATE
      `)
        if (!row) throw new ConsumerAccessError("missing")
        const membership = await tx.$queryRaw<
          Array<{ github_user_id: bigint }>
        >(Prisma.sql`
        SELECT github_user_id FROM consumer_private.members
        WHERE consumer_id = ${target}::uuid AND github_user_id = ${owner}::bigint
          AND role = 'owner'
      `)
        if (!membership.length) throw new ConsumerAccessError("forbidden")
        if (verifyCurrentAdmission) {
          const freshSha = await withDeadline(8_000, verifyCurrentAdmission)
          if (!freshSha) throw new ConsumerAccessError("forbidden")
          currentSha = freshSha
        }
        return operation(tx, row, currentSha)
      },
      { maxWait: 10_000, timeout: 20_000 },
    )
  } catch (error) {
    if (
      error instanceof ConsumerAccessError &&
      (error.code === "forbidden" || error.code === "conflict")
    ) {
      try {
        await db.$executeRaw(Prisma.sql`
        INSERT INTO consumer_private.lifecycle_audit
          (consumer_id, actor_github_user_id, action, admission_sha,
           membership_version, credential_version)
        SELECT id, ${owner}::bigint, 'denied', ${currentSha ?? null},
               membership_version, credential_version
        FROM consumer_private.consumers WHERE id = ${target}::uuid
        `)
      } catch {
        // Fixed message only: never log SQL parameters, tokens, or caught errors.
        console.error("consumer_denial_audit_failed")
      }
    }
    throw error
  }
}
