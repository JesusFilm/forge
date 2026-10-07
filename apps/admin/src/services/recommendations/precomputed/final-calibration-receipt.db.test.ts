import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto"
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
  evaluatePublicPrecomputedCtr,
  precomputedCtrPolicyDigest,
} from "./ctr-report"
import {
  PRECOMPUTED_PUBLIC_CONTROL_ID,
  promotePrecomputedPublicExperiment,
} from "./public-control"
import { readControlRouting } from "./visit-admission"
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
import {
  attestPrecomputedFinalCalibration,
  loadPrecomputedFinalCalibration,
} from "./final-calibration-receipt"

const { publicKey, privateKey } = generateKeyPairSync("ed25519")
const keyring = JSON.stringify({
  "independent-key-1": {
    sourceId: "independent-edge-1",
    boundMethod: "edge-census-upper-v1",
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
  },
})
const policySettings = {
  baselineHumanVisitCtr: 0.2,
  minimumDetectableAbsoluteUplift: 0.05,
  minimumPracticalAbsoluteUplift: 0.05,
  plannedPower: 0.8,
  minimumEligibleVisitsPerArm: 3,
  minimumIndependentBrowsersPerArm: 3,
  minimumDurationHours: 24,
  lateEventCutoffHours: 24,
  maximumActualFallbackRate: 0.2,
  maximumUnlinkedDeliveryRate: 0,
  maximumEndToEndLossRate: 0.1,
}
const policyDigest = precomputedCtrPolicyDigest(policySettings)

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "signed final calibration on PostgreSQL",
  () => {
    const schema = `precomputed_public_calibration_${randomUUID().replaceAll("-", "")}`
    const generationId = `calibration-generation-${randomUUID()}`
    const experimentId = `calibration-experiment-${randomUUID()}`
    const operator = { id: "calibration-operator", role: "ADMIN" as const }
    const now = new Date()
    const start = new Date(
      Math.floor((now.getTime() - 4 * 86_400_000) / 3_600_000) * 3_600_000,
    )
    const end = new Date(start.getTime() + 86_400_000)
    const finalAt = new Date(end.getTime() + 86_400_000)
    let admin: Client
    let prisma: PrismaClient
    let controlRoutingDigest: string

    function claims() {
      return {
        contractVersion: "precomputed-final-calibration-v1",
        authority: "independent_browser_edge",
        sourceId: "independent-edge-1",
        sourceRunId: "native-edge-run-1",
        experimentId,
        generationId,
        configurationDigest: "a".repeat(64),
        policyDigest,
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        finalAt: finalAt.toISOString(),
        observedAt: new Date(now.getTime() - 60_000).toISOString(),
        collectionMode: "independent_initiation_and_web_receipt_v1",
        boundMethod: "edge-census-upper-v1",
        coverage: "complete",
        dropRetryProbe: "passed",
        deliveryInitiated: 61,
        deliveryReachedWeb: 60,
        clickInitiated: 22,
        clickReachedWeb: 21,
        lossUpperBoundRate: 0.08,
        quietHourBits: Buffer.from([0, 0, 0, 255, 255, 255]).toString(
          "base64url",
        ),
      }
    }

    function signed(value = claims()) {
      const header = Buffer.from(
        JSON.stringify({
          alg: "EdDSA",
          typ: "precomputed-calibration+jws",
          kid: "independent-key-1",
        }),
      ).toString("base64url")
      const payload = Buffer.from(JSON.stringify(value)).toString("base64url")
      const signingInput = `${header}.${payload}`
      return `${signingInput}.${sign(
        null,
        Buffer.from(signingInput),
        privateKey,
      ).toString("base64url")}`
    }

    function webEvidence(forExperimentId: string) {
      const counters = Object.fromEntries(
        WEB_WATCH_COUNTERS.map((field) => [field, 0]),
      ) as WebWatchCounters
      counters.delivery_attempt = 60
      counters.delivery_qualified = 60
      // Global Watch telemetry is diagnostic here: it can include an
      // unrelated failed click and a quiet late period with no hash.
      counters.click_attempt = 22
      counters.click_ack = 21
      counters.click_unavailable = 1
      const hours = Array.from({ length: 24 }, (_, index) =>
        new Date(end.getTime() + index * 3_600_000)
          .toISOString()
          .slice(0, 13)
          .replace(/[-T]/g, ""),
      )
      vi.mocked(loadWebWatchMeasurement).mockResolvedValueOnce({
        status: "incomplete",
        contractVersion: "watch-public-measurement-v1",
        startHour: start.toISOString(),
        endHourExclusive: finalAt.toISOString(),
        observedAt: new Date().toISOString(),
        requestedHours: 48,
        coveredHours: 24,
        missingHours: hours,
        imbalancedHours: [],
        counters,
        counterUnit: "web_request_attempts_not_distinct_visits",
      })
      vi.mocked(loadWebExperimentMeasurement).mockResolvedValueOnce({
        status: "incomplete",
        contractVersion: "watch-experiment-measurement-v1",
        experimentId: forExperimentId,
        startHour: start.toISOString(),
        endHourExclusive: finalAt.toISOString(),
        observedAt: new Date().toISOString(),
        requestedHours: 48,
        coveredHours: 24,
        missingHours: hours,
        imbalancedHours: [],
        counters: {
          delivery_attempt: 60,
          delivery_eligible: 60,
          delivery_not_eligible: 0,
          delivery_response_failed: 0,
          click_attempt: 21,
          click_ack: 21,
          click_unavailable: 0,
        },
        counterUnit: "web_request_attempts_not_distinct_visits",
      })
    }

    async function cloneLiveExperiment(id: string) {
      const experiment =
        await prisma.recommendationPrecomputedExperiment.findUniqueOrThrow({
          where: { id: experimentId },
        })
      await prisma.recommendationPrecomputedExperiment.create({
        data: {
          id,
          generationId,
          controlManifestId: experiment.controlManifestId,
          challengerManifestId: experiment.challengerManifestId,
          controlManifestDigest: experiment.controlManifestDigest,
          controlRoutingDigest: experiment.controlRoutingDigest,
          sourceSetDigest: experiment.sourceSetDigest,
          assignmentPolicyVersion: experiment.assignmentPolicyVersion,
          eligibilityPolicyVersion: experiment.eligibilityPolicyVersion,
          deliveryPolicyVersion: experiment.deliveryPolicyVersion,
          configurationDigest: experiment.configurationDigest,
          liveEvidence: { contractVersion: "precomputed-live-evidence-v1" },
          state: "public_ready",
          startsAt: start,
          endsAt: end,
          expiresAt: experiment.expiresAt,
        },
      })
      await prisma.recommendationPrecomputedCtrPolicy.create({
        data: {
          experimentId: id,
          version: "fixed-horizon-cluster-delta-t-v1",
          method: "fixed-horizon-cluster-delta-t-v1",
          settings: policySettings,
          lateEventCutoffHours: 24,
          settingsDigest: policyDigest,
          authority: "prelaunch_agreed",
        },
      })
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
      await prisma.recommendationServingControl.update({
        where: { id: "recommendation-serving-control" },
        data: { enabled: true },
      })
      const routing = await readControlRouting(prisma)
      if (!routing) throw new Error("native incumbent routing missing")
      controlRoutingDigest = routing.routingDigest
      await prisma.recommendationPrecomputedGeneration.create({
        data: {
          id: generationId,
          modelId: "gpt-6-astra",
          promptVersion: "native-calibration-v1",
          inputDigest: "b".repeat(64),
          sourceSetDigest: "c".repeat(64),
          inputCutoff: start,
          expectedSourceCount: 1,
          status: "complete",
          completedAt: now,
        },
      })
      await prisma.recommendationPrecomputedExperiment.create({
        data: {
          id: experimentId,
          generationId,
          controlManifestId: "semantic-transcript-pgvector-v1",
          challengerManifestId: "precomputed-watch-preview-v1",
          controlManifestDigest: "d".repeat(64),
          controlRoutingDigest,
          sourceSetDigest: "c".repeat(64),
          assignmentPolicyVersion: "browser-sha256-50-v1",
          eligibilityPolicyVersion:
            "public-watch-turnstile-verified-browser-v1",
          deliveryPolicyVersion: "saved-or-control-v1",
          configurationDigest: "a".repeat(64),
          liveEvidence: { contractVersion: "precomputed-live-evidence-v1" },
          state: "public_ready",
          startsAt: start,
          endsAt: end,
          expiresAt: new Date(now.getTime() + 365 * 86_400_000),
        },
      })
      await prisma.recommendationPrecomputedCtrPolicy.create({
        data: {
          experimentId,
          version: "fixed-horizon-cluster-delta-t-v1",
          method: "fixed-horizon-cluster-delta-t-v1",
          settings: policySettings,
          lateEventCutoffHours: policySettings.lateEventCutoffHours,
          settingsDigest: policyDigest,
          authority: "prelaunch_agreed",
        },
      })
      const at = new Date(end.getTime() - 3_600_000)
      const expiry = new Date(now.getTime() + 20 * 86_400_000)
      const visits = Array.from({ length: 60 }, (_, index) => {
        const arm =
          index < 30
            ? RecommendationExperimentArm.CONTROL
            : RecommendationExperimentArm.CHALLENGER
        return {
          id: randomUUID(),
          experimentId,
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
          expiresAt: expiry,
        }
      })
      const clicked = visits.filter(
        (_, index) => index === 0 || (index >= 30 && index < 50),
      )
      const bindings = clicked.map((visit) => ({
        visit,
        requestId: `calibration-request-${randomUUID()}`,
        itemId: `calibration-item-${randomUUID()}`,
      }))
      await prisma.$transaction(
        async (tx) => {
          await tx.recommendationPrecomputedVisit.createMany({ data: visits })
          await tx.recommendationRequest.createMany({
            data: bindings.map(({ requestId, visit }) => ({
              id: requestId,
              contractVersion: "semantic-recommendation-v1",
              surfaceVersion: "watch-below-player-v1",
              manifestId:
                visit.arm === RecommendationExperimentArm.CHALLENGER
                  ? "precomputed-watch-preview-v1"
                  : "semantic-transcript-pgvector-v1",
              strategyVersion:
                visit.arm === RecommendationExperimentArm.CHALLENGER
                  ? "precomputed-watch-preview-v1"
                  : "semantic-transcript-pgvector-v1",
              classifierVersion: "origin-traffic-v1",
              sessionDigest: "f".repeat(64),
              seedMediaId: "source-video",
              locale: "en",
              expectedItemCount: 1,
              state: RecommendationRequestState.ISSUED,
              result: RecommendationDeliveryResult.SERVED,
              deliveryJti: randomUUID(),
              signingKid: "calibration-native",
              createdAt: at,
              issuedAt: at,
              expiresAt: expiry,
            })),
          })
          await tx.recommendationServedItem.createMany({
            data: bindings.map(({ requestId, itemId }) => ({
              id: itemId,
              requestId,
              position: 0,
              targetMediaId: "target-video",
              canonicalHref: "/watch/target-video.html",
              candidateGenerator: "semantic",
              candidateProvenance: {},
              expiresAt: expiry,
            })),
          })
          await tx.recommendationPrecomputedVisitRequest.createMany({
            data: bindings.map(({ requestId, visit }) => ({
              requestId,
              visitId: visit.id,
              createdAt: at,
              expiresAt: expiry,
            })),
          })
          await tx.recommendationSelection.createMany({
            data: bindings.map(({ requestId, itemId }) => ({
              id: randomUUID(),
              requestId,
              itemId,
              capabilityJti: randomUUID(),
              eventId: randomUUID(),
              payloadDigest: "2".repeat(64),
              claimNonceDigest: createHash("sha256")
                .update(randomUUID())
                .digest("hex"),
              handoffExpiresAt: expiry,
              occurredAt: new Date(at.getTime() + 60_000),
              receivedAt: new Date(at.getTime() + 60_000),
              expiresAt: expiry,
            })),
          })
        },
        { timeout: 30_000 },
      )
    }, 180_000)

    afterAll(async () => {
      await prisma?.$disconnect()
      if (admin) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await admin.end()
      }
    })

    it("rejects mismatched and untrusted claims before storing a receipt", async () => {
      await expect(
        attestPrecomputedFinalCalibration(prisma, {
          assertion: signed({ ...claims(), generationId: "other-generation" }),
          operator,
          now,
          testTrustedKeyring: keyring,
        }),
      ).rejects.toMatchObject({ code: "incompatible_target" })
      await expect(
        attestPrecomputedFinalCalibration(prisma, {
          assertion: signed(),
          operator,
          now,
          testTrustedKeyring: "{}",
        }),
      ).rejects.toMatchObject({ code: "untrusted_attestor" })
      expect(
        await prisma.recommendationPrecomputedFinalCalibration.count(),
      ).toBe(0)
    })

    it("waits before finality, then qualifies signed quiet hours without rewriting a report", async () => {
      webEvidence(experimentId)
      expect(
        await evaluatePublicPrecomputedCtr(prisma, {
          experimentId,
          operator,
          now: new Date(),
          testTrustedKeyring: keyring,
        }),
      ).toEqual({ status: "unavailable", reason: "final_calibration_pending" })
      expect(
        await prisma.recommendationPrecomputedCtrReport.count({
          where: { experimentId },
        }),
      ).toBe(0)
      const receipt = await attestPrecomputedFinalCalibration(prisma, {
        assertion: signed(),
        operator,
        now,
        testTrustedKeyring: keyring,
      })
      expect(receipt).toMatchObject({
        sourceId: "independent-edge-1",
        lossUpperBoundRate: 0.08,
      })
      expect(receipt.quietHours.size).toBe(24)
      const experiment =
        await prisma.recommendationPrecomputedExperiment.findUniqueOrThrow({
          where: { id: experimentId },
        })
      const loaded = await loadPrecomputedFinalCalibration(
        prisma,
        {
          ...experiment,
          policyDigest,
          lateEventCutoffHours: 24,
        },
        new Date(),
        keyring,
      )
      expect(loaded?.receiptDigest).toBe(receipt.receiptDigest)
      await expect(
        prisma.recommendationPrecomputedFinalCalibration.update({
          where: { experimentId },
          data: { lossUpperBound: 0 },
        }),
      ).rejects.toThrow()
      await expect(
        attestPrecomputedFinalCalibration(prisma, {
          assertion: signed(),
          operator,
          now,
          testTrustedKeyring: keyring,
        }),
      ).rejects.toMatchObject({ code: "already_attested" })
      webEvidence(experimentId)
      const covered = await evaluatePublicPrecomputedCtr(prisma, {
        experimentId,
        operator,
        now: new Date(),
        testTrustedKeyring: keyring,
      })
      if (covered.status === "available")
        expect(covered.report.reasons).toEqual([])
      expect(covered).toMatchObject({
        status: "available",
        report: {
          isFinal: true,
          outcome: "challenger",
          measurementHealth: {
            webRequestHealth: { status: "incomplete" },
            experimentRequestHealth: {
              status: "incomplete",
              reconciliation: "no_observed_shortfall",
              missingHourCount: 24,
              independentlyCoveredQuietHours: 24,
              clientNetworkLoss: "calibration_verified",
            },
          },
        },
      })
      if (covered.status !== "available") throw new Error("missing report")
      expect(covered.report.reasons).not.toContain(
        "experiment_scoped_tracking_loss_unverified",
      )
      expect(covered.report.reasons).not.toContain(
        "end_to_end_client_loss_unverified",
      )
      expect(covered.report.reasons).not.toContain(
        "web_request_health_incomplete",
      )
    })

    it("does not infer a missing scoped hour from unsigned silence", async () => {
      const missingId = `calibration-missing-${randomUUID()}`
      await cloneLiveExperiment(missingId)
      await attestPrecomputedFinalCalibration(prisma, {
        assertion: signed({
          ...claims(),
          experimentId: missingId,
          lossUpperBoundRate: 0.11,
          quietHourBits: Buffer.alloc(6).toString("base64url"),
        }),
        operator,
        now,
        testTrustedKeyring: keyring,
      })
      webEvidence(missingId)
      const missing = await evaluatePublicPrecomputedCtr(prisma, {
        experimentId: missingId,
        operator,
        now: new Date(),
        testTrustedKeyring: keyring,
      })
      expect(missing).toMatchObject({
        status: "available",
        report: {
          measurementHealth: {
            experimentRequestHealth: {
              reconciliation: "incomplete",
              independentlyCoveredQuietHours: 0,
              clientNetworkLoss: "unobservable",
            },
          },
          reasons: expect.arrayContaining([
            "experiment_scoped_tracking_loss_unverified",
            "end_to_end_client_loss_above_limit",
          ]),
        },
      })
    })

    it("charges reached-Web requests missing from scoped attribution", async () => {
      const deficitId = `calibration-deficit-${randomUUID()}`
      await cloneLiveExperiment(deficitId)
      await attestPrecomputedFinalCalibration(prisma, {
        assertion: signed({
          ...claims(),
          experimentId: deficitId,
          deliveryInitiated: 1_000,
          deliveryReachedWeb: 1_000,
          clickInitiated: 1_000,
          clickReachedWeb: 1_000,
          lossUpperBoundRate: 0,
        }),
        operator,
        now,
        testTrustedKeyring: keyring,
      })
      webEvidence(deficitId)
      const report = await evaluatePublicPrecomputedCtr(prisma, {
        experimentId: deficitId,
        operator,
        now: new Date(),
        testTrustedKeyring: keyring,
      })
      expect(report).toMatchObject({
        status: "available",
        report: {
          evidenceBasis: "live_incomplete",
          outcome: "inconclusive",
          finalCalibration: {
            unattributedDeliveryAttempts: 940,
            unattributedClickAttempts: 979,
            reconciledLossUpperBoundRate: 0.979,
          },
          reasons: expect.arrayContaining([
            "end_to_end_client_loss_above_limit",
          ]),
        },
      })
    })

    it("requires the exact calibrated final result for a separate manual promotion", async () => {
      const report =
        await prisma.recommendationPrecomputedCtrReport.findFirstOrThrow({
          where: { experimentId, isFinal: true },
          orderBy: { revision: "desc" },
        })
      const pointer =
        await prisma.recommendationPrecomputedPublicControl.findUniqueOrThrow({
          where: { id: PRECOMPUTED_PUBLIC_CONTROL_ID },
        })
      await prisma.recommendationPrecomputedPublicControl.update({
        where: { id: PRECOMPUTED_PUBLIC_CONTROL_ID },
        data: {
          version: pointer.version + 1,
          mode: "ab",
          activeExperimentId: experimentId,
          authority: "live_verified",
        },
      })
      const promote = (expectedReportEvidenceDigest: string) =>
        promotePrecomputedPublicExperiment(prisma, {
          expectedControlVersion: pointer.version + 1,
          expectedExperimentId: experimentId,
          expectedGenerationId: generationId,
          expectedReportRevision: report.revision,
          expectedReportEvidenceDigest,
          operator,
          now: new Date(),
          testTrustedKeyring: keyring,
        })
      await expect(promote("f".repeat(64))).rejects.toMatchObject({
        code: "incompatible_target",
      })
      expect(
        await prisma.recommendationPrecomputedPublicControl.findUniqueOrThrow({
          where: { id: PRECOMPUTED_PUBLIC_CONTROL_ID },
        }),
      ).toMatchObject({ mode: "ab" })
      expect(await promote(report.evidenceDigest)).toMatchObject({
        mode: "promoted",
        authority: "live_verified",
        reportEvidenceDigest: report.evidenceDigest,
      })
    })

    it("rejects late submission after the immutable final report", async () => {
      await expect(
        attestPrecomputedFinalCalibration(prisma, {
          assertion: signed(),
          operator,
          now,
          testTrustedKeyring: keyring,
        }),
      ).rejects.toMatchObject({ code: "already_final" })
    })
  },
)
