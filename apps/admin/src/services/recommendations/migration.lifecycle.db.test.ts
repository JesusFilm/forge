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

    async function insertLifecycleGraph(
      prefix: string,
      {
        mediaId = "video-0",
        sessionDigest = "a".repeat(64),
      }: { mediaId?: string; sessionDigest?: string } = {},
    ) {
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
        ) VALUES ($1, $2, $3, $4, $5, $6, 'claimed', $7, 'kid-1',
          '2026-08-19T07:00:00.000Z', '2026-08-19T09:00:00.000Z', 1,
          '2026-08-19T03:00:00.000Z', $8)`,
        [
          episodeId,
          requestId,
          itemId,
          selectionId,
          mediaId,
          sessionDigest,
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
      const preGrant = await insertLifecycleGraph(
        "eligibility-projection-pre-grant",
        {
          mediaId: "eligibility-projection-pre-grant-video",
          sessionDigest: "d".repeat(64),
        },
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
      const graph = await insertLifecycleGraph("eligibility-projection", {
        mediaId: "eligibility-projection-video",
      })
      // This source starts after the durable consent watermark used below.
      // The pre-grant fixture above deliberately keeps its August 19
      // selection/episode initiation while finalizing on August 26.
      await client.query(
        `UPDATE recommendation_selection
         SET occurred_at = '2026-08-25T01:00:00.000Z'
         WHERE id = $1`,
        [graph.selectionId],
      )
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
          active_coverage, learning_eligible, generation, expires_at
        ) VALUES (
          'eligibility-projection-outcome', $1, $2, $3,
          'active-watch-proxy-v1', 0, $4, 1, true, 0.8,
          'active_fraction_of_duration', 48000, 60, 'medium', 'complete',
          false, 1, $5
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
        ).resolves.toMatchObject({ revision: 2, state: "eligible" })
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
          revision: 3,
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
            active_coverage, learning_eligible, generation, expires_at
          ) VALUES ('eligibility-projection-superseding', $1, $2, $3,
            'active-watch-proxy-v1', 1, $4, 2,
            'eligibility-projection-outcome', false, 0.1,
            'active_fraction_of_duration', 6000, 60, 'medium', 'complete',
            false, 1, $5)`,
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
          revisions: [1, 2, 3],
          current_flags: [false, false, true],
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
