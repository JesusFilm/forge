import { createHash, randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { WorkflowsPG } from "@mastra/pg"
import { PrismaClient, type Prisma } from "@prisma/client"
import { Client, Pool } from "pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { env } from "../../apps/admin/src/config/env"
import { currentAdminMigrationSql } from "../../apps/admin/src/services/recommendations/current-schema.test-fixture"
import { purgeExpiredPrecomputedGenerations } from "../../apps/admin/src/services/recommendations/precomputed/generation-retention"
import { readPrecomputedCatalog } from "../../apps/admin/src/services/recommendations/precomputed/catalog"
import { oneUtcCalendarMonthAfter } from "../../apps/admin/src/services/recommendations/precomputed/cohort-window"
import {
  loadPrecomputedPublicControl,
  preparePrecomputedPublicExperiment,
  promotePrecomputedPublicExperiment,
  rollbackPrecomputedPublicExperiment,
  startPrecomputedPublicExperiment,
} from "../../apps/admin/src/services/recommendations/precomputed/public-control"
import { readControlRouting } from "../../apps/admin/src/services/recommendations/precomputed/visit-admission"
import { deliverPrecomputedPublicWatchVisit } from "../../apps/admin/src/services/recommendations/precomputed/public-watch"
import { purgeExpiredPrecomputedVisitRoots } from "../../apps/admin/src/services/recommendations/precomputed/visit-retention"
import {
  evaluatePublicPrecomputedCtr,
  loadPrivatePrecomputedCtrReport,
} from "../../apps/admin/src/services/recommendations/precomputed/ctr-report"
import { precomputedBrowserUnitDigest } from "../../apps/admin/src/services/recommendations/precomputed/visit-identity"
import { chooseExperimentArm } from "../../apps/admin/src/services/recommendations/experiment/assignment"
import { RecommendationEpisodeService } from "../../apps/admin/src/services/recommendations/episode.service"
import { createRuntimeRecommendationTokenService } from "../../apps/admin/src/services/recommendations/runtime-token"
import { getSemanticDeliveryCandidatePool } from "../../apps/admin/src/services/recommendations/delivery-retriever"
import {
  createRecommendationTokenService,
  parseRecommendationKeyring,
} from "../../apps/admin/src/services/recommendations/token.service"
import { loadPrecomputedRecommendationComparison } from "../../apps/admin/src/services/recommendations/precomputed/contract"
import {
  loadDurablePrecomputedBuildReport,
  submitDurablePrecomputedRecommendation,
} from "../../apps/admin/src/services/recommendations/precomputed/durable-build"
import { gaCaptureSnapshotRefSchema } from "../../apps/admin/src/services/recommendations/precomputed/ga-capture-artifact"
import { createProtectedLocalGaCaptureStore } from "../../apps/admin/src/services/recommendations/precomputed/ga-capture-store"
import {
  handleGaCaptureGet,
  handleGaCapturePost,
} from "../../apps/admin/src/services/recommendations/precomputed/ga-capture-transport"
// Repository-owned native seam; neither application imports the other.
import { runPrecomputedCatalog } from "../../apps/mastra/src/services/precomputed-recommendations/catalog-generation"
import type { GaCaptureTransport } from "../../apps/mastra/src/services/precomputed-recommendations/ga-watch-capture-transport"
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
      // Retrieval intentionally qualifies the pgvector operator in public,
      // matching a migrated application database rather than a test schema.
      await admin.query(
        "CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public",
      )
      await admin.query(`CREATE SCHEMA "${schema}"`)
      await admin.query(`SET search_path TO "${schema}", public`)
      for (const migration of currentAdminMigrationSql)
        await admin.query(migration)
      const url = new URL(env.DATABASE_URL)
      url.searchParams.set("schema", schema)
      prisma = new PrismaClient<Prisma.PrismaClientOptions>({
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
                  addedViewingValueEnglish: null,
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

    it("captures history once and resumes a native v3 build without live GA after a lost model receipt response", async () => {
      const generationId = `catalog-sealed-resume-${suffix}`
      const directory = await mkdtemp(join(tmpdir(), "catalog-sealed-native-"))
      const store = createProtectedLocalGaCaptureStore(
        join(directory, "objects"),
      )
      const connected = dependencies()
      const ga = gaWatchHistoryFixtureOptions({
        sourceSlug: `story-0-${suffix}`,
        targetSlug: `story-1-${suffix}`,
      })
      const gaFetch = vi.fn(ga.fetchImpl)
      const paidRequests: Array<{ task: string; sourceId: string }> = []
      const controlled = controlledModel(targetId, paidRequests)
      const model: StructuredModel = {
        async generate(request) {
          const generation =
            await prisma.recommendationPrecomputedGeneration.findUniqueOrThrow({
              where: { id: generationId },
            })
          expect(generation.protocolVersion).toBe(3)
          expect(generation.historicalQualification).toMatchObject({
            snapshotRef: { generationId, verification: "two_matching_passes" },
          })
          expect(
            await prisma.recommendationPrecomputedHistoryCall.count({
              where: { generationId, status: "pending" },
            }),
          ).toBe(0)
          return controlled.generate(request)
        },
      }
      const gaCaptureTransport: GaCaptureTransport = {
        async upload(input) {
          const bytes = await readFile(input.path)
          const response = await handleGaCapturePost(
            prisma,
            new Request("https://admin.fixture.test/ga-capture", {
              method: "POST",
              headers: {
                authorization: bearer,
                "content-type": "application/vnd.forge.ga-capture-v1",
                "content-length": String(input.artifactBytes),
                "x-forge-generation-id": input.generationId,
                "x-forge-input-digest": input.generationInputDigest,
                "x-forge-artifact-sha256": input.artifactSha256,
              },
              body: new Uint8Array(bytes),
            }),
            store,
          )
          expect(response.status).toBe(201)
          const envelope: unknown = await response.json()
          if (
            !envelope ||
            typeof envelope !== "object" ||
            !("snapshotRef" in envelope)
          )
            throw new Error("Missing native GA capture reference")
          return gaCaptureSnapshotRefSchema.parse(envelope.snapshotRef)
        },
        async download(input) {
          const response = await handleGaCaptureGet(
            prisma,
            new Request("https://admin.fixture.test/ga-capture", {
              headers: {
                authorization: bearer,
                "x-forge-generation-id": input.generationId,
                "x-forge-input-digest": input.generationInputDigest,
              },
            }),
            store,
          )
          expect(response.status).toBe(200)
          expect(response.headers.get("x-forge-artifact-sha256")).toBe(
            input.artifactSha256,
          )
          const bytes = Buffer.from(await response.arrayBuffer())
          expect(bytes.length).toBe(input.artifactBytes)
          await mkdir(input.directory, { recursive: true, mode: 0o700 })
          const path = join(input.directory, "native-sealed-resume.bin")
          await writeFile(path, bytes, { mode: 0o600 })
          return path
        },
      }
      let loseModelResponse = true
      const ingest: SourceIngest = async (raw) => {
        const request = raw as Record<string, unknown>
        const response = await submitDurablePrecomputedRecommendation(
          prisma,
          raw,
          bearer,
          { gaCaptureStore: store },
        )
        if (
          loseModelResponse &&
          request.action === "model_call" &&
          request.stage === "analytics_query_plan" &&
          request.status === "succeeded" &&
          request.sourceVideoId === sourceId
        ) {
          loseModelResponse = false
          throw new Error("Fixture lost response after native model checkpoint")
        }
        return response
      }
      const input = {
        generationId,
        inputCutoff: cutoff,
        historyRequired: true,
        snapshotMode: "ga_aggregate_capture_v1" as const,
        capacity: await fixtureCapacity(),
      }
      try {
        await expect(
          runPrecomputedCatalog(input, {
            ...connected,
            ingest,
            model,
            gaCaptureTransport,
            gaCaptureDirectory: join(directory, "runtime"),
            gaTransport: {
              serviceAccountEmail: ga.serviceAccountEmail,
              tokenProvider: ga.tokenProvider,
              fetchImpl: gaFetch,
            },
          }),
        ).rejects.toThrow("Fixture lost response after native model checkpoint")
        expect(gaFetch).toHaveBeenCalled()
        const gaCallsAfterCapture = gaFetch.mock.calls.length
        const capturedReceipts =
          await prisma.recommendationPrecomputedHistoryCall.findMany({
            where: { generationId },
            select: {
              callId: true,
              requestDigest: true,
              status: true,
              sourceVideoId: true,
            },
            orderBy: { callId: "asc" },
          })
        expect(capturedReceipts).toHaveLength(gaCallsAfterCapture)
        expect(
          capturedReceipts.every(
            (call) =>
              call.sourceVideoId === null && call.status === "succeeded",
          ),
        ).toBe(true)
        // Simulate natural lease expiry in this isolated native test database.
        await prisma.recommendationPrecomputedBuildSource.updateMany({
          where: { generationId, state: "claimed" },
          data: { leaseExpiresAt: new Date(0) },
        })
        const forbiddenGa = vi.fn(async () => {
          throw new Error("Live GA forbidden after seal")
        })
        const forbiddenToken = vi.fn(async () => {
          throw new Error("GA auth forbidden after seal")
        })
        expect(
          await runPrecomputedCatalog(
            {
              ...input,
              capacity: await fixtureCapacity(),
            },
            {
              ...connected,
              ingest,
              model,
              gaCaptureTransport,
              gaCaptureDirectory: join(directory, "runtime"),
              gaTransport: {
                serviceAccountEmail: ga.serviceAccountEmail,
                tokenProvider: forbiddenToken,
                fetchImpl: forbiddenGa,
              },
            },
          ),
        ).toMatchObject({
          state: "complete",
          completedSourceCount: 2,
          failedSourceCount: 0,
        })
        expect(forbiddenGa).not.toHaveBeenCalled()
        expect(forbiddenToken).not.toHaveBeenCalled()
        expect(
          paidRequests.filter(
            (call) =>
              call.task === "analytics_query_plan" &&
              call.sourceId === sourceId,
          ),
        ).toHaveLength(1)
        expect(
          await prisma.recommendationPrecomputedHistoryCall.findMany({
            where: { generationId },
            select: {
              callId: true,
              requestDigest: true,
              status: true,
              sourceVideoId: true,
            },
            orderBy: { callId: "asc" },
          }),
        ).toEqual(capturedReceipts)
        const sources =
          await prisma.recommendationPrecomputedBuildSource.findMany({
            where: { generationId },
          })
        for (const source of sources)
          expect(source.historicalProvenance).toMatchObject({
            captureBasis: "capture_derived_v1",
            queryExecutionCount: 0,
            pageCountKind: "virtual_validation",
          })
        expect(
          await loadDurablePrecomputedBuildReport(prisma, {
            generationId,
            sourceVideoId: sourceId,
            reviewer,
          }),
        ).toMatchObject({
          usage: {
            historyCallCount: gaCallsAfterCapture,
            historyPendingCount: 0,
          },
        })
        expect(
          await loadPrecomputedRecommendationComparison(prisma, {
            generationId,
            sourceVideoId: sourceId,
            audioLanguageSlug: "english",
            reviewer,
          }),
        ).toMatchObject({ state: "ready", allAcceptedCount: 1 })
        const readProof = ({ generationId }: { generationId: string }) =>
          ingest({
            action: "retention_status",
            protocolVersion: 2,
            generationId,
          })
        expect(await readProof({ generationId })).toMatchObject({
          generationProtocolVersion: 3,
          inputMode: "historical_analytics",
          sourceWorkResumable: false,
        })
        // A crash can leave a running Mastra row after Admin completed the
        // generation. Its native v3 proof must permit bounded runtime cleanup.
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
          const runId = `sealed-runtime-${suffix}`
          const staleAt = new Date(Date.now() - 31 * 86_400_000)
          const context: Parameters<
            WorkflowsPG["persistWorkflowSnapshot"]
          >[0]["snapshot"]["context"] = {}
          context.input = {
            generationId,
            inputCutoff: cutoff,
            historyRequired: true,
            snapshotMode: "ga_aggregate_capture_v1",
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
              timestamp: staleAt.getTime(),
            },
            createdAt: staleAt,
            updatedAt: staleAt,
          })
          expect(
            await prunePrecomputedAbandonedRuntimeSnapshots({
              pool: runtimePool,
              schema,
              readProof,
            }),
          ).toMatchObject({
            examinedRuns: 1,
            deletedRuns: 1,
            unresolvedRuns: 0,
          })
          expect(await workflows.getWorkflowRunById({ runId })).toBeNull()
        } finally {
          await runtimePool.end()
        }
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    })

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

    it("replays the live claim and repairs a charged invalid analytics plan once", async () => {
      const generationId = `catalog-plan-repair-${suffix}`
      const connected = dependencies()
      const ga = gaWatchHistoryFixtureOptions({
        sourceSlug: `story-0-${suffix}`,
        targetSlug: `story-1-${suffix}`,
      })
      const prompts: Array<{
        task: string
        untrustedCatalogData: {
          source: { id: string }
          validationFeedback?: { reason: string }
        }
      }> = []
      const successful = controlledModel(targetId, [])
      let firstPlan = true
      const model: StructuredModel = {
        async generate(request) {
          const prompt = JSON.parse(request.prompt) as (typeof prompts)[number]
          prompts.push(prompt)
          if (
            prompt.task === "analytics_query_plan" &&
            prompt.untrustedCatalogData.source.id === sourceId &&
            firstPlan
          ) {
            firstPlan = false
            return {
              output: request.schema.parse({
                candidateVideoIds: [targetId, targetId],
              }),
              usage: { inputTokens: 100, outputTokens: 20, costUsd: 0.01 },
            }
          }
          return successful.generate(request)
        },
      }
      let sourceClaimId: string | undefined
      let claimReplayCount = 0
      let loseFirstReceipt = true
      const ingest: SourceIngest = async (raw) => {
        let request = raw as Record<string, unknown>
        if (request.action === "claim" && request.sourceVideoId === sourceId) {
          if (sourceClaimId) {
            request = { ...request, claimId: sourceClaimId }
            claimReplayCount += 1
          } else sourceClaimId = request.claimId as string
        }
        const response = await connected.ingest(request)
        if (
          loseFirstReceipt &&
          request.action === "model_call" &&
          request.stage === "analytics_query_plan" &&
          request.status === "failed" &&
          request.sourceVideoId === sourceId
        ) {
          loseFirstReceipt = false
          throw new Error("Fixture response lost after persisted invalid plan")
        }
        return response
      }
      const input = {
        generationId,
        inputCutoff: cutoff,
        historyRequired: true,
        capacity: await fixtureCapacity(),
      }
      const gaTransport = {
        serviceAccountEmail: ga.serviceAccountEmail,
        tokenProvider: ga.tokenProvider,
        fetchImpl: ga.fetchImpl,
      }
      await expect(
        runPrecomputedCatalog(input, {
          ...connected,
          ingest,
          model,
          gaTransport,
        }),
      ).rejects.toThrow("Fixture response lost after persisted invalid plan")
      const first =
        await prisma.recommendationPrecomputedBuildSource.findUniqueOrThrow({
          where: {
            generationId_sourceVideoId: {
              generationId,
              sourceVideoId: sourceId,
            },
          },
        })
      expect(first.state).toBe("claimed")
      expect(
        (
          await prisma.recommendationPrecomputedGeneration.findUniqueOrThrow({
            where: { id: generationId },
          })
        ).promptVersion,
      ).toBe("astra-catalog-history-navigation-v6")
      expect(first.checkpoint).toMatchObject({
        stage: "plan",
        planRepair: {
          catalogIndex: 0,
          attempts: 1,
          feedback: { reason: "plan_duplicate_ids" },
        },
      })
      expect(
        await prisma.recommendationPrecomputedModelCall.findMany({
          where: {
            generationId,
            sourceVideoId: sourceId,
            stage: "analytics_query_plan",
          },
          select: { status: true, costUsd: true },
        }),
      ).toMatchObject([{ status: "failed", costUsd: expect.anything() }])

      expect(
        await runPrecomputedCatalog(input, {
          ...connected,
          ingest,
          model,
          gaTransport,
        }),
      ).toMatchObject({ state: "complete", failedSourceCount: 0 })
      expect(claimReplayCount).toBe(1)
      const sourcePlans = prompts.filter(
        (prompt) =>
          prompt.task === "analytics_query_plan" &&
          prompt.untrustedCatalogData.source.id === sourceId,
      )
      expect(sourcePlans).toHaveLength(2)
      expect(sourcePlans[0]?.untrustedCatalogData).not.toHaveProperty(
        "validationFeedback",
      )
      expect(sourcePlans[1]?.untrustedCatalogData.validationFeedback).toEqual({
        reason: "plan_duplicate_ids",
      })
      const receipts = await prisma.recommendationPrecomputedModelCall.findMany(
        {
          where: {
            generationId,
            sourceVideoId: sourceId,
            stage: "analytics_query_plan",
          },
          orderBy: { startedAt: "asc" },
        },
      )
      expect(receipts.map((receipt) => receipt.status)).toEqual([
        "failed",
        "succeeded",
      ])
      expect(receipts.map((receipt) => Number(receipt.costUsd))).toEqual([
        0.01, 0.01,
      ])
      expect(new Set(receipts.map((receipt) => receipt.callId)).size).toBe(2)
      expect(
        (
          await prisma.recommendationPrecomputedBuildSource.findUniqueOrThrow({
            where: {
              generationId_sourceVideoId: {
                generationId,
                sourceVideoId: sourceId,
              },
            },
          })
        ).checkpoint,
      ).not.toHaveProperty("planRepair")
      expect(
        await loadPrecomputedRecommendationComparison(prisma, {
          generationId,
          sourceVideoId: sourceId,
          audioLanguageSlug: "english",
          reviewer,
        }),
      ).toMatchObject({ state: "ready", allAcceptedCount: 1 })
    })

    it("exhausts two charged invalid analytics plans across a live-claim replay", async () => {
      const generationId = `catalog-plan-exhaust-${suffix}`
      const connected = dependencies()
      const ga = gaWatchHistoryFixtureOptions({
        sourceSlug: `story-0-${suffix}`,
        targetSlug: `story-1-${suffix}`,
      })
      const planPrompts: Array<{ validationFeedback?: { reason: string } }> = []
      const successful = controlledModel(targetId, [])
      let sourceClaimId: string | undefined
      let sourcePlanCount = 0
      let loseSecondReceipt = true
      const model: StructuredModel = {
        async generate(request) {
          const prompt = JSON.parse(request.prompt) as {
            task: string
            untrustedCatalogData: {
              source: { id: string }
              validationFeedback?: { reason: string }
            }
          }
          if (
            prompt.task === "analytics_query_plan" &&
            prompt.untrustedCatalogData.source.id === sourceId
          ) {
            planPrompts.push(prompt.untrustedCatalogData)
            sourcePlanCount += 1
            return {
              output: request.schema.parse({
                candidateVideoIds:
                  sourcePlanCount === 1 ? [sourceId] : ["outside-page-video"],
              }),
              usage: { inputTokens: 100, outputTokens: 20, costUsd: 0.01 },
            }
          }
          return successful.generate(request)
        },
      }
      const ingest: SourceIngest = async (raw) => {
        let request = raw as Record<string, unknown>
        if (request.action === "claim" && request.sourceVideoId === sourceId) {
          if (sourceClaimId) request = { ...request, claimId: sourceClaimId }
          else sourceClaimId = request.claimId as string
        }
        const response = await connected.ingest(request)
        if (
          loseSecondReceipt &&
          request.action === "model_call" &&
          request.stage === "analytics_query_plan" &&
          request.status === "failed" &&
          request.sourceVideoId === sourceId &&
          sourcePlanCount === 2
        ) {
          loseSecondReceipt = false
          throw new Error("Fixture response lost after exhausted plan")
        }
        return response
      }
      const input = {
        generationId,
        inputCutoff: cutoff,
        historyRequired: true,
        capacity: await fixtureCapacity(),
      }
      const gaTransport = {
        serviceAccountEmail: ga.serviceAccountEmail,
        tokenProvider: ga.tokenProvider,
        fetchImpl: ga.fetchImpl,
      }
      await expect(
        runPrecomputedCatalog(input, {
          ...connected,
          ingest,
          model,
          gaTransport,
        }),
      ).rejects.toThrow("Fixture response lost after exhausted plan")
      expect(
        (
          await prisma.recommendationPrecomputedBuildSource.findUniqueOrThrow({
            where: {
              generationId_sourceVideoId: {
                generationId,
                sourceVideoId: sourceId,
              },
            },
          })
        ).checkpoint,
      ).toMatchObject({
        stage: "plan",
        planRepair: {
          catalogIndex: 0,
          attempts: 2,
          feedback: { reason: "plan_outside_page" },
        },
      })
      expect(
        await runPrecomputedCatalog(input, {
          ...connected,
          ingest,
          model,
          gaTransport,
        }),
      ).toMatchObject({ state: "failed", failedSourceCount: 1 })
      expect(sourcePlanCount).toBe(2)
      expect(planPrompts[1]?.validationFeedback).toEqual({
        reason: "plan_source_id",
      })
      const receipts = await prisma.recommendationPrecomputedModelCall.findMany(
        {
          where: {
            generationId,
            sourceVideoId: sourceId,
            stage: "analytics_query_plan",
          },
          orderBy: { startedAt: "asc" },
        },
      )
      expect(receipts.map((receipt) => receipt.status)).toEqual([
        "failed",
        "failed",
      ])
      expect(receipts.map((receipt) => Number(receipt.costUsd))).toEqual([
        0.01, 0.01,
      ])
      expect(new Set(receipts.map((receipt) => receipt.callId)).size).toBe(2)
      expect(
        await loadDurablePrecomputedBuildReport(prisma, {
          generationId,
          sourceVideoId: sourceId,
          reviewer,
        }),
      ).toMatchObject({ failedSourceCount: 1 })
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

    it("interleaves two source-scoped GA attempts with exact native attribution and one completion", async () => {
      const generationId = `catalog-parallel-ga-${suffix}`
      const ga = gaWatchHistoryFixtureOptions({
        sourceSlug: `story-0-${suffix}`,
        targetSlug: `story-1-${suffix}`,
      })
      const connected = dependencies()
      const writes: Array<Record<string, unknown>> = []
      const firstAttempts: Array<{ sourceId: string; callId: string }> = []
      let releaseFirstAttempts: () => void = () => undefined
      const bothReserved = new Promise<void>((resolve) => {
        releaseFirstAttempts = resolve
      })
      const ingest: SourceIngest = async (raw) => {
        const call = raw as Record<string, unknown>
        writes.push(call)
        const result = await connected.ingest(raw)
        if (
          call.action === "history_call_start" &&
          call.stage === "snapshot_page" &&
          typeof call.sourceVideoId === "string" &&
          firstAttempts.length < 2
        ) {
          firstAttempts.push({
            sourceId: call.sourceVideoId,
            callId: String(call.callId),
          })
          if (firstAttempts.length === 2) releaseFirstAttempts()
          let timeout: ReturnType<typeof setTimeout> | undefined
          try {
            await Promise.race([
              bothReserved,
              new Promise<void>((_, reject) => {
                timeout = setTimeout(
                  () => reject(new Error("Missing concurrent source history")),
                  5_000,
                )
              }),
            ])
          } finally {
            if (timeout) clearTimeout(timeout)
          }
        }
        return result
      }
      let activeGa = 0
      let peakGa = 0
      let gaHttpAttempts = 0
      const gaTransport = {
        serviceAccountEmail: ga.serviceAccountEmail,
        tokenProvider: ga.tokenProvider,
        fetchImpl: async (...args: Parameters<typeof fetch>) => {
          gaHttpAttempts += 1
          activeGa += 1
          peakGa = Math.max(peakGa, activeGa)
          try {
            await new Promise((resolve) => setTimeout(resolve, 8))
            return await ga.fetchImpl(...args)
          } finally {
            activeGa -= 1
          }
        },
      }
      const result = await runPrecomputedCatalog(
        {
          generationId,
          inputCutoff: cutoff,
          historyRequired: true,
          sourceConcurrency: 2,
          capacity: await fixtureCapacity(),
        },
        {
          ...connected,
          ingest,
          model: controlledModel(targetId, []),
          gaTransport,
        },
      )
      expect(result).toMatchObject({
        state: "complete",
        completedSourceCount: 2,
        failedSourceCount: 0,
      })
      expect(firstAttempts.map((attempt) => attempt.sourceId).sort()).toEqual([
        sourceId,
        targetId,
      ])
      expect(peakGa).toBe(2)
      expect(writes.filter((call) => call.action === "complete")).toHaveLength(
        1,
      )
      expect(
        writes
          .filter((call) => call.action === "claim")
          .map((call) => call.sourceVideoId)
          .sort(),
      ).toEqual([sourceId, targetId])
      const starts = writes.filter(
        (call) => call.action === "history_call_start",
      )
      const receipts = writes.filter((call) => call.action === "history_call")
      expect(starts).toHaveLength(gaHttpAttempts)
      expect(receipts).toHaveLength(gaHttpAttempts)
      // Concurrent requests may finish in either order. Compare every call's
      // identity and source attribution without imposing completion order.
      const identities = (calls: typeof writes) =>
        calls
          .map(({ callId, sourceVideoId }) => ({ callId, sourceVideoId }))
          .sort((left, right) =>
            String(left.callId).localeCompare(String(right.callId)),
          )
      expect(identities(receipts)).toEqual(identities(starts))
      expect(receipts.every((receipt) => receipt.status === "succeeded")).toBe(
        true,
      )
      const report = await loadDurablePrecomputedBuildReport(prisma, {
        generationId,
        sourceVideoId: sourceId,
        reviewer,
      })
      expect(report).toMatchObject({
        usage: {
          historyCallCount: gaHttpAttempts,
          historyPendingCount: 0,
          historyUnknownCostCount: gaHttpAttempts,
          modelPendingCount: 0,
        },
      })
    }, 120_000)

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

    it("keeps a completed catalog private when an operator reads its results", async () => {
      const generationId = `catalog-unlaunched-${suffix}`
      const before = await loadPrecomputedPublicControl(prisma)
      expect(before).toMatchObject({ mode: "incumbent" })
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
      expect(
        await loadPrecomputedRecommendationComparison(prisma, {
          generationId,
          sourceVideoId: sourceId,
          audioLanguageSlug: "english",
          reviewer,
        }),
      ).toMatchObject({ state: "ready", allAcceptedCount: 1 })
      expect(await loadPrecomputedPublicControl(prisma)).toMatchObject({
        mode: "incumbent",
        version: before.version,
      })
    })

    it("starts and rolls back a built fixture only through authorized explicit controls", async () => {
      const generationId = `catalog-public-${suffix}`
      const experimentId = `catalog-public-test-${suffix}`
      // Arrange an available incumbent only in this disposable native schema.
      await prisma.recommendationServingControl.update({
        where: { id: "recommendation-serving-control" },
        data: { enabled: true },
      })
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
      const generation =
        await prisma.recommendationPrecomputedGeneration.findUniqueOrThrow({
          where: { id: generationId },
          select: { sourceSetDigest: true },
        })
      const routing = await readControlRouting(prisma)
      expect(routing).not.toBeNull()
      const now = Date.now()
      const startsAt = new Date(now - 60_000)
      const prepared = await preparePrecomputedPublicExperiment(prisma, {
        id: experimentId,
        generationId,
        startsAt,
        endsAt: oneUtcCalendarMonthAfter(startsAt),
        expectedControlRoutingDigest: routing!.routingDigest,
        expectedSourceSetDigest: generation.sourceSetDigest,
        // Explicit synthetic rehearsal values, never the live stopping policy.
        policySettings: {
          baselineHumanVisitCtr: 0.2,
          minimumDetectableAbsoluteUplift: 0.05,
          minimumPracticalAbsoluteUplift: 0.05,
          plannedPower: 0.8,
          minimumEligibleVisitsPerArm: 20,
          minimumIndependentBrowsersPerArm: 10,
          minimumDurationHours: 1,
          lateEventCutoffHours: 0,
          maximumActualFallbackRate: 0.2,
          maximumUnlinkedDeliveryRate: 0,
        },
        authority: "isolated_fixture",
        operator: reviewer,
      })
      const before = await loadPrecomputedPublicControl(prisma)
      expect(before).toMatchObject({ mode: "incumbent" })
      const input = {
        experimentId,
        expectedConfigurationDigest: prepared.configurationDigest,
        expectedControlVersion: before.version,
        operator: reviewer,
      }
      await expect(
        startPrecomputedPublicExperiment(prisma, {
          ...input,
          operator: { id: null, role: "WORKFLOW_TRIGGER" },
          authority: "isolated_fixture",
        }),
      ).rejects.toThrow()
      await expect(
        startPrecomputedPublicExperiment(prisma, {
          ...input,
          authority: "live_verified",
        }),
      ).rejects.toMatchObject({ code: "readiness_unavailable" })
      expect(await loadPrecomputedPublicControl(prisma)).toMatchObject({
        mode: "incumbent",
        version: before.version,
      })
      await startPrecomputedPublicExperiment(prisma, {
        ...input,
        authority: "isolated_fixture",
      })
      expect(await loadPrecomputedPublicControl(prisma)).toMatchObject({
        mode: "ab",
        version: before.version + 1,
        experimentId,
        generationId,
      })
      const browserDigest = Array.from({ length: 128 }, (_, index) =>
        createHash("sha256").update(`catalog-browser-${index}`).digest("hex"),
      ).find(
        (value) =>
          chooseExperimentArm({
            unitDigest: precomputedBrowserUnitDigest(experimentId, value),
            configurationDigest: prepared.configurationDigest,
            challengerProbability: 0.5,
          }) === "CHALLENGER",
      )
      if (!browserDigest) throw new Error("No challenger fixture browser")
      const keyring = parseRecommendationKeyring(
        JSON.stringify({
          keys: [
            {
              kid: "catalog-public-test",
              status: "active",
              key: Buffer.alloc(32, 29).toString("base64url"),
            },
          ],
        }),
      )
      const tokenService = {
        activeKid: keyring.active.kid,
        ...createRecommendationTokenService({
          keyring,
          readRevokedKids: async () => [],
        }),
      }
      const caller = {
        id: "catalog-fixture-web",
        role: "CONSUMER_BEARER" as const,
        rateLimitBucketKey: "catalog-fixture-web",
      }
      const visitInput = {
        visitId: randomUUID(),
        browserDigest,
        consentReceiptDigest: null,
        profileTokenDigest: null,
        seedMediaId: sourceId,
        locale: "en",
        audioLanguageSlug: "english",
        sessionDigest: "a".repeat(64),
        clientDeliveryContract: null,
        trafficCategory: "ordinary_browser" as const,
        caller,
      }
      const issued = await deliverPrecomputedPublicWatchVisit(
        prisma,
        visitInput,
        tokenService,
      )
      expect(issued).toMatchObject({
        disposition: "ab",
        status: "eligible",
        arm: "challenger",
        measurementStatus: "recorded",
        delivery: { result: "served" },
      })
      // A lost first Set-Cookie must not reassign or duplicate the same visit.
      expect(
        await deliverPrecomputedPublicWatchVisit(
          prisma,
          {
            ...visitInput,
            browserDigest: "0".repeat(64),
          },
          tokenService,
        ),
      ).toMatchObject({
        status: "unavailable",
        reason: "visit_identity_conflict",
      })
      const rollback = {
        expectedControlVersion: before.version + 1,
        expectedExperimentId: experimentId,
        expectedGenerationId: generationId,
        expectedReportRevision: null,
        operator: reviewer,
        reasonCode: "rehearsal_rollback",
      }
      await expect(
        rollbackPrecomputedPublicExperiment(prisma, {
          ...rollback,
          expectedControlVersion: before.version,
        }),
      ).rejects.toMatchObject({ code: "stale_control" })
      await rollbackPrecomputedPublicExperiment(prisma, rollback)
      expect(await loadPrecomputedPublicControl(prisma)).toMatchObject({
        mode: "incumbent",
        version: before.version + 2,
        experimentId: null,
        retainedExperimentId: experimentId,
      })
      const card = issued.delivery!.items[0]!
      const episodes = new RecommendationEpisodeService({
        prisma,
        tokenService,
      })
      const click = {
        caller,
        contractVersion: "recommendation-evidence-v1",
        capability: card.capability,
        requestId: issued.delivery!.requestId!,
        itemId: card.id,
        sessionDigest: visitInput.sessionDigest,
        browserDigest,
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        claimNonce: `catalog-click-${randomUUID()}`,
      }
      // A card already issued by the experiment remains attributable after
      // rollback; no impression is required and replay cannot add a click.
      expect(await episodes.select(click)).toMatchObject({ status: "accepted" })
      expect(await episodes.select(click)).toMatchObject({ status: "replay" })
      const evaluation = await evaluatePublicPrecomputedCtr(prisma, {
        experimentId,
        operator: reviewer,
      })
      expect(evaluation).toMatchObject({
        status: "available",
        report: {
          experimentId,
          generationId,
          evidenceBasis: "isolated_fixture",
          isFinal: false,
          outcome: "inconclusive",
          byArm: {
            control: { eligibleVisits: 0, clickedVisits: 0 },
            challenger: {
              eligibleVisits: 1,
              clickedVisits: 1,
              acceptedSelections: 1,
              qualifiedImpressions: 0,
              independentBrowsers: 1,
              servedVisits: 1,
            },
          },
          measurementHealth: {
            edgeAutomationCoverage: "partial_unverified",
            exclusionCountScope: "admin_bound_only",
          },
        },
      })
      expect(
        await loadPrivatePrecomputedCtrReport(prisma, {
          experimentId,
          reviewer,
        }),
      ).toEqual(evaluation)
      expect(await loadPrecomputedPublicControl(prisma)).toMatchObject({
        mode: "incumbent",
        version: before.version + 2,
        retainedExperimentId: experimentId,
      })
      expect(
        await loadPrecomputedRecommendationComparison(prisma, {
          generationId,
          sourceVideoId: sourceId,
          audioLanguageSlug: "english",
          reviewer,
        }),
      ).toMatchObject({ state: "ready", allAcceptedCount: 1 })
      expect(
        await loadDurablePrecomputedBuildReport(prisma, {
          generationId,
          sourceVideoId: sourceId,
          reviewer,
        }),
      ).toMatchObject({
        usage: { modelCallCount: 3, modelKnownCostUsd: 0.04 },
      })
    })

    it("promotes only an evaluated fixture winner and retains its evidence through rollback", async () => {
      const generationId = `catalog-winner-${suffix}`
      const refreshId = `catalog-winner-refresh-${suffix}`
      const experimentId = `catalog-winner-test-${suffix}`
      // The capacity attestation is explicitly synthetic; the catalog producer,
      // saved choices, delivery receipts, clicks, and evaluator are real code.
      await prisma.recommendationServingControl.update({
        where: { id: "recommendation-serving-control" },
        data: { enabled: true },
      })
      const capacity = await fixtureCapacity()
      await expect(
        runPrecomputedCatalog(
          {
            generationId,
            inputCutoff: cutoff,
            historyRequired: false,
            capacity,
          },
          { ...dependencies(), model: controlledModel(targetId, []) },
        ),
      ).resolves.toMatchObject({ state: "complete", completedSourceCount: 2 })
      const generation =
        await prisma.recommendationPrecomputedGeneration.findUniqueOrThrow({
          where: { id: generationId },
        })
      const routing = await readControlRouting(prisma)
      if (!routing) throw new Error("Missing fixture incumbent routing")
      const now = new Date()
      const startsAt = new Date(now.getTime() - 60_000)
      const endsAt = oneUtcCalendarMonthAfter(startsAt)
      const prepared = await preparePrecomputedPublicExperiment(prisma, {
        id: experimentId,
        generationId,
        startsAt,
        endsAt,
        expectedControlRoutingDigest: routing.routingDigest,
        expectedSourceSetDigest: generation.sourceSetDigest,
        policySettings: {
          baselineHumanVisitCtr: 0.2,
          minimumDetectableAbsoluteUplift: 0.05,
          minimumPracticalAbsoluteUplift: 0.05,
          plannedPower: 0.8,
          minimumEligibleVisitsPerArm: 20,
          minimumIndependentBrowsersPerArm: 10,
          minimumDurationHours: 1,
          lateEventCutoffHours: 0,
          maximumActualFallbackRate: 0.2,
          maximumUnlinkedDeliveryRate: 0,
        },
        authority: "isolated_fixture",
        operator: reviewer,
      })
      const before = await loadPrecomputedPublicControl(prisma)
      expect(before.mode).toBe("incumbent")
      const active = await startPrecomputedPublicExperiment(prisma, {
        experimentId,
        expectedConfigurationDigest: prepared.configurationDigest,
        expectedControlVersion: before.version,
        authority: "isolated_fixture",
        operator: reviewer,
      })
      const browsers: Record<"control" | "challenger", string[]> = {
        control: [],
        challenger: [],
      }
      for (let index = 0; index < 512; index += 1) {
        const browser = createHash("sha256")
          .update(`winner-browser-${index}`)
          .digest("hex")
        const arm =
          chooseExperimentArm({
            unitDigest: precomputedBrowserUnitDigest(experimentId, browser),
            configurationDigest: prepared.configurationDigest,
            challengerProbability: 0.5,
          }) === "CONTROL"
            ? "control"
            : "challenger"
        if (browsers[arm].length < 20) browsers[arm].push(browser)
        if (browsers.control.length === 20 && browsers.challenger.length === 20)
          break
      }
      expect(browsers.control).toHaveLength(20)
      expect(browsers.challenger).toHaveLength(20)
      const keyring = parseRecommendationKeyring(
        JSON.stringify({
          keys: [
            {
              kid: "winner-fixture",
              status: "active",
              key: Buffer.alloc(32, 31).toString("base64url"),
            },
          ],
        }),
      )
      const tokenService = {
        activeKid: keyring.active.kid,
        ...createRecommendationTokenService({
          keyring,
          readRevokedKids: async () => [],
        }),
      }
      const caller = {
        id: "catalog-winner-web",
        role: "CONSUMER_BEARER" as const,
        rateLimitBucketKey: "catalog-winner-web",
      }
      const episodes = new RecommendationEpisodeService({
        prisma,
        tokenService,
      })
      const visit = (browserDigest: string, seedMediaId = sourceId) => ({
        visitId: randomUUID(),
        browserDigest,
        seedMediaId,
        consentReceiptDigest: null,
        profileTokenDigest: null,
        locale: "en",
        audioLanguageSlug: "english",
        sessionDigest: createHash("sha256").update(browserDigest).digest("hex"),
        clientDeliveryContract: null,
        trafficCategory: "ordinary_browser" as const,
        caller,
      })
      for (const arm of ["control", "challenger"] as const) {
        for (const [index, browser] of browsers[arm].entries()) {
          // Two genuinely empty saved-source visits remain in the challenger
          // denominator. The isolated incumbent lacks a healthy retention
          // watermark, so its unavailable deliveries also remain in the count.
          const input = visit(
            browser,
            arm === "challenger" && index >= 18 ? targetId : sourceId,
          )
          const delivered = await deliverPrecomputedPublicWatchVisit(
            prisma,
            input,
            tokenService,
          )
          expect(delivered).toMatchObject({
            disposition: "ab",
            status: "eligible",
            arm,
            measurementStatus: "recorded",
          })
          if (arm === "control") {
            expect(delivered.delivery?.result).toBe("unavailable")
          } else if (index >= 18) {
            expect(delivered.delivery?.result).toBe("empty")
          } else {
            expect(delivered.delivery?.result).toBe("served")
            const card = delivered.delivery!.items[0]!
            const click = {
              caller,
              contractVersion: "recommendation-evidence-v1",
              capability: card.capability,
              requestId: delivered.delivery!.requestId!,
              itemId: card.id,
              sessionDigest: input.sessionDigest,
              browserDigest: browser,
              eventId: randomUUID(),
              occurredAt: new Date().toISOString(),
              claimNonce: `winner-click-${randomUUID()}`,
            }
            expect(await episodes.select(click)).toMatchObject({
              status: "accepted",
            })
            if (index === 0)
              expect(await episodes.select(click)).toMatchObject({
                status: "replay",
              })
          }
        }
      }
      const repeatBrowserVisit = {
        ...visit(browsers.control[0]!),
        sessionDigest: "e".repeat(64),
      }
      expect(
        await deliverPrecomputedPublicWatchVisit(
          prisma,
          repeatBrowserVisit,
          tokenService,
        ),
      ).toMatchObject({
        status: "eligible",
        arm: "control",
        measurementStatus: "recorded",
      })
      // Delivery retry remains one logical visit; a new session on this
      // browser stays in the same arm and cluster.
      expect(
        await deliverPrecomputedPublicWatchVisit(
          prisma,
          repeatBrowserVisit,
          tokenService,
        ),
      ).toMatchObject({
        status: "eligible",
        arm: "control",
        measurementStatus: "recorded",
      })
      expect(
        await deliverPrecomputedPublicWatchVisit(
          prisma,
          {
            ...visit(browsers.challenger[0]!),
            trafficCategory: "declared_crawler",
          },
          tokenService,
        ),
      ).toMatchObject({
        status: "excluded",
        qualification: "declared_automation",
      })
      expect(
        await deliverPrecomputedPublicWatchVisit(
          prisma,
          visit(browsers.challenger[0]!, "later-catalog-addition"),
          tokenService,
        ),
      ).toMatchObject({ status: "excluded", reason: "outside_frozen_cohort" })
      const interim = await evaluatePublicPrecomputedCtr(prisma, {
        experimentId,
        operator: reviewer,
      })
      expect(interim).toMatchObject({
        status: "available",
        report: {
          isFinal: false,
          outcome: "inconclusive",
          evidenceBasis: "isolated_fixture",
          byArm: {
            control: {
              eligibleVisits: 21,
              clickedVisits: 0,
              unavailableVisits: 21,
              independentBrowsers: 20,
            },
            challenger: {
              eligibleVisits: 20,
              clickedVisits: 18,
              acceptedSelections: 18,
              emptyVisits: 2,
              independentBrowsers: 20,
            },
          },
        },
      })
      if (interim.status !== "available")
        throw new Error("Missing interim report")
      const receipt = (revision: number) =>
        prisma.recommendationPrecomputedCtrReport.findUniqueOrThrow({
          where: { experimentId_revision: { experimentId, revision } },
        })
      const promotion = {
        expectedControlVersion: active.version,
        expectedExperimentId: experimentId,
        expectedGenerationId: generationId,
        expectedReportRevision: interim.report.revision,
        expectedReportEvidenceDigest: (await receipt(interim.report.revision))
          .evidenceDigest,
        operator: reviewer,
      }
      await expect(
        promotePrecomputedPublicExperiment(prisma, promotion),
      ).rejects.toMatchObject({ code: "incompatible_target" })
      // Completing a refresh or evaluating counts never selects new serving.
      await expect(
        runPrecomputedCatalog(
          {
            generationId: refreshId,
            inputCutoff: cutoff,
            historyRequired: false,
            capacity: await fixtureCapacity(),
          },
          { ...dependencies(), model: controlledModel(targetId, []) },
        ),
      ).resolves.toMatchObject({ state: "complete" })
      expect(await loadPrecomputedPublicControl(prisma)).toEqual(active)
      const afterRawExpiry = new Date(endsAt.getTime() + 7 * 86_400_000)
      await prisma.$transaction((tx) =>
        purgeExpiredPrecomputedVisitRoots(tx, afterRawExpiry, 100),
      )
      expect(
        await prisma.recommendationPrecomputedVisit.count({
          where: { experimentId },
        }),
      ).toBe(0)
      expect(
        await deliverPrecomputedPublicWatchVisit(
          prisma,
          repeatBrowserVisit,
          tokenService,
        ),
      ).toMatchObject({
        status: "unavailable",
        reason: "visit_persistence_unavailable",
      })
      expect(
        await prisma.recommendationPrecomputedVisit.count({
          where: { experimentId },
        }),
      ).toBe(0)
      const final = await evaluatePublicPrecomputedCtr(prisma, {
        experimentId,
        operator: reviewer,
        now: afterRawExpiry,
      })
      expect(final).toMatchObject({
        status: "available",
        report: {
          isFinal: true,
          outcome: "challenger",
          reasons: [],
          byArm: interim.report.byArm,
        },
      })
      if (final.status !== "available") throw new Error("Missing final report")
      expect(await loadPrecomputedPublicControl(prisma)).toEqual(active)
      const finalPromotion = {
        ...promotion,
        expectedReportRevision: final.report.revision,
        expectedReportEvidenceDigest: (await receipt(final.report.revision))
          .evidenceDigest,
      }
      await expect(
        promotePrecomputedPublicExperiment(prisma, {
          ...finalPromotion,
          expectedGenerationId: refreshId,
        }),
      ).rejects.toMatchObject({ code: "incompatible_target" })
      await expect(
        promotePrecomputedPublicExperiment(prisma, {
          ...finalPromotion,
          expectedReportEvidenceDigest: "0".repeat(64),
        }),
      ).rejects.toMatchObject({ code: "incompatible_target" })
      const promoted = await promotePrecomputedPublicExperiment(
        prisma,
        finalPromotion,
      )
      expect(promoted).toMatchObject({
        mode: "promoted",
        version: active.version + 1,
        experimentId,
        generationId,
        reportRevision: final.report.revision,
      })
      expect(
        await deliverPrecomputedPublicWatchVisit(
          prisma,
          visit(browsers.control[0]!),
          tokenService,
        ),
      ).toMatchObject({
        disposition: "promoted",
        status: "not_applicable",
        delivery: { result: "served" },
      })
      await rollbackPrecomputedPublicExperiment(prisma, {
        ...finalPromotion,
        expectedControlVersion: promoted.version,
        reasonCode: "winner_rehearsal_complete",
      })
      expect(await loadPrecomputedPublicControl(prisma)).toMatchObject({
        mode: "incumbent",
        version: active.version + 2,
        retainedExperimentId: experimentId,
      })
      expect(
        await loadPrivatePrecomputedCtrReport(prisma, {
          experimentId,
          reviewer,
        }),
      ).toEqual(final)
      expect(
        await loadDurablePrecomputedBuildReport(prisma, {
          generationId,
          reviewer,
        }),
      ).toMatchObject({ usage: { modelCallCount: 3, modelKnownCostUsd: 0.04 } })
    }, 120_000)

    it("binds a real incumbent recovery to the original challenger visit", async () => {
      const generationId = `catalog-fallback-${suffix}`
      const experimentId = `catalog-fallback-test-${suffix}`
      await prisma.recommendationServingControl.update({
        where: { id: "recommendation-serving-control" },
        data: { enabled: true },
      })
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
      ).resolves.toMatchObject({ state: "complete" })
      // Seed real native transcript vectors for the incumbent retrieval path.
      // These synthetic vectors and retention watermark are fixture setup,
      // not model, API, request, visit, or click-service mocks.
      for (const id of [sourceId, targetId]) {
        const editionId = `fallback-edition-${id}`
        const transcriptId = `fallback-transcript-${id}`
        await prisma.videoEdition.create({
          data: { id: editionId, coreId: editionId, name: "Fixture English" },
        })
        await prisma.videoDub.update({
          where: { id: `dub-${id}` },
          data: { videoEditionId: editionId },
        })
        await prisma.videoTranscript.create({
          data: {
            id: transcriptId,
            videoEditionId: editionId,
            videoId: id,
            language: "en",
            model: "embeddings",
            embeddingProvider: "jesus-film-ai-gateway",
            embeddingNativeDimensions: 1536,
            dimensions: 1536,
            chunkingType: "fixture",
            maxChunkTokens: 100,
            overlapTokens: 0,
            totalChunks: 1,
            totalTokens: 10,
            generatedAt: new Date(),
          },
        })
        await prisma.videoTranscriptChunk.create({
          data: {
            id: `fallback-chunk-${id}`,
            transcriptId,
            language: "en",
            model: "embeddings",
            dimensions: 1536,
            chunkIndex: 0,
            chunkId: "fixture-0",
            text: "Hope during hardship",
            rawSourceText: "Hope during hardship",
            tokenCount: 10,
            startSeconds: 0,
            endSeconds: 60,
          },
        })
        await prisma.$executeRaw`
          UPDATE video_transcript_chunk
          SET embedding = (ARRAY[1::real] || array_fill(0::real, ARRAY[1535]))::public.vector
          WHERE id = ${`fallback-chunk-${id}`}`
      }
      await prisma.recommendationRetentionRun.create({
        data: {
          id: `fallback-retention-${suffix}`,
          status: "SUCCEEDED",
          batchSize: 100,
          completedAt: new Date(),
          expiresAt: new Date(Date.now() + 90 * 86_400_000),
        },
      })
      expect(
        await getSemanticDeliveryCandidatePool(prisma, {
          seedMediaId: sourceId,
          locale: "en",
          audioLanguageSlug: "english",
          limit: 6,
        }),
      ).toContainEqual(expect.objectContaining({ videoId: targetId }))
      const generation =
        await prisma.recommendationPrecomputedGeneration.findUniqueOrThrow({
          where: { id: generationId },
        })
      const routing = await readControlRouting(prisma)
      if (!routing) throw new Error("Missing fixture incumbent")
      const startsAt = new Date(Date.now() - 60_000)
      const prepared = await preparePrecomputedPublicExperiment(prisma, {
        id: experimentId,
        generationId,
        startsAt,
        endsAt: oneUtcCalendarMonthAfter(startsAt),
        expectedControlRoutingDigest: routing.routingDigest,
        expectedSourceSetDigest: generation.sourceSetDigest,
        policySettings: {
          baselineHumanVisitCtr: 0.2,
          minimumDetectableAbsoluteUplift: 0.05,
          minimumPracticalAbsoluteUplift: 0.05,
          plannedPower: 0.8,
          minimumEligibleVisitsPerArm: 20,
          minimumIndependentBrowsersPerArm: 10,
          minimumDurationHours: 1,
          lateEventCutoffHours: 0,
          maximumActualFallbackRate: 0.2,
          maximumUnlinkedDeliveryRate: 0,
        },
        authority: "isolated_fixture",
        operator: reviewer,
      })
      const before = await loadPrecomputedPublicControl(prisma)
      const active = await startPrecomputedPublicExperiment(prisma, {
        experimentId,
        expectedConfigurationDigest: prepared.configurationDigest,
        expectedControlVersion: before.version,
        authority: "isolated_fixture",
        operator: reviewer,
      })
      const browserDigest = Array.from({ length: 128 }, (_, i) =>
        createHash("sha256").update(`fallback-browser-${i}`).digest("hex"),
      ).find(
        (value) =>
          chooseExperimentArm({
            unitDigest: precomputedBrowserUnitDigest(experimentId, value),
            configurationDigest: prepared.configurationDigest,
            challengerProbability: 0.5,
          }) === "CHALLENGER",
      )
      if (!browserDigest) throw new Error("No fixture challenger browser")
      const caller = {
        id: "catalog-recovery-web",
        role: "CONSUMER_BEARER" as const,
        rateLimitBucketKey: "catalog-recovery-web",
      }
      const input = {
        visitId: randomUUID(),
        browserDigest,
        seedMediaId: sourceId,
        consentReceiptDigest: null,
        profileTokenDigest: null,
        locale: "en",
        audioLanguageSlug: "english",
        sessionDigest: "f".repeat(64),
        clientDeliveryContract: null,
        trafficCategory: "ordinary_browser" as const,
        caller,
      }
      // Inject an unavailable saved-card signer. The incumbent's real factory
      // retains its test-runtime signer and must issue the actual recovery.
      const recovered = await deliverPrecomputedPublicWatchVisit(
        prisma,
        input,
        null,
      )
      expect(recovered.delivery?.reason).toBeNull()
      expect(recovered).toMatchObject({
        status: "eligible",
        arm: "challenger",
        measurementStatus: "recorded",
        delivery: {
          result: "served",
          strategyVersion: routing.manifest.strategyVersion,
        },
      })
      const tokenService = createRuntimeRecommendationTokenService(prisma)
      if (!tokenService)
        throw new Error("Missing native fixture runtime signer")
      const card = recovered.delivery!.items[0]!
      expect(card.targetMediaId).toBe(targetId)
      const episodes = new RecommendationEpisodeService({
        prisma,
        tokenService,
      })
      expect(
        await episodes.select({
          caller,
          contractVersion: "recommendation-evidence-v1",
          capability: card.capability,
          requestId: recovered.delivery!.requestId!,
          itemId: card.id,
          sessionDigest: input.sessionDigest,
          browserDigest,
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          claimNonce: `fallback-click-${randomUUID()}`,
        }),
      ).toMatchObject({ status: "accepted" })
      expect(
        await evaluatePublicPrecomputedCtr(prisma, {
          experimentId,
          operator: reviewer,
        }),
      ).toMatchObject({
        status: "available",
        report: {
          outcome: "inconclusive",
          byArm: {
            control: { eligibleVisits: 0, clickedVisits: 0 },
            challenger: {
              eligibleVisits: 1,
              clickedVisits: 1,
              actualFallbackVisits: 1,
              servedVisits: 1,
              unlinkedDeliveredVisits: 0,
            },
          },
        },
      })
      await rollbackPrecomputedPublicExperiment(prisma, {
        expectedControlVersion: active.version,
        expectedExperimentId: experimentId,
        expectedGenerationId: generationId,
        expectedReportRevision: null,
        reasonCode: "fallback_rehearsal_complete",
        operator: reviewer,
      })
    }, 120_000)

    it("saves exact non-English transcript support from a later native catalog page", async () => {
      const videoId = `z-catalog-span-${suffix}`
      const editionId = `span-edition-${suffix}`
      const transcriptId = `span-transcript-${suffix}`
      const firstChunkId = `span-chunk-0-${suffix}`
      const secondChunkId = `span-chunk-1-${suffix}`
      const firstText = "ይህ የመጀመሪያው ክፍል ስለ ጉዞ ይናገራል።"
      const secondText = "በችግር ጊዜ ተስፋ እና ድፍረት አብረው የሚያገለግሉ ትምህርቶች ናቸው።"
      await prisma.video.create({
        data: {
          id: videoId,
          coreId: `core-${videoId}`,
          slug: `span-story-${suffix}`,
          ...catalogTimestamps,
        },
      })
      await prisma.videoLocale.create({
        data: {
          id: `locale-${videoId}`,
          videoId,
          locale: "en",
          status: "PUBLISHED",
          title: "Courage and hope in another story",
          description: "A distinct story about hope during hardship.",
          ...catalogTimestamps,
        },
      })
      await prisma.videoEdition.create({
        data: { id: editionId, coreId: editionId, name: "Amharic source" },
      })
      await prisma.videoDub.create({
        data: {
          id: `dub-${videoId}`,
          coreId: `dub-core-${videoId}`,
          videoId,
          languageId: `catalog-language-${suffix}`,
          muxVideoId: `catalog-mux-${suffix}`,
          videoEditionId: editionId,
          published: true,
          ...catalogTimestamps,
        },
      })
      await prisma.videoTranscript.create({
        data: {
          id: transcriptId,
          videoEditionId: editionId,
          videoId,
          language: "am",
          model: "embeddings",
          embeddingProvider: "jesus-film-ai-gateway",
          embeddingNativeDimensions: 1536,
          dimensions: 1536,
          chunkingType: "fixture",
          maxChunkTokens: 100,
          overlapTokens: 0,
          totalChunks: 2,
          totalTokens: 20,
          generatedAt: catalogCreatedAt,
        },
      })
      for (const [index, text] of [firstText, secondText].entries()) {
        await prisma.videoTranscriptChunk.create({
          data: {
            id: index === 0 ? firstChunkId : secondChunkId,
            transcriptId,
            language: "am",
            model: "embeddings",
            dimensions: 1536,
            chunkIndex: index,
            chunkId: `fixture-${index}`,
            text,
            rawSourceText: text,
            tokenCount: 10,
            startSeconds: index * 60,
            endSeconds: (index + 1) * 60,
          },
        })
      }

      const connected = dependencies()
      const catalog: SourceCatalog = {
        ...connected.catalog,
        async chunks(input) {
          const result = await readPrecomputedCatalog(
            prisma,
            { action: "chunks", ...input, limit: 1 },
            bearer,
          )
          if (result.action !== "chunks") throw new Error("Wrong response")
          return result
        },
      }
      const seenChunkIds: string[] = []
      const model: StructuredModel = {
        async generate({ schema: outputSchema, prompt }) {
          const data = JSON.parse(prompt) as {
            task: string
            untrustedCatalogData: {
              source: { id: string }
              transcriptChunks?: Array<{
                id: string
                language: string
                spans: Array<{ id: string; text: string }>
              }>
            }
          }
          const source = data.untrustedCatalogData.source.id
          if (data.task === "source_summary")
            return {
              output: outputSchema.parse({
                summaryEnglish: "Stories of hope and courage during hardship.",
              }),
              usage: { inputTokens: 10, outputTokens: 2, costUsd: 0.001 },
            }
          if (data.task === "catalog_discovery")
            return {
              output: outputSchema.parse({
                candidateVideoIds: source === sourceId ? [videoId] : [],
              }),
              usage: { inputTokens: 10, outputTokens: 2, costUsd: 0.001 },
            }
          if (data.task !== "candidate_judgment" || source !== sourceId)
            throw new Error(`Unexpected model task: ${data.task}`)
          const chunk = data.untrustedCatalogData.transcriptChunks?.[0]
          if (!chunk || chunk.language !== "am")
            throw new Error("Expected complete Amharic transcript page")
          seenChunkIds.push(chunk.id)
          const connections =
            chunk.id === firstChunkId
              ? []
              : [
                  {
                    kind: "direct",
                    relationship: "hope_through_hardship",
                    reasonEnglish:
                      "The second story gives another account of hope during hardship.",
                    addedViewingValueEnglish: null,
                    evidence: {
                      basis: "transcript",
                      spanIds: [chunk.spans[0]!.id],
                    },
                    strength: 90,
                  },
                ]
          if (chunk.id === secondChunkId)
            expect(chunk.spans[0]!.text).toBe(secondText)
          return {
            output: outputSchema.parse({ connections }),
            usage: { inputTokens: 10, outputTokens: 2, costUsd: 0.001 },
          }
        },
      }
      const generationId = `catalog-span-${suffix}`
      // Earlier tests legitimately update catalog rows after the suite's
      // historical cutoff. Fence this build after those fixture mutations.
      const spanCutoff = new Date().toISOString()
      await expect(
        runPrecomputedCatalog(
          {
            generationId,
            inputCutoff: spanCutoff,
            historyRequired: false,
            capacity: await fixtureCapacity(),
          },
          { catalog, ingest: connected.ingest, model },
        ),
      ).resolves.toMatchObject({ state: "complete", failedSourceCount: 0 })
      expect(seenChunkIds).toEqual([firstChunkId, secondChunkId])
      const comparison = await loadPrecomputedRecommendationComparison(prisma, {
        generationId,
        sourceVideoId: sourceId,
        audioLanguageSlug: "english",
        reviewer,
      })
      expect(comparison).toMatchObject({
        state: "ready",
        allAcceptedCount: 1,
        experimental: [
          {
            targetVideoId: videoId,
            evidence: {
              basis: "transcript",
              passages: [
                {
                  chunkId: secondChunkId,
                  videoId,
                  language: "am",
                  excerpt: secondText,
                },
              ],
            },
          },
        ],
      })
    }, 120_000)

    it("caps four concurrent sources at two actual GA HTTP attempts", async () => {
      const generationId = `catalog-ga-cap-${suffix}`
      const runCutoff = new Date().toISOString()
      const catalogPage = await readPrecomputedCatalog(
        prisma,
        { action: "catalog", cutoff: runCutoff, limit: 100 },
        bearer,
      )
      if (catalogPage.action !== "catalog")
        throw new Error("Wrong catalog response")
      const expectedSourceIds = catalogPage.videos.map((video) => video.id)
      expect(expectedSourceIds).toHaveLength(4)
      const ga = gaWatchHistoryFixtureOptions({
        sourceSlug: `story-0-${suffix}`,
        targetSlug: `story-1-${suffix}`,
      })
      const connected = dependencies()
      const writes: Array<Record<string, unknown>> = []
      let qualificationComplete = false
      const ingest: SourceIngest = async (raw) => {
        writes.push(raw as Record<string, unknown>)
        const result = await connected.ingest(raw)
        if ((raw as Record<string, unknown>).action === "history_qualification")
          qualificationComplete = true
        return result
      }
      const baseModel = controlledModel(targetId, [])
      const model: StructuredModel = {
        async generate(request) {
          const data = JSON.parse(request.prompt) as { task: string }
          return data.task === "source_summary"
            ? {
                output: request.schema.parse({
                  summaryEnglish: "A complete summary of this source story.",
                }),
                usage: { inputTokens: 20, outputTokens: 4, costUsd: 0.01 },
              }
            : baseModel.generate(request)
        },
      }
      let activeGa = 0
      let peakGa = 0
      let gaHttpAttempts = 0
      const result = await runPrecomputedCatalog(
        {
          generationId,
          inputCutoff: runCutoff,
          historyRequired: true,
          sourceConcurrency: 4,
          capacity: await fixtureCapacity(),
        },
        {
          ...connected,
          ingest,
          model,
          gaTransport: {
            serviceAccountEmail: ga.serviceAccountEmail,
            tokenProvider: ga.tokenProvider,
            fetchImpl: async (...args) => {
              gaHttpAttempts += 1
              activeGa += 1
              peakGa = Math.max(peakGa, activeGa)
              try {
                // Hold the first source request until another is admitted.
                // A fixed sleep races slower PostgreSQL source claims in CI.
                // Qualification requests are sequential and must pass first.
                if (qualificationComplete && peakGa < 2)
                  await vi.waitFor(() => expect(peakGa).toBe(2), {
                    timeout: 5_000,
                  })
                return await ga.fetchImpl(...args)
              } finally {
                activeGa -= 1
              }
            },
          },
        },
      )
      expect(result).toMatchObject({
        state: "complete",
        completedSourceCount: expectedSourceIds.length,
        failedSourceCount: 0,
      })
      expect(peakGa).toBe(2)
      expect(activeGa).toBe(0)
      expect(
        writes
          .filter((call) => call.action === "claim")
          .map((call) => call.sourceVideoId)
          .sort(),
      ).toEqual(expectedSourceIds)
      expect(writes.filter((call) => call.action === "complete")).toHaveLength(
        1,
      )
      const starts = writes.filter(
        (call) => call.action === "history_call_start",
      )
      const receipts = writes.filter((call) => call.action === "history_call")
      expect(starts).toHaveLength(gaHttpAttempts)
      expect(receipts).toHaveLength(gaHttpAttempts)
      expect(
        receipts
          .filter((call) => typeof call.sourceVideoId === "string")
          .map((call) => call.sourceVideoId),
      ).toEqual(expect.arrayContaining(expectedSourceIds))
      const report = await loadDurablePrecomputedBuildReport(prisma, {
        generationId,
        sourceVideoId: sourceId,
        reviewer,
      })
      expect(report).toMatchObject({
        usage: {
          historyCallCount: gaHttpAttempts,
          historyPendingCount: 0,
          historyUnknownCostCount: gaHttpAttempts,
          modelPendingCount: 0,
          modelUnknownCostCount: 0,
        },
      })
    }, 120_000)

    it("cancels queued GA admission after failure while draining both started HTTP receipts", async () => {
      const generationId = `catalog-ga-stop-${suffix}`
      const runCutoff = new Date().toISOString()
      const ga = gaWatchHistoryFixtureOptions({
        sourceSlug: `story-0-${suffix}`,
        targetSlug: `story-1-${suffix}`,
      })
      const connected = dependencies()
      const writes: Array<Record<string, unknown>> = []
      let qualificationComplete = false
      let claimFailureDelivered = false
      let scopedFetches = 0
      const ingest: SourceIngest = async (raw) => {
        const call = raw as Record<string, unknown>
        const result = await connected.ingest(raw)
        writes.push(call)
        if (call.action === "history_qualification")
          qualificationComplete = true
        if (
          call.action === "claim" &&
          call.sourceVideoId === `c-catalog-new-${suffix}`
        ) {
          await vi.waitFor(
            () => {
              expect(scopedFetches).toBe(2)
              expect(
                writes.filter((item) => item.action === "claim"),
              ).toHaveLength(4)
            },
            { timeout: 5_000 },
          )
          await new Promise((resolve) => setTimeout(resolve, 20))
          claimFailureDelivered = true
          throw new Error("Fixture claim response lost")
        }
        return result
      }
      let releaseFirst: () => void = () => undefined
      const firstMayFinish = new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
      let releaseSecond: () => void = () => undefined
      const secondMayFinish = new Promise<void>((resolve) => {
        releaseSecond = resolve
      })
      const gaTransport = {
        serviceAccountEmail: ga.serviceAccountEmail,
        tokenProvider: ga.tokenProvider,
        fetchImpl: async (...args: Parameters<typeof fetch>) => {
          if (!qualificationComplete) return ga.fetchImpl(...args)
          scopedFetches += 1
          if (scopedFetches === 1) {
            await firstMayFinish
            return ga.fetchImpl(...args)
          }
          if (scopedFetches === 2) {
            await secondMayFinish
            return ga.fetchImpl(...args)
          }
          throw new Error("Queued GA attempt was admitted after failure")
        },
      }
      const interrupted = runPrecomputedCatalog(
        {
          generationId,
          inputCutoff: runCutoff,
          historyRequired: true,
          sourceConcurrency: 4,
          capacity: await fixtureCapacity(),
        },
        {
          ...connected,
          ingest,
          gaTransport,
          model: {
            async generate() {
              throw new Error("No model call should start before GA settles")
            },
          },
        },
      ).then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      )
      try {
        await vi.waitFor(
          () => {
            expect(scopedFetches).toBe(2)
            expect(claimFailureDelivered).toBe(true)
          },
          { timeout: 5_000 },
        )
        await new Promise((resolve) => setTimeout(resolve, 10))
      } finally {
        releaseFirst()
        releaseSecond()
      }
      expect(await interrupted).toMatchObject({
        error: { message: "Fixture claim response lost" },
      })
      expect(scopedFetches).toBe(2)
      const starts = writes.filter(
        (call) =>
          call.action === "history_call_start" &&
          typeof call.sourceVideoId === "string",
      )
      const receipts = writes.filter(
        (call) =>
          call.action === "history_call" &&
          typeof call.sourceVideoId === "string",
      )
      expect(starts).toHaveLength(2)
      expect(receipts).toHaveLength(2)
      expect(receipts.map((receipt) => receipt.status)).toEqual([
        "succeeded",
        "succeeded",
      ])
      expect(writes.some((call) => call.action === "complete")).toBe(false)
      const report = await loadDurablePrecomputedBuildReport(prisma, {
        generationId,
        sourceVideoId: sourceId,
        reviewer,
      })
      expect(report).toMatchObject({
        state: "incomplete",
        usage: { historyPendingCount: 0 },
      })
    }, 120_000)

    it("drains an in-flight native receipt, stops admission, and resumes each checkpoint", async () => {
      const generationId = `catalog-parallel-stop-${suffix}`
      const runCutoff = new Date().toISOString()
      const input = {
        generationId,
        inputCutoff: runCutoff,
        historyRequired: false,
        sourceConcurrency: 2,
        capacity: await fixtureCapacity(),
      }
      const connected = dependencies()
      const attempted: Array<{ sourceId: string; task: string }> = []
      let signalSecondStarted: () => void = () => undefined
      const secondStarted = new Promise<void>((resolve) => {
        signalSecondStarted = resolve
      })
      let releaseSecond: () => void = () => undefined
      const secondMayFinish = new Promise<void>((resolve) => {
        releaseSecond = resolve
      })
      let firstReceiptCommitted = false
      const ingest: SourceIngest = async (raw) => {
        const call = raw as Record<string, unknown>
        const result = await connected.ingest(raw)
        if (
          call.action === "model_call" &&
          call.sourceVideoId === sourceId &&
          call.stage === "source_summary" &&
          call.status === "failed"
        )
          firstReceiptCommitted = true
        return result
      }
      const failingModel: StructuredModel = {
        async generate({ schema, prompt }) {
          const data = JSON.parse(prompt) as {
            task: string
            untrustedCatalogData: { source: { id: string } }
          }
          const source = data.untrustedCatalogData.source.id
          attempted.push({ sourceId: source, task: data.task })
          if (data.task !== "source_summary")
            throw new Error("No later model call should be admitted")
          if (source === sourceId) {
            await secondStarted
            throw new Error("fixture first-source provider outage")
          }
          if (source !== targetId)
            throw new Error("A third source was admitted")
          signalSecondStarted()
          await secondMayFinish
          return {
            output: schema.parse({
              summaryEnglish: "A complete summary of the second source.",
            }),
            usage: { inputTokens: 20, outputTokens: 4, costUsd: 0.01 },
          }
        },
      }
      const interrupted = runPrecomputedCatalog(input, {
        ...connected,
        ingest,
        model: failingModel,
      }).then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      )
      try {
        await vi.waitFor(() => expect(firstReceiptCommitted).toBe(true), {
          timeout: 5_000,
        })
        await new Promise((resolve) => setTimeout(resolve, 10))
      } finally {
        releaseSecond()
      }
      expect(await interrupted).toMatchObject({
        error: { code: "provider_unavailable" },
      })
      expect(
        attempted.sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
      ).toEqual([
        { sourceId, task: "source_summary" },
        { sourceId: targetId, task: "source_summary" },
      ])
      expect(
        await connected.ingest({
          action: "retention_status",
          protocolVersion: 2,
          generationId,
        }),
      ).toMatchObject({ state: "incomplete", sourceWorkResumable: true })
      const firstReceipts =
        await prisma.recommendationPrecomputedModelCall.findMany({
          where: { generationId },
          select: { sourceVideoId: true, status: true, costUsd: true },
        })
      expect(firstReceipts).toHaveLength(2)
      expect(firstReceipts).toContainEqual(
        expect.objectContaining({
          sourceVideoId: targetId,
          status: "succeeded",
          costUsd: expect.anything(),
        }),
      )
      await admin.query(
        "UPDATE recommendation_precomputed_build_source SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE generation_id=$1 AND state='claimed'",
        [generationId],
      )
      const successful = controlledModel(targetId, [])
      const resumedTasks: Array<{ sourceId: string; task: string }> = []
      const resumedModel: StructuredModel = {
        async generate(request) {
          const data = JSON.parse(request.prompt) as {
            task: string
            untrustedCatalogData: { source: { id: string } }
          }
          resumedTasks.push({
            sourceId: data.untrustedCatalogData.source.id,
            task: data.task,
          })
          return data.task === "source_summary"
            ? {
                output: request.schema.parse({
                  summaryEnglish: "A complete summary for resumed source work.",
                }),
                usage: { inputTokens: 20, outputTokens: 4, costUsd: 0.01 },
              }
            : successful.generate(request)
        },
      }
      await expect(
        runPrecomputedCatalog(input, { ...connected, model: resumedModel }),
      ).resolves.toMatchObject({
        state: "complete",
        completedSourceCount: 4,
        failedSourceCount: 0,
      })
      expect(
        resumedTasks.filter(
          (task) =>
            task.sourceId === targetId && task.task === "source_summary",
        ),
      ).toHaveLength(0)
      expect(
        resumedTasks.filter(
          (task) =>
            task.sourceId === sourceId && task.task === "source_summary",
        ),
      ).toHaveLength(1)
      const finalReport = await loadDurablePrecomputedBuildReport(prisma, {
        generationId,
        sourceVideoId: sourceId,
        reviewer,
      })
      expect(finalReport).toMatchObject({
        state: "complete",
        usage: { modelPendingCount: 0 },
      })
    }, 120_000)
  },
)
