import { Prisma } from "@prisma/client"

/** Select a page through expiry/reference indexes, not the run-ID index.
 * Empty expired parents must not consume the parent page: they may still have
 * other retained children and cannot necessarily be deleted by this pass.
 * The scalar index-only probe avoids decorrelation into a whole-run-table
 * semijoin. ANY preserves projection-index ordering even for one parent.
 * The scalar outer LIMIT favors a startup plan over bitmap+sort when estimates
 * undercount a high-fanout parent; the native run-heap regression covers it.
 * Empty-parent index probes remain proportional to expired parents examined.
 * Among equal projection IDs, row order is immaterial: each committed page
 * removes references, and a finite cohort drains without a persistent cursor.
 */
export async function selectExpiredProjectionRunLinks(
  tx: Prisma.TransactionClient,
  now: Date,
  batchSize: number,
): Promise<Array<{ id: string; projectionId: string }>> {
  return tx.$queryRaw(Prisma.sql`
    WITH parents AS MATERIALIZED (
      SELECT generation.id
      FROM recommendation_profile_projection_generation generation
      WHERE generation.expires_at <= ${now}
        AND (
          SELECT run.projection_id
          FROM recommendation_profile_projection_run run
          WHERE run.projection_id = ANY(ARRAY[generation.id])
          ORDER BY run.projection_id
          LIMIT 1
        ) IS NOT NULL
      ORDER BY generation.expires_at, generation.id
      LIMIT ${batchSize}
    )
    SELECT id AS "id",
           projection_id AS "projectionId"
    FROM recommendation_profile_projection_run
    WHERE projection_id = ANY(ARRAY(SELECT id FROM parents))
    ORDER BY projection_id
    LIMIT (SELECT ${batchSize}::integer)
  `)
}

export async function unlinkExpiredProjectionRunLinks(
  tx: Prisma.TransactionClient,
  now: Date,
  batchSize: number,
): Promise<{ selectedCount: number; unlinkedCount: number }> {
  const rows = await selectExpiredProjectionRunLinks(tx, now, batchSize)
  const unlinkedCount = rows.length
    ? (
        await tx.recommendationProfileProjectionRun.updateMany({
          where: {
            OR: rows.map(({ id, projectionId }) => ({
              id,
              projectionId,
            })),
            projection: { is: { expiresAt: { lte: now } } },
          },
          data: { projectionId: null },
        })
      ).count
    : 0
  return { selectedCount: rows.length, unlinkedCount }
}
