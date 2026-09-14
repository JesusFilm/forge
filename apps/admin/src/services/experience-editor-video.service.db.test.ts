import { Prisma, type PrismaClient } from "@prisma/client"
import { describe, expect, it } from "vitest"
import { prisma } from "@/db/client"
import {
  EXPERIENCE_EDITOR_LANGUAGE_CHIP_LIMIT,
  loadExperienceEditorCollectionChildPage,
  loadExperienceEditorDubPage,
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

    it("returns non-overlapping deterministic language and collection page boundaries", async () => {
      const [video] = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT v.id
        FROM video v
        WHERE v.deleted_at IS NULL
          AND (SELECT count(*) FROM video_dub d
               WHERE d.video_id = v.id AND d.deleted_at IS NULL
                 AND COALESCE(NULLIF(btrim(d.hls), ''), NULLIF(btrim(d.dash), ''), NULLIF(btrim(d.share), '')) IS NOT NULL) >= 2
        ORDER BY v.id ASC
        LIMIT 1
      `)
      if (video) {
        const first = await loadExperienceEditorDubPage(prisma, {
          videoId: video.id,
          locale: "en",
          pageSize: 1,
        })
        if (first.nextCursor) {
          const second = await loadExperienceEditorDubPage(prisma, {
            videoId: video.id,
            locale: "en",
            pageSize: 1,
            cursor: first.nextCursor,
          })
          expect(second.choices[0]?.key).not.toBe(first.choices[0]?.key)
        }

        const [selectedDub] = await prisma.$queryRaw<
          Array<{ id: string; languageId: string; streamUrl: string }>
        >(Prisma.sql`
          SELECT d.id,
                 d.language_id AS "languageId",
                 COALESCE(NULLIF(btrim(d.hls), ''), NULLIF(btrim(d.dash), ''), NULLIF(btrim(d.share), '')) AS "streamUrl"
          FROM video_dub d
          WHERE d.video_id = ${video.id}
            AND d.language_id IS NOT NULL
            AND d.deleted_at IS NULL
            AND COALESCE(NULLIF(btrim(d.hls), ''), NULLIF(btrim(d.dash), ''), NULLIF(btrim(d.share), '')) IS NOT NULL
          ORDER BY d.updated_at DESC NULLS LAST, d.id ASC
          LIMIT 1
        `)
        if (selectedDub) {
          const selectedByLanguage = await loadExperienceEditorDubPage(prisma, {
            videoId: video.id,
            locale: "en",
            pageSize: 1,
            selectedLanguageId: selectedDub.languageId,
          })
          expect(selectedByLanguage.selectedChoice?.key).toBe(selectedDub.id)

          const selectedByLegacyUrl = await loadExperienceEditorDubPage(
            prisma,
            {
              videoId: video.id,
              locale: "en",
              pageSize: 1,
              selectedLegacyStreamingUrl: selectedDub.streamUrl,
            },
          )
          expect(selectedByLegacyUrl.selectedChoice?.key).toBe(selectedDub.id)
        }
      }

      const [parent] = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT r.parent_id AS id
        FROM video_relation r
        JOIN video parent ON parent.id = r.parent_id AND parent.deleted_at IS NULL
        JOIN video child ON child.id = r.child_id AND child.deleted_at IS NULL
        GROUP BY r.parent_id
        HAVING count(*) >= 2
        ORDER BY r.parent_id ASC
        LIMIT 1
      `)
      if (!parent) return
      const first = await loadExperienceEditorCollectionChildPage(prisma, {
        parentVideoId: parent.id,
        locale: "en",
        pageSize: 1,
      })
      expect(first.items).toHaveLength(1)
      expect(first.total).toBeGreaterThanOrEqual(2)
      const second = await loadExperienceEditorCollectionChildPage(prisma, {
        parentVideoId: parent.id,
        locale: "en",
        pageSize: 1,
        cursor: first.nextCursor,
      })
      expect(second.items[0]?.key).not.toBe(first.items[0]?.key)
    })
  },
)
