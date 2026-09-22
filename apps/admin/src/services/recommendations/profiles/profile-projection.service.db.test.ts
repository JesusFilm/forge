import { readdirSync, readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { Prisma, PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
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
import { getUserWatchHistory } from "../user-history.service"
import { getLiveProfileCandidates } from "../candidates/profile-candidate.service"
import { RecommendationProfileService } from "../profile.service"
import { createDatabaseRecommendationProfileProjectionService } from "./profile-projection.service"
import { seedReconciliationScaleFixture } from "./reconciliation-scale.fixture"
import { runRecommendationProfileReconciliationBatch } from "./reconciliation.service"
import {
  profileIneligibleGenerationIdsSql,
  profileLineageEligibleSql,
} from "./profile-lineage"

const RUN_REAL_DB_TEST = env.RECOMMENDATION_DB_TEST === "1"
const migrationRoot = new URL("../../../../prisma/migrations/", import.meta.url)
const recommendationMigrations = readdirSync(migrationRoot)
  .filter((name) => {
    const ordinal = Number(name.slice(0, 4))
    return (
      (ordinal >= 52 && ordinal <= 76 && name.includes("recommendation")) ||
      name === "0082_user_recommendation_identity" ||
      name === "0098_recommendation_viewing_mode"
    )
  })
  .sort()
  .map((name) =>
    readFileSync(new URL(`${name}/migration.sql`, migrationRoot), "utf8"),
  )

const webCaller = {
  id: "forge-web",
  role: "CONSUMER_BEARER" as const,
  rateLimitBucketKey: "forge-web",
}

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

async function installCatalogFixture(client: Client): Promise<void> {
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
    CREATE INDEX profile_learning_chunk_embedding_hnsw
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
  await client.query(
    `INSERT INTO language (id, slug) VALUES ('profile-learning-en', 'english')`,
  )
  const videos = [
    {
      id: "profile-learning-source",
      slug: "profile-learning-source",
      vector: deterministicVector(1, 0),
    },
    {
      id: "profile-learning-similar",
      slug: "profile-learning-similar",
      vector: deterministicVector(0.95, 0.05),
    },
    {
      id: "profile-learning-seed",
      slug: "profile-learning-seed",
      vector: deterministicVector(0, 1),
    },
  ]
  for (const [index, video] of videos.entries()) {
    const editionId = `profile-learning-edition-${index}`
    const transcriptId = `profile-learning-transcript-${index}`
    const muxId = `profile-learning-mux-${index}`
    await client.query(
      `INSERT INTO video (id, core_id, slug) VALUES ($1, $2, $3)`,
      [video.id, `profile-learning-core-${index}`, video.slug],
    )
    await client.query(
      `INSERT INTO video_locale (
        id, video_id, locale, status, title, language_slug, language_core_id
      ) VALUES ($1, $2, 'en', 'published', $3, 'english', '529')`,
      [
        `profile-learning-locale-${index}`,
        video.id,
        `Profile learning video ${index}`,
      ],
    )
    await client.query(
      `INSERT INTO mux_video (id, playback_id) VALUES ($1, $2)`,
      [muxId, `profile-learning-playback-${index}`],
    )
    await client.query(
      `INSERT INTO video_dub (
        id, video_edition_id, language_id, mux_video_id, published,
        duration, updated_at
      ) VALUES ($1, $2, 'profile-learning-en', $3, true, 120, now())`,
      [`profile-learning-dub-${index}`, editionId, muxId],
    )
    await client.query(
      `INSERT INTO video_transcript (
        id, video_id, video_edition_id, language, embedding_provider, model,
        dimensions, embedding_native_dimensions, embedding_transform_version
      ) VALUES (
        $1, $2, $3, 'en', $4, $5, $6, $6, NULL
      )`,
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
      ) VALUES (
        $1, $2, 'en', $4, $5, 0, $3, $3, $3, 0, 60,
        ARRAY['hope'], ARRAY['general'], ARRAY['curious'], $6::public.vector
      )`,
      [
        `profile-learning-chunk-${index}`,
        transcriptId,
        `Profile learning fixture ${index}`,
        ACTIVE_CONTENT_STORAGE_EMBEDDING_MODEL,
        ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
        video.vector,
      ],
    )
  }
}

describe.skipIf(!RUN_REAL_DB_TEST)(
  "profile projection learning against Postgres",
  () => {
    const schema = `recommendation_profile_learning_${Date.now()}`
    let admin: Client
    let prisma: PrismaClient

    beforeAll(async () => {
      admin = new Client({ connectionString: env.DATABASE_URL })
      await admin.connect()
      await admin.query(`CREATE SCHEMA "${schema}"`)
      await admin.query(`SET search_path TO "${schema}", public`)
      for (const migration of recommendationMigrations) {
        await admin.query(migration)
      }
      await installCatalogFixture(admin)
      const fixtureUrl = new URL(env.DATABASE_URL)
      fixtureUrl.searchParams.delete("options")
      fixtureUrl.searchParams.set("schema", schema)
      prisma = new PrismaClient({
        datasources: { db: { url: fixtureUrl.toString() } },
      })
    })

    afterAll(async () => {
      await prisma?.$disconnect()
      if (!admin) return
      await admin.query("RESET search_path")
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await admin.end()
    })

    it("projects a qualified consented outcome and uses it in the next profile retrieval", async () => {
      const profileTokenDigest = "a".repeat(64)
      const consentTokenDigest = "b".repeat(64)
      const sessionDigest = "c".repeat(64)
      const grantedAt = new Date()
      const profileService = new RecommendationProfileService({
        prisma,
        now: () => grantedAt,
        newId: randomUUID,
        newAuditId: randomUUID,
      })
      const grant = await profileService.transition({
        caller: webCaller,
        contractVersion: "recommendation-profile-v1",
        consentContractVersion: "recommendation-consent-v1",
        action: "grant",
        consentChoice: "personalization",
        sessionDigest,
        existingConsentReceiptDigest: null,
        proposedConsentReceiptDigest: consentTokenDigest,
        existingProfileDigest: null,
        proposedProfileDigest: profileTokenDigest,
      })
      expect(grant).toMatchObject({
        state: "active",
        consentChoice: "personalization",
        privacyGeneration: 1,
      })
      expect(grant.profileId).not.toBeNull()

      const profile = await prisma.recommendationProfile.findUniqueOrThrow({
        where: { id: grant.profileId! },
      })
      const eventAt = new Date(
        Math.max(grantedAt.getTime(), profile.createdAt.getTime()) + 1_000,
      )
      const projectAt = new Date(eventAt.getTime() + 1_000)
      const expiresAt = new Date(projectAt.getTime() + 7 * 86_400_000)
      const activeUntil = new Date(eventAt.getTime() + 60_000)
      const hardUntil = new Date(eventAt.getTime() + 120_000)
      await admin.query(
        `INSERT INTO recommendation_playback_episode (
          id, media_id, session_digest,
          state, active_until, hard_until, next_fact_sequence, generation,
          capability_jti, signing_kid, claimed_at, finalized_at, created_at,
          expires_at
        ) VALUES (
          'profile-learning-episode', 'profile-learning-source', $1,
          'finalized', $2, $3, 1, 1, 'profile-learning-episode-jti',
          'test-kid', $4, $4, $4, $5
        )`,
        [sessionDigest, activeUntil, hardUntil, eventAt, expiresAt],
      )
      await admin.query(
        `INSERT INTO recommendation_outcome_revision (
          id, episode_id, classifier_version,
          fact_watermark, input_digest, revision, qualified_view,
          view_quality_weight, view_quality_weight_reason, reasons,
          learning_eligible, generation, active_playback_milliseconds,
          duration_seconds, duration_cohort, active_coverage, created_at,
          expires_at
        ) VALUES (
          'profile-learning-outcome', 'profile-learning-episode',
          'active-watch-proxy-v1', 0, $1, 1, true, 0.8,
          'active_fraction_of_duration', ARRAY['qualified_view'], false, 1,
          60000, 120, 'medium', 'complete', $2, $3
        )`,
        ["1".repeat(64), eventAt, expiresAt],
      )
      await admin.query(
        `INSERT INTO recommendation_eligibility_decision (
          id, source_type, source_key, outcome_id, policy_version, revision,
          is_current, actor_class, state, reason_codes, eligible_scopes,
          contribution_weight, contribution_ordinal, distinct_support,
          identity_concentration, input_digest, evidence_watermark,
          decided_at, expires_at
        ) VALUES (
          'profile-learning-eligibility', 'playback_outcome',
          'profile-learning-outcome:recommendation-integrity-v1',
          'profile-learning-outcome', 'recommendation-integrity-v1', 1,
          true, 'human_anonymous', 'eligible', ARRAY['qualified_view'],
          ARRAY['profile'], 0.8, 1, 1, 1, $3::char(64),
          $1::timestamptz, $1::timestamptz, $2::timestamptz
        )`,
        [eventAt, expiresAt, "2".repeat(64)],
      )

      const projectionService =
        createDatabaseRecommendationProfileProjectionService(prisma)
      const receipt = await projectionService.project({
        sessionDigest,
        profileId: grant.profileId,
        privacyGeneration: grant.privacyGeneration,
        now: projectAt,
      })
      expect(receipt).toMatchObject({
        status: "published",
        generation: 1,
        replay: false,
      })

      const [generation, interests, contributions, pointer] = await Promise.all(
        [
          prisma.recommendationProfileProjectionGeneration.findUniqueOrThrow({
            where: { id: receipt.generationId },
          }),
          prisma.recommendationProfileInterest.findMany({
            where: { generationId: receipt.generationId },
            orderBy: [{ kind: "asc" }, { interestOrdinal: "asc" }],
          }),
          prisma.recommendationProfileProjectionContribution.findMany({
            where: { generationId: receipt.generationId },
            orderBy: { kind: "asc" },
          }),
          prisma.recommendationProfileProjectionPointer.findFirstOrThrow({
            where: {
              profileId: grant.profileId,
              privacyGeneration: grant.privacyGeneration!,
            },
          }),
        ],
      )
      expect(generation).toMatchObject({
        state: "PUBLISHED",
        durableInterestCount: 1,
        sessionIntentPresent: false,
        contributionCount: 1,
      })
      expect(interests.map((interest) => interest.kind)).toEqual(["DURABLE"])
      expect(contributions.map((contribution) => contribution.kind)).toEqual([
        "QUALIFIED_OUTCOME",
      ])
      expect(
        contributions.find(
          (contribution) => contribution.kind === "QUALIFIED_OUTCOME",
        ),
      ).toMatchObject({
        sourceOutcomeId: "profile-learning-outcome",
        targetMediaId: "profile-learning-source",
        privacyGeneration: 1,
      })
      expect(pointer).toMatchObject({
        generationId: receipt.generationId,
        pointerGeneration: 1,
      })

      const candidates = await getLiveProfileCandidates(prisma, {
        sessionDigest,
        profileTokenDigest,
        context: {
          surface: "watch-below-player-v1",
          purpose: "watch",
          locale: "en",
          audioLanguageSlug: "english",
          seedMediaId: "profile-learning-seed",
          manifestId: "semantic-profile-hybrid-v1",
        },
        now: projectAt,
      })
      expect(candidates?.projection).toMatchObject({
        id: receipt.generationId,
        scope: "durable",
        generation: 1,
        interestCount: 1,
        qualifiedInterestCount: 1,
      })
      expect(
        candidates?.nominations.find(
          (candidate) => candidate.targetMediaId === "profile-learning-similar",
        ),
      ).toMatchObject({
        source: {
          generator: "multi-interest-profile",
          generatorVersion: "multi-interest-profile-candidate-v1",
        },
      })
      expect(JSON.stringify(candidates)).not.toMatch(
        /profileTokenDigest|sessionDigest|vectorText/,
      )

      const sourceFree = await getLiveProfileCandidates(prisma, {
        sessionDigest,
        profileTokenDigest,
        context: {
          surface: "watch-below-player-v1",
          purpose: "watch",
          locale: "en",
          audioLanguageSlug: "english",
          seedMediaId: null,
          manifestId: "semantic-profile-hybrid-v1",
        },
        now: projectAt,
      })
      expect(
        sourceFree?.nominations.some(
          (candidate) => candidate.targetMediaId === "profile-learning-similar",
        ),
      ).toBe(true)
      expect(
        await getUserWatchHistory(prisma, {
          sessionDigest,
          profileTokenDigest,
          now: projectAt,
        }),
      ).toEqual([
        {
          mediaId: "profile-learning-source",
          videoCoreId: "profile-learning-core-0",
          completed: false,
        },
      ])

      await admin.query(
        `UPDATE recommendation_playback_episode
         SET conflict_count = 1
         WHERE id = 'profile-learning-episode'`,
      )
      await expect(
        getLiveProfileCandidates(prisma, {
          sessionDigest,
          profileTokenDigest,
          context: {
            surface: "watch-below-player-v1",
            purpose: "watch",
            locale: "en",
            audioLanguageSlug: "english",
            seedMediaId: "profile-learning-seed",
            manifestId: "semantic-profile-hybrid-v1",
          },
          now: projectAt,
        }),
      ).rejects.toMatchObject({ code: "profile_lineage_ineligible" })
      await admin.query(
        `UPDATE recommendation_playback_episode
         SET conflict_count = 0, next_fact_sequence = 2
         WHERE id = 'profile-learning-episode'`,
      )
      await expect(
        getLiveProfileCandidates(prisma, {
          sessionDigest,
          profileTokenDigest,
          context: {
            surface: "watch-below-player-v1",
            purpose: "watch",
            locale: "en",
            audioLanguageSlug: "english",
            seedMediaId: "profile-learning-seed",
            manifestId: "semantic-profile-hybrid-v1",
          },
          now: projectAt,
        }),
      ).rejects.toMatchObject({ code: "profile_lineage_ineligible" })
      await admin.query(
        `UPDATE recommendation_playback_episode
         SET next_fact_sequence = 1
         WHERE id = 'profile-learning-episode'`,
      )

      await admin.query(
        `UPDATE recommendation_eligibility_decision
         SET is_current = false
         WHERE id = 'profile-learning-eligibility'`,
      )
      await admin.query(
        `INSERT INTO recommendation_eligibility_decision (
          id, source_type, source_key, outcome_id, policy_version, revision,
          is_current, actor_class, state, reason_codes, eligible_scopes,
          contribution_weight, contribution_ordinal, distinct_support,
          identity_concentration, input_digest, evidence_watermark,
          decided_at, expires_at
        ) VALUES (
          'profile-learning-eligibility-rev-2', 'playback_outcome',
          'profile-learning-outcome:recommendation-integrity-v1',
          'profile-learning-outcome', 'recommendation-integrity-v1', 2,
          true, 'human_anonymous', 'excluded', ARRAY['promotion_rollback'],
          ARRAY[]::text[], 0, 1, 1, 1, $3::char(64),
          $1::timestamptz, $1::timestamptz, $2::timestamptz
        )`,
        [projectAt, expiresAt, "3".repeat(64)],
      )

      await expect(
        getLiveProfileCandidates(prisma, {
          sessionDigest,
          profileTokenDigest,
          context: {
            surface: "watch-below-player-v1",
            purpose: "watch",
            locale: "en",
            audioLanguageSlug: "english",
            seedMediaId: "profile-learning-seed",
            manifestId: "semantic-profile-hybrid-v1",
          },
          now: projectAt,
        }),
      ).rejects.toMatchObject({ code: "profile_lineage_ineligible" })

      const reconcileAt = new Date(projectAt.getTime() + 1_000)
      const replacement = await projectionService.project({
        sessionDigest,
        profileId: grant.profileId,
        privacyGeneration: grant.privacyGeneration,
        now: reconcileAt,
      })
      expect(replacement).toMatchObject({
        status: "published",
        generation: 2,
        replay: false,
      })
      await expect(
        prisma.recommendationProfileProjectionContribution.count({
          where: { generationId: replacement.generationId },
        }),
      ).resolves.toBe(0)
      await expect(
        prisma.recommendationProfileProjectionPointer.findFirstOrThrow({
          where: {
            profileId: grant.profileId,
            privacyGeneration: grant.privacyGeneration!,
          },
        }),
      ).resolves.toMatchObject({
        generationId: replacement.generationId,
        pointerGeneration: 2,
      })

      await expect(
        projectionService.project({
          sessionDigest,
          profileId: grant.profileId,
          privacyGeneration: grant.privacyGeneration,
          now: reconcileAt,
          expectedPointer: {
            generationId: receipt.generationId,
            pointerGeneration: 1,
          },
        }),
      ).rejects.toMatchObject({
        code: "profile_projection_pointer_fenced",
      })

      await expect(
        projectionService.project({
          sessionDigest,
          profileId: grant.profileId,
          privacyGeneration: grant.privacyGeneration,
          now: reconcileAt,
        }),
      ).resolves.toMatchObject({
        generationId: replacement.generationId,
        generation: 2,
        replay: true,
      })
    })

    it("fences a stale first publisher after another run creates the pointer", async () => {
      const projectionService =
        createDatabaseRecommendationProfileProjectionService(prisma)
      const input = {
        sessionDigest: "d".repeat(64),
        profileId: null,
        privacyGeneration: null,
        now: new Date(),
        expectedPointer: { generationId: null, pointerGeneration: 0 },
      } as const

      await expect(projectionService.project(input)).resolves.toMatchObject({
        status: "published",
        generation: 1,
      })
      await expect(projectionService.project(input)).rejects.toMatchObject({
        code: "profile_projection_pointer_fenced",
      })
    })
  },
)

// Kept in this CI database entry point so the scale regression runs on every
// Admin change, including sparse-invalid cohorts that tiny fixtures cannot model.
describe.skipIf(!RUN_REAL_DB_TEST)(
  "profile reconciliation at production scale",
  () => {
    const schema = `recommendation_reconcile_scale_${Date.now()}`
    const now = new Date("2026-09-21T00:00:00.000Z")
    let client: Client
    let prisma: PrismaClient
    beforeAll(async () => {
      if (
        !["localhost", "127.0.0.1", "::1"].includes(
          new URL(env.DATABASE_URL).hostname,
        )
      ) {
        throw new Error("This isolated fixture requires local Postgres")
      }
      client = new Client({ connectionString: env.DATABASE_URL })
      await client.connect()
      await client.query(`CREATE SCHEMA "${schema}"`)
      await client.query(`SET search_path TO "${schema}", public`)
      for (const migration of recommendationMigrations)
        await client.query(migration)
      await seedReconciliationScaleFixture(client)
      prisma = new PrismaClient({
        adapter: new PrismaPg(
          {
            connectionString: env.DATABASE_URL,
            max: 1,
            options: `-c search_path=${schema},public -c statement_timeout=5000`,
          },
          { schema },
        ),
      })
    }, 180_000)
    afterAll(async () => {
      await prisma?.$disconnect()
      if (!client) return
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await client.end()
    }, 30_000)
    it("completes the whole discovery transaction within its unchanged five-second budget", async () => {
      const before = await prisma.$queryRaw`SHOW jit`
      const start = performance.now()
      await expect(
        runRecommendationProfileReconciliationBatch({ prisma }, now),
      ).resolves.toMatchObject({
        locked: false,
        affectedPointers: 0,
        staleRuns: 0,
        rebuildsQueued: 0,
      })
      expect(performance.now() - start).toBeLessThan(5_000)
      expect(await prisma.$queryRaw`SHOW jit`).toEqual(before)
    }, 15_000)

    it("keeps the transaction budget under concurrent reads and durable writes", async () => {
      let stopped = false
      let writes = 0
      const workload = (async () => {
        while (!stopped) {
          await client.query(
            `SELECT contribution_count FROM recommendation_profile_projection_generation WHERE id='g-1'`,
          )
          await client.query(
            `UPDATE recommendation_profile SET updated_at=updated_at WHERE id='p-1'`,
          )
          writes++
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
      })()
      try {
        for (let i = 0; i < 3; i++) {
          await expect(
            runRecommendationProfileReconciliationBatch({ prisma }, now),
          ).resolves.toMatchObject({ affectedPointers: 0, locked: false })
        }
      } finally {
        stopped = true
        await workload
      }
      expect(writes).toBeGreaterThan(10)
    }, 20_000)

    it("keeps all four canonical lineage rules and selects only unfenced current pointers in order", async () => {
      // Source eligibility can change after publication; immutable projections
      // retain their exact original revision until replaced.
      await client.query(
        `UPDATE recommendation_eligibility_decision SET state='excluded' WHERE id='d-1'`,
      )
      await client.query(
        `UPDATE recommendation_eligibility_decision SET revision=2 WHERE id='d-4'`,
      )
      await client.query(
        `UPDATE recommendation_eligibility_decision SET expires_at=$1 WHERE id='d-7'`,
        [now.toISOString()],
      )
      await client.query(
        `UPDATE recommendation_eligibility_decision SET eligible_scopes='{}' WHERE id='d-10'`,
      )
      await client.query(
        `UPDATE recommendation_eligibility_decision SET is_current=false WHERE id='d-13'`,
      )
      await client.query(
        `DELETE FROM recommendation_profile_projection_contribution WHERE id='c-16'`,
      )
      // An unsupported durable ordinal and an unsupported session interest are
      // separate branches; neither changes the generation's contribution count.
      await client.query(`INSERT INTO recommendation_profile_interest
      SELECT (jsonb_populate_record(NULL::recommendation_profile_interest,
        to_jsonb(i) || jsonb_build_object('id','unsupported-durable','interest_ordinal',1))).*
      FROM recommendation_profile_interest i WHERE id='i-7'`)
      await client.query(`INSERT INTO recommendation_profile_interest
      SELECT (jsonb_populate_record(NULL::recommendation_profile_interest,
        to_jsonb(i) || jsonb_build_object('id','unsupported-session','kind','session'))).*
      FROM recommendation_profile_interest i WHERE id='i-8'`)
      const versions = [
        "projection_version",
        "eligibility_policy_version",
        "outcome_classifier_version",
      ]
      for (const [index, version] of versions.entries()) {
        const id = `obsolete-${index}`
        await client.query(
          `INSERT INTO recommendation_profile_projection_generation
        SELECT (jsonb_populate_record(NULL::recommendation_profile_projection_generation,
          to_jsonb(g) || $1::jsonb)).*
        FROM recommendation_profile_projection_generation g WHERE id='g-167000'`,
          [
            JSON.stringify({
              id,
              generation: index + 2,
              input_digest: String(index).repeat(64),
              [version]: "obsolete",
            }),
          ],
        )
      }
      const ids = [
        ...Array.from({ length: 9 }, (_, index) => `g-${index + 1}`),
        ...versions.map((_, index) => `obsolete-${index}`),
      ]
      const reference = await prisma.$queryRaw<
        Array<{ id: string }>
      >(Prisma.sql`
      SELECT generation.id FROM recommendation_profile_projection_generation generation
      WHERE generation.id IN (${Prisma.join(ids)})
        AND NOT ${profileLineageEligibleSql(Prisma.sql`generation.id`, now)}
      ORDER BY generation.id
    `)
      const batch = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL jit = off`
        return tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM (${profileIneligibleGenerationIdsSql(now)}) invalid ORDER BY id
      `)
      })
      expect(reference.map((row) => row.id)).toEqual([
        "g-1",
        "g-2",
        "g-3",
        "g-4",
        "g-5",
        "g-6",
        "g-7",
        "g-8",
        "obsolete-0",
        "obsolete-1",
        "obsolete-2",
      ])
      expect(batch).toEqual(reference)
      await client.query(`INSERT INTO recommendation_profile_projection_run
      (id,scope,profile_id,privacy_generation,state,expected_generation_id,expected_pointer_generation,workflow_run_id,expires_at)
      VALUES ('active','durable','p-1',1,'pending','g-1',1,'already-dispatched','2026-10-01'),
      ('stale-pointer','durable','p-2',1,'pending','g-2',2,'already-dispatched','2026-10-01')`)
      const dispatchProjection = vi.fn().mockResolvedValue({ queued: true })
      const result = await runRecommendationProfileReconciliationBatch(
        {
          prisma,
          classifyOutcome: async () => undefined,
          classifySelection: async () => undefined,
          dispatchProjection,
        },
        now,
      )
      expect(result).toMatchObject({
        affectedPointers: 7,
        rebuildsQueued: 7,
        dispatchFailures: 0,
      })
      const expected = await client.query<{ profile_id: string }>(
        `SELECT profile_id
      FROM recommendation_profile_projection_pointer WHERE generation_id=ANY($1)
      ORDER BY updated_at,scope_digest`,
        [Array.from({ length: 7 }, (_, i) => `g-${i + 2}`)],
      )
      expect(
        dispatchProjection.mock.calls.map(([input]) => input.profileId),
      ).toEqual(expected.rows.map((row) => row.profile_id))
      expect(
        dispatchProjection.mock.calls.every(
          ([input]) => input.sessionDigest != null,
        ),
      ).toBe(true)
    }, 30_000)

    it("retains the 100-pointer batch and 256-source bounds when many generations are invalid", async () => {
      await client.query(`UPDATE recommendation_eligibility_decision SET state='excluded'
        WHERE id IN (SELECT 'd-'||n FROM generate_series(301,690)n)`)
      const dispatchProjection = vi.fn().mockResolvedValue({ queued: true })
      const classifyOutcome = vi.fn().mockResolvedValue(undefined)
      const result = await runRecommendationProfileReconciliationBatch(
        {
          prisma,
          classifyOutcome,
          classifySelection: async () => undefined,
          dispatchProjection,
        },
        now,
      )
      expect(result).toMatchObject({
        affectedPointers: 100,
        rebuildsQueued: 100,
        classificationsAttempted: 256,
      })
      expect(classifyOutcome).toHaveBeenCalledTimes(256)
      const expected = await client.query<{ profile_id: string }>(
        `SELECT profile_id
        FROM recommendation_profile_projection_pointer
        WHERE generation_id=ANY($1) ORDER BY updated_at,scope_digest LIMIT 100`,
        [
          [
            ...Array.from({ length: 7 }, (_, i) => `g-${i + 2}`),
            ...Array.from({ length: 130 }, (_, i) => `g-${i + 101}`),
          ],
        ],
      )
      expect(
        dispatchProjection.mock.calls.map(([input]) => input.profileId),
      ).toEqual(expected.rows.map((row) => row.profile_id))
    }, 15_000)

    it("restores JIT after a blocked batch rolls back without dispatching work", async () => {
      const before = await prisma.$queryRaw`SHOW jit`
      const dispatchProjection = vi.fn()
      await client.query("BEGIN")
      await client.query(
        "LOCK TABLE recommendation_profile_projection_run IN ACCESS EXCLUSIVE MODE",
      )
      // A shorter test-only lock guard avoids spending five seconds exercising
      // PostgreSQL rollback. The production transaction deadline is unchanged.
      await prisma.$executeRaw`SET lock_timeout = '100ms'`
      try {
        await expect(
          runRecommendationProfileReconciliationBatch(
            { prisma, dispatchProjection },
            now,
          ),
        ).rejects.toMatchObject({ code: "P2010" })
        expect(dispatchProjection).not.toHaveBeenCalled()
        expect(await prisma.$queryRaw`SHOW jit`).toEqual(before)
      } finally {
        await client.query("ROLLBACK")
        await prisma.$executeRaw`RESET lock_timeout`
      }
    })
  },
)
