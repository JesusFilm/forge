import { randomBytes, randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { buildCanonicalWatchVideoPath } from "@forge/watch-url-policy/routes"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { videoIdentityDuplicateReason } from "@/services/video-dedup"
import type { SemanticCandidatePoolItem } from "./candidate"
import {
  DELIVERY_RETRIEVAL_BUDGET_MS,
  MAX_DELIVERY_RESPONSE_BYTES,
  RECOMMENDATION_CONTRACTS,
} from "./contracts"
import { recommendationRuntimeMigrationSql } from "./current-schema.test-fixture"
import {
  readDeliveryDiagnostics,
  type SemanticRetrievalDiagnostics,
} from "./delivery-diagnostics"
import { createRecommendationDeliveryDependencies } from "./delivery.factory"
import {
  invalidateRecommendationCandidatePools,
  RecommendationDeliveryService,
} from "./delivery.service"
import { resolveRecommendationLocaleIdentity } from "./locale-identity"
import { readEmergencyRevokedRecommendationKids } from "./manifest.service"
import { runSemanticCandidatePlatform } from "./orchestration"
import {
  createRecommendationTokenService,
  parseRecommendationKeyring,
} from "./token.service"

const RUN_SNAPSHOT_TEST =
  env.RECOMMENDATION_DB_TEST === "1" &&
  env.RECOMMENDATION_DELIVERY_DB_FIXTURE === "production_snapshot"
const MANIFEST_ID = "semantic-candidate-platform-v1"
const contexts = [
  ["birth-of-jesus", "en", "gbii"],
  ["the-beginning", "en", "kwanyama"],
  ["creation", "en", "idioma-wanca"],
  ["jesus", "en", "gbii"],
  ["birth-of-jesus", "en", "english"],
  ["jesus", "fr", "french"],
  ["jesus", "es", "spanish-latin-american"],
  ["jesus", "pt", "portuguese-brazil"],
  ["jesus", "zh", "mandarin-china"],
  ["jesus", "zh-Hans", "mandarin-china"],
  ["jesus", "zh-Hant", "mandarin-china"],
] as const

type SnapshotContext = (typeof contexts)[number]

describe.skipIf(!RUN_SNAPSHOT_TEST)(
  "complete multilingual delivery against an approved content-only snapshot",
  () => {
    let prisma: PrismaClient
    let fixtureSchema: string | undefined
    let tokenService: ReturnType<typeof createRecommendationTokenService>
    const keyring = parseRecommendationKeyring(
      JSON.stringify({
        keys: [
          {
            kid: "multilingual-local-fixture",
            status: "active",
            key: randomBytes(32).toString("base64url"),
          },
        ],
      }),
    )

    beforeAll(async () => {
      const databaseUrl = new URL(env.DATABASE_URL)
      if (!["127.0.0.1", "localhost"].includes(databaseUrl.hostname)) {
        throw new Error(
          "Snapshot delivery verification requires an owned local database",
        )
      }
      const client = new Client({ connectionString: databaseUrl.toString() })
      await client.connect()
      try {
        fixtureSchema = `recommendation_multilingual_${randomUUID().replaceAll("-", "")}`
        await client.query(`CREATE SCHEMA "${fixtureSchema}"`)
        await client.query(`SET search_path TO "${fixtureSchema}", public`)
        for (const migration of recommendationRuntimeMigrationSql) {
          await client.query(migration)
        }
        for (const table of [
          "content_embedding_contract",
          "content_embedding_contract_pointer",
          "video",
          "video_edition",
          "video_relation",
          "video_transcript",
          "video_transcript_chunk",
          "video_locale",
          "language",
          "mux_video",
          "video_dub",
          "video_image",
        ]) {
          await client.query(
            `CREATE VIEW "${fixtureSchema}"."${table}" AS SELECT * FROM public."${table}"`,
          )
        }
      } finally {
        await client.end()
      }
      databaseUrl.searchParams.delete("options")
      databaseUrl.searchParams.set("schema", fixtureSchema)
      prisma = new PrismaClient({
        datasources: { db: { url: databaseUrl.toString() } },
      })
      await prisma.$connect()
      // Match runtime token behavior: read real local revocation authority once.
      let revokedKids: Promise<string[]> | undefined
      tokenService = createRecommendationTokenService({
        keyring,
        readRevokedKids: () =>
          (revokedKids ??= readEmergencyRevokedRecommendationKids(prisma)),
      })
    }, 30_000)

    afterAll(async () => {
      invalidateRecommendationCandidatePools()
      await prisma?.$disconnect()
      if (fixtureSchema) {
        const client = new Client({ connectionString: env.DATABASE_URL })
        await client.connect()
        try {
          // All synthetic request roots and their children live in this schema.
          await client.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`)
        } finally {
          await client.end()
        }
      }
    })

    async function deliver(
      context: SnapshotContext,
      seedMediaId: string,
      phase: string,
    ) {
      const [, locale, audioLanguageSlug] = context
      const dependencies = createRecommendationDeliveryDependencies(prisma)
      const sessionDigest = randomBytes(32).toString("hex")
      let pool: SemanticCandidatePoolItem[] = []
      let retrievalDiagnostics: SemanticRetrievalDiagnostics | undefined
      const service = new RecommendationDeliveryService({
        ...dependencies,
        admission: {
          acquire: async () => ({ allowed: true, leaseId: randomUUID() }),
          release: async () => undefined,
        },
        getServingState: async () => ({
          canIssue: true,
          reason: "ready",
          lastKnownGoodManifestId: RECOMMENDATION_CONTRACTS.strategy,
          revokedKids: [],
          manifest: {
            id: MANIFEST_ID,
            strategyVersion: MANIFEST_ID,
            contractVersion: RECOMMENDATION_CONTRACTS.delivery,
            surfaceVersion: RECOMMENDATION_CONTRACTS.surface,
            generator: "semantic",
            maxItems: 6,
          },
        }),
        retrieve: async (input) => {
          pool = await dependencies.retrieve({
            ...input,
            onDiagnostics: (diagnostics) => {
              retrievalDiagnostics = diagnostics
              input.onDiagnostics?.(diagnostics)
            },
          })
          return pool
        },
        orchestrate: runSemanticCandidatePlatform,
        tokenService: { activeKid: keyring.active.kid, ...tokenService },
      })
      const startedAt = performance.now()
      const response = await service.deliver({
        caller: {
          id: null,
          role: "CONSUMER_BEARER",
          fleet: false,
          rateLimitBucketKey: "multilingual-local-fixture",
        },
        seedMediaId,
        locale,
        audioLanguageSlug,
        sessionDigest,
        trafficCategory: "ordinary_browser",
      })
      const serialized = JSON.stringify(response)
      const elapsedMs = performance.now() - startedAt
      return {
        phase,
        response,
        elapsedMs,
        bytes: Buffer.byteLength(serialized),
        pool,
        retrievalDiagnostics,
        sessionDigest,
      }
    }

    it.for(contexts)(
      "%s / %s / %s keeps cold, warm and three concurrent deliveries inside 1.5s",
      { timeout: 30_000 },
      async (context, testContext) => {
        const [seedSlug, locale, audioLanguageSlug] = context
        const identity = resolveRecommendationLocaleIdentity(
          locale,
          audioLanguageSlug,
        )
        const availability = await prisma.$queryRaw<
          Array<{
            seedId: string | null
            audioExists: boolean
            embeddedSeedChunks: bigint
            publishedPresentationRows: bigint
          }>
        >`
          SELECT
            (SELECT id FROM video WHERE slug = ${seedSlug}
              AND deleted_at IS NULL LIMIT 1) AS "seedId",
            EXISTS (SELECT 1 FROM language WHERE slug = ${audioLanguageSlug})
              AS "audioExists",
            (SELECT count(*) FROM video_transcript transcript
              JOIN video seed ON seed.id = transcript.video_id
              JOIN video_transcript_chunk chunk ON chunk.transcript_id = transcript.id
              WHERE seed.slug = ${seedSlug}
                AND transcript.language = ${identity.transcriptLocale}
                AND chunk.language = ${identity.transcriptLocale}
                AND chunk.embedding IS NOT NULL) AS "embeddedSeedChunks",
            (SELECT count(*) FROM video_locale WHERE locale = ${identity.presentationLocale}
              AND status = 'published' AND deleted_at IS NULL) AS "publishedPresentationRows"
        `
        const fixture = availability[0]!
        const evidence = {
          seedSlug,
          ...identity,
          seedPresent: fixture.seedId != null,
          audioExists: fixture.audioExists,
          embeddedSeedChunks: Number(fixture.embeddedSeedChunks),
          publishedPresentationRows: Number(fixture.publishedPresentationRows),
        }
        if (
          !fixture.seedId ||
          !fixture.audioExists ||
          fixture.embeddedSeedChunks === 0n ||
          fixture.publishedPresentationRows === 0n
        ) {
          console.info(
            JSON.stringify({
              event: "recommendation.multilingual_snapshot_absent_context",
              ...evidence,
            }),
          )
          testContext.skip(
            "Requested context is absent from this content-only snapshot; no language substitution",
          )
        }
        const seedMediaId = fixture.seedId!
        const family = await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT ${seedMediaId}::text AS id
          UNION SELECT parent_id FROM video_relation WHERE child_id = ${seedMediaId}
          UNION SELECT child_id FROM video_relation WHERE parent_id = ${seedMediaId}
        `
        const excludedIds = new Set(family.map((row) => row.id))

        // Cold means empty application candidate pools, not flushed OS/DB pages.
        invalidateRecommendationCandidatePools()
        const cold = await deliver(
          context,
          seedMediaId,
          "cold_application_pool",
        )
        const warm = await deliver(
          context,
          seedMediaId,
          "warm_application_pool",
        )
        invalidateRecommendationCandidatePools()
        const concurrent = await Promise.all(
          [1, 2, 3].map((ordinal) =>
            deliver(context, seedMediaId, `concurrent_${ordinal}`),
          ),
        )
        const samples = [cold, warm, ...concurrent]
        const measured = []
        for (const sample of samples) {
          const request = sample.response.requestId
            ? await prisma.recommendationRequest.findUnique({
                where: { id: sample.response.requestId },
                include: { items: true, candidateRun: true },
              })
            : null
          const diagnostics = readDeliveryDiagnostics(
            request?.deliveryDiagnostics,
          )
          measured.push({ sample, request, diagnostics })
          console.info(
            JSON.stringify({
              event: "recommendation.multilingual_snapshot_delivery",
              ...evidence,
              phase: sample.phase,
              completeServiceMs: Math.round(sample.elapsedMs * 100) / 100,
              result: sample.response.result,
              reason: sample.response.reason,
              payloadBytes: sample.bytes,
              candidatePoolCount: sample.pool.length,
              finalCardCount: sample.response.items.length,
              shortfallReason: sample.response.shortfallReason,
              retrieval: sample.retrievalDiagnostics ?? null,
              persistedDiagnostics: diagnostics,
              nominatedCount: request?.candidateRun?.nominatedCount ?? null,
              composedCount: request?.candidateRun?.composedCount ?? null,
            }),
          )
        }
        for (const { sample, request, diagnostics } of measured) {
          expect(sample.elapsedMs).toBeLessThan(DELIVERY_RETRIEVAL_BUDGET_MS)
          expect(sample.response.result).not.toBe("unavailable")
          expect(sample.bytes).toBeLessThanOrEqual(MAX_DELIVERY_RESPONSE_BYTES)
          expect(request).not.toBeNull()
          expect(diagnostics).toMatchObject({
            ...identity,
            retrieval: sample.retrievalDiagnostics,
            composedCount: sample.response.items.length,
          })
          expect(sample.retrievalDiagnostics?.seed).toBe("available")
          expect(sample.pool.length).toBe(
            sample.retrievalDiagnostics?.returnedCandidates,
          )
          expect(sample.response.items.length).toBeLessThanOrEqual(6)
          if (!(seedSlug === "jesus" && audioLanguageSlug === "gbii")) {
            expect(sample.response.items.length).toBeGreaterThan(0)
          }
          expect(
            new Set(sample.response.items.map((item) => item.targetMediaId))
              .size,
          ).toBe(sample.response.items.length)
          const selected: SemanticCandidatePoolItem[] = []
          for (const item of sample.response.items) {
            expect(excludedIds.has(item.targetMediaId)).toBe(false)
            const candidate = sample.pool.find(
              (row) => row.videoId === item.targetMediaId,
            )
            expect(candidate).toBeDefined()
            for (const kept of selected) {
              expect(videoIdentityDuplicateReason(candidate!, kept)).toBeNull()
            }
            selected.push(candidate!)
            const exactPlayback = await prisma.$queryRaw<
              Array<{ found: boolean }>
            >`
              SELECT EXISTS (
                SELECT 1 FROM video_transcript transcript
                JOIN video_dub dub ON dub.video_edition_id = transcript.video_edition_id
                  AND dub.deleted_at IS NULL
                JOIN language audio ON audio.id = dub.language_id
                JOIN mux_video mux ON mux.id = dub.mux_video_id
                WHERE transcript.video_id = ${item.targetMediaId}
                  AND audio.slug = ${audioLanguageSlug}
                  AND mux.playback_id = ${item.playbackId}
              ) AS found
            `
            expect(exactPlayback[0]?.found).toBe(true)
            expect(item.canonicalHref).toBe(
              `/watch${buildCanonicalWatchVideoPath(item.videoSlug, audioLanguageSlug)}`,
            )
            const served = request!.items.find((row) => row.id === item.id)
            expect(served?.capabilityJti).toBeTruthy()
            await tokenService.verifyDeliveryCapability(item.capability, {
              jti: served!.capabilityJti!,
              requestId: request!.id,
              itemId: item.id,
              sessionDigest: sample.sessionDigest,
              surface: RECOMMENDATION_CONTRACTS.surface,
              manifestId: MANIFEST_ID,
            })
          }
        }
      },
    )
  },
)
