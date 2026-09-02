import { readFileSync } from "node:fs"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { loadRecommendationRequestDetail } from "./detail.service"
import { RECOMMENDATION_TRACE_ACCESS_REASON } from "./shared"

const RUN_REAL_DB_TEST = env.RECOMMENDATION_DB_TEST === "1"
const migrationSql = [
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
      `../../../../prisma/migrations/${migration}/migration.sql`,
      import.meta.url,
    ),
    "utf8",
  ),
)

describe.skipIf(!RUN_REAL_DB_TEST)(
  "recommendation Admin exact request trace against real PostgreSQL",
  () => {
    const schemaName = `recommendation_admin_trace_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2)}`
    const now = new Date("2026-08-26T12:00:00.000Z")
    const expiresAt = "2026-09-24T12:00:00.000Z"
    let client: Client
    let prisma: PrismaClient

    beforeAll(async () => {
      client = new Client({ connectionString: env.DATABASE_URL })
      await client.connect()
      await client.query(`CREATE SCHEMA "${schemaName}"`)
      await client.query(`SET search_path TO "${schemaName}", public`)
      for (const migration of migrationSql) await client.query(migration)

      const url = new URL(env.DATABASE_URL)
      url.searchParams.delete("options")
      url.searchParams.set("schema", schemaName)
      prisma = new PrismaClient({
        datasources: { db: { url: url.toString() } },
      })
    })

    afterAll(async () => {
      await prisma?.$disconnect()
      if (!client) return
      await client.query("RESET search_path")
      await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
      await client.end()
    })

    it("reads one exact hybrid delivery, lifecycle, outcome, and access audit", async () => {
      await client.query(
        `INSERT INTO recommendation_experiment (
          id, experiment_version, surface_version, control_manifest_id,
          challenger_manifest_id, assignment_policy_version,
          outcome_policy_version, integrity_policy_version,
          evaluation_policy_version, configuration_digest,
          challenger_probability, starts_at, ends_at, expires_at
        ) VALUES (
          'admin-trace-profile-pilot', 'admin-trace-profile-pilot-v1',
          'watch-below-player-v1', 'semantic-transcript-pgvector-v1',
          'semantic-profile-hybrid-v1',
          'sticky-deterministic-assignment-v1',
          'active-watch-multi-outcome-v1', 'recommendation-integrity-v1',
          'recommendation-hybrid-personalized-v1', $1, 0.1,
          '2026-08-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z',
          '2027-09-01T00:00:00.000Z'
        )`,
        ["1".repeat(64)],
      )
      await client.query(
        `INSERT INTO recommendation_experiment_assignment (
          id, experiment_id, unit_kind, unit_digest, arm,
          assignment_probability, configuration_digest, assigned_at,
          expires_at
        ) VALUES (
          'admin-trace-assignment', 'admin-trace-profile-pilot',
          'anonymous_session', $1, 'challenger', 0.1, $2,
          '2026-08-26T11:59:00.000Z', $3
        )`,
        ["2".repeat(64), "1".repeat(64), expiresAt],
      )
      await client.query("BEGIN")
      await client.query(
        `INSERT INTO recommendation_request (
          id, contract_version, surface_version, manifest_id,
          strategy_version, classifier_version, session_digest,
          seed_media_id, locale, expected_item_count, state, result,
          delivery_jti, signing_kid, retrieval_latency_ms, response_bytes,
          created_at, issued_at, expires_at, experiment_assignment_id
        ) VALUES (
          'admin-trace-request', 'semantic-recommendation-v1',
          'watch-below-player-v1', 'semantic-profile-hybrid-v1',
          'semantic-profile-hybrid-v1', 'active-watch-proxy-v1', $1,
          'seed-video', 'en', 1, 'issued', 'served',
          'admin-trace-delivery-jti', 'admin-trace-kid', 183, 2048,
          '2026-08-26T12:00:00.000Z', '2026-08-26T12:00:00.100Z', $2,
          'admin-trace-assignment'
        )`,
        ["3".repeat(64), expiresAt],
      )
      await client.query(
        `INSERT INTO recommendation_personalization_decision (
          request_id, effective_manifest_id, lane, execution_mode, projection_scope,
          projection_version, projection_generation_number, interest_count,
          session_intent_present, profile_retrieval_latency_ms, expires_at
        ) VALUES (
          'admin-trace-request', 'semantic-profile-hybrid-v1',
          'profile_challenger', 'hybrid_personalized', 'durable',
          'multi-interest-profile-projection-v1', 4, 2, true, 41, $1
        )`,
        [expiresAt],
      )
      await client.query(
        `INSERT INTO recommendation_candidate_run (
          id, request_id, purpose, context_version, generator_version,
          union_version, eligibility_version, ranker_version, composer_version,
          candidate_eligibility_parity, ranker_parity, baseline_digest,
          platform_digest, nominated_count, canonicalized_count,
          deduplicated_count, rejected_count, scored_count, ordered_count,
          requested_count, composed_count, shortfall_reason,
          evidence_complete, expires_at
        ) VALUES (
          'admin-trace-candidate-run', 'admin-trace-request', 'watch',
          'recommendation-context-v1',
          'semantic-profile-hybrid-generators-v1', 'canonical-video-union-v1',
          'watch-playable-locale-v1', 'source-rank-hybrid-ranker-v1',
          'recent-video-refill-composer-v1', 'not_evaluated', 'not_evaluated', $1, $2,
          2, 2, 1, 1, 1, 1, 1, 1, NULL, true, $3
        )`,
        ["4".repeat(64), "5".repeat(64), expiresAt],
      )
      await client.query(
        `INSERT INTO recommendation_candidate_stage_evidence (
          id, run_id, stage, ordinal, candidate_key, target_media_id,
          source_generator, source_rank, source_score, normalized_score,
          deterministic_score, final_position, reason_codes, source_evidence,
          expires_at
        ) VALUES (
          'admin-trace-candidate-stage', 'admin-trace-candidate-run',
          'composed', 0, 'target-video', 'target-video', NULL, NULL, NULL,
          0.91, 0.91, 0, ARRAY['playable_localized_deduplicated','refill_after_suppression'],
          '[{"generator":"semantic","generatorVersion":"semantic-transcript-candidate-v1","rank":1,"score":0.91},{"generator":"multi-interest-profile","generatorVersion":"multi-interest-profile-candidate-v1","rank":1,"score":0.88}]'::jsonb, $1
        )`,
        [expiresAt],
      )
      await client.query(
        `INSERT INTO recommendation_served_item (
          id, request_id, position, target_media_id, canonical_href,
          candidate_generator, candidate_provenance, presentation,
          capability_jti, signing_kid, expires_at
        ) VALUES (
          'admin-trace-item', 'admin-trace-request', 0, 'target-video',
          '/watch/target-video.html', 'semantic',
          '{"sceneIndex":7,"similarity":0.91}'::jsonb,
          '{"videoTitle":"Target video","audioLanguageSlug":"en","startSeconds":4,"endSeconds":64}'::jsonb,
          'admin-trace-item-jti', 'admin-trace-kid', $1
        )`,
        [expiresAt],
      )
      await client.query(
        `UPDATE recommendation_request
         SET state = 'issued'
         WHERE id = 'admin-trace-request'`,
      )
      await client.query("COMMIT")
      await client.query(
        `INSERT INTO recommendation_rendered_fact (
          id, request_id, item_id, capability_jti, event_id, payload_digest,
          occurred_at, received_at, expires_at
        ) VALUES (
          'admin-trace-rendered', 'admin-trace-request', 'admin-trace-item',
          'admin-trace-rendered-jti', 'admin-trace-rendered-event', $1,
          '2026-08-26T12:00:01.000Z', '2026-08-26T12:00:01.100Z', $2
        )`,
        ["6".repeat(64), expiresAt],
      )
      await client.query(
        `INSERT INTO recommendation_impression (
          id, request_id, item_id, capability_jti, event_id, payload_digest,
          visibility_policy, occurred_at, received_at, expires_at
        ) VALUES (
          'admin-trace-impression', 'admin-trace-request', 'admin-trace-item',
          'admin-trace-impression-jti', 'admin-trace-impression-event', $1,
          'intersection-observer-v1', '2026-08-26T12:00:02.000Z',
          '2026-08-26T12:00:02.100Z', $2
        )`,
        ["7".repeat(64), expiresAt],
      )
      await client.query(
        `INSERT INTO recommendation_selection (
          id, request_id, item_id, capability_jti, event_id, payload_digest,
          claim_nonce_digest, handoff_expires_at, claimed_at, occurred_at,
          received_at, expires_at
        ) VALUES (
          'admin-trace-selection', 'admin-trace-request', 'admin-trace-item',
          'admin-trace-selection-jti', 'admin-trace-selection-event', $1, $2,
          '2026-08-26T12:05:00.000Z', '2026-08-26T12:00:03.100Z',
          '2026-08-26T12:00:03.000Z', '2026-08-26T12:00:03.100Z', $3
        )`,
        ["8".repeat(64), "9".repeat(64), expiresAt],
      )
      await client.query(
        `INSERT INTO recommendation_playback_episode (
          id, request_id, item_id, selection_id, media_id, session_digest,
          state, capability_jti, signing_kid, active_until, hard_until,
          next_fact_sequence, claimed_at, finalized_at, expires_at
        ) VALUES (
          'admin-trace-episode', 'admin-trace-request', 'admin-trace-item',
          'admin-trace-selection', 'target-video', $1, 'finalized',
          'admin-trace-episode-jti', 'admin-trace-kid',
          '2026-08-26T13:00:00.000Z', '2026-08-26T14:00:00.000Z', 2,
          '2026-08-26T12:00:03.100Z', '2026-08-26T12:00:40.000Z', $2
        )`,
        ["3".repeat(64), expiresAt],
      )
      await client.query(
        `INSERT INTO recommendation_playback_fact (
          id, request_id, item_id, episode_id, capability_jti, event_id,
          payload_digest, sequence, kind, payload, occurred_at, received_at,
          expires_at
        ) VALUES (
          'admin-trace-playback-fact', 'admin-trace-request',
          'admin-trace-item', 'admin-trace-episode',
          'admin-trace-playback-fact-jti', 'admin-trace-playback-fact-event',
          $1, 1, 'active_interval',
          '{"fromSeconds":0,"toSeconds":35,"activeMilliseconds":35000,"coverage":"complete"}'::jsonb,
          '2026-08-26T12:00:39.000Z', '2026-08-26T12:00:39.100Z', $2
        )`,
        ["a".repeat(64), expiresAt],
      )
      await client.query(
        `INSERT INTO recommendation_outcome_revision (
          id, request_id, item_id, episode_id, classifier_version,
          fact_watermark, input_digest, revision, qualified_view,
          view_quality_weight, view_quality_weight_reason,
          active_playback_milliseconds, duration_seconds, duration_cohort,
          active_coverage, reasons, learning_eligible, generation, expires_at
        ) VALUES (
          'admin-trace-outcome', 'admin-trace-request', 'admin-trace-item',
          'admin-trace-episode', 'active-watch-proxy-v1', 1, $1, 1, true,
          0.583333, 'active_fraction_of_duration', 35000, 60, 'medium',
          'complete', ARRAY['qualified_active_watch'], false, 1, $2
        )`,
        ["b".repeat(64), expiresAt],
      )
      await client.query(
        `INSERT INTO recommendation_eligibility_decision (
          id, source_type, source_key, outcome_id, policy_version, revision,
          is_current, actor_class, state, reason_codes, eligible_scopes,
          contribution_weight, contribution_ordinal, distinct_support,
          identity_concentration, decided_at, expires_at
        ) VALUES (
          'admin-trace-eligibility', 'playback_outcome',
          'admin-trace-outcome', 'admin-trace-outcome',
          'recommendation-integrity-v1', 1, true, 'human_anonymous',
          'eligible', ARRAY['qualified_human_evidence'], ARRAY['profile'],
          0.583333, 1, 1, 1, '2026-08-26T12:00:41.000Z', $1
        )`,
        [expiresAt],
      )

      const actorDigest = "c".repeat(64)
      const detail = await loadRecommendationRequestDetail(prisma, {
        requestId: "admin-trace-request",
        actorDigest,
        now,
      })

      expect(detail).toMatchObject({
        id: "admin-trace-request",
        state: "issued",
        result: "served",
        retrievalLatencyMs: 183,
        experiment: {
          assignment: {
            id: "admin-trace-assignment",
            arm: "challenger",
            effectiveManifestId: "semantic-profile-hybrid-v1",
            actualExposureCount: 0,
          },
        },
        personalization: {
          lane: "profile_challenger",
          executionMode: "hybrid_personalized",
          effectiveManifestId: "semantic-profile-hybrid-v1",
          projectionScope: "durable",
          projectionVersion: "multi-interest-profile-projection-v1",
          projectionGeneration: 4,
          interestCount: 2,
          sessionIntentPresent: true,
          retrievalLatencyMs: 41,
        },
        candidateExecution: {
          purpose: "watch",
          evidenceComplete: true,
          requestedCount: 1,
          composedCount: 1,
          shortfallReason: null,
          counts: { nominated: 2, rejected: 1, composed: 1 },
          stages: [
            expect.objectContaining({
              stage: "composed",
              targetMediaId: "target-video",
              contributors: expect.arrayContaining([
                expect.objectContaining({ generator: "semantic" }),
                expect.objectContaining({
                  generator: "multi-interest-profile",
                }),
              ]),
              finalPosition: 0,
            }),
          ],
        },
        items: [
          expect.objectContaining({
            id: "admin-trace-item",
            targetMediaId: "target-video",
            candidateGenerator: "semantic",
            composition: expect.objectContaining({
              refill: true,
              contributors: expect.arrayContaining([
                expect.objectContaining({ generator: "semantic" }),
                expect.objectContaining({
                  generator: "multi-interest-profile",
                }),
              ]),
            }),
          }),
        ],
        lifecycleEvents: [
          expect.objectContaining({ kind: "rendered" }),
          expect.objectContaining({ kind: "impression" }),
          expect.objectContaining({ kind: "selection" }),
        ],
        episodes: [
          expect.objectContaining({
            id: "admin-trace-episode",
            state: "finalized",
            facts: [
              expect.objectContaining({
                sequence: 1,
                kind: "active_interval",
                metrics: expect.objectContaining({
                  activeMilliseconds: 35_000,
                  coverage: "complete",
                }),
              }),
            ],
            outcomes: [
              expect.objectContaining({
                id: "admin-trace-outcome",
                qualifiedView: true,
                eligibilityState: "eligible",
                learningEligible: true,
                eligibleScopes: ["profile"],
              }),
            ],
          }),
        ],
      })

      const audits = await client.query(
        `SELECT request_id, actor_digest, reason_code
         FROM recommendation_trace_access_audit
         WHERE request_id = 'admin-trace-request'`,
      )
      expect(audits.rows).toEqual([
        {
          request_id: "admin-trace-request",
          actor_digest: actorDigest,
          reason_code: RECOMMENDATION_TRACE_ACCESS_REASON,
        },
      ])
    })
  },
)
