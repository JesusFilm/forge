import { WorkflowsPG } from "@mastra/pg"
import { PrismaClient } from "@prisma/client"
import { Client, Pool } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { env } from "../../apps/admin/src/config/env"
import { currentAdminMigrationSql } from "../../apps/admin/src/services/recommendations/current-schema.test-fixture"
import { purgeExpiredPrecomputedGenerations } from "../../apps/admin/src/services/recommendations/precomputed/generation-retention"
import { readPrecomputedCatalog } from "../../apps/admin/src/services/recommendations/precomputed/catalog"
import { loadPrecomputedRecommendationComparison } from "../../apps/admin/src/services/recommendations/precomputed/contract"
import {
  loadDurablePrecomputedBuildReport,
  submitDurablePrecomputedRecommendation,
} from "../../apps/admin/src/services/recommendations/precomputed/durable-build"
// Repository-owned native seam; neither application imports the other.
import { runPrecomputedCatalog } from "../../apps/mastra/src/services/precomputed-recommendations/catalog-generation"
import { prunePrecomputedAbandonedRuntimeSnapshots } from "../../apps/mastra/src/mastra/precomputed-runtime-retention"
import type { StructuredModel } from "../../apps/mastra/src/services/precomputed-recommendations/astra-provider"
import type {
  SourceCatalog,
  SourceIngest,
} from "../../apps/mastra/src/services/precomputed-recommendations/source-generation"

import { gaWatchHistoryFixtureOptions } from "./fixtures/ga-watch-history"

