import { createHmac, randomUUID } from "node:crypto"
import { PrismaClient, type Prisma } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { env } from "@/config/env"
import { currentAdminMigrationSql } from "../current-schema.test-fixture"
import * as incumbentService from "../delivery.service"
import {
  loadPrecomputedIncumbentBaseline,
  loadPrecomputedIncumbentBaselineReport,
  isDisposableBaselineDatabase,
  checkPrecomputedBaselineClickBrowser,
  startPrecomputedIncumbentBaseline,
  stopPrecomputedIncumbentBaseline,
} from "./incumbent-baseline"
import { deliverPrecomputedPublicWatchVisit } from "./public-watch"
import { purgeExpiredPrecomputedVisitRoots } from "./visit-retention"

const fixtureReady =
  env.RECOMMENDATION_DB_TEST === "1" &&
  env.WATCH_RECOMMENDATION_TURNSTILE_TEST_FIXTURE_ENABLED === "1" &&
  Boolean(env.WATCH_RECOMMENDATION_HUMAN_PROOF_SECRET) &&
  env.WATCH_RECOMMENDATION_TURNSTILE_HOSTNAMES?.includes(
    "turnstile-test-fixture.local",
  )

describe.skipIf(!fixtureReady)(
  "verified incumbent-only baseline on PostgreSQL",
  () => {
    const schema = `precomputed_public_baseline_${randomUUID().replaceAll("-", "")}`
    const sourceVideoId = `baseline-source-${randomUUID()}`
    const operator = { id: "baseline-operator", role: "ADMIN" } as const
    const caller = {
      id: null,
      role: "CONSUMER_BEARER",
      fleet: false,
      rateLimitBucketKey: "baseline-native-test",
    } as const
    let admin: Client
    let prisma: PrismaClient
    let adapterPrisma: PrismaClient

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
          id: "baseline-english",
          coreId: "baseline-english-core",
          slug: "english",
        },
      })
      await prisma.videoLocale.create({
        data: {
          id: `locale-${sourceVideoId}`,
          videoId: sourceVideoId,
          locale: "en",
          status: "PUBLISHED",
          title: "Baseline source",
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
          languageId: "baseline-english",
          muxVideoId: `mux-${sourceVideoId}`,
          published: true,
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
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await admin.end()
      }
    })

    it("requires explicit isolated authority, challenges the same UUID, records only incumbent, and stops", async () => {
      // Production uses PrismaPg; this also exercises its handling of the
      // fixture guard's current_database/current_schema scalar types.
      const baseline = await startPrecomputedIncumbentBaseline(adapterPrisma, {
        operator,
      })
      expect(baseline).toMatchObject({
        status: "scheduled",
        verificationAuthority: "isolated_fixture",
      })
      expect(await loadPrecomputedIncumbentBaseline(prisma)).toMatchObject({
        id: baseline!.id,
      })
      const visitId = randomUUID()
      const now = new Date(new Date(baseline!.startsAt).getTime() + 1_000)
      const input = {
        visitId,
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
        now,
      }
      const required = await deliverPrecomputedPublicWatchVisit(prisma, input)
      expect(required).toMatchObject({
        disposition: "baseline",
        reason: "verification_required",
        status: "unavailable",
        delivery: null,
      })
      expect(await prisma.recommendationPrecomputedBaselineVisit.count()).toBe(
        0,
      )

      const issuedAt = Math.floor(now.getTime() / 1_000)
      const payload = Buffer.from(
        JSON.stringify({
          visitId,
          browserDigest: input.browserDigest,
          seedMediaId: sourceVideoId,
          locale: "en",
          audioLanguageSlug: "english",
          action: "watch_recommendations",
          hostname: "turnstile-test-fixture.local",
          issuedAt,
          expiresAt: issuedAt + 300,
        }),
      ).toString("base64url")
      const signature = createHmac(
        "sha256",
        env.WATCH_RECOMMENDATION_HUMAN_PROOF_SECRET!,
      )
        .update(`forge-watch-human-v1.${payload}`, "ascii")
        .digest("base64url")
      const humanVerificationReceipt = `v1.${payload}.${signature}`
      const deliver = vi.spyOn(
        incumbentService,
        "createRecommendationDeliveryService",
      )
      deliver.mockReturnValue({
        deliver: async () => ({
          contractVersion: "semantic-recommendation-delivery-v1",
          surfaceVersion: "watch-below-player-v1",
          strategyVersion: "semantic-transcript-pgvector-v1",
          classifierVersion: "legacy-position-v0",
          requestId: null,
          result: "empty",
          reason: null,
          expiresAt: null,
          items: [],
        }),
      } as unknown as ReturnType<
        typeof incumbentService.createRecommendationDeliveryService
      >)
      try {
        const result = await deliverPrecomputedPublicWatchVisit(prisma, {
          ...input,
          humanVerificationReceipt,
        })
        expect(result).toMatchObject({
          disposition: "baseline",
          status: "eligible",
          arm: "control",
          measurementStatus: "recorded",
          delivery: { result: "empty" },
        })
        expect(
          await prisma.recommendationPrecomputedBaselineVisit.count(),
        ).toBe(1)
        expect(
          await loadPrecomputedIncumbentBaselineReport(
            prisma,
            baseline!.id,
            now,
          ),
        ).toMatchObject({
          eligibleVisits: 1,
          clickedVisits: 0,
          independentBrowsers: 1,
          evidenceBasis: "isolated_fixture",
          isFinal: false,
        })
        const requestId = randomUUID()
        const itemId = randomUUID()
        const expiresAt = new Date(Date.now() + 29 * 86_400_000)
        await prisma.$transaction(async (tx) => {
          await tx.recommendationRequest.create({
            data: {
              id: requestId,
              contractVersion: "semantic-recommendation-v1",
              surfaceVersion: "watch-below-player-v1",
              manifestId: "semantic-transcript-pgvector-v1",
              strategyVersion: "semantic-transcript-pgvector-v1",
              classifierVersion: "legacy-position-v0",
              sessionDigest: input.sessionDigest,
              seedMediaId: sourceVideoId,
              locale: "en",
              expectedItemCount: 1,
              state: "ISSUED",
              result: "SERVED",
              issuedAt: new Date(),
              signingKid: "baseline-test",
              deliveryJti: randomUUID(),
              expiresAt,
            },
          })
          await tx.recommendationServedItem.create({
            data: {
              id: itemId,
              requestId,
              position: 0,
              targetMediaId: "baseline-target",
              canonicalHref: "/watch/baseline-target.html",
              candidateGenerator: "semantic",
              candidateProvenance: {},
              capabilityJti: randomUUID(),
              signingKid: "baseline-test",
              expiresAt,
            },
          })
          await tx.recommendationPrecomputedBaselineVisitRequest.create({
            data: { requestId, visitId, createdAt: now, expiresAt },
          })
        })
        expect(
          await prisma.$transaction((tx) =>
            checkPrecomputedBaselineClickBrowser(tx, {
              requestId,
              browserDigest: input.browserDigest,
              now,
            }),
          ),
        ).toBe("valid")
        expect(
          await prisma.$transaction((tx) =>
            checkPrecomputedBaselineClickBrowser(tx, {
              requestId,
              browserDigest: "b".repeat(64),
              now,
            }),
          ),
        ).toBe("invalid")
        await prisma.recommendationSelection.create({
          data: {
            id: randomUUID(),
            requestId,
            itemId,
            capabilityJti: randomUUID(),
            eventId: randomUUID(),
            payloadDigest: "a".repeat(64),
            claimNonceDigest: "b".repeat(64),
            handoffExpiresAt: expiresAt,
            occurredAt: now,
            receivedAt: now,
            expiresAt,
          },
        })
        expect(
          await loadPrecomputedIncumbentBaselineReport(
            prisma,
            baseline!.id,
            now,
          ),
        ).toMatchObject({
          eligibleVisits: 1,
          clickedVisits: 1,
          visitCtr: 1,
          cardClicks: 1,
        })
        const stoppedAt = new Date(now.getTime() + 1_000)
        await stopPrecomputedIncumbentBaseline(prisma, {
          baselineId: baseline!.id,
          operator,
          now: stoppedAt,
        })
        const after = await deliverPrecomputedPublicWatchVisit(prisma, {
          ...input,
          now: new Date(now.getTime() + 2_000),
          visitId: randomUUID(),
          humanVerificationReceipt: null,
        })
        expect(after.disposition).toBe("inactive")
        expect(
          await prisma.recommendationPrecomputedBaselineVisit.count(),
        ).toBe(1)
        const final = await loadPrecomputedIncumbentBaselineReport(
          prisma,
          baseline!.id,
          new Date(stoppedAt.getTime() + 24 * 3_600_000 + 6 * 60_000),
        )
        expect(final).toMatchObject({ isFinal: true, clickedVisits: 1 })
        const visit =
          await prisma.recommendationPrecomputedBaselineVisit.findUniqueOrThrow(
            {
              where: { id: visitId },
            },
          )
        const purged = await prisma.$transaction((tx) =>
          purgeExpiredPrecomputedVisitRoots(
            tx,
            new Date(visit.expiresAt.getTime() + 1_000),
            100,
          ),
        )
        expect(purged.baselineVisitsDeleted).toBe(1)
        expect(
          await prisma.recommendationPrecomputedBaselineVisit.count(),
        ).toBe(0)
        expect(
          await loadPrecomputedIncumbentBaselineReport(prisma, baseline!.id),
        ).toMatchObject({ eligibleVisits: 1, clickedVisits: 1, isFinal: true })
      } finally {
        deliver.mockRestore()
      }
    })

    it("rejects fixture authority on a non-disposable database schema", async () => {
      expect(isDisposableBaselineDatabase("forge_capacity", schema)).toBe(true)
      expect(isDisposableBaselineDatabase("forge", schema)).toBe(false)
      expect(isDisposableBaselineDatabase("production", schema)).toBe(false)
      const ordinary = `ordinary_${randomUUID().replaceAll("-", "")}`
      await admin.query(`CREATE SCHEMA "${ordinary}"`)
      const url = new URL(env.DATABASE_URL)
      url.searchParams.set("schema", ordinary)
      const other = new PrismaClient<Prisma.PrismaClientOptions>({
        datasources: { db: { url: url.toString() } },
      })
      try {
        await expect(
          startPrecomputedIncumbentBaseline(other, { operator }),
        ).rejects.toMatchObject({ code: "verification_unavailable" })
      } finally {
        await other.$disconnect()
        await admin.query(`DROP SCHEMA "${ordinary}" CASCADE`)
      }
    })
  },
)
