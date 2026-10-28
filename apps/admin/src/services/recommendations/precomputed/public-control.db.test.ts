import { randomUUID } from "node:crypto"
import { PrismaClient, Prisma } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { env } from "@/config/env"
import type { RecommendationEventEnvelope } from "../event-history/envelope"
const exportedHistory = vi.hoisted(() => ({
  events: [] as RecommendationEventEnvelope[],
}))
vi.mock("../event-history/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../event-history/runtime")>()),
  dispatchPreparedRecommendationEventsAfterCommit: (
    family: string,
    prepare: () => RecommendationEventEnvelope[],
  ) => {
    if (family === "experiment-visit") exportedHistory.events.push(...prepare())
  },
}))
import { currentAdminMigrationSql } from "../current-schema.test-fixture"
import {
  assertIsolatedPrecomputedControlFixture,
  loadPrecomputedPublicControl,
  preparePrecomputedPublicExperiment,
  promotePrecomputedPublicExperiment,
  releaseRetainedPrecomputedPublicExperiment,
  rollbackPrecomputedPublicExperiment,
  startPrecomputedPublicExperiment,
  startSavedPrecomputedPublicExperiment,
} from "./public-control"
import { readControlRouting } from "./visit-admission"
import { readPrecomputedCtrMeasurementAt } from "./compact-accounting"
import { rawCtrVisitSql, type RawCtrVisit } from "./ctr-evidence"
import { purgeExpiredPrecomputedVisitRoots } from "./visit-retention"
import { deliverPrecomputedPublicWatchVisit } from "./public-watch"
import * as incumbentService from "../delivery.service"
import { chooseExperimentArm } from "../experiment/assignment"
import { precomputedBrowserUnitDigest } from "./visit-identity"
import { oneUtcCalendarMonthAfter } from "./cohort-window"
import { recommendationManifestDigest } from "../promotion/manifest"
import { RecommendationEpisodeService } from "../episode.service"
import {
  createRecommendationTokenService,
  parseRecommendationKeyring,
} from "../token.service"
import {
  PRECOMPUTED_CTR_METHOD,
  precomputedCtrPolicyDigest,
  evaluatePublicPrecomputedCtr,
} from "./ctr-report"
import {
  PRECOMPUTED_VISIT_ASSIGNMENT_POLICY,
  PRECOMPUTED_VISIT_DELIVERY_POLICY,
} from "./visit-admission"

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "manual precomputed public control on PostgreSQL",
  () => {
    let prisma: PrismaClient
    let adapterPrisma: PrismaClient
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
      prisma = new PrismaClient<Prisma.PrismaClientOptions>({
        datasources: { db: { url: url.toString() } },
      })
      adapterPrisma = new PrismaClient<Prisma.PrismaClientOptions>({
        adapter: new PrismaPg(
          {
            connectionString: env.DATABASE_URL,
            options: `-c search_path=${schema},public`,
          },
          { schema },
        ),
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
      await adapterPrisma?.$disconnect()
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

    it("requires exactly one UTC calendar month, clamping a short target month", async () => {
      const routing = await readControlRouting(prisma)
      expect(routing).not.toBeNull()
      const startsAt = new Date("2027-01-31T13:45:30.123Z")
      const prepare = (endsAt: Date) =>
        preparePrecomputedPublicExperiment(prisma, {
          id: `calendar-month-${randomUUID()}`,
          generationId,
          startsAt,
          endsAt,
          expectedControlRoutingDigest: routing!.routingDigest,
          expectedSourceSetDigest: "b".repeat(64),
          policySettings,
          authority: "isolated_fixture",
          operator,
        })
      await expect(
        prepare(new Date("2027-02-27T13:45:30.123Z")),
      ).rejects.toMatchObject({ code: "invalid_input" })
      const prepared = await prepare(new Date("2027-02-28T13:45:30.123Z"))
      expect(prepared.endsAt.toISOString()).toBe("2027-02-28T13:45:30.123Z")
      await prisma.recommendationPrecomputedExperiment.update({
        where: { id: prepared.id },
        data: { state: "closed" },
      })
    })

    it("freezes a prepared cohort and policy without selecting public traffic", async () => {
      const routing = await readControlRouting(prisma)
      expect(routing).not.toBeNull()
      const now = Date.now()
      const startsAt = new Date(now - 60_000)
      // Exercise the same PrismaPg adapter used by the production Admin app.
      await assertIsolatedPrecomputedControlFixture(adapterPrisma)
      const prepared = await preparePrecomputedPublicExperiment(adapterPrisma, {
        id: experimentId,
        generationId,
        startsAt,
        endsAt: oneUtcCalendarMonthAfter(startsAt),
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

    it("returns incumbent serving at the month cutoff and leaves the cohort pending manual review", async () => {
      const experiment =
        await prisma.recommendationPrecomputedExperiment.findUniqueOrThrow({
          where: { id: experimentId },
        })
      const beforeCutoff = new Date(experiment.endsAt.getTime() - 1)
      expect(
        await loadPrecomputedPublicControl(prisma, beforeCutoff),
      ).toMatchObject({ mode: "ab", pendingManualReview: null })
      expect(
        await loadPrecomputedPublicControl(prisma, experiment.endsAt),
      ).toMatchObject({
        mode: "incumbent",
        pendingManualReview: {
          experimentId,
          generationId,
          endsAt: experiment.endsAt.toISOString(),
        },
      })
      const input = { ...visitInput(), now: experiment.endsAt }
      exportedHistory.events.length = 0
      const routing = await readControlRouting(prisma)
      expect(routing).not.toBeNull()
      const result = await deliverPrecomputedPublicWatchVisit(
        prisma,
        input,
        tokenService,
      )
      expect(result).toMatchObject({
        disposition: "inactive",
        status: "not_applicable",
        experimentId: null,
        arm: null,
        delivery: { strategyVersion: routing!.manifest.strategyVersion },
      })
      expect(
        await prisma.recommendationPrecomputedVisit.count({
          where: { id: input.visitId },
        }),
      ).toBe(0)
      expect(
        exportedHistory.events.filter(
          (event) => event.logicalId === `ab-visit:${input.visitId}`,
        ),
      ).toEqual([])
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
      const afterRollback = { ...visitInput() }
      expect(
        await deliverPrecomputedPublicWatchVisit(
          prisma,
          afterRollback,
          tokenService,
        ),
      ).toMatchObject({ disposition: "inactive" })
      expect(
        exportedHistory.events.filter(
          (event) => event.logicalId === `ab-visit:${afterRollback.visitId}`,
        ),
      ).toEqual([])
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

    it("launches, measures and rolls back an ordinary editorial import without qualification", async () => {
      const editorialId = `editorial-${randomUUID()}`
      const publicId = `public-browser-${randomUUID()}`
      const linkedSource = `linked-source-${randomUUID()}`
      await prisma.video.create({
        data: { id: linkedSource, coreId: linkedSource, slug: linkedSource },
      })
      await prisma.videoLocale.create({
        data: {
          id: `locale-${linkedSource}`,
          videoId: linkedSource,
          locale: "en",
          title: "Linked source",
          status: "PUBLISHED",
        },
      })
      await prisma.muxVideo.create({
        data: { id: `mux-${linkedSource}`, playbackId: linkedSource },
      })
      await prisma.videoDub.create({
        data: {
          id: `dub-${linkedSource}`,
          coreId: `dub-${linkedSource}`,
          videoId: linkedSource,
          languageId: "public-english",
          muxVideoId: `mux-${linkedSource}`,
          published: true,
        },
      })
      await prisma.recommendationPrecomputedGeneration.create({
        data: {
          id: editorialId,
          modelId: "codex-editorial-session",
          inputMode: "content_only",
          promptVersion: "editorial-v1",
          inputDigest: "a".repeat(64),
          sourceSetDigest: "b".repeat(64),
          inputCutoff: new Date(),
          expectedSourceCount: 2,
          protocolVersion: 1,
          status: "complete",
          completedAt: new Date(),
        },
      })
      await prisma.recommendationPrecomputedSource.create({
        data: {
          generationId: editorialId,
          sourceVideoId,
          payload: [],
          acceptedCount: 0,
          submissionDigest: "c".repeat(64),
        },
      })
      await prisma.recommendationPrecomputedSource.create({
        data: {
          generationId: editorialId,
          sourceVideoId: linkedSource,
          acceptedCount: 1,
          submissionDigest: "d".repeat(64),
          payload: [
            {
              targetVideoId: sourceVideoId,
              kind: "direct",
              rank: 1,
              relationship: "connected",
              reasonEnglish: "A related story based on metadata.",
              evidence: { basis: "metadata", fields: ["title"] },
            },
          ],
        },
      })
      const before =
        await prisma.recommendationPrecomputedGeneration.findUniqueOrThrow({
          where: { id: editorialId },
        })
      const pointer = await loadPrecomputedPublicControl(prisma)
      const input = {
        experimentId: publicId,
        generationId: editorialId,
        expectedControlVersion: pointer.version,
        operator,
      }
      const started = await startSavedPrecomputedPublicExperiment(prisma, input)
      expect(started).toMatchObject({
        mode: "ab",
        experimentId: publicId,
        generationId: editorialId,
        authority: "public_browser",
        version: pointer.version + 1,
      })
      expect(
        await startSavedPrecomputedPublicExperiment(prisma, input),
      ).toEqual(started)
      await expect(
        startSavedPrecomputedPublicExperiment(prisma, {
          ...input,
          experimentId: "another-cohort",
        }),
      ).rejects.toMatchObject({ code: "stale_control" })
      expect(
        await prisma.recommendationPrecomputedGeneration.findUniqueOrThrow({
          where: { id: editorialId },
        }),
      ).toEqual(before)
      const frozen =
        await prisma.recommendationPrecomputedExperiment.findUniqueOrThrow({
          where: { id: publicId },
          include: { ctrPolicy: true },
        })
      expect(frozen.liveEvidence).toBeNull()
      expect(frozen.ctrPolicy?.authority).toBe("public_observed")
      const seen = new Set<string>()
      let challengerBrowser = ""
      for (let index = 0; index < 100 && seen.size < 2; index += 1) {
        const browserDigest = index.toString(16).padStart(64, "0")
        const arm = chooseExperimentArm({
          unitDigest: precomputedBrowserUnitDigest(publicId, browserDigest),
          configurationDigest: frozen.configurationDigest,
          challengerProbability: 0.5,
        })
        if (seen.has(arm)) continue
        const visit = { ...visitInput(), browserDigest }
        exportedHistory.events.length = 0
        const delivered = await deliverPrecomputedPublicWatchVisit(
          prisma,
          visit,
          tokenService,
        )
        expect(delivered).toMatchObject({
          disposition: "ab",
          status: "eligible",
          experimentId: publicId,
          qualification: "unverified_browser",
          measurementStatus: "recorded",
          arm: arm.toLowerCase(),
        })
        const committedVisit =
          await prisma.recommendationPrecomputedVisit.findUniqueOrThrow({
            where: { id: visit.visitId },
          })
        expect(committedVisit.historyRevision).toBeGreaterThanOrEqual(1)
        expect(committedVisit.historyAcceptedAt).not.toBeNull()
        expect(
          exportedHistory.events
            .filter((event) => event.logicalId === `ab-visit:${visit.visitId}`)
            .map((event) => event.revision),
        ).toEqual([1, 2])
        if (arm === "CHALLENGER") {
          expect(delivered.delivery?.result).toBe("empty")
          challengerBrowser = browserDigest
        }
        const replay = await deliverPrecomputedPublicWatchVisit(
          prisma,
          visit,
          tokenService,
        )
        expect(replay.arm).toBe(delivered.arm)
        const replayedVisit =
          await prisma.recommendationPrecomputedVisit.findUniqueOrThrow({
            where: { id: visit.visitId },
          })
        expect(replayedVisit.historyRevision).toBe(
          committedVisit.historyRevision,
        )
        expect(
          exportedHistory.events
            .filter((event) => event.logicalId === `ab-visit:${visit.visitId}`)
            .map((event) => event.revision),
        ).toEqual([1, 2])
        seen.add(arm)
      }
      expect(seen.size).toBe(2)
      const keyring = parseRecommendationKeyring(
        JSON.stringify({
          keys: [
            {
              kid: "public-click-test",
              status: "active",
              key: Buffer.alloc(32, 19).toString("base64url"),
            },
          ],
        }),
      )
      const tokens = {
        activeKid: keyring.active.kid,
        ...createRecommendationTokenService({
          keyring,
          readRevokedKids: async () => [],
        }),
      }
      const clickableInput = {
        ...visitInput(),
        seedMediaId: linkedSource,
        browserDigest: challengerBrowser,
      }
      const clickable = await deliverPrecomputedPublicWatchVisit(
        prisma,
        clickableInput,
        tokens,
      )
      expect(clickable).toMatchObject({
        arm: "challenger",
        measurementStatus: "recorded",
        delivery: { result: "served" },
      })
      const item = clickable.delivery!.items[0]!
      const selectionInput = {
        caller,
        contractVersion: "recommendation-evidence-v1",
        capability: item.capability,
        requestId: clickable.delivery!.requestId!,
        itemId: item.id,
        sessionDigest: "f".repeat(64),
        browserDigest: challengerBrowser,
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        claimNonce: randomUUID(),
      }
      const episode = new RecommendationEpisodeService({
        prisma,
        tokenService: tokens,
      })
      expect((await episode.select(selectionInput)).status).toBe("accepted")
      expect((await episode.select(selectionInput)).status).toBe("replay")
      if (env.RECOMMENDATION_PRECOMPUTED_COMPACT_MEASUREMENT_ENABLED === "1") {
        const asOf = new Date()
        const [native] = await prisma.$queryRaw<RawCtrVisit[]>(
          rawCtrVisitSql(
            Prisma.sql`v.id = ${clickableInput.visitId}::uuid`,
            asOf,
          ),
        )
        const shadow = await readPrecomputedCtrMeasurementAt(
          prisma,
          clickableInput.visitId,
          asOf,
        )
        expect(native.accepted_selections).toBe(1n)
        expect(shadow?.summary).toMatchObject({
          accepted_selections: native.accepted_selections.toString(),
          qualified_impressions: native.qualified_impressions.toString(),
          claimed_playbacks: native.claimed_playbacks.toString(),
        })
      }
      for (const trafficCategory of ["declared_crawler", "unknown"] as const) {
        const excluded = { ...visitInput(), trafficCategory }
        expect(
          await deliverPrecomputedPublicWatchVisit(
            prisma,
            excluded,
            tokenService,
          ),
        ).toMatchObject({ status: "excluded" })
        expect(
          await prisma.recommendationPrecomputedVisit.count({
            where: { id: excluded.visitId },
          }),
        ).toBe(0)
        expect(
          exportedHistory.events.filter(
            (event) => event.logicalId === `ab-visit:${excluded.visitId}`,
          ),
        ).toEqual([])
      }
      const report = await evaluatePublicPrecomputedCtr(prisma, {
        experimentId: publicId,
        operator,
        now: new Date(frozen.endsAt.getTime() + 24 * 3_600_000),
      })
      expect(report).toMatchObject({
        status: "available",
        report: {
          evidenceBasis: "public_observed",
          isFinal: true,
          policy: { authority: "public_observed" },
          byArm: {
            control: { eligibleVisits: 1 },
            challenger: {
              eligibleVisits: 2,
              clickedVisits: 1,
              acceptedSelections: 1,
              emptyVisits: 1,
            },
          },
          measurementHealth: {
            botEligibility: "unverified",
            trackingLoss: "unobservable",
          },
        },
      })
      if (report.status === "available") {
        expect(report.report.reasons).not.toContain(
          "end_to_end_client_loss_unverified",
        )
        expect(report.report.reasons).not.toContain("numeric_policy_not_agreed")
        expect(report.report.outcome).toBe("inconclusive")
      }
      const stopped = await rollbackPrecomputedPublicExperiment(prisma, {
        expectedControlVersion: started.version,
        expectedExperimentId: publicId,
        expectedGenerationId: editorialId,
        expectedReportRevision: null,
        operator,
        reasonCode: "operator_rollback",
      })
      expect(stopped).toMatchObject({
        mode: "incumbent",
        retainedExperimentId: publicId,
      })
      const after = await deliverPrecomputedPublicWatchVisit(
        prisma,
        visitInput(),
        tokenService,
      )
      expect(after.disposition).toBe("inactive")
    })

    it("permits manual promotion of a clear observed public result without calibration", async () => {
      const id = `observed-winner-${randomUUID()}`
      const routing = await readControlRouting(prisma)
      const pointer = await loadPrecomputedPublicControl(prisma)
      const startsAt = new Date(Date.now() - 60_000)
      const prepared = await preparePrecomputedPublicExperiment(prisma, {
        id,
        generationId,
        startsAt,
        endsAt: oneUtcCalendarMonthAfter(startsAt),
        expectedControlRoutingDigest: routing!.routingDigest,
        expectedSourceSetDigest: "b".repeat(64),
        policySettings,
        authority: "public_browser",
        operator,
      })
      const active = await startPrecomputedPublicExperiment(prisma, {
        experimentId: id,
        expectedConfigurationDigest: prepared.configurationDigest,
        expectedControlVersion: pointer.version,
        authority: "public_browser",
        operator,
      })
      // Synthetic archived browser counts exercise the real evaluator and
      // promotion boundary; no human/model/calibration receipt is supplied.
      for (const arm of ["CONTROL", "CHALLENGER"] as const) {
        const clicks = arm === "CONTROL" ? 10 : 30
        await prisma.recommendationPrecomputedCtrCluster.createMany({
          data: Array.from({ length: 50 }, (_, index) => ({
            experimentId: id,
            browserUnitDigest: `${arm === "CONTROL" ? "a" : "b"}${index.toString(16).padStart(63, "0")}`,
            arm,
            eligibleVisits: 1n,
            clickedVisits: index < clicks ? 1n : 0n,
          })),
        })
        await prisma.recommendationPrecomputedCtrTotals.create({
          data: {
            experimentId: id,
            arm: arm.toLowerCase(),
            eligibleVisits: 50n,
            clickedVisits: BigInt(clicks),
            acceptedSelections: BigInt(clicks),
            servedVisits: 50n,
          },
        })
      }
      const now = new Date(prepared.endsAt.getTime() + 24 * 3_600_000)
      const evaluated = await evaluatePublicPrecomputedCtr(prisma, {
        experimentId: id,
        operator,
        now,
      })
      expect(evaluated).toMatchObject({
        status: "available",
        report: {
          evidenceBasis: "public_observed",
          outcome: "challenger",
          reasons: [],
          isFinal: true,
        },
      })
      if (evaluated.status !== "available")
        throw new Error("Expected a public report")
      const savedReport =
        await prisma.recommendationPrecomputedCtrReport.findUniqueOrThrow({
          where: {
            experimentId_revision: {
              experimentId: id,
              revision: evaluated.report.revision,
            },
          },
        })
      const target = {
        expectedControlVersion: active.version,
        expectedExperimentId: id,
        expectedGenerationId: generationId,
        expectedReportRevision: evaluated.report.revision,
        expectedReportEvidenceDigest: savedReport.evidenceDigest,
        operator,
        now,
      }
      await expect(
        promotePrecomputedPublicExperiment(prisma, {
          ...target,
          expectedReportEvidenceDigest: "0".repeat(64),
        }),
      ).rejects.toMatchObject({ code: "incompatible_target" })
      const promoted = await promotePrecomputedPublicExperiment(prisma, target)
      expect(promoted).toMatchObject({
        mode: "promoted",
        authority: "public_browser",
        generationId,
      })
      await rollbackPrecomputedPublicExperiment(prisma, {
        ...target,
        expectedControlVersion: promoted.version,
        reasonCode: "operator_rollback",
      })
    })

    it("requires a verified Web receipt before admitting an active live A/B visit", async () => {
      const routing = await readControlRouting(prisma)
      expect(routing).not.toBeNull()
      const liveExperimentId = `live-proof-${randomUUID()}`
      const startsAt = new Date(Date.now() - 60_000)
      const endsAt = oneUtcCalendarMonthAfter(startsAt)
      await prisma.recommendationPrecomputedExperiment.create({
        data: {
          id: liveExperimentId,
          generationId,
          controlManifestId: routing!.manifest.id,
          challengerManifestId: "precomputed-watch-preview-v1",
          controlManifestDigest: recommendationManifestDigest(
            routing!.manifest,
          ),
          controlRoutingDigest: routing!.routingDigest,
          sourceSetDigest: "b".repeat(64),
          assignmentPolicyVersion: PRECOMPUTED_VISIT_ASSIGNMENT_POLICY,
          eligibilityPolicyVersion:
            "public-watch-turnstile-verified-browser-v1",
          deliveryPolicyVersion: PRECOMPUTED_VISIT_DELIVERY_POLICY,
          configurationDigest: "d".repeat(64),
          state: "public_ready",
          startsAt,
          endsAt,
          expiresAt: new Date(endsAt.getTime() + 365 * 86_400_000),
        },
      })
      await prisma.recommendationPrecomputedCtrPolicy.create({
        data: {
          experimentId: liveExperimentId,
          version: PRECOMPUTED_CTR_METHOD,
          method: PRECOMPUTED_CTR_METHOD,
          settings: policySettings,
          lateEventCutoffHours: policySettings.lateEventCutoffHours,
          settingsDigest: precomputedCtrPolicyDigest(policySettings),
          authority: "prelaunch_agreed",
        },
      })
      await prisma.recommendationPrecomputedPublicControl.update({
        where: { id: "precomputed-watch-public-control" },
        data: {
          version: { increment: 1 },
          mode: "ab",
          activeExperimentId: liveExperimentId,
          retainedExperimentId: null,
          authority: "live_verified",
        },
      })
      const input = visitInput()
      const result = await deliverPrecomputedPublicWatchVisit(
        prisma,
        input,
        tokenService,
      )
      expect(result).toMatchObject({
        disposition: "ab",
        status: "unavailable",
        visitId: input.visitId,
        reason: "verification_required",
        delivery: null,
      })
      expect(
        await prisma.recommendationPrecomputedVisit.count({
          where: { id: input.visitId },
        }),
      ).toBe(0)
    })
  },
)
