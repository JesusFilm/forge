import { createHash, randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { currentAdminMigrationSql } from "../current-schema.test-fixture"
import { purgeExpiredRecommendationRequests } from "../retention.service"
import { loadPrecomputedStorageCapacityReport } from "./storage-capacity"

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "precomputed storage capacity report on PostgreSQL",
  () => {
    let prisma: PrismaClient
    let admin: Client
    const schema = `precomputed_storage_${Date.now()}_${randomUUID().replaceAll("-", "")}`
    const suffix = randomUUID()
    const generationId = `report-${suffix}`
    const sourceVideoId = `report-source-${suffix}`

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
      await prisma.video.create({
        data: {
          id: sourceVideoId,
          coreId: `core-${sourceVideoId}`,
          slug: sourceVideoId,
        },
      })
      await prisma.recommendationPrecomputedGeneration.create({
        data: {
          id: generationId,
          protocolVersion: 2,
          modelId: "gpt-6-astra",
          promptVersion: "storage-v1",
          inputDigest: "a".repeat(64),
          sourceSetDigest: "b".repeat(64),
          inputCutoff: new Date("2026-10-01T00:00:00.000Z"),
          expectedSourceCount: 1,
          inputMode: "content_only",
          inputSnapshotMode: "observed_fenced",
          status: "complete",
          completedAt: new Date("2026-10-02T00:00:00.000Z"),
        },
      })
      await prisma.recommendationPrecomputedSource.create({
        data: {
          generationId,
          sourceVideoId,
          payload: Array.from({ length: 8 }, (_, rank) => ({
            targetVideoId: `target-${rank}-${suffix}`,
            rank: rank + 1,
            reasonEnglish: "A useful content connection.",
          })),
          submissionDigest: "c".repeat(64),
          acceptedCount: 8,
          status: "complete",
        },
      })
      await prisma.recommendationRequest.create({
        data: {
          id: `storage-traffic-${suffix}`,
          contractVersion: "semantic-recommendation-v1",
          surfaceVersion: "watch-below-player-v1",
          manifestId: "semantic-transcript-pgvector-v1",
          strategyVersion: "semantic-transcript-pgvector-v1",
          classifierVersion: "legacy-position-v0",
          sessionDigest: "f".repeat(64),
          seedMediaId: sourceVideoId,
          locale: "en",
          expectedItemCount: 0,
          state: "ISSUED",
          result: "EMPTY",
          deliveryJti: randomUUID(),
          signingKid: "fixture",
          createdAt: new Date("2026-10-05T00:00:00.000Z"),
          issuedAt: new Date("2026-10-05T00:00:00.000Z"),
          expiresAt: new Date("2026-11-02T00:00:00.000Z"),
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

    it("shows native relation parts and all eight accepted connections without live approval", async () => {
      const report = await loadPrecomputedStorageCapacityReport(prisma, {
        generationId,
        now: new Date("2026-10-06T12:00:00.000Z"),
      })
      expect(report.basis).toBe("database_read_only_snapshot")
      expect(report.selectedGeneration).toMatchObject({
        generationId,
        acceptedConnections: 8,
      })
      expect(report.selectedGeneration?.inlineTupleBytes).toBeGreaterThan(0)
      expect(
        report.selectedGeneration?.inlineBytesPerConnection,
      ).toBeGreaterThan(0)
      const sourceRelation = report.relations.find(
        (row) => row.table === "recommendation_precomputed_source",
      )
      expect(sourceRelation?.totalBytes).toBeGreaterThan(0)
      expect(
        (sourceRelation?.heapBytes ?? 0) +
          (sourceRelation?.indexBytes ?? 0) +
          (sourceRelation?.toastBytes ?? 0) +
          (sourceRelation?.auxBytes ?? 0),
      ).toBe(sourceRelation?.totalBytes)
      expect(report.readiness).toMatchObject({
        approved: false,
        missing: expect.arrayContaining([
          "first_real_catalog_run",
          "verified_human_traffic_baseline",
          "mastra_feature_storage_measurement",
          "measured_retained_overlap_budget",
        ]),
      })
      expect(report.globalWal).toMatchObject({
        scope: "shared_cluster_cumulative",
      })
      expect(report.rawVisits.retentionDays).toBe(29)
      expect(report.rawVisits.sharedRelationBytesPerLiveRow).toBeNull()
      expect(report.observedTraffic).toMatchObject({
        recordedRequests: 1,
        largestObservedUtcCalendarDayRequests: 1,
        botFiltering: "unverified",
        eligibleHumanVisitsPerDay: null,
      })
      expect(report.retainedVolumeProjection).toMatchObject({
        status: "unqualified",
        projectedBytes: null,
      })
      expect(report.buildRollbackOverlap).toMatchObject({
        completeGenerations: 1,
        newestTwoCompleteProtected: 1,
        rollbackHolds: 0,
        activeBuilds: 0,
        measuredPhysicalOverlapBytes: null,
      })
      expect(report.writeQueryImpact).toMatchObject({
        status: "not_measured_for_live_workload",
        writeLatencyMs: null,
        readLatencyMs: null,
        featureWalBytes: null,
      })
    })

    it("measures a populated visit relation and drains expired visits through ordinary retention", async () => {
      const now = new Date("2026-10-06T12:00:00.000Z")
      const experimentId = `storage-load-${suffix}`
      await prisma.recommendationPrecomputedExperiment.create({
        data: {
          id: experimentId,
          generationId,
          controlManifestId: "semantic-transcript-pgvector-v1",
          challengerManifestId: "precomputed-watch-preview-v1",
          controlManifestDigest: "d".repeat(64),
          controlRoutingDigest: "e".repeat(64),
          sourceSetDigest: "b".repeat(64),
          assignmentPolicyVersion: "storage-v1",
          eligibilityPolicyVersion: "storage-v1",
          deliveryPolicyVersion: "storage-v1",
          configurationDigest: "f".repeat(64),
          state: "closed",
          startsAt: new Date("2026-08-31T00:00:00.000Z"),
          endsAt: new Date("2026-09-30T00:00:00.000Z"),
          expiresAt: new Date("2026-10-07T00:00:00.000Z"),
        },
      })
      const before = await loadPrecomputedStorageCapacityReport(prisma)
      const [{ lsn }] = await prisma.$queryRaw<Array<{ lsn: string }>>`
        SELECT pg_current_wal_insert_lsn()::text AS lsn`
      const writeStarted = performance.now()
      for (let offset = 0; offset < 1_000; offset += 250)
        await prisma.recommendationPrecomputedVisit.createMany({
          data: Array.from({ length: 250 }, (_, index) => {
            const sequence = offset + index
            return {
              id: randomUUID(),
              experimentId,
              browserUnitDigest: createHash("sha256")
                .update(`${suffix}:${sequence}`)
                .digest("hex"),
              sourceVideoId,
              locale: "en",
              audioLanguageSlug: "english",
              eligibility: "eligible",
              qualification: "unverified_browser",
              arm:
                sequence % 2 === 0
                  ? ("CONTROL" as const)
                  : ("CHALLENGER" as const),
              createdAt: new Date("2026-09-01T00:00:00.000Z"),
              expiresAt: new Date("2026-09-29T00:00:00.000Z"),
            }
          }),
        })
      const writeMs = performance.now() - writeStarted
      const [{ bytes: walDelta }] = await prisma.$queryRaw<
        Array<{ bytes: bigint }>
      >`
        SELECT pg_wal_lsn_diff(pg_current_wal_insert_lsn(), ${lsn}::pg_lsn)::bigint AS bytes`
      const readStarted = performance.now()
      const loaded = await loadPrecomputedStorageCapacityReport(prisma, {
        generationId,
        now,
      })
      const reportReadMs = performance.now() - readStarted
      const visitBefore = before.relations.find(
        (row) => row.table === "recommendation_precomputed_visit",
      )!
      const visitLoaded = loaded.relations.find(
        (row) => row.table === "recommendation_precomputed_visit",
      )!
      const allocatedDelta = visitLoaded.totalBytes - visitBefore.totalBytes
      expect(loaded.rawVisits.count).toBe(1_000)
      expect(loaded.rawVisits.sharedRelationBytesPerLiveRow).toBeGreaterThan(0)
      expect(allocatedDelta).toBeGreaterThan(0)
      expect(Number(walDelta)).toBeGreaterThan(0)
      const cleanupStarted = performance.now()
      let runs = 0
      while (
        await prisma.recommendationPrecomputedVisit.count({
          where: { experimentId },
        })
      ) {
        expect(runs++).toBeLessThan(20)
        const result = await purgeExpiredRecommendationRequests(
          prisma,
          now,
          100,
        )
        expect(result.status).toBe("succeeded")
      }
      const cleanupMs = performance.now() - cleanupStarted
      expect(
        await prisma.recommendationPrecomputedCtrArchivedVisit.count({
          where: { experimentId },
        }),
      ).toBe(1_000)
      const after = await loadPrecomputedStorageCapacityReport(prisma, { now })
      const visitAfter = after.relations.find(
        (row) => row.table === "recommendation_precomputed_visit",
      )!
      expect(after.rawVisits.count).toBe(0)
      // DELETE returns pages for reuse inside PostgreSQL. It does not imply
      // the volume or relation file shrank by the same number of bytes.
      expect(visitAfter.totalBytes).toBeGreaterThan(0)
      console.info(
        "precomputed_storage_fixture",
        JSON.stringify({
          rows: 1_000,
          acceptedConnections: loaded.selectedGeneration?.acceptedConnections,
          visitAllocatedDeltaBytes: allocatedDelta,
          visitAllocatedBytesPerRow: allocatedDelta / 1_000,
          sharedWalInsertDeltaBytes: Number(walDelta),
          writeMs: Math.round(writeMs),
          reportReadMs: Math.round(reportReadMs),
          cleanupMs: Math.round(cleanupMs),
          cleanupRuns: runs,
          visitRelationBytesAfterDelete: visitAfter.totalBytes,
          archivedVisitRelationBytes: after.relations.find(
            (row) =>
              row.table === "recommendation_precomputed_ctr_archived_visit",
          )?.totalBytes,
          clusterRelationBytes: after.relations.find(
            (row) => row.table === "recommendation_precomputed_ctr_cluster",
          )?.totalBytes,
          databaseBytesBefore: before.databaseBytes,
          databaseBytesLoaded: loaded.databaseBytes,
          databaseBytesAfterCleanup: after.databaseBytes,
        }),
      )
    }, 120_000)

    it("measures a catalog-shaped eight-connection source set with native TOAST and index allocation", async () => {
      const sourceCount = 1_030
      const acceptedConnections = sourceCount * 8
      const sourceIds = Array.from(
        { length: sourceCount },
        (_, index) => `storage-catalog-${index}-${suffix}`,
      )
      await prisma.video.createMany({
        data: sourceIds.map((id) => ({ id, coreId: `core-${id}`, slug: id })),
      })
      const before = await loadPrecomputedStorageCapacityReport(prisma)
      const [{ lsn }] = await prisma.$queryRaw<Array<{ lsn: string }>>`
        SELECT pg_current_wal_insert_lsn()::text AS lsn`
      const writeStarted = performance.now()
      for (let offset = 0; offset < sourceIds.length; offset += 100)
        await prisma.recommendationPrecomputedSource.createMany({
          data: sourceIds.slice(offset, offset + 100).map((id) => ({
            generationId,
            sourceVideoId: id,
            payload: Array.from({ length: 8 }, (_, rank) => ({
              rank: rank + 1,
              targetVideoId: `storage-target-${rank}-${suffix}`,
              relationship: "useful_next_watch",
              reasonEnglish: `This story explores a connected theme from the source and gives viewers a useful next perspective at position ${rank + 1}.`,
              supportingTranscriptPassages: [
                {
                  chunkId: `storage-chunk-${rank}`,
                  excerpt:
                    "A short supporting passage from the catalog fixture transcript, kept once in the generation.",
                },
              ],
            })),
            submissionDigest: "c".repeat(64),
            acceptedCount: 8,
            status: "complete",
          })),
        })
      const writeMs = performance.now() - writeStarted
      const [{ bytes: walDelta }] = await prisma.$queryRaw<
        Array<{ bytes: bigint }>
      >`
        SELECT pg_wal_lsn_diff(pg_current_wal_insert_lsn(), ${lsn}::pg_lsn)::bigint AS bytes`
      const after = await loadPrecomputedStorageCapacityReport(prisma, {
        generationId,
      })
      const priorSource = before.relations.find(
        (row) => row.table === "recommendation_precomputed_source",
      )!
      const loadedSource = after.relations.find(
        (row) => row.table === "recommendation_precomputed_source",
      )!
      const allocatedDelta = loadedSource.totalBytes - priorSource.totalBytes
      const readStarted = performance.now()
      for (let index = 0; index < 100; index++)
        await prisma.recommendationPrecomputedSource.findUniqueOrThrow({
          where: {
            generationId_sourceVideoId: {
              generationId,
              sourceVideoId: sourceIds[index % sourceIds.length],
            },
          },
        })
      const warmReadMs = performance.now() - readStarted
      expect(after.selectedGeneration?.acceptedConnections).toBe(
        acceptedConnections + 8,
      )
      expect(allocatedDelta).toBeGreaterThan(0)
      expect(loadedSource.indexBytes).toBeGreaterThan(priorSource.indexBytes)
      expect(Number(walDelta)).toBeGreaterThan(0)
      console.info(
        "precomputed_catalog_storage_fixture",
        JSON.stringify({
          newSources: sourceCount,
          newAcceptedConnections: acceptedConnections,
          sourceAllocatedDeltaBytes: allocatedDelta,
          allocatedBytesPerConnection: allocatedDelta / acceptedConnections,
          sourceHeapBytes: loadedSource.heapBytes,
          sourceIndexBytes: loadedSource.indexBytes,
          sourceToastBytes: loadedSource.toastBytes,
          sourceAuxBytes: loadedSource.auxBytes,
          sourceWriteWalInsertDeltaBytes: Number(walDelta),
          sourceWriteMs: Math.round(writeMs),
          warmRead100Ms: Math.round(warmReadMs),
          selectedGenerationRowExpressionBytes:
            after.selectedGeneration?.inlineTupleBytes,
        }),
      )
    }, 120_000)

    it("measures physical delta for a second synthetic generation with 1,031 sources and compact receipts", async () => {
      const nextId = `second-catalog-${suffix}`
      const before = await loadPrecomputedStorageCapacityReport(prisma)
      const [{ lsn }] = await prisma.$queryRaw<Array<{ lsn: string }>>`
        SELECT pg_current_wal_insert_lsn()::text AS lsn`
      await prisma.recommendationPrecomputedGeneration.create({
        data: {
          id: nextId,
          protocolVersion: 2,
          modelId: "gpt-6-astra",
          promptVersion: "storage-v1",
          inputDigest: "a".repeat(64),
          sourceSetDigest: "b".repeat(64),
          inputCutoff: new Date("2026-10-01T00:00:00.000Z"),
          expectedSourceCount: 1_031,
          inputMode: "content_only",
          inputSnapshotMode: "observed_fenced",
          status: "complete",
          completedAt: new Date("2026-10-03T00:00:00.000Z"),
        },
      })
      await prisma.$executeRaw`
        INSERT INTO recommendation_precomputed_source
          (generation_id, source_video_id, payload, submission_digest, accepted_count, status, failure_code)
        SELECT ${nextId}, source_video_id, payload, submission_digest, accepted_count, status, failure_code
        FROM recommendation_precomputed_source WHERE generation_id = ${generationId}`
      const sourceIds = [
        sourceVideoId,
        ...Array.from(
          { length: 1_030 },
          (_, index) => `storage-catalog-${index}-${suffix}`,
        ),
      ]
      for (let offset = 0; offset < sourceIds.length; offset += 200) {
        const page = sourceIds.slice(offset, offset + 200)
        await prisma.recommendationPrecomputedBuildSource.createMany({
          data: page.map((sourceId) => ({
            generationId: nextId,
            sourceVideoId: sourceId,
            state: "complete_edges",
            completedAt: new Date("2026-10-03T00:00:00.000Z"),
          })),
        })
        await prisma.recommendationPrecomputedModelCall.createMany({
          data: page.map((sourceId, index) => ({
            generationId: nextId,
            callId: `receipt-${offset + index}-${suffix}`,
            sourceVideoId: sourceId,
            stage: "candidate_judgment",
            status: "succeeded",
            modelId: "gpt-6-astra",
            inputDigest: "e".repeat(64),
            outputDigest: "f".repeat(64),
            inputTokens: 1_000,
            outputTokens: 300,
            costUsd: 0.001,
            startedAt: new Date("2026-10-02T00:00:00.000Z"),
            finishedAt: new Date("2026-10-02T00:00:01.000Z"),
          })),
        })
      }
      await prisma.recommendationPrecomputedBuildBudget.create({
        data: { generationId: nextId, consumedBytes: 0n },
      })
      const [{ bytes: walDelta }] = await prisma.$queryRaw<
        Array<{ bytes: bigint }>
      >`
        SELECT pg_wal_lsn_diff(pg_current_wal_insert_lsn(), ${lsn}::pg_lsn)::bigint AS bytes`
      const after = await loadPrecomputedStorageCapacityReport(prisma, {
        generationId: nextId,
      })
      const beforeBytes = new Map(
        before.relations.map((row) => [row.table, row.totalBytes]),
      )
      const physicalDelta = after.relations.reduce(
        (sum, row) => sum + row.totalBytes - (beforeBytes.get(row.table) ?? 0),
        0,
      )
      expect(after.selectedGeneration).toMatchObject({
        generationId: nextId,
        sourceCount: 1_031,
        acceptedConnections: 8_248,
      })
      expect(after.buildRollbackOverlap).toMatchObject({
        completeGenerations: 2,
        newestTwoCompleteProtected: 2,
      })
      expect(physicalDelta).toBeGreaterThan(0)
      console.info(
        "precomputed_generation_storage_fixture",
        JSON.stringify({
          sources: 1_031,
          acceptedConnections: 8_248,
          modelCallReceipts: 1_031,
          buildSourceRows: 1_031,
          syntheticGenerationPhysicalRelationDeltaBytes: physicalDelta,
          syntheticGenerationAllocatedBytesPerConnection: physicalDelta / 8_248,
          instanceWalInsertDeltaBytes: Number(walDelta),
          selectedGenerationRowValueBytes:
            after.selectedGeneration?.inlineTupleBytes,
        }),
      )
    }, 120_000)
  },
)