const bearer = "Bearer preview-test-key"
const reviewer = { id: "preview-operator", role: "ADMIN" } as const

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "resumable catalog producer through native Admin review",
  () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const schema = `catalog_producer_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const sourceId = `a-catalog-source-${suffix}`
    const targetId = `b-catalog-target-${suffix}`
    const initialGenerationId = `catalog-resume-${suffix}`
    let prisma: PrismaClient
    let admin: Client
    const cutoff = "2026-10-05T00:00:00.000Z"
    const catalogCreatedAt = new Date("2026-10-04T00:00:00.000Z")
    const catalogTimestamps = {
      createdAt: catalogCreatedAt,
      updatedAt: catalogCreatedAt,
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
      prisma = new PrismaClient({
        datasources: { db: { url: url.toString() } },
      })
      const languageId = `catalog-language-${suffix}`
      const muxId = `catalog-mux-${suffix}`
      await prisma.language.create({
        data: {
          id: languageId,
          coreId: languageId,
          slug: "english",
          ...catalogTimestamps,
        },
      })
      await prisma.muxVideo.create({
        data: {
          id: muxId,
          playbackId: `catalog-playback-${suffix}`,
          ...catalogTimestamps,
        },
      })
      for (const [index, id] of [sourceId, targetId].entries()) {
        await prisma.video.create({
          data: {
            id,
            coreId: `core-${id}`,
            slug: `story-${index}-${suffix}`,
            ...catalogTimestamps,
          },
        })
        await prisma.videoLocale.create({
          data: {
            ...catalogTimestamps,
            id: `locale-${id}`,
            videoId: id,
            locale: "en",
            status: "PUBLISHED",
            title: index === 0 ? "Courage on the journey" : "Hope after loss",
            description: "A distinct story about finding hope during hardship.",
          },
        })
        await prisma.videoDub.create({
          data: {
            ...catalogTimestamps,
            id: `dub-${id}`,
            coreId: `dub-core-${id}`,
            videoId: id,
            languageId,
            muxVideoId: muxId,
            published: true,
          },
        })
      }
    }, 120_000)

    afterAll(async () => {
      await prisma?.$disconnect()
      if (admin) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await admin.end()
      }
    })

    function dependencies(): { catalog: SourceCatalog; ingest: SourceIngest } {
      return {
        catalog: {
          async video(input) {
            const result = await readPrecomputedCatalog(
              prisma,
              { action: "video", ...input },
              bearer,
            )
            if (result.action !== "video") throw new Error("Wrong response")
            return result.video
          },
          async catalog(input) {
            const result = await readPrecomputedCatalog(
              prisma,
              { action: "catalog", ...input },
              bearer,
            )
            if (result.action !== "catalog") throw new Error("Wrong response")
            return result
          },
          async chunks(input) {
            const result = await readPrecomputedCatalog(
              prisma,
              { action: "chunks", ...input },
              bearer,
            )
            if (result.action !== "chunks") throw new Error("Wrong response")
            return result
          },
        },
        ingest: (input) =>
          submitDurablePrecomputedRecommendation(prisma, input, bearer),
      }
    }

    function controlledModel(
      recommendationId: string,
      paidRequests: Array<{ task: string; sourceId: string }>,
    ): StructuredModel {
      return {
        async generate({ schema: outputSchema, prompt }) {
          const data = JSON.parse(prompt) as {
            task: string
            untrustedCatalogData: { source: { id: string } }
          }
          paidRequests.push({
            task: data.task,
            sourceId: data.untrustedCatalogData.source.id,
          })
          if (
            data.task === "catalog_discovery" ||
            data.task === "analytics_query_plan"
          ) {
            return {
              output: outputSchema.parse({
                candidateVideoIds:
                  data.untrustedCatalogData.source.id === sourceId
                    ? [recommendationId]
                    : [],
              }),
              usage: { inputTokens: 100, outputTokens: 20, costUsd: 0.01 },
            }
          }
          if (data.task !== "candidate_judgment")
            throw new Error(`Unexpected external model task: ${data.task}`)
          return {
            output: outputSchema.parse({
              connections: [
                {
                  kind: "direct",
                  relationship: "hope_through_hardship",
                  reasonEnglish:
                    "This distinct story adds another perspective on finding hope.",
                  evidence: {
                    basis: "metadata",
                    fields: ["title", "description"],
                  },
                  strength: 90,
                },
              ],
            }),
            usage: { inputTokens: 200, outputTokens: 40, costUsd: 0.02 },
          }
        },
      }
    }

    async function fixtureCapacity() {
      const result = await admin.query<{
        cluster_system_id: string
        database_bytes: string
      }>(
        "SELECT (SELECT system_identifier::text FROM pg_control_system()) AS cluster_system_id, pg_database_size(current_database())::text AS database_bytes",
      )
      return {
        measuredAt: new Date().toISOString(),
        clusterSystemId: result.rows[0]!.cluster_system_id,
        observedDbBytes: Number(result.rows[0]!.database_bytes),
        // Synthetic physical attestation on the real fixture cluster. These
        // values test the gate, not production headroom or footprint.
        availableBytes: 20_000_000_000,
        reserveBytes: 5_000_000_000,
        projectedBytes: 1_000_000,
        sampleSourceCount: 2,
        sampleBytes: 100_000,
        source: "operator_verified_pgdata_df" as const,
      }
    }

    it("resumes a committed paid step after response loss and publishes the full cohort once", async () => {
      const generationId = initialGenerationId
      const paidRequests: Array<{ task: string; sourceId: string }> = []
      const model = controlledModel(targetId, paidRequests)
      const input = {
        generationId,
        inputCutoff: cutoff,
        historyRequired: false,
        capacity: await fixtureCapacity(),
      }
      const first = dependencies()
      let disconnected = false
      let lastAction: unknown
      let generationInputDigest: string | undefined
      const lostResponseIngest: SourceIngest = async (request) => {
        if (disconnected) throw new Error("Fixture transport disconnected")
        if (
          typeof request === "object" &&
          request !== null &&
          "action" in request
        )
          lastAction = request.action
        if (
          typeof request === "object" &&
          request !== null &&
          "action" in request &&
          request.action === "start" &&
          "inputDigest" in request &&
          typeof request.inputDigest === "string"
        )
          generationInputDigest = request.inputDigest
        const response = await first.ingest(request)
        if (
          typeof request === "object" &&
          request !== null &&
          "action" in request &&
          request.action === "model_call"
        ) {
          disconnected = true
          throw new Error("Fixture response lost after committed paid step")
        }
        return response
      }
      const interruption: unknown = await runPrecomputedCatalog(input, {
        ...first,
        ingest: lostResponseIngest,
        model,
      }).then(
        () => null,
        (error: unknown) => error,
      )
      expect(interruption).toBeInstanceOf(Error)
      expect(
        disconnected,
        `Interrupted at ${String(lastAction)}: ${interruption instanceof Error ? interruption.message : "no error"}`,
      ).toBe(true)
      expect(paidRequests).toEqual([{ task: "catalog_discovery", sourceId }])
      const retentionStatus = () =>
        first.ingest({
          action: "retention_status",
          protocolVersion: 2,
          generationId,
        })
      expect(await retentionStatus()).toMatchObject({
        generationId,
        generationProtocolVersion: 2,
        inputCutoff: cutoff,
        inputDigest: generationInputDigest,
        inputMode: "content_only",
        sourceWorkResumable: true,
      })
      const privateReview = () =>
        loadPrecomputedRecommendationComparison(prisma, {
          sourceVideoId: sourceId,
          generationId,
          audioLanguageSlug: "english",
          reviewer,
        })
      expect(await privateReview()).toMatchObject({
        state: "incomplete",
        experimental: [],
      })

      // Arrange elapsed wall time after a crashed process. Assertions below
      // use public status/review; no private database state verifies behavior.
      await admin.query(
        "UPDATE recommendation_precomputed_build_source SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE generation_id=$1 AND state='claimed'",
        [generationId],
      )
      const resumed = await runPrecomputedCatalog(input, {
        ...dependencies(),
        model,
      })
      expect(resumed).toMatchObject({
        state: "complete",
        completedSourceCount: 2,
        failedSourceCount: 0,
      })
      expect(paidRequests).toEqual([
        { task: "catalog_discovery", sourceId },
        { task: "candidate_judgment", sourceId },
        { task: "catalog_discovery", sourceId: targetId },
      ])
      expect(await privateReview()).toMatchObject({
        state: "ready",
        allAcceptedCount: 1,
        experimental: [expect.objectContaining({ targetVideoId: targetId })],
      })
      const status = await dependencies().ingest({
        action: "status",
        generationId,
        generationInputDigest,
        sourceVideoId: targetId,
      })
      expect(status).toMatchObject({
        state: "complete",
        completeEdgesSourceCount: 1,
        completeEmptySourceCount: 1,
        failedSourceCount: 0,
        source: { state: "complete_empty" },
        usage: {
          modelCallCount: 3,
          modelKnownCostUsd: 0.04,
          modelUnknownCostCount: 0,
          modelPendingCount: 0,
          inputTokens: 400,
          outputTokens: 80,
          historyCallCount: 0,
        },
      })
      await expect(
        runPrecomputedCatalog(input, { ...dependencies(), model }),
      ).resolves.toMatchObject({ state: "replayed" })
      expect(paidRequests).toHaveLength(3)
      expect(await retentionStatus()).toMatchObject({
        generationId,
        generationProtocolVersion: 2,
        inputCutoff: cutoff,
        inputDigest: generationInputDigest,
        inputMode: "content_only",
        sourceWorkResumable: false,
      })
    })

    it("refreshes existing sources for a newly eligible target while preserving the prior generation", async () => {
      const baselineGenerationId = `catalog-before-refresh-${suffix}`
      await expect(
        runPrecomputedCatalog(
          {
            generationId: baselineGenerationId,
            inputCutoff: cutoff,
            historyRequired: false,
            capacity: await fixtureCapacity(),
          },
          { ...dependencies(), model: controlledModel(targetId, []) },
        ),
      ).resolves.toMatchObject({ state: "complete", completedSourceCount: 2 })
      const newTargetId = `c-catalog-new-${suffix}`
      const createdAt = new Date(new Date(cutoff).getTime() + 1_000)
      await prisma.video.create({
        data: {
          id: newTargetId,
          coreId: `core-${newTargetId}`,
          slug: `new-story-${suffix}`,
          createdAt,
          updatedAt: createdAt,
        },
      })
      await prisma.videoLocale.create({
        data: {
          createdAt,
          updatedAt: createdAt,
          id: `locale-${newTargetId}`,
          videoId: newTargetId,
          locale: "en",
          status: "PUBLISHED",
          title: "Hope in a new beginning",
          description: "A new story develops the theme of hope after hardship.",
        },
      })
      await prisma.videoDub.create({
        data: {
          createdAt,
          updatedAt: createdAt,
          id: `dub-${newTargetId}`,
          coreId: `dub-core-${newTargetId}`,
          videoId: newTargetId,
          languageId: `catalog-language-${suffix}`,
          muxVideoId: `catalog-mux-${suffix}`,
          published: true,
        },
      })
      const paidRequests: Array<{ task: string; sourceId: string }> = []
      const generationId = `catalog-refresh-${suffix}`
      await expect(
        runPrecomputedCatalog(
          {
            generationId,
            inputCutoff: new Date(createdAt.getTime() + 1_000).toISOString(),
            historyRequired: false,
            capacity: await fixtureCapacity(),
          },
          {
            ...dependencies(),
            model: controlledModel(newTargetId, paidRequests),
          },
        ),
      ).resolves.toMatchObject({
        state: "complete",
        completedSourceCount: 3,
        failedSourceCount: 0,
      })
      const review = (savedGenerationId: string) =>
        loadPrecomputedRecommendationComparison(prisma, {
          generationId: savedGenerationId,
          sourceVideoId: sourceId,
          audioLanguageSlug: "english",
          reviewer,
        })
      expect(await review(generationId)).toMatchObject({
        state: "ready",
        allAcceptedCount: 1,
        experimental: [expect.objectContaining({ targetVideoId: newTargetId })],
      })
      expect(await review(baselineGenerationId)).toMatchObject({
        state: "ready",
        allAcceptedCount: 1,
        experimental: [expect.objectContaining({ targetVideoId: targetId })],
      })
      expect(paidRequests).toEqual([
        { task: "catalog_discovery", sourceId },
        { task: "candidate_judgment", sourceId },
        { task: "catalog_discovery", sourceId: targetId },
        { task: "catalog_discovery", sourceId: newTargetId },
      ])
    })

    it("resumes a transient charged provider failure without losing either attempt's cost", async () => {
      const generationId = `catalog-transient-${suffix}`
      const paidRequests: Array<{ task: string; sourceId: string }> = []
      const successfulModel = controlledModel(targetId, paidRequests)
      let firstAttempt = true
      const model: StructuredModel = {
        async generate(request) {
          if (firstAttempt) {
            firstAttempt = false
            throw Object.assign(
              new Error("Fixture provider temporarily unavailable"),
              {
                statusCode: 503,
                usage: { inputTokens: 50, outputTokens: 0, costUsd: 0.01 },
              },
            )
          }
          return successfulModel.generate(request)
        },
      }
      let generationInputDigest: string | undefined
      const externalCallIds: string[] = []
      const connected = dependencies()
      const ingest: SourceIngest = async (request) => {
        if (
          typeof request === "object" &&
          request !== null &&
          "action" in request
        ) {
          if (
            request.action === "start" &&
            "inputDigest" in request &&
            typeof request.inputDigest === "string"
          )
            generationInputDigest = request.inputDigest
          if (
            request.action === "model_call_start" &&
            "callId" in request &&
            typeof request.callId === "string"
          )
            externalCallIds.push(request.callId)
        }
        return connected.ingest(request)
      }
      const input = {
        generationId,
        // The later target belongs to a later cutoff; this cohort still has
        // the original two sources, making retry charges independently clear.
        inputCutoff: cutoff,
        historyRequired: false,
        capacity: await fixtureCapacity(),
      }
      await expect(
        runPrecomputedCatalog(input, { ...connected, ingest, model }),
      ).rejects.toThrow("provider_unavailable")
      const status = () =>
        connected.ingest({
          action: "status",
          generationId,
          generationInputDigest,
          sourceVideoId: sourceId,
        })
      expect(await status()).toMatchObject({
        state: "incomplete",
        failedSourceCount: 0,
        source: { state: "claimed" },
        usage: {
          modelCallCount: 1,
          modelKnownCostUsd: 0.01,
          modelUnknownCostCount: 0,
          modelPendingCount: 0,
          inputTokens: 50,
          outputTokens: 0,
        },
      })
      await admin.query(
        "UPDATE recommendation_precomputed_build_source SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE generation_id=$1 AND state='claimed'",
        [generationId],
      )
      await expect(
        runPrecomputedCatalog(input, { ...dependencies(), ingest, model }),
      ).resolves.toMatchObject({
        state: "complete",
        completedSourceCount: 2,
        failedSourceCount: 0,
      })
      expect(await status()).toMatchObject({
        state: "complete",
        completeEdgesSourceCount: 1,
        completeEmptySourceCount: 1,
        failedSourceCount: 0,
        usage: {
          modelCallCount: 4,
          modelKnownCostUsd: 0.05,
          modelUnknownCostCount: 0,
          modelPendingCount: 0,
          inputTokens: 450,
          outputTokens: 80,
        },
      })
      expect(externalCallIds).toHaveLength(4)
      expect(new Set(externalCallIds).size).toBe(4)
      expect(paidRequests).toHaveLength(3)
    })

    it("preserves GA navigation qualifications through a complete catalog build and Admin review", async () => {
      const generationId = `catalog-navigation-${suffix}`
      const paidRequests: Array<{ task: string; sourceId: string }> = []
      const controlled = controlledModel(targetId, paidRequests)
      const observedPrompts: unknown[] = []
      const model: StructuredModel = {
        async generate(request) {
          expect(request.prompt).not.toContain("watchRouteIdentity")
          expect(request.prompt).not.toContain("fixture-token")
          observedPrompts.push(JSON.parse(request.prompt))
          return controlled.generate(request)
        },
      }
      let gaHttpAttempts = 0
      const ga = gaWatchHistoryFixtureOptions({
        sourceSlug: `story-0-${suffix}`,
        targetSlug: `story-1-${suffix}`,
      })
      await expect(
        runPrecomputedCatalog(
          {
            generationId,
            inputCutoff: cutoff,
            historyRequired: true,
            capacity: await fixtureCapacity(),
          },
          {
            ...dependencies(),
            model,
            gaTransport: {
              serviceAccountEmail: ga.serviceAccountEmail,
              tokenProvider: ga.tokenProvider,
              fetchImpl: async (...args) => {
                gaHttpAttempts += 1
                return ga.fetchImpl(...args)
              },
            },
          },
        ),
      ).resolves.toMatchObject({ state: "complete", completedSourceCount: 2 })
      expect(observedPrompts).toContainEqual(
        expect.objectContaining({
          task: "candidate_judgment",
          untrustedCatalogData: expect.objectContaining({
            historicalNavigation: 7,
            historicalSourceSignal: {
              videoKey: sourceId,
              views: 100,
              engagedViews: null,
              exposures: null,
            },
            historicalCandidateSignal: {
              videoKey: targetId,
              views: 80,
              engagedViews: null,
              exposures: null,
            },
          }),
        }),
      )
      const comparison = await loadPrecomputedRecommendationComparison(prisma, {
        generationId,
        sourceVideoId: sourceId,
        audioLanguageSlug: "english",
        reviewer,
      })
      expect(comparison).toMatchObject({
        state: "ready",
        generation: { inputMode: "historical_analytics" },
        experimental: [expect.objectContaining({ targetVideoId: targetId })],
      })
      const report = await loadDurablePrecomputedBuildReport(prisma, {
        generationId,
        sourceVideoId: sourceId,
        reviewer,
      })
      expect(gaHttpAttempts).toBeGreaterThan(4)
      expect(report).toMatchObject({
        usage: {
          historyCallCount: gaHttpAttempts,
          historyPendingCount: 0,
          historyKnownCostUsd: 0,
          historyUnknownCostCount: gaHttpAttempts,
        },
        historicalQualification: {
          sourceAvailability: {
            coverage: "partial_source_history",
            unavailablePrefixStart: "2022-06-21",
            unavailablePrefixEnd: "2022-08-05",
          },
          transitions: {
            status: "unavailable",
            reason: "missing_session_identity",
          },
          navigation: { interpretation: "navigation_not_playback_sequence" },
          mapping: { historicalOwnership: "unverified" },
        },
        source: {
          id: sourceId,
          historicalProvenance: {
            rangeStart: "2022-08-06",
            rangeEnd: "2026-10-03",
            navigationCoverage: { qualifiedEvents: 7, unmappedEvents: 3 },
          },
        },
      })
    })
    it("retains the latest completed builds while removing superseded producer artifacts", async () => {
      const generations = [
        `catalog-retired-${suffix}`,
        `catalog-rollback-${suffix}`,
        `catalog-current-${suffix}`,
      ]
      const completedAt = Date.now() + 60_000
      for (const [index, generationId] of generations.entries()) {
        await expect(
          runPrecomputedCatalog(
            {
              generationId,
              inputCutoff: cutoff,
              historyRequired: false,
              capacity: await fixtureCapacity(),
            },
            { ...dependencies(), model: controlledModel(targetId, []) },
          ),
        ).resolves.toMatchObject({ state: "complete", completedSourceCount: 2 })
        // Arrange deterministic retention age/order for real producer output.
        // Model receipts and saved choices are never fabricated or rewritten.
        await prisma.recommendationPrecomputedGeneration.update({
          where: { id: generationId },
          data: { completedAt: new Date(completedAt + index * 1_000) },
        })
      }
      const review = (generationId: string) =>
        loadPrecomputedRecommendationComparison(prisma, {
          generationId,
          sourceVideoId: sourceId,
          audioLanguageSlug: "english",
          reviewer,
        })
      const retainedBefore = await Promise.all(generations.slice(1).map(review))
      expect(await review(generations[0]!)).toMatchObject({
        state: "ready",
        allAcceptedCount: 1,
      })
      const retentionNow = new Date(completedAt + 365 * 24 * 60 * 60 * 1_000)
      // Each pass is bounded; existing independent test generations may also
      // be expired. Assert the public result, not a fixture-specific row order.
      for (let pass = 0; pass < 20; pass += 1) {
        await prisma.$transaction((tx) =>
          purgeExpiredPrecomputedGenerations(tx, retentionNow, 1),
        )
        if ((await review(generations[0]!)).state === "not_found") break
      }
      expect(await review(generations[0]!)).toMatchObject({
        state: "not_found",
        experimental: [],
      })
      // Runtime cleanup still gets authoritative identity after the large
      // generation graph is gone; a missing row is not guessed to be safe.
      expect(
        await dependencies().ingest({
          action: "retention_status",
          protocolVersion: 2,
          generationId: generations[0],
        }),
      ).toMatchObject({
        generationId: generations[0],
        generationProtocolVersion: 2,
        inputCutoff: cutoff,
        inputDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        inputMode: "content_only",
        sourceWorkResumable: false,
      })
      for (const [index, generationId] of generations.slice(1).entries()) {
        const retained = await review(generationId)
        expect(retained).toEqual(retainedBefore[index])
        expect(retained).toMatchObject({
          state: "ready",
          allAcceptedCount: 1,
          experimental: [expect.objectContaining({ targetVideoId: targetId })],
        })
        expect(
          await loadDurablePrecomputedBuildReport(prisma, {
            generationId,
            sourceVideoId: sourceId,
            reviewer,
          }),
        ).toMatchObject({
          usage: {
            modelCallCount: 3,
            modelKnownCostUsd: 0.04,
            modelUnknownCostCount: 0,
          },
        })
      }
      // Native runtime rows model a crash-left workflow record. This is a
      // storage/identity seam, not measurement of a live Mastra workflow run.
      const runtimePool = new Pool({
        connectionString: env.DATABASE_URL,
        max: 2,
      })
      const workflows = new WorkflowsPG({
        pool: runtimePool,
        schemaName: schema,
      })
      try {
        await workflows.init()
        const runIds = [
          `retired-${suffix}`,
          `mismatch-${suffix}`,
          `unknown-${suffix}`,
        ]
        for (const [index, runId] of runIds.entries()) {
          const context: Parameters<
            WorkflowsPG["persistWorkflowSnapshot"]
          >[0]["snapshot"]["context"] = {}
          context.input = {
            generationId: index === 2 ? `unknown-${suffix}` : generations[0],
            inputCutoff: index === 1 ? "2026-10-04T00:00:00.000Z" : cutoff,
            historyRequired: false,
          }
          await workflows.persistWorkflowSnapshot({
            workflowName: "precomputed-catalog-generation",
            runId,
            snapshot: {
              runId,
              status: "running",
              value: {},
              context,
              serializedStepGraph: [],
              activePaths: [],
              activeStepsPath: {},
              suspendedPaths: {},
              resumeLabels: {},
              waitingPaths: {},
              timestamp: completedAt,
            },
            createdAt: new Date(completedAt),
            updatedAt: new Date(completedAt),
          })
        }
        const prune = () =>
          prunePrecomputedAbandonedRuntimeSnapshots({
            pool: runtimePool,
            schema,
            now: retentionNow,
            readProof: ({ generationId }) =>
              dependencies().ingest({
                action: "retention_status",
                protocolVersion: 2,
                generationId,
              }),
          })
        expect(await prune()).toMatchObject({
          examinedRuns: 3,
          deletedRuns: 1,
          unresolvedRuns: 2,
        })
        expect(
          await workflows.getWorkflowRunById({ runId: runIds[0]! }),
        ).toBeNull()
        for (const runId of runIds.slice(1))
          expect(await workflows.getWorkflowRunById({ runId })).not.toBeNull()
        expect(await prune()).toMatchObject({
          examinedRuns: 2,
          deletedRuns: 0,
          unresolvedRuns: 2,
        })
      } finally {
        await runtimePool.end()
      }

      // A repeated cleanup must preserve both retained review/cost reports.
      await prisma.$transaction((tx) =>
        purgeExpiredPrecomputedGenerations(tx, retentionNow, 1),
      )
      expect(await Promise.all(generations.slice(1).map(review))).toEqual(
        retainedBefore,
      )
    })
  },
)
