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

    it("allows only FK-driven lineage detachment while projection children stay immutable", async () => {
      await client.query("BEGIN")
      try {
        const graph = await insertLifecycleGraph("projection-detach")
        await client.query(
          `INSERT INTO recommendation_outcome_revision (
            id, request_id, item_id, episode_id, classifier_version,
            fact_watermark, input_digest, revision, qualified_view,
            view_quality_weight, view_quality_weight_reason,
            active_playback_milliseconds, duration_seconds, duration_cohort,
            active_coverage, learning_eligible, generation, expires_at
          ) VALUES (
            'projection-detach-outcome', $1, $2, $3,
            'active-watch-proxy-v1', 0, $4, 1, true, 0.8,
            'active_fraction_of_duration', 48000, 60, 'medium', 'complete',
            false, 1, $5
          )`,
          [
            graph.requestId,
            graph.itemId,
            graph.episodeId,
            "6".repeat(64),
            expiresAt,
          ],
        )
        await client.query(
          `INSERT INTO recommendation_profile (
            id, token_digest, privacy_generation, choice, state,
            expires_at, updated_at
          ) VALUES (
            'profile-detach', $1, 1, 'durable_allowed', 'active',
            '2027-02-20T00:00:00.000Z', '2026-08-26T00:00:00.000Z'
          )`,
          ["5".repeat(64)],
        )
        await client.query(
          `INSERT INTO recommendation_profile_projection_generation (
            id, manifest_id, scope, profile_id, privacy_generation,
            generation, state, projection_version, clustering_version,
            eligibility_policy_version, outcome_classifier_version,
            input_window_start, input_window_end, input_digest,
            contribution_count, retention_days, published_at, expires_at
          ) VALUES (
            'projection-detach-generation',
            'multi-interest-profile-shadow-v1', 'durable',
            'profile-detach', 1, 1, 'published',
            'multi-interest-profile-projection-v1',
            'deterministic-farthest-first-medoids-v1',
            'recommendation-integrity-v1', 'active-watch-proxy-v1',
            '2026-08-25T00:00:00.000Z', '2026-08-26T00:00:00.000Z',
            $1, 1, 180, '2026-08-26T00:00:00.000Z', $2
          )`,
          ["4".repeat(64), expiresAt],
        )
        await client.query(
          `INSERT INTO recommendation_profile_projection_contribution (
            id, generation_id, kind, source_id_digest, source_outcome_id,
            target_media_id, weight, eligibility_policy_version,
            outcome_classifier_version, privacy_generation, occurred_at,
            expires_at
          ) VALUES (
            'projection-detach-contribution',
            'projection-detach-generation', 'qualified_outcome', $1,
            'projection-detach-outcome', 'video-0', 0.8,
            'recommendation-integrity-v1', 'active-watch-proxy-v1', 1,
            '2026-08-26T00:00:00.000Z', $2
          )`,
          [digest("projection-detach-outcome"), expiresAt],
        )

        await expect(
          client.query(
            `UPDATE recommendation_profile_projection_contribution
             SET weight = 0.5 WHERE id = 'projection-detach-contribution'`,
          ),
        ).rejects.toThrow("published profile projection children are immutable")
        await client.query("ROLLBACK")

        await client.query("BEGIN")
        const graph2 = await insertLifecycleGraph("projection-detach-fk")
        await client.query(
          `INSERT INTO recommendation_outcome_revision (
            id, request_id, item_id, episode_id, classifier_version,
            fact_watermark, input_digest, revision, qualified_view,
            view_quality_weight, view_quality_weight_reason, reasons,
            learning_eligible, generation, expires_at
          ) VALUES ('projection-detach-fk-outcome', $1, $2, $3,
            'legacy-position-v0', 0, $4, 1, false, NULL,
            'continuous_weight_not_available', ARRAY[]::text[], false, 1, $5)`,
          [
            graph2.requestId,
            graph2.itemId,
            graph2.episodeId,
            "3".repeat(64),
            expiresAt,
          ],
        )
        await client.query(
          `INSERT INTO recommendation_profile (
            id, token_digest, privacy_generation, choice, state,
            expires_at, updated_at
          ) VALUES ('profile-detach-fk', $1, 1, 'durable_allowed', 'active',
            '2027-02-20T00:00:00.000Z', '2026-08-26T00:00:00.000Z')`,
          ["2".repeat(64)],
        )
        await client.query(
          `INSERT INTO recommendation_profile_projection_generation (
            id, manifest_id, scope, profile_id, privacy_generation,
            generation, state, projection_version, clustering_version,
            eligibility_policy_version, outcome_classifier_version,
            input_window_start, input_window_end, input_digest,
            contribution_count, retention_days, published_at, expires_at
          ) VALUES ('projection-detach-fk-generation',
            'multi-interest-profile-shadow-v1', 'durable', 'profile-detach-fk',
            1, 1, 'published', 'multi-interest-profile-projection-v1',
            'deterministic-farthest-first-medoids-v1',
            'recommendation-integrity-v1', 'legacy-position-v0',
            '2026-08-25T00:00:00.000Z', '2026-08-26T00:00:00.000Z',
            $1, 1, 180, '2026-08-26T00:00:00.000Z', $2)`,
          ["1".repeat(64), expiresAt],
        )
        await client.query(
          `INSERT INTO recommendation_profile_projection_contribution (
            id, generation_id, kind, source_id_digest, source_outcome_id,
            target_media_id, weight, eligibility_policy_version,
            outcome_classifier_version, privacy_generation, occurred_at,
            expires_at
          ) VALUES ('projection-detach-fk-contribution',
            'projection-detach-fk-generation', 'qualified_outcome', $1,
            'projection-detach-fk-outcome', 'video-0', 0.8,
            'recommendation-integrity-v1', 'legacy-position-v0', 1,
            '2026-08-26T00:00:00.000Z', $2)`,
          [digest("projection-detach-fk-outcome"), expiresAt],
        )
        await client.query(`DELETE FROM recommendation_request WHERE id = $1`, [
          graph2.requestId,
        ])
        const detached = await client.query(
          `SELECT source_outcome_id, source_id_digest
           FROM recommendation_profile_projection_contribution
           WHERE id = 'projection-detach-fk-contribution'`,
        )
        expect(detached.rows).toEqual([
          {
            source_outcome_id: null,
            source_id_digest: digest("projection-detach-fk-outcome"),
          },
        ])
      } finally {
        await client.query("ROLLBACK")
      }
    })

    it("keeps independent legacy and active-proxy revision chains", async () => {
      await client.query("BEGIN")
      const graph = await insertLifecycleGraph("classifier-chains")
      await expect(
        client.query(
          `INSERT INTO recommendation_outcome_revision (
            id, request_id, item_id, episode_id, classifier_version,
            fact_watermark, input_digest, revision, qualified_view,
            view_quality_weight, view_quality_weight_reason,
            active_playback_milliseconds, duration_seconds, duration_cohort,
            active_coverage, learning_eligible, generation, expires_at
          ) VALUES
            ('classifier-legacy-1', $1, $2, $3, 'legacy-position-v0',
              1, $4, 1, false, NULL, 'continuous_weight_not_available',
              NULL, NULL, NULL, NULL, false, 1, $6),
            ('classifier-active-1', $1, $2, $3, 'active-watch-proxy-v1',
              1, $5, 1, true, 0.3, 'active_fraction_of_duration',
              30000, 100, 'medium', 'complete', false, 1, $6)`,
          [
            graph.requestId,
            graph.itemId,
            graph.episodeId,
            "4".repeat(64),
            "5".repeat(64),
            expiresAt,
          ],
        ),
      ).resolves.toBeDefined()
      await client.query("COMMIT")

      await expect(
        client.query(
          `INSERT INTO recommendation_outcome_revision (
            id, request_id, item_id, episode_id, classifier_version,
            fact_watermark, input_digest, revision, qualified_view,
            view_quality_weight, view_quality_weight_reason,
            active_playback_milliseconds, duration_seconds, duration_cohort,
            active_coverage, learning_eligible, generation, expires_at
          ) VALUES ('classifier-active-duplicate', $1, $2, $3,
            'active-watch-proxy-v1', 2, $4, 1, false, 0.1,
            'active_fraction_of_duration', 10000, 100, 'medium', 'complete',
            false, 1, $5)`,
          [
            graph.requestId,
            graph.itemId,
            graph.episodeId,
            "6".repeat(64),
            expiresAt,
          ],
        ),
      ).rejects.toMatchObject({ code: "23505" })
    })

    it("cascades a linked outcome revision chain with its request root", async () => {
      await client.query("BEGIN")
      const graph = await insertLifecycleGraph("outcome-cascade")
      await client.query(
        `INSERT INTO recommendation_outcome_revision (
          id, request_id, item_id, episode_id, classifier_version,
          fact_watermark, input_digest, revision, supersedes_id,
          qualified_view, view_quality_weight, view_quality_weight_reason,
          reasons, learning_eligible, generation, expires_at
        ) VALUES
          ('outcome-cascade-1', $1, $2, $3, 'legacy-position-v0',
            0, $4, 1, NULL, false, NULL,
            'continuous_weight_not_available', ARRAY[]::text[], false, 1, $6),
          ('outcome-cascade-2', $1, $2, $3, 'legacy-position-v0',
            1, $5, 2, 'outcome-cascade-1', false, NULL,
            'continuous_weight_not_available', ARRAY[]::text[], false, 1, $6)`,
        [
          graph.requestId,
          graph.itemId,
          graph.episodeId,
          "1".repeat(64),
          "2".repeat(64),
          expiresAt,
        ],
      )
      await client.query("COMMIT")

      await expect(
        client.query(`DELETE FROM recommendation_request WHERE id = $1`, [
          graph.requestId,
        ]),
      ).resolves.toBeDefined()
      const remaining = await client.query(
        `SELECT
          (SELECT count(*)::int FROM recommendation_request WHERE id = $1) requests,
          (SELECT count(*)::int FROM recommendation_playback_episode WHERE request_id = $1) episodes,
          (SELECT count(*)::int FROM recommendation_outcome_revision WHERE request_id = $1) outcomes`,
        [graph.requestId],
      )
      expect(remaining.rows).toEqual([
        { requests: 0, episodes: 0, outcomes: 0 },
      ])
    })

    it("upserts one bounded conflict row and saturates its attempt counter", async () => {
      await client.query("BEGIN")
      const graph = await insertLifecycleGraph("conflict")
      await client.query("COMMIT")
      const args = [
        graph.requestId,
        "conflict-capability-jti",
        "conflict-event",
        "f".repeat(64),
        "0".repeat(64),
        expiresAt,
      ]

      await expect(
        client.query(
          `SELECT upsert_recommendation_conflict(
            'conflict-row-1', $1, $2, $3, $4, $5, $6
          ) AS attempts`,
          args,
        ),
      ).resolves.toMatchObject({ rows: [{ attempts: 1 }] })
      await expect(
        client.query(
          `SELECT upsert_recommendation_conflict(
            'conflict-row-2', $1, $2, $3, $4, $5, $6
          ) AS attempts`,
          args,
        ),
      ).resolves.toMatchObject({ rows: [{ attempts: 2 }] })
      await client.query(
        `UPDATE recommendation_conflict SET attempts = 1000
         WHERE capability_jti = $1 AND event_id = $2`,
        [args[1], args[2]],
      )
      await expect(
        client.query(
          `SELECT upsert_recommendation_conflict(
            'conflict-row-3', $1, $2, $3, $4, $5, $6
          ) AS attempts`,
          args,
        ),
      ).resolves.toMatchObject({ rows: [{ attempts: 1000 }] })
      const count = await client.query(
        `SELECT count(*)::int AS count FROM recommendation_conflict
         WHERE capability_jti = $1 AND event_id = $2`,
        [args[1], args[2]],
      )
      expect(count.rows).toEqual([{ count: 1 }])
    })

    it("atomically caps capability submissions independent of fresh event ids", async () => {
      const requestId = "submission-budget-request"
      const itemId = "submission-budget-item"
      const capabilityJti = "submission-budget-jti"
      await client.query("BEGIN")
      await insertRequest(requestId, 1)
      await insertItem(itemId, requestId, 0, expiresAt, capabilityJti)
      await client.query("COMMIT")

      const consume = (attempts: number) =>
        client.query(
          `SELECT consume_recommendation_capability_submissions(
            $1, $2, $3, 32, $4
          ) AS attempts`,
          [requestId, capabilityJti, attempts, expiresAt],
        )
      await expect(consume(16)).resolves.toMatchObject({
        rows: [{ attempts: 16 }],
      })
      await expect(consume(16)).resolves.toMatchObject({
        rows: [{ attempts: 32 }],
      })
      // A caller inventing a 33rd event id still consumes the same capability
      // budget row because event identity is deliberately not a function key.
      await expect(consume(1)).resolves.toMatchObject({
        rows: [{ attempts: null }],
      })
      await expect(consume(1)).resolves.toMatchObject({
        rows: [{ attempts: null }],
      })
      await expect(consume(1)).resolves.toMatchObject({
        rows: [{ attempts: null }],
      })
      const saturated = await client.query(
        `SELECT attempts FROM recommendation_capability_submission_budget
         WHERE capability_jti = $1`,
        [capabilityJti],
      )
      expect(saturated.rows).toEqual([{ attempts: 32 }])
      const rejectionAudit = await client.query(
        `SELECT count(*)::int AS rows, max(count)::int AS attempts
         FROM recommendation_evidence_audit
         WHERE request_id = $1
           AND reason_code = 'delivery_submission_budget_exceeded'`,
        [requestId],
      )
      expect(rejectionAudit.rows).toEqual([{ rows: 1, attempts: 3 }])

      const concurrentRequestId = "concurrent-submission-budget-request"
      const concurrentItemId = "concurrent-submission-budget-item"
      const concurrentJti = "concurrent-submission-budget-jti"
      await client.query("BEGIN")
      await insertRequest(concurrentRequestId, 1)
      await insertItem(
        concurrentItemId,
        concurrentRequestId,
        0,
        expiresAt,
        concurrentJti,
      )
      await client.query("COMMIT")

      const contenders = await Promise.all(
        [24, 24].map(async (attempts) => {
          const connection = new Client({ connectionString: databaseUrl })
          await connection.connect()
          try {
            await connection.query(`SET search_path TO "${schemaName}"`)
            const result = await connection.query(
              `SELECT consume_recommendation_capability_submissions(
                $1, $2, $3, 32, $4
              ) AS attempts`,
              [concurrentRequestId, concurrentJti, attempts, expiresAt],
            )
            return result.rows[0]?.attempts as number | null
          } finally {
            await connection.end()
          }
        }),
      )
      expect(contenders.sort((a, b) => Number(a) - Number(b))).toEqual([
        null,
        24,
      ])
      await Promise.all(
        [10, 10].map(async (attempts) => {
          const connection = new Client({ connectionString: databaseUrl })
          await connection.connect()
          try {
            await connection.query(`SET search_path TO "${schemaName}"`)
            const result = await connection.query(
              `SELECT consume_recommendation_capability_submissions(
                $1, $2, $3, 32, $4
              ) AS attempts`,
              [concurrentRequestId, concurrentJti, attempts, expiresAt],
            )
            return result.rows[0]?.attempts as number | null
          } finally {
            await connection.end()
          }
        }),
      )
      const concurrentAudit = await client.query(
        `SELECT count(*)::int AS rows, max(count)::int AS attempts
         FROM recommendation_evidence_audit
         WHERE request_id = $1
           AND reason_code = 'delivery_submission_budget_exceeded'`,
        [concurrentRequestId],
      )
      expect(concurrentAudit.rows).toEqual([{ rows: 1, attempts: 44 }])

      await expect(
        client.query(
          `UPDATE recommendation_capability_submission_budget
           SET expires_at = '2026-09-18T00:00:00.000Z'
           WHERE capability_jti = $1`,
          [capabilityJti],
        ),
      ).rejects.toThrow("child expiry must match request root")
      await client.query(`DELETE FROM recommendation_request WHERE id = $1`, [
        requestId,
      ])
      const cascaded = await client.query(
        `SELECT count(*)::int AS count
         FROM recommendation_capability_submission_budget
         WHERE capability_jti = $1`,
        [capabilityJti],
      )
      expect(cascaded.rows).toEqual([{ count: 0 }])
    })

    it("bounds episode capability submissions and saturates one rejection audit", async () => {
      await client.query("BEGIN")
      const graph = await insertLifecycleGraph("episode-submission-budget")
      await client.query("COMMIT")

      const consume = (attempts: number) =>
        client.query(
          `SELECT consume_recommendation_episode_capability_submissions(
            $1, $2, $3, $4, 256, $5
          ) AS attempts`,
          [
            graph.requestId,
            graph.episodeId,
            "episode-submission-budget-episode-jti",
            attempts,
            expiresAt,
          ],
        )
      await expect(consume(128)).resolves.toMatchObject({
        rows: [{ attempts: 128 }],
      })
      await expect(consume(128)).resolves.toMatchObject({
        rows: [{ attempts: 256 }],
      })
      await expect(consume(1)).resolves.toMatchObject({
        rows: [{ attempts: null }],
      })
      await expect(consume(3)).resolves.toMatchObject({
        rows: [{ attempts: null }],
      })
      const budget = await client.query(
        `SELECT attempts FROM recommendation_capability_submission_budget
         WHERE capability_jti = $1`,
        ["episode-submission-budget-episode-jti"],
      )
      expect(budget.rows).toEqual([{ attempts: 256 }])
      const audit = await client.query(
        `SELECT count(*)::int AS rows, max(count)::int AS attempts
         FROM recommendation_evidence_audit
         WHERE request_id = $1
           AND reason_code = 'episode_submission_budget_exceeded'`,
        [graph.requestId],
      )
      expect(audit.rows).toEqual([{ rows: 1, attempts: 4 }])
    })

    it("accepts a bound parameter for the retrieval statement timeout", async () => {
      await client.query("BEGIN")
      try {
        await expect(
          client.query(`SELECT set_config('statement_timeout', $1, true)`, [
            "1250",
          ]),
        ).resolves.toBeDefined()
        const timeout = await client.query(`SHOW statement_timeout`)
        expect(timeout.rows).toEqual([{ statement_timeout: "1250ms" }])
      } finally {
        await client.query("ROLLBACK")
      }
    })

    it("persists immutable aggregate-only semantic control revisions", async () => {
      const insert = async (input: {
        id: string
        revision: number
        inputDigest: string
        supersedesId?: string
        generator?: string
      }) =>
        client.query(
          `INSERT INTO recommendation_control_evaluation (
            id, manifest_id, strategy_version, contract_version,
            surface_version, generator, serving_control_version,
            policy_version, outcome_policy_version, classifier_version,
            integrity_policy_version, manifest_digest, window_start, window_end,
            input_captured_at, input_digest, revision, supersedes_id, state,
            delivery_outcome, attribution_outcome, maturity_outcome,
            operational_outcome, mission_outcome, guardrail_outcome,
            evidence, rates, uncertainty, policy_configuration, reason_codes,
            explanation, evaluated_at, expires_at
          ) VALUES (
            $1, 'semantic-transcript-pgvector-v1',
            'semantic-transcript-pgvector-v1', 'semantic-recommendation-v1',
            'watch-below-player-v1', $2, 7,
            'semantic-control-readiness-v1',
            'watch-semantic-control-outcomes-v1', 'active-watch-proxy-v1',
            'recommendation-integrity-v1', $3,
            '2026-08-11T00:00:00.000Z', '2026-08-18T00:00:00.000Z',
            '2026-08-19T00:00:00.000Z', $4, $5, $6, 'ready',
            'pass', 'pass', 'pass', 'pass', 'pass', 'pass',
            '{"issuedRequests": 200}'::jsonb, '{"ctr": 0.2}'::jsonb,
            '{"method": "wilson-score-v1"}'::jsonb,
            '{"version": "semantic-control-readiness-v1"}'::jsonb,
            ARRAY['delivery_reliability_met'],
            'Semantic-only is ready; no incremental viewer-value claim is made.',
            '2026-08-19T00:00:00.000Z', '2027-08-19T00:00:00.000Z'
          )`,
          [
            input.id,
            input.generator ?? "semantic",
            "b".repeat(64),
            input.inputDigest,
            input.revision,
            input.supersedesId ?? null,
          ],
        )

      await expect(
        insert({
          id: "evaluation-1",
          revision: 1,
          inputDigest: "c".repeat(64),
        }),
      ).resolves.toBeDefined()
      await expect(
        insert({
          id: "evaluation-invalid",
          revision: 2,
          inputDigest: "d".repeat(64),
          generator: "profile",
        }),
      ).rejects.toThrow("recommendation_control_evaluation_semantic_check")
      await expect(
        insert({
          id: "evaluation-2",
          revision: 2,
          inputDigest: "d".repeat(64),
          supersedesId: "evaluation-1",
        }),
      ).resolves.toBeDefined()

      await client.query(
        `DELETE FROM recommendation_control_evaluation WHERE id = 'evaluation-1'`,
      )
      const retained = await client.query(
        `SELECT revision, supersedes_id AS "supersedesId", purpose,
          identity_class AS "identityClass", access_class AS "accessClass",
          retention_days AS "retentionDays", fallback_behavior AS "fallbackBehavior"
         FROM recommendation_control_evaluation WHERE id = 'evaluation-2'`,
      )
      expect(retained.rows).toEqual([
        {
          revision: 2,
          supersedesId: null,
          purpose: "semantic_control_readiness",
          identityClass: "aggregate_human_no_identity",
          accessClass: "recommendation_aggregate_readers",
          retentionDays: 365,
          fallbackBehavior: "last_known_semantic_control",
        },
      ])
      const comment = await client.query(
        `SELECT obj_description('recommendation_control_evaluation'::regclass) AS comment`,
      )
      expect(comment.rows[0]?.comment).toContain("entirely offline")
      expect(comment.rows[0]?.comment).toContain("1.5-second contract")
    })

    it("enforces exact promotion authority and atomic pointer plus audit commits", async () => {
      const manifestDigest = "9".repeat(64)
      await client.query(
        `INSERT INTO recommendation_promotion_approval (
          id, manifest_id, manifest_digest, max_exposure_bps,
          approved_by_id, approved_at, expires_at
        ) VALUES (
          'promotion-approval-1', 'semantic-experiment-aa-v1', $1, 5000,
          'admin-1', '2026-08-19T10:00:00.000Z',
          '2033-08-19T10:00:00.000Z'
        )`,
        [manifestDigest],
      )
      await expect(
        client.query(
          `INSERT INTO recommendation_promotion_approval (
            id, manifest_id, manifest_digest, max_exposure_bps,
            approved_by_id, approved_at, expires_at
          ) VALUES (
            'promotion-approval-duplicate', 'semantic-experiment-aa-v1',
            $1, 5000, 'admin-2', '2026-08-19T10:00:01.000Z',
            '2033-08-19T10:00:00.000Z'
          )`,
          [manifestDigest],
        ),
      ).rejects.toThrow("recommendation_promotion_approval_exact_key")

      await client.query("BEGIN")
      try {
        await client.query(
          `UPDATE recommendation_promotion_pointer SET
            active_manifest_id = 'semantic-experiment-aa-v1',
            active_approval_id = 'promotion-approval-1', stage = 'bounded',
            exposure_ceiling_bps = 5000, generation = 2
           WHERE id = 'recommendation-promotion-pointer' AND generation = 1`,
        )
        await expect(
          client.query(
            `INSERT INTO recommendation_promotion_event (
              id, dedupe_key, event_type, approval_id, from_manifest_id,
              to_manifest_id, from_stage, to_stage, pointer_generation,
              exposure_ceiling_bps, actor_class, actor_id, reason_code,
              input_digest, details, occurred_at, expires_at
            ) VALUES (
              'promotion-event-invalid', 'activation:invalid',
              'activation_effective', 'promotion-approval-1',
              'semantic-transcript-pgvector-v1', 'semantic-experiment-aa-v1',
              'control', 'bounded', 2, 5000, 'admin', 'admin-1',
              'injected_failure', 'not-a-digest', '{}'::jsonb,
              '2026-08-19T10:01:00.000Z', '2033-08-19T10:01:00.000Z'
            )`,
          ),
        ).rejects.toThrow("recommendation_promotion_event_digest_check")
      } finally {
        await client.query("ROLLBACK")
      }
      const afterFailure = await client.query(
        `SELECT active_manifest_id, stage, generation
         FROM recommendation_promotion_pointer
         WHERE id = 'recommendation-promotion-pointer'`,
      )
      expect(afterFailure.rows).toEqual([
        {
          active_manifest_id: "semantic-transcript-pgvector-v1",
          stage: "control",
          generation: 1,
        },
      ])
      const failedAudit = await client.query(
        `SELECT count(*)::int AS count FROM recommendation_promotion_event
         WHERE id = 'promotion-event-invalid'`,
      )
      expect(failedAudit.rows).toEqual([{ count: 0 }])

      await client.query("BEGIN")
      await client.query(
        `UPDATE recommendation_promotion_pointer SET
          active_manifest_id = 'semantic-experiment-aa-v1',
          active_approval_id = 'promotion-approval-1', stage = 'bounded',
          exposure_ceiling_bps = 5000, generation = 2
         WHERE id = 'recommendation-promotion-pointer' AND generation = 1`,
      )
      await client.query(
        `INSERT INTO recommendation_promotion_event (
          id, dedupe_key, event_type, approval_id, from_manifest_id,
          to_manifest_id, from_stage, to_stage, pointer_generation,
          exposure_ceiling_bps, actor_class, actor_id, reason_code,
          input_digest, details, occurred_at, expires_at
        ) VALUES (
          'promotion-event-effective', 'activation:effective',
          'activation_effective', 'promotion-approval-1',
          'semantic-transcript-pgvector-v1', 'semantic-experiment-aa-v1',
          'control', 'bounded', 2, 5000, 'admin', 'admin-1',
          'bounded_evaluation_passed', $1, '{}'::jsonb,
          '2026-08-19T10:02:00.000Z', '2033-08-19T10:02:00.000Z'
        )`,
        ["8".repeat(64)],
      )
      await client.query("COMMIT")

      const staleCas = await client.query(
        `UPDATE recommendation_promotion_pointer SET generation = 3
         WHERE id = 'recommendation-promotion-pointer' AND generation = 1`,
      )
      expect(staleCas.rowCount).toBe(0)
      await expect(
        client.query(
          `UPDATE recommendation_promotion_event
           SET reason_code = 'rewritten'
           WHERE id = 'promotion-event-effective'`,
        ),
      ).rejects.toThrow("recommendation promotion audit is immutable")

      const lifecycle = await client.query(
        `SELECT purpose, identity_class, access_class, ingestion_health,
          deletion_behavior, fallback_behavior, retention_days
         FROM recommendation_promotion_pointer
         WHERE id = 'recommendation-promotion-pointer'`,
      )
      expect(lifecycle.rows).toEqual([
        {
          purpose: "online_promotion_authority",
          identity_class: "no_viewer_identity",
          access_class: "recommendation_promotion_readers",
          ingestion_health: "not_applicable_online_pointer",
          deletion_behavior: "singleton_never_deleted",
          fallback_behavior: "last_known_good_manifest",
          retention_days: 0,
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
