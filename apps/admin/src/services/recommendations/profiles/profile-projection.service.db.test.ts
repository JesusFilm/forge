import { readdirSync, readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
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

async function installCatalogFixture(client: Client): Promise<void> {
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
        $1, $2, $3, 'en', 'jesus-film-ai-gateway', 'embeddings',
        1536, 1536, NULL
      )`,
      [transcriptId, video.id, editionId],
    )
    await client.query(
      `INSERT INTO video_transcript_chunk (
        id, transcript_id, language, model, dimensions, chunk_index,
        content_summary, raw_source_text, text, start_seconds, end_seconds,
        felt_needs, demographics, spiritual_context, embedding
      ) VALUES (
        $1, $2, 'en', 'embeddings', 1536, 0, $3, $3, $3, 0, 60,
        ARRAY['hope'], ARRAY['general'], ARRAY['curious'], $4::public.vector
      )`,
      [
        `profile-learning-chunk-${index}`,
        transcriptId,
        `Profile learning fixture ${index}`,
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

    it("projects a qualified direct-playback outcome and uses it in the next profile retrieval", async () => {
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
        `INSERT INTO recommendation_playback_context (
          id, contract_version, idempotency_key_digest, session_digest,
          media_id, source, generation, created_at, expires_at
        ) VALUES (
          'profile-learning-context', 'recommendation-playback-context-v1',
          $1, $2, 'profile-learning-source', 'direct', 1, $3, $4
        )`,
        ["d".repeat(64), sessionDigest, eventAt, expiresAt],
      )
      await admin.query(
        `INSERT INTO recommendation_playback_episode (
          id, context_id, media_id, session_digest,
          state, active_until, hard_until, next_fact_sequence, generation,
          claimed_at, finalized_at, created_at, expires_at
        ) VALUES (
          'profile-learning-episode', 'profile-learning-context',
          'profile-learning-source', $1, 'finalized', $2, $3, 2, 1,
          $4, $4, $4, $5
        )`,
        [sessionDigest, activeUntil, hardUntil, eventAt, expiresAt],
      )
      await admin.query(
        `INSERT INTO recommendation_playback_fact (
          id, episode_id, capability_jti, event_id,
          payload_digest, sequence, kind, payload, occurred_at, received_at,
          expires_at
        ) VALUES (
          'profile-learning-fact', 'profile-learning-episode',
          'profile-learning-playback-jti', 'profile-learning-playback-event',
          $1, 1, 'progress', '{"activeMilliseconds":60000}'::jsonb,
          $2, $2, $3
        )`,
        ["f".repeat(64), eventAt, expiresAt],
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
          'active-watch-proxy-v1', 1, $1, 1, true, 0.8,
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
        sessionIntentPresent: true,
        contributionCount: 2,
      })
      expect(interests.map((interest) => interest.kind).sort()).toEqual([
        "DURABLE",
        "SESSION",
      ])
      expect(
        contributions.map((contribution) => contribution.kind).sort(),
      ).toEqual(["QUALIFIED_OUTCOME", "SESSION_SELECTION"])
      expect(
        contributions.find(
          (contribution) => contribution.kind === "QUALIFIED_OUTCOME",
        ),
      ).toMatchObject({
        sourceOutcomeId: "profile-learning-outcome",
        targetMediaId: "profile-learning-source",
        privacyGeneration: 1,
      })
      expect(
        contributions.find(
          (contribution) => contribution.kind === "SESSION_SELECTION",
        ),
      ).toMatchObject({
        sourceOutcomeId: "profile-learning-outcome",
        sourceSelectionId: null,
        targetMediaId: "profile-learning-source",
        privacyGeneration: null,
      })
      expect(pointer).toMatchObject({
        generationId: receipt.generationId,
        pointerGeneration: 1,
      })
      await expect(
        projectionService.project({
          sessionDigest,
          profileId: grant.profileId,
          privacyGeneration: grant.privacyGeneration,
          now: projectAt,
        }),
      ).resolves.toMatchObject({
        generationId: receipt.generationId,
        generation: 1,
        replay: true,
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
        interestCount: 2,
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

      const removalAt = new Date(projectAt.getTime() + 2_000)
      await admin.query(
        `INSERT INTO recommendation_outcome_revision (
          id, episode_id, classifier_version, fact_watermark, input_digest,
          revision, supersedes_id, qualified_view, view_quality_weight,
          view_quality_weight_reason, reasons, learning_eligible, generation,
          active_playback_milliseconds, duration_seconds, duration_cohort,
          active_coverage, created_at, expires_at
        ) VALUES (
          'profile-learning-outcome-revision-2', 'profile-learning-episode',
          'active-watch-proxy-v1', 2, $1, 2, 'profile-learning-outcome',
          false, 0.1, 'active_fraction_of_duration',
          ARRAY['below_active_playback_threshold'], false, 1,
          12000, 120, 'medium', 'complete', $2, $3
        )`,
        ["2".repeat(64), removalAt, expiresAt],
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
          identity_concentration, decided_at, expires_at
        ) VALUES (
          'profile-learning-eligibility-revision-2', 'playback_outcome',
          'profile-learning-outcome-revision-2:recommendation-integrity-v1',
          'profile-learning-outcome-revision-2',
          'recommendation-integrity-v1', 1, true, 'human_anonymous',
          'excluded', ARRAY['below_active_playback_threshold'], ARRAY[]::text[],
          0, 1, 1, 1, $1, $2
        )`,
        [removalAt, expiresAt],
      )

      const removed = await projectionService.project({
        sessionDigest,
        profileId: grant.profileId,
        privacyGeneration: grant.privacyGeneration,
        now: new Date(removalAt.getTime() + 1_000),
      })
      expect(removed).toMatchObject({
        status: "published",
        generation: 2,
        replay: false,
      })
      await expect(
        prisma.recommendationProfileProjectionGeneration.findUniqueOrThrow({
          where: { id: removed.generationId },
        }),
      ).resolves.toMatchObject({
        contributionCount: 0,
        durableInterestCount: 0,
        sessionIntentPresent: false,
      })
      await expect(
        prisma.recommendationProfileProjectionContribution.count({
          where: { generationId: removed.generationId },
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
        generationId: removed.generationId,
        pointerGeneration: 2,
      })
      await expect(
        projectionService.project({
          sessionDigest,
          profileId: grant.profileId,
          privacyGeneration: grant.privacyGeneration,
          now: new Date(removalAt.getTime() + 1_000),
        }),
      ).resolves.toMatchObject({
        generationId: removed.generationId,
        generation: 2,
        replay: true,
      })
    })
  },
)
