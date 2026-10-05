import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { currentAdminMigrationSql } from "../current-schema.test-fixture"
import { readPrecomputedCatalog } from "./catalog"

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "authenticated source discovery on PostgreSQL",
  () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const schema = `precomputed_catalog_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const sourceVideoId = `a-source-${suffix}`
    const targetVideoId = `b-target-${suffix}`
    const spanishVideoId = `e-spanish-${suffix}`
    let prisma: PrismaClient
    let admin: Client
    let cutoff: string

    beforeAll(async () => {
      admin = new Client({ connectionString: env.DATABASE_URL })
      await admin.connect()
      await admin.query(`CREATE SCHEMA "${schema}"`)
      await admin.query(`SET search_path TO "${schema}", public`)
      for (const migration of currentAdminMigrationSql) {
        await admin.query(migration)
      }
      const url = new URL(env.DATABASE_URL)
      url.searchParams.set("schema", schema)
      prisma = new PrismaClient({
        datasources: { db: { url: url.toString() } },
      })
      const languageId = `language-${suffix}`
      await prisma.language.create({
        data: { id: languageId, coreId: languageId, slug: "english" },
      })
      const muxVideoId = `mux-${suffix}`
      await prisma.muxVideo.create({
        data: { id: muxVideoId, playbackId: `playback-${suffix}` },
      })
      for (const [index, videoId] of [
        sourceVideoId,
        targetVideoId,
        `c-restricted-${suffix}`,
        `d-unplayable-${suffix}`,
        spanishVideoId,
      ].entries()) {
        await prisma.video.create({
          data: {
            id: videoId,
            coreId: `core-${videoId}`,
            slug: videoId,
            restrictViewPlatforms: index === 2 ? ["watch"] : [],
          },
        })
        await prisma.videoLocale.create({
          data: {
            id: `locale-${videoId}`,
            videoId,
            locale: index === 4 ? "es" : "en",
            status: "PUBLISHED",
            title:
              index === 0
                ? "An account of hope"
                : index === 4
                  ? "Historia de esperanza"
                  : `Story ${index}`,
            description: "A distinct published story about hope and courage.",
          },
        })
        if (index !== 3) {
          await prisma.videoDub.create({
            data: {
              id: `dub-${videoId}`,
              coreId: `dub-core-${videoId}`,
              videoId,
              languageId,
              muxVideoId,
              published: true,
            },
          })
        }
      }
      const editionId = `edition-${suffix}`
      await prisma.videoEdition.create({
        data: { id: editionId, coreId: editionId, name: "Spanish edition" },
      })
      const transcriptId = `transcript-${suffix}`
      await prisma.videoTranscript.create({
        data: {
          id: transcriptId,
          videoEditionId: editionId,
          videoId: targetVideoId,
          language: "es",
          model: "fixture",
          dimensions: 1536,
          chunkingType: "fixture",
          maxChunkTokens: 100,
          overlapTokens: 0,
          totalChunks: 2,
          totalTokens: 18,
          generatedAt: new Date(),
        },
      })
      for (const [index, text] of [
        "Una historia de esperanza para todos.",
        "Un encuentro que cambia la vida.",
      ].entries()) {
        await prisma.videoTranscriptChunk.create({
          data: {
            id: `chunk-${index}-${suffix}`,
            transcriptId,
            language: "es",
            chunkIndex: index,
            chunkId: `chunk-${index}`,
            text,
            rawSourceText: text,
            tokenCount: 9,
          },
        })
      }
      cutoff = new Date(Date.now() + 5_000).toISOString()
    }, 120_000)

    afterAll(async () => {
      await prisma?.$disconnect()
      if (admin) {
        await admin.query("ROLLBACK").catch(() => undefined)
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await admin.end()
      }
    })

    it("denies catalog and transcript access without the producer bearer", async () => {
      await expect(
        readPrecomputedCatalog(
          prisma,
          { action: "video", videoId: sourceVideoId, cutoff },
          null,
        ),
      ).rejects.toMatchObject({ code: "unauthorized" })
    })

    it("pages the full eligible catalog and exposes multilingual evidence", async () => {
      const first = await readPrecomputedCatalog(
        prisma,
        { action: "catalog", cutoff, limit: 1 },
        "Bearer preview-test-key",
      )
      expect(first).toMatchObject({
        action: "catalog",
        videos: [{ id: sourceVideoId, title: "An account of hope" }],
        nextCursor: sourceVideoId,
      })
      if (first.action !== "catalog") throw new Error("Wrong result")
      const second = await readPrecomputedCatalog(
        prisma,
        {
          action: "catalog",
          cutoff,
          afterVideoId: first.nextCursor ?? undefined,
          limit: 1,
        },
        "Bearer preview-test-key",
      )
      expect(second).toMatchObject({
        action: "catalog",
        videos: [{ id: targetVideoId, transcriptLanguages: ["es"] }],
        nextCursor: targetVideoId,
      })
      const observed = [sourceVideoId, targetVideoId]
      let cursor = second.action === "catalog" ? second.nextCursor : null
      while (cursor) {
        const page = await readPrecomputedCatalog(
          prisma,
          { action: "catalog", cutoff, afterVideoId: cursor, limit: 1 },
          "Bearer preview-test-key",
        )
        if (page.action !== "catalog") throw new Error("Wrong result")
        observed.push(...page.videos.map((video) => video.id))
        cursor = page.nextCursor
      }
      expect(observed).toEqual([sourceVideoId, targetVideoId, spanishVideoId])
      const spanish = await readPrecomputedCatalog(
        prisma,
        { action: "video", videoId: spanishVideoId, cutoff },
        "Bearer preview-test-key",
      )
      expect(spanish).toMatchObject({
        action: "video",
        video: {
          id: spanishVideoId,
          locale: "es",
          title: "Historia de esperanza",
        },
      })
      const source = await readPrecomputedCatalog(
        prisma,
        { action: "video", videoId: sourceVideoId, cutoff },
        "Bearer preview-test-key",
      )
      expect(source).toMatchObject({
        action: "video",
        video: {
          id: sourceVideoId,
          description: expect.stringContaining("hope"),
        },
      })
      const page = await readPrecomputedCatalog(
        prisma,
        { action: "chunks", videoId: targetVideoId, cutoff, limit: 1 },
        "Bearer preview-test-key",
      )
      expect(page).toMatchObject({
        action: "chunks",
        chunks: [
          {
            id: `chunk-0-${suffix}`,
            language: "es",
            text: "Una historia de esperanza para todos.",
          },
        ],
        nextCursor: `chunk-0-${suffix}`,
      })
    })

    it("reports that a post-cutoff child metadata version cannot be reconstructed", async () => {
      const pastCutoff = new Date(Date.now() + 1_000).toISOString()
      await prisma.videoLocale.update({
        where: { id: `locale-${targetVideoId}` },
        data: {
          description:
            "A changed description that did not update Video.updatedAt.",
          updatedAt: new Date(Date.now() + 2_000),
        },
      })
      await expect(
        readPrecomputedCatalog(
          prisma,
          { action: "video", videoId: targetVideoId, cutoff: pastCutoff },
          "Bearer preview-test-key",
        ),
      ).rejects.toMatchObject({ code: "stale_cutoff" })
    })
  },
)
