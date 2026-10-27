import { Prisma } from "@prisma/client"
import {
  recordRetentionDecisionOperation,
  type RetentionDecisionObserver,
} from "./retention-operation-diagnostics"

/** Select a page through expiry/reference indexes, not the request-ID index.
 * Empty expired parents must not consume the parent page: they may still have
 * other retained children and cannot necessarily be deleted by this pass.
 * The scalar index-only probe avoids decorrelation into a whole-decision-table
 * semijoin. ANY preserves projection-index ordering even for one parent.
 * The scalar outer LIMIT favors a startup plan over bitmap+sort when estimates
 * undercount a high-fanout parent; the native decision-heap regression covers it.
 * Empty-parent index probes remain proportional to expired parents examined.
 * Among equal projection IDs, row order is immaterial: each committed page
 * removes references, and a finite cohort drains without a persistent cursor.
 */
export async function selectExpiredDecisionLinks(
  tx: Prisma.TransactionClient,
  now: Date,
  batchSize: number,
): Promise<Array<{ requestId: string; projectionGenerationId: string }>> {
  return tx.$queryRaw(Prisma.sql`
    WITH parents AS MATERIALIZED (
      SELECT generation.id
      FROM recommendation_profile_projection_generation generation
      WHERE generation.expires_at <= ${now}
        AND (
          SELECT decision.projection_generation_id
          FROM recommendation_personalization_decision decision
          WHERE decision.projection_generation_id = ANY(ARRAY[generation.id])
          ORDER BY decision.projection_generation_id
          LIMIT 1
        ) IS NOT NULL
      ORDER BY generation.expires_at, generation.id
      LIMIT ${batchSize}
    )
    SELECT request_id AS "requestId",
           projection_generation_id AS "projectionGenerationId"
    FROM recommendation_personalization_decision
    WHERE projection_generation_id = ANY(ARRAY(SELECT id FROM parents))
    ORDER BY projection_generation_id
    LIMIT (SELECT ${batchSize}::integer)
  `)
}

export async function unlinkExpiredDecisionLinks(
  tx: Prisma.TransactionClient,
  now: Date,
  batchSize: number,
  observer?: RetentionDecisionObserver,
): Promise<{ selectedCount: number; unlinkedCount: number }> {
  recordRetentionDecisionOperation(observer, "select")
  const rows = await selectExpiredDecisionLinks(tx, now, batchSize)
  recordRetentionDecisionOperation(observer, "selected", rows.length)
  if (rows.length) recordRetentionDecisionOperation(observer, "update")
  const unlinkedCount = rows.length
    ? (
        await tx.recommendationPersonalizationDecision.updateMany({
          where: {
            OR: rows.map(({ requestId, projectionGenerationId }) => ({
              requestId,
              projectionGenerationId,
            })),
            projectionGeneration: { is: { expiresAt: { lte: now } } },
          },
          data: { projectionGenerationId: null },
        })
      ).count
    : 0
  if (rows.length)
    recordRetentionDecisionOperation(observer, "updated", unlinkedCount)
  return { selectedCount: rows.length, unlinkedCount }
}
