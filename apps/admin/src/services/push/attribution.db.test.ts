/**
 * Real-Postgres proof of KTD8: both joins read through their own indexes, the
 * unique episode id makes the loser of the race a no-op, and the attribution
 * row outlives the playback episode it names.
 *
 * The PrismaClient is built in `beforeAll`, never in the describe body:
 * `describe.skipIf` still runs the body to collect the tests, and a client
 * constructed there with no URL throws at collection time.
 *
 * Run with:
 *   PUSH_DB_TEST=1 DATABASE_URL=postgresql://forge@localhost:5432/forge_admin_push_test \
 *     pnpm --filter @forge/admin exec vitest run src/services/push/attribution.db.test.ts
 */
import { createHash } from "node:crypto"

import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { env } from "@/config/env"

import {
  attributeEpisodeToStoredOpen,
  attributeOpenToIssuedEpisode,
} from "./attribution.service"
import type { PushStoredOpen } from "./open-report.service"

const databaseUrl = process.env.DATABASE_URL
const PREFIX = "push_attribution_db_"
const CAMPAIGN = `${PREFIX}campaign`
const REGISTRATION = `${PREFIX}reg`
const DELIVERY = `${PREFIX}delivery`
const OPEN = `${PREFIX}open`
const EPISODE = `${PREFIX}episode`
const VIEWER_DIGEST = "a7".repeat(32)
const OTHER_VIEWER_DIGEST = "b8".repeat(32)
const SESSION_DIGEST = "c9".repeat(32)

const HOUR_MS = 60 * 60 * 1_000
const SENDING_AT = new Date("2026-10-01T20:00:00.000Z")
const OPEN_AT = new Date("2026-10-01T21:00:00.000Z")
const ISSUED_AT = new Date(OPEN_AT.getTime() + HOUR_MS)

function storedOpen(overrides: Partial<PushStoredOpen> = {}): PushStoredOpen {
  return {
    id: OPEN,
    deliveryId: DELIVERY,
    campaignId: CAMPAIGN,
    registrationId: REGISTRATION,
    viewerDigest: VIEWER_DIGEST,
    sessionDigest: SESSION_DIGEST,
    languageSlug: "french",
    country: "FR",
    viewerMismatch: false,
    receivedAt: OPEN_AT,
    deliverySendingAt: SENDING_AT,
    ...overrides,
  }
}

