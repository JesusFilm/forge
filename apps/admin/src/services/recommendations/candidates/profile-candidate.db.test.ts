import { readFileSync } from "node:fs"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import {
  ACTIVE_CONTENT_EMBEDDING_CONTRACT_ID,
  ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
  ACTIVE_CONTENT_STORAGE_EMBEDDING_MODEL,
  ACTIVE_CONTENT_STORAGE_EMBEDDING_PROVIDER,
  CONTENT_EMBEDDING_CONTRACT_POINTER_ID,
} from "@/services/content-embedding-contract"
import { DELIVERY_RETRIEVAL_BUDGET_MS } from "../contracts"
import { runRecommendationRetrievalQuery } from "../delivery.service"
import { runCandidatePlatform } from "../orchestration"
import {
  createDatabaseProfileSourceNominationGenerator,
  getLiveProfileCandidates,
} from "./profile-candidate.service"

const RUN_REAL_DB_TEST = env.RECOMMENDATION_DB_TEST === "1"
const USE_DETERMINISTIC_FIXTURE =
  env.RECOMMENDATION_PROFILE_DB_FIXTURE === "deterministic"
const migrations = [
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
].map((migration) =>
  readFileSync(
    new URL(
      `../../../../prisma/migrations/${migration}/migration.sql`,
      import.meta.url,
    ),
    "utf8",
  ),
)

