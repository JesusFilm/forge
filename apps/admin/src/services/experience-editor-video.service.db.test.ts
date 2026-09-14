import { Prisma, type PrismaClient } from "@prisma/client"
import { describe, expect, it } from "vitest"
import { prisma } from "@/db/client"
import {
  EXPERIENCE_EDITOR_LANGUAGE_CHIP_LIMIT,
  loadExperienceEditorVideoSummariesByIds,
} from "./experience-editor-video.service"

const RUN_REAL_DB_TEST =
  process.env.EXPERIENCE_EDITOR_VIDEO_DB_TEST?.trim() === "1"

describe.skipIf(!RUN_REAL_DB_TEST)(
  "experience editor video summaries (real PostgreSQL)",
  () => {
    it("keeps materialized Dub rows bounded while matching the SQL language aggregate", async () => {
      const candidates = await prisma.$queryRaw<
        Array<{ videoId: string; playableLanguageCount: bigint }>
      >(Prisma.sql`
        SELECT d.video_id AS "videoId",
               count(DISTINCT COALESCE(
                 NULLIF(lower(btrim(l.slug)), ''),
                 NULLIF(lower(btrim(l.bcp47)), ''),
                 NULLIF(lower(btrim(l.iso3)), ''),
                 NULLIF(lower(btrim(COALESCE(l.id, d.language_id))), ''),
                 d.id
               ))::bigint AS "playableLanguageCount"
        FROM video_dub d
        JOIN video v ON v.id = d.video_id AND v.deleted_at IS NULL
        LEFT JOIN language l ON l.id = d.language_id
        WHERE d.deleted_at IS NULL
          AND COALESCE(
            NULLIF(btrim(d.hls), ''),
            NULLIF(btrim(d.dash), ''),
            NULLIF(btrim(d.share), '')
          ) IS NOT NULL
        GROUP BY d.video_id
        ORDER BY count(*) DESC, d.video_id ASC
        LIMIT 1
      `)
      const candidate = candidates[0]
      if (!candidate) return

      let materializedDubRows = 0
      const observedDb = {
        $queryRaw: prisma.$queryRaw.bind(prisma),
        videoDub: {
          findMany: async (
            ...args: Parameters<typeof prisma.videoDub.findMany>
          ) => {
            const rows = await prisma.videoDub.findMany(...args)
            materializedDubRows += rows.length
            return rows
          },
        },
      } as unknown as PrismaClient

      const [summary] = await loadExperienceEditorVideoSummariesByIds(
        observedDb,
        { videoIds: [candidate.videoId], locale: "en" },
      )

      expect(summary?.key).toBe(candidate.videoId)
      expect(summary?.playableLanguageCount).toBe(
        Number(candidate.playableLanguageCount),
      )
      expect(summary?.dubInventory).toEqual({ status: "not-loaded" })
      expect(materializedDubRows).toBeLessThanOrEqual(
        EXPERIENCE_EDITOR_LANGUAGE_CHIP_LIMIT + 1,
      )
    })
  },
)
