import { readdirSync, readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
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
import { getLiveProfileCandidates } from "../candidates/profile-candidate.service"
import { RecommendationProfileService } from "../profile.service"
import { createDatabaseRecommendationProfileProjectionService } from "./profile-projection.service"

const RUN_REAL_DB_TEST = env.RECOMMENDATION_DB_TEST === "1"
const migrationRoot = new URL("../../../../prisma/migrations/", import.meta.url)
const recommendationMigrations = readdirSync(migrationRoot)
  .filter((name) => {
    const ordinal = Number(name.slice(0, 4))
    return ordinal >= 52 && ordinal <= 72 && name.includes("recommendation")
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
          identity_concentration, decided_at, expires_at
        ) VALUES (
          'profile-learning-eligibility', 'playback_outcome',
          'profile-learning-outcome:recommendation-integrity-v1',
          'profile-learning-outcome', 'recommendation-integrity-v1', 1,
          true, 'human_anonymous', 'eligible', ARRAY['qualified_view'],
          ARRAY['profile'], 0.8, 1, 1, 1, $1, $2
        )`,
        [eventAt, expiresAt],
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

      const replayAt = new Date(projectAt.getTime() + 2_000)
      await admin.query(
        `UPDATE recommendation_profile_session_link
         SET expires_at = $1
         WHERE profile_id = $2 AND privacy_generation = $3`,
        [new Date(projectAt.getTime() + 1_000), grant.profileId, 1],
      )
      await expect(
        projectionService.project({
          sessionDigest,
          profileId: grant.profileId,
          privacyGeneration: grant.privacyGeneration,
          now: replayAt,
        }),
      ).resolves.toMatchObject({
        generationId: receipt.generationId,
        generation: 1,
        replay: true,
      })
    })
  },
)