function deterministicVector(first: number, second: number): string {
  return `[${[first, second, ...Array<number>(1534).fill(0)].join(",")}]`
}

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
      $1, 'openrouter', 'qwen/qwen3-embedding-8b', 1536, 1536, NULL,
      $2, $3, $4, $4, NULL
    )`,
    [
      ACTIVE_CONTENT_EMBEDDING_CONTRACT_ID,
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

async function installDeterministicCatalogFixture(
  client: Client,
  input: { projectionMediaId: string; seedMediaId: string },
): Promise<void> {
  await installContentEmbeddingContractAuthority(client)
  await client.query(`
    CREATE TABLE video (
      id text PRIMARY KEY, core_id text, slug text NOT NULL,
      deleted_at timestamp, restrict_view_platforms text[] NOT NULL DEFAULT '{}'
    );
    CREATE TABLE video_relation (parent_id text, child_id text);
    CREATE TABLE video_transcript (
      id text PRIMARY KEY, video_id text NOT NULL, video_edition_id text NOT NULL,
      language text NOT NULL, embedding_provider text, model text NOT NULL,
      dimensions integer NOT NULL, embedding_native_dimensions integer,
      embedding_transform_version text
    );
    CREATE TABLE video_transcript_chunk (
      id text PRIMARY KEY, transcript_id text NOT NULL, language text NOT NULL,
      model text NOT NULL, dimensions integer NOT NULL, chunk_index integer NOT NULL,
      content_summary text, raw_source_text text, text text NOT NULL,
      start_seconds double precision, end_seconds double precision,
      felt_needs text[] NOT NULL DEFAULT '{}', demographics text[] NOT NULL DEFAULT '{}',
      spiritual_context text[] NOT NULL DEFAULT '{}',
      embedding public.vector(1536)
    );
    CREATE INDEX video_transcript_chunk_embedding_hnsw
      ON video_transcript_chunk USING hnsw (embedding public.vector_cosine_ops);
    CREATE TABLE video_locale (
      id text PRIMARY KEY, video_id text NOT NULL, locale text NOT NULL,
      status text NOT NULL, deleted_at timestamp, title text,
      language_slug text, language_core_id text
    );
    CREATE TABLE language (id text PRIMARY KEY, slug text NOT NULL);
    CREATE TABLE mux_video (id text PRIMARY KEY, playback_id text);
    CREATE TABLE video_dub (
      id text PRIMARY KEY, video_edition_id text NOT NULL, language_id text NOT NULL,
      mux_video_id text NOT NULL, deleted_at timestamp, published boolean,
      duration integer, length_in_milliseconds bigint, updated_at timestamp NOT NULL
    );
    CREATE TABLE video_image (
      id text PRIMARY KEY, video_id text NOT NULL, mobile_cinematic_high text,
      video_still text, thumbnail text, url text, deleted_at timestamp,
      created_at timestamp NOT NULL
    );
  `)
  const videos = [
    {
      id: input.projectionMediaId,
      slug: "ci-profile-candidate-a",
      vector: deterministicVector(1, 0),
    },
    {
      id: "ci-profile-candidate-b",
      slug: "ci-profile-candidate-b",
      vector: deterministicVector(0.95, 0.05),
    },
    {
      id: input.seedMediaId,
      slug: "ci-profile-seed",
      vector: deterministicVector(0, 1),
    },
  ]
  await client.query(
    `INSERT INTO language (id, slug) VALUES ('ci-english', 'english')`,
  )
  for (const [index, video] of videos.entries()) {
    const editionId = `ci-edition-${index}`
    const transcriptId = `ci-transcript-${index}`
    const muxId = `ci-mux-${index}`
    await client.query(
      `INSERT INTO video (id, core_id, slug) VALUES ($1, $2, $3)`,
      [video.id, `ci-core-${index}`, video.slug],
    )
    await client.query(
      `INSERT INTO video_locale (
         id, video_id, locale, status, title, language_slug, language_core_id
       ) VALUES ($1, $2, 'en', 'published', $3, 'english', '529')`,
      [`ci-locale-${index}-english`, video.id, `CI profile candidate ${index}`],
    )
    if (index === 1) {
      await client.query(
        `INSERT INTO video_locale (
           id, video_id, locale, status, title, language_slug, language_core_id
         ) VALUES (
           'ci-locale-1-other', $1, 'en', 'published',
           'Wrong duplicate-locale title', 'spanish-latin-american', '21028'
         )`,
        [video.id],
      )
    }
    await client.query(
      `INSERT INTO mux_video (id, playback_id) VALUES ($1, $2)`,
      [muxId, `ci-playback-${index}`],
    )
    await client.query(
      `INSERT INTO video_dub (
        id, video_edition_id, language_id, mux_video_id, published,
        duration, length_in_milliseconds, updated_at
       ) VALUES (
        $1, $2, 'ci-english', $3, true, $4, $5,
        '2026-08-26T00:00:00.000Z'
       )`,
      [
        `ci-dub-${index}`,
        editionId,
        muxId,
        180 + index,
        index === 0 ? 125_000 : null,
      ],
    )
    await client.query(
      `INSERT INTO video_transcript (
        id, video_id, video_edition_id, language, embedding_provider, model,
       dimensions, embedding_native_dimensions, embedding_transform_version
       ) VALUES ($1, $2, $3, 'en', $4, $5, $6, $6, NULL)`,
      [
        transcriptId,
        video.id,
        editionId,
        ACTIVE_CONTENT_STORAGE_EMBEDDING_PROVIDER,
        ACTIVE_CONTENT_STORAGE_EMBEDDING_MODEL,
        ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
      ],
    )
    await client.query(
      `INSERT INTO video_transcript_chunk (
         id, transcript_id, language, model, dimensions, chunk_index,
         content_summary, raw_source_text, text, start_seconds, end_seconds,
         felt_needs, demographics, spiritual_context, embedding
       ) VALUES ($1, $2, 'en', $4, $5, 0,
         $3, $3, $3, 0, 60, ARRAY['hope'], ARRAY['general'],
         ARRAY['curious'], $6::public.vector)`,
      [
        `ci-chunk-${index}`,
        transcriptId,
        `Deterministic recommendation fixture ${index}`,
        ACTIVE_CONTENT_STORAGE_EMBEDDING_MODEL,
        ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
        video.vector,
      ],
    )
  }
}

describe.skipIf(!RUN_REAL_DB_TEST)(
  "multi-interest candidates against an approved pgvector fixture",
  () => {
    const schema = `recommendation_u19_snapshot_${Date.now()}`
    const now = new Date("2026-08-26T12:00:00.000Z")
    let admin: Client
    let prisma: PrismaClient
    let projectionMediaId: string
    let secondaryProjectionMediaId: string
    let seedMediaId: string

    beforeAll(async () => {
      admin = new Client({ connectionString: env.DATABASE_URL })
      await admin.connect()
      await admin.query(`CREATE SCHEMA "${schema}"`)
      await admin.query(`SET search_path TO "${schema}", public`)
      for (const migration of migrations) await admin.query(migration)
      if (USE_DETERMINISTIC_FIXTURE) {
        projectionMediaId = "ci-profile-candidate-a"
        seedMediaId = "ci-profile-seed"
        secondaryProjectionMediaId = seedMediaId
        await installDeterministicCatalogFixture(admin, {
          projectionMediaId,
          seedMediaId,
        })
      } else {
        const snapshot = await admin.query<{ video_id: string }>(`
          SELECT transcript.video_id
          FROM public.video_transcript transcript
          JOIN public.video_transcript_chunk chunk
            ON chunk.transcript_id = transcript.id AND chunk.embedding IS NOT NULL
          JOIN public.video video ON video.id = transcript.video_id
            AND video.deleted_at IS NULL
          JOIN public.video_locale locale ON locale.video_id = video.id
            AND locale.locale = 'en' AND locale.status = 'published'
            AND locale.deleted_at IS NULL
          JOIN public.video_dub dub ON dub.video_edition_id = transcript.video_edition_id
            AND dub.deleted_at IS NULL
          JOIN public.language language ON language.id = dub.language_id
            AND language.slug = 'english'
          JOIN public.mux_video mux ON mux.id = dub.mux_video_id
            AND mux.playback_id IS NOT NULL
          WHERE transcript.language = 'en'
            AND transcript.embedding_provider = 'jesus-film-ai-gateway'
            AND transcript.model = 'embeddings'
            AND transcript.dimensions = 1536
            AND transcript.embedding_native_dimensions = 1536
            AND transcript.embedding_transform_version IS NULL
            AND chunk.model = 'embeddings'
            AND chunk.dimensions = 1536
          GROUP BY transcript.video_id
          ORDER BY transcript.video_id
          LIMIT 3
        `)
        if (snapshot.rows.length < 3) {
          throw new Error(
            "The approved production snapshot must contain three playable English pgvector videos for U19 verification.",
          )
        }
        projectionMediaId = snapshot.rows[0]!.video_id
        seedMediaId = snapshot.rows[1]!.video_id
        secondaryProjectionMediaId = snapshot.rows[2]!.video_id
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
          await admin.query(
            `CREATE VIEW "${schema}"."${table}" AS SELECT * FROM public."${table}"`,
          )
        }
      }
      await admin.query(
        `INSERT INTO recommendation_profile (
          id, token_digest, privacy_generation, choice, state, expires_at, updated_at
        ) VALUES (
          'u19-snapshot-profile', $1, 1, 'durable_allowed', 'active',
          '2027-02-20T00:00:00.000Z', $2
        )`,
        ["a".repeat(64), now],
      )
      await admin.query(
        `INSERT INTO recommendation_profile_projection_generation (
          id, manifest_id, scope, profile_id, privacy_generation, generation,
          state, projection_version, clustering_version,
          eligibility_policy_version, outcome_classifier_version,
          input_window_start, input_window_end, input_watermark, input_digest,
          contribution_count, durable_interest_count, coverage, stability,
          cohort_quality, retention_days, published_at, expires_at
        ) VALUES (
          'u19-snapshot-projection', 'multi-interest-profile-shadow-v1',
          'durable', 'u19-snapshot-profile', 1, 1, 'published',
          'multi-interest-profile-projection-v1',
          'deterministic-farthest-first-medoids-v1',
          'recommendation-integrity-v1', 'active-watch-proxy-v1',
          '2026-08-25T12:00:00.000Z', $1, $1, $2, 2, 2,
          1, 1, 0.9, 180, $1, '2027-02-20T00:00:00.000Z'
        )`,
        [now, "b".repeat(64)],
      )
      await admin.query(
        `INSERT INTO recommendation_profile_interest (
          id, generation_id, kind, interest_ordinal, medoid_media_id,
          medoid_source_digest, embedding, weight, support_count, stability,
          expires_at
        )
        SELECT
          'u19-snapshot-interest', 'u19-snapshot-projection', 'durable', 0,
          $1::varchar(191), $2, avg(chunk.embedding), 1, 1, 1,
          '2027-02-20T00:00:00.000Z'
        FROM video_transcript transcript
        JOIN video_transcript_chunk chunk ON chunk.transcript_id = transcript.id
        WHERE transcript.video_id::text = $1::text AND chunk.embedding IS NOT NULL
        GROUP BY transcript.video_id`,
        [projectionMediaId, "c".repeat(64)],
      )
      await admin.query(
        `INSERT INTO recommendation_profile_interest (
          id, generation_id, kind, interest_ordinal, medoid_media_id,
          medoid_source_digest, embedding, weight, support_count, stability,
          expires_at
        )
        SELECT
          'u19-snapshot-interest-secondary', 'u19-snapshot-projection',
          'durable', 1, $1::varchar(191), $2, avg(chunk.embedding), 1, 1, 1,
          '2027-02-20T00:00:00.000Z'
        FROM video_transcript transcript
        JOIN video_transcript_chunk chunk ON chunk.transcript_id = transcript.id
        WHERE transcript.video_id::text = $1::text
          AND chunk.embedding IS NOT NULL
        GROUP BY transcript.video_id`,
        [secondaryProjectionMediaId, "f".repeat(64)],
      )
      await admin.query(
        `INSERT INTO recommendation_profile_projection_pointer (
          scope_digest, scope, profile_id, privacy_generation, generation_id,
          pointer_generation, updated_at
        ) VALUES ($1, 'durable', 'u19-snapshot-profile', 1,
          'u19-snapshot-projection', 1, $2)`,
        ["d".repeat(64), now],
      )
      const url = new URL(env.DATABASE_URL)
      url.searchParams.delete("options")
      url.searchParams.set("schema", schema)
      prisma = new PrismaClient({
        datasources: { db: { url: url.toString() } },
      })
    })

    afterAll(async () => {
      await prisma?.$disconnect()
      if (!admin) return
      await admin.query("RESET search_path")
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await admin.end()
    })

    it("keeps cold and warm live profile challenger retrieval inside the unchanged 1.5s deadline", async () => {
      const retrieve = async () => {
        const startedAt = Date.now()
        const result = await runRecommendationRetrievalQuery(
          prisma,
          startedAt + DELIVERY_RETRIEVAL_BUDGET_MS,
          (scopedPrisma) =>
            getLiveProfileCandidates(scopedPrisma, {
              sessionDigest: "e".repeat(64),
              profileTokenDigest: "a".repeat(64),
              context: {
                surface: "watch-below-player-v1",
                purpose: "watch",
                locale: "en",
                audioLanguageSlug: "english",
                seedMediaId,
                manifestId: "multi-interest-profile-pilot-v1",
              },
              now,
            }),
        )
        return { result, elapsedMs: Date.now() - startedAt }
      }

      const cold = await retrieve()
      const warm = await retrieve()

      for (const run of [cold, warm]) {
        expect(run.elapsedMs).toBeLessThan(DELIVERY_RETRIEVAL_BUDGET_MS)
        expect(run.result?.projection).toMatchObject({
          id: "u19-snapshot-projection",
          scope: "durable",
          generation: 1,
          projectionVersion: "multi-interest-profile-projection-v1",
          interestCount: 2,
        })
        expect(run.result?.nominations.length).toBeGreaterThanOrEqual(2)
        expect(
          run.result?.nominations.every(
            (nomination) =>
              nomination.source.generator === "multi-interest-profile",
          ),
        ).toBe(true)
        expect(JSON.stringify(run.result)).not.toMatch(
          /vectorText|profileId|sessionDigest|tokenDigest/,
        )
      }
      if (USE_DETERMINISTIC_FIXTURE) {
        const coldCandidate = cold.result?.nominations.find(
          (candidate) => candidate.targetMediaId === "ci-profile-candidate-b",
        )
        const warmCandidate = warm.result?.nominations.find(
          (candidate) => candidate.targetMediaId === "ci-profile-candidate-b",
        )
        expect(coldCandidate?.presentation.videoTitle).toBe(
          "CI profile candidate 1",
        )
        expect(warmCandidate?.presentation.videoTitle).toBe(
          coldCandidate?.presentation.videoTitle,
        )
        expect(coldCandidate?.presentation.durationSeconds).toBe(181)
        expect(
          cold.result?.nominations.find(
            (candidate) => candidate.targetMediaId === "ci-profile-candidate-a",
          )?.presentation.durationSeconds,
        ).toBe(125)
      }

      console.info(
        `[recommendations] event=live_profile_challenger_snapshot_benchmark fixture=${USE_DETERMINISTIC_FIXTURE ? "deterministic_ci" : "production_snapshot"} cold_ms=${cold.elapsedMs} warm_ms=${warm.elapsedMs} nominated=${cold.result?.nominations.length ?? 0}`,
      )
    })

    it("retrieves hybrid profile-source ANN candidates within 1.5s", async () => {
      const generator = createDatabaseProfileSourceNominationGenerator(
        prisma,
        () => now,
      )
      const startedAt = performance.now()
      const generated = await generator({
        surface: "watch-below-player-v1",
        purpose: "watch",
        locale: "en",
        audioLanguageSlug: "english",
        seedMediaId,
        manifestId: "semantic-profile-hybrid-v1",
        contextProjection: {
          ref: "u19-snapshot-projection",
          version: "multi-interest-profile-projection-v1",
          digest: "b".repeat(64),
          privacyGeneration: 1,
        },
        liveItems: [],
      })
      const latencyMs = Math.ceil(performance.now() - startedAt)
      expect(latencyMs).toBeLessThanOrEqual(1_500)
      expect(generated.nominations.length).toBeGreaterThanOrEqual(2)
      expect(
        generated.nominations.map((nomination) => nomination.source.rank),
      ).toEqual(
        Array.from(
          { length: generated.nominations.length },
          (_, index) => index + 1,
        ),
      )
      expect(
        generated.nominations
          .slice(0, 2)
          .map((nomination) => nomination.source.evidence.interestRank),
      ).toEqual([1, 1])
      expect(generated.nominations[0]?.source).toMatchObject({
        generator: "multi-interest-profile",
        evidence: {
          interestOrdinal: 0,
          interestKind: "durable",
          interestRank: 1,
          projectionVersion: "multi-interest-profile-projection-v1",
        },
      })
      expect(JSON.stringify(generated)).not.toMatch(
        /vectorText|profileId|sessionDigest|tokenDigest/,
      )
      expect(
        generated.nominations.every(
          (nomination) => nomination.canonicalIdentity.embeddingText === null,
        ),
      ).toBe(true)

      const hybrid = runCandidatePlatform({
        context: {
          surface: "watch-below-player-v1",
          purpose: "watch",
          locale: "en",
          audioLanguageSlug: "english",
        },
        limit: 6,
        nominations: generated.nominations,
        generatorVersion: "semantic-profile-hybrid-generators-v1",
      })
      const bestRankByVideo = new Map<string, number>()
      for (const nomination of generated.nominations) {
        const existing = bestRankByVideo.get(nomination.targetMediaId)
        if (existing == null || nomination.source.rank < existing) {
          bestRankByVideo.set(nomination.targetMediaId, nomination.source.rank)
        }
      }
      const expectedHybridOrder = [...bestRankByVideo]
        .sort(
          ([leftId, leftRank], [rightId, rightRank]) =>
            leftRank - rightRank || leftId.localeCompare(rightId),
        )
        .map(([videoId]) => videoId)
      expect(
        hybrid.ordered.map((candidate) => candidate.targetMediaId),
      ).toEqual(expectedHybridOrder)
    })
  },
)
