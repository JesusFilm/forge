import { createHash, randomUUID } from "node:crypto"
import { Prisma, PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { env } from "@/config/env"
import { recommendationRuntimeMigrationSql } from "../current-schema.test-fixture"
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
import { getRecommendationRecentContext } from "../recent-context.service"
import { RecommendationEpisodeService } from "../episode.service"
import { RecommendationPlaybackService } from "../playback.service"
import { RecommendationOutcomeService } from "../outcome.service"
import { RecommendationIntegrityService } from "../integrity.service"
import { lockRetentionRoots } from "../retention-locks"
import {
  createRecommendationTokenService,
  parseRecommendationKeyring,
} from "../token.service"
import { getLiveProfileCandidates } from "../candidates/profile-candidate.service"
import { RecommendationProfileService } from "../profile.service"
import { createDatabaseRecommendationProfileProjectionService } from "./profile-projection.service"
import {
  canSkipInitialEmptyProfileBootstrap,
  insertInitialProfileProjectionReservation,
  prepareInitialProfileProjectionReservation,
} from "./initial-bootstrap"
import { withRecommendationSerializableRetry } from "../transaction-retry"
import { prepareRecommendationProfileProjection } from "./job"
import { seedReconciliationScaleFixture } from "./reconciliation-scale.fixture"
import { proveProfileVectorSnapshotMigration } from "./profile-vector-snapshot.native-helper"
import { runRecommendationProfileReconciliationBatch } from "./reconciliation.service"
import {
  profileIneligibleGenerationIdsSql,
  profileLineageEligibleSql,
} from "./profile-lineage"

const RUN_REAL_DB_TEST = env.RECOMMENDATION_DB_TEST === "1"
const recommendationMigrations = recommendationRuntimeMigrationSql

const webCaller = {
  id: "forge-web",
  role: "CONSUMER_BEARER" as const,
  rateLimitBucketKey: "forge-web",
}

async function reserveInitialProfileProjectionForEligibleSource(
  tx: Prisma.TransactionClient,
  input: { sessionDigest: string; now: Date },
): Promise<boolean> {
  const reservation = await prepareInitialProfileProjectionReservation(
    tx,
    input,
  )
  if (!reservation) return false
  await insertInitialProfileProjectionReservation(tx, reservation)
  return true
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
      prisma = new PrismaClient({
        adapter: new PrismaPg(
          {
            connectionString: env.DATABASE_URL,
            options: `-c search_path=${schema},public`,
          },
          { schema },
        ),
      })
    })

    afterAll(async () => {
      await prisma?.$disconnect()
      if (!admin) return
      await admin.query("RESET search_path")
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await admin.end()
    })

    it("admits only an untouched source-free durable scope before raw feedback", async () => {
      const key = randomUUID()
      const digest = (name: string) =>
        createHash("sha256").update(`${key}:${name}`).digest("hex")
      const grantedAt = new Date()
      const sessionDigest = digest("session")
      const grant = await new RecommendationProfileService({
        prisma,
        now: () => grantedAt,
        newId: randomUUID,
        newAuditId: randomUUID,
      }).transition({
        caller: webCaller,
        contractVersion: "recommendation-profile-v1",
        consentContractVersion: "recommendation-consent-v1",
        action: "grant",
        consentChoice: "personalization",
        sessionDigest,
        existingConsentReceiptDigest: null,
        proposedConsentReceiptDigest: digest("consent"),
        existingProfileDigest: null,
        proposedProfileDigest: digest("profile"),
      })
      const scope = {
        profileId: grant.profileId!,
        privacyGeneration: grant.privacyGeneration!,
        sessionDigest,
        now: new Date(grantedAt.getTime() + 1_000),
      }
      await expect(
        prisma.$transaction((tx) =>
          reserveInitialProfileProjectionForEligibleSource(tx, {
            sessionDigest: digest("unlinked-session"),
            now: scope.now,
          }),
        ),
      ).resolves.toBe(false)
      await expect(
        prisma.$transaction((tx) =>
          canSkipInitialEmptyProfileBootstrap(tx, scope),
        ),
      ).resolves.toBe(true)
      await expect(
        prepareRecommendationProfileProjection(scope, false, prisma, true),
      ).resolves.toEqual({ kind: "initial_no_evidence" })
      expect(
        await prisma.recommendationProfileProjectionRun.count({
          where: { profileId: scope.profileId },
        }),
      ).toBe(0)
      expect(
        await prisma.recommendationProfileProjectionGeneration.count({
          where: { profileId: scope.profileId },
        }),
      ).toBe(0)

      const activeLink =
        await prisma.recommendationProfileSessionLink.findFirstOrThrow({
          where: { profileId: scope.profileId, sessionDigest },
        })
      await prisma.recommendationProfileSessionLink.delete({
        where: { id: activeLink.id },
      })
      await expect(
        prisma.$transaction((tx) =>
          canSkipInitialEmptyProfileBootstrap(tx, scope),
        ),
      ).resolves.toBe(false)
      await prisma.recommendationProfileSessionLink.create({ data: activeLink })
      await expect(
        prepareRecommendationProfileProjection(scope, false, prisma, false),
      ).resolves.toMatchObject({ kind: "prepared" })
      await prisma.recommendationProfileProjectionRun.deleteMany({
        where: { profileId: scope.profileId },
      })

      const episodeId = `bootstrap-episode-${key}`
      const expiresAt = new Date(scope.now.getTime() + 86_400_000)
      const activeUntil = new Date(scope.now.getTime() + 60_000)
      const hardUntil = new Date(scope.now.getTime() + 120_000)
      await admin.query(
        `INSERT INTO recommendation_playback_episode (
          id, media_id, session_digest, state, active_until, hard_until,
          next_fact_sequence, generation, claim_nonce_digest,
          handoff_expires_at, claimed_at, created_at, expires_at
        ) VALUES ($1, 'unembedded-source', $2, 'pending', $3, $4,
          1, 1, $5, $4, $6, $6, $7)`,
        [
          episodeId,
          sessionDigest,
          activeUntil,
          hardUntil,
          digest("episode"),
          scope.now,
          expiresAt,
        ],
      )
      await expect(
        prisma.$transaction((tx) =>
          canSkipInitialEmptyProfileBootstrap(tx, scope),
        ),
      ).resolves.toBe(false)
      await admin.query(
        `DELETE FROM recommendation_playback_episode WHERE id=$1`,
        [episodeId],
      )
      const manifestId = `bootstrap-manifest-${key}`
      const requestId = `bootstrap-request-${key}`
      const itemId = `bootstrap-item-${key}`
      await admin.query(
        `INSERT INTO recommendation_strategy_manifest (
          id, strategy_version, contract_version, surface_version, generator,
          max_items
        ) VALUES ($1, $1, 'semantic-recommendation-v1',
          'watch-below-player-v1', 'semantic', 6)`,
        [manifestId],
      )
      await admin.query("BEGIN")
      try {
        await admin.query(
          `INSERT INTO recommendation_request (
          id, contract_version, surface_version, manifest_id,
          strategy_version, classifier_version, session_digest,
          seed_media_id, locale, expected_item_count, state, result, delivery_jti,
          signing_kid, created_at, issued_at, expires_at
        ) VALUES ($1::text, 'semantic-recommendation-v1',
          'watch-below-player-v1', $2, $2, 'legacy-position-v0', $3,
          'seed', 'en', 1, 'issued', 'served', $1::text, 'test-kid', $4, $4, $5)`,
          [requestId, manifestId, sessionDigest, scope.now, expiresAt],
        )
        await admin.query(
          `INSERT INTO recommendation_served_item (
          id, request_id, position, target_media_id, canonical_href,
          candidate_generator, candidate_provenance, capability_jti,
          signing_kid, created_at, expires_at
        ) VALUES ($1::text, $2, 0, 'unembedded-source', '/watch/source.html',
          'semantic', '{}', $1::text, 'test-kid', $3, $4)`,
          [itemId, requestId, scope.now, expiresAt],
        )
        await admin.query(
          `INSERT INTO recommendation_selection (
          id, request_id, item_id, capability_jti, event_id,
          payload_digest, claim_nonce_digest, handoff_expires_at,
          occurred_at, expires_at
        ) VALUES ($1::text, $2, $3::text, $3::text, $1::text,
          $4, $4, $5, $5, $6)`,
          [
            `bootstrap-selection-${key}`,
            requestId,
            itemId,
            digest("selection"),
            scope.now,
            expiresAt,
          ],
        )
        await admin.query("COMMIT")
      } catch (error) {
        await admin.query("ROLLBACK")
        throw error
      }
      await expect(
        prisma.$transaction((tx) =>
          canSkipInitialEmptyProfileBootstrap(tx, scope),
        ),
      ).resolves.toBe(false)
      const pendingDecision = await new RecommendationIntegrityService({
        prisma,
        now: () => scope.now,
      }).classifySelection(`bootstrap-selection-${key}`)
      expect(pendingDecision.eligibleScopes).not.toContain("profile")
      expect(
        await prisma.recommendationProfileProjectionRun.count({
          where: { profileId: scope.profileId },
        }),
      ).toBe(0)
      await admin.query(`DELETE FROM recommendation_request WHERE id=$1`, [
        requestId,
      ])
      const failedRunId = `bootstrap-failed-${key}`
      await admin.query(
        `INSERT INTO recommendation_profile_projection_run (
          id, scope, profile_id, privacy_generation, session_digest,
          state, failure_reason, completed_at, expires_at
        ) VALUES ($1, 'durable', $2, $3, $4, 'failed',
          'projection_attempts_exhausted', $6, $5)`,
        [
          failedRunId,
          scope.profileId,
          scope.privacyGeneration,
          sessionDigest,
          expiresAt,
          scope.now,
        ],
      )
      await expect(
        prisma.$transaction((tx) =>
          canSkipInitialEmptyProfileBootstrap(tx, scope),
        ),
      ).resolves.toBe(false)
      await admin.query(
        `DELETE FROM recommendation_profile_projection_run WHERE id=$1`,
        [failedRunId],
      )
      await admin.query(
        `INSERT INTO recommendation_profile_projection_run (
          id, scope, profile_id, privacy_generation, session_digest,
          state, failure_reason, completed_at, expires_at
        ) VALUES ($1, 'durable', $2, $3, $4, 'fenced',
          'privacy_fence', $6, $5)`,
        [
          `bootstrap-fenced-${key}`,
          scope.profileId,
          scope.privacyGeneration,
          sessionDigest,
          expiresAt,
          scope.now,
        ],
      )
      await expect(
        prisma.$transaction((tx) =>
          canSkipInitialEmptyProfileBootstrap(tx, scope),
        ),
      ).resolves.toBe(false)
      await admin.query(
        `DELETE FROM recommendation_profile_projection_run WHERE id=$1`,
        [`bootstrap-fenced-${key}`],
      )

      const published =
        await createDatabaseRecommendationProfileProjectionService(
          prisma,
        ).project({ ...scope, now: new Date(scope.now.getTime() + 1_000) })
      expect(published.status).toBe("published")
      await expect(
        prisma.$transaction((tx) =>
          canSkipInitialEmptyProfileBootstrap(tx, scope),
        ),
      ).resolves.toBe(false)
      await prisma.recommendationProfileProjectionPointer.deleteMany({
        where: { profileId: scope.profileId },
      })
      await expect(
        prisma.$transaction((tx) =>
          canSkipInitialEmptyProfileBootstrap(tx, scope),
        ),
      ).resolves.toBe(false)

      const resetAt = new Date(scope.now.getTime() + 2_000)
      const profileService = new RecommendationProfileService({
        prisma,
        now: () => resetAt,
        newId: randomUUID,
        newAuditId: randomUUID,
      })
      const reset = await profileService.transition({
        caller: webCaller,
        contractVersion: "recommendation-profile-v1",
        consentContractVersion: "recommendation-consent-v1",
        action: "reset",
        consentChoice: "personalization",
        sessionDigest,
        existingConsentReceiptDigest: digest("consent"),
        proposedConsentReceiptDigest: digest("reset-consent"),
        existingProfileDigest: digest("profile"),
        proposedProfileDigest: digest("reset-profile"),
      })
      expect(reset.profileId).toBe(scope.profileId)
      const replacement = await prisma.recommendationProfile.findUniqueOrThrow({
        where: { tokenDigest: digest("reset-profile") },
      })
      await profileService.completeErasure({
        profileId: scope.profileId,
        privacyGeneration: scope.privacyGeneration,
      })
      await expect(
        prisma.$transaction((tx) =>
          canSkipInitialEmptyProfileBootstrap(tx, scope),
        ),
      ).resolves.toBe(false)
      await expect(
        prisma.$transaction((tx) =>
          canSkipInitialEmptyProfileBootstrap(tx, {
            ...scope,
            profileId: replacement.id,
            privacyGeneration: reset.privacyGeneration!,
            now: new Date(resetAt.getTime() + 1_000),
          }),
        ),
      ).resolves.toBe(true)
      await expect(
        prisma.$transaction((tx) =>
          reserveInitialProfileProjectionForEligibleSource(tx, {
            sessionDigest,
            now: scope.now,
          }),
        ),
      ).resolves.toBe(false)
      const replacementNow = new Date(resetAt.getTime() + 1_000)
      await prisma.recommendationProfileSessionLink.updateMany({
        where: { profileId: replacement.id },
        data: { expiresAt: replacementNow },
      })
      await expect(
        prisma.$transaction((tx) =>
          reserveInitialProfileProjectionForEligibleSource(tx, {
            sessionDigest,
            now: replacementNow,
          }),
        ),
      ).resolves.toBe(false)
      await prisma.recommendationProfileSessionLink.updateMany({
        where: { profileId: replacement.id },
        data: { expiresAt: new Date(replacementNow.getTime() + 86_400_000) },
      })
      await expect(
        prisma.$transaction((tx) =>
          reserveInitialProfileProjectionForEligibleSource(tx, {
            sessionDigest,
            now: replacementNow,
          }),
        ),
      ).resolves.toBe(true)
      await expect(
        prisma.$transaction((tx) =>
          reserveInitialProfileProjectionForEligibleSource(tx, {
            sessionDigest,
            now: replacementNow,
          }),
        ),
      ).resolves.toBe(false)
      const reservation =
        await prisma.recommendationProfileProjectionRun.findFirstOrThrow({
          where: { profileId: replacement.id },
        })
      const laterWatermark = new Date(replacementNow.getTime() + 4_000)
      await expect(
        prepareRecommendationProfileProjection(
          {
            profileId: replacement.id,
            privacyGeneration: reset.privacyGeneration,
            sessionDigest,
            now: new Date(laterWatermark.getTime() + 1_000),
            evidenceWatermark: laterWatermark,
            reconciliationCause: "evidence_advanced",
          },
          true,
          prisma,
          true,
        ),
      ).resolves.toMatchObject({
        kind: "prepared",
        run: { id: reservation.id },
        coalesced: false,
      })
      await createDatabaseRecommendationProfileProjectionService(
        prisma,
      ).project({
        profileId: replacement.id,
        privacyGeneration: reset.privacyGeneration,
        sessionDigest,
        now: new Date(laterWatermark.getTime() + 2_000),
      })
      const afterPublication = await prepareRecommendationProfileProjection(
        {
          profileId: replacement.id,
          privacyGeneration: reset.privacyGeneration,
          sessionDigest,
          now: new Date(laterWatermark.getTime() + 4_000),
          evidenceWatermark: new Date(laterWatermark.getTime() + 3_000),
          reconciliationCause: "evidence_advanced",
        },
        true,
        prisma,
        true,
      )
      expect(afterPublication.kind).toBe("prepared")
      if (afterPublication.kind === "prepared") {
        expect(afterPublication.run.id).not.toBe(reservation.id)
      }
    })

    it("serializes a source-free bootstrap with later feedback and refuses to skip a prior run", async () => {
      const key = randomUUID()
      const digest = (name: string) =>
        createHash("sha256").update(`${key}:${name}`).digest("hex")
      const grantedAt = new Date()
      const sessionDigest = digest("session")
      const grant = await new RecommendationProfileService({
        prisma,
        now: () => grantedAt,
        newId: randomUUID,
        newAuditId: randomUUID,
      }).transition({
        caller: webCaller,
        contractVersion: "recommendation-profile-v1",
        consentContractVersion: "recommendation-consent-v1",
        action: "grant",
        consentChoice: "personalization",
        sessionDigest,
        existingConsentReceiptDigest: null,
        proposedConsentReceiptDigest: digest("consent"),
        existingProfileDigest: null,
        proposedProfileDigest: digest("profile"),
      })
      const scope = {
        profileId: grant.profileId!,
        privacyGeneration: grant.privacyGeneration!,
        sessionDigest,
        now: new Date(grantedAt.getTime() + 1_000),
      }
      const scopeDigest = createHash("sha256")
        .update(`durable:${scope.profileId}:${scope.privacyGeneration}`)
        .digest("hex")
      let release!: () => void
      let observed!: () => void
      const releasePromise = new Promise<void>((resolve) => {
        release = resolve
      })
      const observedPromise = new Promise<void>((resolve) => {
        observed = resolve
      })
      const statusTransaction = prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${`profile-projection-dispatch:${scopeDigest}`}, 459)
          )
        `)
        const skipped = await canSkipInitialEmptyProfileBootstrap(tx, scope)
        observed()
        await releasePromise
        return skipped
      })
      await observedPromise

      // A raw source commits after the no-source read, before feedback can
      // take the same dispatch lock. The source has no eligibility yet.
      const eventAt = new Date(scope.now.getTime() + 1_000)
      const activeUntil = new Date(eventAt.getTime() + 60_000)
      const hardUntil = new Date(eventAt.getTime() + 120_000)
      const expiresAt = new Date(eventAt.getTime() + 86_400_000)
      await admin.query(
        `INSERT INTO recommendation_playback_episode (
          id, media_id, session_digest, state, active_until, hard_until,
          next_fact_sequence, generation, claim_nonce_digest,
          handoff_expires_at, claimed_at, created_at, expires_at
        ) VALUES ($1, 'unembedded-source', $2, 'pending', $3, $4,
          1, 1, $5, $4, $6, $6, $7)`,
        [
          `bootstrap-race-${key}`,
          sessionDigest,
          activeUntil,
          hardUntil,
          digest("episode"),
          eventAt,
          expiresAt,
        ],
      )
      const feedback = prepareRecommendationProfileProjection(
        {
          ...scope,
          evidenceWatermark: new Date(grantedAt.getTime() - 86_400_000),
          reconciliationCause: "evidence_advanced",
        },
        true,
        prisma,
        true,
      )
      release()
      await expect(statusTransaction).resolves.toBe(true)
      await expect(feedback).resolves.toMatchObject({ kind: "prepared" })
      expect(
        await prisma.recommendationProfileProjectionRun.count({
          where: {
            profileId: scope.profileId,
            privacyGeneration: scope.privacyGeneration,
          },
        }),
      ).toBe(1)

      const statusAfterFeedback = await prepareRecommendationProfileProjection(
        scope,
        false,
        prisma,
        true,
      )
      expect(statusAfterFeedback).toMatchObject({
        kind: "prepared",
        coalesced: false,
      })
    })

    it("coalesces status behind a feedback-first dispatch lock", async () => {
      const key = randomUUID()
      const digest = (name: string) =>
        createHash("sha256").update(`${key}:${name}`).digest("hex")
      const grantedAt = new Date()
      const sessionDigest = digest("session")
      const grant = await new RecommendationProfileService({
        prisma,
        now: () => grantedAt,
        newId: randomUUID,
        newAuditId: randomUUID,
      }).transition({
        caller: webCaller,
        contractVersion: "recommendation-profile-v1",
        consentContractVersion: "recommendation-consent-v1",
        action: "grant",
        consentChoice: "personalization",
        sessionDigest,
        existingConsentReceiptDigest: null,
        proposedConsentReceiptDigest: digest("consent"),
        existingProfileDigest: null,
        proposedProfileDigest: digest("profile"),
      })
      const scope = {
        profileId: grant.profileId!,
        privacyGeneration: grant.privacyGeneration!,
        sessionDigest,
        now: new Date(grantedAt.getTime() + 1_000),
      }
      const scopeDigest = createHash("sha256")
        .update(`durable:${scope.profileId}:${scope.privacyGeneration}`)
        .digest("hex")
      let locked!: () => void
      let release!: () => void
      const lockedPromise = new Promise<void>((resolve) => {
        locked = resolve
      })
      const releasePromise = new Promise<void>((resolve) => {
        release = resolve
      })
      const feedback = prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${`profile-projection-dispatch:${scopeDigest}`}, 459)
          )
        `)
        locked()
        await releasePromise
        return tx.recommendationProfileProjectionRun.create({
          data: {
            scope: "DURABLE",
            profileId: scope.profileId,
            privacyGeneration: scope.privacyGeneration,
            sessionDigest,
            reconciliationCause: "evidence_advanced",
            expiresAt: new Date(scope.now.getTime() + 86_400_000),
          },
        })
      })
      await lockedPromise
      const status = prepareRecommendationProfileProjection(
        scope,
        false,
        prisma,
        true,
      )
      await new Promise((resolve) => setTimeout(resolve, 25))
      release()
      const firstRun = await feedback
      await expect(status).resolves.toMatchObject({
        kind: "prepared",
        run: { id: firstRun.id },
        coalesced: false,
      })
      expect(
        await prisma.recommendationProfileProjectionRun.count({
          where: { profileId: scope.profileId },
        }),
      ).toBe(1)
    })

    it("retries a classifier snapshot older than a committed first status run", async () => {
      const key = randomUUID()
      const digest = (name: string) =>
        createHash("sha256").update(`${key}:${name}`).digest("hex")
      const grantedAt = new Date()
      const sessionDigest = digest("session")
      const grant = await new RecommendationProfileService({
        prisma,
        now: () => grantedAt,
        newId: randomUUID,
        newAuditId: randomUUID,
      }).transition({
        caller: webCaller,
        contractVersion: "recommendation-profile-v1",
        consentContractVersion: "recommendation-consent-v1",
        action: "grant",
        consentChoice: "personalization",
        sessionDigest,
        existingConsentReceiptDigest: null,
        proposedConsentReceiptDigest: digest("consent"),
        existingProfileDigest: null,
        proposedProfileDigest: digest("profile"),
      })
      const scope = {
        profileId: grant.profileId!,
        privacyGeneration: grant.privacyGeneration!,
        sessionDigest,
        now: new Date(grantedAt.getTime() + 1_000),
      }
      let observed!: () => void
      let release!: () => void
      const observedPromise = new Promise<void>((resolve) => {
        observed = resolve
      })
      const releasePromise = new Promise<void>((resolve) => {
        release = resolve
      })
      let attempts = 0
      const classifier = withRecommendationSerializableRetry(() =>
        prisma.$transaction(
          async (tx) => {
            attempts += 1
            await tx.recommendationProfileSessionLink.findFirstOrThrow({
              where: { profileId: scope.profileId, sessionDigest },
            })
            if (attempts === 1) {
              observed()
              await releasePromise
            }
            return prepareInitialProfileProjectionReservation(tx, scope)
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      )
      await observedPromise
      const status = await prepareRecommendationProfileProjection(
        scope,
        false,
        prisma,
        false,
      )
      expect(status.kind).toBe("prepared")
      release()
      await expect(classifier).resolves.toBeNull()
      expect(attempts).toBeGreaterThanOrEqual(2)
      expect(
        await prisma.recommendationProfileProjectionRun.count({
          where: { profileId: scope.profileId },
        }),
      ).toBe(1)
    })

    it("retries a classifier waiting behind a fenced first status run", async () => {
      const key = randomUUID()
      const digest = (name: string) =>
        createHash("sha256").update(`${key}:${name}`).digest("hex")
      const grantedAt = new Date()
      const sessionDigest = digest("session")
      const grant = await new RecommendationProfileService({
        prisma,
        now: () => grantedAt,
        newId: randomUUID,
        newAuditId: randomUUID,
      }).transition({
        caller: webCaller,
        contractVersion: "recommendation-profile-v1",
        consentContractVersion: "recommendation-consent-v1",
        action: "grant",
        consentChoice: "personalization",
        sessionDigest,
        existingConsentReceiptDigest: null,
        proposedConsentReceiptDigest: digest("consent"),
        existingProfileDigest: null,
        proposedProfileDigest: digest("profile"),
      })
      const profileId = grant.profileId!
      const privacyGeneration = grant.privacyGeneration!
      const now = new Date(grantedAt.getTime() + 1_000)
      const scopeDigest = createHash("sha256")
        .update(`durable:${profileId}:${privacyGeneration}`)
        .digest("hex")
      let locked!: () => void
      let observed!: () => void
      let release!: () => void
      const lockedPromise = new Promise<void>((resolve) => {
        locked = resolve
      })
      const observedPromise = new Promise<void>((resolve) => {
        observed = resolve
      })
      const releasePromise = new Promise<void>((resolve) => {
        release = resolve
      })
      const status = prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${`profile-projection-dispatch:${scopeDigest}`}, 459)
          )
        `)
        locked()
        await releasePromise
        // The same initial-run row-version fence used by prepare().
        await tx.$executeRaw(Prisma.sql`
          UPDATE recommendation_profile SET updated_at = updated_at
          WHERE id = ${profileId}
        `)
        return tx.recommendationProfileProjectionRun.create({
          data: {
            scope: "DURABLE",
            profileId,
            privacyGeneration,
            sessionDigest,
            expiresAt: new Date(now.getTime() + 86_400_000),
          },
        })
      })
      await lockedPromise
      let attempts = 0
      const classifier = withRecommendationSerializableRetry(() =>
        prisma.$transaction(
          async (tx) => {
            attempts += 1
            await tx.recommendationProfileSessionLink.findFirstOrThrow({
              where: { profileId, sessionDigest },
            })
            if (attempts === 1) observed()
            return prepareInitialProfileProjectionReservation(tx, {
              sessionDigest,
              now,
            })
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      )
      await observedPromise
      await new Promise((resolve) => setTimeout(resolve, 25))
      release()
      await status
      await expect(classifier).resolves.toBeNull()
      expect(attempts).toBeGreaterThanOrEqual(2)
      expect(
        await prisma.recommendationProfileProjectionRun.count({
          where: { profileId },
        }),
      ).toBe(1)
    })

    it("reserves one first run for two concurrent eligible source classifiers", async () => {
      const key = randomUUID()
      const digest = (name: string) =>
        createHash("sha256").update(`${key}:${name}`).digest("hex")
      const current = new Date()
      const sessionDigest = digest("session")
      const grant = await new RecommendationProfileService({
        prisma,
        now: () => current,
        newId: randomUUID,
        newAuditId: randomUUID,
      }).transition({
        caller: webCaller,
        contractVersion: "recommendation-profile-v1",
        consentContractVersion: "recommendation-consent-v1",
        action: "grant",
        consentChoice: "personalization",
        sessionDigest,
        existingConsentReceiptDigest: null,
        proposedConsentReceiptDigest: digest("consent"),
        existingProfileDigest: null,
        proposedProfileDigest: digest("profile"),
      })
      const expiresAt = new Date(current.getTime() + 7 * 86_400_000)
      const outcomes = [1, 2].map((ordinal) => ({
        episodeId: `bootstrap-concurrent-episode-${key}-${ordinal}`,
        outcomeId: `bootstrap-concurrent-outcome-${key}-${ordinal}`,
        mediaId: `bootstrap-concurrent-media-${key}-${ordinal}`,
      }))
      for (const source of outcomes) {
        await admin.query(
          `INSERT INTO recommendation_playback_episode (
            id, media_id, session_digest, state, active_until, hard_until,
            next_fact_sequence, generation, capability_jti, signing_kid,
            claimed_at, finalized_at, created_at, expires_at
          ) VALUES ($1::text,$2,$3,'finalized',$4,$5,1,1,$1::text,'test-kid',$6,$6,$6,$7)`,
          [
            source.episodeId,
            source.mediaId,
            sessionDigest,
            new Date(current.getTime() + 60_000),
            new Date(current.getTime() + 120_000),
            current,
            expiresAt,
          ],
        )
        await admin.query(
          `INSERT INTO recommendation_outcome_revision (
            id, episode_id, classifier_version, fact_watermark, input_digest,
            revision, qualified_view, view_quality_weight,
            view_quality_weight_reason, reasons, learning_eligible, generation,
            active_playback_milliseconds, duration_seconds, duration_cohort,
            active_coverage, created_at, expires_at
          ) VALUES ($1,$2,'active-watch-proxy-v1',0,$3,1,true,0.8,
            'active_fraction_of_duration',ARRAY['qualified_view'],false,1,
            60000,120,'medium','complete',$4,$5)`,
          [
            source.outcomeId,
            source.episodeId,
            digest(source.outcomeId),
            current,
            expiresAt,
          ],
        )
      }
      const scopeDigest = createHash("sha256")
        .update(`durable:${grant.profileId}:${grant.privacyGeneration}`)
        .digest("hex")
      let locked!: () => void
      let release!: () => void
      let holderPid = 0
      const lockedPromise = new Promise<void>((resolve) => {
        locked = resolve
      })
      const releasePromise = new Promise<void>((resolve) => {
        release = resolve
      })
      const holdScope = prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${`profile-projection-dispatch:${scopeDigest}`}, 459)
          )
        `)
        const [holder] = await tx.$queryRaw<Array<{ pid: number }>>`
          SELECT pg_backend_pid() AS pid
        `
        holderPid = holder!.pid
        locked()
        await releasePromise
      })
      await lockedPromise
      const service = new RecommendationIntegrityService({
        prisma,
        now: () => new Date(current.getTime() + 1_000),
      })
      const decisions = outcomes.map((source) =>
        service.classifyPlaybackOutcome(source.outcomeId),
      )
      try {
        let waiters = 0
        for (let attempt = 0; attempt < 50; attempt++) {
          const [row] = (
            await admin.query<{ waiters: number }>(
              `SELECT count(*)::integer AS waiters
               FROM pg_locks holder
               JOIN pg_locks waiter
                 ON waiter.locktype='advisory'
                AND NOT waiter.granted
                AND waiter.database IS NOT DISTINCT FROM holder.database
                AND waiter.classid=holder.classid
                AND waiter.objid=holder.objid
                AND waiter.objsubid=holder.objsubid
               WHERE holder.pid=$1 AND holder.locktype='advisory'
                 AND holder.granted`,
              [holderPid],
            )
          ).rows
          waiters = row?.waiters ?? 0
          if (waiters >= 2) break
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        expect(waiters).toBeGreaterThanOrEqual(2)
      } finally {
        release()
      }
      await holdScope
      const receipts = await Promise.all(decisions)
      expect(receipts.map((receipt) => receipt.eligibleScopes)).toEqual([
        expect.arrayContaining(["profile"]),
        expect.arrayContaining(["profile"]),
      ])
      expect(
        await prisma.recommendationEligibilityDecision.count({
          where: { id: { in: receipts.map((receipt) => receipt.id) } },
        }),
      ).toBe(2)
      expect(
        await prisma.recommendationProfileProjectionRun.count({
          where: { profileId: grant.profileId },
        }),
      ).toBe(1)
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
      await expect(
        prepareRecommendationProfileProjection(
          {
            sessionDigest,
            profileId: grant.profileId,
            privacyGeneration: grant.privacyGeneration,
            now: new Date(profile.createdAt.getTime() + 1),
          },
          false,
          prisma,
          true,
        ),
      ).resolves.toEqual({ kind: "initial_no_evidence" })
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
      if (env.RECOMMENDATION_PROFILE_VECTOR_SHARING === "true") {
        expect(interests[0]?.vectorDigest).toMatch(/^[a-f0-9]{64}$/)
        const [stored] = await prisma.$queryRaw<
          Array<{ matchesContentVector: boolean; inlineAbsent: boolean }>
        >(Prisma.sql`
          SELECT
            public.vector_send(snapshot.embedding) =
              public.vector_send(content.embedding) AS "matchesContentVector",
            interest.embedding IS NULL AS "inlineAbsent"
          FROM recommendation_profile_interest interest
          JOIN recommendation_profile_vector_snapshot snapshot
            ON snapshot.digest = interest.vector_digest
          JOIN LATERAL (
            SELECT public.avg(chunk.embedding) AS embedding
            FROM video_transcript transcript
            JOIN video_transcript_chunk chunk
              ON chunk.transcript_id = transcript.id
            WHERE transcript.video_id = interest.medoid_media_id
          ) content ON true
          WHERE interest.id = ${interests[0]!.id}
        `)
        expect(stored).toEqual({
          matchesContentVector: true,
          inlineAbsent: true,
        })
        await expect(
          admin.query(
            `UPDATE recommendation_profile_vector_snapshot
             SET created_at = now()
             WHERE digest = $1`,
            [interests[0]!.vectorDigest],
          ),
        ).rejects.toThrow(/immutable/)
        await expect(
          admin.query(
            `DELETE FROM recommendation_profile_vector_snapshot
             WHERE digest = $1`,
            [interests[0]!.vectorDigest],
          ),
        ).rejects.toThrow(/foreign key constraint/)
      } else {
        expect(interests[0]?.vectorDigest).toBeNull()
      }
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
          locale: "en",
          sessionDigest,
          profileTokenDigest,
          now: projectAt,
        }),
      ).toEqual([
        {
          mediaId: "profile-learning-source",
          videoCoreId: "profile-learning-core-0",
          videoTitle: "Profile learning video 0",
          completed: false,
          qualified: true,
          recentlyTried: false,
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

    it.each([
      "direct",
      "search",
      "share",
      "acquisition",
      "editorial",
      "recommendation",
    ] as const)(
      "learns from %s playback without requiring a recommendation impression",
      async (source) => {
        const digest = (label: string) =>
          createHash("sha256").update(`${source}-${label}`).digest("hex")
        const sessionDigest = digest("session")
        const profileTokenDigest = digest("profile")
        let current = new Date()
        const grant = await new RecommendationProfileService({
          prisma,
          now: () => current,
          newId: randomUUID,
          newAuditId: randomUUID,
        }).transition({
          caller: webCaller,
          contractVersion: "recommendation-profile-v1",
          consentContractVersion: "recommendation-consent-v1",
          action: "grant",
          consentChoice: "personalization",
          sessionDigest,
          existingConsentReceiptDigest: null,
          proposedConsentReceiptDigest: digest("consent"),
          existingProfileDigest: null,
          proposedProfileDigest: profileTokenDigest,
        })
        current = new Date(Date.now() + 1_000)
        const startedAt = current
        const keyring = parseRecommendationKeyring(
          JSON.stringify({
            keys: [
              {
                kid: "source-parity",
                status: "active",
                key: Buffer.alloc(32, 7).toString("base64url"),
              },
            ],
          }),
        )
        const tokenService = {
          activeKid: keyring.active.kid,
          ...createRecommendationTokenService({
            keyring,
            readRevokedKids: async () => [],
            now: () => current,
          }),
        }
        const episodes = new RecommendationEpisodeService({
          prisma,
          tokenService,
          now: () => current,
        })
        let claimNonce: string
        if (source === "recommendation") {
          const id = randomUUID()
          const expiry = new Date(current.getTime() + 7 * 86_400_000)
          await admin.query(
            `INSERT INTO recommendation_strategy_manifest (id, strategy_version, contract_version, surface_version, generator, max_items)
            VALUES ($1::text, $1::text, 'semantic-recommendation-v1', 'watch-below-player-v1', 'semantic', 6)`,
            [id],
          )
          await admin.query("BEGIN")
          try {
            await admin.query(
              `INSERT INTO recommendation_request (id, contract_version, surface_version, manifest_id, strategy_version, classifier_version,
            session_digest, seed_media_id, locale, expected_item_count, state, result, delivery_jti, signing_kid, created_at, issued_at, expires_at)
            VALUES ($1::text, 'semantic-recommendation-v1', 'watch-below-player-v1', $1::text, $1::text, 'legacy-position-v0', $2, 'seed', 'en', 1, 'issued', 'served', $1::text, 'source-parity', $3, $3, $4)`,
              [id, sessionDigest, current, expiry],
            )
            await admin.query(
              `INSERT INTO recommendation_served_item (id, request_id, position, target_media_id, canonical_href, candidate_generator, candidate_provenance,
            capability_jti, signing_kid, created_at, expires_at) VALUES ($1::text, $1::text, 0, 'profile-learning-source', '/watch/source.html', 'semantic', '{}', $1::text, 'source-parity', $2, $3)`,
              [id, current, expiry],
            )
            await admin.query("COMMIT")
          } catch (error) {
            await admin.query("ROLLBACK")
            throw error
          }
          const capability = await tokenService.signDeliveryCapability({
            jti: id,
            requestId: id,
            itemId: id,
            sessionDigest,
            surface: "watch-below-player-v1",
            manifestId: id,
          })
          claimNonce = randomUUID()
          await episodes.select({
            caller: webCaller,
            contractVersion: "recommendation-evidence-v1",
            capability,
            requestId: id,
            itemId: id,
            sessionDigest,
            eventId: randomUUID(),
            occurredAt: current.toISOString(),
            claimNonce,
          })
          expect(
            await prisma.recommendationSelection.findFirst({
              where: { requestId: id },
            }),
          ).toMatchObject({ attributionEligibleAt: null })
        } else {
          claimNonce = (
            await episodes.issueContext({
              caller: webCaller,
              sessionDigest,
              mediaId: "profile-learning-source",
              discoverySource: source,
            })
          ).claimNonce
        }
        const claim = await episodes.claim({
          caller: webCaller,
          sessionDigest,
          mediaId: "profile-learning-source",
          claimNonce,
        })
        const playback = new RecommendationPlaybackService({
          prisma,
          tokenService,
          now: () => current,
        })
        const record = {
          caller: webCaller,
          contractVersion: "recommendation-evidence-v1",
          capability: claim.capability,
          episodeId: claim.episodeId,
          sessionDigest,
          mediaId: "profile-learning-source",
        }
        current = new Date(startedAt.getTime() + 20_000)
        await playback.record({
          ...record,
          events: [
            {
              eventId: "start",
              kind: "playback_start",
              occurredAt: startedAt.toISOString(),
              payload: { positionSeconds: 0 },
            },
            {
              eventId: "short",
              kind: "playback_active_visible_playing",
              occurredAt: current.toISOString(),
              payload: { activeMilliseconds: 20_000, coverage: "complete" },
            },
          ],
        })
        const history = await getUserWatchHistory(prisma, {
          locale: "en",
          sessionDigest,
          profileTokenDigest,
          now: current,
        })
        expect(history).toEqual([
          expect.objectContaining({
            mediaId: "profile-learning-source",
            recentlyTried: true,
            qualified: false,
          }),
        ])
        expect(
          (
            await getRecommendationRecentContext(prisma, {
              locale: "en",
              sessionDigest,
              profileTokenDigest,
              allowDurableProfileLinks: true,
              now: current,
            })
          ).videos,
        ).toContainEqual(
          expect.objectContaining({
            targetMediaId: "profile-learning-source",
            reasonCodes: ["recently_tried"],
          }),
        )
        expect(
          await prisma.recommendationOutcomeRevision.count({
            where: { episodeId: claim.episodeId },
          }),
        ).toBe(0)

        current = new Date(startedAt.getTime() + 60_000)
        await playback.record({
          ...record,
          events: [
            {
              eventId: "long",
              kind: "playback_active_visible_playing",
              occurredAt: current.toISOString(),
              payload: { activeMilliseconds: 40_000, coverage: "complete" },
            },
            {
              eventId: "end",
              kind: "playback_end",
              occurredAt: current.toISOString(),
              payload: {
                reason: "route_exit",
                positionSeconds: 60,
                durationSeconds: 600,
                progress: 0.1,
                completed: false,
              },
            },
          ],
        })
        await new RecommendationOutcomeService({
          prisma,
          now: () => current,
        }).finalize({
          episodeId: claim.episodeId,
          generation: 1,
          reason: "terminal-fact",
        })
        const outcome =
          await prisma.recommendationOutcomeRevision.findFirstOrThrow({
            where: {
              episodeId: claim.episodeId,
              classifierVersion: "active-watch-proxy-v1",
            },
          })
        expect(outcome).toMatchObject({
          qualifiedView: true,
          activePlaybackMilliseconds: 60_000,
        })
        expect(
          await new RecommendationIntegrityService({
            prisma,
            now: () => current,
          }).classifyPlaybackOutcome(outcome.id),
        ).toMatchObject({
          state: "eligible",
          eligibleScopes: expect.arrayContaining(["profile"]),
        })
        if (source === "direct") {
          const initialReservation =
            await prisma.recommendationProfileProjectionRun.findFirstOrThrow({
              where: { profileId: grant.profileId },
            })
          expect(initialReservation).toMatchObject({
            state: "PENDING",
            workflowRunId: null,
            reconciliationCause: "evidence_advanced",
          })
          await prisma.recommendationProfileProjectionRun.delete({
            where: { id: initialReservation.id },
          })
          const replay = await new RecommendationIntegrityService({
            prisma,
            now: () => current,
          }).classifyPlaybackOutcome(outcome.id)
          expect(replay.revision).toBe(1)
          const reserved =
            await prisma.recommendationProfileProjectionRun.findFirstOrThrow({
              where: { profileId: grant.profileId },
            })
          expect(reserved.id).not.toBe(initialReservation.id)
          const failedStart = await runRecommendationProfileReconciliationBatch(
            {
              prisma,
              classifyOutcome: async () => undefined,
              classifySelection: async () => undefined,
              redispatchRun: async () => {
                throw new Error("workflow start unavailable")
              },
            },
            current,
          )
          expect(failedStart.staleRuns).toBeGreaterThanOrEqual(1)
          expect(failedStart.dispatchFailures).toBeGreaterThanOrEqual(1)
          const redispatchRun = vi.fn().mockResolvedValue(true)
          const recovered = await runRecommendationProfileReconciliationBatch(
            {
              prisma,
              classifyOutcome: async () => undefined,
              classifySelection: async () => undefined,
              redispatchRun,
            },
            current,
          )
          expect(recovered.staleRunsQueued).toBeGreaterThanOrEqual(1)
          expect(redispatchRun).toHaveBeenCalledWith(
            expect.objectContaining({ runId: reserved.id }),
          )
          await prisma.recommendationPlaybackEpisode.update({
            where: { id: claim.episodeId },
            data: { replayCount: 1 },
          })
          let locked!: () => void
          let release!: () => void
          let retentionPid = 0
          const lockedPromise = new Promise<void>((resolve) => {
            locked = resolve
          })
          const releasePromise = new Promise<void>((resolve) => {
            release = resolve
          })
          const retention = prisma.$transaction(async (tx) => {
            await lockRetentionRoots(tx, {
              profileIds: [grant.profileId!],
              episodeIds: [claim.episodeId],
            })
            const [holder] = await tx.$queryRaw<Array<{ pid: number }>>`
              SELECT pg_backend_pid() AS pid
            `
            retentionPid = holder!.pid
            locked()
            await releasePromise
          })
          await lockedPromise
          let classified = false
          const reclassification = new RecommendationIntegrityService({
            prisma,
            now: () => current,
          })
            .classifyPlaybackOutcome(outcome.id)
            .finally(() => {
              classified = true
            })
          try {
            let blockedOnProfile = false
            for (let attempt = 0; attempt < 50; attempt++) {
              const [row] = (
                await admin.query<{ blocked_on_profile: boolean }>(
                  `SELECT EXISTS (
                     SELECT 1 FROM pg_stat_activity activity
                     WHERE activity.datname = current_database()
                       AND $1::integer = ANY(pg_blocking_pids(activity.pid))
                       AND activity.query ILIKE '%FOR SHARE OF profile, link%'
                   ) AS blocked_on_profile`,
                  [retentionPid],
                )
              ).rows
              blockedOnProfile = row!.blocked_on_profile
              if (blockedOnProfile) break
              await new Promise((resolve) => setTimeout(resolve, 10))
            }
            expect(blockedOnProfile).toBe(true)
            expect(classified).toBe(false)
          } finally {
            release()
          }
          await retention
          await expect(reclassification).resolves.toMatchObject({
            state: "eligible",
            revision: 2,
          })
          expect(
            await prisma.recommendationProfileProjectionRun.count({
              where: { profileId: grant.profileId },
            }),
          ).toBe(1)
        }
        const projection =
          await createDatabaseRecommendationProfileProjectionService(
            prisma,
          ).project({
            sessionDigest,
            profileId: grant.profileId,
            privacyGeneration: grant.privacyGeneration,
            now: current,
          })
        expect(
          await prisma.recommendationProfileProjectionGeneration.findUniqueOrThrow(
            { where: { id: projection.generationId } },
          ),
        ).toMatchObject({
          state: "PUBLISHED",
          durableInterestCount: 1,
          contributionCount: 1,
          sessionIntentPresent: false,
        })
        expect(
          await prisma.recommendationProfileProjectionContribution.findMany({
            where: { generationId: projection.generationId },
          }),
        ).toEqual([
          expect.objectContaining({
            sourceOutcomeId: outcome.id,
            targetMediaId: "profile-learning-source",
            kind: "QUALIFIED_OUTCOME",
          }),
        ])
        expect(
          await getLiveProfileCandidates(prisma, {
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
            now: current,
          }),
        ).toMatchObject({
          projection: { qualifiedInterestCount: 1 },
          nominations: expect.arrayContaining([
            expect.objectContaining({
              targetMediaId: "profile-learning-similar",
            }),
          ]),
        })
      },
    )

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
      let reconciling = false
      let writes = 0
      let overlappingWrites = 0
      const workload = (async () => {
        while (!stopped) {
          const read = await client.query(
            `SELECT contribution_count FROM recommendation_profile_projection_generation WHERE id='g-1'`,
          )
          expect(read.rows).toHaveLength(1)
          const write = await client.query(
            `UPDATE recommendation_profile SET updated_at=updated_at WHERE id='p-1'`,
          )
          expect(write.rowCount).toBe(1)
          writes++
          if (reconciling) overlappingWrites++
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
      })()
      try {
        // Keep the load running until it has completed the required work during
        // reconciliation. A fixed three-pass window makes faster batches fail
        // merely because the independent writer has less time to finish.
        for (let i = 0; i < 3 || overlappingWrites <= 10; i++) {
          const start = performance.now()
          reconciling = true
          await expect(
            runRecommendationProfileReconciliationBatch({ prisma }, now),
          ).resolves.toMatchObject({ affectedPointers: 0, locked: false })
          reconciling = false
          expect(performance.now() - start).toBeLessThan(5_000)
        }
      } finally {
        reconciling = false
        stopped = true
        await workload
      }
      expect(writes).toBeGreaterThan(10)
      expect(overlappingWrites).toBeGreaterThan(10)
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

describe.skipIf(!RUN_REAL_DB_TEST)("profile vector snapshot migration", () => {
  it("preserves legacy rows and exact shared-vector retention invariants", async () => {
    await proveProfileVectorSnapshotMigration(env.DATABASE_URL)
  })
})
