import { createHash, randomUUID } from "node:crypto"
import {
  PrismaClient,
  type Prisma,
  RecommendationDeliveryResult,
  RecommendationExperimentArm,
  RecommendationRequestState,
} from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { currentAdminMigrationSql } from "../current-schema.test-fixture"
import { RecommendationEpisodeService } from "../episode.service"
import {
  createRecommendationTokenService,
  parseRecommendationKeyring,
} from "../token.service"
import { loadPrivatePrecomputedClickDiagnostics } from "./visit-clicks"

const caller = {
  id: "forge-web",
  role: "CONSUMER_BEARER" as const,
  rateLimitBucketKey: "forge-web",
}
const reviewer = { id: "fixture-admin", role: "ADMIN" as const }

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "private Watch click attribution on PostgreSQL 18",
  () => {
    const schema = `precomputed_clicks_${Date.now()}_${Math.random().toString(36).slice(2)}`
    let admin: Client
    let prisma: PrismaClient
    let now: Date
    let experimentId: string
    let episodeService: RecommendationEpisodeService
    let tokens: ReturnType<typeof createRecommendationTokenService>
    let idSequence = 0
    const sessionDigest = "a".repeat(64)

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
      now = new Date()
      const generationId = `click-generation-${schema}`
      await prisma.recommendationPrecomputedGeneration.create({
        data: {
          id: generationId,
          modelId: "fixture-astra",
          promptVersion: "fixture-v1",
          inputDigest: "b".repeat(64),
          sourceSetDigest: "c".repeat(64),
          inputCutoff: now,
          expectedSourceCount: 0,
          status: "complete",
          completedAt: now,
        },
      })
      experimentId = `click-test-${schema}`
      await prisma.recommendationPrecomputedExperiment.create({
        data: {
          id: experimentId,
          generationId,
          controlManifestId: "semantic-transcript-pgvector-v1",
          challengerManifestId: "precomputed-watch-preview-v1",
          controlManifestDigest: "d".repeat(64),
          controlRoutingDigest: "e".repeat(64),
          sourceSetDigest: "c".repeat(64),
          assignmentPolicyVersion: "browser-sha256-50-v1",
          eligibilityPolicyVersion: "private-watch-visit-unverified-bot-v1",
          deliveryPolicyVersion: "saved-or-control-v1",
          configurationDigest: "f".repeat(64),
          state: "closed",
          startsAt: new Date(now.getTime() - 60_000),
          endsAt: new Date(now.getTime() + 60_000),
          expiresAt: new Date(now.getTime() + 365 * 86_400_000),
        },
      })
      const keyring = parseRecommendationKeyring(
        JSON.stringify({
          keys: [
            {
              kid: "click-test",
              status: "active",
              key: Buffer.alloc(32, 19).toString("base64url"),
            },
          ],
        }),
      )
      tokens = createRecommendationTokenService({
        keyring,
        readRevokedKids: async () => [],
        now: () => now,
      })
      episodeService = new RecommendationEpisodeService({
        prisma,
        tokenService: { activeKid: keyring.active.kid, ...tokens },
        now: () => now,
        newId: () => `click-generated-${++idSequence}`,
      })
    }, 120_000)

    afterAll(async () => {
      await prisma?.$disconnect()
      if (admin) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await admin.end()
      }
    })

    async function visit(arm: RecommendationExperimentArm) {
      const id = randomUUID()
      const browserDigest = createHash("sha256")
        .update(`browser-${id}`)
        .digest("hex")
      await prisma.recommendationPrecomputedVisit.create({
        data: {
          id,
          experimentId,
          browserUnitDigest: createHash("sha256")
            .update(
              ["precomputed-browser-unit-v1", experimentId, browserDigest].join(
                "\0",
              ),
            )
            .digest("hex"),
          consentBindingDigest: null,
          sourceVideoId: "source-video",
          locale: "en",
          audioLanguageSlug: "english",
          eligibility: "eligible",
          qualification: "unverified_browser",
          arm,
          createdAt: now,
          expiresAt: new Date(now.getTime() + 29 * 86_400_000),
        },
      })
      return { id, browserDigest }
    }

    async function issuedItem(
      visitId: string,
      position: number,
      manifestId = "semantic-transcript-pgvector-v1",
    ) {
      const requestId = `click-request-${++idSequence}`
      const itemId = `click-item-${++idSequence}`
      const jti = `click-jti-${++idSequence}`
      const expiresAt = new Date(now.getTime() + 29 * 86_400_000)
      await prisma.$transaction(async (tx) => {
        await tx.recommendationRequest.create({
          data: {
            id: requestId,
            contractVersion: "semantic-recommendation-v1",
            surfaceVersion: "watch-below-player-v1",
            manifestId,
            strategyVersion: manifestId,
            classifierVersion: "legacy-position-v0",
            sessionDigest,
            seedMediaId: "source-video",
            locale: "en",
            expectedItemCount: 1,
            state: RecommendationRequestState.ISSUED,
            result: RecommendationDeliveryResult.SERVED,
            issuedAt: now,
            signingKid: "click-test",
            deliveryJti: `delivery-${requestId}`,
            expiresAt,
          },
        })
        await tx.recommendationServedItem.create({
          data: {
            id: itemId,
            requestId,
            position: 0,
            targetMediaId: `target-${position}`,
            canonicalHref: `/watch/target-${position}.html`,
            candidateGenerator: "semantic",
            candidateProvenance: {},
            capabilityJti: jti,
            signingKid: "click-test",
            expiresAt,
          },
        })
        await tx.recommendationPrecomputedVisitRequest.create({
          data: { requestId, visitId, createdAt: now, expiresAt },
        })
      })
      const capability = await tokens.signDeliveryCapability({
        jti,
        requestId,
        itemId,
        sessionDigest,
        surface: "watch-below-player-v1",
        manifestId,
      })
      return { requestId, itemId, capability, jti, expiresAt }
    }

    it("counts a no-receipt visit once across two cards and a replay without an impression", async () => {
      const challenger = await visit(RecommendationExperimentArm.CHALLENGER)
      await visit(RecommendationExperimentArm.CONTROL)
      const first = await issuedItem(challenger.id, 0)
      const second = await issuedItem(challenger.id, 1)
      const select = (item: typeof first, suffix: string) =>
        episodeService.select({
          caller,
          contractVersion: "recommendation-evidence-v1",
          capability: item.capability,
          requestId: item.requestId,
          itemId: item.itemId,
          sessionDigest,
          browserDigest: challenger.browserDigest,
          eventId: `click-event-${suffix}`,
          occurredAt: now.toISOString(),
          claimNonce: `click-client-claim-nonce-${suffix}`,
        })
      expect((await select(first, "first")).status).toBe("accepted")
      expect((await select(first, "first")).status).toBe("replay")
      expect((await select(second, "second")).status).toBe("accepted")
      expect(
        await prisma.recommendationSelection.count({
          where: { requestId: { in: [first.requestId, second.requestId] } },
        }),
      ).toBe(2)

      const report = await loadPrivatePrecomputedClickDiagnostics(prisma, {
        experimentId,
        reviewer,
        now,
      })
      expect(report).toMatchObject({
        status: "observed_private_only",
        byArm: {
          challenger: {
            eligibleVisits: 1,
            clickedVisits: 1,
            acceptedSelections: 2,
            qualifiedImpressions: 0,
            matchedSelections: 0,
            unmatchedSelections: 2,
            cardCtr: null,
          },
          control: { eligibleVisits: 1, clickedVisits: 0 },
        },
      })
      if (report.status !== "observed_private_only")
        throw new Error("Expected observed private click diagnostics")
      expect(report.recentCards).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            visitId: challenger.id,
            assignedArm: "challenger",
            requestId: first.requestId,
            itemId: first.itemId,
            position: 0,
            actualStrategy: "semantic-transcript-pgvector-v1",
            qualifiedImpression: false,
          }),
        ]),
      )
    })

    it("returns only aggregate counts to an Editor without reading card traces", async () => {
      let rawReads = 0
      const aggregateReader = {
        recommendationPrecomputedExperiment:
          prisma.recommendationPrecomputedExperiment,
        $queryRaw: (...args: unknown[]) => {
          rawReads += 1
          return Reflect.apply(prisma.$queryRaw, prisma, args)
        },
      } as unknown as PrismaClient
      const report = await loadPrivatePrecomputedClickDiagnostics(
        aggregateReader,
        {
          experimentId,
          reviewer: { id: "fixture-editor", role: "EDITOR" },
          now,
        },
      )
      expect(report).toMatchObject({
        byArm: { challenger: { clickedVisits: 1 } },
        recentCards: null,
      })
      expect(rawReads).toBe(1)
      expect(JSON.stringify(report)).not.toContain("click-item-")
    })

    it("counts an ordinary click after personalization is disabled", async () => {
      const enrolled = await visit(RecommendationExperimentArm.CHALLENGER)
      const item = await issuedItem(enrolled.id, 2)
      await prisma.recommendationConsentReceipt.create({
        data: {
          tokenDigest: createHash("sha256")
            .update(`disabled-${enrolled.id}`)
            .digest("hex"),
          contractVersion: "recommendation-consent-v1",
          choice: "ESSENTIAL_ONLY",
          state: "ACTIVE",
          privacyGeneration: 0,
          expiresAt: new Date(now.getTime() + 35 * 86_400_000),
        },
      })
      expect(
        (
          await episodeService.select({
            caller,
            contractVersion: "recommendation-evidence-v1",
            capability: item.capability,
            requestId: item.requestId,
            itemId: item.itemId,
            sessionDigest,
            browserDigest: enrolled.browserDigest,
            eventId: "click-after-withdrawal",
            occurredAt: now.toISOString(),
            claimNonce: "click-client-claim-nonce-withdrawn",
          })
        ).status,
      ).toBe("accepted")
      const report = await loadPrivatePrecomputedClickDiagnostics(prisma, {
        experimentId,
        reviewer,
        now,
      })
      expect(report).toMatchObject({
        byArm: { challenger: { eligibleVisits: 2, clickedVisits: 2 } },
      })
      expect(
        await prisma.recommendationSelection.findUnique({
          where: { itemId: item.itemId },
        }),
      ).not.toBeNull()
      expect(
        await prisma.recommendationProfileSessionLink.count({
          where: { sessionDigest },
        }),
      ).toBe(0)
    })

    it.each(["missing_browser", "different_browser"] as const)(
      "rejects an old private card after %s",
      async (transition) => {
        const enrolled = await visit(RecommendationExperimentArm.CHALLENGER)
        const item = await issuedItem(enrolled.id, 10)
        await expect(
          episodeService.select({
            caller,
            contractVersion: "recommendation-evidence-v1",
            capability: item.capability,
            requestId: item.requestId,
            itemId: item.itemId,
            sessionDigest,
            browserDigest:
              transition === "missing_browser" ? null : "f".repeat(64),
            eventId: `post-${transition}-click`,
            occurredAt: now.toISOString(),
            claimNonce: `post-${transition}-client-claim-nonce`,
          }),
        ).rejects.toThrow()
        expect(
          await prisma.recommendationSelection.findUnique({
            where: { itemId: item.itemId },
          }),
        ).toBeNull()
      },
    )

    it("rejects wrong-request and excluded-bot evidence without moving either arm", async () => {
      const control = await visit(RecommendationExperimentArm.CONTROL)
      const challenger = await visit(RecommendationExperimentArm.CHALLENGER)
      const controlItem = await issuedItem(control.id, 3)
      const challengerItem = await issuedItem(challenger.id, 4)
      await expect(
        episodeService.select({
          caller,
          contractVersion: "recommendation-evidence-v1",
          capability: challengerItem.capability,
          requestId: controlItem.requestId,
          itemId: challengerItem.itemId,
          sessionDigest,
          browserDigest: challenger.browserDigest,
          eventId: "wrong-visit-request",
          occurredAt: now.toISOString(),
          claimNonce: "wrong-visit-client-claim-nonce",
        }),
      ).rejects.toThrow()

      const botVisitId = randomUUID()
      await prisma.recommendationPrecomputedVisit.create({
        data: {
          id: botVisitId,
          experimentId,
          sourceVideoId: "source-video",
          locale: "en",
          audioLanguageSlug: "english",
          eligibility: "excluded",
          qualification: "declared_automation",
          exclusionReason: "automation_excluded",
          createdAt: now,
          expiresAt: new Date(now.getTime() + 29 * 86_400_000),
        },
      })
      const botItem = await issuedItem(botVisitId, 5)
      await expect(
        episodeService.select({
          caller,
          contractVersion: "recommendation-evidence-v1",
          capability: botItem.capability,
          requestId: botItem.requestId,
          itemId: botItem.itemId,
          sessionDigest,
          eventId: "excluded-bot-card",
          occurredAt: now.toISOString(),
          claimNonce: "excluded-bot-client-claim-nonce",
        }),
      ).rejects.toThrow()
      const report = await loadPrivatePrecomputedClickDiagnostics(prisma, {
        experimentId,
        reviewer,
        now,
      })
      expect(report).toMatchObject({
        byArm: {
          control: { clickedVisits: 0 },
          challenger: { clickedVisits: 2 },
        },
      })
    })

    it("keeps a fallback click in its assigned arm and reconciles a delayed impression", async () => {
      const challenger = await visit(RecommendationExperimentArm.CHALLENGER)
      const item = await issuedItem(challenger.id, 6)
      await prisma.recommendationPrecomputedVisit.update({
        where: { id: challenger.id },
        data: {
          deliveryResult: "fallback",
          actualStrategy: "semantic-transcript-pgvector-v1",
          deliveryRequestId: item.requestId,
          fallbackReason: "saved_result_unavailable",
        },
      })
      expect(
        (
          await episodeService.select({
            caller,
            contractVersion: "recommendation-evidence-v1",
            capability: item.capability,
            requestId: item.requestId,
            itemId: item.itemId,
            sessionDigest,
            browserDigest: challenger.browserDigest,
            eventId: "fallback-click",
            occurredAt: now.toISOString(),
            claimNonce: "fallback-client-claim-nonce",
          })
        ).status,
      ).toBe("accepted")
      const before = await loadPrivatePrecomputedClickDiagnostics(prisma, {
        experimentId,
        reviewer,
        now,
      })
      expect(before).toMatchObject({
        byArm: { challenger: { unmatchedSelections: 4 } },
      })
      await prisma.recommendationImpression.create({
        data: {
          id: `delayed-impression-${item.itemId}`,
          requestId: item.requestId,
          itemId: item.itemId,
          capabilityJti: item.jti,
          eventId: "delayed-impression-event",
          payloadDigest: "d".repeat(64),
          visibilityPolicy: "qualified-visible-v1",
          occurredAt: now,
          receivedAt: new Date(now.getTime() + 500),
          expiresAt: item.expiresAt,
        },
      })
      const after = await loadPrivatePrecomputedClickDiagnostics(prisma, {
        experimentId,
        reviewer,
        now,
      })
      expect(after).toMatchObject({
        byArm: {
          challenger: {
            clickedVisits: 3,
            qualifiedImpressions: 1,
            matchedSelections: 1,
            unmatchedSelections: 3,
            cardCtr: 1,
          },
        },
      })
      if (after.status !== "observed_private_only")
        throw new Error("Expected observed private click diagnostics")
      expect(after.recentCards).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            visitId: challenger.id,
            assignedArm: "challenger",
            actualStrategy: "semantic-transcript-pgvector-v1",
            privateFallback: true,
            fallbackReason: "saved_result_unavailable",
            qualifiedImpression: true,
          }),
        ]),
      )
    })

    it("does not copy an earlier fallback reason onto a saved retry card", async () => {
      const challenger = await visit(RecommendationExperimentArm.CHALLENGER)
      const fallback = await issuedItem(challenger.id, 8)
      await prisma.recommendationPrecomputedVisit.update({
        where: { id: challenger.id },
        data: {
          deliveryResult: "fallback",
          actualStrategy: "semantic-transcript-pgvector-v1",
          deliveryRequestId: fallback.requestId,
          fallbackReason: "saved_result_unavailable",
        },
      })
      const saved = await issuedItem(
        challenger.id,
        9,
        "precomputed-watch-preview-v1",
      )
      for (const [item, suffix] of [
        [fallback, "fallback"],
        [saved, "saved"],
      ] as const) {
        expect(
          (
            await episodeService.select({
              caller,
              contractVersion: "recommendation-evidence-v1",
              capability: item.capability,
              requestId: item.requestId,
              itemId: item.itemId,
              sessionDigest,
              browserDigest: challenger.browserDigest,
              eventId: `mixed-retry-${suffix}`,
              occurredAt: now.toISOString(),
              claimNonce: `mixed-retry-client-claim-nonce-${suffix}`,
            })
          ).status,
        ).toBe("accepted")
      }
      const report = await loadPrivatePrecomputedClickDiagnostics(prisma, {
        experimentId,
        reviewer,
        now,
      })
      if (report.status !== "observed_private_only")
        throw new Error("Expected observed private click diagnostics")
      if (!report.recentCards)
        throw new Error("Expected trace-level click diagnostics")
      const cards = report.recentCards.filter(
        (card) => card.visitId === challenger.id,
      )
      expect(cards).toHaveLength(2)
      expect(
        cards.find((card) => card.itemId === fallback.itemId),
      ).toMatchObject({
        assignedArm: "challenger",
        privateFallback: true,
        fallbackReason: "saved_result_unavailable",
      })
      expect(cards.find((card) => card.itemId === saved.itemId)).toMatchObject({
        assignedArm: "challenger",
        actualStrategy: "precomputed-watch-preview-v1",
        privateFallback: false,
        fallbackReason: null,
      })
    })

    it("marks a selection received after the frozen test window as late", async () => {
      const enrolled = await visit(RecommendationExperimentArm.CONTROL)
      const item = await issuedItem(enrolled.id, 7)
      const originalNow = now
      try {
        now = new Date(originalNow.getTime() + 120_000)
        expect(
          (
            await episodeService.select({
              caller,
              contractVersion: "recommendation-evidence-v1",
              capability: item.capability,
              requestId: item.requestId,
              itemId: item.itemId,
              sessionDigest,
              browserDigest: enrolled.browserDigest,
              eventId: "late-selection",
              occurredAt: now.toISOString(),
              claimNonce: "late-selection-client-claim-nonce",
            })
          ).status,
        ).toBe("accepted")
        const report = await loadPrivatePrecomputedClickDiagnostics(prisma, {
          experimentId,
          reviewer,
          now,
        })
        if (report.status !== "observed_private_only")
          throw new Error("Expected observed private click diagnostics")
        expect(report.recentCards).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ itemId: item.itemId, late: true }),
          ]),
        )
      } finally {
        now = originalNow
      }
    })
  },
)
