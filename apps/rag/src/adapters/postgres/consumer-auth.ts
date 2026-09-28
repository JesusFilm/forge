import { createHash, timingSafeEqual } from "node:crypto"
import { withDeadline } from "../../contracts/deadline.js"

import { Prisma, type PrismaClient } from "../../generated/prisma/index.js"
import type {
  AuthenticatedConsumer,
  ConsumerAuthenticator,
} from "../../contracts/consumer-access.js"

export const credentialVerifier = (value: string): string =>
  createHash("sha256").update(value).digest("hex")

/** Recheck the current verifier and lifecycle on every request, without a positive cache. */
export class PostgresConsumerAuthenticator implements ConsumerAuthenticator {
  constructor(private readonly reader: PrismaClient) {}

  async authenticate(presented: string): Promise<AuthenticatedConsumer | null> {
    if (!/^rag_[A-Za-z0-9_-]{43}$/.test(presented)) return null
    const digest = credentialVerifier(presented)
    const rows = await withDeadline(3_500, () =>
      this.reader.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT set_config('statement_timeout', '2000', true)`
          return tx.$queryRaw<
            Array<{
              consumer_id: string
              verifier: string
              allowed_source_keys: string[]
            }>
          >(Prisma.sql`
      SELECT credential.consumer_id, credential.verifier, consumer.allowed_source_keys
      FROM consumer_private.credentials credential
      JOIN consumer_private.consumers consumer ON consumer.id = credential.consumer_id
      WHERE credential.verifier = ${digest} AND credential.revoked_at IS NULL
        AND consumer.state = 'active'
      LIMIT 1
    `)
        },
        { maxWait: 1_000, timeout: 2_500 },
      ),
    )
    const match = rows[0]
    if (
      !match ||
      !timingSafeEqual(
        Buffer.from(match.verifier, "hex"),
        Buffer.from(digest, "hex"),
      )
    )
      return null
    return {
      consumerId: match.consumer_id,
      allowedSourceKeys: match.allowed_source_keys,
    }
  }
}
