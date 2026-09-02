import { readFileSync } from "node:fs"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import {
  ACTIVE_CONTENT_EMBEDDING_CONTRACT_ID,
  ACTIVE_CONTENT_QUERY_EMBEDDING_DIMENSIONS,
  ACTIVE_CONTENT_QUERY_EMBEDDING_MODEL,
  ACTIVE_CONTENT_QUERY_EMBEDDING_PROVIDER,
  ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
  ACTIVE_CONTENT_STORAGE_EMBEDDING_MODEL,
  ACTIVE_CONTENT_STORAGE_EMBEDDING_PROVIDER,
  CONTENT_EMBEDDING_CONTRACT_POINTER_ID,
} from "@/services/content-embedding-contract"
import {
  DELIVERY_RETRIEVAL_BUDGET_MS,
  MAX_DELIVERY_RESPONSE_BYTES,
  RECOMMENDATION_CONTRACTS,
} from "./contracts"
import {
  getSemanticDeliveryCandidatePool,
  getSemanticDeliveryRecommendations,
} from "./delivery-retriever"
import {
  RecommendationDeliveryService,
  runRecommendationRetrievalQuery,
} from "./delivery.service"
import { getLiveProfileCandidates } from "./candidates/profile-candidate.service"
import {
  runCandidatePlatform,
  runSemanticCandidatePlatform,
} from "./orchestration"
import { HYBRID_PERSONALIZED_MANIFEST_ID } from "./promotion/manifest"
import { getRecommendationRecentContext } from "./recent-context.service"
import { createRecommendationTokenService } from "./token.service"

const RUN_REAL_DB_TEST = env.RECOMMENDATION_DB_TEST === "1"
const DELIVERY_FIXTURE_MODE = env.RECOMMENDATION_DELIVERY_DB_FIXTURE
const recommendationMigrationSql = [
  "0052_production_semantic_recommendation_tracer",
  "0053_recommendation_active_playback_proxy",
  "0054_recommendation_mission_value_actions",
  "0055_recommendation_integrity_eligibility",
  "0056_consent_aware_recommendation_profile",
  "0057_semantic_control_readiness",
  "0058_recommendation_candidate_platform",
  "0059_recommendation_shadow_candidate_evaluation",
  "0060_recommendation_experiment_spine",
  "0061_recommendation_hybrid_promotion",
  "0062_recommendation_multi_interest_profile_shadow",
  "0063_recommendation_live_profile_pilot",
  "0064_recommendation_governance_review_guards",
  "0065_recommendation_strategy_manifest_immutability",
  "0066_recommendation_playback_finalization_repair",
  "0067_recommendation_episode_submission_budget_repair",
  "0068_recommendation_trace_actor_digest_repair",
  "0069_recommendation_hybrid_composition",
  "0070_recommendation_consent_receipts",
  "0071_recommendation_assignment_generation_key",
].map((migration) =>
  readFileSync(
    new URL(
      `../../../prisma/migrations/${migration}/migration.sql`,
      import.meta.url,
    ),
    "utf8",
  ),
)

function vectorAt(index: number): string {
  const values = Array.from({ length: 1536 }, () => 0)
  values[index] = 1
  return `[${values.join(",")}]`
}

const BENCHMARK_PROFILE_TOKEN_DIGEST = "4".repeat(64)
const BENCHMARK_CONSENT_RECEIPT_DIGEST = "5".repeat(64)
const BENCHMARK_SESSION_DIGEST = "6".repeat(64)

async function installContentEmbeddingContractAuthority(
  client: Client,
): Promise<void> {
  await client.query(`
    CREATE TABLE content_embedding_contract (
      id text PRIMARY KEY,
      query_provider text NOT NULL,
      query_model text NOT NULL,
      query_native_dimensions integer NOT NULL,
      query_dimensions integer NOT NULL,
      query_transform_version text,
      storage_provider text NOT NULL,
      storage_model text NOT NULL,
      storage_native_dimensions integer NOT NULL,
      storage_dimensions integer NOT NULL,
      storage_transform_version text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE content_embedding_contract_pointer (
      id text PRIMARY KEY,
      active_contract_id text NOT NULL REFERENCES content_embedding_contract(id),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `)
  await client.query(
    `INSERT INTO content_embedding_contract (
      id, query_provider, query_model, query_native_dimensions,
      query_dimensions, query_transform_version, storage_provider,
      storage_model, storage_native_dimensions, storage_dimensions,
      storage_transform_version
    ) VALUES (
      $1, $2, $3, $4, $4, NULL, $5, $6, $7, $7, NULL
    )`,
    [
      ACTIVE_CONTENT_EMBEDDING_CONTRACT_ID,
      ACTIVE_CONTENT_QUERY_EMBEDDING_PROVIDER,
      ACTIVE_CONTENT_QUERY_EMBEDDING_MODEL,
      ACTIVE_CONTENT_QUERY_EMBEDDING_DIMENSIONS,
      ACTIVE_CONTENT_STORAGE_EMBEDDING_PROVIDER,
      ACTIVE_CONTENT_STORAGE_EMBEDDING_MODEL,
      ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
    ],
  )
  await client.query(
    `INSERT INTO content_embedding_contract_pointer (
      id, active_contract_id
    ) VALUES ($1, $2)`,
    [
      CONTENT_EMBEDDING_CONTRACT_POINTER_ID,
      ACTIVE_CONTENT_EMBEDDING_CONTRACT_ID,
    ],
  )
}

