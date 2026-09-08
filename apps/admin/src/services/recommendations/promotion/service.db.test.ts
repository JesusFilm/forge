import { readFileSync } from "node:fs"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { RecommendationPromotionService } from "./service"

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
      `../../../../prisma/migrations/${migration}/migration.sql`,
      import.meta.url,
    ),
    "utf8",
  ),
)

describe.skipIf(!RUN_REAL_DB_TEST)(
  "hybrid-only promotion against real PostgreSQL",
  () => {
    const schemaName = `recommendation_profile_promotion_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2)}`
    const now = new Date("2026-08-26T12:00:00.000Z")
    let client: Client
    let prisma: PrismaClient
    let sequence = 0

    beforeAll(async () => {
      client = new Client({ connectionString: env.DATABASE_URL })
      await client.connect()
      await client.query(`CREATE SCHEMA "${schemaName}"`)
      await client.query(`SET search_path TO "${schemaName}", public`)
      for (const migration of migrationSql) await client.query(migration)
      await client.query(
        `INSERT INTO recommendation_shadow_evaluation (
          id, manifest_id, generator_version, sampling_version,
          context_version, eligibility_version, retention_policy_version,
          state, window_start, window_end, requested_sample_size,
          sampled_count, processed_count, coverage, overlap, novelty,
          diversity, rejection, latency_p95_ms, cohort_quality,
          input_freshness_p95_ms, input_digest, expires_at
        ) VALUES (
          'profile-promotion-shadow', 'multi-interest-profile-shadow-v1',
          'multi-interest-profile-candidate-v1',
          'deterministic-live-context-sampling-v1',
          'recommendation-profile-context-v1', 'watch-playable-locale-v1',
          'recommendation-shadow-aggregate-365d-v1', 'terminal',
          '2026-08-25T00:00:00.000Z', '2026-08-26T00:00:00.000Z',
          1, 1, 1, 1, 0.5, 0.5, 0.5, 0, 100, 1, 1000, $1,
          '2027-08-26T00:00:00.000Z'
        )`,
        ["a".repeat(64)],
      )
      await client.query(
        `INSERT INTO recommendation_shadow_decision (
          id, evaluation_id, decision, reason_code,
          reevaluation_condition, input_digest, decided_at, expires_at
        ) VALUES (
          'profile-promotion-decision', 'profile-promotion-shadow',
          'promote_to_experiment', 'shadow_evidence_meets_policy',
          'reopen_if_manifest_or_eligibility_version_changes', $1, $2,
          '2027-08-26T00:00:00.000Z'
        )`,
        ["b".repeat(64), now],
      )
      await client.query(
        `INSERT INTO recommendation_shadow_evaluation (
          id, manifest_id, generator_version, sampling_version,
          context_version, eligibility_version, retention_policy_version,
          state, window_start, window_end, requested_sample_size,
          sampled_count, processed_count, coverage, overlap, novelty,
          diversity, rejection, latency_p95_ms, cohort_quality,
          input_freshness_p95_ms, input_digest, expires_at
        ) VALUES (
          'hybrid-promotion-shadow', 'semantic-profile-hybrid-v1',
          'semantic-profile-hybrid-generators-v1',
          'deterministic-live-context-sampling-v1',
          'recommendation-context-v1', 'watch-playable-locale-v1',
          'recommendation-shadow-aggregate-365d-v1', 'terminal',
          '2026-08-25T00:00:00.000Z', '2026-08-26T00:00:00.000Z',
          1, 1, 1, 1, 0.5, 0.5, 0.5, 0, 100, 1, 1000, $1,
          '2027-08-26T00:00:00.000Z'
        )`,
        ["c".repeat(64)],
      )
      await client.query(
        `INSERT INTO recommendation_shadow_decision (
          id, evaluation_id, decision, reason_code,
          reevaluation_condition, input_digest, decided_at, expires_at
        ) VALUES (
          'hybrid-promotion-decision', 'hybrid-promotion-shadow',
          'promote_to_experiment', 'shadow_evidence_meets_policy',
          'reopen_if_manifest_or_eligibility_version_changes', $1, $2,
          '2027-08-26T00:00:00.000Z'
        )`,
        ["d".repeat(64), now],
      )

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

    it("rejects profile-only authority and atomically opens the exact hybrid experiment", async () => {
      const service = new RecommendationPromotionService({
        prisma,
        now: () => now,
        newId: () => `profile-promotion-${++sequence}`,
        invalidateCaches: () => {},
      })
      const actor = { id: "profile-promotion-admin", role: "ADMIN" } as const
      await expect(
        service.approveBoundedStage({
          actor,
          manifestId: "multi-interest-profile-pilot-v1",
          maxExposureBps: 1250,
        }),
      ).rejects.toThrow(/required evidence/i)

      const firstApproval = await service.approveBoundedStage({
        actor,
        manifestId: "semantic-profile-hybrid-v1",
        maxExposureBps: 1250,
      })
      const replayedApproval = await service.approveBoundedStage({
        actor,
        manifestId: "semantic-profile-hybrid-v1",
        maxExposureBps: 1250,
      })
      expect(replayedApproval.id).toBe(firstApproval.id)

      const run = await service.createRun({
        actor,
        action: "activate_bounded",
        expectedPointerGeneration: 1,
        targetManifestId: "semantic-profile-hybrid-v1",
        approvalId: firstApproval.id,
        evaluationId: null,
        exposureCeilingBps: 1250,
        recentAuthentication: true,
      })
      const claim = await service.claimRun({
        runId: run.id,
        expectedGeneration: run.generation,
      })
      expect(claim.status).toBe("claimed")
      if (claim.status !== "claimed") return
      await expect(
        service.executeClaimedRun({
          runId: run.id,
          expectedGeneration: run.generation,
          claimId: claim.claimId,
        }),
      ).resolves.toEqual({ status: "activated", generation: 2 })

      const pointer = await prisma.recommendationPromotionPointer.findUnique({
        where: { id: "recommendation-promotion-pointer" },
      })
      expect(pointer).toMatchObject({
        activeManifestId: "semantic-profile-hybrid-v1",
        stage: "BOUNDED",
        exposureCeilingBps: 1250,
        generation: 2,
      })
      const experiments = await prisma.recommendationExperiment.findMany({
        orderBy: { createdAt: "asc" },
      })
      expect(experiments).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "semantic-aa-v1",
            state: "CLOSED",
            generation: 2,
          }),
          expect.objectContaining({
            state: "ACTIVE",
            controlManifestId: "semantic-transcript-pgvector-v1",
            challengerManifestId: "semantic-profile-hybrid-v1",
            challengerProbability: 0.125,
            assignmentPolicyVersion: "sticky-deterministic-assignment-v1",
            evaluationPolicyVersion: "recommendation-hybrid-personalized-v1",
            purpose: "anonymous_hybrid_personalization",
          }),
        ]),
      )
      await expect(
        prisma.recommendationPromotionEvent.count({
          where: { eventType: "APPROVAL_RECORDED" },
        }),
      ).resolves.toBe(1)
      await expect(
        prisma.recommendationPromotionEvent.findFirst({
          where: { eventType: "ACTIVATION_EFFECTIVE" },
          select: { reasonCode: true },
        }),
      ).resolves.toEqual({
        reasonCode: "bounded_hybrid_shadow_authorized",
      })

      for (const [action, exposureCeilingBps] of [
        ["activate_bounded", 1_500],
        ["confirm_permanent", 10_000],
      ] as const) {
        await expect(
          service.createRun({
            actor,
            action,
            expectedPointerGeneration: 2,
            targetManifestId: "semantic-profile-hybrid-v1",
            approvalId: firstApproval.id,
            evaluationId: null,
            exposureCeilingBps,
            recentAuthentication: true,
          }),
        ).rejects.toThrow(/live evaluation/i)
      }
      await expect(
        prisma.recommendationPromotionPointer.findUnique({
          where: { id: "recommendation-promotion-pointer" },
          select: {
            activeManifestId: true,
            stage: true,
            exposureCeilingBps: true,
            generation: true,
          },
        }),
      ).resolves.toEqual({
        activeManifestId: "semantic-profile-hybrid-v1",
        stage: "BOUNDED",
        exposureCeilingBps: 1250,
        generation: 2,
      })
    }, 30_000)
  },
)
