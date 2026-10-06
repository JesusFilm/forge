import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { env } from "@/config/env"
import { currentAdminMigrationSql } from "../current-schema.test-fixture"
import {
  loadPrecomputedPublicControl,
  preparePrecomputedPublicExperiment,
  releaseRetainedPrecomputedPublicExperiment,
  rollbackPrecomputedPublicExperiment,
  startPrecomputedPublicExperiment,
} from "./public-control"
import { readControlRouting } from "./visit-admission"
import { purgeExpiredPrecomputedVisitRoots } from "./visit-retention"
import { deliverPrecomputedPublicWatchVisit } from "./public-watch"
import * as incumbentService from "../delivery.service"
import { chooseExperimentArm } from "../experiment/assignment"
import { precomputedBrowserUnitDigest } from "./visit-identity"

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "manual precomputed public control on PostgreSQL",
  () => {
    let prisma: PrismaClient
    let admin: Client
    const schema = `precomputed_public_${Date.now()}_${randomUUID().replaceAll("-", "")}`
    const sourceVideoId = `public-source-${randomUUID()}`
    const generationId = `public-generation-${randomUUID()}`
    const experimentId = `public-experiment-${randomUUID()}`
    const operator = { id: "fixture-admin", role: "ADMIN" } as const
    const caller = {
      id: null,
      role: "CONSUMER_BEARER",
      fleet: false,
      rateLimitBucketKey: "precomputed-public-native-test",
    } as const
    const tokenService = {
      activeKid: "public-native-test",
      signDeliveryCapability: async ({ itemId }: { itemId: string }) =>
        `test-capability-${itemId}`,
    }
    const visitInput = () => ({
      visitId: randomUUID(),
      browserDigest: "e".repeat(64),
      consentReceiptDigest: null,
      profileTokenDigest: null,
      seedMediaId: sourceVideoId,
      locale: "en",
      audioLanguageSlug: "english",
      sessionDigest: "f".repeat(64),
      clientDeliveryContract: null,
      trafficCategory: "ordinary_browser" as const,
      caller,
    })
    const policySettings = {
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
      await prisma.video.create({
        data: {
          id: sourceVideoId,
          coreId: `core-${sourceVideoId}`,
          slug: sourceVideoId,
        },
      })
      await prisma.language.create({
        data: {
          id: "public-english",
          coreId: "public-english-core",
          slug: "english",
        },
      })
      await prisma.videoLocale.create({
        data: {
          id: `locale-${sourceVideoId}`,
          videoId: sourceVideoId,
          locale: "en",
          status: "PUBLISHED",
          title: "Public source",
        },
      })
      await prisma.muxVideo.create({
        data: {
          id: `mux-${sourceVideoId}`,
          playbackId: `playback-${sourceVideoId}`,
        },
      })
      await prisma.videoDub.create({
        data: {
          id: `dub-${sourceVideoId}`,
          coreId: `dub-core-${sourceVideoId}`,
          videoId: sourceVideoId,
          languageId: "public-english",
          muxVideoId: `mux-${sourceVideoId}`,
          published: true,
        },
      })
      await prisma.recommendationPrecomputedGeneration.create({
        data: {
          id: generationId,
          modelId: "fixture-astra",
          promptVersion: "fixture-v1",
          inputDigest: "a".repeat(64),
          sourceSetDigest: "b".repeat(64),
          inputCutoff: new Date("2026-10-05T00:00:00.000Z"),
          expectedSourceCount: 1,
          protocolVersion: 2,
          status: "complete",
          completedAt: new Date(),
        },
      })
      await prisma.recommendationPrecomputedSource.create({
        data: {
          generationId,
          sourceVideoId,
          payload: [],
          acceptedCount: 0,
          submissionDigest: "c".repeat(64),
        },
      })
      await prisma.recommendationServingControl.update({
        where: { id: "recommendation-serving-control" },
        data: { enabled: true },
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

    it("keeps the incumbent selected after the schema is installed", async () => {
      expect(await loadPrecomputedPublicControl(prisma)).toMatchObject({
        mode: "incumbent",
        version: 1,
        experimentId: null,
        generationId: null,
      })
    })

    it("freezes a prepared cohort and policy without selecting public traffic", async () => {
      const routing = await readControlRouting(prisma)
      expect(routing).not.toBeNull()
      const now = Date.now()
      const prepared = await preparePrecomputedPublicExperiment(prisma, {
        id: experimentId,
        generationId,
        startsAt: new Date(now - 60_000),
        endsAt: new Date(now + 7 * 86_400_000),
        expectedControlRoutingDigest: routing!.routingDigest,
        expectedSourceSetDigest: "b".repeat(64),
        policySettings,
        authority: "isolated_fixture",
        operator,
      })
      expect(prepared).toMatchObject({
        id: experimentId,
        generationId,
        state: "public_ready",
      })
      expect(
        await prisma.recommendationPrecomputedCtrPolicy.findUniqueOrThrow({
          where: { experimentId },
        }),
      ).toMatchObject({ authority: "fixture_only" })
      expect(await loadPrecomputedPublicControl(prisma)).toMatchObject({
        mode: "incumbent",
        version: 1,
        experimentId: null,
      })
    })

    it("starts only the exact prepared fixture after capacity evidence and records one audit version", async () => {
      const prepared =
        await prisma.recommendationPrecomputedExperiment.findUniqueOrThrow({
          where: { id: experimentId },
        })
      await prisma.recommendationPrecomputedGeneration.update({
        where: { id: generationId },
        data: {
          capacityPreflight: { status: "passed", projectedBytes: 100_000 },
        },
      })
      await expect(
        startPrecomputedPublicExperiment(prisma, {
          experimentId,
          expectedConfigurationDigest: "d".repeat(64),
          expectedControlVersion: 1,
          authority: "isolated_fixture",
          operator,
        }),
      ).rejects.toMatchObject({ code: "incompatible_target" })
      expect(await loadPrecomputedPublicControl(prisma)).toMatchObject({
        mode: "incumbent",
        version: 1,
      })
      const active = await startPrecomputedPublicExperiment(prisma, {
        experimentId,
        expectedConfigurationDigest: prepared.configurationDigest,
        expectedControlVersion: 1,
        authority: "isolated_fixture",
        operator,
      })
      expect(active).toMatchObject({
        mode: "ab",
        version: 2,
        experimentId,
        generationId,
      })
      expect(
        await prisma.recommendationPrecomputedPublicControlEvent.findMany(),
      ).toEqual([
        expect.objectContaining({
          action: "start",
          controlVersion: 2,
          experimentId,
          generationId,
        }),
      ])
      await expect(
        startPrecomputedPublicExperiment(prisma, {
          experimentId,
          expectedConfigurationDigest: prepared.configurationDigest,
          expectedControlVersion: 1,
          authority: "isolated_fixture",
          operator,
        }),
      ).rejects.toMatchObject({ code: "stale_control" })
    })

    it("keeps a technical incumbent recovery in the original challenger arm with a bound request", async () => {
      const experiment =
        await prisma.recommendationPrecomputedExperiment.findUniqueOrThrow({
          where: { id: experimentId },
        })
      const routing = await readControlRouting(prisma)
      expect(routing).not.toBeNull()
      let browserDigest = ""
      for (let index = 0; index < 100; index += 1) {
        const candidate = index.toString(16).padStart(64, "0")
        if (
          chooseExperimentArm({
            unitDigest: precomputedBrowserUnitDigest(experimentId, candidate),
            configurationDigest: experiment.configurationDigest,
            challengerProbability: 0.5,
          }) === "CHALLENGER"
        ) {
          browserDigest = candidate
          break
        }
      }
      expect(browserDigest).not.toBe("")
      await prisma.recommendationPrecomputedSource.update({
        where: {
          generationId_sourceVideoId: { generationId, sourceVideoId },
        },
        data: { status: "failed", failureCode: "technical_fixture_failure" },
      })
      const requestId = randomUUID()
      const recovered = vi.spyOn(
        incumbentService,
        "createRecommendationDeliveryService",
      )
      recovered.mockReturnValue({
        deliver: async () => {
          await prisma.recommendationRequest.create({
            data: {
              id: requestId,
              contractVersion: "semantic-recommendation-delivery-v1",
              surfaceVersion: "watch-below-player-v1",
              manifestId: routing!.manifest.id,
              strategyVersion: routing!.manifest.strategyVersion,
              classifierVersion: "legacy-position-v0",
              sessionDigest: "f".repeat(64),
              seedMediaId: sourceVideoId,
              locale: "en",
              expectedItemCount: 0,
              state: "ISSUED",
              result: "SERVED",
              deliveryJti: randomUUID(),
              signingKid: "public-native-test",
              issuedAt: new Date(),
              expiresAt: new Date(Date.now() + 29 * 86_400_000),
            },
          })
          return {
            contractVersion: "semantic-recommendation-delivery-v1",
            surfaceVersion: "watch-below-player-v1",
            strategyVersion: routing!.manifest.strategyVersion,
            classifierVersion: "legacy-position-v0",
            requestId,
            result: "served",
            reason: null,
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            items: [],
          }
        },
      } as unknown as ReturnType<
        typeof incumbentService.createRecommendationDeliveryService
      >)
      try {
        const input = { ...visitInput(), browserDigest }
        const result = await deliverPrecomputedPublicWatchVisit(
          prisma,
          input,
          tokenService,
        )
        expect(result).toMatchObject({
          disposition: "ab",
          status: "eligible",
          arm: "challenger",
          measurementStatus: "recorded",
          delivery: { result: "served", requestId },
        })
        expect(
          await prisma.recommendationPrecomputedVisit.findUniqueOrThrow({
            where: { id: input.visitId },
          }),
        ).toMatchObject({
          arm: "CHALLENGER",
          deliveryResult: "served",
          actualStrategy: routing!.manifest.strategyVersion,
          deliveryRequestId: requestId,
          fallbackReason: "source_incomplete",
        })
        expect(
          await prisma.recommendationPrecomputedVisitRequest.findUnique({
            where: { requestId },
          }),
        ).toMatchObject({ visitId: input.visitId })
      } finally {
        recovered.mockRestore()
        await prisma.recommendationPrecomputedSource.update({
          where: {
            generationId_sourceVideoId: { generationId, sourceVideoId },
          },
          data: { status: "complete", failureCode: null },
        })
      }
    })

    it("does not admit a denominator after final evaluation wins the evidence fence", async () => {
      const input = visitInput()
      const policy =
        await prisma.recommendationPrecomputedCtrPolicy.findUniqueOrThrow({
          where: { experimentId },
        })
      await admin.query("BEGIN")
      try {
        await admin.query(
          "SELECT pg_advisory_xact_lock(5902573, hashtext($1))",
          [experimentId],
        )
        const pending = deliverPrecomputedPublicWatchVisit(
          prisma,
          input,
          tokenService,
        )
        await new Promise((resolve) => setTimeout(resolve, 100))
        expect(
          await prisma.recommendationPrecomputedVisit.count({
            where: { id: input.visitId },
          }),
        ).toBe(0)
        await admin.query(
          `INSERT INTO recommendation_precomputed_ctr_report
          (experiment_id, revision, policy_digest, evidence_digest, as_of, is_final, result)
          VALUES ($1, 1, $2, $3, now(), true, '{}')`,
          [experimentId, policy.settingsDigest, "a".repeat(64)],
        )
        await admin.query("COMMIT")
        expect(await pending).toMatchObject({
          disposition: "ab",
          status: "unavailable",
          reason: "cohort_finalized",
          measurementStatus: "not_applicable",
        })
      } finally {
        await admin.query("ROLLBACK").catch(() => undefined)
      }
      expect(
        await prisma.recommendationPrecomputedVisit.count({
          where: { id: input.visitId },
        }),
      ).toBe(0)
    })

    it("rolls back by exact target and preserves the retained configuration past expiry", async () => {
      await expect(
        rollbackPrecomputedPublicExperiment(prisma, {
          expectedControlVersion: 2,
          expectedExperimentId: experimentId,
          expectedGenerationId: "wrong-generation",
          expectedReportRevision: null,
          operator,
          reasonCode: "operator_review",
        }),
      ).rejects.toMatchObject({ code: "incompatible_target" })
      const rolledBack = await rollbackPrecomputedPublicExperiment(prisma, {
        expectedControlVersion: 2,
        expectedExperimentId: experimentId,
        expectedGenerationId: generationId,
        expectedReportRevision: null,
        operator,
        reasonCode: "operator_review",
      })
      expect(rolledBack).toMatchObject({
        mode: "incumbent",
        version: 3,
        retainedExperimentId: experimentId,
      })
      expect(
        await prisma.$transaction((tx) =>
          purgeExpiredPrecomputedVisitRoots(
            tx,
            new Date(Date.now() + 400 * 86_400_000),
            100,
          ),
        ),
      ).toMatchObject({ experimentsDeleted: 0 })
      expect(
        await prisma.recommendationPrecomputedExperiment.findUnique({
          where: { id: experimentId },
        }),
      ).not.toBeNull()
    })

    it("refuses saved delivery from a promoted pointer with changed frozen routing", async () => {
      await prisma.recommendationPrecomputedPublicControl.update({
        where: { id: "precomputed-watch-public-control" },
        data: {
          version: { increment: 1 },
          mode: "promoted",
          activeExperimentId: experimentId,
          retainedExperimentId: null,
          authority: "isolated_fixture",
          reportRevision: 1,
          reportEvidenceDigest: "a".repeat(64),
        },
      })
      await prisma.recommendationServingControl.update({
        where: { id: "recommendation-serving-control" },
        data: { version: { increment: 1 } },
      })
      const result = await deliverPrecomputedPublicWatchVisit(
        prisma,
        visitInput(),
        tokenService,
      )
      expect(result).toMatchObject({
        disposition: "promoted",
        status: "unavailable",
        reason: "frozen_configuration_unavailable",
        measurementStatus: "not_applicable",
      })
      expect(result.delivery?.strategyVersion).not.toBe(
        "precomputed-watch-preview-v1",
      )
      expect(
        await prisma.recommendationRequest.count({
          where: { strategyVersion: "precomputed-watch-preview-v1" },
        }),
      ).toBe(0)
    })

    it("releases a rollback pin only after the review horizon and permits bounded cleanup", async () => {
      const restored = await rollbackPrecomputedPublicExperiment(prisma, {
        expectedControlVersion: 4,
        expectedExperimentId: experimentId,
        expectedGenerationId: generationId,
        expectedReportRevision: 1,
        expectedReportEvidenceDigest: "a".repeat(64),
        reasonCode: "retirement_review",
        operator,
      })
      expect(restored).toMatchObject({
        mode: "incumbent",
        version: 5,
        retainedExperimentId: experimentId,
      })
      await expect(
        releaseRetainedPrecomputedPublicExperiment(prisma, {
          expectedControlVersion: 5,
          expectedExperimentId: experimentId,
          reasonCode: "retention_horizon_complete",
          operator,
        }),
      ).rejects.toMatchObject({ code: "incompatible_target" })
      const released = await releaseRetainedPrecomputedPublicExperiment(
        prisma,
        {
          expectedControlVersion: 5,
          expectedExperimentId: experimentId,
          reasonCode: "retention_horizon_complete",
          operator,
          now: new Date(Date.now() + 400 * 86_400_000),
        },
      )
      expect(released).toMatchObject({
        mode: "incumbent",
        version: 6,
        retainedExperimentId: null,
      })
      const cleaned = await prisma.$transaction((tx) =>
        purgeExpiredPrecomputedVisitRoots(
          tx,
          new Date(Date.now() + 401 * 86_400_000),
          100,
        ),
      )
      expect(cleaned).toMatchObject({ experimentsDeleted: 1 })
      expect(
        await prisma.recommendationPrecomputedExperiment.findUnique({
          where: { id: experimentId },
        }),
      ).toBeNull()
    })
  },
)