async function installHybridDeliveryAuthority(client: Client): Promise<void> {
  const projectionMedia = await client.query<{ video_id: string }>(`
    SELECT transcript.video_id
    FROM video_transcript transcript
    JOIN video_transcript_chunk chunk
      ON chunk.transcript_id = transcript.id
      AND chunk.embedding IS NOT NULL
    JOIN video video ON video.id = transcript.video_id
      AND video.deleted_at IS NULL
    WHERE video.slug <> 'jesus'
    GROUP BY transcript.video_id
    ORDER BY transcript.video_id
    LIMIT 1
  `)
  const projectionMediaId = projectionMedia.rows[0]?.video_id
  if (!projectionMediaId) {
    throw new Error(
      "Explicit delivery fixture has no non-seed vector video for hybrid profile retrieval.",
    )
  }
  await client.query(
    `INSERT INTO recommendation_profile (
      id, token_digest, privacy_generation, choice, state, expires_at,
      updated_at
    ) VALUES (
      'delivery-benchmark-profile', $1, 1, 'durable_allowed', 'active',
      '2030-01-01T00:00:00.000Z', '2026-08-27T00:00:00.000Z'
    )`,
    [BENCHMARK_PROFILE_TOKEN_DIGEST],
  )
  await client.query(
    `INSERT INTO recommendation_profile_projection_generation (
      id, manifest_id, scope, profile_id, privacy_generation, generation,
      state, projection_version, clustering_version,
      eligibility_policy_version, outcome_classifier_version,
      input_window_start, input_window_end, input_watermark, input_digest,
      contribution_count, durable_interest_count, coverage, stability,
      cohort_quality, retention_days, published_at, expires_at
    ) VALUES (
      'delivery-benchmark-projection', 'multi-interest-profile-shadow-v1',
      'durable', 'delivery-benchmark-profile', 1, 1, 'published',
      'multi-interest-profile-projection-v1',
      'deterministic-farthest-first-medoids-v1',
      'recommendation-integrity-v1', 'active-watch-proxy-v1',
      '2026-08-26T00:00:00.000Z', '2026-08-27T00:00:00.000Z',
      '2026-08-27T00:00:00.000Z', $1, 1, 1, 1, 1, 0.9, 180,
      '2026-08-27T00:00:00.000Z', '2030-01-01T00:00:00.000Z'
    )`,
    ["7".repeat(64)],
  )
  await client.query(
    `INSERT INTO recommendation_profile_interest (
      id, generation_id, kind, interest_ordinal, medoid_media_id,
      medoid_source_digest, embedding, weight, support_count, stability,
      expires_at
    )
    SELECT
      'delivery-benchmark-interest', 'delivery-benchmark-projection',
      'durable', 0, $1::varchar(191), $2, avg(chunk.embedding), 1, 1, 1,
      '2030-01-01T00:00:00.000Z'
    FROM video_transcript transcript
    JOIN video_transcript_chunk chunk ON chunk.transcript_id = transcript.id
    WHERE transcript.video_id::text = $1::text
      AND chunk.embedding IS NOT NULL
    GROUP BY transcript.video_id`,
    [projectionMediaId, "8".repeat(64)],
  )
  await client.query(
    `INSERT INTO recommendation_profile_projection_pointer (
      scope_digest, scope, profile_id, privacy_generation, generation_id,
      pointer_generation, updated_at
    ) VALUES (
      $1, 'durable', 'delivery-benchmark-profile', 1,
      'delivery-benchmark-projection', 1, '2026-08-27T00:00:00.000Z'
    )`,
    ["9".repeat(64)],
  )
  await client.query(
    `INSERT INTO recommendation_consent_receipt (
      id, token_digest, contract_version, choice, state, profile_id,
      privacy_generation, expires_at, updated_at
    ) VALUES (
      'delivery-benchmark-consent', $1, 'recommendation-consent-v1',
      'personalization', 'active', 'delivery-benchmark-profile', 1,
      '2030-01-01T00:00:00.000Z', '2026-08-27T00:00:00.000Z'
    )`,
    [BENCHMARK_CONSENT_RECEIPT_DIGEST],
  )
  await client.query(
    `INSERT INTO recommendation_experiment (
      id, experiment_version, surface_version, control_manifest_id,
      challenger_manifest_id, assignment_policy_version,
      outcome_policy_version, integrity_policy_version,
      evaluation_policy_version, configuration_digest,
      challenger_probability, generation, starts_at, ends_at, expires_at
    ) VALUES (
      'delivery-benchmark-experiment', 'delivery-benchmark-experiment-v1',
      'watch-below-player-v1', 'semantic-transcript-pgvector-v1',
      'semantic-profile-hybrid-v1', 'sticky-deterministic-assignment-v1',
      'active-watch-multi-outcome-v1', 'recommendation-integrity-v1',
      'recommendation-experiment-aa-v1', $1, 0.1, 1,
      '2026-08-26T00:00:00.000Z', '2027-08-27T00:00:00.000Z',
      '2030-01-01T00:00:00.000Z'
    )`,
    ["a".repeat(64)],
  )
  await client.query(
    `INSERT INTO recommendation_experiment_assignment (
      id, experiment_id, unit_kind, unit_digest, profile_id,
      privacy_generation, arm, assignment_probability, configuration_digest,
      generation, assigned_at, expires_at
    ) VALUES (
      'delivery-benchmark-assignment', 'delivery-benchmark-experiment',
      'anonymous_profile', $1, 'delivery-benchmark-profile', 1,
      'challenger', 0.1, $2, 1, '2026-08-27T00:00:00.000Z',
      '2030-01-01T00:00:00.000Z'
    )`,
    [BENCHMARK_PROFILE_TOKEN_DIGEST, "a".repeat(64)],
  )
}

