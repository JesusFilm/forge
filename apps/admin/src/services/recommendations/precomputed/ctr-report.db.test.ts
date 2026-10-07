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
  loadWebWatchMeasurement,
  WEB_WATCH_COUNTERS,
  type WebWatchCounters,
} from "./web-measurement"

vi.mock("./web-measurement", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./web-measurement")>()),
  loadWebWatchMeasurement: vi.fn(),
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

    beforeAll(async () => {
      admin = new Client({ connectionString: env.DATABASE_URL })
      await admin.connect()
      await admin.query(`CREATE SCHEMA "${schema}"`)
      await admin.query(`SET search_path TO "${schema}", public`)
      for (const sql of currentAdminMigrationSql) await admin.query(sql)
      const url = new URL(env.DATABASE_URL)
      url.searchParams.set("schema", schema)
      prisma = new PrismaClient({
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
        browser: "a".repeat(64),
        createdAt: new Date(now.getTime() - days(1)),
        expiresAt: new Date(now.getTime() + days(28)),
        eligibility: "excluded",
      })
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
            control: { eligibleVisits: 2, clickedVisits: 1, visitCtr: 0.5 },
            challenger: { eligibleVisits: 1, clickedVisits: 0 },
          },
          exclusions: { automation: 1 },
        },
      })
      const purge = await prisma.$transaction((tx) =>
        purgeExpiredPrecomputedVisitRoots(tx, now, 100),
      )
      expect(purge.visitsDeleted).toBe(2)
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
      await prisma.$transaction((tx) =>
        purgeExpiredPrecomputedVisitRoots(
          tx,
          new Date(now.getTime() + 120_000),
          100,
        ),
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

    it("closes a live cohort inconclusive even when global Web counters exceed its durable visits and clicks", async () => {
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
      counters.delivery_qualified = 1_000
      counters.click_ack = 1_000
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
      const result = await evaluatePublicPrecomputedCtr(prisma, {
        experimentId: liveId,
        operator,
        now,
      })
      expect(result).toMatchObject({
        status: "available",
        report: {
          isFinal: true,
          evidenceBasis: "live_incomplete",
          outcome: "inconclusive",
          measurementHealth: {
            botEligibility: "durable_rows_verified",
            trackingLoss: "unobservable",
            endToEndClientEventCompleteness: "unverified",
            webRequestHealth: { status: "complete" },
          },
          reasons: expect.arrayContaining([
            "experiment_scoped_tracking_loss_unverified",
            "tracking_loss_unobservable",
          ]),
        },
      })
      if (result.status !== "available") throw new Error("Missing live report")
      expect(result.report.uncertainty.lowerBound).toBeGreaterThan(0)
    })
  },
)
