import { Prisma, type PrismaClient } from "@prisma/client"

export async function loadVideoMuxPlaybackFallbacks(
  prisma: Pick<PrismaClient, "$queryRaw">,
  videoIds: readonly string[],
): Promise<Array<{ id: string; playbackId: string | null }>> {
  if (videoIds.length === 0) return []
  // Nested Prisma take trims in application memory and can parallel-hash the
  // entire Mux catalog. Use the existing playable-duration index to select
  // five eligible dubs per video, then prefer the primary within those five.
  return prisma.$queryRaw(Prisma.sql`
    SELECT v.id, choice.playback_id AS "playbackId"
    FROM video v
    LEFT JOIN LATERAL (
      SELECT candidates.playback_id
      FROM (
        SELECT d.id, d.language_id, d.duration, m.playback_id
        FROM video_dub d
        JOIN mux_video m ON m.id = d.mux_video_id
          AND m.playback_id IS NOT NULL AND m.deleted_at IS NULL
        WHERE d.video_id = v.id AND d.published = true
          AND d.hls IS NOT NULL AND d.deleted_at IS NULL
        ORDER BY d.duration DESC, d.id ASC
        LIMIT 5
      ) candidates
      ORDER BY CASE WHEN v.primary_language_id <> '' AND candidates.language_id = v.primary_language_id THEN 0 ELSE 1 END,
        candidates.duration DESC, candidates.id ASC
      LIMIT 1
    ) choice ON true
    WHERE v.id IN (${Prisma.join([...new Set(videoIds)])})
      AND v.deleted_at IS NULL
  `)
}
