import { createHash, randomUUID } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { RecommendationIntegrityService } from "./integrity.service"
import { publishCowatchShadowGeneration } from "./cowatch/projection.service"
import { RecommendationOwnerReleaseOperator } from "./promotion/owner-operator"
import { readActiveOwnerRelease } from "./promotion/owner-authority"
import { createRecommendationPromotionService } from "./promotion/service"

const day = 86_400_000
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex")

// Real producer receipts, publication, qualification and invalidation triggers.
// Synthetic playback evidence only; no production data or fabricated evaluations.
describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "playback measurement reuse with native graph authority",
  () => {
    const databaseName = `integrity_reuse_${randomUUID().replaceAll("-", "")}`
    let admin: Client, migration: Client, db: PrismaClient
    let created = false
    let ordinal = 0
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
      const root = new URL("../../../prisma/migrations/", import.meta.url)
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
      // Close the seeded legacy A/A through the supported operator.
      const promotion = createRecommendationPromotionService(db)
      const pointer = await db.recommendationPromotionPointer.findUniqueOrThrow(
        { where: { id: "recommendation-promotion-pointer" } },
      )
      const actor = { id: "owned-integrity-fixture", role: "ADMIN" as const }
      const stopped = await promotion.setKillSwitch({
        actor,
        expectedPointerGeneration: pointer.generation,
        enabled: true,
        reason: "owner_direct_activation",
      })
      await promotion.setKillSwitch({
        actor,
        expectedPointerGeneration: stopped.generation,
        enabled: false,
        reason: "owner_direct_activation",
      })
    }, 120_000)
    afterAll(async () => {
      await db?.$disconnect()
      await migration?.end().catch(() => {})
      if (admin) {
        if (created)
          await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`)
        await admin.end()
      }
    })

    async function sourceFixture() {
      const id = randomUUID()
      const now = new Date()
      const start = new Date(now.getTime() - 10 * day + ordinal++ * 3_600_000)
      const expiresAt = new Date(now.getTime() + 15 * day)
      const mediaA = `${id}-a`,
        mediaB = `${id}-b`,
        mediaC = `${id}-c`
      const sourceSession = digest(`${id}-0`)
      const episode = (
        episodeId: string,
        mediaId: string,
        sessionDigest: string,
        occurredAt: Date,
      ) => ({
        id: episodeId,
        mediaId,
        sessionDigest,
        state: "FINALIZED" as const,
        nextFactSequence: 2,
        activeUntil: new Date(now.getTime() + day),
        hardUntil: new Date(now.getTime() + 2 * day),
        finalizedAt: occurredAt,
        claimedAt: occurredAt,
        createdAt: occurredAt,
        expiresAt,
      })
      const outcomes: string[] = []
      // Publish enough independent support for a real eligible directional edge,
      // including singleton viewers in the denominator.
      for (let viewer = 0; viewer < 10; viewer++) {
        for (const [position, mediaId] of (viewer < 5
          ? [mediaA, mediaB]
          : [mediaC]
        ).entries()) {
          const episodeId = `${id}-${viewer}-${position}`
          const occurredAt = new Date(start.getTime() + position * 1_000)
          await db.recommendationPlaybackEpisode.create({
            data: episode(
              episodeId,
              mediaId,
              digest(`${id}-${viewer}`),
              occurredAt,
            ),
          })
          await db.recommendationPlaybackFact.create({
            data: {
              episodeId,
              capabilityJti: `${episodeId}-capability`,
              eventId: `${episodeId}-event`,
              payloadDigest: digest("exact-replay"),
              sequence: 1,
              kind: "heartbeat",
              occurredAt,
              receivedAt: occurredAt,
              expiresAt,
            },
          })
          const outcomeId = `${episodeId}-r1`
          await db.recommendationOutcomeRevision.create({
            data: {
              id: outcomeId,
              episodeId,
              classifierVersion: "active-watch-proxy-v1",
              factWatermark: 1,
              inputDigest: digest(episodeId),
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
          outcomes.push(outcomeId)
        }
      }
      const service = new RecommendationIntegrityService({ prisma: db })
      for (const outcomeId of outcomes) {
        const receipt = await service.classifyPlaybackOutcome(outcomeId)
        expect(receipt.eligibleScopes).toContain("aggregate")
      }
      const classifiedAt = new Date()
      const publication = await publishCowatchShadowGeneration(
        db,
        classifiedAt,
        {
          version: "episode-event-window-v1",
          windowStart: start,
          windowEnd: new Date(start.getTime() + 1_800_000),
          evaluationAsOf: classifiedAt,
        },
      )
      if (publication.status !== "published" || !publication.generation)
        throw new Error("Expected actual finite graph publication")
      const graphGenerationId = publication.generation
      const operator = new RecommendationOwnerReleaseOperator({ prisma: db })
      const pointer = await db.recommendationPromotionPointer.findUniqueOrThrow(
        { where: { id: "recommendation-promotion-pointer" } },
      )
      const input = {
        actor: { id: "owned-integrity-fixture", role: "ADMIN" as const },
        authenticatedAt: new Date(),
        operationId: randomUUID(),
        expectedPointerGeneration: pointer.generation,
        graphGenerationId,
      }
      const prepared = await operator.prepare(input)
      if (prepared.status !== "prepared")
        throw new Error("Expected native preparation")
      const activated = await operator.activate({
        ...input,
        bindingDigest: prepared.bindingDigest,
      })
      expect(activated.status).toBe("active")
      const authority = await readActiveOwnerRelease(db, new Date())
      if (!authority) throw new Error("Expected current graph authority")
      const outcomeId = outcomes[0]!
      const original =
        await db.recommendationEligibilityDecision.findFirstOrThrow({
          where: { outcomeId, isCurrent: true },
        })
      return {
        authority,
        original,
        outcomeId,
        graphGenerationId,
        expiresAt,
        episodeId: `${id}-0-0`,
        classify: () => service.classifyPlaybackOutcome(outcomeId),
        addAmbientViewer: () =>
          db.recommendationPlaybackEpisode.create({
            data: episode(
              `${id}-ambient`,
              mediaA,
              digest(`${id}-ambient`),
              now,
            ),
          }),
        exceedContributionCap: () =>
          db.recommendationPlaybackEpisode.createMany({
            data: [1, 2].map((index) =>
              episode(
                `${id}-prior-${index}`,
                mediaA,
                sourceSession,
                new Date(start.getTime() - index * 1_000),
              ),
            ),
          }),
      }
    }

    async function expectCurrent(
      fixture: Awaited<ReturnType<typeof sourceFixture>>,
    ) {
      expect(await readActiveOwnerRelease(db, new Date())).toEqual(
        fixture.authority,
      )
      expect(
        await db.recommendationCowatchGeneration.findUniqueOrThrow({
          where: { id: fixture.graphGenerationId },
        }),
      ).toMatchObject({ invalidatedAt: null })
      expect(
        await db.recommendationOwnerRelease.findUniqueOrThrow({
          where: { id: fixture.authority.releaseId },
        }),
      ).toMatchObject({ revokedAt: null })
    }

    async function expectRevoked(
      fixture: Awaited<ReturnType<typeof sourceFixture>>,
    ) {
      expect(await readActiveOwnerRelease(db, new Date())).toBeNull()
      expect(
        await db.recommendationCowatchGeneration.findUniqueOrThrow({
          where: { id: fixture.graphGenerationId },
        }),
      ).toMatchObject({
        invalidatedAt: expect.any(Date),
        invalidationReason: "eligibility_changed",
      })
      expect(
        await db.recommendationOwnerRelease.findUniqueOrThrow({
          where: { id: fixture.authority.releaseId },
        }),
      ).toMatchObject({
        revokedAt: expect.any(Date),
        revocationReason: "eligibility_changed",
      })
    }

    it("keeps one untouched positive receipt and graph authority through ambient drift and concurrent classifiers", async () => {
      const fixture = await sourceFixture()
      await fixture.addAmbientViewer()
      await expectCurrent(fixture)
      const receipts = await Promise.all([
        fixture.classify(),
        fixture.classify(),
        fixture.classify(),
      ])
      expect(receipts.map((receipt) => receipt.id)).toEqual(
        Array(3).fill(fixture.original.id),
      )
      expect(
        await db.recommendationEligibilityDecision.findUniqueOrThrow({
          where: { id: fixture.original.id },
        }),
      ).toEqual(fixture.original)
      expect(
        await db.recommendationEligibilityDecision.count({
          where: { outcomeId: fixture.outcomeId },
        }),
      ).toBe(1)
      expect(
        await db.recommendationEligibilityDecision.count({
          where: { outcomeId: fixture.outcomeId, isCurrent: true },
        }),
      ).toBe(1)
      await expectCurrent(fixture)
    }, 30_000)

    it("still appends and revokes when changed measurements cross a policy threshold", async () => {
      const fixture = await sourceFixture()
      await fixture.exceedContributionCap()
      await expectCurrent(fixture)
      const receipts = await Promise.all([
        fixture.classify(),
        fixture.classify(),
        fixture.classify(),
      ])
      expect(receipts[0]).toMatchObject({
        revision: 2,
        state: "excluded",
        reasonCodes: ["identity_content_contribution_cap"],
      })
      expect(new Set(receipts.map((receipt) => receipt.id)).size).toBe(1)
      expect(
        await db.recommendationEligibilityDecision.count({
          where: { outcomeId: fixture.outcomeId, isCurrent: true },
        }),
      ).toBe(1)
      expect(
        await db.recommendationEligibilityDecision.count({
          where: { outcomeId: fixture.outcomeId },
        }),
      ).toBe(2)
      await expectRevoked(fixture)
    }, 30_000)

    it("still appends and revokes for changed non-measure evidence with an identical positive verdict", async () => {
      const fixture = await sourceFixture()
      await db.$transaction(async (tx) => {
        await tx.recommendationPlaybackEpisode.update({
          where: { id: fixture.episodeId },
          data: { transportReplayCount: 1 },
        })
        await tx.recommendationPlaybackTransportReplayReceipt.create({
          data: {
            episodeId: fixture.episodeId,
            capabilityJti: `${fixture.episodeId}-capability`,
            eventId: `${fixture.episodeId}-event`,
            payloadDigest: digest("exact-replay"),
            replayOrdinal: 1,
            expiresAt: fixture.expiresAt,
          },
        })
      })
      await expectCurrent(fixture)
      expect(await fixture.classify()).toMatchObject({
        revision: 2,
        state: "eligible",
        reasonCodes: [],
        eligibleScopes: ["profile", "aggregate"],
        contributionWeight: fixture.original.contributionWeight,
      })
      await expectRevoked(fixture)
    }, 30_000)
  },
)
