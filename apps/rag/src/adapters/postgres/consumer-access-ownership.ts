import { Prisma, type PrismaClient } from "../../generated/prisma/index.js"
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
  operation: (tx: Prisma.TransactionClient, row: ConsumerRow) => Promise<T>,
  verifyCurrentAdmission?: () => Promise<boolean>,
): Promise<T> {
  const target = consumerId(id)
  const owner = githubId(actor)
  try {
    return await db.$transaction(
      async (tx) => {
        const [row] = await tx.$queryRaw<ConsumerRow[]>(Prisma.sql`
        SELECT id, name, state, allowed_source_keys, created_at,
               credential_version, membership_version
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
        if (verifyCurrentAdmission && !(await verifyCurrentAdmission()))
          throw new ConsumerAccessError("forbidden")
        return operation(tx, row)
      },
      { maxWait: 10_000, timeout: 20_000 },
    )
  } catch (error) {
    if (error instanceof ConsumerAccessError && error.code === "forbidden") {
      await db.$executeRaw(Prisma.sql`
        INSERT INTO consumer_private.lifecycle_audit
          (consumer_id, actor_github_user_id, action, admission_sha,
           membership_version, credential_version)
        SELECT id, ${owner}::bigint, 'denied', ${admissionSha ?? null},
               membership_version, credential_version
        FROM consumer_private.consumers WHERE id = ${target}::uuid
      `)
    }
    throw error
  }
}
