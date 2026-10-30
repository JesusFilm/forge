import { Prisma, type PrismaClient, type VideoDub } from "@prisma/client"

export const PREFERRED_PLAYABLE_DUB_BATCH_SIZE = 100

/** Select one winning dub per video before hydrating the requested relations. */
export async function getPreferredPlayableDubs(
  prisma: Pick<PrismaClient, "$queryRaw" | "videoDub">,
  {
    videoIds,
    languageSlug,
    query,
  }: {
    videoIds: readonly string[]
    languageSlug: string | null
    query: object
  },
): Promise<Array<VideoDub | null>> {
  const ids = [...new Set(videoIds)]
  if (ids.length === 0) return []
  if (ids.length > PREFERRED_PLAYABLE_DUB_BATCH_SIZE) {
    throw new RangeError("Preferred playable dub batch exceeds its limit")
  }
  const language = languageSlug || null
  // Keep the scalar service's exact slug/BCP-47 -> primary -> longest policy,
  // including PostgreSQL's existing DESC null ordering and id tie-break.
  const picks = await prisma.$queryRaw<
    Array<{ videoId: string; dubId: string | null }>
  >(Prisma.sql`
    SELECT v.id AS "videoId",
           COALESCE(exact.id, primary_dub.id, fallback.id) AS "dubId"
    FROM video v
    LEFT JOIN LATERAL (
      SELECT d.id FROM video_dub d
      JOIN language l ON l.id = d.language_id AND l.deleted_at IS NULL
      WHERE d.video_id = v.id AND d.deleted_at IS NULL AND d.published
        AND d.hls IS NOT NULL AND d.hls <> ''
        AND (l.slug = ${language} OR l.bcp47 = ${language})
      ORDER BY d.duration DESC, d.id ASC LIMIT 1
    ) exact ON TRUE
    LEFT JOIN LATERAL (
      SELECT d.id FROM video_dub d
      WHERE exact.id IS NULL AND d.video_id = v.id
        AND d.language_id = v.primary_language_id
        AND d.deleted_at IS NULL AND d.published
        AND d.hls IS NOT NULL AND d.hls <> ''
      ORDER BY d.duration DESC, d.id ASC LIMIT 1
    ) primary_dub ON TRUE
    LEFT JOIN LATERAL (
      SELECT d.id FROM video_dub d
      WHERE exact.id IS NULL AND primary_dub.id IS NULL AND d.video_id = v.id
        AND d.deleted_at IS NULL AND d.published
        AND d.hls IS NOT NULL AND d.hls <> ''
      ORDER BY d.duration DESC, d.id ASC LIMIT 1
    ) fallback ON TRUE
    WHERE v.id IN (${Prisma.join(ids)}) AND v.deleted_at IS NULL
  `)
  const dubIds = picks.flatMap(({ dubId }) => (dubId ? [dubId] : []))
  if (dubIds.length === 0) return videoIds.map(() => null)
  const selection = query as { select?: Record<string, unknown> }
  const dubs = await prisma.videoDub.findMany({
    ...query,
    ...(selection.select ? { select: { ...selection.select, id: true } } : {}),
    where: {
      id: { in: dubIds },
      // A selected dub can be withdrawn between selection and hydration.
      deletedAt: null,
      published: true,
      AND: [{ hls: { not: null } }, { hls: { not: "" } }],
      video: { deletedAt: null },
    },
  })
  const byId = new Map(dubs.map((dub) => [dub.id, dub]))
  const byVideo = new Map(
    picks.map(({ videoId, dubId }) => [
      videoId,
      dubId ? (byId.get(dubId) ?? null) : null,
    ]),
  )
  return videoIds.map((videoId) => byVideo.get(videoId) ?? null)
}
