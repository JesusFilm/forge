/**
 * Real-Postgres proof of the push claim contracts that migration 0100 owns.
 *
 * Nothing here calls a service. The claim service lands in U3; these tests
 * prove the indexes it will lean on, using the same statement shape it must
 * use: one multi-row `INSERT ... ON CONFLICT DO NOTHING` with no conflict
 * target, so every partial unique index on the table is an arbiter.
 *
 * The PrismaClient is built in `beforeAll`, never in the describe body:
 * `describe.skipIf` still runs the body to collect the tests, and a client
 * constructed there with no URL throws at collection time.
 *
 * Run with:
 *   PUSH_DB_TEST=1 DATABASE_URL=postgresql://forge@localhost:5432/forge_admin_push_test \
 *     pnpm --filter @forge/admin exec vitest run src/services/push/schema.db.test.ts
 */
import { Prisma, PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { env } from "@/config/env"

const databaseUrl = process.env.DATABASE_URL
const PREFIX = "push_schema_db_"
const LOCAL_DAY = "2026-09-21"
// Sibling database suites run in parallel, so every read is scoped to the
// rows this file created.
const mine = { id: { startsWith: PREFIX } }

type ClaimRow = {
  id: string
  nonce: string
  kind: "live" | "test"
  campaignId: string
  registrationId: string
  localDay: string
  status?: string
}

function claimStatement(rows: readonly ClaimRow[]): Prisma.Sql {
  const values = rows.map(
    (row) => Prisma.sql`(
      ${row.id}, ${row.nonce}, ${row.kind}::"PushDeliveryKind",
      ${row.campaignId}, ${row.registrationId}, ${row.localDay}::date,
      'en', 'NZ', 'Pacific/Auckland',
      ${row.status ?? "reserved"}::"PushDeliveryStatus", CURRENT_TIMESTAMP
    )`,
  )
  return Prisma.sql`
    INSERT INTO push_delivery (
      id, nonce, kind, campaign_id, registration_id, local_day,
      language_slug, country, time_zone, status, updated_at
    )
    VALUES ${Prisma.join(values)}
    ON CONFLICT DO NOTHING
  `
}

/** An attribution's open is required, and an open needs its own delivery. */
async function openFor(prisma: PrismaClient, suffix: string): Promise<string> {
  const deliveryId = `${PREFIX}delivery_${suffix}`
  await prisma.$executeRaw(
    claimStatement([
      {
        id: deliveryId,
        nonce: `${PREFIX}nonce_${suffix}`,
        kind: "live",
        campaignId: `${PREFIX}campaign_a`,
        registrationId: `${PREFIX}reg_1`,
        localDay: LOCAL_DAY,
      },
    ]),
  )
  const openId = `${PREFIX}open_${suffix}`
  await prisma.pushOpen.create({
    data: {
      id: openId,
      deliveryId,
      campaignId: `${PREFIX}campaign_a`,
      registrationId: `${PREFIX}reg_1`,
      receivedAt: new Date(),
    },
  })
  return openId
}

describe.skipIf(env.PUSH_DB_TEST !== "1")(
  "push claim indexes against Postgres",
  () => {
    let prisma: PrismaClient
    let second: PrismaClient

    beforeAll(() => {
      prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
      second = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    })

    beforeEach(async () => {
      await clean(prisma)
      await prisma.pushRegistration.create({
        data: {
          id: `${PREFIX}reg_1`,
          expoPushToken: `${PREFIX}token_1`,
          testDeviceId: `${PREFIX}device_1`,
          platform: "IOS",
          appBuild: "1.0.0",
          appLanguageSlug: "english",
          phoneLocale: "en-NZ",
          timeZone: "Pacific/Auckland",
          countrySource: "EDGE",
        },
      })
      await prisma.pushCampaign.createMany({
        data: ["a", "b"].map((suffix) => ({
          id: `${PREFIX}campaign_${suffix}`,
          status: "SENDING" as const,
          destinationKind: "SERIES" as const,
          destinationSlug: `series-${suffix}`,
        })),
      })
    })

    afterAll(async () => {
      await clean(prisma)
      await Promise.all([prisma.$disconnect(), second.$disconnect()])
    })

    it("keeps one claim when two connections insert the same phone and day", async () => {
      const row = (id: string): ClaimRow => ({
        id: `${PREFIX}delivery_${id}`,
        nonce: `${PREFIX}nonce_${id}`,
        kind: "live",
        campaignId: `${PREFIX}campaign_a`,
        registrationId: `${PREFIX}reg_1`,
        localDay: LOCAL_DAY,
      })

      const inserted = await Promise.all([
        prisma.$executeRaw(claimStatement([row("one")])),
        second.$executeRaw(claimStatement([row("two")])),
      ])

      expect(inserted.reduce((total, count) => total + count, 0)).toBe(1)
      expect(await prisma.pushDelivery.count({ where: mine })).toBe(1)
    })

    it("inserts nothing on a replayed claim and leaves the first row", async () => {
      const row: ClaimRow = {
        id: `${PREFIX}delivery_first`,
        nonce: `${PREFIX}nonce_first`,
        kind: "live",
        campaignId: `${PREFIX}campaign_a`,
        registrationId: `${PREFIX}reg_1`,
        localDay: LOCAL_DAY,
      }
      await prisma.$executeRaw(claimStatement([row]))

      const replayed = await prisma.$executeRaw(
        claimStatement([
          {
            ...row,
            id: `${PREFIX}delivery_replay`,
            nonce: `${PREFIX}nonce_replay`,
          },
        ]),
      )

      expect(replayed).toBe(0)
      const rows = await prisma.pushDelivery.findMany({
        where: mine,
        select: { id: true },
      })
      expect(rows).toEqual([{ id: `${PREFIX}delivery_first` }])
    })

    it.each(["failed", "missed", "suppressed", "unreachable", "invalid"])(
      "frees the phone's day when a claim ends %s",
      async (outcome) => {
        await prisma.$executeRaw(
          claimStatement([
            {
              id: `${PREFIX}delivery_a`,
              nonce: `${PREFIX}nonce_a`,
              kind: "live",
              campaignId: `${PREFIX}campaign_a`,
              registrationId: `${PREFIX}reg_1`,
              localDay: LOCAL_DAY,
              status: outcome,
            },
          ]),
        )

        const claimed = await prisma.$executeRaw(
          claimStatement([
            {
              id: `${PREFIX}delivery_b`,
              nonce: `${PREFIX}nonce_b`,
              kind: "live",
              campaignId: `${PREFIX}campaign_b`,
              registrationId: `${PREFIX}reg_1`,
              localDay: LOCAL_DAY,
            },
          ]),
        )

        expect(claimed).toBe(1)
      },
    )

    it.each(["reserved", "sending", "accepted", "handed_off", "unknown"])(
      "holds the phone's day while a claim sits at %s",
      async (held) => {
        await prisma.$executeRaw(
          claimStatement([
            {
              id: `${PREFIX}delivery_a`,
              nonce: `${PREFIX}nonce_a`,
              kind: "live",
              campaignId: `${PREFIX}campaign_a`,
              registrationId: `${PREFIX}reg_1`,
              localDay: LOCAL_DAY,
              status: held,
            },
          ]),
        )

        const claimed = await prisma.$executeRaw(
          claimStatement([
            {
              id: `${PREFIX}delivery_b`,
              nonce: `${PREFIX}nonce_b`,
              kind: "live",
              campaignId: `${PREFIX}campaign_b`,
              registrationId: `${PREFIX}reg_1`,
              localDay: LOCAL_DAY,
            },
          ]),
        )

        expect(claimed).toBe(0)
      },
    )

    it("keeps a test row beside the live row and refuses a second live row", async () => {
      const base = {
        campaignId: `${PREFIX}campaign_a`,
        registrationId: `${PREFIX}reg_1`,
        localDay: LOCAL_DAY,
      }
      const testRow = await prisma.$executeRaw(
        claimStatement([
          {
            ...base,
            id: `${PREFIX}delivery_test`,
            nonce: `${PREFIX}nonce_test`,
            kind: "test",
          },
        ]),
      )
      const liveRow = await prisma.$executeRaw(
        claimStatement([
          {
            ...base,
            id: `${PREFIX}delivery_live`,
            nonce: `${PREFIX}nonce_live`,
            kind: "live",
          },
        ]),
      )
      const secondLiveRow = await prisma.$executeRaw(
        claimStatement([
          {
            ...base,
            id: `${PREFIX}delivery_live_again`,
            nonce: `${PREFIX}nonce_live_again`,
            kind: "live",
            localDay: "2026-09-22",
          },
        ]),
      )

      expect([testRow, liveRow, secondLiveRow]).toEqual([1, 1, 0])
      expect(
        await prisma.pushDelivery.findMany({
          where: mine,
          orderBy: { id: "asc" },
          select: { id: true, kind: true },
        }),
      ).toEqual([
        { id: `${PREFIX}delivery_live`, kind: "LIVE" },
        { id: `${PREFIX}delivery_test`, kind: "TEST" },
      ])
    })

    it("refuses two deliveries that share a nonce", async () => {
      await prisma.$executeRaw(
        claimStatement([
          {
            id: `${PREFIX}delivery_a`,
            nonce: `${PREFIX}nonce_shared`,
            kind: "live",
            campaignId: `${PREFIX}campaign_a`,
            registrationId: `${PREFIX}reg_1`,
            localDay: LOCAL_DAY,
          },
        ]),
      )

      const duplicate = await prisma.$executeRaw(
        claimStatement([
          {
            id: `${PREFIX}delivery_b`,
            nonce: `${PREFIX}nonce_shared`,
            kind: "live",
            campaignId: `${PREFIX}campaign_b`,
            registrationId: `${PREFIX}reg_1`,
            localDay: "2026-09-30",
          },
        ]),
      )

      expect(duplicate).toBe(0)
      expect(await prisma.pushDelivery.count({ where: mine })).toBe(1)
    })

    it("stores an attribution whose episode is not in the recommendation tables", async () => {
      // No foreign key on episode_id: the recommendation retention purge must
      // never remove a campaign's attributed watch start.
      const episodeId = `${PREFIX}episode_never_stored`
      expect(
        await prisma.recommendationPlaybackEpisode.count({
          where: { id: episodeId },
        }),
      ).toBe(0)

      await prisma.pushAttribution.create({
        data: {
          id: `${PREFIX}attribution_1`,
          episodeId,
          openId: await openFor(prisma, "one"),
          campaignId: `${PREFIX}campaign_a`,
          registrationId: `${PREFIX}reg_1`,
          mediaId: "video_1",
          attributedAt: new Date(),
        },
      })

      expect(await prisma.pushAttribution.count({ where: { episodeId } })).toBe(
        1,
      )
    })

    it("keeps the attribution when the recommendation purge deletes its episode", async () => {
      const episodeId = `${PREFIX}episode_purged`
      const hour = (count: number) =>
        new Date(Date.now() + count * 60 * 60 * 1000)
      await prisma.recommendationPlaybackEpisode.create({
        data: {
          id: episodeId,
          mediaId: "video_1",
          sessionDigest: "e".repeat(64),
          claimNonceDigest: "f".repeat(64),
          handoffExpiresAt: hour(1),
          activeUntil: hour(1),
          hardUntil: hour(2),
          expiresAt: hour(3),
        },
      })
      await prisma.pushAttribution.create({
        data: {
          id: `${PREFIX}attribution_2`,
          episodeId,
          openId: await openFor(prisma, "two"),
          campaignId: `${PREFIX}campaign_a`,
          registrationId: `${PREFIX}reg_1`,
          mediaId: "video_1",
          attributedAt: new Date(),
        },
      })

      await prisma.recommendationPlaybackEpisode.delete({
        where: { id: episodeId },
      })

      expect(await prisma.pushAttribution.count({ where: { episodeId } })).toBe(
        1,
      )
    })

    it("keeps the delivery row when its phone's registration is deleted", async () => {
      // The purge deletes a retired registration to drop its push token. The
      // report reads the delivery's own snapshot columns, so the row stays.
      await prisma.$executeRaw(
        claimStatement([
          {
            id: `${PREFIX}delivery_a`,
            nonce: `${PREFIX}nonce_a`,
            kind: "live",
            campaignId: `${PREFIX}campaign_a`,
            registrationId: `${PREFIX}reg_1`,
            localDay: LOCAL_DAY,
          },
        ]),
      )

      await prisma.pushRegistration.delete({
        where: { id: `${PREFIX}reg_1` },
      })

      expect(
        await prisma.pushDelivery.findMany({
          where: mine,
          select: { id: true, registrationId: true, country: true },
        }),
      ).toEqual([
        {
          id: `${PREFIX}delivery_a`,
          registrationId: null,
          country: "NZ",
        },
      ])
    })
  },
)

async function clean(prisma: PrismaClient): Promise<void> {
  const where = { id: { startsWith: PREFIX } }
  await prisma.recommendationPlaybackEpisode.deleteMany({ where })
  await prisma.pushAttribution.deleteMany({ where })
  await prisma.pushOpen.deleteMany({ where })
  await prisma.pushDelivery.deleteMany({ where })
  await prisma.pushCampaignZone.deleteMany({ where })
  await prisma.pushCampaignCopy.deleteMany({ where })
  await prisma.pushTestDevice.deleteMany({ where })
  await prisma.pushCampaign.deleteMany({ where })
  await prisma.pushRegistration.deleteMany({ where })
}
