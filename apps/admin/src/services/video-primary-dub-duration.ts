import { Prisma, type PrismaClient } from "@prisma/client"

export async function loadVideoPrimaryDubDurations(
  prisma: Pick<PrismaClient, "$queryRaw">,
  videoIds: readonly string[],
): Promise<Array<{ id: string; duration: number | null }>> {
  if (videoIds.length === 0) return []
  // Prisma's nested take loads every matching dub and trims the relation in
  // application memory. Keep the existing primary-within-five policy, but
  // perform the bounded selection and scalar projection inside PostgreSQL.
  return prisma.$queryRaw(Prisma.sql`
    SELECT v.id,
           COALESCE(
             max(d.duration) FILTER (
               WHERE v.primary_language_id <> '' AND d.language_id = v.primary_language_id
             ),
             max(d.duration)
           ) AS duration
    FROM video v
    LEFT JOIN LATERAL (
      SELECT language_id, duration FROM video_dub
      WHERE video_id = v.id AND published = true AND hls IS NOT NULL
        AND deleted_at IS NULL AND duration > 0
      ORDER BY duration DESC LIMIT 5
    ) d ON true
    WHERE v.id IN (${Prisma.join([...new Set(videoIds)])})
      AND v.deleted_at IS NULL
    GROUP BY v.id
  `)
}
