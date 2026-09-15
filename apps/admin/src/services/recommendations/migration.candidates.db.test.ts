import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"

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
  "0072_recommendation_source_neutral_playback_episodes",
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
  "recommendation tracer migration against real PostgreSQL",
  () => {
    const schemaName = `recommendation_u1_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2)}`
    let client: Client
    let databaseUrl: string
    const expiresAt = "2026-09-17T00:00:00.000Z"

    async function insertRequest(id: string, expectedItemCount: number) {
      await client.query(
        `INSERT INTO "recommendation_request" (
          "id", "contract_version", "surface_version", "manifest_id",
          "strategy_version", "classifier_version", "session_digest",
          "seed_media_id", "locale", "expected_item_count", "result", "expires_at"
        ) VALUES ($1, 'semantic-recommendation-v1', 'watch-below-player-v1',
          'semantic-transcript-pgvector-v1', 'semantic-transcript-pgvector-v1',
          'legacy-position-v0', $2, 'seed-video', 'en', $3, 'served', $4)`,
        [id, "a".repeat(64), expectedItemCount, expiresAt],
      )
    }

    async function insertItem(
      id: string,
      requestId: string,
      position: number,
      childExpiresAt = expiresAt,
      capabilityJti: string | null = null,
    ) {
      await client.query(
        `INSERT INTO "recommendation_served_item" (
          "id", "request_id", "position", "target_media_id", "canonical_href",
          "candidate_generator", "candidate_provenance", "expires_at",
          "capability_jti"
        ) VALUES ($1, $2, $3, $4, $5, 'semantic', '{}'::jsonb, $6, $7)`,
        [
          id,
          requestId,
          position,
          `video-${position}`,
          `/watch/video-${position}`,
          childExpiresAt,
          capabilityJti,
        ],
      )
    }

    async function insertLifecycleGraph(prefix: string) {
      const requestId = `${prefix}-request`
      const itemId = `${prefix}-item`
      const selectionId = `${prefix}-selection`
      const episodeId = `${prefix}-episode`
      await insertRequest(requestId, 1)
      await insertItem(itemId, requestId, 0)
      await client.query(
        `INSERT INTO recommendation_selection (
          id, request_id, item_id, capability_jti, event_id,
          payload_digest, claim_nonce_digest, handoff_expires_at,
          occurred_at, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7,
          '2026-08-19T03:05:00.000Z', '2026-08-19T03:00:00.000Z', $8)`,
        [
          selectionId,
          requestId,
          itemId,
          `${prefix}-selection-jti`,
          `${prefix}-selection-event`,
          "b".repeat(64),
          digest(`${prefix}-claim-nonce`),
          expiresAt,
        ],
      )
      await client.query(
        `INSERT INTO recommendation_playback_episode (
          id, request_id, item_id, selection_id, media_id, session_digest,
          state, capability_jti, signing_kid, active_until, hard_until,
          generation, claimed_at, expires_at
        ) VALUES ($1, $2, $3, $4, 'video-0', $5, 'claimed', $6, 'kid-1',
          '2026-08-19T07:00:00.000Z', '2026-08-19T09:00:00.000Z', 1,
          '2026-08-19T03:00:00.000Z', $7)`,
        [
          episodeId,
          requestId,
          itemId,
          selectionId,
          "a".repeat(64),
          `${prefix}-episode-jti`,
          expiresAt,
        ],
      )
      return { requestId, itemId, selectionId, episodeId }
    }

    beforeAll(async () => {
      databaseUrl = env.DATABASE_URL
      client = new Client({ connectionString: databaseUrl })
      await client.connect()
      await client.query(`CREATE SCHEMA "${schemaName}"`)
      await client.query(`SET search_path TO "${schemaName}", public`)
      for (const migration of migrationSql) await client.query(migration)
    })

    it("bounds stage evidence, shares request expiry, and cascades the complete run", async () => {
      await insertRequest("candidate-run-request", 0)
      await client.query(
        `INSERT INTO recommendation_candidate_run (
          id, request_id, purpose, context_version, generator_version,
          union_version, eligibility_version, ranker_version, composer_version,
          candidate_eligibility_parity, ranker_parity, baseline_digest,
          platform_digest, nominated_count, canonicalized_count,
          deduplicated_count, rejected_count, scored_count, ordered_count,
          composed_count, evidence_complete, expires_at
        ) VALUES (
          'candidate-run-1', 'candidate-run-request', 'watch',
          'recommendation-context-v1', 'semantic-transcript-candidate-v1',
          'canonical-video-union-v1', 'watch-playable-locale-v1',
          'semantic-deterministic-ranker-v1', 'minimal-playable-slate-v1',
          'passed', 'passed', $1, $1, 1, 1, 1, 0, 1, 1, 1, true, $2
        )`,
        ["c".repeat(64), expiresAt],
      )
      await client.query(
        `INSERT INTO recommendation_candidate_stage_evidence (
          id, run_id, stage, ordinal, candidate_key, target_media_id,
          source_generator, source_rank, source_score, normalized_score,
          rrf_score, deterministic_score, final_position, reason_codes,
          source_evidence, expires_at
        ) VALUES (
          'candidate-stage-1', 'candidate-run-1', 'composed', 0,
          'video-a', 'video-a', 'semantic', 1, 0.9, 1, 0.016393,
          1, 0, ARRAY['playable_localized_deduplicated'],
          '[{"generator":"semantic","rank":1,"score":0.9}]'::jsonb, $1
        )`,
        [expiresAt],
      )
      const stored = await client.query(
        `SELECT run.evidence_complete, run.candidate_eligibility_parity,
          stage.stage, jsonb_array_length(stage.source_evidence) AS sources
         FROM recommendation_candidate_run run
         JOIN recommendation_candidate_stage_evidence stage
           ON stage.run_id = run.id
         WHERE run.id = 'candidate-run-1'`,
      )
      expect(stored.rows).toEqual([
        {
          evidence_complete: true,
          candidate_eligibility_parity: "passed",
          stage: "composed",
          sources: 1,
        },
      ])

      await expect(
        client.query(
          `INSERT INTO recommendation_candidate_stage_evidence (
            id, run_id, stage, ordinal, candidate_key, source_evidence,
            expires_at
          ) VALUES ('candidate-stage-too-many', 'candidate-run-1',
            'nominated', 1, 'video-b',
            (SELECT jsonb_agg(value) FROM generate_series(1, 17) value), $1)`,
          [expiresAt],
        ),
      ).rejects.toMatchObject({ code: "23514" })
      await expect(
        client.query(
          `INSERT INTO recommendation_candidate_stage_evidence (
            id, run_id, stage, ordinal, candidate_key, expires_at
          ) VALUES ('candidate-stage-extended', 'candidate-run-1',
            'nominated', 1, 'video-b', '2026-09-18T00:00:00.000Z')`,
        ),
      ).rejects.toThrow("recommendation candidate stage expiry")

      await client.query(
        `DELETE FROM recommendation_request WHERE id = 'candidate-run-request'`,
      )
      const remaining = await client.query(
        `SELECT
          (SELECT count(*)::int FROM recommendation_candidate_run
            WHERE id = 'candidate-run-1') AS runs,
          (SELECT count(*)::int FROM recommendation_candidate_stage_evidence
            WHERE run_id = 'candidate-run-1') AS stages`,
      )
      expect(remaining.rows).toEqual([{ runs: 0, stages: 0 }])
    })

    it("keeps shadow output offline, bounded, immutable, and request-owned", async () => {
      await insertRequest("shadow-request", 0)
      await client.query(
        `INSERT INTO recommendation_candidate_run (
          id, request_id, purpose, context_version, generator_version,
          union_version, eligibility_version, ranker_version, composer_version,
          candidate_eligibility_parity, ranker_parity, nominated_count,
          canonicalized_count, deduplicated_count, rejected_count, scored_count,
          ordered_count, composed_count, evidence_complete, expires_at
        ) VALUES (
          'shadow-live-run', 'shadow-request', 'watch',
          'recommendation-context-v1', 'semantic-transcript-candidate-v1',
          'canonical-video-union-v1', 'watch-playable-locale-v1',
          'semantic-deterministic-ranker-v1', 'minimal-playable-slate-v1',
          'passed', 'passed', 1, 1, 1, 0, 1, 1, 1, true, $1
        )`,
        [expiresAt],
      )
      await client.query(
        `INSERT INTO recommendation_shadow_evaluation (
          id, manifest_id, generator_version, sampling_version,
          context_version, eligibility_version, retention_policy_version,
          generation, window_start, window_end, requested_sample_size,
          sampled_count, expires_at
        ) VALUES (
          'shadow-evaluation-1', 'semantic-candidate-platform-v1',
          'profile-v1', 'stable-request-hash-v1',
          'recommendation-context-v1', 'watch-playable-locale-v1',
          'request-root-29d-aggregate-365d-v1', 3,
          '2026-08-24T00:00:00.000Z', '2026-08-25T00:00:00.000Z',
          10, 1, '2027-08-25T00:00:00.000Z'
        )`,
      )
      await client.query(
        `INSERT INTO recommendation_shadow_run (
          id, evaluation_id, request_id, live_candidate_run_id,
          sample_ordinal, sampling_digest, context_projection_ref,
          context_projection_version, context_projection_digest,
          eligibility_version, retention_policy_version, state, generation,
          claim_id, claimed_at, heartbeat_at, input_captured_at, expires_at
        ) VALUES (
          'shadow-run-1', 'shadow-evaluation-1', 'shadow-request',
          'shadow-live-run', 0, $1, 'shadow-live-run',
          'recommendation-context-v1', $2, 'watch-playable-locale-v1',
          'request-root-29d-aggregate-365d-v1', 'claimed', 3,
          '11111111-1111-4111-8111-111111111111',
          '2026-08-25T00:00:00.000Z', '2026-08-25T00:00:00.000Z',
          '2026-08-24T23:59:00.000Z', $3
        )`,
        ["d".repeat(64), "e".repeat(64), expiresAt],
      )
      await client.query(
        `INSERT INTO recommendation_shadow_nomination (
          id, run_id, ordinal, candidate_key, target_media_id, generator,
          generator_version, source_rank, source_score, eligible,
          shadow_position, overlaps_live, provenance, expires_at
        ) VALUES (
          'shadow-nomination-1', 'shadow-run-1', 0, 'video-a', 'video-a',
          'profile', 'profile-v1', 1, 0.9, true, 0, true,
          '{"interestOrdinal":1}'::jsonb, $1
        )`,
        [expiresAt],
      )
      await expect(
        client.query(
          `INSERT INTO recommendation_shadow_nomination (
            id, run_id, ordinal, candidate_key, target_media_id, generator,
            generator_version, source_rank, source_score, eligible,
            overlaps_live, provenance, expires_at
          ) VALUES (
            'shadow-nomination-vector', 'shadow-run-1', 1, 'video-b',
            'video-b', 'profile', 'profile-v1', 2, 0.8, true, false,
            '{"rawProfileVector":"secret"}'::jsonb, $1
          )`,
          [expiresAt],
        ),
      ).rejects.toMatchObject({ code: "23514" })
      await expect(
        client.query(
          `INSERT INTO recommendation_shadow_nomination (
            id, run_id, ordinal, candidate_key, target_media_id, generator,
            generator_version, source_rank, source_score, eligible,
            overlaps_live, expires_at
          ) VALUES (
            'shadow-nomination-expiry', 'shadow-run-1', 1, 'video-b',
            'video-b', 'profile', 'profile-v1', 2, 0.8, true, false,
            '2026-09-18T00:00:00.000Z'
          )`,
        ),
      ).rejects.toThrow("shadow nomination expiry")

      await client.query(
        `INSERT INTO recommendation_shadow_decision (
          id, evaluation_id, decision, reason_code, reevaluation_condition,
          input_digest, decided_at, expires_at
        ) VALUES (
          'shadow-decision-1', 'shadow-evaluation-1', 'inconclusive',
          'insufficient_shadow_samples', 'collect_at_least_10_runs', $1,
          '2026-08-25T00:01:00.000Z', '2027-08-25T00:00:00.000Z'
        )`,
        ["f".repeat(64)],
      )
      await client.query(
        `UPDATE recommendation_shadow_evaluation
         SET state = 'terminal' WHERE id = 'shadow-evaluation-1'`,
      )
      await expect(
        client.query(
          `UPDATE recommendation_shadow_decision SET reason_code = 'changed'
           WHERE id = 'shadow-decision-1'`,
        ),
      ).rejects.toThrow("terminal decisions are immutable")
      await expect(
        client.query(
          `UPDATE recommendation_shadow_evaluation SET coverage = 1
           WHERE id = 'shadow-evaluation-1'`,
        ),
      ).rejects.toThrow("shadow evaluations are immutable")

      await client.query(
        `DELETE FROM recommendation_request WHERE id = 'shadow-request'`,
      )
      const retained = await client.query(
        `SELECT
          (SELECT count(*)::int FROM recommendation_shadow_run
            WHERE id = 'shadow-run-1') AS runs,
          (SELECT count(*)::int FROM recommendation_shadow_nomination
            WHERE run_id = 'shadow-run-1') AS nominations,
          (SELECT count(*)::int FROM recommendation_shadow_evaluation
            WHERE id = 'shadow-evaluation-1') AS evaluations,
          (SELECT count(*)::int FROM recommendation_shadow_decision
            WHERE id = 'shadow-decision-1') AS decisions`,
      )
      expect(retained.rows).toEqual([
        { runs: 0, nominations: 0, evaluations: 1, decisions: 1 },
      ])
    })

    it("issues unavailable roots without inventing a delivery capability", async () => {
      await expect(
        client.query(
          `INSERT INTO recommendation_request (
            id, contract_version, surface_version, manifest_id,
            strategy_version, classifier_version, session_digest,
            seed_media_id, locale, expected_item_count, state, result,
            signing_kid, issued_at, expires_at
          ) VALUES (
            'issued-unavailable', 'semantic-recommendation-v1',
            'watch-below-player-v1', 'semantic-transcript-pgvector-v1',
            'semantic-transcript-pgvector-v1', 'legacy-position-v0', $1,
            'seed-video', 'en', 0, 'issued', 'unavailable', 'kid-1',
            '2026-08-24T00:00:00.000Z', $2
          )`,
          ["a".repeat(64), expiresAt],
        ),
      ).resolves.toBeDefined()
      const unavailable = await client.query(
        `SELECT expected_item_count, delivery_jti, signing_kid
         FROM recommendation_request WHERE id = 'issued-unavailable'`,
      )
      expect(unavailable.rows).toEqual([
        {
          expected_item_count: 0,
          delivery_jti: null,
          signing_kid: "kid-1",
        },
      ])

      const insertInvalidIssuedRoot = (
        id: string,
        result: "served" | "unavailable",
        expectedItemCount: number,
        deliveryJti: string | null,
      ) =>
        client.query(
          `INSERT INTO recommendation_request (
            id, contract_version, surface_version, manifest_id,
            strategy_version, classifier_version, session_digest,
            seed_media_id, locale, expected_item_count, state, result,
            delivery_jti, signing_kid, issued_at, expires_at
          ) VALUES (
            $1, 'semantic-recommendation-v1', 'watch-below-player-v1',
            'semantic-transcript-pgvector-v1',
            'semantic-transcript-pgvector-v1', 'legacy-position-v0', $2,
            'seed-video', 'en', $3, 'issued', $4, $5, 'kid-1',
            '2026-08-24T00:00:00.000Z', $6
          )`,
          [
            id,
            "a".repeat(64),
            expectedItemCount,
            result,
            deliveryJti,
            expiresAt,
          ],
        )

      await expect(
        insertInvalidIssuedRoot(
          "issued-unavailable-with-item",
          "unavailable",
          1,
          null,
        ),
      ).rejects.toMatchObject({ code: "23514" })
      await expect(
        insertInvalidIssuedRoot(
          "issued-unavailable-with-capability",
          "unavailable",
          0,
          "unavailable-jti",
        ),
      ).rejects.toMatchObject({ code: "23514" })
      await expect(
        insertInvalidIssuedRoot(
          "issued-served-without-capability",
          "served",
          0,
          null,
        ),
      ).rejects.toMatchObject({ code: "23514" })
    })

    it("rejects a partial request at commit and leaves no parent or orphan item", async () => {
      await client.query("BEGIN")
      await insertRequest("partial-request", 2)
      await insertItem("partial-item", "partial-request", 0)
      await expect(client.query("COMMIT")).rejects.toThrow(
        "recommendation request item set is incomplete",
      )
      await client.query("ROLLBACK")

      const result = await client.query(
        `SELECT
          (SELECT count(*)::int FROM recommendation_request WHERE id = 'partial-request') requests,
          (SELECT count(*)::int FROM recommendation_served_item WHERE request_id = 'partial-request') items`,
      )
      expect(result.rows[0]).toEqual({ requests: 0, items: 0 })
    })

    it("accepts a complete contiguous set and rejects child-extended retention", async () => {
      await client.query("BEGIN")
      await insertRequest("complete-request", 2)
      await insertItem("complete-item-0", "complete-request", 0)
      await insertItem("complete-item-1", "complete-request", 1)
      await expect(client.query("COMMIT")).resolves.toBeDefined()

      await client.query("BEGIN")
      await insertRequest("expiry-request", 1)
      await expect(
        insertItem(
          "expiry-item",
          "expiry-request",
          0,
          "2026-09-18T00:00:00.000Z",
        ),
      ).rejects.toThrow("child expiry must match request root")
      await client.query("ROLLBACK")
    })

    it("enforces same-request lineage across lifecycle children", async () => {
      await client.query("BEGIN")
      await insertRequest("lineage-a-request", 1)
      await insertItem("lineage-a-item", "lineage-a-request", 0)
      await insertRequest("lineage-b-request", 1)
      await insertItem("lineage-b-item", "lineage-b-request", 0)
      await client.query("COMMIT")

      await expect(
        client.query(
          `INSERT INTO recommendation_rendered_fact (
            id, request_id, item_id, capability_jti, event_id,
            payload_digest, occurred_at, expires_at
          ) VALUES ('lineage-render', 'lineage-a-request', 'lineage-b-item',
            'lineage-render-jti', 'lineage-render-event', $1,
            '2026-08-19T03:00:00.000Z', $2)`,
          ["1".repeat(64), expiresAt],
        ),
      ).rejects.toMatchObject({ code: "23503" })
      await expect(
        client.query(
          `INSERT INTO recommendation_impression (
            id, request_id, item_id, capability_jti, event_id,
            payload_digest, visibility_policy, occurred_at, expires_at
          ) VALUES ('lineage-impression', 'lineage-a-request', 'lineage-b-item',
            'lineage-impression-jti', 'lineage-impression-event', $1,
            'intersection-v1', '2026-08-19T03:00:00.000Z', $2)`,
          ["2".repeat(64), expiresAt],
        ),
      ).rejects.toMatchObject({ code: "23503" })
      await expect(
        client.query(
          `INSERT INTO recommendation_selection (
            id, request_id, item_id, capability_jti, event_id,
            payload_digest, claim_nonce_digest, handoff_expires_at,
            occurred_at, expires_at
          ) VALUES ('lineage-selection-cross', 'lineage-a-request',
            'lineage-b-item', 'lineage-selection-cross-jti',
            'lineage-selection-cross-event', $1, $2,
            '2026-08-19T03:05:00.000Z', '2026-08-19T03:00:00.000Z', $3)`,
          ["3".repeat(64), digest("lineage-selection-cross"), expiresAt],
        ),
      ).rejects.toMatchObject({ code: "23503" })

      await client.query(
        `INSERT INTO recommendation_selection (
          id, request_id, item_id, capability_jti, event_id,
          payload_digest, claim_nonce_digest, handoff_expires_at,
          occurred_at, expires_at
        ) VALUES ('lineage-b-selection', 'lineage-b-request',
          'lineage-b-item', 'lineage-b-selection-jti',
          'lineage-b-selection-event', $1, $2,
          '2026-08-19T03:05:00.000Z', '2026-08-19T03:00:00.000Z', $3)`,
        ["4".repeat(64), digest("lineage-b-selection"), expiresAt],
      )
      await expect(
        client.query(
          `INSERT INTO recommendation_playback_episode (
            id, request_id, item_id, selection_id, media_id, session_digest,
            active_until, hard_until, expires_at
          ) VALUES ('lineage-episode-cross', 'lineage-a-request',
            'lineage-a-item', 'lineage-b-selection', 'video-0', $1,
            '2026-08-19T07:00:00.000Z', '2026-08-19T09:00:00.000Z', $2)`,
          ["5".repeat(64), expiresAt],
        ),
      ).rejects.toMatchObject({ code: "23503" })

      await client.query("BEGIN")
      const graphA = await insertLifecycleGraph("lineage-graph-a")
      const graphB = await insertLifecycleGraph("lineage-graph-b")
      await client.query("COMMIT")
      await expect(
        client.query(
          `INSERT INTO recommendation_playback_fact (
            id, request_id, item_id, episode_id, capability_jti, event_id,
            payload_digest, sequence, kind, occurred_at, expires_at
          ) VALUES ('lineage-fact-cross', $1, $2, $3,
            'lineage-fact-cross-jti', 'lineage-fact-cross-event', $4, 1,
            'playback_start', '2026-08-19T03:01:00.000Z', $5)`,
          [
            graphA.requestId,
            graphA.itemId,
            graphB.episodeId,
            "6".repeat(64),
            expiresAt,
          ],
        ),
      ).rejects.toMatchObject({ code: "23503" })
      await expect(
        client.query(
          `INSERT INTO recommendation_outcome_revision (
            id, request_id, item_id, episode_id, classifier_version,
            fact_watermark, input_digest, revision, qualified_view,
            view_quality_weight_reason, generation, expires_at
          ) VALUES ('lineage-outcome-cross', $1, $2, $3,
            'legacy-position-v0', 0, $4, 1, false,
            'continuous_weight_not_available', 1, $5)`,
          [
            graphA.requestId,
            graphA.itemId,
            graphB.episodeId,
            "7".repeat(64),
            expiresAt,
          ],
        ),
      ).rejects.toMatchObject({ code: "23503" })

      await client.query(
        `INSERT INTO recommendation_outcome_revision (
          id, request_id, item_id, episode_id, classifier_version,
          fact_watermark, input_digest, revision, qualified_view,
          view_quality_weight_reason, generation, expires_at
        ) VALUES ('lineage-a-outcome', $1, $2, $3,
          'legacy-position-v0', 0, $4, 1, false,
          'continuous_weight_not_available', 1, $5)`,
        [
          graphA.requestId,
          graphA.itemId,
          graphA.episodeId,
          "8".repeat(64),
          expiresAt,
        ],
      )
      await expect(
        client.query(
          `INSERT INTO recommendation_outcome_revision (
            id, request_id, item_id, episode_id, classifier_version,
            fact_watermark, input_digest, revision, supersedes_id,
            qualified_view, view_quality_weight_reason, generation, expires_at
          ) VALUES ('lineage-b-outcome', $1, $2, $3,
            'legacy-position-v0', 0, $4, 1, 'lineage-a-outcome', false,
            'continuous_weight_not_available', 1, $5)`,
          [
            graphB.requestId,
            graphB.itemId,
            graphB.episodeId,
            "9".repeat(64),
            expiresAt,
          ],
        ),
      ).rejects.toMatchObject({ code: "23503" })
    })

    it("checks both request roots when an item moves", async () => {
      await client.query("BEGIN")
      await insertRequest("move-source-request", 1)
      await insertItem("move-item", "move-source-request", 0)
      await insertRequest("move-target-request", 0)
      await client.query("COMMIT")

      await client.query("BEGIN")
      await client.query(
        `UPDATE recommendation_request SET expected_item_count = 1
         WHERE id = 'move-target-request'`,
      )
      await client.query(
        `UPDATE recommendation_served_item SET request_id = 'move-target-request'
         WHERE id = 'move-item'`,
      )
      await expect(client.query("COMMIT")).rejects.toThrow(
        "recommendation request item set is incomplete",
      )
      await client.query("ROLLBACK")

      const roots = await client.query(
        `SELECT request_id FROM recommendation_served_item WHERE id = 'move-item'`,
      )
      expect(roots.rows).toEqual([{ request_id: "move-source-request" }])
    })

    it("indexes submission budgets by their retention-owning request", async () => {
      const index = await client.query(
        `SELECT indexdef FROM pg_indexes
         WHERE schemaname = current_schema()
           AND indexname = 'recommendation_capability_submission_budget_request_idx'`,
      )
      expect(index.rows).toHaveLength(1)
      expect(index.rows[0]?.indexdef).toContain("(request_id)")
    })

    it("indexes only episodes with pending finalization work", async () => {
      const index = await client.query(
        `SELECT indexdef FROM pg_indexes
         WHERE schemaname = current_schema()
           AND indexname = 'recommendation_episode_finalization_due_idx'`,
      )
      expect(index.rows).toHaveLength(1)
      expect(index.rows[0]?.indexdef).toContain(
        "(finalization_due_at, id) INCLUDE (generation, active_until, expires_at)",
      )
      expect(index.rows[0]?.indexdef).toContain(
        "WHERE (finalization_due_at IS NOT NULL)",
      )
    })

    afterAll(async () => {
      if (!client) return
      await client.query("RESET search_path")
      await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
      await client.end()
    })
  },
)
