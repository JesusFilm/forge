import { createHash, randomUUID } from "node:crypto"
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import { PrismaClient, type Prisma } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { currentAdminMigrationSql } from "../current-schema.test-fixture"
import {
  loadDurablePrecomputedBuildReport,
  submitDurablePrecomputedRecommendation,
} from "./durable-build"
import { validArtifact, sha } from "./ga-capture-artifact.test-fixture"
import { gaCaptureSnapshotRefSchema } from "./ga-capture-artifact"
import {
  handleGaCaptureGet,
  handleGaCapturePost,
  verifyBoundGaCapture,
} from "./ga-capture-transport"
import {
  createProtectedLocalGaCaptureStore,
  gaCaptureStorageKey,
} from "./ga-capture-store"
import {
  purgeExpiredPrecomputedGenerations,
  purgeRetiredGaCaptureArtifacts,
} from "./generation-retention"

const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex")

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "sealed GA capture on PostgreSQL",
  () => {
    let prisma: PrismaClient
    let admin: Client
    let artifactRoot: string
    const schema = `ga_capture_${Date.now()}_${randomUUID().replaceAll("-", "")}`
    const generationId = `ga-capture-${randomUUID()}`
    const sourceVideoId = `source-${randomUUID()}`
    const generationInputDigest = "a".repeat(64)
    const sourceSetDigest = digest([sourceVideoId])
    const inputCutoff = "2026-10-06T00:00:00.000Z"
    const bearer = "Bearer preview-test-key"
    const base = { generationId, generationInputDigest }

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
      artifactRoot = await mkdtemp(join(tmpdir(), "forge-ga-capture-store-"))
      await prisma.video.create({
        data: { id: sourceVideoId, coreId: sourceVideoId, slug: sourceVideoId },
      })
    }, 120_000)

    afterAll(async () => {
      await prisma?.$disconnect()
      if (admin) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await admin.end()
      }
      if (artifactRoot) await rm(artifactRoot, { recursive: true })
    })

    it("uploads once and binds a qualified immutable capture before source work", async () => {
      const store = createProtectedLocalGaCaptureStore(artifactRoot)
      const submit = (payload: unknown) =>
        submitDurablePrecomputedRecommendation(prisma, payload, bearer, {
          gaCaptureStore: store,
        })
      await submit({
        action: "start",
        protocolVersion: 3,
        generationId,
        modelId: "gpt-6-astra",
        promptVersion: "ga-capture-v1",
        inputDigest: generationInputDigest,
        sourceSetDigest,
        inputCutoff,
        expectedSourceCount: 1,
        inputMode: "historical_analytics",
        inputSnapshotMode: "ga_aggregate_capture_v1",
      })
      await submit({
        action: "manifest",
        ...base,
        sourceVideoIds: [sourceVideoId],
      })
      const probe = await submit({ action: "capacity_probe", ...base })
      await submit({
        action: "capacity",
        ...base,
        measurement: {
          measuredAt: new Date().toISOString(),
          clusterSystemId: probe.clusterSystemId,
          observedDbBytes: probe.observedDbBytes,
          availableBytes: 20_000_000_000,
          reserveBytes: 5_000_000_000,
          projectedBytes: 1_000_000,
          sampleSourceCount: 1,
          sampleBytes: 100_000,
          source: "operator_verified_pgdata_df",
        },
      })
      for (let i = 0; i < 7; i += 1) {
        const callId = `capture-${i}-${generationId}`
        await submit({
          action: "history_call_start",
          ...base,
          callId,
          stage: i === 0 ? "qualification" : "snapshot_page",
          requestDigest: String(i + 1).repeat(64),
          startedAt: new Date(Date.now() - 2_000).toISOString(),
        })
        await submit({
          action: "history_call",
          ...base,
          callId,
          status: i === 6 ? "failed" : "succeeded",
          ...(i === 6 ? { errorCode: "ga_transport_error" } : {}),
          finishedAt: new Date().toISOString(),
        })
      }
      const orphanCallId = `orphan-${generationId}`
      await submit({
        action: "history_call_start",
        ...base,
        callId: orphanCallId,
        stage: "retry",
        requestDigest: "9".repeat(64),
        startedAt: new Date(Date.now() - 2_000).toISOString(),
      })
      expect(await submit({ action: "status", ...base })).toMatchObject({
        historyCallCounts: { pending: 1, succeeded: 6, failed: 1 },
        pendingHistoryCalls: [{ callId: orphanCallId }],
      })
      await expect(
        submit({
          action: "history_call_reconcile",
          ...base,
          callId: orphanCallId,
        }),
      ).rejects.toMatchObject({ code: "conflict" })
      await prisma.recommendationPrecomputedHistoryCall.update({
        where: {
          generationId_callId: { generationId, callId: orphanCallId },
        },
        data: { reservedAt: new Date(Date.now() - 31 * 60_000) },
      })
      expect(
        await submit({
          action: "history_call_reconcile",
          ...base,
          callId: orphanCallId,
        }),
      ).toMatchObject({ state: "failed", outcomeUnknown: true, replay: false })
      expect(
        await submit({
          action: "history_call_reconcile",
          ...base,
          callId: orphanCallId,
        }),
      ).toMatchObject({ state: "failed", replay: true })
      expect(await submit({ action: "status", ...base })).toMatchObject({
        historyCallCounts: { pending: 0, succeeded: 6, failed: 2 },
      })
      const body = validArtifact({
        generationId,
        generationInputDigest,
        sourceSetDigest,
        inputCutoff,
        physicalHttpAttempts: 8,
      })
      const request = () =>
        new Request("http://localhost/internal/ga-capture", {
          method: "POST",
          headers: {
            authorization: bearer,
            "content-type": "application/vnd.forge.ga-capture-v1",
            "x-forge-generation-id": generationId,
            "x-forge-input-digest": generationInputDigest,
            "x-forge-artifact-sha256": sha(body),
            "content-length": String(body.length),
          },
          body,
        })
      const uploads = await Promise.all([
        handleGaCapturePost(prisma, request(), store),
        handleGaCapturePost(prisma, request(), store),
      ])
      expect(uploads.map((response) => response.status).sort()).toEqual([
        200, 201,
      ])
      const uploaded = uploads.find((response) => response.status === 201)!
      const { snapshotRef } = (await uploaded.json()) as {
        snapshotRef: Record<string, unknown>
      }
      expect(snapshotRef).toMatchObject({
        generationId,
        artifactSha256: sha(body),
        physicalHttpAttempts: 8,
        physicalSucceededCalls: 6,
      })
      expect(
        await uploads.find((response) => response.status === 200)!.json(),
      ).toMatchObject({
        snapshotRef,
      })
      const headerLength = body.readUInt32BE(8)
      const header = JSON.parse(body.subarray(12, 12 + headerLength).toString())
      const qualification = { ...header.baseQualification, snapshotRef }
      const sealed = await submit({
        action: "history_qualification",
        ...base,
        qualification,
      })
      expect(sealed).toMatchObject({ replay: false })
      expect(await submit({ action: "status", ...base })).toMatchObject({
        historicalQualification: { snapshotRef },
        historicalQualificationDigest: sealed.qualificationDigest,
      })
      expect(
        await loadDurablePrecomputedBuildReport(prisma, {
          generationId,
          reviewer: { id: "capture-reviewer", role: "ADMIN" },
        }),
      ).toMatchObject({
        historicalQualification: { snapshotRef },
      })
      const downloaded = await handleGaCaptureGet(
        prisma,
        new Request("http://localhost/internal/ga-capture", {
          headers: {
            authorization: bearer,
            "x-forge-generation-id": generationId,
            "x-forge-input-digest": generationInputDigest,
          },
        }),
        store,
      )
      expect(downloaded.status).toBe(200)
      expect(downloaded.headers.get("content-type")).toBe(
        "application/vnd.forge.ga-capture-v1",
      )
      expect(downloaded.headers.get("content-length")).toBe(String(body.length))
      expect(downloaded.headers.get("x-forge-artifact-sha256")).toBe(sha(body))
      expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(body)
      const downloadRequest = () =>
        new Request("http://localhost/internal/ga-capture", {
          headers: {
            authorization: bearer,
            "x-forge-generation-id": generationId,
            "x-forge-input-digest": generationInputDigest,
          },
        })
      const oversizedStream = Readable.from([body, Buffer.from("extra")])
      const oversized = await handleGaCaptureGet(prisma, downloadRequest(), {
        ...store,
        open: async () => oversizedStream,
      })
      await expect(oversized.arrayBuffer()).rejects.toThrow()
      expect(oversizedStream.destroyed).toBe(true)
      const shortStream = Readable.from([body.subarray(0, body.length - 1)])
      const shortened = await handleGaCaptureGet(prisma, downloadRequest(), {
        ...store,
        open: async () => shortStream,
      })
      await expect(shortened.arrayBuffer()).rejects.toThrow()
      expect(shortStream.destroyed).toBe(true)
      const cancelledStream = Readable.from([body])
      const cancelled = await handleGaCaptureGet(prisma, downloadRequest(), {
        ...store,
        open: async () => cancelledStream,
      })
      await cancelled.body?.cancel()
      expect(cancelledStream.destroyed).toBe(true)
      const tempBefore = new Set(
        (await readdir(tmpdir())).filter((name) =>
          name.startsWith("forge-ga-capture-verify-"),
        ),
      )
      await expect(
        verifyBoundGaCapture(gaCaptureSnapshotRefSchema.parse(snapshotRef), {
          ...store,
          open: async () => {
            throw new Error("injected missing object")
          },
        }),
      ).rejects.toThrow("injected missing object")
      const tempAfter = (await readdir(tmpdir())).filter((name) =>
        name.startsWith("forge-ga-capture-verify-"),
      )
      expect(tempAfter.filter((name) => !tempBefore.has(name))).toEqual([])
      const claim = await submit({
        action: "claim",
        ...base,
        sourceVideoId,
        claimId: "after-seal",
      })
      expect(claim).toMatchObject({ sourceState: "claimed" })
      await expect(
        submit({
          action: "history_call_start",
          ...base,
          callId: `late-${generationId}`,
          stage: "snapshot_page",
          requestDigest: "f".repeat(64),
          startedAt: new Date().toISOString(),
        }),
      ).rejects.toMatchObject({ code: "conflict" })
      const historySummary = {
        resultDigest: "e".repeat(64),
        rowCount: 0,
        mappedRows: 0,
        unmappedRows: 0,
        pageCount: 2,
        queryExecutionCount: 0,
        navigationCoverage: {
          candidateEvents: 0,
          qualifiedEvents: 0,
          homeEvents: 0,
          selfEvents: 0,
          crossHostEvents: 0,
          malformedEvents: 0,
          unmappedEvents: 0,
          ambiguousEvents: 0,
        },
        captureBasis: "capture_derived_v1",
        artifactSha256: sha(body),
        derivedSubsetDigest: "d".repeat(64),
        pageCountKind: "virtual_validation",
      }
      await submit({
        action: "checkpoint",
        ...base,
        sourceVideoId,
        leaseToken: claim.leaseToken,
        expectedRevision: 0,
        checkpointId: `derived-${generationId}`,
        checkpoint: {
          stage: "plan",
          cursor: {},
          historySummary,
        },
      })
      await submit({
        action: "source_history",
        ...base,
        sourceVideoId,
        leaseToken: claim.leaseToken,
        history: {
          ...historySummary,
          evidenceKind: "referrer_navigation_v1",
          sourceResource: "properties/320198532",
          queryId: "watch-referrer-navigation-v1",
          rangeStart: "2022-08-08",
          rangeEnd: "2026-10-05",
          qualificationDigest: sealed.qualificationDigest,
          status: "complete",
        },
      })
      const sourceReport = await loadDurablePrecomputedBuildReport(prisma, {
        generationId,
        sourceVideoId,
        reviewer: { id: "capture-reviewer", role: "ADMIN" },
      })
      expect(sourceReport?.source?.historicalProvenance).toMatchObject({
        captureBasis: "capture_derived_v1",
        artifactSha256: sha(body),
        derivedSubsetDigest: "d".repeat(64),
        pageCountKind: "virtual_validation",
        queryExecutionCount: 0,
      })
      expect(
        await submit({ action: "status", ...base, sourceVideoId }),
      ).toMatchObject({
        source: {
          historicalProvenance: sourceReport?.source?.historicalProvenance,
        },
      })
      await submit({
        action: "source",
        ...base,
        sourceVideoId,
        leaseToken: claim.leaseToken,
      })
      expect(await submit({ action: "complete", ...base })).toMatchObject({
        state: "complete",
      })
    })

    it("deletes bound and unbound private objects only after retirement", async () => {
      const retiredId = `retired-capture-${randomUUID()}`
      const store = createProtectedLocalGaCaptureStore(artifactRoot)
      const artifacts = [
        validArtifact({ generationId: retiredId, physicalHttpAttempts: 7 }),
        validArtifact({ generationId: retiredId, physicalHttpAttempts: 8 }),
      ]
      for (const [index, body] of artifacts.entries()) {
        const artifactSha256 = sha(body)
        const storageKey = gaCaptureStorageKey(retiredId, artifactSha256)
        const temp = join(artifactRoot, `retired-upload-${index}.bin`)
        await writeFile(temp, body)
        expect(await store.putIfAbsent(storageKey, temp, body.length)).toBe(
          "created",
        )
        await prisma.recommendationPrecomputedGaCaptureArtifact.create({
          data: {
            generationId: retiredId,
            artifactSha256,
            storageKey,
            artifactBytes: BigInt(body.length),
            createdAt: new Date(Date.now() - 60 * 60_000),
            boundAt: index === 0 ? new Date() : null,
          },
        })
      }
      const boundBytes = artifacts[0]!
      const headerLength = boundBytes.readUInt32BE(8)
      const header = JSON.parse(
        boundBytes.subarray(12, 12 + headerLength).toString("utf8"),
      ) as Record<string, unknown>
      const scalars = { ...header }
      const baseQualification = scalars.baseQualification
      delete scalars.blocks
      delete scalars.baseQualification
      const snapshotRef = gaCaptureSnapshotRefSchema.parse({
        ...scalars,
        storageKey: gaCaptureStorageKey(retiredId, sha(boundBytes)),
        artifactSha256: sha(boundBytes),
        artifactBytes: boundBytes.length,
        headerSha256: sha(boundBytes.subarray(12, 12 + headerLength)),
      })
      await prisma.recommendationPrecomputedGeneration.create({
        data: {
          id: retiredId,
          modelId: "gpt-6-astra",
          promptVersion: "ga-capture-v1",
          inputDigest: generationInputDigest,
          sourceSetDigest: "b".repeat(64),
          inputCutoff: new Date(inputCutoff),
          expectedSourceCount: 1,
          protocolVersion: 3,
          inputMode: "historical_analytics",
          inputSnapshotMode: "ga_aggregate_capture_v1",
          historicalQualification: {
            ...(baseQualification as Record<string, unknown>),
            snapshotRef,
          },
          historicalQualificationDigest: "f".repeat(64),
          status: "failed",
          failedAt: new Date(Date.now() - 86_400_000),
          failureCode: "fixture_failed",
        },
      })
      const retentionNow = new Date(Date.now() + 100 * 86_400_000)
      expect(
        await purgeRetiredGaCaptureArtifacts(prisma, retentionNow, 10, store),
      ).toMatchObject({ deleted: 0 })
      expect(
        await prisma.$transaction((tx) =>
          purgeExpiredPrecomputedGenerations(tx, retentionNow, 1),
        ),
      ).toMatchObject({ generationsDeleted: 1 })
      expect(
        await prisma.recommendationPrecomputedGenerationRetentionProof.findUniqueOrThrow(
          {
            where: { generationId: retiredId },
          },
        ),
      ).toMatchObject({ snapshotSha256: sha(boundBytes) })
      expect(
        await purgeRetiredGaCaptureArtifacts(prisma, retentionNow, 1, store),
      ).toMatchObject({ deleted: 1 })
      expect(
        await prisma.recommendationPrecomputedGenerationRetentionProof.findUniqueOrThrow(
          {
            where: { generationId: retiredId },
          },
        ),
      ).toMatchObject({ artifactDeletedAt: null })
      await expect(
        purgeRetiredGaCaptureArtifacts(prisma, retentionNow, 10, {
          ...store,
          delete: async () => {
            throw new Error("injected object-store outage")
          },
        }),
      ).rejects.toThrow("injected object-store outage")
      expect(
        await prisma.recommendationPrecomputedGaCaptureArtifact.count({
          where: { generationId: retiredId },
        }),
      ).toBe(1)
      expect(
        await purgeRetiredGaCaptureArtifacts(prisma, retentionNow, 10, store),
      ).toMatchObject({ deleted: 1 })
      const proof =
        await prisma.recommendationPrecomputedGenerationRetentionProof.findUniqueOrThrow(
          {
            where: { generationId: retiredId },
          },
        )
      expect(proof.artifactDeletedAt).toBeInstanceOf(Date)
      expect(
        await prisma.recommendationPrecomputedGaCaptureArtifact.count({
          where: { generationId: retiredId },
        }),
      ).toBe(0)
      for (const body of artifacts)
        await expect(
          stat(join(artifactRoot, gaCaptureStorageKey(retiredId, sha(body)))),
        ).rejects.toThrow()
    })
  },
)
