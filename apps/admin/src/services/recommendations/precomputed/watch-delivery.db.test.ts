import { createHash, randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { env } from "@/config/env"
import { currentAdminMigrationSql } from "../current-schema.test-fixture"
import { deliverPrecomputedWatchPreview } from "./watch-delivery"
import { readPrecomputedWatchChoices } from "./watch-reader"
import { servedSnapshotValue } from "../served-item-payload"
import { deliverPrecomputedWatchFallback } from "./watch-fallback"
import { deliverPrivatePrecomputedWatchVisit } from "./private-watch-test"
import { purgeExpiredPrecomputedVisitRoots } from "./visit-retention"
import { RECOMMENDATION_CONTRACTS } from "../contracts"
import type { SemanticRecommendationDelivery } from "../delivery.types"
import {
  admitPrivatePrecomputedVisit,
  configurePrivatePrecomputedExperiment,
  loadPrivatePrecomputedVisitDiagnostics,
  recordPrivatePrecomputedVisitDelivery,
} from "./visit-admission"

const caller = {
  id: null,
  role: "CONSUMER_BEARER",
  fleet: false,
  rateLimitBucketKey: "precomputed-preview-native-test",
} as const
const tokenService = {
  activeKid: "preview-test",
  signDeliveryCapability: async ({ itemId }: { itemId: string }) =>
    `test-capability-${itemId}`,
}
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex")
const choice = (
  targetVideoId: string,
  kind: "direct" | "alternative",
  rank: number,
) => ({
  targetVideoId,
  kind,
  rank,
  relationship: "connected",
  reasonEnglish: "This video explores a clearly connected part of the story.",
  evidence: { basis: "metadata", fields: ["title"] },
})

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "precomputed private Watch delivery on PostgreSQL 18",
  () => {
    let prisma: PrismaClient
    let admin: Client
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const schema = `precomputed_watch_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const sourceVideoId = `watch-source-${suffix}`
    const targets = Array.from(
      { length: 9 },
      (_, index) => `watch-target-${index + 1}-${suffix}`,
    )
    const englishId = `english-${suffix}`
    const spanishId = `spanish-${suffix}`
    let sequence = 0
    let privateExperimentId = ""
    let privateGenerationId = ""
    let challengerBrowserDigest = ""
    const consentReceiptDigest = "e".repeat(64)
    const profileTokenDigest = "f".repeat(64)

    async function makeVideo(id: string, audioLanguageId = englishId) {
      await prisma.video.create({
        data: { id, coreId: `core-${id}`, slug: id },
      })
      await prisma.videoLocale.create({
        data: {
          id: `locale-${id}`,
          videoId: id,
          locale: "en",
          title: `Title ${id}`,
          status: "PUBLISHED",
        },
      })
      await prisma.muxVideo.create({
        data: { id: `mux-${id}`, playbackId: `playback-${id}` },
      })
      await prisma.videoDub.create({
        data: {
          id: `dub-${id}`,
          coreId: `dub-core-${id}`,
          videoId: id,
          languageId: audioLanguageId,
          muxVideoId: `mux-${id}`,
          published: true,
        },
      })
    }

    async function makeGeneration(choices: ReturnType<typeof choice>[]) {
      sequence += 1
      const generationId = `watch-generation-${sequence}-${suffix}`
      await prisma.recommendationPrecomputedGeneration.create({
        data: {
          id: generationId,
          modelId: "fixture-astra",
          promptVersion: "fixture-v1",
          inputDigest: "a".repeat(64),
          sourceSetDigest: digest([sourceVideoId]),
          inputCutoff: new Date("2026-10-05T00:00:00.000Z"),
          expectedSourceCount: 1,
          status: "complete",
          completedAt: new Date(Date.now() + sequence * 1_000),
        },
      })
      await prisma.recommendationPrecomputedSource.create({
        data: {
          generationId,
          sourceVideoId,
          payload: choices,
          acceptedCount: choices.length,
          submissionDigest: digest(choices),
        },
      })
      return generationId
    }

    const input = (overrides: Record<string, unknown> = {}) => ({
      seedMediaId: sourceVideoId,
      locale: "en",
      audioLanguageSlug: "english",
      sessionDigest: "b".repeat(64),
      caller,
      ...overrides,
    })

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
      await prisma.language.createMany({
        data: [
          { id: englishId, coreId: `core-${englishId}`, slug: "english" },
          { id: spanishId, coreId: `core-${spanishId}`, slug: "spanish" },
        ],
      })
      for (const id of [sourceVideoId, ...targets]) await makeVideo(id)
      await prisma.videoDub.create({
        data: {
          id: `source-spanish-${suffix}`,
          coreId: `source-spanish-core-${suffix}`,
          videoId: sourceVideoId,
          languageId: spanishId,
          muxVideoId: `mux-${sourceVideoId}`,
          published: true,
        },
      })
    }, 120_000)

    afterAll(async () => {
      await prisma?.$disconnect()
      if (admin) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await admin.end()
      }
    })

    it("serves six after filtering every stored edge, including an alternative, with packed bindings", async () => {
      await makeGeneration([
        ...targets
          .slice(0, 7)
          .map((id, index) => choice(id, "direct", index + 1)),
        ...targets
          .slice(7)
          .map((id, index) => choice(id, "alternative", index + 1)),
      ])
      await prisma.videoDub.update({
        where: { id: `dub-${targets[1]}` },
        data: { published: false },
      })
      await prisma.video.update({
        where: { id: targets[2] },
        data: { restrictViewPlatforms: ["watch"] },
      })
      const delivery = await deliverPrecomputedWatchPreview(
        prisma,
        input(),
        tokenService,
      )
      expect(delivery.result).toBe("served")
      expect(delivery.items.map((item) => item.targetMediaId)).toEqual([
        targets[0],
        targets[3],
        targets[4],
        targets[5],
        targets[6],
        targets[7],
      ])
      expect(delivery.items[5]?.candidateGenerator).toBe("precomputed")
      const saved = await prisma.recommendationRequest.findUniqueOrThrow({
        where: { id: delivery.requestId! },
        include: { items: true },
      })
      expect(saved.experimentAssignmentId).toBeNull()
      expect(saved.strategyVersion).toBe("precomputed-watch-preview-v1")
      expect(saved.servedItemPayload).toMatchObject({ version: 1 })
      expect(saved.items).toHaveLength(6)
      const alternative = servedSnapshotValue(
        saved.servedItemPayload,
        saved.items.find((item) => item.position === 5)!,
      )
      expect(alternative.candidateProvenance).toMatchObject({
        kind: "alternative",
        rank: 1,
      })
      expect(
        saved.items.every(
          (item) =>
            JSON.stringify(item.presentation) === "{}" &&
            JSON.stringify(item.candidateProvenance) === "{}",
        ),
      ).toBe(true)
      expect(JSON.stringify(saved.servedItemPayload)).not.toContain(
        "reasonEnglish",
      )
      expect(JSON.stringify(saved.servedItemPayload)).not.toContain("evidence")
    })

    it("keeps a one-card snapshot inline and hides an explicitly empty source", async () => {
      await makeGeneration([choice(targets[0], "direct", 1)])
      const one = await deliverPrecomputedWatchPreview(
        prisma,
        input(),
        tokenService,
      )
      expect(one.items).toHaveLength(1)
      expect(one.items[0]).toMatchObject({
        canonicalHref: `/watch/${targets[0]}.html`,
        playbackId: `playback-${targets[0]}`,
      })
      const oneSaved = await prisma.recommendationRequest.findUniqueOrThrow({
        where: { id: one.requestId! },
        include: { items: true },
      })
      expect(oneSaved.servedItemPayload).toBeNull()
      expect(oneSaved.items[0]?.presentation).toMatchObject({
        videoSlug: targets[0],
      })

      await makeGeneration([])
      const empty = await deliverPrecomputedWatchPreview(
        prisma,
        input(),
        tokenService,
      )
      expect(empty).toMatchObject({
        result: "empty",
        reason: "no_connections",
        items: [],
      })
      expect(empty.requestId).toBeTruthy()
      expect(
        await prisma.recommendationRequest.findUnique({
          where: { id: empty.requestId! },
        }),
      ).toMatchObject({ expectedItemCount: 0, result: "EMPTY" })
    })

    it("treats changed exact audio as valid empty but an absent source row as technical", async () => {
      const generationId = await makeGeneration([
        choice(targets[0], "direct", 1),
      ])
      const spanish = await deliverPrecomputedWatchPreview(
        prisma,
        input({ audioLanguageSlug: "spanish" }),
        tokenService,
      )
      expect(spanish).toMatchObject({
        result: "empty",
        reason: "no_playable_connections",
        generationId,
      })
      const missing = await deliverPrecomputedWatchPreview(
        prisma,
        input({ seedMediaId: targets[8] }),
        tokenService,
      )
      expect(missing).toMatchObject({
        result: "unavailable",
        reason: "not_in_generation",
        requestId: null,
      })
    })

    it("does not serve a failed source from an otherwise complete generation", async () => {
      const generationId = await makeGeneration([])
      await prisma.recommendationPrecomputedSource.update({
        where: {
          generationId_sourceVideoId: { generationId, sourceVideoId },
        },
        data: { status: "failed", failureCode: "fixture_source_failed" },
      })
      expect(await readPrecomputedWatchChoices(prisma, input())).toMatchObject({
        state: "source_incomplete",
        generationId,
      })
      const delivery = await deliverPrecomputedWatchPreview(
        prisma,
        input(),
        tokenService,
      )
      expect(delivery).toMatchObject({
        result: "unavailable",
        reason: "source_incomplete",
        generationId,
        requestId: null,
        items: [],
      })
    })

    it("fails closed for private authorization and changed seed publication", async () => {
      await expect(
        deliverPrecomputedWatchPreview(
          prisma,
          input({ caller: null }),
          tokenService,
        ),
      ).rejects.toThrow("Web consumer authentication required")
      await prisma.videoLocale.update({
        where: { id: `locale-${sourceVideoId}` },
        data: { status: "DRAFT" },
      })
      const denied = await deliverPrecomputedWatchPreview(
        prisma,
        input(),
        tokenService,
      )
      expect(denied).toMatchObject({
        result: "unavailable",
        reason: "source_unavailable",
        requestId: null,
      })
      expect((await readPrecomputedWatchChoices(prisma, input())).state).toBe(
        "source_unavailable",
      )
    })

    it("guards incumbent recovery with current source publication and exact audio", async () => {
      await prisma.videoLocale.update({
        where: { id: `locale-${sourceVideoId}` },
        data: { status: "PUBLISHED" },
      })
      const incumbent = vi.fn(
        async (): Promise<SemanticRecommendationDelivery> => ({
          contractVersion: RECOMMENDATION_CONTRACTS.delivery,
          surfaceVersion: RECOMMENDATION_CONTRACTS.surface,
          strategyVersion: RECOMMENDATION_CONTRACTS.strategy,
          classifierVersion: RECOMMENDATION_CONTRACTS.outcome,
          requestId: null,
          result: "empty",
          reason: null,
          expiresAt: null,
          items: [],
        }),
      )
      await deliverPrecomputedWatchFallback(prisma, input(), incumbent)
      expect(incumbent).toHaveBeenCalledWith(
        expect.objectContaining({
          eligibleHuman: false,
          consentReceiptDigest: null,
          profileTokenDigest: null,
        }),
      )
      incumbent.mockClear()
      await prisma.videoLocale.update({
        where: { id: `locale-${sourceVideoId}` },
        data: { status: "DRAFT" },
      })
      expect(
        await deliverPrecomputedWatchFallback(prisma, input(), incumbent),
      ).toMatchObject({
        result: "unavailable",
        reason: "source_unavailable",
      })
      expect(incumbent).not.toHaveBeenCalled()
    })

    it("admits one independent visit before any delivery and keeps the browser arm across sessions", async () => {
      await prisma.videoLocale.update({
        where: { id: `locale-${sourceVideoId}` },
        data: { status: "PUBLISHED" },
      })
      // The owned test schema starts with the production-safe disabled switch.
      // Enable it only inside this disposable schema to model the live control.
      await prisma.recommendationServingControl.update({
        where: { id: "recommendation-serving-control" },
        data: { enabled: true },
      })
      const profile = await prisma.recommendationProfile.create({
        data: {
          tokenDigest: profileTokenDigest,
          privacyGeneration: 1,
          choice: "DURABLE_ALLOWED",
          expiresAt: new Date(Date.now() + 35 * 86_400_000),
        },
      })
      await prisma.recommendationConsentReceipt.create({
        data: {
          tokenDigest: consentReceiptDigest,
          contractVersion: "recommendation-consent-v1",
          choice: "PERSONALIZATION",
          state: "ACTIVE",
          profileId: profile.id,
          privacyGeneration: 1,
          expiresAt: new Date(Date.now() + 35 * 86_400_000),
        },
      })
      const generationId = await makeGeneration([])
      const experiment = await configurePrivatePrecomputedExperiment(prisma, {
        id: `private-watch-${suffix}`,
        generationId,
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 86_400_000),
        operator: { id: "fixture-admin", role: "ADMIN" },
      })
      privateExperimentId = experiment.id
      privateGenerationId = generationId
      const browserDigest = "c".repeat(64)
      const first = await admitPrivatePrecomputedVisit(prisma, {
        visitId: randomUUID(),
        browserDigest,
        consentReceiptDigest,
        profileTokenDigest,
        seedMediaId: sourceVideoId,
        locale: "en",
        audioLanguageSlug: "english",
        trafficCategory: "ordinary_browser",
        enrollmentMode: "private_test",
        caller,
      })
      expect(first).toMatchObject({
        status: "eligible",
        experimentId: experiment.id,
        generationId,
        qualification: "unverified_browser",
        deliveryResult: "not_attempted",
      })
      const nextSession = await admitPrivatePrecomputedVisit(prisma, {
        visitId: randomUUID(),
        browserDigest,
        consentReceiptDigest,
        profileTokenDigest,
        seedMediaId: sourceVideoId,
        locale: "en",
        audioLanguageSlug: "english",
        trafficCategory: "ordinary_browser",
        enrollmentMode: "private_test",
        caller,
      })
      expect(nextSession.arm).toBe(first.arm)
      expect(nextSession.visitId).not.toBe(first.visitId)
    })

    it("deduplicates a visit retry and retains valid empty delivery in its assigned arm", async () => {
      const visitId = randomUUID()
      const admission = {
        visitId,
        browserDigest: "d".repeat(64),
        consentReceiptDigest,
        profileTokenDigest,
        seedMediaId: sourceVideoId,
        locale: "en",
        audioLanguageSlug: "english",
        trafficCategory: "ordinary_browser" as const,
        enrollmentMode: "private_test" as const,
        caller,
      }
      const first = await admitPrivatePrecomputedVisit(prisma, admission)
      expect(await admitPrivatePrecomputedVisit(prisma, admission)).toEqual(
        first,
      )
      expect(
        await recordPrivatePrecomputedVisitDelivery(prisma, {
          visitId,
          browserDigest: admission.browserDigest,
          consentReceiptDigest,
          profileTokenDigest,
          result: "empty",
          actualStrategy:
            first.arm === "challenger"
              ? "precomputed-watch-preview-v1"
              : "semantic-transcript-pgvector-v1",
          requestId: null,
          fallbackReason: null,
          caller,
        }),
      ).toBe("recorded")
      const report = await loadPrivatePrecomputedVisitDiagnostics(prisma, {
        experimentId: privateExperimentId,
        reviewer: { id: "fixture-admin", role: "ADMIN" },
      })
      expect(report.status).toBe("observed_private_only")
      if (report.status === "unavailable")
        throw new Error("Native private visit report unavailable")
      expect(report.eligible.total).toBe(3)
      expect(report.eligible.empty).toBe(1)
      expect(report.eligible.notAttempted).toBe(2)
      expect(report.eligible.byArm[first.arm!].empty).toBe(1)
    })

    it("deduplicates concurrent first-tab retries to one eligible visit and arm", async () => {
      const visitId = randomUUID()
      const input = {
        visitId,
        browserDigest: "5".repeat(64),
        consentReceiptDigest,
        profileTokenDigest,
        seedMediaId: sourceVideoId,
        locale: "en",
        audioLanguageSlug: "english",
        trafficCategory: "ordinary_browser" as const,
        enrollmentMode: "private_test" as const,
        caller,
      }
      const [first, retry] = await Promise.all([
        admitPrivatePrecomputedVisit(prisma, input),
        admitPrivatePrecomputedVisit(prisma, input),
      ])
      expect(first.status).toBe("eligible")
      expect(retry).toEqual(first)
      expect(
        await prisma.recommendationPrecomputedVisit.count({
          where: { id: visitId },
        }),
      ).toBe(1)
    })

    it("binds every issued retry request to the original visit", async () => {
      let challenger: { visitId: string; browserDigest: string } | undefined
      for (let index = 0; index < 20 && !challenger; index += 1) {
        const candidate = {
          visitId: randomUUID(),
          browserDigest: createHash("sha256")
            .update(`retry-browser-${index}`)
            .digest("hex"),
        }
        const admission = await admitPrivatePrecomputedVisit(prisma, {
          ...candidate,
          consentReceiptDigest,
          profileTokenDigest,
          seedMediaId: sourceVideoId,
          locale: "en",
          audioLanguageSlug: "english",
          trafficCategory: "ordinary_browser",
          enrollmentMode: "private_test",
          caller,
        })
        if (admission.arm === "challenger") challenger = candidate
      }
      expect(challenger).toBeDefined()
      challengerBrowserDigest = challenger!.browserDigest
      const first = await deliverPrecomputedWatchPreview(
        prisma,
        input(),
        tokenService,
      )
      const second = await deliverPrecomputedWatchPreview(
        prisma,
        input(),
        tokenService,
      )
      expect(first.requestId).toBeTruthy()
      expect(second.requestId).toBeTruthy()
      for (const requestId of [first.requestId!, second.requestId!]) {
        expect(
          await recordPrivatePrecomputedVisitDelivery(prisma, {
            visitId: challenger!.visitId,
            browserDigest: challenger!.browserDigest,
            consentReceiptDigest,
            profileTokenDigest,
            result: "empty",
            actualStrategy: "precomputed-watch-preview-v1",
            requestId,
            fallbackReason: null,
            caller,
          }),
        ).toBe("recorded")
      }
      const links = await prisma.recommendationPrecomputedVisitRequest.findMany(
        {
          where: { visitId: challenger!.visitId },
          select: { requestId: true },
        },
      )
      expect(new Set(links.map((link) => link.requestId))).toEqual(
        new Set([first.requestId, second.requestId]),
      )
    })

    it("keeps challenger delivery on the frozen generation after a newer build", async () => {
      const newerGenerationId = await makeGeneration([
        choice(targets[0], "direct", 1),
      ])
      const fixed = await deliverPrecomputedWatchPreview(
        prisma,
        input({ generationId: privateGenerationId }),
        tokenService,
      )
      const latest = await deliverPrecomputedWatchPreview(
        prisma,
        input(),
        tokenService,
      )
      expect(fixed).toMatchObject({
        generationId: privateGenerationId,
        result: "empty",
      })
      expect(latest).toMatchObject({
        generationId: newerGenerationId,
        result: "served",
      })
    })

    it("keeps a failed saved-source output in the challenger denominator", async () => {
      const visitId = randomUUID()
      await prisma.recommendationPrecomputedSource.update({
        where: {
          generationId_sourceVideoId: {
            generationId: privateGenerationId,
            sourceVideoId,
          },
        },
        data: { status: "failed", failureCode: "fixture_source_failed" },
      })
      try {
        const result = await deliverPrivatePrecomputedWatchVisit(
          prisma,
          {
            visitId,
            browserDigest: challengerBrowserDigest,
            consentReceiptDigest,
            profileTokenDigest,
            seedMediaId: sourceVideoId,
            locale: "en",
            audioLanguageSlug: "english",
            sessionDigest: "b".repeat(64),
            trafficCategory: "ordinary_browser",
            clientDeliveryContract: null,
            enrollmentMode: "private_test",
            caller,
          },
          tokenService,
        )
        expect(result).toMatchObject({
          status: "eligible",
          arm: "challenger",
          generationId: privateGenerationId,
        })
        const visit =
          await prisma.recommendationPrecomputedVisit.findUniqueOrThrow({
            where: { id: visitId },
          })
        expect(visit.eligibility).toBe("eligible")
        expect(visit.arm).toBe("CHALLENGER")
        expect(visit.fallbackReason).toBe("source_incomplete")
      } finally {
        await prisma.recommendationPrecomputedSource.update({
          where: {
            generationId_sourceVideoId: {
              generationId: privateGenerationId,
              sourceVideoId,
            },
          },
          data: { status: "complete", failureCode: null },
        })
      }
    })

    it("records empty technical fallback and errors in their original arms", async () => {
      const start = await loadPrivatePrecomputedVisitDiagnostics(prisma, {
        experimentId: privateExperimentId,
        reviewer: { id: "fixture-admin", role: "ADMIN" },
      })
      if (start.status === "unavailable") throw new Error(start.reason)
      for (const [index, result] of (
        ["empty", "unavailable"] as const
      ).entries()) {
        const visitId = randomUUID()
        const browserDigest = createHash("sha256")
          .update(`fallback-${index}`)
          .digest("hex")
        expect(
          (
            await admitPrivatePrecomputedVisit(prisma, {
              visitId,
              browserDigest,
              consentReceiptDigest,
              profileTokenDigest,
              seedMediaId: sourceVideoId,
              locale: "en",
              audioLanguageSlug: "english",
              trafficCategory: "ordinary_browser",
              enrollmentMode: "private_test",
              caller,
            })
          ).status,
        ).toBe("eligible")
        expect(
          await recordPrivatePrecomputedVisitDelivery(prisma, {
            visitId,
            browserDigest,
            consentReceiptDigest,
            profileTokenDigest,
            result,
            actualStrategy:
              result === "empty" ? "semantic-transcript-pgvector-v1" : null,
            requestId: null,
            fallbackReason:
              result === "empty" ? "precomputed_read_unavailable" : null,
            caller,
          }),
        ).toBe("recorded")
      }
      const end = await loadPrivatePrecomputedVisitDiagnostics(prisma, {
        experimentId: privateExperimentId,
        reviewer: { id: "fixture-admin", role: "ADMIN" },
      })
      if (end.status === "unavailable") throw new Error(end.reason)
      expect(end.eligible.total - start.eligible.total).toBe(2)
      expect(end.eligible.empty - start.eligible.empty).toBe(1)
      expect(end.eligible.unavailable - start.eligible.unavailable).toBe(1)
      expect(end.eligible.fallback - start.eligible.fallback).toBe(1)
      expect(end.eligible.served - start.eligible.served).toBe(0)
    })

    it("bounds admission blocked by PostgreSQL without issuing a delivery", async () => {
      const before = await prisma.recommendationPrecomputedVisit.count({
        where: { experimentId: privateExperimentId },
      })
      await admin.query("BEGIN")
      await admin.query(
        "LOCK TABLE recommendation_precomputed_experiment IN ACCESS EXCLUSIVE MODE",
      )
      const startedAt = Date.now()
      try {
        const pending = deliverPrivatePrecomputedWatchVisit(prisma, {
          visitId: randomUUID(),
          browserDigest: "6".repeat(64),
          consentReceiptDigest,
          profileTokenDigest,
          seedMediaId: sourceVideoId,
          locale: "en",
          audioLanguageSlug: "english",
          sessionDigest: "b".repeat(64),
          trafficCategory: "ordinary_browser",
          clientDeliveryContract: null,
          enrollmentMode: "private_test",
          caller,
        })
        const result = await pending
        expect(result.status).toBe("unavailable")
        expect(result.delivery).toBeNull()
        expect(Date.now() - startedAt).toBeLessThan(3_500)
      } finally {
        await admin.query("ROLLBACK")
      }
      expect(
        await prisma.recommendationPrecomputedVisit.count({
          where: { experimentId: privateExperimentId },
        }),
      ).toBe(before)
    }, 10_000)

    it("excludes automation, unknown traffic, forged receipts, and later catalog sources", async () => {
      const newVideoId = `later-source-${suffix}`
      await makeVideo(newVideoId)
      const base = {
        browserDigest: "9".repeat(64),
        consentReceiptDigest,
        profileTokenDigest,
        seedMediaId: sourceVideoId,
        locale: "en",
        audioLanguageSlug: "english",
        enrollmentMode: "private_test" as const,
        caller,
      }
      for (const [overrides, reason] of [
        [{ trafficCategory: "declared_crawler" }, "automation_excluded"],
        [{ trafficCategory: "speculative_prefetch" }, "automation_excluded"],
        [{ trafficCategory: "speculative_prerender" }, "automation_excluded"],
        [{ trafficCategory: "unknown" }, "traffic_unqualified"],
        [
          {
            trafficCategory: "ordinary_browser",
            consentReceiptDigest: "a".repeat(64),
          },
          "consent_unverified",
        ],
        [
          { trafficCategory: "ordinary_browser", seedMediaId: newVideoId },
          "outside_frozen_cohort",
        ],
        [
          { trafficCategory: "ordinary_browser", enrollmentMode: "preview" },
          "preview_excluded",
        ],
      ] as const) {
        const admitted = await admitPrivatePrecomputedVisit(prisma, {
          visitId: randomUUID(),
          ...base,
          ...overrides,
        })
        expect(admitted).toMatchObject({
          status: "excluded",
          arm: null,
          reason,
        })
      }
    })

    it("rejects expired consent and fences in-flight delivery after withdrawal", async () => {
      const visitId = randomUUID()
      const admitted = await admitPrivatePrecomputedVisit(prisma, {
        visitId,
        browserDigest: "8".repeat(64),
        consentReceiptDigest,
        profileTokenDigest,
        seedMediaId: sourceVideoId,
        locale: "en",
        audioLanguageSlug: "english",
        trafficCategory: "ordinary_browser",
        enrollmentMode: "private_test",
        caller,
      })
      expect(admitted.status).toBe("eligible")
      const receipt =
        await prisma.recommendationConsentReceipt.findUniqueOrThrow({
          where: { tokenDigest: consentReceiptDigest },
        })
      await prisma.recommendationConsentReceipt.update({
        where: { id: receipt.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      })
      expect(
        await admitPrivatePrecomputedVisit(prisma, {
          visitId: randomUUID(),
          browserDigest: "8".repeat(64),
          consentReceiptDigest,
          profileTokenDigest,
          seedMediaId: sourceVideoId,
          locale: "en",
          audioLanguageSlug: "english",
          trafficCategory: "ordinary_browser",
          enrollmentMode: "private_test",
          caller,
        }),
      ).toMatchObject({ status: "excluded", reason: "consent_unverified" })
      await prisma.recommendationConsentReceipt.update({
        where: { id: receipt.id },
        data: { expiresAt: receipt.expiresAt },
      })
      await prisma.recommendationConsentReceipt.update({
        where: { id: receipt.id },
        data: {
          state: "REVOKED",
          revokedAt: new Date(),
          revokeReason: "private_test_withdrawal",
          tokenDigest: null,
          profileId: null,
          privacyGeneration: 1,
        },
      })
      expect(
        await recordPrivatePrecomputedVisitDelivery(prisma, {
          visitId,
          browserDigest: "8".repeat(64),
          consentReceiptDigest,
          profileTokenDigest,
          result: "unavailable",
          actualStrategy: null,
          requestId: null,
          fallbackReason: null,
          caller,
        }),
      ).toBe("unavailable")
      expect(
        await admitPrivatePrecomputedVisit(prisma, {
          visitId: randomUUID(),
          browserDigest: "8".repeat(64),
          consentReceiptDigest,
          profileTokenDigest,
          seedMediaId: sourceVideoId,
          locale: "en",
          audioLanguageSlug: "english",
          trafficCategory: "ordinary_browser",
          enrollmentMode: "private_test",
          caller,
        }),
      ).toMatchObject({ status: "excluded", reason: "consent_unverified" })
    })

    it("halts new admission if the frozen control routing changes", async () => {
      await prisma.recommendationServingControl.update({
        where: { id: "recommendation-serving-control" },
        data: { reasonCode: "changed_control_route" },
      })
      expect(
        await admitPrivatePrecomputedVisit(prisma, {
          visitId: randomUUID(),
          browserDigest: "7".repeat(64),
          consentReceiptDigest,
          profileTokenDigest,
          seedMediaId: sourceVideoId,
          locale: "en",
          audioLanguageSlug: "english",
          trafficCategory: "ordinary_browser",
          enrollmentMode: "private_test",
          caller,
        }),
      ).toMatchObject({
        status: "unavailable",
        reason: "frozen_configuration_unavailable",
      })
      await expect(
        prisma.recommendationPrecomputedExperiment.update({
          where: { id: privateExperimentId },
          data: { controlRoutingDigest: "0".repeat(64) },
        }),
      ).rejects.toThrow()
    })

    it("purges expired visit roots and their retired configuration in bounded batches", async () => {
      const now = new Date()
      const active =
        await prisma.recommendationPrecomputedExperiment.findUniqueOrThrow({
          where: { id: privateExperimentId },
        })
      const expiredId = `expired-test-${suffix}`
      await prisma.recommendationPrecomputedExperiment.create({
        data: {
          id: expiredId,
          generationId: active.generationId,
          controlManifestId: active.controlManifestId,
          challengerManifestId: active.challengerManifestId,
          controlManifestDigest: active.controlManifestDigest,
          controlRoutingDigest: active.controlRoutingDigest,
          sourceSetDigest: active.sourceSetDigest,
          assignmentPolicyVersion: active.assignmentPolicyVersion,
          eligibilityPolicyVersion: active.eligibilityPolicyVersion,
          deliveryPolicyVersion: active.deliveryPolicyVersion,
          configurationDigest: active.configurationDigest,
          state: "closed",
          startsAt: new Date(now.getTime() - 400 * 86_400_000),
          endsAt: new Date(now.getTime() - 399 * 86_400_000),
          expiresAt: new Date(now.getTime() - 1_000),
        },
      })
      const expiredVisitId = randomUUID()
      const retainedVisitId = randomUUID()
      await prisma.recommendationPrecomputedVisit.createMany({
        data: [
          {
            id: expiredVisitId,
            experimentId: privateExperimentId,
            sourceVideoId,
            locale: "en",
            audioLanguageSlug: "english",
            eligibility: "excluded",
            qualification: "unknown_signal",
            exclusionReason: "traffic_unqualified",
            createdAt: new Date(now.getTime() - 29 * 86_400_000),
            expiresAt: new Date(now.getTime() - 1_000),
          },
          {
            id: retainedVisitId,
            experimentId: privateExperimentId,
            sourceVideoId,
            locale: "en",
            audioLanguageSlug: "english",
            eligibility: "excluded",
            qualification: "unknown_signal",
            exclusionReason: "traffic_unqualified",
            createdAt: now,
            expiresAt: new Date(now.getTime() + 28 * 86_400_000),
          },
        ],
      })
      expect(
        await prisma.$transaction((tx) =>
          purgeExpiredPrecomputedVisitRoots(tx, now, 1),
        ),
      ).toEqual({
        visitsDeleted: 1,
        experimentsDeleted: 1,
        visitPageFull: true,
        experimentPageFull: true,
      })
      expect(
        await prisma.recommendationPrecomputedVisit.findUnique({
          where: { id: expiredVisitId },
        }),
      ).toBeNull()
      expect(
        await prisma.recommendationPrecomputedVisit.findUnique({
          where: { id: retainedVisitId },
        }),
      ).not.toBeNull()
      expect(
        await prisma.recommendationPrecomputedExperiment.findUnique({
          where: { id: expiredId },
        }),
      ).toBeNull()
    })
  },
)
