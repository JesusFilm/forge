import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { Client } from "pg"
import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { loadRecommendationPlaybackContextDetail } from "./admin-ops/playback-detail.service"
import { createRecommendationOutcomeService } from "./outcome.service"
import { evaluatePlaybackProxyReadiness } from "./playback-proxy-evaluation.service"
import { purgeExpiredRecommendationRequests } from "./retention.service"

const RUN_REAL_DB_TEST = env.RECOMMENDATION_DB_TEST === "1"
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
  "0065_recommendation_strategy_manifest_immutability",
  "0066_recommendation_playback_finalization_repair",
  "0067_recommendation_episode_submission_budget_repair",
  "0068_recommendation_trace_actor_digest_repair",
  "0069_recommendation_hybrid_composition",
  "0070_recommendation_consent_receipts",
  "0071_recommendation_assignment_generation_key",
  "0072_recommendation_source_neutral_playback",
].map((migration) =>
  readFileSync(
    new URL(
      `../../../prisma/migrations/${migration}/migration.sql`,
      import.meta.url,
    ),
    "utf8",
  ),
)

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

describe.skipIf(!RUN_REAL_DB_TEST)(
  "source-neutral playback migration against real PostgreSQL",
  () => {
    const schemaName = `recommendation_playback_context_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2)}`
    const expiresAt = "2026-09-30T00:00:00.000Z"
    let client: Client
    let concurrentClient: Client
    let prisma: PrismaClient

    beforeAll(async () => {
      client = new Client({ connectionString: env.DATABASE_URL })
      await client.connect()
      concurrentClient = new Client({ connectionString: env.DATABASE_URL })
      await concurrentClient.connect()
      await client.query(`CREATE SCHEMA "${schemaName}"`)
      await client.query(`SET search_path TO "${schemaName}", public`)
      for (const migration of migrations) await client.query(migration)
      await concurrentClient.query(`SET search_path TO "${schemaName}", public`)
      const fixtureUrl = new URL(env.DATABASE_URL)
      fixtureUrl.searchParams.set("schema", schemaName)
      prisma = new PrismaClient({
        datasources: { db: { url: fixtureUrl.toString() } },
      })
    })

    afterAll(async () => {
      if (!client) return
      await prisma?.$disconnect()
      await concurrentClient?.query("RESET search_path")
      await concurrentClient?.end()
      await client.query("RESET search_path")
      await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
      await client.end()
    })

    async function insertRecommendationLineage(prefix: string) {
      const requestId = `${prefix}-request`
      const itemId = `${prefix}-item`
      const selectionId = `${prefix}-selection`
      await client.query("BEGIN")
      await client.query(
        `INSERT INTO recommendation_request (
          id, contract_version, surface_version, manifest_id,
          strategy_version, classifier_version, session_digest,
          seed_media_id, locale, expected_item_count, result, expires_at
        ) VALUES (
          $1, 'semantic-recommendation-v1', 'watch-below-player-v1',
          'semantic-transcript-pgvector-v1', 'semantic-transcript-pgvector-v1',
          'legacy-position-v0', $2, 'seed-media', 'en', 1, 'served', $3
        )`,
        [requestId, digest(`${prefix}-session`), expiresAt],
      )
      await client.query(
        `INSERT INTO recommendation_served_item (
          id, request_id, position, target_media_id, canonical_href,
          candidate_generator, candidate_provenance, expires_at
        ) VALUES ($1, $2, 0, 'media-1', '/watch/media-1',
          'semantic', '{}'::jsonb, $3)`,
        [itemId, requestId, expiresAt],
      )
      await client.query(
        `INSERT INTO recommendation_selection (
          id, request_id, item_id, capability_jti, event_id, payload_digest,
          claim_nonce_digest, handoff_expires_at, occurred_at, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7,
          '2026-09-02T03:20:00.000Z', '2026-09-02T03:15:00.000Z', $8)`,
        [
          selectionId,
          requestId,
          itemId,
          `${prefix}-selection-jti`,
          `${prefix}-selection-event`,
          digest(`${prefix}-selection`),
          digest(`${prefix}-claim`),
          expiresAt,
        ],
      )
      await client.query("COMMIT")
      return { requestId, itemId, selectionId }
    }

    it("seeds source-neutral evidence disabled", async () => {
      const result = await client.query(
        `SELECT enabled, reason_code, version
         FROM recommendation_playback_evidence_control
         WHERE id = 'recommendation-playback-evidence-control'`,
      )
      expect(result.rows).toEqual([
        { enabled: false, reason_code: "bootstrap_disabled", version: 1 },
      ])
      const contributionConstraint = await client.query(
        `SELECT pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
         WHERE conname = 'recommendation_profile_contribution_kind_check'`,
      )
      expect(contributionConstraint.rows[0]?.definition).toContain(
        "source_outcome_id IS NOT NULL",
      )
    })

    it("bridges an N-1 recommendation episode writer", async () => {
      const lineage = await insertRecommendationLineage("legacy-writer")
      await client.query(
        `INSERT INTO recommendation_playback_episode (
          id, request_id, item_id, selection_id, media_id, session_digest,
          active_until, hard_until, expires_at
        ) VALUES ($1, $2, $3, $4, 'media-1', $5,
          '2026-09-02T04:15:00.000Z', '2026-09-02T06:15:00.000Z', $6)`,
        [
          "legacy-writer-episode",
          lineage.requestId,
          lineage.itemId,
          lineage.selectionId,
          digest("legacy-writer-session"),
          expiresAt,
        ],
      )
      const result = await client.query(
        `SELECT context.source, context.request_id, episode.context_id
         FROM recommendation_playback_episode episode
         JOIN recommendation_playback_context context
           ON context.id = episode.context_id
         WHERE episode.id = 'legacy-writer-episode'`,
      )
      expect(result.rows).toEqual([
        {
          source: "recommendation",
          request_id: lineage.requestId,
          context_id: "legacy-context:legacy-writer-episode",
        },
      ])
    })

    it("accepts every non-recommendation arrival source without fabricated attribution", async () => {
      const sources = [
        "search",
        "share",
        "acquisition",
        "editorial",
        "direct",
      ] as const
      for (const source of sources) {
        await client.query(
          `INSERT INTO recommendation_playback_context (
            id, contract_version, idempotency_key_digest, session_digest,
            media_id, source, source_ref_digest, generation, expires_at
          ) VALUES (
            $1, 'recommendation-playback-context-v1', $2, $3,
            $4, $5, $6, 1, $7
          )`,
          [
            `source-${source}-context`,
            digest(`source-${source}-key`),
            digest(`source-${source}-session`),
            `source-${source}-media`,
            source,
            source === "direct" ? null : digest(`source-${source}-ref`),
            expiresAt,
          ],
        )
        await client.query(
          `INSERT INTO recommendation_playback_episode (
            id, context_id, media_id, session_digest, active_until,
            hard_until, expires_at
          ) VALUES ($1, $2, $3, $4,
            '2026-09-04T00:00:00.000Z', '2026-09-05T00:00:00.000Z', $5
          )`,
          [
            `source-${source}-episode`,
            `source-${source}-context`,
            `source-${source}-media`,
            digest(`source-${source}-session`),
            expiresAt,
          ],
        )
      }
      const result = await client.query(
        `SELECT context.source, context.request_id, context.item_id,
          context.selection_id, count(episode.id)::int AS episodes
         FROM recommendation_playback_context context
         JOIN recommendation_playback_episode episode
           ON episode.context_id = context.id
         WHERE context.id LIKE 'source-%-context'
         GROUP BY context.source, context.request_id, context.item_id,
           context.selection_id
         ORDER BY context.source`,
      )
      expect(result.rows).toEqual(
        [...sources].map((source) => ({
          source,
          request_id: null,
          item_id: null,
          selection_id: null,
          episodes: 1,
        })),
      )
    })

    it("admits only one context under a concurrent idempotency race", async () => {
      const insert = (db: Client, id: string) =>
        db.query(
          `INSERT INTO recommendation_playback_context (
            id, contract_version, idempotency_key_digest, session_digest,
            media_id, source, generation, expires_at
          ) VALUES ($1, 'recommendation-playback-context-v1', $2, $3,
            'race-media', 'direct', 1, $4)`,
          [id, digest("race-key"), digest("race-session"), expiresAt],
        )
      const results = await Promise.allSettled([
        insert(client, "race-context-a"),
        insert(concurrentClient, "race-context-b"),
      ])
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1)
      expect(
        results.filter((result) => result.status === "rejected"),
      ).toHaveLength(1)
      const count = await client.query(
        `SELECT count(*)::int AS count
         FROM recommendation_playback_context
         WHERE session_digest = $1 AND media_id = 'race-media'`,
        [digest("race-session")],
      )
      expect(count.rows).toEqual([{ count: 1 }])
    })

    it("accepts direct episodes without recommendation attribution and cascades the context", async () => {
      await client.query(
        `INSERT INTO recommendation_playback_context (
          id, contract_version, idempotency_key_digest, session_digest,
          media_id, source, generation, expires_at
        ) VALUES (
          'direct-context', 'recommendation-playback-context-v1', $1, $2,
          'media-direct', 'direct', 1, $3
        )`,
        [digest("direct-key"), digest("direct-session"), expiresAt],
      )
      await client.query(
        `INSERT INTO recommendation_playback_episode (
          id, context_id, media_id, session_digest, active_until,
          hard_until, expires_at
        ) VALUES (
          'direct-episode', 'direct-context', 'media-direct', $1,
          '2026-09-02T04:15:00.000Z', '2026-09-02T06:15:00.000Z', $2
        )`,
        [digest("direct-session"), expiresAt],
      )
      await client.query(
        `INSERT INTO recommendation_playback_fact (
          id, episode_id, capability_jti, event_id, payload_digest,
          sequence, kind, occurred_at, expires_at
        ) VALUES (
          'direct-fact', 'direct-episode', 'direct-jti', 'direct-event', $1,
          1, 'playback_attempt', '2026-09-02T03:16:00.000Z', $2
        )`,
        [digest("direct-event"), expiresAt],
      )
      await client.query(
        `INSERT INTO recommendation_content_action (
          id, contract_version, session_digest, event_id, payload_digest,
          action_class, action_kind, actor_class, purpose, target_media_id,
          episode_id, occurred_at, expires_at
        ) VALUES (
          'direct-action', 'recommendation-content-action-v1', $1,
          'direct-action-event', $2, 'human_action', 'share',
          'human_anonymous', 'watch', 'media-direct', 'direct-episode',
          '2026-09-02T03:17:00.000Z', $3
        )`,
        [digest("direct-session"), digest("direct-action"), expiresAt],
      )
      await expect(
        client.query(
          `INSERT INTO recommendation_content_action (
            id, contract_version, session_digest, event_id, payload_digest,
            action_class, action_kind, actor_class, purpose, target_media_id,
            episode_id, occurred_at, expires_at
          ) VALUES (
            'invalid-direct-action', 'recommendation-content-action-v1', $1,
            'invalid-direct-action-event', $2, 'human_action', 'share',
            'human_anonymous', 'watch', 'wrong-media', 'direct-episode',
            '2026-09-02T03:17:00.000Z', $3
          )`,
          [
            digest("direct-session"),
            digest("invalid-direct-action"),
            expiresAt,
          ],
        ),
      ).rejects.toThrow(/content action must match playback episode/)

      await expect(
        client.query(
          `SELECT episode_id FROM recommendation_content_action
           WHERE id = 'direct-action'`,
        ),
      ).resolves.toMatchObject({ rows: [{ episode_id: "direct-episode" }] })

      await client.query(
        `DELETE FROM recommendation_playback_context WHERE id = 'direct-context'`,
      )
      const result = await client.query(
        `SELECT
          (SELECT count(*)::int FROM recommendation_playback_episode WHERE id = 'direct-episode') AS episodes,
          (SELECT count(*)::int FROM recommendation_playback_fact WHERE id = 'direct-fact') AS facts`,
      )
      expect(result.rows).toEqual([{ episodes: 0, facts: 0 }])
    })

    it("serializes racing finalizers and appends one revision per later watermark", async () => {
      await client.query(
        `INSERT INTO recommendation_playback_context (
          id, contract_version, idempotency_key_digest, session_digest,
          media_id, source, generation, created_at, expires_at
        ) VALUES (
          'finalizer-context', 'recommendation-playback-context-v1', $1, $2,
          'finalizer-media', 'direct', 1,
          '2026-08-31T03:00:00.000Z', $3
        )`,
        [digest("finalizer-key"), digest("finalizer-session"), expiresAt],
      )
      await client.query(
        `INSERT INTO recommendation_playback_episode (
          id, context_id, media_id, session_digest, state, active_until,
          hard_until, next_fact_sequence, generation, claimed_at, created_at,
          expires_at
        ) VALUES (
          'finalizer-episode', 'finalizer-context', 'finalizer-media', $1,
          'claimed', '2026-08-31T07:00:00.000Z',
          '2026-08-31T09:00:00.000Z', 4, 1,
          '2026-08-31T03:00:00.000Z', '2026-08-31T03:00:00.000Z', $2
        )`,
        [digest("finalizer-session"), expiresAt],
      )
      await client.query(
        `INSERT INTO recommendation_playback_fact (
          id, episode_id, capability_jti, event_id, payload_digest, sequence,
          kind, payload, occurred_at, received_at, expires_at
        ) VALUES
          (
            'finalizer-start', 'finalizer-episode', 'finalizer-jti',
            'finalizer-start-event', $1, 1, 'playback_start',
            '{"positionSeconds":0}'::jsonb,
            '2026-08-31T03:00:01.000Z', '2026-08-31T03:00:01.000Z', $4
          ),
          (
            'finalizer-active', 'finalizer-episode', 'finalizer-jti',
            'finalizer-active-event', $2, 2,
            'playback_active_visible_playing',
            '{"startedAt":"2026-08-31T03:00:01.000Z","endedAt":"2026-08-31T03:00:31.000Z","coverage":"complete"}'::jsonb,
            '2026-08-31T03:00:31.000Z', '2026-08-31T03:00:31.000Z', $4
          ),
          (
            'finalizer-end', 'finalizer-episode', 'finalizer-jti',
            'finalizer-end-event', $3, 3, 'playback_end',
            '{"reason":"ended","positionSeconds":30,"durationSeconds":120,"progress":0.25,"completed":false}'::jsonb,
            '2026-08-31T03:00:32.000Z', '2026-08-31T03:00:32.000Z', $4
          )`,
        [
          digest("finalizer-start"),
          digest("finalizer-active"),
          digest("finalizer-end"),
          expiresAt,
        ],
      )

      const outcomeService = createRecommendationOutcomeService(prisma)
      const first = await Promise.all([
        outcomeService.finalize({
          episodeId: "finalizer-episode",
          generation: 1,
        }),
        outcomeService.finalize({
          episodeId: "finalizer-episode",
          generation: 1,
        }),
      ])
      expect(first.map((result) => result.status).sort()).toEqual([
        "existing",
        "published",
      ])
      await expect(
        prisma.recommendationOutcomeRevision.count({
          where: { episodeId: "finalizer-episode" },
        }),
      ).resolves.toBe(2)

      await client.query(
        `INSERT INTO recommendation_playback_fact (
          id, episode_id, capability_jti, event_id, payload_digest, sequence,
          kind, payload, occurred_at, received_at, late, expires_at
        ) VALUES (
          'finalizer-late', 'finalizer-episode', 'finalizer-jti',
          'finalizer-late-event', $1, 4, 'playback_progress',
          '{"positionSeconds":45,"durationSeconds":120,"progress":0.375,"wallElapsedMilliseconds":45000}'::jsonb,
          '2026-08-31T03:00:45.000Z', '2026-08-31T03:01:00.000Z', true, $2
        )`,
        [digest("finalizer-late"), expiresAt],
      )
      await prisma.recommendationPlaybackEpisode.update({
        where: { id: "finalizer-episode" },
        data: { nextFactSequence: 5 },
      })
      await expect(
        outcomeService.finalize({
          episodeId: "finalizer-episode",
          generation: 1,
        }),
      ).resolves.toMatchObject({ status: "published", revision: 2 })
      await expect(
        outcomeService.finalize({
          episodeId: "finalizer-episode",
          generation: 1,
        }),
      ).resolves.toMatchObject({ status: "existing", revision: 2 })

      const revisions = await prisma.recommendationOutcomeRevision.findMany({
        where: { episodeId: "finalizer-episode" },
        orderBy: [{ classifierVersion: "asc" }, { revision: "asc" }],
      })
      expect(revisions).toHaveLength(4)
      expect(revisions.map((revision) => revision.revision)).toEqual([
        1, 2, 1, 2,
      ])
      expect(revisions.filter((revision) => revision.revision === 2)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ factWatermark: 4 }),
          expect.objectContaining({ factWatermark: 4 }),
        ]),
      )
    })

    it("rejects partial or fabricated recommendation attribution", async () => {
      await expect(
        client.query(
          `INSERT INTO recommendation_playback_context (
            id, contract_version, idempotency_key_digest, session_digest,
            media_id, source, request_id, generation, expires_at
          ) VALUES (
            'invalid-context', 'recommendation-playback-context-v1', $1, $2,
            'media-invalid', 'direct', 'fabricated-request', 1, $3
          )`,
          [digest("invalid-key"), digest("invalid-session"), expiresAt],
        ),
      ).rejects.toThrow("recommendation_playback_context_lineage_check")
    })

    it("reconciles missingness and legacy-versus-proxy sensitivity into aggregate-only readiness", async () => {
      await client.query(
        `INSERT INTO recommendation_playback_context (
          id, contract_version, idempotency_key_digest, session_digest,
          media_id, source, generation, created_at, expires_at
        ) VALUES (
          'evaluation-context', 'recommendation-playback-context-v1', $1, $2,
          'evaluation-media', 'direct', 1,
          '2026-09-02T03:15:00.000Z', $3
        )`,
        [digest("evaluation-key"), digest("evaluation-session"), expiresAt],
      )
      await client.query(
        `INSERT INTO recommendation_playback_episode (
          id, context_id, media_id, session_digest, state, active_until,
          hard_until, next_fact_sequence, generation, claimed_at,
          finalized_at, created_at, expires_at
        ) VALUES (
          'evaluation-episode', 'evaluation-context', 'evaluation-media', $1,
          'finalized', '2026-09-02T04:15:00.000Z',
          '2026-09-02T06:15:00.000Z', 2, 1,
          '2026-09-02T03:15:00.000Z', '2026-09-02T03:16:31.000Z',
          '2026-09-02T03:15:00.000Z', $2
        )`,
        [digest("evaluation-session"), expiresAt],
      )
      await client.query(
        `INSERT INTO recommendation_playback_fact (
          id, episode_id, capability_jti, event_id, payload_digest,
          sequence, kind, payload, occurred_at, received_at, expires_at
        ) VALUES (
          'evaluation-fact', 'evaluation-episode', 'evaluation-jti',
          'evaluation-event', $1, 1, 'playback_active_visible_playing',
          '{"startedAt":"2026-09-02T03:15:30.000Z","endedAt":"2026-09-02T03:16:00.000Z","coverage":"complete"}'::jsonb,
          '2026-09-02T03:16:00.000Z', '2026-09-02T03:16:00.000Z', $2
        )`,
        [digest("evaluation-event"), expiresAt],
      )
      await client.query(
        `INSERT INTO recommendation_outcome_revision (
          id, episode_id, classifier_version, fact_watermark, input_digest,
          revision, qualified_view, view_quality_weight,
          view_quality_weight_reason, active_playback_milliseconds,
          duration_seconds, duration_cohort, active_coverage, reasons,
          learning_eligible, generation, created_at, expires_at
        ) VALUES
          (
            'evaluation-legacy', 'evaluation-episode', 'legacy-position-v0',
            1, $1, 1, false, NULL, 'continuous_weight_not_available',
            NULL, NULL, NULL, NULL, ARRAY['position_below_threshold'],
            false, 1, '2026-09-02T03:16:31.000Z', $3
          ),
          (
            'evaluation-active', 'evaluation-episode', 'active-watch-proxy-v1',
            1, $2, 1, true, 0.25, 'active_fraction_of_duration',
            30000, 120, 'medium', 'complete',
            ARRAY['active_visible_playing_at_least_30_seconds'],
            false, 1, '2026-09-02T03:16:31.000Z', $3
          )`,
        [digest("evaluation-legacy"), digest("evaluation-active"), expiresAt],
      )
      await client.query(
        `INSERT INTO recommendation_retention_run (
          id, status, batch_size, roots_deleted, row_counts,
          started_at, completed_at, expires_at
        ) VALUES (
          'evaluation-retention', 'succeeded', 500, 0, '{}'::jsonb,
          '2026-09-02T23:59:00.000Z', '2026-09-02T23:59:30.000Z', $1
        )`,
        [expiresAt],
      )

      const detail = await loadRecommendationPlaybackContextDetail(prisma, {
        contextId: "evaluation-context",
        actorDigest: digest("evaluation-admin"),
        now: new Date("2026-09-03T00:00:00.000Z"),
      })
      expect(detail).toMatchObject({
        context: {
          id: "evaluation-context",
          source: "direct",
          recommendationAttributed: false,
          sourceReferencePresent: false,
          episode: { id: "evaluation-episode", facts: 1, outcomes: 2 },
        },
        facts: [
          {
            sequence: 1,
            startedAt: "2026-09-02T03:15:30.000Z",
            endedAt: "2026-09-02T03:16:00.000Z",
          },
        ],
        outcomes: [
          { classifierVersion: "legacy-position-v0", revision: 1 },
          {
            classifierVersion: "active-watch-proxy-v1",
            revision: 1,
            activePlaybackMilliseconds: 30_000,
            durationCohort: "medium",
            activeCoverage: "complete",
          },
        ],
      })
      await expect(
        prisma.recommendationTraceAccessAudit.count({
          where: { contextId: "evaluation-context" },
        }),
      ).resolves.toBe(1)

      const input = {
        windowStart: new Date("2026-09-01T00:00:00.000Z"),
        windowEnd: new Date("2026-09-03T00:00:00.000Z"),
        now: new Date("2026-09-03T00:00:00.000Z"),
      }
      const first = await evaluatePlaybackProxyReadiness(prisma, input)
      expect(first).toMatchObject({
        status: "published",
        evaluation: {
          revision: 1,
          policyVersion: "active-watch-proxy-readiness-v1",
          windowStart: input.windowStart,
          windowEnd: input.windowEnd,
          state: "revise",
          reasonCodes: ["active_coverage_below_95_percent"],
          counts: {
            finalizedTotal: 2,
            activeOutcomeTotal: 1,
            completeCoverage: 1,
            legacyQualifiedTotal: 0,
            proxyQualifiedTotal: 1,
            classificationDisagreements: 1,
          },
          cohorts: {
            medium: {
              total: 1,
              legacyQualified: 0,
              proxyQualified: 1,
              disagreements: 1,
            },
          },
          purpose: "offline_playback_proxy_readiness",
          identityClass: "aggregate_no_viewer_identity",
          accessClass: "recommendation_aggregate_readers",
          deletionBehavior: "scheduled_expiry",
          fallbackBehavior: "no_serving_effect",
          retentionDays: 365,
        },
      })
      await expect(
        evaluatePlaybackProxyReadiness(prisma, input),
      ).resolves.toMatchObject({
        status: "existing",
        evaluation: { id: first.evaluation.id },
      })
      expect(JSON.stringify(first.evaluation)).not.toMatch(
        /session|context|request|item|profile|capability|sourceRef|eventId/i,
      )
      await expect(
        client.query(
          `UPDATE recommendation_playback_proxy_evaluation
           SET state = 'inconclusive'
           WHERE id = $1`,
          [first.evaluation.id],
        ),
      ).rejects.toThrow(/immutable/)
    })

    it("purges an expired direct root and detaches its sanitized access audit", async () => {
      await client.query(
        `INSERT INTO recommendation_playback_context (
          id, contract_version, idempotency_key_digest, session_digest,
          media_id, source, generation, created_at, expires_at
        ) VALUES (
          'retention-direct-context', 'recommendation-playback-context-v1',
          $1, $2, 'retention-media', 'direct', 1,
          '2026-08-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z'
        )`,
        [digest("retention-key"), digest("retention-session")],
      )
      await client.query(
        `INSERT INTO recommendation_trace_access_audit (
          id, context_id, actor_digest, reason_code, accessed_at, expires_at
        ) VALUES (
          'retention-access-audit', 'retention-direct-context', $1,
          'trace_detail', '2026-08-01T01:00:00.000Z', $2
        )`,
        [digest("retention-actor"), expiresAt],
      )

      await expect(
        purgeExpiredRecommendationRequests(
          prisma,
          new Date("2026-09-03T00:00:00.000Z"),
          10,
        ),
      ).resolves.toMatchObject({
        status: "succeeded",
        rootsDeleted: 1,
        rowCounts: {
          expiredDirectPlaybackContexts: 1,
          playbackTraceAccessLinksCleared: 1,
        },
      })
      const result = await client.query(
        `SELECT
          (SELECT count(*)::int FROM recommendation_playback_context
            WHERE id = 'retention-direct-context') AS contexts,
          (SELECT context_id FROM recommendation_trace_access_audit
            WHERE id = 'retention-access-audit') AS audit_context_id`,
      )
      expect(result.rows).toEqual([{ contexts: 0, audit_context_id: null }])
    })
  },
)
