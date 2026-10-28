import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { currentAdminMigrationSql } from "./current-schema.test-fixture"
import { RecommendationProfileService } from "./profile.service"
import { RecommendationViewerService } from "./viewer-identity.service"
import { runRecommendationProfileProjectionJob } from "./profiles/job"
import { publishCowatchShadowGeneration } from "./cowatch/projection.service"
import {
  makeHarness,
  personalizedInput,
  semanticCandidates,
} from "./delivery.service.test-helpers"

const webCaller = {
  id: "retirement-web",
  role: "CONSUMER_BEARER" as const,
  rateLimitBucketKey: "retirement-web",
}
const fleetCaller = {
  id: null,
  role: "CONSUMER_BEARER" as const,
  fleet: true,
  rateLimitBucketKey: "retirement-fleet",
}

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "behavioral retirement against PostgreSQL",
  () => {
    const schema = `behavioral_retirement_${Date.now()}`
    let admin: Client
    let connected = false
    let db: PrismaClient
    beforeAll(async () => {
      admin = new Client({ connectionString: env.DATABASE_URL })
      await admin.connect()
      connected = true
      await admin.query(`CREATE SCHEMA "${schema}"`)
      await admin.query(`SET search_path TO "${schema}", public`)
      for (const migration of currentAdminMigrationSql)
        await admin.query(migration)
      const url = new URL(env.DATABASE_URL)
      url.searchParams.delete("options")
      url.searchParams.set("schema", schema)
      db = new PrismaClient({ datasources: { db: { url: url.toString() } } })
    }, 120_000)
    afterAll(async () => {
      await db?.$disconnect()
      if (connected) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await admin.end()
      }
    })

    it("boots a native installation and serves its session without creating a profile", async () => {
      const service = new RecommendationViewerService(db)
      const viewer = await service.bootstrap(fleetCaller)
      expect(viewer.personalization).toBe(false)
      const identity = await service.resolve(
        fleetCaller,
        viewer.viewerToken,
        viewer.sessionToken,
      )
      expect(identity).toMatchObject({
        profileTokenDigest: null,
        consentReceiptDigest: null,
      })
      expect(identity.sessionDigest).toMatch(/^[a-f0-9]{64}$/)
      for (const action of ["status", "grant", "reset", "withdraw", "delete"]) {
        const receipt = await service.transition(fleetCaller, {
          viewerToken: viewer.viewerToken,
          sessionToken: viewer.sessionToken,
          action,
        })
        expect(receipt.personalization).toBe(false)
      }
      expect(await db.recommendationProfile.count()).toBe(0)
      expect(await db.recommendationConsentReceipt.count()).toBe(0)
      expect(await db.recommendationProfileSessionLink.count()).toBe(0)
      expect(await db.recommendationViewer.count()).toBe(1)
    })

    it.each(["reset", "status"] as const)(
      "erases an existing profile on %s without replacing it",
      async (action) => {
        const profile = await db.recommendationProfile.create({
          data: {
            tokenDigest: "a".repeat(64),
            privacyGeneration: 1,
            choice: "DURABLE_ALLOWED",
            state: "ACTIVE",
            expiresAt: new Date(Date.now() + 86_400_000),
          },
        })
        await db.recommendationProfileSessionLink.create({
          data: {
            profileId: profile.id,
            privacyGeneration: 1,
            sessionDigest: "b".repeat(64),
            linkedAt: new Date(),
            expiresAt: new Date(Date.now() + 86_400_000),
          },
        })
        const service = new RecommendationProfileService({ prisma: db })
        const receipt =
          action === "status"
            ? await service.status({
                caller: webCaller,
                contractVersion: "recommendation-profile-v1",
                sessionDigest: "b".repeat(64),
                profileDigest: "a".repeat(64),
              })
            : await service.transition({
                caller: webCaller,
                contractVersion: "recommendation-profile-v1",
                action: "reset",
                sessionDigest: "b".repeat(64),
                existingProfileDigest: "a".repeat(64),
                proposedProfileDigest: "c".repeat(64),
              })
        expect(receipt).toMatchObject({
          state: "session_only",
          erasureState: "pending",
        })
        await expect(
          service.completeErasure({
            profileId: profile.id,
            privacyGeneration: 1,
          }),
        ).resolves.toBe(true)
        await expect(
          service.runDeletionDrill({
            profileId: profile.id,
            privacyGeneration: 1,
          }),
        ).resolves.toBeUndefined()
        expect(
          await db.recommendationProfile.count({ where: { id: profile.id } }),
        ).toBe(1)
        expect(
          await db.recommendationProfile.count({ where: { state: "ACTIVE" } }),
        ).toBe(0)
        expect(await db.recommendationProfileSessionLink.count()).toBe(0)
      },
    )

    it("issues semantic capabilities without creating personalization evidence", async () => {
      const h = makeHarness({
        database: db,
        candidateTraceFormat: "compact",
        servedItemFormat: "packed",
      })
      h.retrieve.mockResolvedValue(semanticCandidates(7))
      const response = await h.service.deliver(
        personalizedInput(`retirement-${randomUUID()}`),
      )
      expect(response).toMatchObject({ result: "served", composedCount: 6 })
      expect(response.requestId).not.toBeNull()
      const request = await db.recommendationRequest.findUniqueOrThrow({
        where: { id: response.requestId! },
      })
      expect(request.state).toBe("ISSUED")
      expect(request.experimentAssignmentId).toBeNull()
      expect(await db.recommendationPersonalizationDecision.count()).toBe(0)
      expect(await db.recommendationProfileProjectionGeneration.count()).toBe(0)
    })

    it("refuses co-watch publication and fences a missing old projection without creating rows", async () => {
      await expect(publishCowatchShadowGeneration(db)).rejects.toThrow(
        "retired",
      )
      await expect(
        runRecommendationProfileProjectionJob(
          { runId: randomUUID(), expectedGeneration: 1 },
          db,
        ),
      ).resolves.toMatchObject({
        status: "fenced",
        reason: "behavioral_recommendations_retired",
      })
      expect(await db.recommendationCowatchGeneration.count()).toBe(0)
      expect(await db.recommendationProfileProjectionRun.count()).toBe(0)
    })
  },
)
