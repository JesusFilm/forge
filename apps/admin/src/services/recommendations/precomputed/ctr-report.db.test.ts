import { createHash, randomUUID } from "node:crypto"
import {
  Prisma,
  PrismaClient,
  RecommendationDeliveryResult,
  RecommendationExperimentArm,
  RecommendationRequestState,
} from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { env } from "@/config/env"
import { currentAdminMigrationSql } from "../current-schema.test-fixture"
import {
  capturePrecomputedCtrMeasurement,
  readCompactCtrVisitAt,
  readCompactCtrVisitsAt,
} from "./compact-accounting"
import { rawCtrVisitSql, type RawCtrVisit } from "./ctr-evidence"
import { purgeExpiredPrecomputedVisitRoots } from "./visit-retention"
import { PRECOMPUTED_PUBLIC_LIVE_ELIGIBILITY_POLICY } from "./public-control"
import { matchesPrivateVisitBrowser } from "./visit-selection"
import { precomputedBrowserUnitDigest } from "./visit-identity"
import {
  declareFixturePrecomputedCtrPolicy,
  evaluatePrivatePrecomputedCtr,
  evaluatePublicPrecomputedCtr,
  loadPrivatePrecomputedCtrIndex,
  loadPrivatePrecomputedCtrReport,
} from "./ctr-report"
import {
  loadWebExperimentMeasurement,
  loadWebWatchMeasurement,
  WEB_WATCH_COUNTERS,
  type WebWatchCounters,
} from "./web-measurement"

vi.mock("./web-measurement", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./web-measurement")>()),
  loadWebWatchMeasurement: vi.fn(),
  loadWebExperimentMeasurement: vi.fn(),
}))