describe.skipIf(env.PUSH_DB_TEST !== "1")(
  "push attribution against Postgres",
  () => {
    let prisma: PrismaClient

    beforeAll(() => {
      prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    })

    beforeEach(async () => {
      await clean(prisma)
      await prisma.pushRegistration.create({
        data: {
          id: REGISTRATION,
          expoPushToken: `ExponentPushToken[${PREFIX}one]`,
          testDeviceId: `${PREFIX}device`,
          viewerDigest: VIEWER_DIGEST,
          platform: "IOS",
          appBuild: "1.0.0",
          appLanguageSlug: "english",
          phoneLocale: "fr-FR",
          timeZone: "Europe/Paris",
          countrySource: "EDGE",
        },
      })
      await prisma.pushCampaign.create({
        data: {
          id: CAMPAIGN,
          status: "SENT",
          destinationKind: "VIDEO",
          destinationSlug: "the-video",
        },
      })
      await prisma.pushDelivery.create({
        data: {
          id: DELIVERY,
          nonce: `${PREFIX}nonce`.padEnd(43, "n"),
          campaignId: CAMPAIGN,
          registrationId: REGISTRATION,
          localDay: new Date("2026-10-01T00:00:00.000Z"),
          languageSlug: "french",
          country: "FR",
          timeZone: "Europe/Paris",
          status: "ACCEPTED",
          sendingAt: SENDING_AT,
        },
      })
    })

    afterAll(async () => {
      await clean(prisma)
      await prisma.$disconnect()
    })

    describe("the forward join in the issuance resolver", () => {
      it("attributes a context issued inside the window (AE16)", async () => {
        await storeOpen(prisma)
        const result = await attributeOpenToIssuedEpisode(prisma, {
          episodeId: EPISODE,
          mediaId: "the-video",
          viewerDigest: VIEWER_DIGEST,
          sessionDigest: SESSION_DIGEST,
          issuedAt: ISSUED_AT,
        })
        expect(result).toEqual({
          outcome: "attributed",
          campaignId: CAMPAIGN,
        })
        const row = await prisma.pushAttribution.findUniqueOrThrow({
          where: { episodeId: EPISODE },
        })
        expect(row.openId).toBe(OPEN)
        expect(row.campaignId).toBe(CAMPAIGN)
        expect(row.registrationId).toBe(REGISTRATION)
        expect(row.viewerDigest).toBe(VIEWER_DIGEST)
        expect(row.languageSlug).toBe("french")
        expect(row.country).toBe("FR")
        expect(row.mediaId).toBe("the-video")
        expect(row.attributedAt.toISOString()).toBe(ISSUED_AT.toISOString())
      })

      it("attributes nothing a day and an hour after the open (AE16)", async () => {
        await storeOpen(prisma)
        const result = await attributeOpenToIssuedEpisode(prisma, {
          episodeId: EPISODE,
          mediaId: "the-video",
          viewerDigest: VIEWER_DIGEST,
          sessionDigest: SESSION_DIGEST,
          issuedAt: new Date(OPEN_AT.getTime() + 25 * HOUR_MS),
        })
        expect(result.outcome).toBe("no_open")
        expect(
          await prisma.pushAttribution.count({
            where: { campaignId: CAMPAIGN },
          }),
        ).toBe(0)
      })

      it("attributes nothing through a mismatched open", async () => {
        await storeOpen(prisma, {
          viewerDigest: OTHER_VIEWER_DIGEST,
          viewerMismatch: true,
        })
        const result = await attributeOpenToIssuedEpisode(prisma, {
          episodeId: EPISODE,
          mediaId: "the-video",
          viewerDigest: OTHER_VIEWER_DIGEST,
          sessionDigest: SESSION_DIGEST,
          issuedAt: ISSUED_AT,
        })
        expect(result.outcome).toBe("no_open")
        expect(
          await prisma.pushAttribution.count({
            where: { campaignId: CAMPAIGN },
          }),
        ).toBe(0)
      })
    })

    describe("the reverse join in the open report", () => {
      it("attributes a context issued 200 milliseconds before the open", async () => {
        await storeEpisode(prisma, new Date(OPEN_AT.getTime() - 200))
        await storeOpen(prisma)
        const result = await attributeEpisodeToStoredOpen(prisma, storedOpen())
        expect(result.outcome).toBe("attributed")
        const row = await prisma.pushAttribution.findUniqueOrThrow({
          where: { episodeId: EPISODE },
        })
        expect(row.openId).toBe(OPEN)
        expect(row.mediaId).toBe("the-video")
      })

      it("attributes nothing to a context issued before the delivery went out", async () => {
        // Inside the 60-second grace, so only the sending-time bound refuses it.
        await storeEpisode(prisma, new Date(SENDING_AT.getTime() - 10_000))
        await storeOpen(prisma)
        const result = await attributeEpisodeToStoredOpen(
          prisma,
          storedOpen({ receivedAt: new Date(SENDING_AT.getTime() + 20_000) }),
        )
        expect(result.outcome).toBe("no_episode")
        expect(
          await prisma.pushAttribution.count({
            where: { campaignId: CAMPAIGN },
          }),
        ).toBe(0)
      })
    })

    it("keeps one row when both directions attribute the same episode", async () => {
      await storeEpisode(prisma, new Date(OPEN_AT.getTime() - 200))
      await storeOpen(prisma)
      const reverse = await attributeEpisodeToStoredOpen(prisma, storedOpen())
      expect(reverse.outcome).toBe("attributed")
      const forward = await attributeOpenToIssuedEpisode(prisma, {
        episodeId: EPISODE,
        mediaId: "the-video",
        viewerDigest: VIEWER_DIGEST,
        sessionDigest: SESSION_DIGEST,
        issuedAt: ISSUED_AT,
      })
      expect(forward.outcome).toBe("duplicate")
      expect(
        await prisma.pushAttribution.count({ where: { campaignId: CAMPAIGN } }),
      ).toBe(1)
    })

    it("keeps the attributed watch start after the episode is purged", async () => {
      await storeEpisode(prisma, new Date(OPEN_AT.getTime() - 200))
      await storeOpen(prisma)
      await attributeEpisodeToStoredOpen(prisma, storedOpen())
      await prisma.recommendationPlaybackEpisode.delete({
        where: { id: EPISODE },
      })
      expect(
        await prisma.pushAttribution.count({ where: { episodeId: EPISODE } }),
      ).toBe(1)
    })
  },
)

async function storeOpen(
  prisma: PrismaClient,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await prisma.pushOpen.create({
    data: {
      id: OPEN,
      deliveryId: DELIVERY,
      campaignId: CAMPAIGN,
      registrationId: REGISTRATION,
      viewerDigest: VIEWER_DIGEST,
      sessionDigest: SESSION_DIGEST,
      languageSlug: "french",
      country: "FR",
      viewerMismatch: false,
      receivedAt: OPEN_AT,
      ...overrides,
    },
  })
}

async function storeEpisode(
  prisma: PrismaClient,
  createdAt: Date,
): Promise<void> {
  await prisma.recommendationPlaybackEpisode.create({
    data: {
      id: EPISODE,
      mediaId: "the-video",
      sessionDigest: SESSION_DIGEST,
      discoverySource: "acquisition",
      createdAt,
      // A pending episode carries a claim handoff, per the 0072 check.
      claimNonceDigest: createHash("sha256")
        .update(`${EPISODE}${createdAt.toISOString()}`)
        .digest("hex"),
      handoffExpiresAt: new Date(createdAt.getTime() + 10 * 60_000),
      activeUntil: new Date(createdAt.getTime() + HOUR_MS),
      hardUntil: new Date(createdAt.getTime() + 2 * HOUR_MS),
      expiresAt: new Date(createdAt.getTime() + 29 * 24 * HOUR_MS),
    },
  })
}

async function clean(prisma: PrismaClient): Promise<void> {
  await prisma.pushAttribution.deleteMany({ where: { campaignId: CAMPAIGN } })
  await prisma.pushOpen.deleteMany({ where: { campaignId: CAMPAIGN } })
  await prisma.pushDelivery.deleteMany({ where: { campaignId: CAMPAIGN } })
  await prisma.pushCampaign.deleteMany({ where: { id: CAMPAIGN } })
  await prisma.pushRegistration.deleteMany({ where: { id: REGISTRATION } })
  await prisma.recommendationPlaybackEpisode.deleteMany({
    where: { sessionDigest: SESSION_DIGEST },
  })
}
