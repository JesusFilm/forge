import { createHash, randomUUID } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { PrismaPg } from "@prisma/adapter-pg"
import { Prisma, PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { env } from "@/config/env"
import {
  composeDeliveryOwnerCowatch,
  resolveDeliveryOwnerAuthority,
} from "./delivery-owner.service"
import { seedOwnerDeliveryGraph } from "./delivery-owner.test-helper"
import {
  makeHarness,
  personalizedInput,
  profileCandidateResult,
  semanticCandidates,
} from "./delivery.service.test-helpers"
import { RecommendationOwnerReleaseOperator } from "./promotion/owner-operator"
import {
  createRecommendationPromotionService,
  recordFirstEligiblePromotionExposure,
} from "./promotion/service"
import {
  OWNER_APPROVED_COWATCH_MMR_MANIFEST_ID,
  INCUMBENT_HYBRID_MANIFEST_ID,
} from "./promotion/manifest"
import { ownerReleaseInfluenceAllowed } from "./promotion/owner-influence"
import { servedSnapshotValue } from "./served-item-payload"

// Only local synthetic source/retrieval inputs. Real qualification, operator,
// source hydration/MMR, current authority and issuance persistence execute.
describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "owner release through native delivery",
  () => {
    const databaseName = `owner_delivery_${randomUUID().replaceAll("-", "")}`
    let admin: Client, migration: Client, blocker: Client, db: PrismaClient
    let childUrl: string
    let created = false
    beforeAll(async () => {
      const url = new URL(env.DATABASE_URL)
      if (
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        url.pathname !== "/forge_test" ||
        url.search ||
        url.hash
      )
        throw new Error("Owned loopback forge_test fixture required")
      admin = new Client({ connectionString: url.toString() })
      await admin.connect()
      await admin.query(`CREATE DATABASE "${databaseName}"`)
      created = true
      url.pathname = `/${databaseName}`
      childUrl = url.toString()
      migration = new Client({ connectionString: childUrl })
      await migration.connect()
      const root = new URL("../../../prisma/migrations/", import.meta.url)
      for (const name of readdirSync(root)
        .filter((name) => /^\d{4}_/.test(name))
        .sort())
        await migration.query(
          readFileSync(new URL(`${name}/migration.sql`, root), "utf8"),
        )
      await migration.end()
      // A single pool connection also proves callbacks do not hold a connection
      // while queuing another authority transaction behind themselves.
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: childUrl, max: 1 }),
      })
      blocker = new Client({ connectionString: childUrl })
      await blocker.connect()
    }, 120_000)
    afterAll(async () => {
      await blocker?.end().catch(() => {})
      await db?.$disconnect()
      await migration?.end().catch(() => {})
      if (admin) {
        if (created)
          await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`)
        await admin.end()
      }
    })

    it("activates without study records, composes/records only actual influence, and fails closed on source/privacy races", async () => {
      const source = await seedOwnerDeliveryGraph(db)
      const { graph } = source
      const emptyStudyCounts = async () => ({
        studies: await db.recommendationStudy.count(),
        assignments: await db.recommendationExperimentAssignment.count(),
        shadowEvaluations: await db.recommendationShadowEvaluation.count(),
        compositionProtocols:
          await db.recommendationCompositionProtocol.count(),
      })
      const before = await emptyStudyCounts()
      expect(before).toEqual({
        studies: 0,
        assignments: 0,
        shadowEvaluations: 0,
        compositionProtocols: 0,
      })
      const operator = new RecommendationOwnerReleaseOperator({ prisma: db })
      const pointer = await db.recommendationPromotionPointer.findUniqueOrThrow(
        { where: { id: "recommendation-promotion-pointer" } },
      )
      const operation = {
        actor: { id: "native-owner-operator", role: "ADMIN" as const },
        authenticatedAt: new Date(),
        operationId: randomUUID(),
        expectedPointerGeneration: pointer.generation,
        graphGenerationId: graph.graphGenerationId,
      }
      // Migration 0060 seeds a legacy active A/A config. The real operator must
      // refuse it; release its authority through the supported stop operator.
      await expect(operator.prepare(operation)).rejects.toThrow("overlaps")
      const promotion = createRecommendationPromotionService(db)
      const stopped = await promotion.setKillSwitch({
        actor: operation.actor,
        expectedPointerGeneration: pointer.generation,
        enabled: true,
        reason: "owner_direct_activation",
      })
      const cleared = await promotion.setKillSwitch({
        actor: operation.actor,
        expectedPointerGeneration: stopped.generation,
        enabled: false,
        reason: "owner_direct_activation",
      })
      operation.expectedPointerGeneration = cleared.generation
      expect(
        await db.recommendationExperiment.count({ where: { state: "ACTIVE" } }),
      ).toBe(0)
      const prepared = await operator.prepare(operation)
      if (prepared.status !== "prepared")
        throw new Error("Expected fresh native preparation")
      const activated = await operator.activate({
        ...operation,
        bindingDigest: prepared.bindingDigest,
      })
      expect(activated.status).toBe("active")
      const compose = vi.fn(
        (input: Parameters<typeof composeDeliveryOwnerCowatch>[1]) =>
          composeDeliveryOwnerCowatch(db, input),
      )
      const harness = makeHarness({
        database: db,
        candidateTraceFormat: "compact",
        servedItemFormat: "packed",
        profileComparison: true,
        owner: {
          resolveOwnerAuthority: (input) =>
            resolveDeliveryOwnerAuthority(db, input),
          composeOwnerCowatch: compose,
        },
      })
      harness.retrieve.mockResolvedValue(semanticCandidates(6))
      const profile = {
        ...profileCandidateResult,
        projection: {
          ...profileCandidateResult.projection,
          id: source.projection.id,
          scope: "durable" as const,
          generation: 1,
          inputDigest: source.projection.inputDigest,
          publishedAt: source.projection.publishedAt,
          expiresAt: graph.expiresAt,
          sessionIntentPresent: false,
        },
        nominations: profileCandidateResult.nominations.map((row) => ({
          ...row,
          source: {
            ...row.source,
            evidence: { ...row.source.evidence, interestKind: "durable" },
          },
        })),
      }
      harness.retrieveProfile.mockResolvedValue(profile)
      const input = {
        ...personalizedInput(graph.mediaA),
        sessionDigest: graph.sessionDigest,
        profileTokenDigest: createHash("sha256")
          .update(graph.profileId)
          .digest("hex"),
        consentReceiptDigest: source.consentReceiptDigest,
        clientDeliveryContract: "cowatch-mmr-v1",
      }
      const elapsedMs: number[] = []
      const requestIds: string[] = []
      for (let run = 0; run < 2; run++) {
        const startedAt = performance.now()
        const response = await harness.service.deliver(input)
        elapsedMs.push(performance.now() - startedAt)
        expect(response).toMatchObject({
          result: "served",
          personalization: {
            executionMode: "cowatch_mmr_personalized",
            effectiveManifestId: OWNER_APPROVED_COWATCH_MMR_MANIFEST_ID,
          },
        })
        expect(
          response.items.some(
            (row) => row.candidateGenerator === "directional-cowatch",
          ),
        ).toBe(true)
        requestIds.push(response.requestId!)
        const saved = await db.recommendationRequest.findUniqueOrThrow({
          where: { id: response.requestId! },
          include: { candidateRun: true },
        })
        expect(saved).toMatchObject({
          ownerReleaseId: operation.operationId,
          ownerReleaseGeneration: activated.pointerGeneration,
          experimentAssignmentId: null,
          state: "ISSUED",
          servedItemPayload: { version: 1 },
        })
        const trace = JSON.stringify(saved.candidateRun?.tracePayload)
        expect(trace.match(/ownerBindingDigest/g)).toHaveLength(1)
        expect(trace).toContain(prepared.bindingDigest)
        expect(trace).not.toContain("studyProtocolDigest")
        expect(await ownerReleaseInfluenceAllowed(db, saved)).toBe(true)
        const item = await db.recommendationServedItem.findFirstOrThrow({
          where: { requestId: saved.id },
        })
        const exposureRecorded = await db.$transaction((tx) =>
          recordFirstEligiblePromotionExposure(tx, {
            effectiveManifestId: saved.manifestId,
            requestId: saved.id,
            itemId: item.id,
            occurredAt: new Date(),
            receivedAt: new Date(),
          }),
        )
        expect(exposureRecorded).toBe(run === 0)
      }
      expect(elapsedMs.every((elapsed) => elapsed < 1_500)).toBe(true)
      expect(harness.assignProfileExperiment).not.toHaveBeenCalled()
      console.info(
        JSON.stringify({
          fixture: "owned-local-owner-delivery",
          poolConnections: 1,
          completePathColdMs: elapsedMs[0],
          completePathWarmMs: elapsedMs[1],
          productionClearance: false,
        }),
      )

      // A still-loaded old tab has no capability. No fake sticky assignment or
      // direct provenance is emitted; a capable tab can subsequently use release.
      for (const clientDeliveryContract of [null, "unknown-parser"]) {
        const response = await harness.service.deliver({
          ...input,
          clientDeliveryContract,
        })
        expect(response.personalization?.executionMode).toBe(
          "hybrid_personalized",
        )
        expect(
          response.items.every(
            (row) => row.candidateGenerator !== "directional-cowatch",
          ),
        ).toBe(true)
        const saved = await db.recommendationRequest.findUniqueOrThrow({
          where: { id: response.requestId! },
        })
        expect(saved).toMatchObject({
          ownerReleaseId: null,
          ownerReleaseGeneration: null,
          experimentAssignmentId: null,
        })
      }
      const resumed = await harness.service.deliver(input)
      expect(resumed.personalization?.executionMode).toBe(
        "cowatch_mmr_personalized",
      )

      // Current catalog input genuinely missing: the real MMR structural helper
      // must discard graph candidates and retain the exact prepared incumbent.
      await db.video.update({
        where: { id: graph.mediaB },
        data: { deletedAt: new Date() },
      })
      const unplayable = await harness.service.deliver(input)
      expect(unplayable).toMatchObject({
        result: "fallback",
        reason: "cowatch_unplayable",
        personalization: {
          effectiveManifestId: INCUMBENT_HYBRID_MANIFEST_ID,
          executionMode: "hybrid_personalized",
        },
      })
      expect(
        unplayable.items.every(
          (row) => row.candidateGenerator !== "directional-cowatch",
        ),
      ).toBe(true)
      expect(
        await db.recommendationRequest.findUniqueOrThrow({
          where: { id: unplayable.requestId! },
        }),
      ).toMatchObject({ ownerReleaseId: null, ownerReleaseGeneration: null })
      await db.video.update({
        where: { id: graph.mediaB },
        data: { deletedAt: null },
      })

      // A blocked indexed edge read respects the same request budget and leaves
      // enough reserved time for incumbent issuance. The owned lock is released.
      await blocker.query("BEGIN")
      await blocker.query(
        "LOCK TABLE recommendation_cowatch_edge IN ACCESS EXCLUSIVE MODE",
      )
      try {
        const startedAt = performance.now()
        const slow = await harness.service.deliver(input)
        expect(performance.now() - startedAt).toBeLessThan(1_500)
        expect(slow.result).toBe("fallback")
        expect(
          slow.items.every(
            (row) => row.candidateGenerator !== "directional-cowatch",
          ),
        ).toBe(true)
        expect(slow.personalization?.effectiveManifestId).toBe(
          INCUMBENT_HYBRID_MANIFEST_ID,
        )
      } finally {
        await blocker.query("ROLLBACK")
      }

      // A profile can legitimately contain older qualified evidence outside
      // this graph's source window. Changing it must fence both a completed
      // owner slate and its previously prepared personalized incumbent fallback.
      for (const returnFallback of [false, true]) {
        const outsideId = randomUUID()
        const outsideTime = new Date(
          graph.sourceWindow.windowStart.getTime() - 86_400_000,
        )
        const originalEpisode =
          await db.recommendationPlaybackEpisode.findUniqueOrThrow({
            where: { id: graph.episodes[0]! },
          })
        await db.recommendationPlaybackEpisode.create({
          data: {
            ...originalEpisode,
            provenance: originalEpisode.provenance ?? Prisma.JsonNull,
            id: outsideId,
            createdAt: outsideTime,
            claimedAt: outsideTime,
            finalizedAt: outsideTime,
          },
        })
        const originalOutcome =
          await db.recommendationOutcomeRevision.findUniqueOrThrow({
            where: { id: `${graph.episodes[0]}-r1` },
          })
        const outsideOutcome = await db.recommendationOutcomeRevision.create({
          data: {
            ...originalOutcome,
            activeIntervals: undefined,
            id: `${outsideId}-r1`,
            episodeId: outsideId,
            inputDigest: createHash("sha256").update(outsideId).digest("hex"),
            createdAt: outsideTime,
          },
        })
        const originalDecision =
          await db.recommendationEligibilityDecision.findUniqueOrThrow({
            where: { id: `${graph.episodes[0]}-eligible` },
          })
        const outsideDecision =
          await db.recommendationEligibilityDecision.create({
            data: {
              ...originalDecision,
              id: `${outsideId}-eligible`,
              sourceKey: outsideId,
              outcomeId: outsideOutcome.id,
            },
          })
        const outsideProjection =
          await db.recommendationProfileProjectionGeneration.create({
            data: {
              ...source.projection,
              id: randomUUID(),
              state: "BUILDING",
              publishedAt: null,
              generation: returnFallback ? 3 : 2,
              inputWindowStart: outsideTime,
              inputDigest: createHash("sha256")
                .update(`${outsideId}-projection`)
                .digest("hex"),
            },
          })
        const originalContribution =
          await db.recommendationProfileProjectionContribution.findFirstOrThrow(
            { where: { generationId: source.projection.id } },
          )
        await db.recommendationProfileProjectionContribution.create({
          data: {
            ...originalContribution,
            id: randomUUID(),
            generationId: outsideProjection.id,
            sourceIdDigest: outsideOutcome.inputDigest,
            sourceOutcomeId: outsideOutcome.id,
            sourceEligibilityDecisionId: outsideDecision.id,
            occurredAt: outsideTime,
          },
        })
        await db.$executeRaw`
          INSERT INTO recommendation_profile_interest
            (id, generation_id, kind, interest_ordinal, medoid_media_id, medoid_source_digest, embedding, weight, support_count, stability, expires_at)
          SELECT ${randomUUID()}, ${outsideProjection.id}, kind, interest_ordinal, medoid_media_id,
            ${outsideOutcome.inputDigest}, embedding, weight, support_count, stability, expires_at
          FROM recommendation_profile_interest WHERE generation_id = ${source.projection.id}
        `
        const publishedAt = new Date()
        await db.recommendationProfileProjectionGeneration.update({
          where: { id: outsideProjection.id },
          data: { state: "PUBLISHED", publishedAt },
        })
        await db.recommendationProfileProjectionPointer.update({
          where: { generationId: source.projection.id },
          data: {
            generationId: outsideProjection.id,
            pointerGeneration: { increment: 1 },
          },
        })
        expect(
          await db.recommendationCowatchSourceContribution.count({
            where: {
              generationId: graph.graphGenerationId,
              outcomeId: outsideOutcome.id,
            },
          }),
        ).toBe(0)
        harness.retrieveProfile.mockResolvedValueOnce({
          ...profile,
          projection: {
            ...profile.projection,
            id: outsideProjection.id,
            generation: outsideProjection.generation,
            inputDigest: outsideProjection.inputDigest,
            publishedAt,
          },
        })
        const beforeSourceRace = await db.recommendationRequest.count()
        compose.mockImplementationOnce(async (candidateInput) => {
          const result = await composeDeliveryOwnerCowatch(db, candidateInput)
          expect(result.status).toBe("composed")
          await db.recommendationEligibilityDecision.update({
            where: { id: outsideDecision.id },
            data: { isCurrent: false },
          })
          if (!returnFallback) return result
          const fallback = await composeDeliveryOwnerCowatch(db, candidateInput)
          expect(fallback.status).toBe("fallback")
          return fallback
        })
        expect(await harness.service.deliver(input)).toMatchObject({
          result: "unavailable",
          items: [],
        })
        expect(await db.recommendationRequest.count()).toBe(beforeSourceRace)
        expect(
          (
            await db.recommendationOwnerRelease.findUniqueOrThrow({
              where: { id: operation.operationId },
            })
          ).revokedAt,
        ).toBeNull()
        expect(
          (
            await db.recommendationCowatchGeneration.findUniqueOrThrow({
              where: { id: graph.graphGenerationId },
            })
          ).invalidatedAt,
        ).toBeNull()
        await db.recommendationProfileProjectionPointer.update({
          where: { generationId: outsideProjection.id },
          data: {
            generationId: source.projection.id,
            pointerGeneration: { increment: 1 },
          },
        })
      }

      // Real source reset after composition but before issuance must abort the
      // signed response, not issue a stale slate or create a request afterward.
      const beforeRace = await db.recommendationRequest.count()
      compose.mockImplementationOnce(async (candidateInput) => {
        const result = await composeDeliveryOwnerCowatch(db, candidateInput)
        expect(result.status).toBe("composed")
        await db.recommendationProfile.update({
          where: { id: graph.profileId },
          data: { privacyGeneration: { increment: 1 } },
        })
        return result
      })
      const raced = await harness.service.deliver(input)
      expect(raced).toMatchObject({ result: "unavailable", items: [] })
      expect(await db.recommendationRequest.count()).toBe(beforeRace)
      const release = await db.recommendationOwnerRelease.findUniqueOrThrow({
        where: { id: operation.operationId },
      })
      expect(release.revokedAt).not.toBeNull()
      expect(
        await ownerReleaseInfluenceAllowed(db, {
          id: requestIds[0]!,
          ownerReleaseId: operation.operationId,
        }),
      ).toBe(false)
      expect(await emptyStudyCounts()).toEqual(before)
    }, 30_000)

    it("refresh preserves previous influence and stop fences all releases without revival", async () => {
      const operator = new RecommendationOwnerReleaseOperator({ prisma: db })
      const promotion = createRecommendationPromotionService(db)
      const actor = { id: "native-owner-operator", role: "ADMIN" as const }
      const { items, servedItemPayload, deliveryDiagnostics, ...template } =
        await db.recommendationRequest.findFirstOrThrow({
          include: { items: true },
        })
      const templateItems = items.map((item) =>
        servedSnapshotValue(servedItemPayload, item),
      )
      const requests: Array<{ id: string; ownerReleaseId: string }> = []
      let lastOperation: Parameters<typeof operator.activate>[0] | undefined
      for (let index = 0; index < 2; index++) {
        const source = await seedOwnerDeliveryGraph(db)
        const pointer =
          await db.recommendationPromotionPointer.findUniqueOrThrow({
            where: { id: "recommendation-promotion-pointer" },
          })
        const operation = {
          actor,
          authenticatedAt: new Date(),
          operationId: randomUUID(),
          expectedPointerGeneration: pointer.generation,
          graphGenerationId: source.graph.graphGenerationId,
        }
        const prepared = await operator.prepare(operation)
        if (prepared.status !== "prepared")
          throw new Error("Expected fresh release")
        lastOperation = { ...operation, bindingDigest: prepared.bindingDigest }
        const activated = await operator.activate(lastOperation)
        expect(activated.status).toBe("active")
        const request = await db.recommendationRequest.create({
          data: {
            ...template,
            deliveryDiagnostics: deliveryDiagnostics ?? Prisma.DbNull,
            id: randomUUID(),
            deliveryJti: randomUUID(),
            ownerReleaseId: operation.operationId,
            ownerReleaseGeneration: activated.pointerGeneration,
            createdAt: new Date(),
            issuedAt: new Date(),
            items: {
              create: templateItems.map((item) => ({
                id: randomUUID(),
                position: item.position,
                targetMediaId: item.targetMediaId,
                canonicalHref: item.canonicalHref,
                candidateGenerator: item.candidateGenerator,
                candidateProvenance: item.candidateProvenance ?? {},
                presentation: item.presentation ?? {},
                capabilityJti: randomUUID(),
                signingKid: item.signingKid,
                expiresAt: item.expiresAt,
              })),
            },
          },
        })
        requests.push({ id: request.id, ownerReleaseId: operation.operationId })
        for (const retained of requests)
          expect(await ownerReleaseInfluenceAllowed(db, retained)).toBe(true)
      }
      const pointer = await db.recommendationPromotionPointer.findUniqueOrThrow(
        { where: { id: "recommendation-promotion-pointer" } },
      )
      const stopped = await promotion.setKillSwitch({
        actor,
        expectedPointerGeneration: pointer.generation,
        enabled: true,
        reason: "native_stop",
      })
      for (const retained of requests)
        expect(await ownerReleaseInfluenceAllowed(db, retained)).toBe(false)
      const cleared = await promotion.setKillSwitch({
        actor,
        expectedPointerGeneration: stopped.generation,
        enabled: false,
        reason: "native_clear",
      })
      for (const retained of requests)
        expect(await ownerReleaseInfluenceAllowed(db, retained)).toBe(false)
      expect((await operator.activate(lastOperation!)).status).toBe("revoked")
      expect(
        (
          await db.recommendationPromotionPointer.findUniqueOrThrow({
            where: { id: pointer.id },
          })
        ).generation,
      ).toBe(cleared.generation)
    }, 30_000)
  },
)
