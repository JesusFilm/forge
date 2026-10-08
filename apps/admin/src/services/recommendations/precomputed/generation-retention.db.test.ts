import { randomUUID } from "node:crypto"
import { PrismaClient, type Prisma } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { currentAdminMigrationSql } from "../current-schema.test-fixture"
import { submitPrecomputedRecommendation } from "./contract"
import { submitDurablePrecomputedRecommendation } from "./durable-build"
import { purgeExpiredPrecomputedGenerations } from "./generation-retention"

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "precomputed generation retention on PostgreSQL",
  () => {
    let prisma: PrismaClient
    let admin: Client
    const schema = `precomputed_retention_${Date.now()}_${randomUUID().replaceAll("-", "")}`
    const suffix = randomUUID()
    const now = new Date("2026-10-06T12:00:00.000Z")
    const old = new Date("2026-06-01T00:00:00.000Z")
    const sourceVideoId = `retention-source-${suffix}`

    async function generation(
      name: string,
      status: "complete" | "failed" | "incomplete",
      completedAt: Date | null,
      rollbackRetentionHold = false,
      protocolVersion = 2,
    ) {
      const id = `${name}-${suffix}`
      await prisma.recommendationPrecomputedGeneration.create({
        data: {
          id,
          protocolVersion,
          modelId: "gpt-6-astra",
          promptVersion: "storage-v1",
          inputDigest: "a".repeat(64),
          sourceSetDigest: "b".repeat(64),
          inputCutoff: old,
          expectedSourceCount: 1,
          inputMode: "content_only",
          inputSnapshotMode: "observed_fenced",
          status,
          createdAt: old,
          completedAt: status === "complete" ? completedAt : null,
          failedAt: status === "failed" ? old : null,
          failureCode: status === "failed" ? "provider_invalid_output" : null,
          rollbackRetentionHold,
        },
      })
      return id
    }

    beforeAll(async () => {
      admin = new Client({ connectionString: env.DATABASE_URL })
      await admin.connect()
      await admin.query(`CREATE SCHEMA "${schema}"`)
      await admin.query(`SET search_path TO "${schema}", public`)
      for (const migration of currentAdminMigrationSql)
        await admin.query(migration)
      const url = new URL(env.DATABASE_URL)
      url.searchParams.set("schema", schema)
      prisma = new PrismaClient<Prisma.PrismaClientOptions>({
        datasources: { db: { url: url.toString() } },
      })
      await prisma.video.create({
        data: {
          id: sourceVideoId,
          coreId: `core-${sourceVideoId}`,
          slug: sourceVideoId,
        },
      })
    }, 120_000)

    afterAll(async () => {
      await prisma?.$disconnect()
      if (admin) {
        await admin.query("ROLLBACK").catch(() => undefined)
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await admin.end()
      }
    })

    it("deletes expired unprotected terminal descendants but retains active, fixed and rollback generations", async () => {
      const rollback = await generation("rollback", "complete", old, true)
      const expired = await generation(
        "expired",
        "complete",
        new Date("2026-06-02T00:00:00.000Z"),
      )
      const prior = await generation(
        "prior",
        "complete",
        new Date("2026-06-03T00:00:00.000Z"),
      )
      const newest = await generation(
        "newest",
        "complete",
        new Date("2026-06-04T00:00:00.000Z"),
      )
      const failed = await generation("failed", "failed", null)
      const active = await generation("active", "incomplete", null)
      await prisma.recommendationPrecomputedGeneration.update({
        where: { id: expired },
        data: { executionBackend: "codex_chatgpt_subscription" },
      })
      const attemptId = randomUUID()
      await prisma.recommendationPrecomputedExecutionAttempt.create({
        data: {
          generationId: expired,
          attemptId,
          invocation: "start",
          accountRef: "retention-account-123",
          backend: "codex_chatgpt_subscription",
          billingBasis: "included_subscription",
          authMethod: "chatgpt",
          modelId: "gpt-6-astra",
          identityObservedAt: old,
          allowanceObservedAt: old,
          weeklyRemainingPercent: 50,
          fiveHourKind: "limited",
          fiveHourRemainingPercent: 50,
          startedAt: old,
          endedAt: old,
          endReason: "completed",
        },
      })
      await prisma.recommendationPrecomputedModelCall.create({
        data: {
          generationId: expired,
          attemptId,
          callId: `retained-call-${suffix}`,
          sourceVideoId,
          stage: "source_summary",
          status: "failed",
          modelId: "gpt-6-astra",
          inputDigest: "d".repeat(64),
          errorCode: "provider_unavailable",
          startedAt: old,
          finishedAt: old,
        },
      })
      await prisma.recommendationPrecomputedBuildSource.create({
        data: {
          generationId: expired,
          sourceVideoId,
          state: "complete_edges",
          completedAt: old,
        },
      })
      await prisma.recommendationPrecomputedBuildChoice.createMany({
        data: Array.from({ length: 8 }, (_, index) => ({
          generationId: expired,
          sourceVideoId,
          targetVideoId: `target-${index}-${suffix}`,
          payload: { relationship: "related", strength: 100 - index },
          submissionDigest: `${index}`.repeat(64),
        })),
      })
      await prisma.recommendationPrecomputedSource.create({
        data: {
          generationId: expired,
          sourceVideoId,
          payload: Array.from({ length: 8 }, (_, rank) => ({ rank: rank + 1 })),
          submissionDigest: "c".repeat(64),
          acceptedCount: 8,
          status: "complete",
        },
      })
      expect(
        await prisma.recommendationPrecomputedBuildChoice.count({
          where: { generationId: expired },
        }),
      ).toBe(8)

      const first = await prisma.$transaction((tx) =>
        purgeExpiredPrecomputedGenerations(tx, now, 1),
      )
      expect(first).toMatchObject({
        generationsDeleted: 1,
        pageFull: true,
      })
      const second = await prisma.$transaction((tx) =>
        purgeExpiredPrecomputedGenerations(tx, now, 5),
      )
      expect(second).toMatchObject({
        generationsDeleted: 1,
        modelCallsDeleted: 1,
        executionAttemptsDeleted: 1,
        pageFull: true,
      })
      expect(
        (
          await prisma.recommendationPrecomputedGeneration.findMany({
            select: { id: true },
          })
        )
          .map(({ id }) => id)
          .sort(),
      ).toEqual([active, newest, prior, rollback].sort())
      expect(
        await prisma.recommendationPrecomputedBuildChoice.count({
          where: { generationId: expired },
        }),
      ).toBe(0)
      expect(
        await prisma.recommendationPrecomputedSource.count({
          where: { generationId: expired },
        }),
      ).toBe(0)
      expect(
        await prisma.$transaction((tx) =>
          purgeExpiredPrecomputedGenerations(tx, now, 5),
        ),
      ).toMatchObject({ generationsDeleted: 0, pageFull: false })
      expect(
        await prisma.recommendationPrecomputedGeneration.count({
          where: { id: failed },
        }),
      ).toBe(0)
    })

    it("fails an abandoned build, clears stale checkpoints, and preserves unknown paid-call cost", async () => {
      const abandoned = await generation("abandoned", "incomplete", null)
      const leased = await generation("still-leased", "incomplete", null)
      await prisma.recommendationPrecomputedBuildSource.createMany({
        data: [
          {
            generationId: abandoned,
            sourceVideoId,
            state: "claimed",
            claimId: "old-claim",
            leaseToken: randomUUID(),
            leaseExpiresAt: old,
            checkpoint: {
              stage: "catalog_discovery",
              cursor: { catalogIndex: 10 },
            },
            updatedAt: old,
          },
          {
            generationId: leased,
            sourceVideoId,
            state: "claimed",
            claimId: "live-claim",
            leaseToken: randomUUID(),
            leaseExpiresAt: new Date(now.getTime() + 3_600_000),
            checkpoint: {
              stage: "catalog_discovery",
              cursor: { catalogIndex: 10 },
            },
            updatedAt: old,
          },
        ],
      })
      await prisma.recommendationPrecomputedBuildChoice.create({
        data: {
          generationId: abandoned,
          sourceVideoId,
          targetVideoId: `stale-target-${suffix}`,
          payload: { relationship: "related" },
          submissionDigest: "d".repeat(64),
        },
      })
      await prisma.recommendationPrecomputedModelCall.create({
        data: {
          generationId: abandoned,
          callId: `unknown-call-${suffix}`,
          sourceVideoId,
          stage: "candidate_judgment",
          status: "pending",
          modelId: "gpt-6-astra",
          inputDigest: "e".repeat(64),
          startedAt: old,
        },
      })
      const result = await prisma.$transaction((tx) =>
        purgeExpiredPrecomputedGenerations(tx, now, 5),
      )
      expect(result).toMatchObject({
        generationsAbandoned: 1,
        provisionalChoicesPruned: 1,
        generationsDeleted: 0,
      })
      const source =
        await prisma.recommendationPrecomputedBuildSource.findUniqueOrThrow({
          where: {
            generationId_sourceVideoId: {
              generationId: abandoned,
              sourceVideoId,
            },
          },
        })
      expect(source).toMatchObject({ state: "failed", checkpoint: {} })
      expect(
        await prisma.recommendationPrecomputedBuildChoice.count({
          where: { generationId: abandoned },
        }),
      ).toBe(0)
      expect(
        await prisma.recommendationPrecomputedGeneration.findUniqueOrThrow({
          where: { id: leased },
        }),
      ).toMatchObject({ status: "incomplete" })
      expect(
        await submitDurablePrecomputedRecommendation(
          prisma,
          {
            action: "status",
            generationId: abandoned,
            generationInputDigest: "a".repeat(64),
          },
          "Bearer preview-test-key",
        ),
      ).toMatchObject({
        state: "failed",
        protocolVersion: 2,
        inputCutoff: old.toISOString(),
        inputDigest: "a".repeat(64),
        sourceWorkResumable: false,
        failureCode: "abandoned_timeout",
        usage: { modelPendingCount: 1, modelUnknownCostCount: 1 },
      })
      expect(
        await submitDurablePrecomputedRecommendation(
          prisma,
          {
            action: "retention_status",
            protocolVersion: 2,
            generationId: abandoned,
          },
          "Bearer preview-test-key",
        ),
      ).toEqual({
        generationId: abandoned,
        protocolVersion: 2,
        generationProtocolVersion: 2,
        inputCutoff: old.toISOString(),
        inputDigest: "a".repeat(64),
        inputMode: "content_only",
        state: "failed",
        sourceWorkResumable: false,
      })
    })

    it("retires an old legacy source-only generation without touching the two newest", async () => {
      const legacy = await generation("legacy-v1", "complete", old, false, 1)
      await prisma.recommendationPrecomputedSource.create({
        data: {
          generationId: legacy,
          sourceVideoId,
          payload: [{ targetVideoId: "legacy-target", rank: 1 }],
          submissionDigest: "f".repeat(64),
          acceptedCount: 1,
          status: "complete",
        },
      })
      expect(
        await prisma.$transaction((tx) =>
          purgeExpiredPrecomputedGenerations(tx, now, 1),
        ),
      ).toMatchObject({
        generationsDeleted: 1,
        finalSourcesDeleted: 1,
      })
      expect(
        await prisma.recommendationPrecomputedGeneration.findUnique({
          where: { id: legacy },
        }),
      ).toBeNull()
      expect(
        await submitDurablePrecomputedRecommendation(
          prisma,
          {
            action: "retention_status",
            protocolVersion: 2,
            generationId: legacy,
          },
          "Bearer preview-test-key",
        ),
      ).toMatchObject({
        generationId: legacy,
        generationProtocolVersion: 1,
        inputCutoff: old.toISOString(),
        state: "retired",
        sourceWorkResumable: false,
      })
      await expect(
        submitDurablePrecomputedRecommendation(
          prisma,
          {
            action: "start",
            protocolVersion: 2,
            generationId: legacy,
            modelId: "gpt-6-astra",
            promptVersion: "storage-v1",
            inputDigest: "a".repeat(64),
            sourceSetDigest: "b".repeat(64),
            inputCutoff: old.toISOString(),
            expectedSourceCount: 1,
            inputMode: "content_only",
          },
          "Bearer preview-test-key",
        ),
      ).rejects.toThrow("Generation ID was retired")
      await expect(
        submitPrecomputedRecommendation(
          prisma,
          {
            action: "start",
            generationId: legacy,
            modelId: "gpt-6-astra",
            promptVersion: "storage-v1",
            inputDigest: "a".repeat(64),
            sourceSetDigest: "b".repeat(64),
            inputCutoff: old.toISOString(),
            expectedSourceCount: 1,
            inputMode: "content_only",
          },
          "Bearer preview-test-key",
        ),
      ).rejects.toThrow("Generation ID was retired")
    })

    it("drains a large superseded generation across bounded pages before removing its root", async () => {
      const large = await generation("large-expired", "complete", old)
      await prisma.recommendationPrecomputedBuildSource.create({
        data: {
          generationId: large,
          sourceVideoId,
          state: "complete_edges",
          completedAt: old,
        },
      })
      await prisma.recommendationPrecomputedBuildChoice.createMany({
        data: Array.from({ length: 250 }, (_, index) => ({
          generationId: large,
          sourceVideoId,
          targetVideoId: `large-target-${index}-${suffix}`,
          payload: { relationship: "related", strength: 100 },
          submissionDigest: "a".repeat(64),
        })),
      })
      await prisma.recommendationPrecomputedModelCall.createMany({
        data: Array.from({ length: 250 }, (_, index) => ({
          generationId: large,
          callId: `large-call-${index}-${suffix}`,
          sourceVideoId,
          stage: "candidate_judgment",
          status: "succeeded",
          modelId: "gpt-6-astra",
          inputDigest: "e".repeat(64),
          outputDigest: "f".repeat(64),
          costUsd: 0.00001,
          startedAt: old,
          finishedAt: new Date(old.getTime() + 1000),
        })),
      })
      await prisma.recommendationPrecomputedSource.create({
        data: {
          generationId: large,
          sourceVideoId,
          payload: Array.from({ length: 250 }, (_, rank) => ({
            rank: rank + 1,
          })),
          submissionDigest: "b".repeat(64),
          acceptedCount: 250,
          status: "complete",
        },
      })
      const first = await prisma.$transaction((tx) =>
        purgeExpiredPrecomputedGenerations(tx, now, 1),
      )
      expect(first).toMatchObject({
        generationsRetiring: 1,
        generationsDeleted: 0,
        pageFull: true,
      })
      expect(first.provisionalChoicesDeleted).toBeGreaterThan(0)
      expect(first.provisionalChoicesDeleted).toBeLessThanOrEqual(100)
      expect(first.modelCallsDeleted).toBeLessThanOrEqual(100)
      expect(
        await prisma.recommendationPrecomputedGeneration.findUniqueOrThrow({
          where: { id: large },
        }),
      ).toMatchObject({ status: "retiring" })
      expect(
        await submitDurablePrecomputedRecommendation(
          prisma,
          {
            action: "status",
            generationId: large,
            generationInputDigest: "a".repeat(64),
          },
          "Bearer preview-test-key",
        ),
      ).toMatchObject({ state: "retiring", detailsUnavailable: true })
      // A concurrent reader/writer holding the generation row must not make
      // the ordinary retention transaction wait behind it. Releasing that
      // lock lets a later bounded page resume the same retiring generation.
      await admin.query("BEGIN")
      try {
        await admin.query(
          "SELECT id FROM recommendation_precomputed_generation WHERE id = $1 FOR SHARE",
          [large],
        )
        const skipped = await prisma.$transaction((tx) =>
          purgeExpiredPrecomputedGenerations(tx, now, 1),
        )
        expect(skipped.generationsDeleted).toBe(0)
        expect(skipped.finalSourcesDeleted).toBe(0)
      } finally {
        await admin.query("ROLLBACK")
      }
      let totalChoices = first.provisionalChoicesDeleted
      let deleted = 0
      for (let attempt = 0; attempt < 8 && deleted === 0; attempt++) {
        const page = await prisma.$transaction((tx) =>
          purgeExpiredPrecomputedGenerations(tx, now, 1),
        )
        totalChoices += page.provisionalChoicesDeleted
        deleted += page.generationsDeleted
      }
      expect(deleted).toBe(1)
      expect(totalChoices).toBe(250)
      expect(
        await prisma.recommendationPrecomputedGeneration.findUnique({
          where: { id: large },
        }),
      ).toBeNull()
      expect(
        await submitDurablePrecomputedRecommendation(
          prisma,
          {
            action: "retention_status",
            protocolVersion: 2,
            generationId: large,
          },
          "Bearer preview-test-key",
        ),
      ).toMatchObject({
        generationId: large,
        generationProtocolVersion: 2,
        inputCutoff: old.toISOString(),
        state: "retired",
        sourceWorkResumable: false,
      })
    })

    it("keeps a fixed-test generation until its experiment reference is gone", async () => {
      const fixed = await generation("fixed-test", "complete", old)
      const controlId = `retention-control-${suffix}`
      const challengerId = "precomputed-watch-preview-v1"
      await prisma.recommendationStrategyManifest.create({
        data: {
          id: controlId,
          strategyVersion: `control-${suffix}`,
          contractVersion: "storage-fixture-v1",
          surfaceVersion: "watch-v1",
          generator: "semantic",
          maxItems: 6,
        },
      })
      const experimentId = `retention-test-${suffix}`
      await prisma.recommendationPrecomputedExperiment.create({
        data: {
          id: experimentId,
          generationId: fixed,
          controlManifestId: controlId,
          challengerManifestId: challengerId,
          controlManifestDigest: "a".repeat(64),
          controlRoutingDigest: "b".repeat(64),
          sourceSetDigest: "c".repeat(64),
          assignmentPolicyVersion: "fixture-v1",
          eligibilityPolicyVersion: "fixture-v1",
          deliveryPolicyVersion: "fixture-v1",
          configurationDigest: "d".repeat(64),
          startsAt: old,
          endsAt: new Date(old.getTime() + 86_400_000),
          expiresAt: new Date(now.getTime() + 86_400_000),
        },
      })
      expect(
        await prisma.$transaction((tx) =>
          purgeExpiredPrecomputedGenerations(tx, now, 1),
        ),
      ).toMatchObject({ generationsDeleted: 0 })
      expect(
        await prisma.recommendationPrecomputedGeneration.findUnique({
          where: { id: fixed },
        }),
      ).not.toBeNull()
      await prisma.recommendationPrecomputedExperiment.delete({
        where: { id: experimentId },
      })
      expect(
        await prisma.$transaction((tx) =>
          purgeExpiredPrecomputedGenerations(tx, now, 1),
        ),
      ).toMatchObject({ generationsDeleted: 1 })
    })
  },
)
