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

    beforeAll(async () => {
      databaseUrl = env.DATABASE_URL
      client = new Client({ connectionString: databaseUrl })
      await client.connect()
      await client.query(`CREATE SCHEMA "${schemaName}"`)
      await client.query(`SET search_path TO "${schemaName}", public`)
      for (const migration of migrationSql) await client.query(migration)
    })

    it("publishes U19 as private shadow-only truth and cascades an exact privacy generation", async () => {
      const manifest = await client.query(
        `SELECT enabled, generator,
          configuration ->> 'shadowOnly' AS shadow_only,
          (configuration ->> 'completeServiceDeadlineMs')::int AS deadline_ms
         FROM recommendation_strategy_manifest
         WHERE id = 'multi-interest-profile-shadow-v1'`,
      )
      expect(manifest.rows).toEqual([
        {
          enabled: true,
          generator: "profile",
          shadow_only: "true",
          deadline_ms: 1500,
        },
      ])
      const liveAuthority = await client.query(
        `SELECT manifest_id FROM recommendation_serving_control
         WHERE id = 'recommendation-serving-control'`,
      )
      expect(liveAuthority.rows[0]?.manifest_id).not.toBe(
        "multi-interest-profile-shadow-v1",
      )

      await client.query("BEGIN")
      try {
        await client.query(
          `INSERT INTO recommendation_profile (
            id, token_digest, privacy_generation, choice, state,
            expires_at, updated_at
          ) VALUES (
            'profile-u19', $1, 3, 'durable_allowed', 'active',
            '2027-02-20T00:00:00.000Z', '2026-08-26T00:00:00.000Z'
          )`,
          ["9".repeat(64)],
        )
        await client.query(
          `INSERT INTO recommendation_profile_projection_generation (
            id, manifest_id, scope, profile_id, privacy_generation,
            generation, state, projection_version, clustering_version,
            eligibility_policy_version, outcome_classifier_version,
            input_window_start, input_window_end, input_digest,
            retention_days, published_at, expires_at
          ) VALUES (
            'projection-u19', 'multi-interest-profile-shadow-v1', 'durable',
            'profile-u19', 3, 1, 'published',
            'multi-interest-profile-projection-v1',
            'deterministic-farthest-first-medoids-v1',
            'recommendation-integrity-v1', 'active-watch-proxy-v1',
            '2026-08-25T00:00:00.000Z', '2026-08-26T00:00:00.000Z',
            $1, 180, '2026-08-26T00:00:00.000Z',
            '2027-02-20T00:00:00.000Z'
          )`,
          ["8".repeat(64)],
        )
        await client.query(
          `INSERT INTO recommendation_profile_projection_pointer (
            scope_digest, scope, profile_id, privacy_generation,
            generation_id, pointer_generation
          ) VALUES ($1, 'durable', 'profile-u19', 3, 'projection-u19', 1)`,
          ["7".repeat(64)],
        )
        await client.query(
          `INSERT INTO recommendation_profile_projection_run (
            id, scope, profile_id, privacy_generation, session_digest,
            expires_at
          ) VALUES (
            'projection-run-u19', 'durable', 'profile-u19', 3, $1,
            '2026-08-27T00:00:00.000Z'
          )`,
          ["6".repeat(64)],
        )
        await client.query("SAVEPOINT invalid_projection")
        await expect(
          client.query(
            `INSERT INTO recommendation_profile_projection_generation (
              id, manifest_id, scope, profile_id, privacy_generation,
              session_digest, generation, projection_version,
              clustering_version, eligibility_policy_version,
              outcome_classifier_version, input_window_start,
              input_window_end, input_digest, retention_days, expires_at
            ) VALUES (
              'projection-invalid-u19', 'multi-interest-profile-shadow-v1',
              'durable', 'profile-u19', 3, $1, 2,
              'multi-interest-profile-projection-v1',
              'deterministic-farthest-first-medoids-v1',
              'recommendation-integrity-v1', 'active-watch-proxy-v1',
              '2026-08-25T00:00:00.000Z', '2026-08-26T00:00:00.000Z',
              $2, 180, '2027-02-20T00:00:00.000Z'
            )`,
            ["6".repeat(64), "5".repeat(64)],
          ),
        ).rejects.toThrow("recommendation_profile_projection_scope_check")
        await client.query("ROLLBACK TO SAVEPOINT invalid_projection")

        await client.query(
          `DELETE FROM recommendation_profile WHERE id = 'profile-u19'`,
        )
        const remaining = await client.query(
          `SELECT
            (SELECT count(*)::int FROM recommendation_profile_projection_generation WHERE profile_id = 'profile-u19') AS generations,
            (SELECT count(*)::int FROM recommendation_profile_projection_pointer WHERE profile_id = 'profile-u19') AS pointers,
            (SELECT count(*)::int FROM recommendation_profile_projection_run WHERE profile_id = 'profile-u19') AS runs`,
        )
        expect(remaining.rows).toEqual([
          { generations: 0, pointers: 0, runs: 0 },
        ])
      } finally {
        await client.query("ROLLBACK")
      }
    })

    it("keeps strategy manifests immutable after evidence can authorize them", async () => {
      await expect(
        client.query(
          `UPDATE recommendation_strategy_manifest
           SET configuration = jsonb_set(configuration, '{completeServiceDeadlineMs}', '2000')
           WHERE id = 'multi-interest-profile-shadow-v1'`,
        ),
      ).rejects.toThrow("recommendation strategy manifests are immutable")
      await expect(
        client.query(
          `DELETE FROM recommendation_strategy_manifest
           WHERE id = 'multi-interest-profile-shadow-v1'`,
        ),
      ).rejects.toThrow("recommendation strategy manifests are immutable")
    })

    it("publishes the exact hybrid strategy with zero exposure authority", async () => {
      const manifest = await client.query(
        `SELECT generator, max_items,
          configuration -> 'generators' AS generators,
          configuration ->> 'ranker' AS ranker,
          configuration ->> 'composer' AS composer,
          (configuration ->> 'completeServiceDeadlineMs')::int AS deadline_ms
         FROM recommendation_strategy_manifest
         WHERE id = 'semantic-profile-hybrid-v1'`,
      )
      expect(manifest.rows).toEqual([
        {
          generator: "hybrid",
          max_items: 6,
          generators: [
            {
              generator: "semantic",
              version: "semantic-transcript-candidate-v1",
            },
            {
              generator: "multi-interest-profile",
              version: "multi-interest-profile-candidate-v1",
            },
          ],
          ranker: "source-rank-hybrid-ranker-v1",
          composer: "recent-video-refill-composer-v1",
          deadline_ms: 1_500,
        },
      ])

      const authority = await client.query(
        `SELECT
          (SELECT count(*)::int FROM recommendation_serving_control
            WHERE manifest_id = 'semantic-profile-hybrid-v1') AS serving_controls,
          (SELECT count(*)::int FROM recommendation_experiment
            WHERE challenger_manifest_id = 'semantic-profile-hybrid-v1') AS experiments,
          (SELECT count(*)::int FROM recommendation_promotion_pointer
            WHERE active_manifest_id = 'semantic-profile-hybrid-v1') AS promotion_pointers`,
      )
      expect(authority.rows).toEqual([
        { serving_controls: 0, experiments: 0, promotion_pointers: 0 },
      ])
    })

    it("publishes U30 authority without activating profile traffic", async () => {
      const manifest = await client.query(
        `SELECT generator, enabled,
          configuration ->> 'shadowManifestId' AS shadow_manifest_id,
          configuration ->> 'shadowDecisionRequired' AS shadow_decision,
          (configuration ->> 'completeServiceDeadlineMs')::int AS deadline_ms
         FROM recommendation_strategy_manifest
         WHERE id = 'multi-interest-profile-pilot-v1'`,
      )
      expect(manifest.rows).toEqual([
        {
          generator: "profile",
          enabled: true,
          shadow_manifest_id: "multi-interest-profile-shadow-v1",
          shadow_decision: "promote_to_experiment",
          deadline_ms: 1500,
        },
      ])
      const authorities = await client.query(
        `SELECT
          (SELECT count(*)::int FROM recommendation_serving_control
            WHERE manifest_id = 'multi-interest-profile-pilot-v1') AS controls,
          (SELECT count(*)::int FROM recommendation_promotion_pointer
            WHERE active_manifest_id = 'multi-interest-profile-pilot-v1') AS pointers,
          (SELECT count(*)::int FROM recommendation_experiment
            WHERE challenger_manifest_id = 'multi-interest-profile-pilot-v1') AS experiments`,
      )
      expect(authorities.rows).toEqual([
        { controls: 0, pointers: 0, experiments: 0 },
      ])
    })

    it("seeds the exact semantic manifest behind a disabled singleton control", async () => {
      const result = await client.query(
        `SELECT c.enabled, c.manifest_id, m.generator, m.max_items
         FROM recommendation_serving_control c
         JOIN recommendation_strategy_manifest m ON m.id = c.manifest_id`,
      )
      expect(result.rows).toEqual([
        {
          enabled: false,
          manifest_id: "semantic-transcript-pgvector-v1",
          generator: "semantic",
          max_items: 6,
        },
      ])
    })

    it("enforces sticky assignment, one actual exposure, and immutable superseding evaluations", async () => {
      await client.query(
        `INSERT INTO recommendation_experiment_assignment (
          id, experiment_id, unit_kind, unit_digest, arm,
          assignment_probability, configuration_digest, generation,
          assigned_at, expires_at
        ) VALUES (
          'experiment-assignment-1', 'semantic-aa-v1', 'anonymous_session',
          $1, 'challenger', 0.5, $2, 1,
          '2026-08-19T00:00:00.000Z', '2026-09-17T00:00:00.000Z'
        )`,
        ["1".repeat(64), "b".repeat(64)],
      )
      await expect(
        client.query(
          `INSERT INTO recommendation_experiment_assignment (
            id, experiment_id, unit_kind, unit_digest, arm,
            assignment_probability, configuration_digest, generation,
            assigned_at, expires_at
          ) VALUES (
            'experiment-assignment-duplicate', 'semantic-aa-v1',
            'anonymous_session', $1, 'control', 0.5, $2, 1,
            '2026-08-19T00:00:01.000Z', '2026-09-17T00:00:00.000Z'
          )`,
          ["1".repeat(64), "b".repeat(64)],
        ),
      ).rejects.toMatchObject({ code: "23505" })
      await expect(
        client.query(
          `INSERT INTO recommendation_experiment_assignment (
            id, experiment_id, unit_kind, unit_digest, arm,
            assignment_probability, configuration_digest, generation,
            assigned_at, expires_at
          ) VALUES (
            'experiment-assignment-generation-2', 'semantic-aa-v1',
            'anonymous_session', $1, 'control', 0.5, $2, 2,
            '2026-08-19T00:00:02.000Z', '2026-09-17T00:00:00.000Z'
          )`,
          ["1".repeat(64), "b".repeat(64)],
        ),
      ).resolves.toBeDefined()

      await client.query("BEGIN")
      await insertRequest("experiment-request", 1)
      await insertItem("experiment-item", "experiment-request", 0)
      await client.query(
        `UPDATE recommendation_request
         SET experiment_assignment_id = 'experiment-assignment-1'
         WHERE id = 'experiment-request'`,
      )
      await client.query("COMMIT")
      await client.query(
        `INSERT INTO recommendation_experiment_exposure (
          id, assignment_id, request_id, item_id, event_id, arm,
          effective_manifest_id, assignment_probability, payload_digest,
          occurred_at, received_at, expires_at
        ) VALUES (
          'experiment-exposure-1', 'experiment-assignment-1',
          'experiment-request', 'experiment-item', 'impression-1',
          'challenger', 'semantic-experiment-aa-v1', 0.5, $1,
          '2026-08-19T00:01:00.000Z', '2026-08-19T00:01:01.000Z', $2
        )`,
        ["2".repeat(64), expiresAt],
      )
      await expect(
        client.query(
          `INSERT INTO recommendation_experiment_exposure (
            id, assignment_id, request_id, item_id, event_id, arm,
            effective_manifest_id, assignment_probability, payload_digest,
            occurred_at, received_at, expires_at
          ) VALUES (
            'experiment-exposure-duplicate', 'experiment-assignment-1',
            'experiment-request', 'experiment-item', 'impression-2',
            'challenger', 'semantic-experiment-aa-v1', 0.5, $1,
            '2026-08-19T00:01:02.000Z', '2026-08-19T00:01:03.000Z', $2
          )`,
          ["3".repeat(64), expiresAt],
        ),
      ).rejects.toMatchObject({ code: "23505" })
      await expect(
        client.query(
          `UPDATE recommendation_experiment_exposure
           SET assignment_probability = 0.4
           WHERE id = 'experiment-exposure-1'`,
        ),
      ).rejects.toThrow("experiment exposures are immutable")

      for (const generation of [1, 2]) {
        await client.query(
          `INSERT INTO recommendation_experiment_evaluation_run (
            id, experiment_id, window_start, window_end, generation,
            state, expires_at
          ) VALUES ($1, 'semantic-aa-v1', '2026-08-01T00:00:00.000Z',
            '2026-08-08T00:00:00.000Z', $2, 'completed',
            '2027-08-19T00:00:00.000Z')`,
          [`experiment-run-${generation}`, generation],
        )
      }
      const insertEvaluation = async (
        id: string,
        runId: string,
        revision: number,
        inputDigest: string,
        supersedesId: string | null,
      ) =>
        client.query(
          `INSERT INTO recommendation_experiment_evaluation (
            id, experiment_id, run_id, revision, supersedes_id, state,
            window_start, window_end, input_captured_at,
            assignment_watermark, exposure_watermark, outcome_watermark,
            mission_watermark, eligibility_watermark,
            assignment_policy_version, outcome_policy_version,
            integrity_policy_version, evaluation_policy_version, input_digest,
            counts, intent_to_treat, exposed_only, uncertainty, guardrails,
            sample_ratio, reason_codes, evaluated_at, expires_at
          ) VALUES (
            $1, 'semantic-aa-v1', $2, $3, $4, 'pass',
            '2026-08-01T00:00:00.000Z', '2026-08-08T00:00:00.000Z',
            '2026-08-09T00:00:00.000Z', '2026-08-09T00:00:00.000Z',
            '2026-08-09T00:00:00.000Z', '2026-08-09T00:00:00.000Z',
            '2026-08-09T00:00:00.000Z', '2026-08-09T00:00:00.000Z',
            'sticky-deterministic-assignment-v1',
            'active-watch-multi-outcome-v1', 'recommendation-integrity-v1',
            'recommendation-experiment-aa-v1', $5, '{}'::jsonb,
            '{"primary":true}'::jsonb, '{"primary":false}'::jsonb,
            '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
            ARRAY['aa_equivalence_guardrails_passed'],
            '2026-08-09T00:00:00.000Z', '2027-08-19T00:00:00.000Z'
          )`,
          [id, runId, revision, supersedesId, inputDigest],
        )
      await insertEvaluation(
        "experiment-evaluation-1",
        "experiment-run-1",
        1,
        "4".repeat(64),
        null,
      )
      await insertEvaluation(
        "experiment-evaluation-2",
        "experiment-run-2",
        2,
        "5".repeat(64),
        "experiment-evaluation-1",
      )
      await expect(
        client.query(
          `UPDATE recommendation_experiment_evaluation SET state = 'fail'
           WHERE id = 'experiment-evaluation-1'`,
        ),
      ).rejects.toThrow("experiment evaluations are immutable")
      const revisions = await client.query(
        `SELECT revision, supersedes_id FROM recommendation_experiment_evaluation
         WHERE experiment_id = 'semantic-aa-v1' ORDER BY revision`,
      )
      expect(revisions.rows).toEqual([
        { revision: 1, supersedes_id: null },
        { revision: 2, supersedes_id: "experiment-evaluation-1" },
      ])
    })

    it("enforces active, revoked, and essential-only consent receipt constraints", async () => {
      await client.query(
        `INSERT INTO recommendation_profile (
          id, token_digest, privacy_generation, choice, state,
          expires_at, updated_at
        ) VALUES (
          'consent-constraint-profile', $1, 1, 'durable_allowed', 'active',
          '2027-02-20T00:00:00.000Z', '2026-08-26T00:00:00.000Z'
        )`,
        ["4".repeat(64)],
      )
      await expect(
        client.query(
          `INSERT INTO recommendation_consent_receipt (
            id, token_digest, contract_version, choice, state, profile_id,
            privacy_generation, expires_at, updated_at
          ) VALUES (
            'consent-active', $1, 'recommendation-consent-v1',
            'personalization', 'active', 'consent-constraint-profile', 1,
            '2027-02-20T00:00:00.000Z', '2026-08-26T00:00:00.000Z'
          )`,
          ["5".repeat(64)],
        ),
      ).resolves.toBeDefined()
      await expect(
        client.query(
          `INSERT INTO recommendation_consent_receipt (
            id, token_digest, contract_version, choice, state, profile_id,
            privacy_generation, expires_at, updated_at
          ) VALUES (
            'consent-invalid-essential', $1, 'recommendation-consent-v1',
            'essential_only', 'active', 'consent-constraint-profile', 1,
            '2027-02-20T00:00:00.000Z', '2026-08-26T00:00:00.000Z'
          )`,
          ["6".repeat(64)],
        ),
      ).rejects.toThrow(
        "recommendation_consent_receipt_choice_generation_check",
      )
      await expect(
        client.query(
          `INSERT INTO recommendation_consent_receipt (
            id, token_digest, contract_version, choice, state, profile_id,
            privacy_generation, expires_at, revoked_at, revoke_reason,
            updated_at
          ) VALUES (
            'consent-invalid-revoked', $1, 'recommendation-consent-v1',
            'personalization', 'revoked', NULL, 1,
            '2027-02-20T00:00:00.000Z', '2026-08-26T00:00:00.000Z',
            'viewer_withdrawal', '2026-08-26T00:00:00.000Z'
          )`,
          ["7".repeat(64)],
        ),
      ).rejects.toThrow("recommendation_consent_receipt_state_check")
    })

    it("publishes the candidate-platform manifest only with both A/A parity gates", async () => {
      const result = await client.query(
        `SELECT id, strategy_version, enabled,
          configuration ->> 'candidateEligibilityParity' AS candidate_parity,
          configuration ->> 'rankerParity' AS ranker_parity,
          configuration ->> 'fallbackManifestId' AS fallback_manifest,
          (configuration ->> 'completeServiceDeadlineMs')::int AS deadline_ms
         FROM recommendation_strategy_manifest
         WHERE id = 'semantic-candidate-platform-v1'`,
      )
      expect(result.rows).toEqual([
        {
          id: "semantic-candidate-platform-v1",
          strategy_version: "semantic-candidate-platform-v1",
          enabled: true,
          candidate_parity: "passed",
          ranker_parity: "passed",
          fallback_manifest: "semantic-transcript-pgvector-v1",
          deadline_ms: 1_500,
        },
      ])
    })

    afterAll(async () => {
      if (!client) return
      await client.query("RESET search_path")
      await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
      await client.end()
    })
  },
)
