import { Prisma } from "@prisma/client"

/** Retained influence survives normal refresh, but never an explicit revocation. */
export function ownerReleaseInfluenceAllowedSql(
  requestId: Prisma.Sql,
): Prisma.Sql {
  return Prisma.sql`NOT EXISTS (
    SELECT 1 FROM recommendation_request owner_request
    WHERE owner_request.id = ${requestId}
      AND owner_request.owner_release_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM recommendation_owner_release owner_release
        JOIN recommendation_promotion_pointer owner_pointer
          ON owner_pointer.id = 'recommendation-promotion-pointer'
        WHERE owner_release.id = owner_request.owner_release_id
          AND owner_release.pointer_generation = owner_request.owner_release_generation
          AND owner_release.revoked_at IS NULL
          AND owner_request.owner_release_generation >= owner_pointer.owner_influence_floor_generation
          AND owner_request.created_at >= owner_release.approved_at
          AND owner_request.created_at < owner_release.valid_until
      )
  )`
}

export async function ownerReleaseInfluenceAllowed(
  tx: Prisma.TransactionClient,
  request: { id: string; ownerReleaseId?: string | null },
): Promise<boolean> {
  if (!request.ownerReleaseId) return true
  const rows = await tx.$queryRaw<Array<{ eligible: boolean }>>(Prisma.sql`
    SELECT ${ownerReleaseInfluenceAllowedSql(Prisma.sql`${request.id}`)} AS eligible
  `)
  return rows[0]?.eligible === true
}