async function prepareExplicitDeliveryFixture(
  databaseUrl: string,
  mode: "production_snapshot" | "deterministic",
): Promise<{
  databaseUrl: string
  fixtureSchema: string
  fixtureKind: "production_snapshot" | "deterministic_fixture"
}> {
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  let fixtureSchema: string | null = null
  try {
    fixtureSchema = `recommendation_candidate_benchmark_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2)}`
    await client.query(`CREATE SCHEMA "${fixtureSchema}"`)
    await client.query(`SET search_path TO "${fixtureSchema}", public`)
    for (const migration of recommendationMigrationSql) {
      await client.query(migration)
    }
    if (mode === "production_snapshot") {
      const compatibleSnapshot = await client.query<{ ready: boolean }>(`
        SELECT
          EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'video_transcript_chunk'
              AND column_name = 'content_summary'
          )
          AND (
            SELECT count(DISTINCT transcript.video_id)
            FROM public.video seed
            JOIN public.video_transcript transcript
              ON transcript.video_id <> seed.id
            JOIN public.video_transcript_chunk chunk
              ON chunk.transcript_id = transcript.id
              AND chunk.embedding IS NOT NULL
            JOIN public.video_locale locale
              ON locale.video_id = transcript.video_id
              AND locale.locale = 'en'
              AND locale.status = 'published'
              AND locale.deleted_at IS NULL
            JOIN public.video_dub dub
              ON dub.video_edition_id = transcript.video_edition_id
              AND dub.deleted_at IS NULL
            JOIN public.language language
              ON language.id = dub.language_id
              AND language.slug = 'english'
            JOIN public.mux_video mux
              ON mux.id = dub.mux_video_id
              AND mux.playback_id IS NOT NULL
            WHERE seed.slug = 'jesus'
              AND seed.deleted_at IS NULL
              AND transcript.language = 'en'
              AND transcript.embedding_provider = 'jesus-film-ai-gateway'
              AND transcript.model = 'embeddings'
              AND transcript.dimensions = 1536
              AND transcript.embedding_native_dimensions = 1536
              AND transcript.embedding_transform_version IS NULL
              AND chunk.model = 'embeddings'
              AND chunk.dimensions = 1536
          ) >= 6 AS ready
      `)
      if (compatibleSnapshot.rows[0]?.ready) {
        for (const table of [
          "content_embedding_contract",
          "content_embedding_contract_pointer",
          "video",
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
        await installHybridDeliveryAuthority(client)
        const snapshotUrl = new URL(databaseUrl)
        snapshotUrl.searchParams.delete("options")
        snapshotUrl.searchParams.set("schema", fixtureSchema)
        return {
          databaseUrl: snapshotUrl.toString(),
          fixtureSchema,
          fixtureKind: "production_snapshot",
        }
      }
      throw new Error(
        "RECOMMENDATION_DELIVERY_DB_FIXTURE=production_snapshot requires a restored, vector-bearing snapshot with the Jesus seed and at least six playable English candidates; deterministic data was not substituted.",
      )
    }

    await client.query("CREATE EXTENSION IF NOT EXISTS vector")
    await installContentEmbeddingContractAuthority(client)
    await client.query(`
      CREATE TABLE video (
        id text PRIMARY KEY, slug text NOT NULL UNIQUE, core_id text,
        deleted_at timestamptz, restrict_view_platforms text[] NOT NULL DEFAULT '{}'
      );
      CREATE TABLE video_relation (parent_id text NOT NULL, child_id text NOT NULL);
      CREATE TABLE video_transcript (
        id text PRIMARY KEY, video_id text NOT NULL, video_edition_id text NOT NULL,
        language text NOT NULL, embedding_provider text NOT NULL, model text NOT NULL,
        dimensions integer NOT NULL, embedding_native_dimensions integer NOT NULL,
        embedding_transform_version text
      );
      CREATE TABLE video_transcript_chunk (
        id text PRIMARY KEY, transcript_id text NOT NULL, chunk_index integer NOT NULL,
        language text NOT NULL, model text NOT NULL, dimensions integer NOT NULL,
        content_summary text, raw_source_text text, text text NOT NULL,
        start_seconds double precision, end_seconds double precision,
        felt_needs text[] NOT NULL DEFAULT '{}', demographics text[] NOT NULL DEFAULT '{}',
        spiritual_context text[] NOT NULL DEFAULT '{}', embedding vector(1536)
      );
      CREATE TABLE video_locale (
        id text PRIMARY KEY, video_id text NOT NULL, locale text NOT NULL,
        status text NOT NULL, deleted_at timestamptz, title text NOT NULL,
        language_slug text, language_core_id text
      );
      CREATE TABLE language (id text PRIMARY KEY, slug text, bcp47 text);
      CREATE TABLE mux_video (id text PRIMARY KEY, playback_id text);
      CREATE TABLE video_dub (
        id text PRIMARY KEY, video_edition_id text NOT NULL, language_id text NOT NULL,
        mux_video_id text NOT NULL, deleted_at timestamptz, published boolean,
        duration integer, length_in_milliseconds bigint,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE video_image (
        id text PRIMARY KEY, video_id text NOT NULL, mobile_cinematic_high text,
        video_still text, thumbnail text, url text, deleted_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO language (id, slug, bcp47) VALUES ('language-en', 'english', 'en');
      INSERT INTO video (id, slug, core_id) VALUES ('seed-video', 'jesus', 'seed-core');
      INSERT INTO video_transcript (
        id, video_id, video_edition_id, language, embedding_provider, model,
        dimensions, embedding_native_dimensions
      ) VALUES (
        'seed-transcript', 'seed-video', 'seed-edition', 'en',
        '${ACTIVE_CONTENT_STORAGE_EMBEDDING_PROVIDER}',
        '${ACTIVE_CONTENT_STORAGE_EMBEDDING_MODEL}',
        ${ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS},
        ${ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS}
      );
    `)
    for (let index = 0; index < 8; index += 1) {
      await client.query(
        `INSERT INTO video_transcript_chunk (
          id, transcript_id, chunk_index, language, model, dimensions, text,
          start_seconds, end_seconds, felt_needs, embedding
        ) VALUES ($1, 'seed-transcript', $2, 'en', $6, $7, $3,
          $4, $5, ARRAY['hope'], $8::vector)`,
        [
          `seed-chunk-${index}`,
          index,
          `Seed scene ${index}`,
          index * 10,
          index * 10 + 10,
          ACTIVE_CONTENT_STORAGE_EMBEDDING_MODEL,
          ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
          vectorAt(index),
        ],
      )
    }
    for (let index = 0; index < 12; index += 1) {
      const videoId = `target-video-${index}`
      const transcriptId = `target-transcript-${index}`
      const editionId = `target-edition-${index}`
      const muxVideoId = `mux-${index}`
      await client.query(
        "INSERT INTO video (id, slug, core_id) VALUES ($1, $2, $3)",
        [videoId, `target-${index}`, `target-core-${index}`],
      )
      await client.query(
        `INSERT INTO video_locale (
           id, video_id, locale, status, title, language_slug, language_core_id
         ) VALUES ($1, $2, 'en', 'published', $3, 'english', '529')`,
        [`locale-${index}-english`, videoId, `Target ${index}`],
      )
      if (index === 0) {
        await client.query(
          `INSERT INTO video_locale (
             id, video_id, locale, status, title, language_slug,
             language_core_id
           ) VALUES (
             'locale-0-other', $1, 'en', 'published',
             'Wrong duplicate-locale title', 'spanish-latin-american', '21028'
           )`,
          [videoId],
        )
      }
      await client.query(
        `INSERT INTO video_transcript (
           id, video_id, video_edition_id, language, embedding_provider, model,
           dimensions, embedding_native_dimensions
         ) VALUES ($1, $2, $3, 'en', $4, $5, $6, $6)`,
        [
          transcriptId,
          videoId,
          editionId,
          ACTIVE_CONTENT_STORAGE_EMBEDDING_PROVIDER,
          ACTIVE_CONTENT_STORAGE_EMBEDDING_MODEL,
          ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
        ],
      )
      await client.query(
        `INSERT INTO video_transcript_chunk (
           id, transcript_id, chunk_index, language, model, dimensions, text,
           start_seconds, end_seconds, felt_needs, embedding
         ) VALUES ($1, $2, 0, 'en', $4, $5, $3, 0, 30,
           ARRAY['hope'], $6::vector)`,
        [
          `target-chunk-${index}`,
          transcriptId,
          `Target scene ${index}`,
          ACTIVE_CONTENT_STORAGE_EMBEDDING_MODEL,
          ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
          vectorAt(index + 8),
        ],
      )
      await client.query(
        "INSERT INTO mux_video (id, playback_id) VALUES ($1, $2)",
        [muxVideoId, `playback-${index}`],
      )
      await client.query(
        `INSERT INTO video_dub (
           id, video_edition_id, language_id, mux_video_id, published,
           duration, length_in_milliseconds
         ) VALUES ($1, $2, 'language-en', $3, true, $4, $5)`,
        [
          `dub-${index}`,
          editionId,
          muxVideoId,
          300 + index,
          index % 2 === 0 ? (240 + index) * 1_000 : null,
        ],
      )
      await client.query(
        `INSERT INTO video_image (id, video_id, mobile_cinematic_high)
         VALUES ($1, $2, $3)`,
        [
          `image-${index}`,
          videoId,
          `https://images.example/target-${index}.jpg`,
        ],
      )
    }
    await installHybridDeliveryAuthority(client)
    const fixtureUrl = new URL(databaseUrl)
    fixtureUrl.searchParams.delete("options")
    fixtureUrl.searchParams.set("schema", fixtureSchema)
    return {
      databaseUrl: fixtureUrl.toString(),
      fixtureSchema,
      fixtureKind: "deterministic_fixture",
    }
  } catch (error) {
    if (fixtureSchema) {
      await client.query("RESET search_path")
      await client.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`)
    }
    throw error
  } finally {
    await client.end()
  }
}

describe.skipIf(!RUN_REAL_DB_TEST)(
  "semantic delivery retriever against the approved snapshot",
  () => {
    let prisma: PrismaClient
    let fixtureSchema: string | null = null
    let fixtureKind: "production_snapshot" | "deterministic_fixture"
    let databaseUrl: string

    beforeAll(async () => {
      if (!DELIVERY_FIXTURE_MODE) {
        throw new Error(
          "Set RECOMMENDATION_DELIVERY_DB_FIXTURE=production_snapshot for release proof or =deterministic for isolated CI; no implicit fallback is allowed.",
        )
      }
      const fixture = await prepareExplicitDeliveryFixture(
        env.DATABASE_URL,
        DELIVERY_FIXTURE_MODE,
      )
      databaseUrl = fixture.databaseUrl
      fixtureSchema = fixture.fixtureSchema
      fixtureKind = fixture.fixtureKind
      prisma = new PrismaClient({
        datasources: { db: { url: databaseUrl } },
      })
    })

    afterAll(async () => {
      await prisma?.$disconnect()
      if (fixtureSchema) {
        const client = new Client({
          connectionString: env.DATABASE_URL,
        })
        await client.connect()
        await client.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`)
        await client.end()
      }
    })

    it("keeps cold and warm complete-service delivery, including stage persistence, inside 1.5s", async () => {
      const seeds = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM video WHERE slug = 'jesus' AND deleted_at IS NULL LIMIT 1
      `
      const seed = seeds[0]
      expect(seed).toBeDefined()

      let id = 0
      const service = new RecommendationDeliveryService({
        prisma,
        admission: {
          acquire: async () => ({
            allowed: true as const,
            leaseId: "db-benchmark",
          }),
          release: async () => undefined,
        },
        getServingState: async () => ({
          canIssue: true,
          reason: "ready" as const,
          lastKnownGoodManifestId: RECOMMENDATION_CONTRACTS.strategy,
          revokedKids: [],
          manifest: {
            id: "semantic-candidate-platform-v1",
            strategyVersion: "semantic-candidate-platform-v1",
            contractVersion: RECOMMENDATION_CONTRACTS.delivery,
            surfaceVersion: RECOMMENDATION_CONTRACTS.surface,
            generator: "semantic",
            maxItems: 6,
          },
        }),
        retrieve: ({
          seedMediaId,
          locale,
          audioLanguageSlug,
          limit,
          deadlineAt,
        }) =>
          runRecommendationRetrievalQuery(prisma, deadlineAt, (scopedPrisma) =>
            getSemanticDeliveryCandidatePool(scopedPrisma, {
              seedMediaId,
              locale,
              audioLanguageSlug,
              limit,
            }),
          ),
        recheckCached: async (items) => [...items],
        orchestrate: runSemanticCandidatePlatform,
        tokenService: {
          activeKid: "benchmark-kid",
          signDeliveryCapability: async ({ jti }) => `benchmark:${jti}`,
        },
        newId: () => `benchmark-${Date.now()}-${++id}`,
      })
      const deliver = async (sessionCharacter: string) => {
        const startedAt = Date.now()
        const response = await service.deliver({
          caller: {
            id: null,
            role: "CONSUMER_BEARER",
            fleet: false,
            rateLimitBucketKey: "candidate-platform-db-benchmark",
          },
          seedMediaId: seed!.id,
          locale: "en",
          audioLanguageSlug: "english",
          sessionDigest: sessionCharacter.repeat(64),
        })
        return { response, elapsedMs: Date.now() - startedAt }
      }

      const cold = await deliver("a")
      const baselineStartedAt = Date.now()
      const baseline = await runRecommendationRetrievalQuery(
        prisma,
        baselineStartedAt + DELIVERY_RETRIEVAL_BUDGET_MS,
        (scopedPrisma) =>
          getSemanticDeliveryRecommendations(scopedPrisma, {
            seedMediaId: seed!.id,
            locale: "en",
            audioLanguageSlug: "english",
            limit: 6,
          }),
      )
      const warm = await deliver("b")
      const payloadBytes = Buffer.byteLength(JSON.stringify(cold.response))
      expect(JSON.stringify(cold.response)).not.toMatch(
        /embeddingText|videoCoreId/,
      )
      const candidateRun = await prisma.recommendationCandidateRun.findUnique({
        where: { requestId: cold.response.requestId! },
      })
      const persistedStageCount =
        await prisma.recommendationCandidateStageEvidence.count({
          where: { run: { is: { requestId: cold.response.requestId! } } },
        })

      expect(cold.response.result).toBe("served")
      expect(warm.response.result).toBe("served")
      expect(cold.response.items.map((item) => item.targetMediaId)).toEqual(
        baseline.map((item) => item.videoId),
      )
      expect(warm.response.items.map((item) => item.targetMediaId)).toEqual(
        baseline.map((item) => item.videoId),
      )
      if (fixtureKind === "deterministic_fixture") {
        for (const item of cold.response.items) {
          const targetIndex = Number(item.targetMediaId.split("-").at(-1))
          expect(item.durationSeconds).toBe(
            targetIndex % 2 === 0 ? 240 + targetIndex : 300 + targetIndex,
          )
        }
      }
      expect(candidateRun).toMatchObject({
        candidateEligibilityParity: "passed",
        rankerParity: "passed",
        evidenceComplete: true,
        composedCount: cold.response.items.length,
      })
      expect(persistedStageCount).toBeGreaterThanOrEqual(
        cold.response.items.length * 5,
      )
      expect(payloadBytes).toBeLessThanOrEqual(MAX_DELIVERY_RESPONSE_BYTES)
      expect(cold.elapsedMs).toBeLessThan(DELIVERY_RETRIEVAL_BUDGET_MS)
      expect(warm.elapsedMs).toBeLessThan(DELIVERY_RETRIEVAL_BUDGET_MS)

      console.info(
        `[recommendations] event=candidate_platform_benchmark fixture=${fixtureKind} cold_ms=${cold.elapsedMs} warm_ms=${warm.elapsedMs} payload_bytes=${payloadBytes} baseline_items=${baseline.length} nominated=${candidateRun?.nominatedCount ?? 0} composed=${candidateRun?.composedCount ?? 0} persisted_stages=${persistedStageCount}`,
      )
    })

    it("keeps complete hybrid retrieval, composition, signing, persistence, and serialization inside 1.5s", async () => {
      expect(fixtureKind).toBe(
        DELIVERY_FIXTURE_MODE === "production_snapshot"
          ? "production_snapshot"
          : "deterministic_fixture",
      )
      const seed = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM video WHERE slug = 'jesus' AND deleted_at IS NULL LIMIT 1
      `
      expect(seed[0]).toBeDefined()
      const benchmarkNow = new Date("2026-08-27T00:05:00.000Z")
      const signingKey = {
        kid: "delivery-benchmark-kid",
        status: "active" as const,
        material: new Uint8Array(32).fill(3),
      }
      const signer = createRecommendationTokenService({
        keyring: {
          active: signingKey,
          keysById: new Map([[signingKey.kid, signingKey]]),
        },
        readRevokedKids: async () => [],
        now: () => benchmarkNow,
      })
      const service = new RecommendationDeliveryService({
        prisma,
        admission: {
          acquire: async () => ({
            allowed: true as const,
            leaseId: "hybrid-db-benchmark",
          }),
          release: async () => undefined,
        },
        getServingState: async () => ({
          canIssue: true,
          reason: "ready",
          lastKnownGoodManifestId: RECOMMENDATION_CONTRACTS.strategy,
          revokedKids: [],
          manifest: {
            id: HYBRID_PERSONALIZED_MANIFEST_ID,
            strategyVersion: HYBRID_PERSONALIZED_MANIFEST_ID,
            contractVersion: RECOMMENDATION_CONTRACTS.delivery,
            surfaceVersion: RECOMMENDATION_CONTRACTS.surface,
            generator: "hybrid",
            maxItems: 6,
          },
        }),
        retrieve: ({
          seedMediaId,
          locale,
          audioLanguageSlug,
          limit,
          deadlineAt,
        }) =>
          runRecommendationRetrievalQuery(prisma, deadlineAt, (scopedPrisma) =>
            getSemanticDeliveryCandidatePool(scopedPrisma, {
              seedMediaId,
              locale,
              audioLanguageSlug,
              limit,
            }),
          ),
        recheckCached: async (items) => [...items],
        orchestrate: runSemanticCandidatePlatform,
        orchestrateHybrid: runCandidatePlatform,
        authorizeProfile: async (input) => {
          const receipt = await prisma.recommendationConsentReceipt.findUnique({
            where: { tokenDigest: input.consentReceiptDigest },
            include: { profile: true },
          })
          return Boolean(
            receipt?.profile?.tokenDigest === input.profileTokenDigest &&
            receipt.state === "ACTIVE" &&
            receipt.choice === "PERSONALIZATION" &&
            receipt.privacyGeneration === receipt.profile?.privacyGeneration,
          )
        },
        assignExperiment: async () => ({
          assignment: {
            assignmentId: "delivery-benchmark-assignment",
            experimentId: "delivery-benchmark-experiment",
            experimentVersion: "delivery-benchmark-experiment-v1",
            experimentGeneration: 1,
            arm: "challenger",
            effectiveManifestId: HYBRID_PERSONALIZED_MANIFEST_ID,
            assignmentProbability: 0.1,
            configurationDigest: "a".repeat(64),
          },
          bypassReason: null,
        }),
        retrieveProfile: (input) =>
          runRecommendationRetrievalQuery(
            prisma,
            input.deadlineAt,
            (scopedPrisma) =>
              getLiveProfileCandidates(scopedPrisma, {
                sessionDigest: input.sessionDigest,
                profileTokenDigest: input.profileTokenDigest,
                now: input.now,
                context: {
                  surface: RECOMMENDATION_CONTRACTS.surface,
                  purpose: "watch",
                  locale: input.locale,
                  audioLanguageSlug: input.audioLanguageSlug,
                  seedMediaId: input.seedMediaId,
                  manifestId: input.manifestId,
                },
              }),
          ),
        resolveRecentContext: (input) =>
          runRecommendationRetrievalQuery(
            prisma,
            input.deadlineAt,
            (scopedPrisma) =>
              getRecommendationRecentContext(scopedPrisma, {
                sessionDigest: input.sessionDigest,
                profileTokenDigest: input.profileTokenDigest,
                allowDurableProfileLinks: input.allowDurableProfileLinks,
                now: input.now,
              }),
          ),
        tokenService: {
          activeKid: signingKey.kid,
          signDeliveryCapability: signer.signDeliveryCapability,
        },
        now: () => benchmarkNow,
      })
      const deliver = async () => {
        const startedAt = performance.now()
        const response = await service.deliver({
          caller: {
            id: null,
            role: "CONSUMER_BEARER",
            fleet: false,
            rateLimitBucketKey: "hybrid-delivery-db-benchmark",
          },
          seedMediaId: seed[0]!.id,
          locale: "en",
          audioLanguageSlug: "english",
          sessionDigest: BENCHMARK_SESSION_DIGEST,
          consentReceiptDigest: BENCHMARK_CONSENT_RECEIPT_DIGEST,
          profileTokenDigest: BENCHMARK_PROFILE_TOKEN_DIGEST,
        })
        return { response, elapsedMs: performance.now() - startedAt }
      }

      const cold = await deliver()
      const warm = await deliver()
      for (const run of [cold, warm]) {
        expect(run.elapsedMs).toBeLessThan(DELIVERY_RETRIEVAL_BUDGET_MS)
        expect(run.response.reason).toBe(null)
        expect(run.response).toMatchObject({ result: "served" })
        expect(run.response.items).toHaveLength(6)
        expect(
          new Set(run.response.items.map((item) => item.targetMediaId)).size,
        ).toBe(6)
        expect(run.response.personalization?.executionMode).toBe(
          "hybrid_personalized",
        )
        expect(
          run.response.items.some(
            (item) => item.candidateGenerator === "multi-interest-profile",
          ),
        ).toBe(true)
        expect(
          run.response.items.every(
            (item) => item.capability.split(".").length === 3,
          ),
        ).toBe(true)
        expect(
          Buffer.byteLength(JSON.stringify(run.response)),
        ).toBeLessThanOrEqual(MAX_DELIVERY_RESPONSE_BYTES)
        const persisted = await prisma.recommendationCandidateRun.findUnique({
          where: { requestId: run.response.requestId! },
        })
        expect(persisted).toMatchObject({
          composedCount: 6,
          shortfallReason: null,
          evidenceComplete: true,
        })
      }

      console.info(
        `[recommendations] event=hybrid_complete_service_benchmark fixture=${fixtureKind} cold_ms=${Math.ceil(cold.elapsedMs)} warm_ms=${Math.ceil(warm.elapsedMs)} composed=${cold.response.items.length} unique=${new Set(cold.response.items.map((item) => item.targetMediaId)).size} shortfall=${cold.response.shortfallReason ?? "none"}`,
      )
    })

    it("retrieves a representative multi-chunk slate inside the 1.5s budget", async () => {
      const seeds = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM video WHERE slug = 'jesus' AND deleted_at IS NULL LIMIT 1
      `
      const seed = seeds[0]
      expect(seed).toBeDefined()

      const startedAt = Date.now()
      const recommendations = await runRecommendationRetrievalQuery(
        prisma,
        startedAt + DELIVERY_RETRIEVAL_BUDGET_MS,
        (scopedPrisma) =>
          getSemanticDeliveryRecommendations(scopedPrisma, {
            seedMediaId: seed!.id,
            locale: "en",
            audioLanguageSlug: "english",
            limit: 6,
          }),
      )
      const elapsed = Date.now() - startedAt

      expect(recommendations.length).toBeGreaterThan(0)
      expect(recommendations.length).toBeLessThanOrEqual(6)
      expect(new Set(recommendations.map((item) => item.videoId)).size).toBe(
        recommendations.length,
      )
      expect(recommendations.every((item) => item.videoId !== seed!.id)).toBe(
        true,
      )
      expect(
        recommendations.every((item) => Boolean(item.imageUrl?.trim())),
      ).toBe(true)
      if (DELIVERY_FIXTURE_MODE === "deterministic") {
        const repeated = await getSemanticDeliveryRecommendations(prisma, {
          seedMediaId: seed!.id,
          locale: "en",
          audioLanguageSlug: "english",
          limit: 6,
        })
        const firstTarget = recommendations.find(
          (item) => item.videoId === "target-video-0",
        )
        expect(firstTarget?.videoTitle).toBe("Target 0")
        expect(
          repeated.find((item) => item.videoId === "target-video-0")
            ?.videoTitle,
        ).toBe(firstTarget?.videoTitle)
      }
      expect(elapsed).toBeLessThan(DELIVERY_RETRIEVAL_BUDGET_MS)
    })
  },
)