const operator = { id: "ctr-fixture-operator", role: "ADMIN" as const }
const days = (n: number) => n * 86_400_000

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "durable precomputed CTR on PostgreSQL 18",
  () => {
    const schema = `precomputed_ctr_${Date.now()}_${Math.random().toString(36).slice(2)}`
    let admin: Client
    let prisma: PrismaClient
    let experimentId: string
    let now: Date
    let controlBrowser: string
    let oldVisitId: string
    let oldRequestId: string

    async function withCompactReader<T>(run: () => Promise<T>): Promise<T> {
      const key = "RECOMMENDATION_PRECOMPUTED_COMPACT_REPORT_READER_ENABLED"
      const prior = Object.getOwnPropertyDescriptor(env, key)
      Object.defineProperty(env, key, { configurable: true, value: "1" })
      try {
        return await run()
      } finally {
        if (prior) Object.defineProperty(env, key, prior)
        else Reflect.deleteProperty(env, key)
      }
    }

    beforeAll(async () => {
      admin = new Client({ connectionString: env.DATABASE_URL })
      await admin.connect()
      await admin.query(`CREATE SCHEMA "${schema}"`)
      await admin.query(`SET search_path TO "${schema}", public`)
      for (const sql of currentAdminMigrationSql) await admin.query(sql)
      const url = new URL(env.DATABASE_URL)
      url.searchParams.set("schema", schema)
      prisma = new PrismaClient<Prisma.PrismaClientOptions>({
        datasources: { db: { url: url.toString() } },
      })
      now = new Date()
      const generationId = `ctr-generation-${schema}`
      await prisma.recommendationPrecomputedGeneration.create({
        data: {
          id: generationId,
          modelId: "fixture-astra",
          promptVersion: "fixture-v1",
          inputDigest: "a".repeat(64),
          sourceSetDigest: "b".repeat(64),
          inputCutoff: now,
          expectedSourceCount: 0,
          status: "complete",
          completedAt: now,
        },
      })
      experimentId = `ctr-experiment-${schema}`
      await prisma.recommendationPrecomputedExperiment.create({
        data: {
          id: experimentId,
          generationId,
          controlManifestId: "semantic-transcript-pgvector-v1",
          challengerManifestId: "precomputed-watch-preview-v1",
          controlManifestDigest: "c".repeat(64),
          controlRoutingDigest: "d".repeat(64),
          sourceSetDigest: "b".repeat(64),
          assignmentPolicyVersion: "browser-sha256-50-v1",
          eligibilityPolicyVersion: "private-watch-visit-unverified-bot-v2",
          deliveryPolicyVersion: "saved-or-control-v1",
          configurationDigest: "e".repeat(64),
          state: "private_test",
          startsAt: new Date(now.getTime() - days(31)),
          endsAt: new Date(now.getTime() + days(2)),
          expiresAt: new Date(now.getTime() + days(367)),
        },
      })
      await declareFixturePrecomputedCtrPolicy(prisma, {
        experimentId,
        operator,
        settings: {
          baselineHumanVisitCtr: 0.2,
          minimumDetectableAbsoluteUplift: 0.05,
          minimumPracticalAbsoluteUplift: 0.05,
          plannedPower: 0.8,
          minimumEligibleVisitsPerArm: 1,
          minimumIndependentBrowsersPerArm: 3,
          minimumDurationHours: 24,
          lateEventCutoffHours: 24,
          maximumActualFallbackRate: 0.2,
          maximumUnlinkedDeliveryRate: 0,
        },
      })
      controlBrowser = "f".repeat(64)
    }, 180_000)

    afterAll(async () => {
      await prisma?.$disconnect()
      if (admin) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await admin.end()
      }
    })

    async function visit(input: {
      arm: RecommendationExperimentArm
      browser: string
      createdAt: Date
      expiresAt: Date
      eligibility?: "eligible" | "excluded"
    }) {
      const id = randomUUID()
      const eligible = input.eligibility !== "excluded"
      await prisma.recommendationPrecomputedVisit.create({
        data: {
          id,
          experimentId,
          browserUnitDigest: eligible ? input.browser : null,
          sourceVideoId: "source-video",
          locale: "en",
          audioLanguageSlug: "english",
          eligibility: eligible ? "eligible" : "excluded",
          qualification: eligible
            ? "unverified_browser"
            : "declared_automation",
          exclusionReason: eligible ? null : "automation_excluded",
          arm: eligible ? input.arm : null,
          createdAt: input.createdAt,
          expiresAt: input.expiresAt,
        },
      })
      return id
    }

    async function acceptSelection(
      tx: Prisma.TransactionClient,
      requestId: string,
      itemId: string,
      at: Date,
      expiry: Date,
    ) {
      await tx.recommendationSelection.create({
        data: {
          id: `ctr-selection-${randomUUID()}`,
          requestId,
          itemId,
          capabilityJti: `ctr-capability-${randomUUID()}`,
          eventId: `ctr-event-${randomUUID()}`,
          payloadDigest: "2".repeat(64),
          claimNonceDigest: randomUUID().replaceAll("-", "").padEnd(64, "0"),
          handoffExpiresAt: expiry,
          occurredAt: at,
          receivedAt: at,
          expiresAt: expiry,
        },
      })
    }

    async function selection(visitId: string, at: Date, record = true) {
      const requestId = `ctr-request-${randomUUID()}`
      const itemId = `ctr-item-${randomUUID()}`
      const expiry = new Date(now.getTime() + days(1))
      const visitExpiry = (
        await prisma.recommendationPrecomputedVisit.findUniqueOrThrow({
          where: { id: visitId },
          select: { expiresAt: true },
        })
      ).expiresAt
      await prisma.$transaction(async (tx) => {
        await tx.recommendationRequest.create({
          data: {
            id: requestId,
            contractVersion: "semantic-recommendation-v1",
            surfaceVersion: "watch-below-player-v1",
            manifestId: "semantic-transcript-pgvector-v1",
            strategyVersion: "semantic-transcript-pgvector-v1",
            classifierVersion: "legacy-position-v0",
            sessionDigest: "1".repeat(64),
            seedMediaId: "source-video",
            locale: "en",
            expectedItemCount: 1,
            state: RecommendationRequestState.ISSUED,
            result: RecommendationDeliveryResult.SERVED,
            deliveryJti: `ctr-delivery-${randomUUID()}`,
            signingKid: "ctr-test",
            createdAt: at,
            issuedAt: at,
            expiresAt: expiry,
          },
        })
        await tx.recommendationServedItem.create({
          data: {
            id: itemId,
            requestId,
            position: 0,
            targetMediaId: "target-video",
            canonicalHref: "/watch/target-video.html",
            candidateGenerator: "semantic",
            candidateProvenance: {},
            expiresAt: expiry,
          },
        })
        await tx.recommendationPrecomputedVisitRequest.create({
          data: {
            requestId,
            visitId,
            createdAt: at,
            expiresAt: new Date(
              Math.min(expiry.getTime(), visitExpiry.getTime()),
            ),
          },
        })
        if (record) await acceptSelection(tx, requestId, itemId, at, expiry)
      })
      return { requestId, itemId, expiry }
    }

    it("reconciles raw and archived counts, preserves a reviewed revision, and blocks an old UUID", async () => {
      const oldCreated = new Date(now.getTime() - days(30))
      const oldExpiry = new Date(now.getTime() - days(1))
      oldVisitId = await visit({
        arm: RecommendationExperimentArm.CONTROL,
        browser: controlBrowser,
        createdAt: oldCreated,
        expiresAt: oldExpiry,
      })
      await visit({
        arm: RecommendationExperimentArm.CONTROL,
        browser: controlBrowser,
        createdAt: oldCreated,
        expiresAt: oldExpiry,
      })
      oldRequestId = (
        await selection(oldVisitId, new Date(now.getTime() - days(28)))
      ).requestId
      await visit({
        arm: RecommendationExperimentArm.CHALLENGER,
        browser: "a".repeat(64),
        createdAt: new Date(now.getTime() - days(1)),
        expiresAt: new Date(now.getTime() + days(28)),
      })
      await visit({
        arm: RecommendationExperimentArm.CONTROL,
        browser: "b".repeat(64),
        createdAt: new Date(now.getTime() - days(1)),
        expiresAt: new Date(now.getTime() + days(28)),
      })
      await visit({
        arm: RecommendationExperimentArm.CONTROL,
        browser: "a".repeat(64),
        createdAt: new Date(now.getTime() - days(1)),
        expiresAt: new Date(now.getTime() + days(28)),
        eligibility: "excluded",
      })
      if (env.RECOMMENDATION_PRECOMPUTED_COMPACT_MEASUREMENT_ENABLED === "1") {
        expect(
          await prisma.$transaction((tx) =>
            readCompactCtrVisitsAt(tx, experimentId, now),
          ),
        ).toMatchObject({
          status: "unavailable",
          reason: "missing_live_snapshot",
        })
        expect(
          await withCompactReader(() =>
            evaluatePrivatePrecomputedCtr(prisma, {
              experimentId,
              operator,
              now,
            }),
          ),
        ).toEqual({ status: "unavailable", reason: "missing_live_snapshot" })
        expect(
          await prisma.recommendationPrecomputedCtrReport.count({
            where: { experimentId },
          }),
        ).toBe(0)
        const compactClusters = new Map<
          string,
          { visits: number; clicks: number }
        >()
        const activeVisits =
          await prisma.recommendationPrecomputedVisit.findMany({
            where: { experimentId },
            select: { id: true },
          })
        for (const { id } of activeVisits) {
          await prisma.$transaction((tx) =>
            capturePrecomputedCtrMeasurement(tx, id, now),
          )
          const [native] = await prisma.$queryRaw<RawCtrVisit[]>(
            rawCtrVisitSql(Prisma.sql`v.id = ${id}::uuid`, now),
          )
          const compact = await readCompactCtrVisitAt(prisma, id, now)
          expect(compact).toEqual(native)
          if (compact?.eligibility === "eligible") {
            const key = `${compact.arm}:${compact.browser_unit_digest}`
            const cluster = compactClusters.get(key) ?? { visits: 0, clicks: 0 }
            cluster.visits += 1
            cluster.clicks += Number(compact.accepted_selections > 0n)
            compactClusters.set(key, cluster)
          }
        }
        expect(
          [...compactClusters.values()].sort((a, b) => b.visits - a.visits),
        ).toEqual([
          { visits: 2, clicks: 1 },
          { visits: 1, clicks: 0 },
          { visits: 1, clicks: 0 },
        ])
        const bulk = await prisma.$transaction((tx) =>
          readCompactCtrVisitsAt(tx, experimentId, now),
        )
        expect(bulk).toMatchObject({ status: "available" })
        if (bulk.status !== "available") throw new Error("Missing bulk state")
        const native = await prisma.$queryRaw<RawCtrVisit[]>(
          rawCtrVisitSql(
            Prisma.sql`v.experiment_id = ${experimentId} AND v.created_at <= ${now}`,
            now,
          ),
        )
        expect(
          bulk.visits.sort((a, b) => a.visit_id.localeCompare(b.visit_id)),
        ).toEqual(native.sort((a, b) => a.visit_id.localeCompare(b.visit_id)))
      }
      const first = await evaluatePrivatePrecomputedCtr(prisma, {
        experimentId,
        operator,
        now,
      })
      expect(first).toMatchObject({
        status: "available",
        report: {
          revision: 1,
          isFinal: false,
          outcome: "inconclusive",
          byArm: {
            control: {
              eligibleVisits: 3,
              clickedVisits: 1,
              visitCtr: 1 / 3,
              independentBrowsers: 2,
              effectiveBrowsers: 1.8,
            },
            challenger: {
              eligibleVisits: 1,
              clickedVisits: 0,
              independentBrowsers: 1,
              effectiveBrowsers: null,
            },
          },
          exclusions: { automation: 1 },
        },
      })
      const purge = await prisma.$transaction((tx) =>
        purgeExpiredPrecomputedVisitRoots(
          tx,
          new Date(now.getTime() + 60_000),
          100,
          [],
          false,
          { archiveReader: "compact" },
        ),
      )
      expect(purge.visitsDeleted).toBe(2)
      expect(purge.archiveSource).toBe(
        env.RECOMMENDATION_PRECOMPUTED_COMPACT_MEASUREMENT_ENABLED === "1"
          ? "compact"
          : "native_capture_off",
      )
      expect(
        await prisma.recommendationPrecomputedCtrArchivedVisit.count({
          where: { experimentId },
        }),
      ).toBe(2)
      expect(
        await prisma.recommendationPrecomputedCtrCluster.findUnique({
          where: {
            experimentId_browserUnitDigest: {
              experimentId,
              browserUnitDigest: controlBrowser,
            },
          },
        }),
      ).toMatchObject({ eligibleVisits: 2n, clickedVisits: 1n })
      expect(
        (
          await prisma.recommendationRequest.findUniqueOrThrow({
            where: { id: oldRequestId },
          })
        ).privatePrecomputedVisitId,
      ).toBe(oldVisitId)
      const after = await evaluatePrivatePrecomputedCtr(prisma, {
        experimentId,
        operator,
        now,
      })
      expect(after).toEqual(first)
      if (env.RECOMMENDATION_PRECOMPUTED_COMPACT_MEASUREMENT_ENABLED === "1") {
        const revisionCount =
          await prisma.recommendationPrecomputedCtrReport.count({
            where: { experimentId },
          })
        expect(
          await withCompactReader(() =>
            evaluatePrivatePrecomputedCtr(prisma, {
              experimentId,
              operator,
              now,
            }),
          ),
        ).toEqual({
          status: "unavailable",
          reason: "archive_cutoff_unverifiable",
        })
        expect(
          await prisma.recommendationPrecomputedCtrReport.count({
            where: { experimentId },
          }),
        ).toBe(revisionCount)
      }
      await expect(
        prisma.recommendationPrecomputedVisit.create({
          data: {
            id: oldVisitId,
            experimentId,
            browserUnitDigest: controlBrowser,
            sourceVideoId: "source-video",
            locale: "en",
            audioLanguageSlug: "english",
            eligibility: "eligible",
            qualification: "unverified_browser",
            arm: RecommendationExperimentArm.CONTROL,
            createdAt: now,
            expiresAt: new Date(now.getTime() + days(29)),
          },
        }),
      ).rejects.toThrow()
      expect(
        await loadPrivatePrecomputedCtrReport(prisma, {
          experimentId,
          revision: 1,
          reviewer: operator,
        }),
      ).toEqual(first)
      expect(
        await loadPrivatePrecomputedCtrIndex(prisma, {
          experimentId,
          reviewer: operator,
        }),
      ).toMatchObject({ policyDeclared: true, revisions: [{ revision: 1 }] })
      await expect(
        loadPrivatePrecomputedCtrIndex(prisma, {
          experimentId,
          reviewer: null,
        }),
      ).rejects.toThrow()
      if (env.RECOMMENDATION_PRECOMPUTED_COMPACT_MEASUREMENT_ENABLED === "1") {
        const compact = await withCompactReader(() =>
          evaluatePrivatePrecomputedCtr(prisma, {
            experimentId,
            operator,
          }),
        )
        expect(compact.status).toBe("available")
        if (compact.status !== "available" || first.status !== "available")
          throw new Error("Missing compact comparison")
        expect(compact.report.byArm).toEqual(first.report.byArm)
        expect(compact.report.engagement).toEqual(first.report.engagement)
        expect(compact.report.uncertainty).toEqual(first.report.uncertainty)
      }
    })

    it("archives an accepted selection that holds the evidence fence before purge", async () => {
      const browserDigest = "7".repeat(64)
      const id = await visit({
        arm: RecommendationExperimentArm.CHALLENGER,
        browser: precomputedBrowserUnitDigest(experimentId, browserDigest),
        createdAt: new Date(now.getTime() - days(28)),
        expiresAt: new Date(now.getTime() + 60_000),
      })
      const at = new Date(now.getTime() - 60_000)
      const issued = await selection(id, at, false)
      let release!: () => void
      let entered!: () => void
      const hold = new Promise<void>((resolve) => {
        release = resolve
      })
      const ready = new Promise<void>((resolve) => {
        entered = resolve
      })
      const selecting = prisma.$transaction(
        async (tx) => {
          const receipt = await matchesPrivateVisitBrowser(tx, {
            requestId: issued.requestId,
            expectedVisitId: id,
            browserDigest,
            clock: () => at,
          })
          expect(receipt).toEqual(at)
          entered()
          await hold
          await acceptSelection(
            tx,
            issued.requestId,
            issued.itemId,
            at,
            issued.expiry,
          )
        },
        { timeout: 20_000 },
      )
      await ready
      const [probe] = await prisma.$queryRaw<
        Array<{ acquired: boolean }>
      >(Prisma.sql`
        SELECT pg_try_advisory_xact_lock(5902573, hashtext(${experimentId})) AS acquired
      `)
      expect(probe?.acquired).toBe(false)
      const purging = prisma.$transaction(
        (tx) =>
          purgeExpiredPrecomputedVisitRoots(
            tx,
            new Date(now.getTime() + 120_000),
            100,
          ),
        { timeout: 20_000 },
      )
      release()
      await selecting
      expect((await purging).visitsDeleted).toBe(1)
      expect(
        await prisma.recommendationPrecomputedCtrCluster.findUnique({
          where: {
            experimentId_browserUnitDigest: {
              experimentId,
              browserUnitDigest: precomputedBrowserUnitDigest(
                experimentId,
                browserDigest,
              ),
            },
          },
        }),
      ).toMatchObject({ eligibleVisits: 1n, clickedVisits: 1n })
    })

    it.skipIf(
      env.RECOMMENDATION_PRECOMPUTED_COMPACT_MEASUREMENT_ENABLED !== "1",
    )(
      "finalizes a fully captured compact cohort once and reuses its immutable report",
      async () => {
        const frozen =
          await prisma.recommendationPrecomputedExperiment.findUniqueOrThrow({
            where: { id: experimentId },
            include: { ctrPolicy: true },
          })
        const finalExperimentId = `compact-final-${randomUUID()}`
        await prisma.recommendationPrecomputedExperiment.create({
          data: {
            id: finalExperimentId,
            generationId: frozen.generationId,
            controlManifestId: frozen.controlManifestId,
            challengerManifestId: frozen.challengerManifestId,
            controlManifestDigest: frozen.controlManifestDigest,
            controlRoutingDigest: frozen.controlRoutingDigest,
            sourceSetDigest: frozen.sourceSetDigest,
            assignmentPolicyVersion: frozen.assignmentPolicyVersion,
            eligibilityPolicyVersion: frozen.eligibilityPolicyVersion,
            deliveryPolicyVersion: frozen.deliveryPolicyVersion,
            configurationDigest: frozen.configurationDigest,
            state: "closed",
            startsAt: new Date(now.getTime() - days(4)),
            endsAt: new Date(now.getTime() - days(2)),
            expiresAt: new Date(now.getTime() + days(363)),
          },
        })
        await prisma.recommendationPrecomputedCtrPolicy.create({
          data: {
            experimentId: finalExperimentId,
            version: frozen.ctrPolicy!.version,
            method: frozen.ctrPolicy!.method,
            settings: frozen.ctrPolicy!.settings!,
            lateEventCutoffHours: frozen.ctrPolicy!.lateEventCutoffHours,
            settingsDigest: frozen.ctrPolicy!.settingsDigest,
            authority: "fixture_only",
          },
        })
        const id = randomUUID()
        await prisma.recommendationPrecomputedVisit.create({
          data: {
            id,
            experimentId: finalExperimentId,
            browserUnitDigest: "b".repeat(64),
            sourceVideoId: "source-video",
            locale: "en",
            audioLanguageSlug: "english",
            eligibility: "eligible",
            qualification: "unverified_browser",
            arm: RecommendationExperimentArm.CONTROL,
            createdAt: new Date(now.getTime() - days(3)),
            expiresAt: new Date(now.getTime() + 60_000),
          },
        })
        await prisma.$transaction((tx) =>
          capturePrecomputedCtrMeasurement(tx, id, now),
        )
        const final = await withCompactReader(() =>
          evaluatePrivatePrecomputedCtr(prisma, {
            experimentId: finalExperimentId,
            operator,
            now,
          }),
        )
        expect(final).toMatchObject({
          status: "available",
          report: {
            revision: 1,
            isFinal: true,
            byArm: {
              control: {
                eligibleVisits: 1,
                clickedVisits: 0,
                independentBrowsers: 1,
              },
            },
            engagement: {
              byArm: { control: { measuredVisits: 1, engagedVisits: 0 } },
            },
          },
        })
        const archived = await prisma.$transaction((tx) =>
          purgeExpiredPrecomputedVisitRoots(
            tx,
            new Date(now.getTime() + 120_000),
            100,
            [],
            false,
            { archiveReader: "compact" },
          ),
        )
        expect(archived.archiveSource).toBe(
          env.RECOMMENDATION_PRECOMPUTED_COMPACT_MEASUREMENT_ENABLED === "1"
            ? "compact"
            : "native_capture_off",
        )
        expect(
          await prisma.recommendationPrecomputedCtrArchivedVisit.count({
            where: { experimentId: finalExperimentId },
          }),
        ).toBe(1)
        expect(
          await withCompactReader(() =>
            evaluatePrivatePrecomputedCtr(prisma, {
              experimentId: finalExperimentId,
              operator,
              now,
            }),
          ),
        ).toEqual(final)
        expect(
          await prisma.recommendationPrecomputedCtrReport.count({
            where: { experimentId: finalExperimentId },
          }),
        ).toBe(1)
      },
    )

    it.skipIf(
      env.RECOMMENDATION_PRECOMPUTED_COMPACT_MEASUREMENT_ENABLED !== "1",
    )(
      "bulk-loads a bounded 10,000-visit compact cohort without per-visit queries",
      async () => {
        const frozen =
          await prisma.recommendationPrecomputedExperiment.findUniqueOrThrow({
            where: { id: experimentId },
          })
        const bulkExperimentId = `compact-bulk-${randomUUID()}`
        await prisma.recommendationPrecomputedExperiment.create({
          data: {
            id: bulkExperimentId,
            generationId: frozen.generationId,
            controlManifestId: frozen.controlManifestId,
            challengerManifestId: frozen.challengerManifestId,
            controlManifestDigest: frozen.controlManifestDigest,
            controlRoutingDigest: frozen.controlRoutingDigest,
            sourceSetDigest: frozen.sourceSetDigest,
            assignmentPolicyVersion: frozen.assignmentPolicyVersion,
            eligibilityPolicyVersion: frozen.eligibilityPolicyVersion,
            deliveryPolicyVersion: frozen.deliveryPolicyVersion,
            configurationDigest: frozen.configurationDigest,
            state: "closed",
            startsAt: frozen.startsAt,
            endsAt: frozen.endsAt,
            expiresAt: frozen.expiresAt,
          },
        })
        const ids = Array.from({ length: 10_000 }, () => randomUUID())
        await prisma.recommendationPrecomputedVisit.createMany({
          data: ids.map((id) => ({
            id,
            experimentId: bulkExperimentId,
            browserUnitDigest: "c".repeat(64),
            sourceVideoId: "source-video",
            locale: "en",
            audioLanguageSlug: "english",
            eligibility: "eligible" as const,
            qualification: "unverified_browser",
            arm: RecommendationExperimentArm.CONTROL,
            createdAt: new Date(now.getTime() - days(1)),
            expiresAt: new Date(now.getTime() + days(28)),
          })),
        })
        await prisma.$transaction((tx) =>
          capturePrecomputedCtrMeasurement(tx, ids[0], now),
        )
        await prisma.$executeRaw(Prisma.sql`
        INSERT INTO recommendation_precomputed_ctr_measurement
          (visit_id, revision, accepted_at, summary)
        SELECT v.id, 1, ${now}, seed.summary
        FROM recommendation_precomputed_visit v
        CROSS JOIN (
          SELECT summary FROM recommendation_precomputed_ctr_measurement
          WHERE visit_id = ${ids[0]}::uuid
        ) seed
        WHERE v.experiment_id = ${bulkExperimentId} AND v.id <> ${ids[0]}::uuid
      `)
        const started = performance.now()
        const bulk = await prisma.$transaction((tx) =>
          readCompactCtrVisitsAt(tx, bulkExperimentId, now),
        )
        const elapsedMs = Math.round(performance.now() - started)
        expect(bulk).toMatchObject({ status: "available" })
        if (bulk.status !== "available") throw new Error("Missing bulk state")
        expect(bulk.visits).toHaveLength(10_000)
        console.info(`compact bulk reader: 10,000 visits in ${elapsedMs} ms`)
      },
    )

    it("keeps a private request private when purge removes its link after an initial read", async () => {
      const browserDigest = "8".repeat(64)
      const id = await visit({
        arm: RecommendationExperimentArm.CONTROL,
        browser: precomputedBrowserUnitDigest(experimentId, browserDigest),
        createdAt: new Date(now.getTime() - days(28)),
        expiresAt: new Date(now.getTime() + 60_000),
      })
      const issued = await selection(id, now, false)
      const initially = await prisma.recommendationRequest.findUniqueOrThrow({
        where: { id: issued.requestId },
        include: { precomputedVisitLink: true },
      })
      expect(initially).toMatchObject({
        privatePrecomputedVisitId: id,
        precomputedVisitLink: { visitId: id },
      })
      const archived = await prisma.$transaction((tx) =>
        purgeExpiredPrecomputedVisitRoots(
          tx,
          new Date(now.getTime() + 120_000),
          100,
          [],
          false,
          { archiveReader: "compact" },
        ),
      )
      expect(archived.archiveSource).toBe(
        env.RECOMMENDATION_PRECOMPUTED_COMPACT_MEASUREMENT_ENABLED === "1"
          ? "native_missing_snapshot"
          : "native_capture_off",
      )
      const after = await prisma.recommendationRequest.findUniqueOrThrow({
        where: { id: issued.requestId },
        include: { precomputedVisitLink: true },
      })
      expect(after.privatePrecomputedVisitId).toBe(id)
      expect(after.precomputedVisitLink).toBeNull()
      expect(
        await prisma.$transaction((tx) =>
          matchesPrivateVisitBrowser(tx, {
            requestId: issued.requestId,
            expectedVisitId: after.privatePrecomputedVisitId,
            browserDigest,
            clock: () => now,
          }),
        ),
      ).toBeNull()
    })

    it("saves a distinct immutable revision when a late accepted click reaches the fixed cohort", async () => {
      const id = await visit({
        arm: RecommendationExperimentArm.CHALLENGER,
        browser: "9".repeat(64),
        createdAt: now,
        expiresAt: new Date(now.getTime() + 30 * 60_000),
      })
      await selection(id, new Date(now.getTime() + 10 * 60_000))
      const before = await evaluatePrivatePrecomputedCtr(prisma, {
        experimentId,
        operator,
        now,
      })
      expect(before.status).toBe("available")
      if (before.status !== "available")
        throw new Error("Missing before revision")
      expect(before.report.byArm.challenger.clickedVisits).toBe(1) // earlier archived selection
      const after = await evaluatePrivatePrecomputedCtr(prisma, {
        experimentId,
        operator,
        now: new Date(now.getTime() + 3_600_000),
      })
      if (env.RECOMMENDATION_PRECOMPUTED_COMPACT_MEASUREMENT_ENABLED === "1") {
        const checkpointAt = new Date(now.getTime() + 3_600_000)
        expect(await readCompactCtrVisitAt(prisma, id, now)).toBeNull()
        await prisma.$transaction((tx) =>
          capturePrecomputedCtrMeasurement(tx, id, checkpointAt),
        )
        const [native] = await prisma.$queryRaw<RawCtrVisit[]>(
          rawCtrVisitSql(Prisma.sql`v.id = ${id}::uuid`, checkpointAt),
        )
        expect(await readCompactCtrVisitAt(prisma, id, checkpointAt)).toEqual(
          native,
        )
        expect(await readCompactCtrVisitAt(prisma, id, now)).toBeNull()
      }
      expect(after).toMatchObject({
        status: "available",
        report: {
          revision: before.report.revision + 1,
          byArm: {
            challenger: {
              clickedVisits: before.report.byArm.challenger.clickedVisits + 1,
            },
          },
        },
      })
      expect(
        await loadPrivatePrecomputedCtrReport(prisma, {
          experimentId,
          revision: before.report.revision,
          reviewer: operator,
        }),
      ).toEqual(before)
    })

    it("bounds provisional revisions while reserving one immutable final look", async () => {
      const first = await loadPrivatePrecomputedCtrReport(prisma, {
        experimentId,
        reviewer: operator,
      })
      if (first.status !== "available") throw new Error("Missing latest report")
      const policy =
        await prisma.recommendationPrecomputedCtrPolicy.findUniqueOrThrow({
          where: { experimentId },
        })
      for (
        let revision = first.report.revision + 1;
        revision <= 32;
        revision++
      ) {
        await prisma.recommendationPrecomputedCtrReport.create({
          data: {
            experimentId,
            revision,
            policyDigest: policy.settingsDigest,
            evidenceDigest: String(revision).padStart(64, "0"),
            asOf: now,
            isFinal: false,
            result: { ...first.report, revision },
          },
        })
      }
      await expect(
        prisma.recommendationPrecomputedCtrReport.create({
          data: {
            experimentId,
            revision: 33,
            policyDigest: policy.settingsDigest,
            evidenceDigest: "f".repeat(64),
            asOf: now,
            isFinal: false,
            result: { ...first.report, revision: 33 },
          },
        }),
      ).rejects.toThrow()
      expect(
        await evaluatePrivatePrecomputedCtr(prisma, {
          experimentId,
          operator,
          now: new Date(now.getTime() + 3_600_000),
        }),
      ).toEqual({
        status: "unavailable",
        reason: "provisional_revision_capacity_exhausted",
      })
      const finalAt = new Date(now.getTime() + days(3))
      const final = await evaluatePrivatePrecomputedCtr(prisma, {
        experimentId,
        operator,
        now: finalAt,
      })
      expect(final).toMatchObject({
        status: "available",
        report: {
          revision: 33,
          isFinal: true,
          outcome: "inconclusive",
          reasons: expect.arrayContaining([
            "bot_eligibility_unverified",
            "numeric_policy_not_agreed",
          ]),
        },
      })
      expect(
        await evaluatePrivatePrecomputedCtr(prisma, {
          experimentId,
          operator,
          now: new Date(finalAt.getTime() + days(1)),
        }),
      ).toEqual(final)
    })

    it("finalizes a closed private cohort but never classifies a closed public cohort as private", async () => {
      const frozen =
        await prisma.recommendationPrecomputedExperiment.findUniqueOrThrow({
          where: { id: experimentId },
          include: { ctrPolicy: true },
        })
      const cohort = {
        generationId: frozen.generationId,
        controlManifestId: frozen.controlManifestId,
        challengerManifestId: frozen.challengerManifestId,
        controlManifestDigest: frozen.controlManifestDigest,
        controlRoutingDigest: frozen.controlRoutingDigest,
        sourceSetDigest: frozen.sourceSetDigest,
        assignmentPolicyVersion: frozen.assignmentPolicyVersion,
        deliveryPolicyVersion: frozen.deliveryPolicyVersion,
        configurationDigest: frozen.configurationDigest,
        startsAt: new Date(now.getTime() - days(4)),
        endsAt: new Date(now.getTime() - days(2)),
        expiresAt: new Date(now.getTime() + days(363)),
      }
      await prisma.recommendationPrecomputedExperiment.update({
        where: { id: experimentId },
        data: { state: "closed" },
      })
      const privateId = `closed-private-${randomUUID()}`
      await prisma.recommendationPrecomputedExperiment.create({
        data: {
          ...cohort,
          id: privateId,
          eligibilityPolicyVersion: frozen.eligibilityPolicyVersion,
          state: "private_test",
        },
      })
      await declareFixturePrecomputedCtrPolicy(prisma, {
        experimentId: privateId,
        operator,
        settings: frozen.ctrPolicy!.settings as Parameters<
          typeof declareFixturePrecomputedCtrPolicy
        >[1]["settings"],
      })
      await prisma.recommendationPrecomputedVisit.create({
        data: {
          id: randomUUID(),
          experimentId: privateId,
          browserUnitDigest: "a".repeat(64),
          sourceVideoId: "source-video",
          locale: "en",
          audioLanguageSlug: "english",
          eligibility: "eligible",
          qualification: "unverified_browser",
          arm: RecommendationExperimentArm.CONTROL,
          createdAt: new Date(now.getTime() - days(3)),
          expiresAt: new Date(now.getTime() + days(26)),
        },
      })
      await prisma.recommendationPrecomputedExperiment.update({
        where: { id: privateId },
        data: { state: "closed" },
      })
      expect(
        await evaluatePrivatePrecomputedCtr(prisma, {
          experimentId: privateId,
          operator,
          now,
        }),
      ).toMatchObject({
        status: "available",
        report: {
          isFinal: true,
          evidenceBasis: "private_unverified",
          byArm: { control: { eligibleVisits: 1 } },
        },
      })

      const publicId = `closed-public-${randomUUID()}`
      await prisma.recommendationPrecomputedExperiment.create({
        data: {
          ...cohort,
          id: publicId,
          eligibilityPolicyVersion: "public-watch-verified-human-v1",
          state: "public_ready",
        },
      })
      await prisma.recommendationPrecomputedCtrPolicy.create({
        data: {
          experimentId: publicId,
          version: frozen.ctrPolicy!.version,
          method: frozen.ctrPolicy!.method,
          settings: frozen.ctrPolicy!.settings!,
          lateEventCutoffHours: frozen.ctrPolicy!.lateEventCutoffHours,
          settingsDigest: frozen.ctrPolicy!.settingsDigest,
          authority: "fixture_only",
        },
      })
      await prisma.recommendationPrecomputedExperiment.update({
        where: { id: publicId },
        data: { state: "closed" },
      })
      expect(
        await evaluatePrivatePrecomputedCtr(prisma, {
          experimentId: publicId,
          operator,
          now,
        }),
      ).toEqual({
        status: "unavailable",
        reason: "private_experiment_unavailable",
      })
    })

    it("offers policy declaration only for an open test before its first visit", async () => {
      const prior =
        await prisma.recommendationPrecomputedExperiment.findUniqueOrThrow({
          where: { id: experimentId },
        })
      await prisma.recommendationPrecomputedExperiment.update({
        where: { id: experimentId },
        data: { state: "closed" },
      })
      const freshId = `${experimentId}-fresh`
      await prisma.recommendationPrecomputedExperiment.create({
        data: {
          id: freshId,
          generationId: prior.generationId,
          controlManifestId: prior.controlManifestId,
          challengerManifestId: prior.challengerManifestId,
          controlManifestDigest: prior.controlManifestDigest,
          controlRoutingDigest: prior.controlRoutingDigest,
          sourceSetDigest: prior.sourceSetDigest,
          assignmentPolicyVersion: prior.assignmentPolicyVersion,
          eligibilityPolicyVersion: prior.eligibilityPolicyVersion,
          deliveryPolicyVersion: prior.deliveryPolicyVersion,
          configurationDigest: prior.configurationDigest,
          state: "private_test",
          startsAt: now,
          endsAt: new Date(now.getTime() + days(2)),
          expiresAt: new Date(now.getTime() + days(367)),
        },
      })
      expect(
        await loadPrivatePrecomputedCtrIndex(prisma, {
          experimentId: freshId,
          reviewer: operator,
        }),
      ).toMatchObject({
        policyDeclared: false,
        canDeclarePolicy: true,
        declarationUnavailableReason: null,
      })
      await prisma.recommendationPrecomputedVisit.create({
        data: {
          id: randomUUID(),
          experimentId: freshId,
          browserUnitDigest: "3".repeat(64),
          sourceVideoId: "source-video",
          locale: "en",
          audioLanguageSlug: "english",
          eligibility: "eligible",
          qualification: "unverified_browser",
          arm: RecommendationExperimentArm.CONTROL,
          createdAt: now,
          expiresAt: new Date(now.getTime() + days(29)),
        },
      })
      expect(
        await loadPrivatePrecomputedCtrIndex(prisma, {
          experimentId: freshId,
          reviewer: operator,
        }),
      ).toMatchObject({
        policyDeclared: false,
        canDeclarePolicy: false,
        declarationUnavailableReason: "visits_exist",
      })
      await prisma.recommendationPrecomputedExperiment.update({
        where: { id: freshId },
        data: { state: "closed" },
      })
      expect(
        await loadPrivatePrecomputedCtrIndex(prisma, {
          experimentId: freshId,
          reviewer: operator,
        }),
      ).toMatchObject({
        canDeclarePolicy: false,
        declarationUnavailableReason: "experiment_unavailable",
      })
    })

    it("leaves a live final revision pending until independent calibration is attested", async () => {
      const prior =
        await prisma.recommendationPrecomputedExperiment.findUniqueOrThrow({
          where: { id: experimentId },
          include: { ctrPolicy: true },
        })
      const liveId = `live-attribution-${randomUUID()}`
      const end = new Date(
        Math.floor((now.getTime() - days(2)) / 3_600_000) * 3_600_000,
      )
      const start = new Date(end.getTime() - days(30))
      const finalAt = new Date(end.getTime() + days(1))
      await prisma.recommendationPrecomputedExperiment.create({
        data: {
          id: liveId,
          generationId: prior.generationId,
          controlManifestId: prior.controlManifestId,
          challengerManifestId: prior.challengerManifestId,
          controlManifestDigest: prior.controlManifestDigest,
          controlRoutingDigest: prior.controlRoutingDigest,
          sourceSetDigest: prior.sourceSetDigest,
          assignmentPolicyVersion: prior.assignmentPolicyVersion,
          eligibilityPolicyVersion: PRECOMPUTED_PUBLIC_LIVE_ELIGIBILITY_POLICY,
          deliveryPolicyVersion: prior.deliveryPolicyVersion,
          configurationDigest: "f".repeat(64),
          liveEvidence: { contractVersion: "precomputed-live-evidence-v1" },
          state: "public_ready",
          startsAt: start,
          endsAt: end,
          expiresAt: new Date(end.getTime() + days(365)),
        },
      })
      await prisma.recommendationPrecomputedCtrPolicy.create({
        data: {
          experimentId: liveId,
          version: prior.ctrPolicy!.version,
          method: prior.ctrPolicy!.method,
          settings: prior.ctrPolicy!.settings!,
          lateEventCutoffHours: prior.ctrPolicy!.lateEventCutoffHours,
          settingsDigest: prior.ctrPolicy!.settingsDigest,
          authority: "prelaunch_agreed",
        },
      })
      const at = new Date(end.getTime() - days(1))
      for (let index = 0; index < 30; index++) {
        for (const arm of [
          RecommendationExperimentArm.CONTROL,
          RecommendationExperimentArm.CHALLENGER,
        ]) {
          const visitId = randomUUID()
          await prisma.recommendationPrecomputedVisit.create({
            data: {
              id: visitId,
              experimentId: liveId,
              browserUnitDigest: createHash("sha256")
                .update(`${arm}-${index}`)
                .digest("hex"),
              sourceVideoId: "source-video",
              locale: "en",
              audioLanguageSlug: "english",
              eligibility: "eligible",
              qualification: "turnstile_verified_browser",
              arm,
              createdAt: at,
              expiresAt: new Date(now.getTime() + 12 * 3_600_000),
            },
          })
          if (
            (arm === RecommendationExperimentArm.CONTROL && index === 0) ||
            (arm === RecommendationExperimentArm.CHALLENGER && index < 20)
          )
            await selection(visitId, new Date(at.getTime() + 60_000))
        }
      }
      const counters = Object.fromEntries(
        WEB_WATCH_COUNTERS.map((counter) => [counter, 0]),
      ) as WebWatchCounters
      counters.delivery_attempt = 1_002
      counters.delivery_qualified = 1_000
      counters.delivery_unavailable = 1
      counters.delivery_rejected = 1
      counters.click_attempt = 1_004
      counters.click_ack = 1_000
      counters.click_unavailable = 4
      const provisionalAt = new Date(end.getTime() + 12 * 3_600_000)
      const provisionalEnd = provisionalAt.toISOString()
      vi.mocked(loadWebWatchMeasurement).mockResolvedValueOnce({
        status: "complete",
        contractVersion: "watch-public-measurement-v1",
        startHour: start.toISOString(),
        endHourExclusive: provisionalEnd,
        observedAt: provisionalAt.toISOString(),
        requestedHours: (provisionalAt.getTime() - start.getTime()) / 3_600_000,
        coveredHours: (provisionalAt.getTime() - start.getTime()) / 3_600_000,
        missingHours: [],
        imbalancedHours: [],
        counters,
        counterUnit: "web_request_attempts_not_distinct_visits",
      })
      vi.mocked(loadWebExperimentMeasurement).mockResolvedValueOnce({
        status: "incomplete",
        contractVersion: "watch-experiment-measurement-v1",
        experimentId: liveId,
        startHour: start.toISOString(),
        endHourExclusive: provisionalEnd,
        observedAt: provisionalAt.toISOString(),
        requestedHours: (provisionalAt.getTime() - start.getTime()) / 3_600_000,
        coveredHours:
          (provisionalAt.getTime() - start.getTime()) / 3_600_000 - 1,
        missingHours: ["2026100601"],
        imbalancedHours: [],
        counters: {
          delivery_attempt: 1,
          delivery_eligible: 1,
          delivery_not_eligible: 0,
          delivery_response_failed: 0,
          click_attempt: 0,
          click_ack: 0,
          click_unavailable: 0,
        },
        counterUnit: "web_request_attempts_not_distinct_visits",
      })
      const provisional = await evaluatePublicPrecomputedCtr(prisma, {
        experimentId: liveId,
        operator,
        now: provisionalAt,
      })
      expect(provisional).toMatchObject({
        status: "available",
        report: {
          isFinal: false,
          outcome: "inconclusive",
          measurementHealth: {
            experimentRequestHealth: { reconciliation: "incomplete" },
          },
          reasons: expect.arrayContaining([
            "experiment_scoped_tracking_loss_unverified",
          ]),
        },
      })
      vi.mocked(loadWebWatchMeasurement).mockResolvedValueOnce({
        status: "complete",
        contractVersion: "watch-public-measurement-v1",
        startHour: start.toISOString(),
        endHourExclusive: finalAt.toISOString(),
        observedAt: now.toISOString(),
        requestedHours: (finalAt.getTime() - start.getTime()) / 3_600_000,
        coveredHours: (finalAt.getTime() - start.getTime()) / 3_600_000,
        missingHours: [],
        imbalancedHours: [],
        counters,
        counterUnit: "web_request_attempts_not_distinct_visits",
      })
      vi.mocked(loadWebExperimentMeasurement).mockResolvedValueOnce({
        status: "complete",
        contractVersion: "watch-experiment-measurement-v1",
        experimentId: liveId,
        startHour: start.toISOString(),
        endHourExclusive: finalAt.toISOString(),
        observedAt: now.toISOString(),
        requestedHours: (finalAt.getTime() - start.getTime()) / 3_600_000,
        coveredHours: (finalAt.getTime() - start.getTime()) / 3_600_000,
        missingHours: [],
        imbalancedHours: [],
        counters: {
          delivery_attempt: 62,
          delivery_eligible: 60,
          delivery_not_eligible: 1,
          delivery_response_failed: 1,
          click_attempt: 25,
          click_ack: 21,
          click_unavailable: 4,
        },
        counterUnit: "web_request_attempts_not_distinct_visits",
      })
      // Web can acknowledge every Admin commit while its response to the
      // browser is lost. Server counters cannot certify that final hop or
      // consume the immutable final revision before independent calibration.
      const result = await evaluatePublicPrecomputedCtr(prisma, {
        experimentId: liveId,
        operator,
        now,
      })
      expect(result).toEqual({
        status: "unavailable",
        reason: "final_calibration_pending",
      })
      expect(
        await prisma.recommendationPrecomputedCtrReport.count({
          where: { experimentId: liveId, isFinal: true },
        }),
      ).toBe(0)
    })

    it.skipIf(
      env.RECOMMENDATION_PRECOMPUTED_COMPACT_MEASUREMENT_ENABLED !== "1",
    )(
      "keeps an impression received after the report cutoff out of the earlier snapshot",
      async () => {
        const id = await visit({
          arm: RecommendationExperimentArm.CONTROL,
          browser: "e".repeat(64),
          createdAt: new Date(now.getTime() - days(1)),
          expiresAt: new Date(now.getTime() + days(1)),
        })
        const issued = await selection(id, new Date(now.getTime() - 60_000))
        const before = new Date(now.getTime() + 10_000)
        const after = new Date(now.getTime() + 30_000)
        await prisma.$transaction((tx) =>
          capturePrecomputedCtrMeasurement(tx, id, before),
        )
        await prisma.recommendationImpression.create({
          data: {
            requestId: issued.requestId,
            itemId: issued.itemId,
            capabilityJti: randomUUID(),
            eventId: randomUUID(),
            payloadDigest: "f".repeat(64),
            visibilityPolicy: "watch-below-player-v1",
            occurredAt: new Date(now.getTime() + 20_000),
            receivedAt: new Date(now.getTime() + 20_000),
            expiresAt: issued.expiry,
          },
        })
        await prisma.$transaction((tx) =>
          capturePrecomputedCtrMeasurement(tx, id, after),
        )
        for (const [cutoff, matched] of [
          [before, 0n],
          [after, 1n],
        ] as const) {
          const [native] = await prisma.$queryRaw<RawCtrVisit[]>(
            rawCtrVisitSql(Prisma.sql`v.id = ${id}::uuid`, cutoff),
          )
          expect(native.matched_selections).toBe(matched)
          expect(await readCompactCtrVisitAt(prisma, id, cutoff)).toEqual(
            native,
          )
        }
      },
    )

    it.skipIf(
      env.RECOMMENDATION_PRECOMPUTED_COMPACT_MEASUREMENT_ENABLED !== "1",
    )(
      "uses native archive authority when the latest checkpoint was accepted after retention now",
      async () => {
        const id = await visit({
          arm: RecommendationExperimentArm.CONTROL,
          browser: "7".repeat(64),
          createdAt: new Date(now.getTime() - days(2)),
          expiresAt: new Date(now.getTime() - days(1)),
        })
        await prisma.$transaction((tx) =>
          capturePrecomputedCtrMeasurement(
            tx,
            id,
            new Date(now.getTime() + 60_000),
          ),
        )
        const result = await prisma.$transaction((tx) =>
          purgeExpiredPrecomputedVisitRoots(tx, now, 100, [], false, {
            archiveReader: "compact",
          }),
        )
        expect(result.archiveSource).toBe("native_cutoff_ineligible")
        expect(
          await prisma.recommendationPrecomputedCtrArchivedVisit.count({
            where: { visitId: id },
          }),
        ).toBe(1)
      },
    )

    it.skipIf(
      env.RECOMMENDATION_PRECOMPUTED_COMPACT_MEASUREMENT_ENABLED !== "1",
    )(
      "measures native and checkpointed compact archive work on the same bounded page",
      async () => {
        const ids = await Promise.all(
          Array.from({ length: 30 }, (_, index) =>
            visit({
              arm: RecommendationExperimentArm.CONTROL,
              browser: index.toString(16).padStart(64, "0"),
              createdAt: new Date(now.getTime() - days(2)),
              expiresAt: new Date(now.getTime() - days(1)),
            }),
          ),
        )
        for (const id of ids)
          await prisma.$transaction((tx) =>
            capturePrecomputedCtrMeasurement(tx, id, now),
          )
        const rollback = new Error("rollback native benchmark")
        let nativeTotals: unknown
        let nativeClusters: unknown
        const nativeStarted = performance.now()
        await expect(
          prisma.$transaction(async (tx) => {
            await purgeExpiredPrecomputedVisitRoots(tx, now, 100, [], false, {
              archiveReader: "native",
            })
            nativeTotals = await tx.recommendationPrecomputedCtrTotals.findMany(
              {
                where: { experimentId },
                orderBy: { arm: "asc" },
              },
            )
            nativeClusters =
              await tx.recommendationPrecomputedCtrCluster.findMany({
                where: { experimentId },
                orderBy: { browserUnitDigest: "asc" },
              })
            throw rollback
          }),
        ).rejects.toBe(rollback)
        const nativeMs = Math.round(performance.now() - nativeStarted)
        const compactStarted = performance.now()
        const compact = await prisma.$transaction(
          (tx) =>
            purgeExpiredPrecomputedVisitRoots(tx, now, 100, [], false, {
              archiveReader: "compact",
            }),
          { timeout: 10_000 },
        )
        const compactMs = Math.round(performance.now() - compactStarted)
        expect(compact.archiveSource).toBe("compact")
        expect(compact.visitsDeleted).toBe(ids.length)
        expect(
          await prisma.recommendationPrecomputedCtrTotals.findMany({
            where: { experimentId },
            orderBy: { arm: "asc" },
          }),
        ).toEqual(nativeTotals)
        expect(
          await prisma.recommendationPrecomputedCtrCluster.findMany({
            where: { experimentId },
            orderBy: { browserUnitDigest: "asc" },
          }),
        ).toEqual(nativeClusters)
        expect(
          await prisma.recommendationPrecomputedCtrArchivedVisit.count({
            where: { visitId: { in: ids } },
          }),
        ).toBe(ids.length)
        console.info(
          `archive qualification, ${ids.length} visits: native rollback ${nativeMs} ms, compact checkpoint ${compactMs} ms`,
        )
      },
    )

    it.skipIf(
      env.RECOMMENDATION_PRECOMPUTED_COMPACT_MEASUREMENT_ENABLED !== "1",
    )(
      "rolls back a mixed legacy and malformed compact archive page",
      async () => {
        const malformed = await visit({
          arm: RecommendationExperimentArm.CONTROL,
          browser: "6".repeat(64),
          createdAt: new Date(now.getTime() - days(2)),
          expiresAt: new Date(now.getTime() - days(1)),
        })
        const legacy = await visit({
          arm: RecommendationExperimentArm.CHALLENGER,
          browser: "5".repeat(64),
          createdAt: new Date(now.getTime() - days(2)),
          expiresAt: new Date(now.getTime() - days(1)),
        })
        await prisma.$transaction((tx) =>
          capturePrecomputedCtrMeasurement(tx, malformed, now),
        )
        await prisma.$executeRaw(Prisma.sql`
          UPDATE recommendation_precomputed_ctr_measurement
          SET summary = '{}'::jsonb WHERE visit_id = ${malformed}::uuid
        `)
        await expect(
          prisma.$transaction((tx) =>
            purgeExpiredPrecomputedVisitRoots(tx, now, 100, [], false, {
              archiveReader: "compact",
            }),
          ),
        ).rejects.toThrow("precomputed_compact_summary_invalid")
        expect(
          await prisma.recommendationPrecomputedVisit.count({
            where: { id: { in: [malformed, legacy] } },
          }),
        ).toBe(2)
        expect(
          await prisma.recommendationPrecomputedCtrArchivedVisit.count({
            where: { visitId: { in: [malformed, legacy] } },
          }),
        ).toBe(0)
      },
    )
  },
)
