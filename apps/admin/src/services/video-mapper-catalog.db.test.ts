import { Prisma, PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { VideoService, type VideoMapperCatalogItem } from "./video.service"

const RUN_REAL_DB_TEST = env.VIDEO_MAPPER_CATALOG_DB_TEST === "1"

type RepresentativeTarget = {
  targetId: string
  beforeId: string | null
}

function encodeCursorForTest(adminDubId: string) {
  return Buffer.from(`video-dub:${adminDubId}`, "utf8").toString("base64url")
}

async function findRepresentativeTarget(
  prisma: PrismaClient,
  predicate: Prisma.Sql,
) {
  const rows = await prisma.$queryRaw<RepresentativeTarget[]>`
    WITH candidates AS (
      SELECT d.id
      FROM video_dub d
      JOIN video v
        ON v.id = d.video_id
      LEFT JOIN language
        ON language.id = d.language_id
      LEFT JOIN video_edition edition
        ON edition.id = d.video_edition_id
      LEFT JOIN LATERAL (
        SELECT EXISTS (
          SELECT 1
          FROM video_locale published_locale
          WHERE published_locale.video_id = v.id
            AND published_locale.deleted_at IS NULL
            AND published_locale.status = 'published'
        ) AS video_published
      ) published_state ON TRUE
      LEFT JOIN LATERAL (
        SELECT download.url
        FROM video_dub_download download
        WHERE download.video_dub_id = d.id
          AND d.downloadable = TRUE
          AND download.deleted_at IS NULL
          AND NULLIF(download.url, '') IS NOT NULL
          AND download.url ~* '^https?://'
        ORDER BY
          download.width DESC NULLS LAST,
          download.height DESC NULLS LAST,
          download.updated_at DESC
        LIMIT 1
      ) selected_download ON TRUE
      WHERE ${predicate}
      ORDER BY d.id ASC
      LIMIT 1
    )
    SELECT
      candidates.id AS "targetId",
      (
        SELECT previous.id
        FROM video_dub previous
        WHERE previous.id < candidates.id
        ORDER BY previous.id DESC
        LIMIT 1
      ) AS "beforeId"
    FROM candidates
  `
  expect(rows).toHaveLength(1)
  return rows[0]!
}

async function fetchRepresentativeRow(
  prisma: PrismaClient,
  service: VideoService,
  predicate: Prisma.Sql,
): Promise<VideoMapperCatalogItem> {
  const target = await findRepresentativeTarget(prisma, predicate)
  const page = await service.listMapperCatalogVariants({
    first: 1,
    after:
      target.beforeId == null ? null : encodeCursorForTest(target.beforeId),
  })

  expect(page.nodes).toHaveLength(1)
  expect(page.nodes[0]!.adminDubId).toBe(target.targetId)
  return page.nodes[0]!
}

describe.skipIf(!RUN_REAL_DB_TEST)(
  "VideoService.listMapperCatalogVariants real Admin database",
  () => {
    let prisma: PrismaClient
    let service: VideoService

    beforeAll(async () => {
      prisma = new PrismaClient()
      await prisma.$connect()
      service = new VideoService(prisma)
    })

    afterAll(async () => {
      await prisma.$disconnect()
    })

    it("returns real VideoDub rows with mapper-required identities and stable cursors", async () => {
      const firstPage = await service.listMapperCatalogVariants({ first: 25 })

      expect(firstPage.nodes.length).toBeGreaterThan(0)
      expect(firstPage.pageInfo.startCursor).toEqual(expect.any(String))
      expect(firstPage.pageInfo.endCursor).toEqual(expect.any(String))
      expect(firstPage.pageInfo.hasNextPage).toBe(true)

      const first = firstPage.nodes[0]!
      expect(first.coreId).toEqual(expect.any(String))
      expect(first.coreId).not.toBe("")
      expect(first.sourceTitle).toEqual(expect.any(String))
      expect(first.sourceTitle).not.toBe("")
      expect(first.videoVariantId).toEqual(expect.any(String))
      expect(first.videoVariantId).not.toBe("")
      expect(first.adminVideoId).toEqual(expect.any(String))
      expect(first.adminDubId).toEqual(expect.any(String))
      expect(["DOWNLOAD", "HLS", "DASH", "NONE"]).toContain(
        first.mediaSourceType,
      )
      expect(typeof first.indexable).toBe("boolean")

      const secondPage = await service.listMapperCatalogVariants({
        first: 25,
        after: firstPage.pageInfo.endCursor,
      })
      expect(secondPage.nodes.length).toBeGreaterThan(0)
      expect(
        secondPage.nodes[0]!.adminDubId > firstPage.nodes.at(-1)!.adminDubId,
      ).toBe(true)
    }, 30_000)

    it("selects real downloadable, HLS fallback, and non-indexable media-missing rows", async () => {
      const indexableBasePredicate = Prisma.sql`
        d.deleted_at IS NULL
        AND v.deleted_at IS NULL
        AND (edition.id IS NULL OR edition.deleted_at IS NULL)
        AND language.id IS NOT NULL
        AND language.deleted_at IS NULL
        AND d.published = TRUE
        AND v.no_index = FALSE
        AND published_state.video_published = TRUE
      `

      const download = await fetchRepresentativeRow(
        prisma,
        service,
        Prisma.sql`
          ${indexableBasePredicate}
          AND selected_download.url IS NOT NULL
        `,
      )
      expect(download.indexable).toBe(true)
      expect(download.mediaSourceType).toBe("DOWNLOAD")
      expect(download.downloadUrl).toEqual(download.mediaSourceUrl)
      expect(download.mediaSourceUrl).toMatch(/^https?:\/\//)
      expect(download.coreId).not.toBe("")
      expect(download.videoVariantId).not.toBe("")

      const hls = await fetchRepresentativeRow(
        prisma,
        service,
        Prisma.sql`
          ${indexableBasePredicate}
          AND selected_download.url IS NULL
          AND NULLIF(d.hls, '') IS NOT NULL
        `,
      )
      expect(hls.indexable).toBe(true)
      expect(hls.mediaSourceType).toBe("HLS")
      expect(hls.downloadUrl).toBeNull()
      expect(hls.hlsUrl).toEqual(hls.mediaSourceUrl)
      expect(hls.mediaSourceUrl).toMatch(/^https?:\/\//)

      const mediaMissing = await fetchRepresentativeRow(
        prisma,
        service,
        Prisma.sql`
          ${indexableBasePredicate}
          AND selected_download.url IS NULL
          AND NULLIF(d.hls, '') IS NULL
          AND NULLIF(d.dash, '') IS NULL
        `,
      )
      expect(mediaMissing.mediaSourceType).toBe("NONE")
      expect(mediaMissing.mediaSourceUrl).toBeNull()
      expect(mediaMissing.indexable).toBe(false)
      expect(mediaMissing.nonIndexableReason).toBe("media_missing")
    }, 30_000)
  },
)
