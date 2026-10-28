import { randomUUID } from "node:crypto"
import {
  Prisma,
  PrismaClient,
  RecommendationDeliveryResult,
  RecommendationExperimentArm,
  RecommendationRequestState,
  RecommendationEpisodeState,
} from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { RecommendationOutcomeService } from "../outcome.service"
import { RecommendationInternalStateError } from "../errors"
import { env } from "@/config/env"
import { currentAdminMigrationSql } from "../current-schema.test-fixture"
import { purgeExpiredPrecomputedVisitRoots } from "./visit-retention"
import {
  capturePrecomputedCtrMeasurement,
  qualifyCompactCtrCoverageAt,
  readCompactCtrVisitAt,
  readPrecomputedCtrMeasurementAt,
} from "./compact-accounting"
import { rawCtrVisitSql, type RawCtrVisit } from "./ctr-evidence"
import {
  declareFixturePrecomputedCtrPolicy,
  evaluatePrivatePrecomputedCtr,
} from "./ctr-report"

const operator = { id: "engagement-fixture-operator", role: "ADMIN" as const }
const days = (n: number) => n * 86_400_000

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "precomputed playback engagement on PostgreSQL",
  () => {
    const schema = `precomputed_engagement_${Date.now()}_${Math.random().toString(36).slice(2)}`
    let admin: Client
    let prisma: PrismaClient
    let experimentId: string
    let now: Date
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
      await prisma.recommendationPrecomputedGeneration.create({
        data: {
          id: schema,
          modelId: "editorial-fixture",
          promptVersion: "fixture",
          inputDigest: "a".repeat(64),
          sourceSetDigest: "b".repeat(64),
          inputCutoff: new Date(),
          expectedSourceCount: 0,
          status: "complete",
          completedAt: new Date(),
        },
      })
    }, 180_000)
    beforeEach(async () => {
      now = new Date()
      await prisma.recommendationPrecomputedExperiment.updateMany({
        data: { state: "closed" },
      })
      experimentId = randomUUID()
      await prisma.recommendationPrecomputedExperiment.create({
        data: {
          id: experimentId,
          generationId: schema,
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
    })
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

    async function playback(
      delivered: Awaited<ReturnType<typeof selection>>,
      options: {
        qualified?: boolean
        milliseconds?: number
        coverage?: string
        noOutcome?: boolean
        discoverySource?: string
        conflict?: boolean
        claimedAt?: Date
      } = {},
    ) {
      const selected = await prisma.recommendationSelection.findUniqueOrThrow({
        where: { itemId: delivered.itemId },
      })
      const at =
        options.claimedAt ?? new Date(selected.receivedAt.getTime() + 1)
      const episode = await prisma.recommendationPlaybackEpisode.create({
        data: {
          id: randomUUID(),
          requestId:
            options.discoverySource === "direct" ? null : delivered.requestId,
          itemId:
            options.discoverySource === "direct" ? null : delivered.itemId,
          selectionId:
            options.discoverySource === "direct" ? null : selected.id,
          discoverySource: options.discoverySource ?? "recommendation",
          mediaId: "target-video",
          sessionDigest: "1".repeat(64),
          state: RecommendationEpisodeState.FINALIZED,
          claimedAt: at,
          activeUntil: at,
          hardUntil: new Date(at.getTime() + 1),
          finalizedAt: at,
          expiresAt: delivered.expiry,
          conflictCount: options.conflict ? 1 : 0,
        },
      })
      if (!options.noOutcome)
        await outcome(episode, {
          qualified: options.qualified ?? true,
          milliseconds: options.milliseconds ?? 30_000,
          coverage: options.coverage ?? "complete",
          at: new Date(at.getTime() + 1),
        })
      return episode
    }

    async function outcome(
      episode: Awaited<
        ReturnType<typeof prisma.recommendationPlaybackEpisode.create>
      >,
      options: {
        qualified: boolean
        milliseconds: number
        coverage: string
        at: Date
        revision?: number
        classifier?: string
      },
    ) {
      return prisma.recommendationOutcomeRevision.create({
        data: {
          id: randomUUID(),
          requestId: episode.requestId,
          itemId: episode.itemId,
          episodeId: episode.id,
          classifierVersion: options.classifier ?? "active-watch-proxy-v1",
          factWatermark: options.revision ?? 1,
          inputDigest: randomUUID().replaceAll("-", "").padEnd(64, "0"),
          revision: options.revision ?? 1,
          qualifiedView: options.qualified,
          viewQualityWeight:
            options.classifier === "legacy-position-v0"
              ? null
              : Math.min(1, options.milliseconds / 60_000),
          viewQualityWeightReason:
            options.classifier === "legacy-position-v0"
              ? "continuous_weight_not_available"
              : "active_fraction_of_duration",
          activePlaybackMilliseconds: options.milliseconds,
          durationSeconds: 60,
          durationCohort: "short",
          activeCoverage: options.coverage,
          learningEligible: false,
          generation: 1,
          expiresAt: episode.expiresAt,
          createdAt: options.at,
        },
      })
    }

    async function freshVisit(
      arm: RecommendationExperimentArm = RecommendationExperimentArm.CONTROL,
    ) {
      return visit({
        arm,
        browser: randomUUID().replaceAll("-", "").padEnd(64, "0"),
        createdAt: new Date(now.getTime() - days(1)),
        expiresAt: new Date(now.getTime() + days(1)),
      })
    }

    async function report() {
      const read = await evaluatePrivatePrecomputedCtr(prisma, {
        experimentId,
        operator,
        now,
      })
      expect(read.status).toBe("available")
      if (read.status !== "available") throw new Error(read.reason)
      return read.report
    }

    it("connects exact clicked playback in both arms, counts an engaged visit once, and sums distinct episodes", async () => {
      const control = await freshVisit()
      const challenger = await freshVisit(
        RecommendationExperimentArm.CHALLENGER,
      )
      await freshVisit(RecommendationExperimentArm.CHALLENGER) // Empty delivery remains in denominator.
      const at = new Date(now.getTime() - 60_000)
      const first = await selection(control, at)
      await playback(first)
      await playback(await selection(control, at), { milliseconds: 60_000 })
      await playback(await selection(challenger, at), {
        milliseconds: 45_000,
        coverage: "partial",
      })
      await prisma.recommendationImpression.create({
        data: {
          requestId: first.requestId,
          itemId: first.itemId,
          capabilityJti: randomUUID(),
          eventId: randomUUID(),
          payloadDigest: "a".repeat(64),
          visibilityPolicy: "watch-below-player-v1",
          occurredAt: at,
          receivedAt: at,
          expiresAt: first.expiry,
        },
      })
      const result = await report()
      expect(result.byArm.control).toMatchObject({
        eligibleVisits: 1,
        clickedVisits: 1,
        acceptedSelections: 2,
      })
      expect(result.engagement?.byArm.control).toMatchObject({
        engagedVisits: 1,
        engagedViewRate: 1,
        activeWatchMinutes: 1.5,
        activeWatchMinutesPer100Visits: 150,
        claimedPlaybacks: 2,
        observedPlaybacks: 2,
        activeCoverageRate: 1,
      })
      expect(result.engagement?.byArm.challenger).toMatchObject({
        engagedVisits: 1,
        engagedViewRate: 0.5,
        activeWatchMinutesPer100Visits: 37.5,
        partialPlaybacks: 1,
        completeCoverageRate: 0,
      })
    })

    it.skipIf(
      env.RECOMMENDATION_PRECOMPUTED_COMPACT_MEASUREMENT_ENABLED !== "1",
    )(
      "orders serialized compact revisions even when an earlier callback clock arrives last",
      async () => {
        const id = await freshVisit()
        await prisma.$transaction((tx) =>
          capturePrecomputedCtrMeasurement(tx, id, now),
        )
        await prisma.$transaction((tx) =>
          capturePrecomputedCtrMeasurement(
            tx,
            id,
            new Date(now.getTime() - 1_000),
          ),
        )
        expect(
          await readPrecomputedCtrMeasurementAt(prisma, id, now),
        ).toMatchObject({ revision: 2, acceptedAt: now })
        expect(
          await readPrecomputedCtrMeasurementAt(
            prisma,
            id,
            new Date(now.getTime() - 1_000),
          ),
        ).toBeNull()
      },
    )

    it.skipIf(
      env.RECOMMENDATION_PRECOMPUTED_COMPACT_MEASUREMENT_ENABLED !== "1",
    )(
      "keeps a missing legacy snapshot distinct from zero and rejects corrupt compact state",
      async () => {
        const id = await freshVisit()
        const beforeCheckpoint = new Date(now.getTime() - 1)
        expect(
          await qualifyCompactCtrCoverageAt(prisma, experimentId, now),
        ).toMatchObject({
          status: "unavailable",
          liveVisits: 1n,
          missingSnapshots: 1n,
        })
        expect(await readCompactCtrVisitAt(prisma, id, now)).toBeNull()
        await prisma.$transaction((tx) =>
          capturePrecomputedCtrMeasurement(tx, id, now),
        )
        expect(
          await qualifyCompactCtrCoverageAt(
            prisma,
            experimentId,
            beforeCheckpoint,
          ),
        ).toMatchObject({ status: "unavailable", missingSnapshots: 1n })
        expect(
          await qualifyCompactCtrCoverageAt(prisma, experimentId, now),
        ).toMatchObject({ status: "available", missingSnapshots: 0n })
        await prisma.recommendationPrecomputedCtrMeasurement.update({
          where: { visitId_revision: { visitId: id, revision: 1 } },
          data: { summary: { pending_playbacks: "0" } },
        })
        await expect(readCompactCtrVisitAt(prisma, id, now)).rejects.toThrow(
          "precomputed_compact_summary_invalid",
        )
        await expect(
          readCompactCtrVisitAt(prisma, id, now),
        ).rejects.toBeInstanceOf(RecommendationInternalStateError)
      },
    )

    it.skipIf(
      env.RECOMMENDATION_PRECOMPUTED_COMPACT_MEASUREMENT_ENABLED !== "1",
    )(
      "keeps corrected engagement snapshots at their original report cutoffs",
      async () => {
        const id = await freshVisit()
        const episode = await playback(
          await selection(id, new Date(now.getTime() - 60_000)),
        )
        const beforeCorrection = new Date(now.getTime() - 30_000)
        await prisma.$transaction((tx) =>
          capturePrecomputedCtrMeasurement(tx, id, beforeCorrection),
        )
        await outcome(episode, {
          qualified: false,
          milliseconds: 0,
          coverage: "complete",
          revision: 2,
          at: new Date(now.getTime() - 20_000),
        })
        const afterCorrection = new Date(now.getTime() - 10_000)
        await prisma.$transaction((tx) =>
          capturePrecomputedCtrMeasurement(tx, id, afterCorrection),
        )
        for (const [cutoff, revision] of [
          [beforeCorrection, 1],
          [afterCorrection, 2],
        ] as const) {
          const [native] = await prisma.$queryRaw<RawCtrVisit[]>(
            rawCtrVisitSql(Prisma.sql`v.id = ${id}::uuid`, cutoff),
          )
          const shadow = await readPrecomputedCtrMeasurementAt(
            prisma,
            id,
            cutoff,
          )
          expect(shadow?.revision).toBe(revision)
          expect(shadow?.summary).toMatchObject({
            qualified_playbacks: native.qualified_playbacks.toString(),
            active_playback_milliseconds:
              native.active_playback_milliseconds.toString(),
          })
          expect(await readCompactCtrVisitAt(prisma, id, cutoff)).toEqual(
            native,
          )
        }
      },
    )

    it("uses the latest revision before qualification, excludes future outcomes, and does not count other classifiers", async () => {
      const id = await freshVisit()
      const episode = await playback(
        await selection(id, new Date(now.getTime() - 60_000)),
      )
      await outcome(episode, {
        qualified: false,
        milliseconds: 1_000,
        coverage: "complete",
        at: new Date(now.getTime() - 1),
        revision: 2,
      })
      await outcome(episode, {
        qualified: true,
        milliseconds: 60_000,
        coverage: "complete",
        at: new Date(now.getTime() + 1),
        revision: 3,
      })
      await outcome(episode, {
        qualified: true,
        milliseconds: 60_000,
        coverage: "complete",
        at: new Date(now.getTime() - 1),
        classifier: "legacy-position-v0",
      })
      if (env.RECOMMENDATION_PRECOMPUTED_COMPACT_MEASUREMENT_ENABLED === "1") {
        await prisma.$transaction((tx) =>
          capturePrecomputedCtrMeasurement(tx, id, now),
        )
        const [native] = await prisma.$queryRaw<RawCtrVisit[]>(
          rawCtrVisitSql(Prisma.sql`v.id = ${id}::uuid`, now),
        )
        expect(await readCompactCtrVisitAt(prisma, id, now)).toEqual(native)
      }
      const engagement = (await report()).engagement?.byArm.control
      expect(engagement).toMatchObject({ engagedVisits: 0, engagedViewRate: 0 })
      expect(engagement?.activeWatchMinutes).toBeCloseTo(1 / 60)
    })

    it("shows missing coverage and unclaimed selections without inventing engagement", async () => {
      const id = await freshVisit()
      const at = new Date(now.getTime() - 60_000)
      await playback(await selection(id, at), { noOutcome: true })
      await playback(await selection(id, at), {
        coverage: "missing",
        milliseconds: 0,
        qualified: false,
      })
      await selection(id, at)
      expect((await report()).engagement?.byArm.control).toMatchObject({
        claimedPlaybacks: 2,
        observedPlaybacks: 0,
        missingOutcomePlaybacks: 1,
        missingCoveragePlaybacks: 1,
        playbackClaimRate: 2 / 3,
        activeCoverageRate: 0,
        engagedViewRate: null,
        activeWatchMinutesPer100Visits: null,
      })
    })

    it("excludes direct playback, conflicted episodes, future claims and excluded visits", async () => {
      const id = await freshVisit()
      const at = new Date(now.getTime() - 60_000)
      await playback(await selection(id, at), { discoverySource: "direct" })
      await playback(await selection(id, at), { conflict: true })
      await playback(await selection(id, at), {
        claimedAt: new Date(now.getTime() + 1),
      })
      const excluded = await visit({
        arm: RecommendationExperimentArm.CONTROL,
        browser: "a".repeat(64),
        createdAt: at,
        expiresAt: new Date(now.getTime() + days(1)),
        eligibility: "excluded",
      })
      await playback(await selection(excluded, at))
      expect((await report()).engagement?.byArm.control).toMatchObject({
        measuredVisits: 1,
        engagedVisits: 0,
        claimedPlaybacks: 1,
        invalidPlaybacks: 1,
        observedPlaybacks: 0,
      })
    })

    it("preserves engagement through raw expiry and repeat retention, without changing an older report", async () => {
      const id = await visit({
        arm: RecommendationExperimentArm.CONTROL,
        browser: "a".repeat(64),
        createdAt: new Date(now.getTime() - days(30)),
        expiresAt: new Date(now.getTime() - days(1)),
      })
      const delivered = await selection(id, new Date(now.getTime() - days(2)))
      await playback(delivered, { milliseconds: 90_000 })
      if (env.RECOMMENDATION_PRECOMPUTED_COMPACT_MEASUREMENT_ENABLED === "1") {
        await prisma.$transaction((tx) =>
          capturePrecomputedCtrMeasurement(
            tx,
            id,
            new Date(now.getTime() - days(2) + 10_000),
          ),
        )
        expect(
          await readPrecomputedCtrMeasurementAt(prisma, id, now),
        ).not.toBeNull()
        const [nativeBeforeArchive] = await prisma.$queryRaw<RawCtrVisit[]>(
          rawCtrVisitSql(Prisma.sql`v.id = ${id}::uuid`, now),
        )
        expect(await readCompactCtrVisitAt(prisma, id, now)).toEqual(
          nativeBeforeArchive,
        )
      }
      const before = await report()
      await prisma.$transaction((tx) =>
        purgeExpiredPrecomputedVisitRoots(tx, now, 100),
      )
      await prisma.$transaction((tx) =>
        purgeExpiredPrecomputedVisitRoots(tx, now, 100),
      )
      await prisma.recommendationRequest.delete({
        where: { id: delivered.requestId },
      })
      const after = await report()
      expect(after.engagement).toEqual(before.engagement)
      expect(after.revision).toBe(before.revision)
      expect(
        await prisma.recommendationPrecomputedCtrCluster.findFirst({
          where: { experimentId },
        }),
      ).toMatchObject({
        eligibleVisits: 1n,
        engagedVisits: 1n,
      })
      expect(
        await prisma.recommendationPrecomputedCtrTotals.findFirst({
          where: { experimentId, arm: "control" },
        }),
      ).toMatchObject({
        engagementMeasuredVisits: 1n,
        engagedVisits: 1n,
        activePlaybackMilliseconds: 90_000n,
      })
      if (env.RECOMMENDATION_PRECOMPUTED_COMPACT_MEASUREMENT_ENABLED === "1")
        expect(await readCompactCtrVisitAt(prisma, id, now)).toBeNull()
    })

    it("reads the real outcome service's deduplicated active playback in both variants", async () => {
      for (const arm of [
        RecommendationExperimentArm.CONTROL,
        RecommendationExperimentArm.CHALLENGER,
      ]) {
        const id = await freshVisit(arm)
        const episode = await playback(
          await selection(id, new Date(now.getTime() - 120_000)),
          { noOutcome: true },
        )
        const facts = [
          {
            kind: "playback_start",
            payload: { positionSeconds: 0, durationSeconds: 60 },
            at: -100_000,
          },
          {
            kind: "playback_active_visible_playing",
            payload: {
              activeMilliseconds: 30_000,
              coverage: "complete",
              durationSeconds: 60,
            },
            at: -50_000,
          },
          {
            kind: "playback_active_visible_playing",
            payload: {
              activeMilliseconds: 30_000,
              coverage: "complete",
              durationSeconds: 60,
            },
            at: -50_000,
          },
          {
            kind: "playback_end",
            payload: {
              reason: "route_exit",
              completed: false,
              positionSeconds: 30,
              durationSeconds: 60,
            },
            at: -40_000,
          },
        ]
        for (const [index, fact] of facts.entries()) {
          await prisma.recommendationPlaybackFact.create({
            data: {
              id: randomUUID(),
              requestId: episode.requestId,
              itemId: episode.itemId,
              episodeId: episode.id,
              capabilityJti: randomUUID(),
              eventId: randomUUID(),
              payloadDigest: String(index + 1).repeat(64),
              sequence: index + 1,
              kind: fact.kind,
              payload: fact.payload,
              occurredAt: new Date(now.getTime() + fact.at),
              expiresAt: episode.expiresAt,
            },
          })
        }
        const service = new RecommendationOutcomeService({
          prisma,
          now: () => new Date(now.getTime() - 1),
        })
        await expect(
          service.finalize({
            episodeId: episode.id,
            generation: 1,
            reason: "terminal-fact",
          }),
        ).resolves.toMatchObject({ status: "published" })
        if (
          env.RECOMMENDATION_PRECOMPUTED_COMPACT_MEASUREMENT_ENABLED === "1"
        ) {
          const [native] = await prisma.$queryRaw<RawCtrVisit[]>(
            rawCtrVisitSql(Prisma.sql`v.id = ${id}::uuid`, now),
          )
          const shadow = await readPrecomputedCtrMeasurementAt(prisma, id, now)
          expect(shadow?.summary).toMatchObject({
            qualified_playbacks: native.qualified_playbacks.toString(),
            active_playback_milliseconds:
              native.active_playback_milliseconds.toString(),
          })
        }
      }
      const result = await report()
      for (const arm of ["control", "challenger"] as const) {
        expect(result.engagement?.byArm[arm]).toMatchObject({
          engagedVisits: 1,
          engagedViewRate: 1,
          activeWatchMinutes: 0.5,
          completePlaybacks: 1,
        })
      }
    })

    it("freezes engagement at the final late-event cutoff and exposes unfinished playback", async () => {
      const end = (
        await prisma.recommendationPrecomputedExperiment.findUniqueOrThrow({
          where: { id: experimentId },
        })
      ).endsAt
      now = new Date(end.getTime() + days(2))
      const cutoff = new Date(end.getTime() + days(1))
      const id = await visit({
        arm: RecommendationExperimentArm.CONTROL,
        browser: "a".repeat(64),
        createdAt: new Date(now.getTime() - days(3)),
        expiresAt: new Date(now.getTime() + days(1)),
      })
      const episode = await playback(
        await selection(id, new Date(cutoff.getTime() - 60_000)),
        { noOutcome: true },
      )
      await outcome(episode, {
        qualified: false,
        milliseconds: 1_000,
        coverage: "partial",
        at: new Date(cutoff.getTime() - 1),
      })
      await outcome(episode, {
        qualified: true,
        milliseconds: 60_000,
        coverage: "complete",
        at: new Date(cutoff.getTime() + 1),
        revision: 2,
      })
      await prisma.recommendationPlaybackEpisode.update({
        where: { id: episode.id },
        data: { state: RecommendationEpisodeState.CLAIMED },
      })
      if (env.RECOMMENDATION_PRECOMPUTED_COMPACT_MEASUREMENT_ENABLED === "1") {
        await prisma.$transaction((tx) =>
          capturePrecomputedCtrMeasurement(tx, id, now),
        )
        const [native] = await prisma.$queryRaw<RawCtrVisit[]>(
          rawCtrVisitSql(Prisma.sql`v.id = ${id}::uuid`, now),
        )
        expect(await readCompactCtrVisitAt(prisma, id, now)).toEqual(native)
      }
      const result = await report()
      expect(result.isFinal).toBe(true)
      expect(result.engagement?.byArm.control).toMatchObject({
        engagedVisits: 0,
        partialPlaybacks: 1,
        pendingPlaybacks: 1,
      })
      expect(result.engagement?.byArm.control.activeWatchMinutes).toBeCloseTo(
        1 / 60,
      )
    })

    it.skipIf(
      env.RECOMMENDATION_PRECOMPUTED_COMPACT_MEASUREMENT_ENABLED !== "1",
    )(
      "advances finalized pending measurement at hard-until without a new event",
      async () => {
        const id = await freshVisit()
        const delivered = await selection(id, new Date(now.getTime() - 60_000))
        const episode = await playback(delivered, { noOutcome: true })
        await prisma.recommendationPlaybackEpisode.update({
          where: { id: episode.id },
          data: { hardUntil: new Date(now.getTime() + 30_000) },
        })
        await prisma.$transaction((tx) =>
          capturePrecomputedCtrMeasurement(tx, id, now),
        )
        const later = new Date(now.getTime() + 60_000)
        const [nativeAtCapture] = await prisma.$queryRaw<RawCtrVisit[]>(
          rawCtrVisitSql(Prisma.sql`v.id = ${id}::uuid`, now),
        )
        const [nativeLater] = await prisma.$queryRaw<RawCtrVisit[]>(
          rawCtrVisitSql(Prisma.sql`v.id = ${id}::uuid`, later),
        )
        expect(nativeAtCapture.pending_playbacks).toBe(1n)
        expect(nativeLater.pending_playbacks).toBe(0n)
        expect(
          (await readPrecomputedCtrMeasurementAt(prisma, id, now))?.summary,
        ).toMatchObject({ pending_playbacks: "1" })
        expect(
          (await readPrecomputedCtrMeasurementAt(prisma, id, later))?.summary,
        ).toMatchObject({ pending_playbacks: "0" })
        expect(await readCompactCtrVisitAt(prisma, id, later)).toEqual(
          nativeLater,
        )
      },
    )

    it("keeps old archived engagement unknown while CTR remains available", async () => {
      await prisma.recommendationPrecomputedCtrCluster.create({
        data: {
          experimentId,
          browserUnitDigest: "a".repeat(64),
          arm: RecommendationExperimentArm.CONTROL,
          eligibleVisits: 2n,
          clickedVisits: 1n,
        },
      })
      await prisma.recommendationPrecomputedCtrTotals.create({
        data: {
          experimentId,
          arm: "control",
          eligibleVisits: 2n,
          clickedVisits: 1n,
          acceptedSelections: 1n,
        },
      })
      const result = await report()
      expect(result.byArm.control.visitCtr).toBe(0.5)
      expect(result.engagement?.byArm.control).toMatchObject({
        unmeasuredArchivedVisits: 2,
        engagedViewRate: null,
        activeWatchMinutesPer100Visits: null,
      })
      expect(result.engagement?.engagedViewUncertainty.lowerBound).toBeNull()
    })
  },
)
