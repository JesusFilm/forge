import { PrismaClient, type Prisma } from "@prisma/client"
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
      prisma = new PrismaClient<Prisma.PrismaClientOptions>({
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
      const spanishLanguageId = `spanish-language-${suffix}`
      await prisma.language.create({
        data: {
          id: spanishLanguageId,
          coreId: spanishLanguageId,
          slug: "spanish",
        },
      })
      await prisma.videoDub.create({
        data: {
          id: `dub-spanish-${targetVideoId}`,
          coreId: `dub-spanish-core-${targetVideoId}`,
          videoId: targetVideoId,
          languageId: spanishLanguageId,
          muxVideoId,
          published: true,
        },
      })
      const unaddressableLanguageId = `unaddressable-language-${suffix}`
      await prisma.language.create({
        data: { id: unaddressableLanguageId, coreId: unaddressableLanguageId },
      })
      await prisma.videoDub.create({
        data: {
          id: `dub-unaddressable-${targetVideoId}`,
          coreId: `dub-unaddressable-core-${targetVideoId}`,
          videoId: targetVideoId,
          languageId: unaddressableLanguageId,
          muxVideoId,
          published: true,
        },
      })
      await prisma.videoRelation.create({
        data: { parentId: sourceVideoId, childId: targetVideoId },
      })
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
        videos: [
          {
            id: targetVideoId,
            transcriptLanguages: ["es"],
            watchRouteIdentity: {
              basis: "current_catalog_cutoff_fenced",
              parentSlugs: [sourceVideoId],
              playableAudioLanguageSlugs: ["english", "spanish"],
              truncated: false,
            },
          },
        ],
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

    it("returns a long multilingual transcript intact instead of losing usable evidence", async () => {
      const chunkId = `chunk-0-${suffix}`
      const original = await prisma.videoTranscriptChunk.findUniqueOrThrow({
        where: { id: chunkId },
        select: { rawSourceText: true, updatedAt: true },
      })
      const longText = "La esperanza permanece. ".repeat(335)
      try {
        await prisma.videoTranscriptChunk.update({
          where: { id: chunkId },
          data: { rawSourceText: longText },
        })
        const result = await readPrecomputedCatalog(
          prisma,
          {
            action: "chunks",
            videoId: targetVideoId,
            cutoff: new Date(Date.now() + 1_000).toISOString(),
            limit: 1,
          },
          "Bearer preview-test-key",
        )
        expect(result).toMatchObject({
          action: "chunks",
          chunks: [{ id: chunkId, language: "es", text: longText }],
        })
        await prisma.videoTranscriptChunk.update({
          where: { id: chunkId },
          data: { rawSourceText: longText.repeat(32) },
        })
        await expect(
          readPrecomputedCatalog(
            prisma,
            {
              action: "chunks",
              videoId: targetVideoId,
              cutoff: new Date(Date.now() + 1_000).toISOString(),
              limit: 1,
            },
            "Bearer preview-test-key",
          ),
        ).rejects.toMatchObject({ code: "oversized" })
      } finally {
        await prisma.videoTranscriptChunk.update({
          where: { id: chunkId },
          data: original,
        })
      }
    })

    it("reads complete English per edition and complete non-English fallback without sampling passages", async () => {
      const extraEditionIds = [
        `fallback-edition-${suffix}`,
        `partial-edition-${suffix}`,
        `empty-edition-${suffix}`,
      ]
      const addedTranscriptIds: string[] = []
      try {
        for (const id of extraEditionIds) {
          await prisma.videoEdition.create({
            data: { id, coreId: id, name: id },
          })
        }
        const records = [
          {
            editionId: `edition-${suffix}`,
            language: "en",
            texts: ["Complete English evidence."],
          },
          {
            editionId: extraEditionIds[0]!,
            language: "fr",
            texts: [
              "Une première partie complète.",
              "Une deuxième partie complète.",
            ],
          },
          {
            editionId: extraEditionIds[1]!,
            language: "en",
            texts: ["Incomplete English fragment."],
            declaredChunks: 2,
          },
          {
            editionId: extraEditionIds[1]!,
            language: "de",
            texts: ["Vollständiger deutscher Text."],
          },
          {
            editionId: extraEditionIds[2]!,
            language: "en",
            texts: [],
          },
        ]
        for (const [index, record] of records.entries()) {
          const id = `selected-transcript-${index}-${suffix}`
          addedTranscriptIds.push(id)
          await prisma.videoTranscript.create({
            data: {
              id,
              videoEditionId: record.editionId,
              videoId: targetVideoId,
              language: record.language,
              model: "fixture",
              dimensions: 1536,
              chunkingType: "fixture",
              maxChunkTokens: 100,
              overlapTokens: 0,
              totalChunks: record.declaredChunks ?? record.texts.length,
              totalTokens: 20,
              generatedAt: new Date(),
            },
          })
          for (const [chunkIndex, text] of record.texts.entries()) {
            await prisma.videoTranscriptChunk.create({
              data: {
                id: `selected-chunk-${index}-${chunkIndex}-${suffix}`,
                transcriptId: id,
                language: record.language,
                chunkIndex,
                chunkId: `part-${chunkIndex}`,
                text,
                rawSourceText: text,
                tokenCount: 10,
              },
            })
          }
        }
        const selectedCutoff = new Date(Date.now() + 1_000).toISOString()
        const texts: string[] = []
        let afterChunkId: string | undefined
        do {
          const page = await readPrecomputedCatalog(
            prisma,
            {
              action: "chunks",
              videoId: targetVideoId,
              cutoff: selectedCutoff,
              limit: 1,
              ...(afterChunkId ? { afterChunkId } : {}),
            },
            "Bearer preview-test-key",
          )
          if (page.action !== "chunks") throw new Error("Wrong result")
          texts.push(...page.chunks.map((chunk) => chunk.text))
          afterChunkId = page.nextCursor ?? undefined
        } while (afterChunkId)
        expect(texts).toEqual([
          "Complete English evidence.",
          "Une première partie complète.",
          "Une deuxième partie complète.",
          "Vollständiger deutscher Text.",
        ])
        const video = await readPrecomputedCatalog(
          prisma,
          {
            action: "video",
            videoId: targetVideoId,
            cutoff: selectedCutoff,
          },
          "Bearer preview-test-key",
        )
        expect(video).toMatchObject({
          video: {
            transcriptLanguages: ["de", "en", "fr"],
            transcriptSelection: {
              policy: "english-per-edition-with-complete-fallback-v1",
              availableTranscriptCount: 6,
              incompleteTranscriptCount: 2,
              skippedEditionCount: 1,
            },
          },
        })
      } finally {
        await prisma.videoTranscript.deleteMany({
          where: { id: { in: addedTranscriptIds } },
        })
        await prisma.videoEdition.deleteMany({
          where: { id: { in: extraEditionIds } },
        })
      }
    })

    it("reports that a post-cutoff child metadata version cannot be reconstructed", async () => {
      const pastCutoff = new Date(Date.now() + 1_000).toISOString()
      const original = await prisma.videoLocale.findUniqueOrThrow({
        where: { id: `locale-${targetVideoId}` },
        select: { description: true, updatedAt: true },
      })
      try {
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
      } finally {
        await prisma.videoLocale.update({
          where: { id: `locale-${targetVideoId}` },
          data: original,
        })
      }
    })

    it("rejects route identity when a parent slug or audio language changes after cutoff", async () => {
      const pastCutoff = new Date(Date.now() + 1_000).toISOString()
      const parent = await prisma.video.findUniqueOrThrow({
        where: { id: sourceVideoId },
        select: { slug: true, updatedAt: true },
      })
      const language = await prisma.language.findFirstOrThrow({
        where: { slug: "spanish" },
        select: { id: true, slug: true, updatedAt: true },
      })
      try {
        await prisma.video.update({
          where: { id: sourceVideoId },
          data: {
            slug: `${sourceVideoId}-renamed`,
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
      } finally {
        await prisma.video.update({
          where: { id: sourceVideoId },
          data: { slug: parent.slug, updatedAt: parent.updatedAt },
        })
      }
      try {
        await prisma.language.update({
          where: { id: language.id },
          data: {
            slug: "spanish-renamed",
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
      } finally {
        await prisma.language.update({
          where: { id: language.id },
          data: { slug: language.slug, updatedAt: language.updatedAt },
        })
      }
    })
  },
)
