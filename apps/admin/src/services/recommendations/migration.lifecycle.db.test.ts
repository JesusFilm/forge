import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { RecommendationIntegrityService } from "./integrity.service"
import { loadDatabaseProfileProjectionEvidence } from "./profiles/profile-projection.service"
import { purgeExpiredRecommendationRequests } from "./retention.service"

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
  "0075_recommendation_selection_attribution_eligibility",
  "0076_recommendation_profile_eligibility_reconciliation",
  "0082_user_recommendation_identity",
  "0098_recommendation_viewing_mode",
  "0100_recommendation_candidate_compact_trace",
  "0101_recommendation_candidate_compact_trace_validate",
  "0102_recommendation_candidate_stage_duplicate_index_drop",
  "0103_recommendation_impression_visibility_capability",
  "0104_recommendation_cowatch_shadow",
  "0106_recommendation_cowatch_source_window",
  "0107_recommendation_governed_study",
  "0108_recommendation_cowatch_frozen_trial",
  "0109_recommendation_composition_authority",
  "0110_recommendation_live_policy_manifests",
  "0118_recommendation_candidate_stage_expiry_index_drop",
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

    // Keep creation on the fixed fixture timeline instead of the database clock.
    async function insertRequest(
      id: string,
      expectedItemCount: number,
      createdAt = "2026-08-19T00:00:00.000Z",
      requestExpiresAt = expiresAt,
    ) {
      await client.query(
        `INSERT INTO "recommendation_request" (
          "id", "contract_version", "surface_version", "manifest_id",
          "strategy_version", "classifier_version", "session_digest",
          "seed_media_id", "locale", "expected_item_count", "result", "expires_at", "created_at"
        ) VALUES ($1, 'semantic-recommendation-v1', 'watch-below-player-v1',
          'semantic-transcript-pgvector-v1', 'semantic-transcript-pgvector-v1',
          'legacy-position-v0', $2, 'seed-video', 'en', $3, 'served', $4, $5)`,
        [id, "a".repeat(64), expectedItemCount, requestExpiresAt, createdAt],
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

    async function insertLifecycleGraph(prefix: string, createdAt?: string) {
      const requestId = `${prefix}-request`
      const itemId = `${prefix}-item`
      const selectionId = `${prefix}-selection`
      const episodeId = `${prefix}-episode`
      await insertRequest(requestId, 1, createdAt)
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

    async function markSelectionAttributionEligible(
      graph: Awaited<ReturnType<typeof insertLifecycleGraph>>,
      occurredAt: string,
    ): Promise<void> {
      await client.query(
        `INSERT INTO recommendation_impression (
          id, request_id, item_id, capability_jti, event_id,
          payload_digest, visibility_policy, occurred_at, received_at,
          expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6,
          'visibility-qualified', $7, $7, $8)`,
        [
          `${graph.selectionId}-impression`,
          graph.requestId,
          graph.itemId,
          `${graph.selectionId}-impression-jti`,
          `${graph.selectionId}-impression-event`,
          digest(`${graph.selectionId}-impression`),
          occurredAt,
          expiresAt,
        ],
      )
      await client.query(
        `UPDATE recommendation_selection
         SET attribution_eligible_at = $1
         WHERE id = $2`,
        [occurredAt, graph.selectionId],
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

    it("bounds recovery before fact hydration at retained-ledger cardinality", async () => {
      await client.query("BEGIN")
      await client.query(`
        INSERT INTO recommendation_request (
          id, contract_version, surface_version, manifest_id,
          strategy_version, classifier_version, session_digest,
          seed_media_id, locale, expected_item_count, result,
          created_at, expires_at
        )
        SELECT
          'scale-request-' || n,
          'semantic-recommendation-v1',
          'watch-below-player-v1',
          'semantic-transcript-pgvector-v1',
          'semantic-transcript-pgvector-v1',
          'legacy-position-v0',
          repeat('a', 64),
          'seed-video',
          'en',
          1,
          'served',
          '2026-08-01T00:00:00.000Z',
          CASE WHEN n = 20004
            THEN '2026-08-18T00:00:00.000Z'::timestamptz
            ELSE '2026-09-17T00:00:00.000Z'::timestamptz
          END
        FROM generate_series(1, 20004) n
      `)
      await client.query(`
        INSERT INTO recommendation_served_item (
          id, request_id, position, target_media_id, canonical_href,
          candidate_generator, candidate_provenance, created_at, expires_at
        )
        SELECT
          'scale-item-' || n,
          'scale-request-' || n,
          0,
          'scale-video-' || n,
          '/watch/scale-video-' || n,
          'semantic',
          '{}'::jsonb,
          '2026-08-01T00:00:00.000Z',
          CASE WHEN n = 20004
            THEN '2026-08-18T00:00:00.000Z'::timestamptz
            ELSE '2026-09-17T00:00:00.000Z'::timestamptz
          END
        FROM generate_series(1, 20004) n
      `)
      await client.query(`
        INSERT INTO recommendation_selection (
          id, request_id, item_id, capability_jti, event_id,
          payload_digest, claim_nonce_digest, handoff_expires_at,
          occurred_at, received_at, expires_at
        )
        SELECT
          'scale-selection-' || n,
          'scale-request-' || n,
          'scale-item-' || n,
          'scale-selection-cap-' || n,
          'scale-selection-event-' || n,
          md5('payload-' || n) || md5('payload-' || n),
          md5('claim-' || n) || md5('claim-' || n),
          '2026-08-02T00:00:00.000Z',
          '2026-08-01T00:00:00.000Z',
          '2026-08-01T00:00:00.000Z',
          CASE WHEN n = 20004
            THEN '2026-08-18T00:00:00.000Z'::timestamptz
            ELSE '2026-09-17T00:00:00.000Z'::timestamptz
          END
        FROM generate_series(1, 20004) n
      `)
      await client.query(`
        INSERT INTO recommendation_playback_episode (
          id, request_id, item_id, selection_id, media_id, session_digest,
          state, capability_jti, signing_kid, active_until, hard_until,
          finalization_due_at, claimed_at, created_at, expires_at
        )
        SELECT
          'scale-episode-' || n,
          'scale-request-' || n,
          'scale-item-' || n,
          'scale-selection-' || n,
          'scale-video-' || n,
          repeat('a', 64),
          'claimed',
          'scale-episode-cap-' || n,
          'kid-1',
          CASE
            WHEN n = 20001 THEN '2026-08-18T01:00:00.000Z'::timestamptz
            WHEN n = 20002 OR n = 20003 THEN '2026-08-20T01:00:00.000Z'::timestamptz
            WHEN n = 20004 THEN '2026-08-17T01:00:00.000Z'::timestamptz
            ELSE '2026-08-10T01:00:00.000Z'::timestamptz
          END,
          CASE
            WHEN n = 20001 THEN '2026-08-18T02:00:00.000Z'::timestamptz
            WHEN n = 20002 OR n = 20003 THEN '2026-08-21T01:00:00.000Z'::timestamptz
            WHEN n = 20004 THEN '2026-08-17T02:00:00.000Z'::timestamptz
            ELSE '2026-08-10T02:00:00.000Z'::timestamptz
          END,
          CASE
            WHEN n = 20001 THEN '2026-08-18T01:00:00.000Z'::timestamptz
            WHEN n = 20002 THEN '2026-08-19T02:00:00.000Z'::timestamptz
            WHEN n = 20003 THEN '2026-08-20T01:00:00.000Z'::timestamptz
            WHEN n = 20004 THEN '2026-08-17T01:00:00.000Z'::timestamptz
            ELSE NULL
          END,
          '2026-08-01T00:00:00.000Z',
          '2026-08-01T00:00:00.000Z',
          CASE WHEN n = 20004
            THEN '2026-08-18T00:00:00.000Z'::timestamptz
            ELSE '2026-09-17T00:00:00.000Z'::timestamptz
          END
        FROM generate_series(1, 20004) n
      `)
      await client.query("COMMIT")
      await client.query(
        `
        INSERT INTO recommendation_playback_fact (
          id, request_id, item_id, episode_id, capability_jti, event_id,
          payload_digest, sequence, kind, occurred_at, received_at, expires_at
        ) VALUES (
          'scale-terminal-fact', 'scale-request-20002', 'scale-item-20002',
          'scale-episode-20002', 'scale-episode-cap-20002',
          'scale-terminal-event', $1, 1, 'playback_end',
          '2026-08-19T02:00:00.000Z', '2026-08-19T02:00:00.000Z', $2
        )
      `,
        ["f".repeat(64), expiresAt],
      )
      await client.query("ANALYZE recommendation_playback_episode")
      await client.query("ANALYZE recommendation_playback_fact")

      const recoverySql = `
        WITH due AS MATERIALIZED (
          SELECT episode.id, episode.generation,
            episode.active_until AS "activeUntil",
            episode.finalization_due_at AS "finalizationDueAt"
          FROM recommendation_playback_episode episode
          WHERE episode.finalization_due_at <= $1
            AND episode.expires_at > $1
          ORDER BY episode.finalization_due_at, episode.id
          LIMIT 100
        )
        SELECT due.id, due.generation, due."activeUntil",
          due."finalizationDueAt",
          COALESCE(terminal."hasTerminal", false) AS "hasTerminal"
        FROM due
        LEFT JOIN LATERAL (
          SELECT true AS "hasTerminal"
          FROM recommendation_playback_fact terminal_fact
          WHERE terminal_fact.episode_id = due.id
            AND terminal_fact.kind IN ('playback_end', 'playback_error')
          LIMIT 1
        ) terminal ON true
        ORDER BY due."finalizationDueAt", due.id
      `
      const due = await client.query(recoverySql, ["2026-08-19T03:00:00.000Z"])
      expect(due.rows.map((row) => row.id)).toEqual([
        "scale-episode-20001",
        "scale-episode-20002",
      ])

      const explained = await client.query(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${recoverySql}`,
        ["2026-08-19T03:00:00.000Z"],
      )
      type PlanNode = {
        "Node Type"?: string
        "Relation Name"?: string
        "Index Name"?: string
        "Actual Rows"?: number
        "Actual Loops"?: number
        Plans?: PlanNode[]
      }
      const nodes: PlanNode[] = []
      const visit = (node: PlanNode) => {
        nodes.push(node)
        node.Plans?.forEach(visit)
      }
      const root = explained.rows[0]?.["QUERY PLAN"]?.[0]?.Plan as
        | PlanNode
        | undefined
      expect(root).toBeDefined()
      visit(root!)
      expect(
        nodes.some(
          (node) =>
            node["Index Name"] ===
            "recommendation_episode_finalization_due_idx",
        ),
      ).toBe(true)
      expect(
        nodes.some(
          (node) =>
            node["Node Type"] === "Seq Scan" &&
            node["Relation Name"] === "recommendation_playback_episode",
        ),
      ).toBe(false)
      const dueIndexNode = nodes.find(
        (node) =>
          node["Index Name"] === "recommendation_episode_finalization_due_idx",
      )
      expect(dueIndexNode?.["Actual Rows"]).toBeLessThanOrEqual(100)
      const factNode = nodes.find(
        (node) => node["Relation Name"] === "recommendation_playback_fact",
      )
      expect(factNode?.["Actual Loops"]).toBeLessThanOrEqual(due.rows.length)
    }, 30_000)

    it("cascades raw rows while atomically clearing retained trace-access links", async () => {
      await insertRequest("trace-access-request", 0)
      const actorDigest = digest("operator-1")
      await client.query(
        `INSERT INTO recommendation_trace_access_audit
          (id, request_id, actor_digest, reason_code, expires_at)
         VALUES ('access-1', 'trace-access-request', $1, 'trace_detail',
           '2026-11-17T00:00:00.000Z')`,
        [actorDigest],
      )
      await client.query(
        `DELETE FROM recommendation_request WHERE id = 'trace-access-request'`,
      )
      const result = await client.query(
        `SELECT request_id, actor_digest, reason_code
         FROM recommendation_trace_access_audit WHERE id = 'access-1'`,
      )
      expect(result.rows).toEqual([
        {
          request_id: null,
          actor_digest: actorDigest,
          reason_code: "trace_detail",
        },
      ])
    })

    it("purges an expired request with populated content-action lineage", async () => {
      const rootExpiry = "2026-07-01T00:00:00.000Z"
      await client.query("BEGIN")
      try {
        await client.query(
          `INSERT INTO recommendation_request (
          id, contract_version, surface_version, manifest_id,
          strategy_version, classifier_version, session_digest,
          seed_media_id, locale, expected_item_count, result, created_at,
          expires_at
        ) VALUES (
          'retention-lineage-request', 'semantic-recommendation-v1',
          'watch-below-player-v1', 'semantic-transcript-pgvector-v1',
          'semantic-transcript-pgvector-v1', 'legacy-position-v0', $1,
          'seed-video', 'en', 1, 'served',
          '2026-06-30T00:00:00.000Z', $2
        )`,
          ["9".repeat(64), rootExpiry],
        )
        await client.query(
          `INSERT INTO recommendation_served_item (
          id, request_id, position, target_media_id, canonical_href,
          candidate_generator, candidate_provenance, expires_at
        ) VALUES (
          'retention-lineage-item', 'retention-lineage-request', 0,
          'retention-lineage-video', '/watch/retention-lineage-video',
          'semantic', '{}'::jsonb, $1
        )`,
          [rootExpiry],
        )
        await client.query(
          `INSERT INTO recommendation_content_action (
          id, contract_version, session_digest, event_id, payload_digest,
          action_class, action_kind, actor_class, purpose, target_media_id,
          request_id, item_id, candidate_generator, occurred_at, expires_at
        ) VALUES (
          'retention-lineage-action', 'recommendation-content-action-v1', $1,
          'retention-lineage-event', $2, 'human_action', 'share',
          'human_anonymous', 'watch', 'retention-lineage-video',
          'retention-lineage-request', 'retention-lineage-item', 'semantic',
          '2026-06-30T23:00:00.000Z', $3
        )`,
          ["9".repeat(64), "8".repeat(64), rootExpiry],
        )
        await client.query("COMMIT")
      } catch (error) {
        await client.query("ROLLBACK")
        throw error
      }

      const fixtureUrl = new URL(databaseUrl)
      fixtureUrl.searchParams.delete("options")
      fixtureUrl.searchParams.set("schema", schemaName)
      const prisma = new PrismaClient({
        datasources: { db: { url: fixtureUrl.toString() } },
      })
      try {
        await expect(
          purgeExpiredRecommendationRequests(
            prisma,
            new Date("2026-07-02T00:00:00.000Z"),
            1,
          ),
        ).resolves.toMatchObject({ status: "succeeded", rootsDeleted: 1 })
      } finally {
        await prisma.$disconnect()
      }

      const remaining = await client.query(
        `SELECT
          (SELECT count(*)::int FROM recommendation_request
           WHERE id = 'retention-lineage-request') AS requests,
          (SELECT count(*)::int FROM recommendation_content_action
           WHERE id = 'retention-lineage-action') AS actions`,
      )
      expect(remaining.rows).toEqual([{ requests: 0, actions: 0 }])
    })

    it("cascades both legacy stage rows and compact candidate traces through expired roots", async () => {
      const rootExpiry = "2026-07-01T00:00:00.000Z"
      const rootCreatedAt = "2026-06-02T00:00:00.000Z"
      await insertRequest(
        "retention-legacy-request",
        0,
        rootCreatedAt,
        rootExpiry,
      )
      await insertRequest(
        "retention-compact-request",
        0,
        rootCreatedAt,
        rootExpiry,
      )
      const runValues = [
        ["retention-legacy-run", "retention-legacy-request"],
        ["retention-compact-run", "retention-compact-request"],
      ]
      for (const [runId, requestId] of runValues) {
        await client.query(
          `INSERT INTO recommendation_candidate_run (
            id, request_id, purpose, context_version, generator_version,
            union_version, eligibility_version, ranker_version,
            composer_version, candidate_eligibility_parity, ranker_parity,
            nominated_count, canonicalized_count, deduplicated_count,
            rejected_count, scored_count, ordered_count, composed_count,
            evidence_complete, expires_at
          ) VALUES (
            $1, $2, 'watch', 'recommendation-context-v1',
            'semantic-transcript-candidate-v1', 'canonical-video-union-v1',
            'watch-playable-locale-v1', 'semantic-deterministic-ranker-v1',
            'minimal-playable-slate-v1', 'passed', 'passed',
            1, 0, 0, 0, 0, 0, 0, true, $3
          )`,
          [runId, requestId, rootExpiry],
        )
      }
      await client.query(
        `INSERT INTO recommendation_candidate_stage_evidence (
          id, run_id, stage, ordinal, candidate_key, expires_at
        ) VALUES (
          'retention-legacy-stage', 'retention-legacy-run', 'nominated',
          0, 'video-a', $1
        )`,
        [rootExpiry],
      )
      const compactStage = {
        id: "retention-compact-stage",
        stage: "nominated",
        ordinal: 0,
        candidateKey: "video-b",
        targetMediaId: "video-b",
        sourceGenerator: "semantic",
        sourceRank: 1,
        sourceScore: 0.9,
        normalizedScore: null,
        rrfScore: null,
        deterministicScore: null,
        finalPosition: null,
        reasonCodes: [],
        sourceEvidence: [],
        createdAt: rootCreatedAt,
      }
      await client.query(
        `UPDATE recommendation_candidate_run
         SET trace_format_version = 1, trace_payload = $1::jsonb
         WHERE id = 'retention-compact-run'`,
        [JSON.stringify({ stages: [compactStage] })],
      )

      const fixtureUrl = new URL(databaseUrl)
      fixtureUrl.searchParams.delete("options")
      fixtureUrl.searchParams.set("schema", schemaName)
      const prisma = new PrismaClient({
        datasources: { db: { url: fixtureUrl.toString() } },
      })
      try {
        await expect(
          purgeExpiredRecommendationRequests(
            prisma,
            new Date("2026-07-02T00:00:00.000Z"),
            2,
          ),
        ).resolves.toMatchObject({
          status: "succeeded",
          rootsDeleted: 2,
          batchLimitReached: true,
          rowCounts: {
            candidateRuns: 2,
            candidateStageEvidence: 1,
          },
        })
      } finally {
        await prisma.$disconnect()
      }
      const remaining = await client.query(
        `SELECT
          (SELECT count(*)::int FROM recommendation_request
           WHERE id IN ('retention-legacy-request', 'retention-compact-request'))
            AS requests,
          (SELECT count(*)::int FROM recommendation_candidate_run
           WHERE id IN ('retention-legacy-run', 'retention-compact-run'))
            AS runs,
          (SELECT count(*)::int FROM recommendation_candidate_stage_evidence
           WHERE id = 'retention-legacy-stage') AS legacy_stages`,
      )
      expect(remaining.rows).toEqual([
        { requests: 0, runs: 0, legacy_stages: 0 },
      ])
    })

    it("enforces immutable request lifecycle and one-use handoff claims", async () => {
      await client.query("BEGIN")
      const graph = await insertLifecycleGraph("lifecycle")
      await client.query("COMMIT")

      await expect(
        client.query(
          `UPDATE recommendation_request SET generation = generation + 1
           WHERE id = $1`,
          [graph.requestId],
        ),
      ).rejects.toThrow("recommendation request lifecycle is immutable")
      await expect(
        client.query(
          `UPDATE recommendation_request
           SET expires_at = '2026-09-18T00:00:00.000Z' WHERE id = $1`,
          [graph.requestId],
        ),
      ).rejects.toThrow("recommendation request lifecycle is immutable")

      await expect(
        client.query(
          `UPDATE recommendation_selection
           SET claimed_at = '2026-08-19T03:01:00.000Z' WHERE id = $1`,
          [graph.selectionId],
        ),
      ).resolves.toBeDefined()
      await expect(
        client.query(
          `UPDATE recommendation_selection
           SET claimed_at = '2026-08-19T03:02:00.000Z' WHERE id = $1`,
          [graph.selectionId],
        ),
      ).rejects.toThrow("recommendation handoff is one use")
    })

    it("keeps playback facts and outcome revisions append-only", async () => {
      await client.query("BEGIN")
      const graph = await insertLifecycleGraph("append-only")
      await client.query(
        `INSERT INTO recommendation_playback_fact (
          id, request_id, item_id, episode_id, capability_jti, event_id,
          payload_digest, sequence, kind, payload, occurred_at, expires_at
        ) VALUES ($1, $2, $3, $4, $5, 'playback-start', $6, 1,
          'playback_start', '{}'::jsonb, '2026-08-19T03:01:00.000Z', $7)`,
        [
          "append-only-fact",
          graph.requestId,
          graph.itemId,
          graph.episodeId,
          "append-only-episode-jti",
          "d".repeat(64),
          expiresAt,
        ],
      )
      await client.query(
        `INSERT INTO recommendation_outcome_revision (
          id, request_id, item_id, episode_id, classifier_version,
          fact_watermark, input_digest, revision, qualified_view,
          view_quality_weight, view_quality_weight_reason, reasons,
          learning_eligible, generation, expires_at
        ) VALUES ('append-only-outcome', $1, $2, $3, 'legacy-position-v0',
          1, $4, 1, false, NULL, 'continuous_weight_not_available',
          ARRAY[]::text[], false, 1, $5)`,
        [
          graph.requestId,
          graph.itemId,
          graph.episodeId,
          "e".repeat(64),
          expiresAt,
        ],
      )
      await client.query("COMMIT")

      await expect(
        client.query(
          `UPDATE recommendation_playback_fact
           SET payload = '{"changed":true}'::jsonb WHERE id = 'append-only-fact'`,
        ),
      ).rejects.toThrow("recommendation fact/revision is append only")
      await expect(
        client.query(
          `UPDATE recommendation_outcome_revision
           SET qualified_view = true WHERE id = 'append-only-outcome'`,
        ),
      ).rejects.toThrow("recommendation fact/revision is append only")
    })

    it("executes eligibility projection against PostgreSQL without mutating its immutable outcome", async () => {
      await client.query("BEGIN")
      const preGrant = await insertLifecycleGraph(
        "eligibility-projection-pre-grant",
      )
      await markSelectionAttributionEligible(
        preGrant,
        "2026-08-19T03:00:00.000Z",
      )
      await client.query(
        `UPDATE recommendation_playback_episode
         SET media_id = 'eligibility-projection-pre-grant-video',
           session_digest = $1, state = 'finalized',
           finalized_at = '2026-08-26T00:00:00.000Z'
         WHERE id = $2`,
        ["d".repeat(64), preGrant.episodeId],
      )
      await client.query(
        `INSERT INTO recommendation_outcome_revision (
          id, request_id, item_id, episode_id, classifier_version,
          fact_watermark, input_digest, revision, qualified_view,
          view_quality_weight, view_quality_weight_reason,
          active_playback_milliseconds, duration_seconds, duration_cohort,
          active_coverage, learning_eligible, generation, created_at, expires_at
        ) VALUES (
          'eligibility-projection-pre-grant-outcome', $1, $2, $3,
          'active-watch-proxy-v1', 0, $4, 1, true, 0.8,
          'active_fraction_of_duration', 48000, 60, 'medium', 'complete',
          false, 1, '2026-08-26T00:00:00.000Z', $5
        )`,
        [
          preGrant.requestId,
          preGrant.itemId,
          preGrant.episodeId,
          "9".repeat(64),
          expiresAt,
        ],
      )
      const graph = await insertLifecycleGraph(
        "eligibility-projection",
        "2026-08-25T00:00:00.000Z",
      )
      await client.query(
        `UPDATE recommendation_playback_episode
         SET media_id = 'eligibility-projection-video', session_digest = $1,
           state = 'finalized', finalized_at = '2026-08-25T02:00:00.000Z'
         WHERE id = $2`,
        ["a".repeat(64), graph.episodeId],
      )
      // This source starts after the durable consent watermark used below.
      // The pre-grant fixture above deliberately keeps its August 19
      // selection/episode initiation while finalizing on August 26.
      await client.query(
        `UPDATE recommendation_selection
         SET occurred_at = '2026-08-25T01:00:00.000Z'
         WHERE id = $1`,
        [graph.selectionId],
      )
      await markSelectionAttributionEligible(graph, "2026-08-25T01:00:00.000Z")
      await client.query(
        `UPDATE recommendation_playback_episode
         SET claimed_at = '2026-08-25T01:00:01.000Z'
         WHERE id = $1`,
        [graph.episodeId],
      )
      await client.query(
        `INSERT INTO recommendation_outcome_revision (
          id, request_id, item_id, episode_id, classifier_version,
          fact_watermark, input_digest, revision, qualified_view,
          view_quality_weight, view_quality_weight_reason,
          active_playback_milliseconds, duration_seconds, duration_cohort,
          active_coverage, learning_eligible, generation, expires_at, created_at
        ) VALUES (
          'eligibility-projection-outcome', $1, $2, $3,
          'active-watch-proxy-v1', 0, $4, 1, true, 0.8,
          'active_fraction_of_duration', 48000, 60, 'medium', 'complete',
          false, 1, $5, '2026-08-25T02:00:00.000Z'
        )`,
        [
          graph.requestId,
          graph.itemId,
          graph.episodeId,
          "7".repeat(64),
          expiresAt,
        ],
      )
      await client.query("COMMIT")

      const url = new URL(databaseUrl)
      url.searchParams.delete("options")
      url.searchParams.set("schema", schemaName)
      const prisma = new PrismaClient({
        datasources: { db: { url: url.toString() } },
      })
      let decisionId = 0
      try {
        const service = new RecommendationIntegrityService({
          prisma,
          now: () => new Date("2026-08-26T00:00:00.000Z"),
          newId: () => `eligibility-decision-${++decisionId}`,
        })
        await expect(
          service.classifyPlaybackOutcome("eligibility-projection-outcome"),
        ).resolves.toMatchObject({
          revision: 1,
          state: "eligible",
          eligibleScopes: ["profile"],
        })
        await expect(
          service.classifyPlaybackOutcome("eligibility-projection-outcome"),
        ).resolves.toMatchObject({ revision: 1, state: "eligible" })
        await expect(
          service.classifyPlaybackOutcome(
            "eligibility-projection-pre-grant-outcome",
          ),
        ).resolves.toMatchObject({ state: "eligible" })

        await client.query(
          `INSERT INTO recommendation_profile (
            id, token_digest, privacy_generation, choice, state,
            expires_at, created_at, updated_at
          ) VALUES ('eligibility-profile', $1, 1, 'durable_allowed', 'active',
            '2027-02-20T00:00:00.000Z', '2026-08-25T00:00:00.000Z',
            '2026-08-25T00:00:00.000Z')`,
          ["e".repeat(64)],
        )
        await client.query(
          `INSERT INTO recommendation_profile_session_link (
            id, profile_id, privacy_generation, session_digest, linked_at,
            expires_at
          ) VALUES ('eligibility-profile-link', 'eligibility-profile', 1, $1,
            '2026-08-25T00:00:00.000Z', '2026-08-27T00:00:00.000Z')`,
          ["a".repeat(64)],
        )
        const eligible = await loadDatabaseProfileProjectionEvidence(prisma, {
          sessionDigest: "a".repeat(64),
          profileId: "eligibility-profile",
          privacyGeneration: 1,
          now: new Date("2026-08-26T12:00:00.000Z"),
        })
        expect(eligible.durable).toEqual([
          expect.objectContaining({
            sourceId: "eligibility-projection-outcome",
            targetMediaId: "eligibility-projection-video",
            eligibilityPolicyVersion: "recommendation-integrity-v1",
            outcomeClassifierVersion: "active-watch-proxy-v1",
            sourceExpiresAt: new Date(expiresAt),
          }),
        ])

        await client.query(
          `INSERT INTO recommendation_promotion_slate_fence (
            id, request_id, pointer_generation, reason_code, fenced_at,
            expires_at
          ) VALUES (
            'eligibility-projection-fence', $1, 2, 'promotion_rollback',
            '2026-08-26T12:00:00.000Z', $2
          )`,
          [graph.requestId, expiresAt],
        )
        await expect(
          service.classifyPlaybackOutcome("eligibility-projection-outcome"),
        ).resolves.toMatchObject({
          revision: 2,
          state: "excluded",
          reasonCodes: ["promotion_rollback"],
          eligibleScopes: [],
        })
        const rollbackFenced = await loadDatabaseProfileProjectionEvidence(
          prisma,
          {
            sessionDigest: "a".repeat(64),
            profileId: "eligibility-profile",
            privacyGeneration: 1,
            now: new Date("2026-08-26T12:00:00.000Z"),
          },
        )
        expect(rollbackFenced.durable).toEqual([])

        await client.query(
          `INSERT INTO recommendation_outcome_revision (
            id, request_id, item_id, episode_id, classifier_version,
            fact_watermark, input_digest, revision, supersedes_id,
            qualified_view, view_quality_weight, view_quality_weight_reason,
            active_playback_milliseconds, duration_seconds, duration_cohort,
            active_coverage, learning_eligible, generation, expires_at, created_at
          ) VALUES ('eligibility-projection-superseding', $1, $2, $3,
            'active-watch-proxy-v1', 1, $4, 2,
            'eligibility-projection-outcome', false, 0.1,
            'active_fraction_of_duration', 6000, 60, 'medium', 'complete',
            false, 1, $5, '2026-08-26T12:00:00.000Z')`,
          [
            graph.requestId,
            graph.itemId,
            graph.episodeId,
            "8".repeat(64),
            expiresAt,
          ],
        )
        await expect(
          service.classifyPlaybackOutcome("eligibility-projection-superseding"),
        ).resolves.toMatchObject({
          state: "excluded",
          eligibleScopes: [],
        })
        const rebuilt = await loadDatabaseProfileProjectionEvidence(prisma, {
          sessionDigest: "a".repeat(64),
          profileId: "eligibility-profile",
          privacyGeneration: 1,
          now: new Date("2026-08-26T12:00:00.000Z"),
        })
        expect(rebuilt.durable).toEqual([])
      } finally {
        await prisma.$disconnect()
      }

      const result = await client.query(
        `SELECT
          (SELECT learning_eligible FROM recommendation_outcome_revision
           WHERE id = 'eligibility-projection-outcome') AS source_eligible,
          array_agg(revision ORDER BY revision)::int[] AS revisions,
          array_agg(is_current ORDER BY revision)::boolean[] AS current_flags
         FROM recommendation_eligibility_decision
         WHERE outcome_id = 'eligibility-projection-outcome'`,
      )
      expect(result.rows).toEqual([
        {
          source_eligible: false,
          revisions: [1, 2],
          current_flags: [false, true],
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

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "recommendation fact index migration on PostgreSQL",
  () => {
    it("preserves identity, lineage, old-reader lookup, and expiry access", async () => {
      const client = new Client({ connectionString: env.DATABASE_URL })
      await client.connect()
      try {
        await client.query("BEGIN")
        const id = `fact-index-${Date.now()}`
        const requestId = `${id}-request`
        const otherRequestId = `${id}-other-request`
        const itemId = `${id}-item`
        const otherItemId = `${id}-other-item`
        const expiresAt = "2026-10-29T12:00:00.000Z"

        for (const [request, count] of [
          [requestId, 2],
          [otherRequestId, 1],
        ] as const) {
          await client.query(
            `INSERT INTO recommendation_request
              (id, contract_version, surface_version, manifest_id,
               strategy_version, classifier_version, session_digest,
               seed_media_id, locale, expected_item_count, result, expires_at)
             VALUES ($1, 'semantic-recommendation-v1', 'watch-below-player-v1',
               'semantic-transcript-pgvector-v1', 'semantic-transcript-pgvector-v1',
               'legacy-position-v0', $2, 'seed-video', 'en', $3, 'served', $4)`,
            [request, "a".repeat(64), count, expiresAt],
          )
        }
        for (const [item, position] of [
          [itemId, 0],
          [otherItemId, 1],
        ] as const) {
          await client.query(
            `INSERT INTO recommendation_served_item
              (id, request_id, position, target_media_id, canonical_href,
               candidate_generator, candidate_provenance, expires_at)
             VALUES ($1, $2, $3, $4, '/watch/video', 'semantic', '{}'::jsonb, $5)`,
            [item, requestId, position, `video-${position}`, expiresAt],
          )
        }

        const facts = [
          ["recommendation_rendered_fact", "recommendation_render"],
          ["recommendation_impression", "recommendation_impression"],
        ] as const
        for (const [table, prefix] of facts) {
          const capability = `${id}-${prefix}-capability`
          const insert = async (
            factId: string,
            request: string,
            item: string,
            event: string,
            jti = capability,
          ) =>
            client.query(
              `INSERT INTO ${table}
                (id, request_id, item_id, capability_jti, event_id,
                 payload_digest, occurred_at, expires_at${table === "recommendation_impression" ? ", visibility_policy" : ""})
               VALUES ($1, $2, $3, $4, $5, $6, now(), $7${table === "recommendation_impression" ? ", 'observer-v1'" : ""})`,
              [factId, request, item, jti, event, "b".repeat(64), expiresAt],
            )
          await insert(`${id}-${prefix}-fact`, requestId, itemId, "event-1")

          const oldReader = await client.query(
            `SELECT id FROM ${table} WHERE request_id = $1 AND item_id = $2`,
            [requestId, itemId],
          )
          expect(oldReader.rows).toEqual([{ id: `${id}-${prefix}-fact` }])
          const byItem = await client.query(
            `SELECT id FROM ${table} WHERE item_id = $1`,
            [itemId],
          )
          expect(byItem.rows).toEqual(oldReader.rows)

          const rejects = async (
            attempt: () => Promise<unknown>,
            code: string,
          ) => {
            await client.query("SAVEPOINT fact_attempt")
            try {
              await expect(attempt()).rejects.toMatchObject({ code })
            } finally {
              await client.query("ROLLBACK TO SAVEPOINT fact_attempt")
              await client.query("RELEASE SAVEPOINT fact_attempt")
            }
          }
          await rejects(
            () =>
              insert(
                `${id}-${prefix}-duplicate-item`,
                requestId,
                itemId,
                "event-2",
                `${capability}-new`,
              ),
            "23505",
          )
          await rejects(
            () =>
              insert(
                `${id}-${prefix}-duplicate-capability`,
                requestId,
                otherItemId,
                "event-2",
              ),
            "23505",
          )
          await rejects(
            () =>
              insert(
                `${id}-${prefix}-wrong-request`,
                otherRequestId,
                otherItemId,
                "event-3",
                `${capability}-new`,
              ),
            "23503",
          )

          const indexes = await client.query<{ indexname: string }>(
            `SELECT indexname FROM pg_indexes WHERE tablename = $1`,
            [table],
          )
          const names = indexes.rows.map(({ indexname }) => indexname)
          expect(names).toContain(`${prefix}_request_idx`)
          expect(names).toContain(`${table}_expires_at_idx`)
          expect(names).toContain(`${prefix}_item_key`)
          expect(names).toContain(`${prefix}_capability_key`)
          expect(names).not.toContain(`${prefix}_event_key`)
          expect(names).toContain(`${prefix}_item_request_key`)
        }

        // A request root still owns fact lifetime through the retained FKs.
        await client.query("DELETE FROM recommendation_request WHERE id = $1", [
          requestId,
        ])
        for (const [table] of facts) {
          const result = await client.query(
            `SELECT id FROM ${table} WHERE request_id = $1`,
            [requestId],
          )
          expect(result.rows).toHaveLength(0)
        }
      } finally {
        await client.query("ROLLBACK")
        await client.end()
      }
    })
  },
)
