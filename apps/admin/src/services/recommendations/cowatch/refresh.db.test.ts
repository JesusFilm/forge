import { createHash, randomUUID } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { env } from "@/config/env"
import { RecommendationOwnerReleaseOperator } from "../promotion/owner-operator"
import { readActiveOwnerRelease } from "../promotion/owner-authority"
import { createRecommendationPromotionService } from "../promotion/service"
import { RECOMMENDATION_INTEGRITY_POLICY_VERSION } from "../integrity-policy"
import {
  preflightCowatchShadowGeneration,
  publishCowatchShadowGeneration,
  readCowatchPublicationCapacity,
} from "./projection.service"
import { RecommendationCowatchRefreshService } from "./refresh.service"
import { purgeExpiredCowatchRefreshMetadata } from "./refresh-retention"
import {
  COWATCH_REFRESH_INTERVAL_MS,
  type CowatchRefreshBudget,
} from "./refresh-policy"

const day = 86_400_000
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex")
const actor = { id: "owned-refresh-fixture", role: "ADMIN" as const }
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const budget: CowatchRefreshBudget = {
  publicationLimits: {
    rawSourceCount: 50_000,
    sourceCount: 50_000,
    attemptedPairCount: 250_000,
    contributionCount: 250_000,
    edgeCount: 250_000,
    publicationRowCount: 550_001,
    graphRowJsonBytes: {
      sources: { maximum: 2000, total: 100_000_000 },
      contributions: { maximum: 2000, total: 500_000_000 },
      edges: { maximum: 2000, total: 500_000_000 },
    },
  },
  publicationReserveBytes: 1_048_576,
  maxRetainedGraphBytes: 268_435_456,
  maxRetainedGenerations: 64,
  maxDatabaseBytes: 1_099_511_627_776,
}

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "bounded owner refresh on owned PostgreSQL",
  () => {
    const databaseName = `cowatch_refresh_${randomUUID().replaceAll("-", "")}`
    let admin: Client, migration: Client, db: PrismaClient
    let created = false,
      ordinal = 0
    const initialNow = new Date()
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
      migration = new Client({ connectionString: url.toString() })
      await migration.connect()
      const root = new URL("../../../../prisma/migrations/", import.meta.url)
      for (const name of readdirSync(root)
        .filter((name) => /^\d{4}_/.test(name))
        .sort())
        await migration.query(
          readFileSync(new URL(`${name}/migration.sql`, root), "utf8"),
        )
      await migration.end()
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url.toString(), max: 4 }),
      })
    }, 120_000)
    afterEach(() => vi.useRealTimers())
    afterAll(async () => {
      await db?.$disconnect()
      await migration?.end().catch(() => {})
      if (admin) {
        if (created)
          await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`)
        await admin.end()
      }
    })

    async function activeFixture(
      overrides: Partial<CowatchRefreshBudget> = {},
    ) {
      const now = new Date(initialNow.getTime() + ordinal++ * 2 * day)
      vi.useFakeTimers({ toFake: ["Date"] })
      vi.setSystemTime(now)
      const promotion = createRecommendationPromotionService(db)
      let pointer = await db.recommendationPromotionPointer.findUniqueOrThrow({
        where: { id: "recommendation-promotion-pointer" },
      })
      const stop = await promotion.setKillSwitch({
        actor,
        expectedPointerGeneration: pointer.generation,
        enabled: true,
        reason: "owned_refresh_fixture",
      })
      await promotion.setKillSwitch({
        actor,
        expectedPointerGeneration: stop.generation,
        enabled: false,
        reason: "owned_refresh_fixture",
      })
      const prefix = randomUUID(),
        start = new Date(now.getTime() - 2 * day),
        expiresAt = new Date(now.getTime() + 28 * day)
      let firstDecision = ""
      for (let viewer = 0; viewer < 20; viewer++)
        for (const [position, mediaId] of (viewer < 10
          ? [prefix + "-a", prefix + "-b"]
          : [prefix + "-c"]
        ).entries()) {
          const id = `${prefix}-${viewer}-${position}`,
            occurredAt = new Date(start.getTime() + position * 1_000)
          await db.recommendationPlaybackEpisode.create({
            data: {
              id,
              mediaId,
              sessionDigest: digest(`${prefix}-${viewer}`),
              state: "FINALIZED",
              nextFactSequence: 2,
              activeUntil: new Date(occurredAt.getTime() + 4 * 3_600_000),
              hardUntil: new Date(occurredAt.getTime() + 6 * 3_600_000),
              finalizedAt: occurredAt,
              claimedAt: occurredAt,
              createdAt: occurredAt,
              expiresAt,
            },
          })
          await db.recommendationOutcomeRevision.create({
            data: {
              id: id + "-outcome",
              episodeId: id,
              classifierVersion: "active-watch-proxy-v1",
              factWatermark: 1,
              inputDigest: digest(id),
              revision: 1,
              qualifiedView: true,
              viewQualityWeight: 1,
              viewQualityWeightReason: "active_fraction_of_duration",
              activePlaybackMilliseconds: 30_000,
              durationSeconds: 30,
              durationCohort: "short",
              activeCoverage: "complete",
              generation: 1,
              createdAt: occurredAt,
              expiresAt,
            },
          })
          await db.recommendationEligibilityDecision.create({
            data: {
              id: id + "-eligible",
              sourceType: "PLAYBACK_OUTCOME",
              sourceKey: id,
              outcomeId: id + "-outcome",
              policyVersion: RECOMMENDATION_INTEGRITY_POLICY_VERSION,
              revision: 1,
              actorClass: "HUMAN_ANONYMOUS",
              state: "ELIGIBLE",
              eligibleScopes: ["aggregate", "profile"],
              contributionWeight: 1,
              contributionOrdinal: 1,
              distinctSupport: 20,
              identityConcentration: 0.05,
              inputDigest: digest(id + "-eligible"),
              expiresAt,
            },
          })
          if (!firstDecision) firstDecision = id + "-eligible"
        }
      const publication = await publishCowatchShadowGeneration(db, now, {
        version: "episode-event-window-v1",
        windowStart: start,
        windowEnd: new Date(start.getTime() + 3_600_000),
        evaluationAsOf: now,
      })
      expect(publication.status).toBe("published")
      pointer = await db.recommendationPromotionPointer.findUniqueOrThrow({
        where: { id: pointer.id },
      })
      const operator = new RecommendationOwnerReleaseOperator({ prisma: db })
      const input = {
        actor,
        authenticatedAt: now,
        operationId: randomUUID(),
        expectedPointerGeneration: pointer.generation,
        graphGenerationId: publication.generation!,
      }
      const prepared = await operator.prepare(input)
      const release = await operator.activate({
        ...input,
        bindingDigest: prepared.bindingDigest,
      })
      const service = new RecommendationCowatchRefreshService({
        prisma: db,
        invalidateCaches: vi.fn(),
      })
      const authorization = {
        actor,
        authenticatedAt: now,
        operationId: randomUUID(),
        expectedPointerGeneration: release.pointerGeneration,
        budget: { ...budget, ...overrides },
      }
      const status = await service.authorize(authorization)
      return {
        service,
        now,
        authorization,
        grantId: status.grant!.id,
        release,
        publication,
        firstDecision,
      }
    }

    it("requires exact recent owner auth, replays one grant, and atomically replaces after the fixed cadence", async () => {
      const fixture = await activeFixture()
      expect(
        await fixture.service.authorize(fixture.authorization),
      ).toMatchObject({ grant: { id: fixture.grantId }, status: "ready" })
      await expect(
        fixture.service.authorize({
          ...fixture.authorization,
          budget: { ...budget, maxDatabaseBytes: budget.maxDatabaseBytes - 1 },
        }),
      ).rejects.toThrow(/already binds/)
      await expect(
        fixture.service.authorize({
          ...fixture.authorization,
          authenticatedAt: null,
        }),
      ).rejects.toThrow(/recent/)
      await expect(
        fixture.service.authorize({
          ...fixture.authorization,
          actor: { id: "system", role: "SYSTEM" },
        }),
      ).rejects.toThrow(/Permission/)
      expect(await fixture.service.run()).toEqual({ status: "idle" })
      vi.setSystemTime(
        new Date(fixture.now.getTime() + COWATCH_REFRESH_INTERVAL_MS + 60_000),
      )
      const result = await fixture.service.run()
      expect(result.status).toBe("succeeded")
      const release = await readActiveOwnerRelease(db, new Date())
      expect(release?.releaseId).toBe(result.operationId)
      expect(release?.pointerGeneration).toBe(
        fixture.release.pointerGeneration + 1,
      )
      expect(await fixture.service.run()).toEqual({ status: "idle" })
      const event = await db.recommendationPromotionEvent.findUniqueOrThrow({
        where: { dedupeKey: `owner-release:${result.operationId}` },
      })
      expect(event).toMatchObject({
        actorClass: "system",
        actorId: null,
        reasonCode: "owner_delegated_graph_refresh",
        details: expect.objectContaining({ refreshGrantId: fixture.grantId }),
      })
    })

    it("keeps source revocation immutable, serves fallback while throttled, and replaces with current qualified sources", async () => {
      const fixture = await activeFixture()
      await db.recommendationEligibilityDecision.update({
        where: { id: fixture.firstDecision },
        data: { state: "EXCLUDED", eligibleScopes: [], contributionWeight: 0 },
      })
      const revoked = await db.recommendationOwnerRelease.findUniqueOrThrow({
        where: { id: fixture.release.operationId },
      })
      expect(revoked.revocationReason).toBe("eligibility_changed")
      expect((await fixture.service.inspect()).status).toBe(
        "fallback_throttled",
      )
      expect(await fixture.service.run()).toEqual({ status: "idle" })
      vi.setSystemTime(
        new Date(fixture.now.getTime() + COWATCH_REFRESH_INTERVAL_MS + 60_000),
      )
      expect((await fixture.service.run()).status).toBe("succeeded")
      expect(
        await db.recommendationOwnerRelease.findUnique({
          where: { id: revoked.id },
        }),
      ).toMatchObject({
        revokedAt: revoked.revokedAt,
        revocationReason: "eligibility_changed",
      })
      expect(await readActiveOwnerRelease(db, new Date())).not.toBeNull()
    })

    it("reconciles a lost graph publication acknowledgement with the original graph and operation", async () => {
      const fixture = await activeFixture()
      vi.setSystemTime(
        new Date(fixture.now.getTime() + COWATCH_REFRESH_INTERVAL_MS + 60_000),
      )
      const publish = vi.fn(
        async (...args: Parameters<typeof publishCowatchShadowGeneration>) => {
          const result = await publishCowatchShadowGeneration(...args)
          if (publish.mock.calls.length === 1)
            throw new Error("lost publication acknowledgement")
          return result
        },
      )
      const service = new RecommendationCowatchRefreshService({
        prisma: db,
        publish,
      })
      const first = await service.run()
      expect(first.status).toBe("acknowledgement_unknown")
      const pending =
        await db.recommendationCowatchRefreshAttempt.findUniqueOrThrow({
          where: { id: first.operationId },
        })
      const graph = await db.recommendationCowatchGeneration.findUniqueOrThrow({
        where: { id: pending.expectedGraphGenerationId! },
      })
      vi.setSystemTime(new Date(Date.now() + 4 * 60_000))
      expect(await service.run()).toEqual({
        status: "succeeded",
        operationId: first.operationId,
      })
      expect(
        await db.recommendationCowatchGeneration.findUnique({
          where: { id: graph.id },
        }),
      ).toMatchObject({
        publishedAt: graph.publishedAt,
        expiresAt: graph.expiresAt,
      })
      expect(
        await db.recommendationOwnerRelease.count({
          where: { id: first.operationId },
        }),
      ).toBe(1)
    })

    it("does not defer an already-due publication when an owner renews near graph expiry", async () => {
      const fixture = await activeFixture()
      vi.setSystemTime(new Date(fixture.now.getTime() + 23 * 3_600_000))
      await fixture.service.authorize({
        ...fixture.authorization,
        operationId: randomUUID(),
        authenticatedAt: new Date(),
      })
      expect((await fixture.service.run()).status).toBe("succeeded")
      expect(
        (await readActiveOwnerRelease(db, new Date()))?.pointerGeneration,
      ).toBe(fixture.release.pointerGeneration + 1)
    })

    it("fences a worker paused beyond its lease without terminalizing the resumed operation", async () => {
      const fixture = await activeFixture()
      vi.setSystemTime(
        new Date(fixture.now.getTime() + COWATCH_REFRESH_INTERVAL_MS + 60_000),
      )
      const before = await db.recommendationCowatchGeneration.count()
      const firstReady = deferred(),
        firstResume = deferred()
      const secondReady = deferred(),
        secondResume = deferred()
      const first = new RecommendationCowatchRefreshService({
        prisma: db,
        preflight: async (...args) => {
          firstReady.resolve()
          await firstResume.promise
          return preflightCowatchShadowGeneration(...args)
        },
      })
      const second = new RecommendationCowatchRefreshService({
        prisma: db,
        preflight: async (...args) => {
          secondReady.resolve()
          await secondResume.promise
          return preflightCowatchShadowGeneration(...args)
        },
      })
      const firstRun = first.run()
      await firstReady.promise
      vi.setSystemTime(new Date(Date.now() + 4 * 60_000))
      const secondRun = second.run()
      await secondReady.promise
      firstResume.resolve()
      const stale = await firstRun
      expect(stale.status).toBe("acknowledgement_unknown")
      expect(
        await db.recommendationCowatchRefreshAttempt.findUnique({
          where: { id: stale.operationId },
        }),
      ).toMatchObject({ status: "running" })
      secondResume.resolve()
      expect(await secondRun).toEqual({
        status: "succeeded",
        operationId: stale.operationId,
      })
      expect(await db.recommendationCowatchGeneration.count()).toBe(before + 1)
      expect(
        await db.recommendationCowatchRefreshAttempt.findUnique({
          where: { id: stale.operationId },
        }),
      ).toMatchObject({ status: "succeeded" })
    })

    it("fences a stop between preflight and publication without publishing or changing owner authority", async () => {
      const fixture = await activeFixture()
      vi.setSystemTime(
        new Date(fixture.now.getTime() + COWATCH_REFRESH_INTERVAL_MS + 60_000),
      )
      const before = await db.recommendationCowatchGeneration.count()
      const service = new RecommendationCowatchRefreshService({
        prisma: db,
        publish: async (...args) => {
          await fixture.service.disable({ actor, grantId: fixture.grantId })
          return publishCowatchShadowGeneration(...args)
        },
      })

      expect(await service.run()).toMatchObject({
        status: "refused",
        reasonCode: "refresh_authority_fenced",
      })
      expect(await db.recommendationCowatchGeneration.count()).toBe(before)
      expect((await service.inspect()).status).toBe("stopped")
      expect((await readActiveOwnerRelease(db, new Date()))?.releaseId).toBe(
        fixture.release.operationId,
      )
    })

    it("preserves full-window bounds and incumbent authority on population refusal", async () => {
      const fixture = await activeFixture({
        publicationLimits: { ...budget.publicationLimits, rawSourceCount: 0 },
      })
      vi.setSystemTime(
        new Date(fixture.now.getTime() + COWATCH_REFRESH_INTERVAL_MS + 60_000),
      )
      const before = await db.recommendationCowatchGeneration.count()
      expect(await fixture.service.run()).toMatchObject({
        status: "refused",
        reasonCode: "publication_admission_count_exceeded",
      })
      expect(await db.recommendationCowatchGeneration.count()).toBe(before)
      const attempt =
        await db.recommendationCowatchRefreshAttempt.findFirstOrThrow({
          where: { grantId: fixture.grantId },
        })
      expect(attempt.windowEnd.getTime() - attempt.windowStart.getTime()).toBe(
        7 * day,
      )
      expect(await fixture.service.run()).toEqual({ status: "idle" })
    })

    it("fences a stop and clear forever and does not let expired grants renew authority", async () => {
      const fixture = await activeFixture()
      const promotion = createRecommendationPromotionService(db)
      const stopped = await promotion.setKillSwitch({
        actor,
        expectedPointerGeneration: fixture.release.pointerGeneration,
        enabled: true,
        reason: "fixture_stop",
      })
      await promotion.setKillSwitch({
        actor,
        expectedPointerGeneration: stopped.generation,
        enabled: false,
        reason: "fixture_clear",
      })
      vi.setSystemTime(
        new Date(fixture.now.getTime() + COWATCH_REFRESH_INTERVAL_MS + 60_000),
      )
      expect(await fixture.service.run()).toEqual({ status: "idle" })
      expect((await fixture.service.inspect()).status).toBe("stopped")
      expect(await readActiveOwnerRelease(db, new Date())).toBeNull()
      const next = await activeFixture()
      vi.setSystemTime(new Date(next.now.getTime() + 30 * day))
      expect((await next.service.inspect()).status).toBe("expired")
      expect(await next.service.run()).toEqual({ status: "idle" })
      expect((await next.service.inspect()).status).toBe("stopped")
    })

    it("reconciles a committed activation before a renewed grant and lost acknowledgement can mislabel it", async () => {
      const fixture = await activeFixture()
      vi.setSystemTime(
        new Date(fixture.now.getTime() + COWATCH_REFRESH_INTERVAL_MS + 60_000),
      )
      const invalidateCaches = vi.fn()
      let renewed = false
      const ambiguousDb = new Proxy(db, {
        get(target, key) {
          if (key !== "$transaction") return Reflect.get(target, key)
          return async (...args: unknown[]) => {
            const result: unknown = await Reflect.apply(
              target.$transaction,
              target,
              args,
            )
            if (
              !renewed &&
              result &&
              typeof result === "object" &&
              "graphGenerationId" in result &&
              "pointerGeneration" in result &&
              typeof result.pointerGeneration === "number"
            ) {
              renewed = true
              await fixture.service.authorize({
                actor,
                authenticatedAt: new Date(),
                operationId: randomUUID(),
                expectedPointerGeneration: result.pointerGeneration,
                budget,
              })
              throw new Error("accepted activation acknowledgement lost")
            }
            return result
          }
        },
      })
      const service = new RecommendationCowatchRefreshService({
        prisma: ambiguousDb,
        invalidateCaches,
      })
      const result = await service.run()
      expect(result.status).toBe("succeeded")
      expect(renewed).toBe(true)
      expect(
        await db.recommendationCowatchRefreshAttempt.findUnique({
          where: { id: result.operationId },
        }),
      ).toMatchObject({
        status: "succeeded",
        pointerGeneration: fixture.release.pointerGeneration + 1,
      })
      expect(
        await db.recommendationOwnerRelease.count({
          where: { id: result.operationId },
        }),
      ).toBe(1)
      expect(invalidateCaches).toHaveBeenCalledOnce()
      expect(
        await db.recommendationCowatchRefreshGrant.findUnique({
          where: { id: fixture.grantId },
        }),
      ).toMatchObject({ revocationReason: "superseded_authorization" })
    })

    it("purges only expired terminal audit metadata and preserves pending attempts and all graph sources", async () => {
      const fixture = await activeFixture()
      const expired = new Date(initialNow.getTime() - 2556 * day)
      const active =
        await db.recommendationCowatchRefreshGrant.findUniqueOrThrow({
          where: { id: fixture.grantId },
        })
      const old = await db.recommendationCowatchRefreshGrant.create({
        data: {
          ...active,
          budget,
          id: randomUUID(),
          approvedAt: expired,
          validUntil: new Date(expired.getTime() + 29 * day),
          revokedAt: expired,
          revocationReason: "fixture_expired",
        },
      })
      const pendingGrant = await db.recommendationCowatchRefreshGrant.create({
        data: { ...old, budget, id: randomUUID() },
      })
      const attemptData = {
        expectedPointerGeneration: 1,
        windowStart: new Date(expired.getTime() - 7 * day - 7 * 3_600_000),
        windowEnd: new Date(expired.getTime() - 7 * 3_600_000),
        evaluationAsOf: expired,
        startedAt: expired,
        leaseUntil: expired,
      }
      await db.recommendationCowatchRefreshAttempt.create({
        data: {
          ...attemptData,
          id: randomUUID(),
          grantId: old.id,
          status: "refused",
          completedAt: expired,
          reason: "fixture_refused",
        },
      })
      const pending = await db.recommendationCowatchRefreshAttempt.create({
        data: {
          ...attemptData,
          id: randomUUID(),
          grantId: pendingGrant.id,
          status: "running",
        },
      })
      const count = await db.recommendationCowatchSourceContribution.count()
      await expect(
        db.recommendationCowatchRefreshGrant.delete({
          where: { id: fixture.grantId },
        }),
      ).rejects.toThrow(/immutable/)
      expect(
        await db.$transaction((tx) =>
          purgeExpiredCowatchRefreshMetadata(tx, new Date()),
        ),
      ).toEqual({ attempts: 1, grants: 1 })
      expect(
        await db.recommendationCowatchRefreshAttempt.findUnique({
          where: { id: pending.id },
        }),
      ).not.toBeNull()
      expect(await db.recommendationCowatchSourceContribution.count()).toBe(
        count,
      )
      expect(
        await db.recommendationCowatchRefreshGrant.findUnique({
          where: { id: fixture.grantId },
        }),
      ).not.toBeNull()
    })

    it("inspects the most recent stopped authorization after every grant has been stopped", async () => {
      const first = await activeFixture()
      await first.service.disable({ actor, grantId: first.grantId })
      const second = await activeFixture()
      await second.service.disable({ actor, grantId: second.grantId })
      expect(await second.service.inspect()).toMatchObject({
        status: "stopped",
        grant: { id: second.grantId },
      })
      expect(
        await second.service.inspect({ operationId: first.grantId }),
      ).toMatchObject({ grant: { id: first.grantId } })
    })

    it("throttles a failed read-only preflight instead of rebuilding on every scheduler check", async () => {
      const fixture = await activeFixture()
      vi.setSystemTime(
        new Date(fixture.now.getTime() + COWATCH_REFRESH_INTERVAL_MS + 60_000),
      )
      const preflight = vi.fn(async () => {
        throw new Error("read-only preflight timed out")
      })
      const service = new RecommendationCowatchRefreshService({
        prisma: db,
        preflight,
      })
      expect(await service.run()).toMatchObject({
        status: "refused",
        reasonCode: "refresh_preflight_unavailable",
      })
      vi.setSystemTime(new Date(Date.now() + 5 * 60_000))
      expect(await service.run()).toEqual({ status: "idle" })
      expect(preflight).toHaveBeenCalledOnce()
    })

    it("refuses actual database growth beyond the explicit capacity ceiling before graph writes", async () => {
      const fixture = await activeFixture()
      const actual = await readCowatchPublicationCapacity(db)
      const service = fixture.service
      await service.authorize({
        ...fixture.authorization,
        operationId: randomUUID(),
        budget: {
          ...budget,
          maxRetainedGraphBytes: budget.publicationReserveBytes * 60,
          maxDatabaseBytes: Math.max(
            budget.publicationReserveBytes * 60 + 1,
            actual.databaseBytes + 2 * budget.publicationReserveBytes,
          ),
        },
      })
      // Dedicated synthetic physical allocation; no production database is touched.
      await db.$executeRaw`CREATE TABLE cowatch_refresh_capacity_fixture (payload text)`
      await db.$executeRaw`ALTER TABLE cowatch_refresh_capacity_fixture ALTER COLUMN payload SET STORAGE PLAIN`
      await db.$executeRaw`INSERT INTO cowatch_refresh_capacity_fixture SELECT repeat(md5(n::text), 64) FROM generate_series(1, 35000) n`
      vi.setSystemTime(
        new Date(fixture.now.getTime() + COWATCH_REFRESH_INTERVAL_MS + 60_000),
      )
      const before = await db.recommendationCowatchGeneration.count()
      expect(await service.run()).toMatchObject({
        status: "refused",
        reasonCode: "refresh_capacity_exceeded",
      })
      expect(await db.recommendationCowatchGeneration.count()).toBe(before)
    })
  },
)
