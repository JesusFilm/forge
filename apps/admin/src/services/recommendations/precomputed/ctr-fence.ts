import { Prisma } from "@prisma/client"

/** Mutations share the experiment fence; archive and evaluation take it
 * exclusively. Hash collisions only cause extra waiting, not mixed evidence. */
export async function lockPrecomputedCtrEvidence(
  tx: Prisma.TransactionClient,
  experimentId: string,
  mode: "shared" | "exclusive",
): Promise<void> {
  if (mode === "shared") {
    await tx.$queryRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock_shared(5902573, hashtext(${experimentId})) IS NULL AS locked
    `)
  } else {
    await tx.$queryRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(5902573, hashtext(${experimentId})) IS NULL AS locked
    `)
  }
}
