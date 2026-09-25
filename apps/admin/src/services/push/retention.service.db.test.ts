/**
 * Real-Postgres companion to `retention.service.test.ts`.
 *
 * The mocked suite proves the branch shape and the cutoff arithmetic. This one
 * proves what a double cannot: that the day boundaries land on real rows, that
 * one page stays inside its batch size, and that deleting a retired phone does
 * not take its report rows with it.
 *
 * The PrismaClient is built in `beforeAll`, never in the describe body.
 */
import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { env } from "@/config/env"

import { purgeExpiredPushRows } from "./retention.service"

const databaseUrl = process.env.DATABASE_URL
const PREFIX = "push_ret_db_"
const NOW = new Date("2026-09-21T10:30:00.000Z")

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000)
}

describe.skipIf(env.PUSH_DB_TEST !== "1")(
  "push retention purge against Postgres",
  () => {
    let prisma: PrismaClient

    beforeAll(() => {
      prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    })

    beforeEach(async () => {
      await clean(prisma)
      await prisma.pushCampaign.create({
        data: {
          id: `${PREFIX}campaign`,
          status: "SENT",
          destinationKind: "VIDEO",
          destinationSlug: "jesus",
        },
      })
    })

    afterAll(async () => {
      await clean(prisma)
      await prisma.$disconnect()
    })

    async function registration(
      suffix: string,
      overrides: {
        status?: "ACTIVE" | "INACTIVE" | "INVALID" | "SUPERSEDED"
        refreshedAt?: Date
        statusChangedAt?: Date
      } = {},
    ): Promise<string> {
      const id = `${PREFIX}reg_${suffix}`
      await prisma.pushRegistration.create({
        data: {
          id,
          expoPushToken: `${PREFIX}token_${suffix}`,
          testDeviceId: `${PREFIX}device_${suffix}`,
          platform: "ANDROID",
          appBuild: "1.0.0",
          appLanguageSlug: "english",
          phoneLocale: "en-NZ",
          timeZone: "Pacific/Auckland",
          countrySource: "PHONE_REGION",
          status: overrides.status ?? "ACTIVE",
          refreshedAt: overrides.refreshedAt ?? NOW,
          statusChangedAt: overrides.statusChangedAt ?? NOW,
        },
      })
      return id
    }

    async function delivery(suffix: string, createdAt: Date): Promise<string> {
      const id = `${PREFIX}delivery_${suffix}`
      await prisma.pushDelivery.create({
        data: {
          id,
          nonce: `${PREFIX}nonce_${suffix}`,
          campaignId: `${PREFIX}campaign`,
          registrationId: await registration(suffix),
          localDay: new Date("2026-06-01T00:00:00.000Z"),
          languageSlug: "english",
          timeZone: "Pacific/Auckland",
          status: "HANDED_OFF",
          createdAt,
        },
      })
      return id
    }

    it("deletes rows past 90 days and keeps rows inside it", async () => {
      const oldDelivery = await delivery("old", daysAgo(91))
      const youngDelivery = await delivery("young", daysAgo(89))
      const keptDelivery = await delivery("kept", daysAgo(89))
      // An attribution cascades with its open, so the row that must survive
      // needs an open of its own that is still inside the window.
      await prisma.pushOpen.createMany({
        data: [
          {
            id: `${PREFIX}open_old`,
            deliveryId: youngDelivery,
            campaignId: `${PREFIX}campaign`,
            receivedAt: daysAgo(91),
            createdAt: daysAgo(91),
          },
          {
            id: `${PREFIX}open_young`,
            deliveryId: keptDelivery,
            campaignId: `${PREFIX}campaign`,
            receivedAt: daysAgo(89),
            createdAt: daysAgo(89),
          },
        ],
      })
      await prisma.pushAttribution.createMany({
        data: [
          {
            id: `${PREFIX}attribution_old`,
            episodeId: `${PREFIX}episode_old`,
            openId: `${PREFIX}open_old`,
            campaignId: `${PREFIX}campaign`,
            mediaId: "video_1",
            attributedAt: daysAgo(91),
            createdAt: daysAgo(91),
          },
          {
            id: `${PREFIX}attribution_young`,
            episodeId: `${PREFIX}episode_young`,
            openId: `${PREFIX}open_young`,
            campaignId: `${PREFIX}campaign`,
            mediaId: "video_1",
            attributedAt: daysAgo(89),
            createdAt: daysAgo(89),
          },
        ],
      })

      const result = await purgeExpiredPushRows(prisma, NOW)

      expect(result.status).toBe("succeeded")
      expect(result.rowCounts).toMatchObject({
        expiredAttributions: 1,
        expiredOpens: 1,
        expiredDeliveries: 1,
      })
      expect(
        await prisma.pushDelivery.findMany({
          where: { id: { startsWith: PREFIX } },
          orderBy: { id: "asc" },
          select: { id: true },
        }),
      ).toEqual([{ id: keptDelivery }, { id: youngDelivery }])
      expect(
        await prisma.pushAttribution.findMany({
          where: { id: { startsWith: PREFIX } },
          select: { id: true },
        }),
      ).toEqual([{ id: `${PREFIX}attribution_young` }])
      expect(oldDelivery).toBe(`${PREFIX}delivery_old`)
    })

    it("retires a phone at 181 days and leaves one refreshed 179 days ago", async () => {
      await registration("stale", { refreshedAt: daysAgo(181) })
      await registration("fresh", { refreshedAt: daysAgo(179) })

      const result = await purgeExpiredPushRows(prisma, NOW)

      expect(result.rowCounts.registrationsMarkedInactive).toBe(1)
      expect(
        await prisma.pushRegistration.findMany({
          where: { id: { startsWith: PREFIX } },
          orderBy: { id: "asc" },
          select: { id: true, status: true, statusChangedAt: true },
        }),
      ).toEqual([
        {
          id: `${PREFIX}reg_fresh`,
          status: "ACTIVE",
          statusChangedAt: NOW,
        },
        {
          id: `${PREFIX}reg_stale`,
          status: "INACTIVE",
          statusChangedAt: NOW,
        },
      ])
    })

    it("deletes a phone retired 91 days ago and keeps one retired 89 days ago", async () => {
      await registration("gone", {
        status: "INVALID",
        statusChangedAt: daysAgo(91),
      })
      await registration("blocked", {
        status: "INVALID",
        statusChangedAt: daysAgo(89),
      })

      const result = await purgeExpiredPushRows(prisma, NOW)

      expect(result.rowCounts.retiredRegistrationsDeleted).toBe(1)
      expect(
        await prisma.pushRegistration.findMany({
          where: { id: { startsWith: PREFIX } },
          select: { id: true, status: true },
        }),
      ).toEqual([{ id: `${PREFIX}reg_blocked`, status: "INVALID" }])
    })

    it("keeps the report row when the purge deletes the phone that held it", async () => {
      // The registration carries the push token, so it goes on schedule. The
      // delivery's own snapshot columns are what the report reads.
      await delivery("kept", daysAgo(10))
      await prisma.pushRegistration.update({
        where: { id: `${PREFIX}reg_kept` },
        data: { status: "SUPERSEDED", statusChangedAt: daysAgo(120) },
      })

      await purgeExpiredPushRows(prisma, NOW)

      expect(
        await prisma.pushDelivery.findMany({
          where: { id: { startsWith: PREFIX } },
          select: { id: true, registrationId: true, languageSlug: true },
        }),
      ).toEqual([
        {
          id: `${PREFIX}delivery_kept`,
          registrationId: null,
          languageSlug: "english",
        },
      ])
    })

    it("stops at the batch size and asks for another pass", async () => {
      await delivery("one", daysAgo(120))
      await delivery("two", daysAgo(110))
      await delivery("three", daysAgo(100))

      const first = await purgeExpiredPushRows(prisma, NOW, 1)

      expect(first.rowCounts.expiredDeliveries).toBe(1)
      expect(first.overdueAfterRun).toBe(true)
      expect(first.oldestExpiredAtAfter).toBe(daysAgo(110).toISOString())
      expect(
        await prisma.pushDelivery.count({
          where: { id: { startsWith: PREFIX } },
        }),
      ).toBe(2)

      await purgeExpiredPushRows(prisma, NOW, 1)
      const third = await purgeExpiredPushRows(prisma, NOW, 1)

      expect(third.overdueAfterRun).toBe(false)
      expect(
        await prisma.pushDelivery.count({
          where: { id: { startsWith: PREFIX } },
        }),
      ).toBe(0)
    })
  },
)

async function clean(prisma: PrismaClient): Promise<void> {
  const where = { id: { startsWith: PREFIX } }
  await prisma.pushAttribution.deleteMany({ where })
  await prisma.pushOpen.deleteMany({ where })
  await prisma.pushDelivery.deleteMany({ where })
  await prisma.pushTestDevice.deleteMany({ where })
  await prisma.pushCampaign.deleteMany({ where })
  await prisma.pushRegistration.deleteMany({ where })
}
