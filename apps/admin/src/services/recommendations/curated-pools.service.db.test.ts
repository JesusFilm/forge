import { readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { personalizedInput } from "./delivery.service.test-helpers"
import { userDeliveryHarness } from "./user-delivery.service.test-helpers"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { CuratedPoolsService } from "./curated-pools.service"
import { digestValue } from "./promotion/manifest"
import { runRecommendationDeliveryTransaction } from "./delivery-runtime"
import {
  CuratedPoolCoverageError,
  CuratedPoolPromotionError,
  parseCuratedPoolSource,
} from "./curated-pools.types"

const context = {
  locale: "en",
  audioLanguageSlug: "english",
  coreLanguageId: "529",
}
const requirement = { requestedCount: 6, excludedReserve: 2 }
function source(version: string, reverse = false) {
  const ids = Array.from({ length: 8 }, (_, i) => String(i + 1))
  if (reverse) ids.reverse()
  return parseCuratedPoolSource({
    schemaVersion: 1,
    version,
    themeVocabulary: [{ key: "hope" }],
    candidates: ids.map((id, index) => ({
      coreVideoId: `curated-core-${id}`,
      duplicateGroup: id,
      editorialRank: index + 1,
      startPool: true,
      themeKeys: Number(id) > 4 ? ["hope"] : [],
      rationale: "Fixture review",
    })),
  })
}

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "curated pool database lifecycle",
  () => {
    const schema = `curated_test_${randomUUID().replaceAll("-", "")}`
    let admin: Client, prisma: PrismaClient, service: CuratedPoolsService
    const statements: string[] = []
    beforeAll(async () => {
      admin = new Client({ connectionString: env.DATABASE_URL })
      await admin.connect()
      await admin.query(`CREATE SCHEMA "${schema}"`)
      await admin.query(`SET search_path TO "${schema}", public`)
      // Match real column types without touching the restored catalog. Only the
      // new curated migration supplies persistence constraints under test.
      for (const table of [
        "video",
        "video_locale",
        "language",
        "video_dub",
        "video_edition",
        "mux_video",
        "video_image",
        "video_transcript",
        "video_transcript_chunk",
        "content_embedding_contract",
        "content_embedding_contract_pointer",
      ]) {
        await admin.query(
          `CREATE TABLE "${table}" AS SELECT * FROM public."${table}" WITH NO DATA`,
        )
      }
      await admin.query(
        readFileSync(
          new URL(
            "../../../prisma/migrations/0083_recommendation_curated_pools/migration.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      )
      await admin.query(
        "INSERT INTO language (id,core_id,slug) VALUES ('english-id','529','english'),('french-id','496','french')",
      )
      for (let i = 1; i <= 8; i++) {
        const id = String(i)
        await admin.query(
          "INSERT INTO video (id,core_id,slug,restrict_view_platforms) VALUES ($1,$2,$3,'{}')",
          [`video-${id}`, `curated-core-${id}`, `curated-video-${id}`],
        )
        await admin.query(
          "INSERT INTO video_locale (id,video_id,locale,language_slug,language_core_id,title,status) VALUES ($1,$2,'en','english','529',$3,'published')",
          [`locale-${id}`, `video-${id}`, `Curated video ${id}`],
        )
        await admin.query(
          "INSERT INTO mux_video (id,playback_id) VALUES ($1,$2)",
          [`mux-${id}`, `playback-${id}`],
        )
        await admin.query(
          "INSERT INTO video_dub (id,video_id,language_id,mux_video_id,published,duration,updated_at) VALUES ($1,$2,'english-id',$3,true,120,now())",
          [`dub-${id}`, `video-${id}`, `mux-${id}`],
        )
        await admin.query(
          "INSERT INTO video_image (id,video_id,url,created_at) VALUES ($1,$2,'https://images.example/art.jpg',now())",
          [`image-${id}`, `video-${id}`],
        )
      }
      const url = new URL(env.DATABASE_URL)
      url.searchParams.delete("options")
      url.searchParams.set("schema", schema)
      const queryLoggingClient = new PrismaClient({
        datasourceUrl: url.toString(),
        log: [{ emit: "event", level: "query" }],
      })
      queryLoggingClient.$on("query", (event) => statements.push(event.query))
      prisma = queryLoggingClient
      service = new CuratedPoolsService({ prisma })
    }, 30_000)
    afterAll(async () => {
      await prisma?.$disconnect()
      if (!admin) return
      await admin.query("RESET search_path")
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await admin.end()
    })

    it("imports, activates, rejects bad generations, rechecks eligibility and rolls back exact order/provenance", async () => {
      const read = () => service.getCandidates({ ...context, limit: 6 })
      expect(await read()).toEqual({ version: null, poolKeys: [], items: [] })
      const report = await service.importGeneration({
        source: source("fixture-v1"),
        contexts: [context],
        requirement,
      })
      expect(report.contexts[0]?.startUnique).toBe(8)
      const stored =
        await prisma.recommendationCuratedGeneration.findUniqueOrThrow({
          where: { version: "fixture-v1" },
        })
      // PostgreSQL JSONB reorders object keys. Content identity must survive that
      // normalization so a later export/import can verify the same provenance.
      expect(digestValue(parseCuratedPoolSource(stored.sourceManifest))).toBe(
        report.sourceDigest,
      )
      expect((await read()).items).toEqual([])
      await service.promote({
        version: "fixture-v1",
        expectedCurrentVersion: null,
      })
      statements.length = 0
      const first = await read()
      // Budget guard: BEGIN, timeout, metadata snapshot, live hydration, COMMIT.
      // Do not regress to serial pointer/generation/pool/membership reads.
      expect(statements.length).toBeLessThanOrEqual(5)
      expect(statements.some((query) => query.includes("video_dub"))).toBe(true)
      expect(first.items.map((item) => item.videoId)).toEqual([
        "video-1",
        "video-2",
        "video-3",
        "video-4",
        "video-5",
        "video-6",
      ])
      expect(first.items[0]).toMatchObject({
        generator: "curated",
        poolVersion: "fixture-v1",
        poolKey: "start",
        sceneIndex: null,
        similarity: null,
        startSeconds: 0,
      })
      const interested = await service.getCandidates({
        ...context,
        interestVideoIds: ["video-8"],
        limit: 6,
      })
      expect(interested.items[0]).toMatchObject({
        videoId: "video-5",
        poolKey: "hope",
      })
      expect(new Set(interested.items.map((item) => item.videoId)).size).toBe(6)
      expect(
        (
          await service.getCandidates({
            ...context,
            audioLanguageSlug: "french",
            limit: 6,
          })
        ).items,
      ).toEqual([])
      expect(
        (await service.getCandidates({ ...context, locale: "fr", limit: 6 }))
          .items,
      ).toEqual([])

      const invalid = source("invalid")
      invalid.candidates[0]!.alternateCoreVideoIds.push("missing-core-id")
      await expect(
        service.importGeneration({
          source: invalid,
          contexts: [context],
          requirement,
        }),
      ).rejects.toBeInstanceOf(CuratedPoolCoverageError)
      expect(
        await prisma.recommendationCuratedGeneration.count({
          where: { version: "invalid" },
        }),
      ).toBe(0)
      expect((await read()).version).toBe("fixture-v1")
      await expect(
        prisma.recommendationCuratedPool.updateMany({ data: { videoIds: [] } }),
      ).rejects.toThrow("immutable")
      await expect(
        prisma.recommendationCuratedGeneration.updateMany({
          data: { sourceDigest: "a".repeat(64) },
        }),
      ).rejects.toThrow("immutable")

      await service.importGeneration({
        source: source("fixture-v2", true),
        contexts: [context],
        requirement,
      })
      await expect(
        service.promote({
          version: "fixture-v2",
          expectedCurrentVersion: null,
        }),
      ).rejects.toBeInstanceOf(CuratedPoolPromotionError)
      await service.promote({
        version: "fixture-v2",
        expectedCurrentVersion: "fixture-v1",
      })
      expect((await read()).items[0]?.videoId).toBe("video-8")

      // Mutable publication drift removes a target immediately and blocks a
      // rollback whose old snapshot no longer has the declared reserve.
      await admin.query("UPDATE video_dub SET published=false WHERE id='dub-1'")
      expect(
        (await read()).items.some((item) => item.videoId === "video-1"),
      ).toBe(false)
      await expect(
        service.rollback({ expectedCurrentVersion: "fixture-v2" }),
      ).rejects.toBeInstanceOf(CuratedPoolCoverageError)
      expect((await read()).version).toBe("fixture-v2")
      await admin.query("UPDATE video_dub SET published=true WHERE id='dub-1'")
      await service.rollback({ expectedCurrentVersion: "fixture-v2" })
      expect(await read()).toEqual(first)

      for (const [disable, restore] of [
        [
          "UPDATE video SET restrict_view_platforms=ARRAY['watch'] WHERE id='video-1'",
          "UPDATE video SET restrict_view_platforms='{}' WHERE id='video-1'",
        ],
        [
          "UPDATE video_locale SET deleted_at=now() WHERE id='locale-1'",
          "UPDATE video_locale SET deleted_at=null WHERE id='locale-1'",
        ],
        [
          "UPDATE mux_video SET playback_id='' WHERE id='mux-1'",
          "UPDATE mux_video SET playback_id='playback-1' WHERE id='mux-1'",
        ],
        [
          "UPDATE video_image SET deleted_at=now() WHERE id='image-1'",
          "UPDATE video_image SET deleted_at=null WHERE id='image-1'",
        ],
        [
          "UPDATE video_dub SET language_id='french-id' WHERE id='dub-1'",
          "UPDATE video_dub SET language_id='english-id' WHERE id='dub-1'",
        ],
      ]) {
        await admin.query(disable!)
        expect(
          (await read()).items.some((item) => item.videoId === "video-1"),
        ).toBe(false)
        await admin.query(restore!)
      }
    }, 30_000)
  },
)

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "curated fallback issuance with the production Postgres adapter",
  () => {
    const schema = `user_delivery_${randomUUID().replaceAll("-", "")}`
    let admin: Client
    let prisma: PrismaClient
    const queries: string[] = []
    beforeAll(async () => {
      admin = new Client({ connectionString: env.DATABASE_URL })
      await admin.connect()
      await admin.query(`CREATE SCHEMA "${schema}"`)
      for (const name of [
        "RecommendationRequestState",
        "RecommendationDeliveryResult",
        "RecommendationAuditKind",
      ]) {
        await admin.query(
          `CREATE DOMAIN "${schema}"."${name}" AS public."${name}"`,
        )
      }
      for (const table of [
        "recommendation_request",
        "recommendation_served_item",
        "recommendation_evidence_audit",
      ]) {
        await admin.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        )
      }
      for (const table of [
        "recommendation_served_item",
        "recommendation_evidence_audit",
      ]) {
        await admin.query(
          `ALTER TABLE "${schema}"."${table}" ADD FOREIGN KEY (request_id) REFERENCES "${schema}".recommendation_request(id) ON DELETE CASCADE`,
        )
      }
      const client = new PrismaClient({
        adapter: new PrismaPg(
          { connectionString: env.DATABASE_URL },
          { schema },
        ),
        log: [{ level: "query", emit: "event" }],
      })
      client.$on("query", ({ query }) => queries.push(query))
      prisma = client
    })
    afterAll(async () => {
      await prisma?.$disconnect()
      await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await admin?.end()
    })

    it("persists six issued items and their audit atomically with one item insert", async () => {
      queries.length = 0
      const h = userDeliveryHarness(0, prisma)
      const response = await h.service.deliver(personalizedInput())
      expect(response).toMatchObject({ result: "served", curatedCount: 6 })
      const itemInserts = queries.filter(
        (query) =>
          query.startsWith("INSERT INTO") &&
          query.includes('"recommendation_served_item"'),
      )
      expect(itemInserts).toHaveLength(1)
      const saved = await prisma.recommendationRequest.findUniqueOrThrow({
        where: { id: response.requestId! },
        include: { items: { orderBy: { position: "asc" } }, audits: true },
      })
      expect(saved.state).toBe("ISSUED")
      expect(saved.items.map((item) => item.id)).toEqual(
        response.items.map((item) => item.id),
      )
      expect(saved.items.map((item) => item.canonicalHref)).toEqual(
        response.items.map((item) => item.canonicalHref),
      )
      expect(saved.audits).toHaveLength(1)
      expect(saved.audits[0].kind).toBe("DELIVERY_SUCCESS")
    })

    it("rolls back the request and every item when the success audit cannot persist", async () => {
      await admin.query(
        `ALTER TABLE "${schema}".recommendation_evidence_audit ADD CONSTRAINT reject_new_audits CHECK (false) NOT VALID`,
      )
      const before = await prisma.recommendationRequest.count()
      const itemsBefore = await prisma.recommendationServedItem.count()
      const h = userDeliveryHarness(0, prisma)
      const response = await h.service.deliver(personalizedInput())
      expect(response).toMatchObject({ result: "unavailable", items: [] })
      expect(await prisma.recommendationRequest.count()).toBe(before)
      expect(await prisma.recommendationServedItem.count()).toBe(itemsBefore)
      expect(h.release).toHaveBeenCalledOnce()
    })

    it("rolls back earlier writes when the callback exceeds its deadline", async () => {
      await admin.query(
        `CREATE TABLE "${schema}".deadline_probe (id integer PRIMARY KEY)`,
      )
      let operationSettled!: () => void
      const settled = new Promise<void>((resolve) => {
        operationSettled = resolve
      })
      const started = performance.now()
      const result = await runRecommendationDeliveryTransaction(
        prisma,
        Date.now() + 200,
        async (tx) => {
          try {
            await tx.$executeRawUnsafe(
              `INSERT INTO "${schema}".deadline_probe (id) VALUES (1)`,
            )
            await tx.$queryRaw`SELECT 1 FROM pg_sleep(1)`
            return "committed"
          } finally {
            operationSettled()
          }
        },
        Date.now,
      ).catch(() => "failed")
      expect(result).toBe("failed")
      expect(performance.now() - started).toBeLessThan(600)
      await settled
      // The query has settled and the transaction callback rejected. A later
      // transaction cannot observe the earlier write, including after cleanup.
      const rows = await admin.query(
        `SELECT id FROM "${schema}".deadline_probe`,
      )
      expect(rows.rows).toEqual([])
    })
  },
)
