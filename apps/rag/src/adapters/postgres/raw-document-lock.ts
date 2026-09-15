import { Prisma } from "../../generated/prisma/index.js"

const RAW_DOCUMENT_LOCK_NAMESPACE = 1_380_336_147

// Promotion may hold this source lock for its full 10-minute transaction.
// Leave acquisition enough transaction time to wait out that bounded window
// instead of failing on Prisma's interactive-transaction default.
export const RAW_DOCUMENT_ACQUISITION_TRANSACTION_OPTIONS = {
  maxWait: 10_000,
  timeout: 660_000,
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
} as const

export async function lockRawDocumentSource(
  transaction: Prisma.TransactionClient,
  sourceKey: string,
): Promise<void> {
  await transaction.$queryRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(
      ${RAW_DOCUMENT_LOCK_NAMESPACE}::int,
      hashtext(${sourceKey})
    ) IS NULL AS locked
  `)
}
