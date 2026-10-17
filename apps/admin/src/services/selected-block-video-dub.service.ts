import { Prisma, type PrismaClient, type VideoDub } from "@prisma/client"

export const SELECTED_BLOCK_VIDEO_DUB_BATCH_SIZE = 100
export type SelectedBlockVideoDubIdentity = {
  videoId: string
  languageId: string
}

function identityKey(identity: SelectedBlockVideoDubIdentity) {
  return JSON.stringify([identity.videoId, identity.languageId])
}

/** Preserve the authored exact-language winner while batching sibling reads. */
export async function getSelectedBlockVideoDubs(
  prisma: Pick<PrismaClient, "$queryRaw" | "videoDub">,
  identities: readonly SelectedBlockVideoDubIdentity[],
  query: object,
): Promise<Array<VideoDub | null>> {
  const unique = [
    ...new Map(identities.map((key) => [identityKey(key), key])).values(),
  ]
  if (unique.length === 0) return []
  if (unique.length > SELECTED_BLOCK_VIDEO_DUB_BATCH_SIZE) {
    throw new RangeError("Selected block dub batch exceeds its limit")
  }
  const picks = await prisma.$queryRaw<
    Array<SelectedBlockVideoDubIdentity & { dubId: string | null }>
  >(
    Prisma.sql`
      WITH requested("videoId", "languageId") AS (
        VALUES ${Prisma.join(unique.map(({ videoId, languageId }) => Prisma.sql`(${videoId}::text, ${languageId}::text)`))}
      )
      SELECT requested.*, winner.id AS "dubId"
      FROM requested
      LEFT JOIN LATERAL (
        SELECT d.id FROM video_dub d
        JOIN video v ON v.id = d.video_id AND v.deleted_at IS NULL
        WHERE d.video_id = requested."videoId"
          AND d.language_id = requested."languageId"
          AND d.deleted_at IS NULL AND d.published
          AND (d.hls IS NOT NULL OR d.dash IS NOT NULL OR d.share IS NOT NULL)
        ORDER BY d.duration DESC, d.id ASC LIMIT 1
      ) winner ON TRUE
    `,
  )
  const dubIds = picks.flatMap(({ dubId }) => (dubId ? [dubId] : []))
  if (dubIds.length === 0) return identities.map(() => null)
  const selection = query as { select?: Record<string, unknown> }
  const dubs = await prisma.videoDub.findMany({
    ...query,
    ...(selection.select
      ? {
          select: {
            ...selection.select,
            id: true,
            videoId: true,
            languageId: true,
          },
        }
      : {}),
    where: {
      id: { in: dubIds },
      deletedAt: null,
      published: true,
      OR: [
        { hls: { not: null } },
        { dash: { not: null } },
        { share: { not: null } },
      ],
      video: { deletedAt: null },
    },
  })
  const byId = new Map(dubs.map((dub) => [dub.id, dub]))
  const byIdentity = new Map(
    picks.map((pick) => {
      const dub = pick.dubId ? byId.get(pick.dubId) : undefined
      // Withdrawal or reassignment between selection and hydration must not
      // expose an unavailable dub or one belonging to a different identity.
      return [
        identityKey(pick),
        dub?.videoId === pick.videoId && dub.languageId === pick.languageId
          ? dub
          : null,
      ]
    }),
  )
  return identities.map((key) => byIdentity.get(identityKey(key)) ?? null)
}
