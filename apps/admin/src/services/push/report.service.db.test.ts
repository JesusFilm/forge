/**
 * Real-Postgres proof of R25, R26, and R27: every delivery status literal the
 * report reads is the one migration 0099 wrote, each device of one viewer
 * counts on its own, a superseded registration adds nothing, a test send
 * contributes nothing, and an unreachable device lands in the audience and in
 * no other count.
 *
 * The mocked suite proves the merge; only this one proves the SQL.
 *
 * Run with:
 *   PUSH_DB_TEST=1 DATABASE_URL=postgresql://forge@localhost:5432/forge_admin_push_test \
 *     pnpm --filter @forge/admin exec vitest run src/services/push/report.service.db.test.ts
 */
import { createHash } from "node:crypto"

import {
  PrismaClient,
  type PushDeliveryStatus,
  type PushPlatform,
} from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { env } from "@/config/env"

import { readPushCampaignReport } from "./report.service"

const databaseUrl = process.env.DATABASE_URL
const PREFIX = "push_report_db_"
const CAMPAIGN = `${PREFIX}campaign`
const LOCAL_DAY = new Date("2026-10-01T00:00:00.000Z")
const SENDING_AT = new Date("2026-10-01T20:00:00.000Z")
const OPEN_AT = new Date("2026-10-01T21:00:00.000Z")
/** One viewer, who reads on a phone and on a tablet. */
const SHARED_DIGEST = "d1".repeat(32)
/** The test device, which is in no live row of this campaign. */
const TEST_DEVICE_REGISTRATION = `${PREFIX}reg_test_device`
/**
 * The phone's older token. A rotation on the same install supersedes this row,
 * so no audience page reads it and no live delivery claims a day for it.
 */
const SUPERSEDED_REGISTRATION = `${PREFIX}reg_accepted_phone_old_token`

type Fixture = {
  key: string
  status: PushDeliveryStatus
  language: string
  country: string | null
  platform?: PushPlatform
  viewerDigest?: string | null
}

const FIXTURES: readonly Fixture[] = [
  // One viewer, two devices: the campaign reaches the phone and the tablet.
  {
    key: "accepted_phone",
    status: "ACCEPTED",
    language: "french",
    country: "FR",
    viewerDigest: SHARED_DIGEST,
  },
  {
    key: "accepted_tablet",
    status: "ACCEPTED",
    language: "french",
    country: "FR",
    viewerDigest: SHARED_DIGEST,
  },
  // A device with no viewer identity still counts, through its own row.
  {
    key: "handed_off",
    status: "HANDED_OFF",
    language: "english",
    country: "NZ",
    viewerDigest: null,
  },
  { key: "unknown", status: "UNKNOWN", language: "english", country: "NZ" },
  { key: "reserved", status: "RESERVED", language: "english", country: "NZ" },
  { key: "sending", status: "SENDING", language: "english", country: "NZ" },
  { key: "failed", status: "FAILED", language: "english", country: "NZ" },
  { key: "invalid", status: "INVALID", language: "english", country: "NZ" },
  {
    key: "suppressed",
    status: "SUPPRESSED",
    language: "english",
    country: "NZ",
  },
  { key: "missed", status: "MISSED", language: "english", country: "NZ" },
  // R26: Google's service does not deliver to an Android device here.
  {
    key: "unreachable",
    status: "UNREACHABLE",
    language: "english",
    country: "CN",
    platform: "ANDROID",
  },
  // A device whose country never resolved reads under the unknown key.
  {
    key: "no_country",
    status: "ACCEPTED",
    language: "english",
    country: null,
  },
]

describe.skipIf(env.PUSH_DB_TEST !== "1")(
  "the push campaign report against Postgres",
  () => {
    let prisma: PrismaClient

    beforeAll(() => {
      prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    })

    beforeEach(async () => {
      await clean(prisma)
      await prisma.pushCampaign.create({
        data: {
          id: CAMPAIGN,
          status: "SENT",
          destinationKind: "VIDEO",
          destinationSlug: "the-video",
          sendingStartedAt: SENDING_AT,
        },
      })
      for (const fixture of FIXTURES) {
        await prisma.pushRegistration.create({
          data: {
            id: `${PREFIX}reg_${fixture.key}`,
            expoPushToken: `ExponentPushToken[${PREFIX}${fixture.key}]`,
            testDeviceId: `${PREFIX}device_${fixture.key}`,
            viewerDigest:
              fixture.viewerDigest === undefined
                ? digestFor(fixture.key)
                : fixture.viewerDigest,
            platform: fixture.platform ?? "IOS",
            appBuild: "1.0.0",
            appLanguageSlug: fixture.language,
            phoneLocale: "en-NZ",
            timeZone: "Pacific/Auckland",
            country: fixture.country,
            countrySource: fixture.country === null ? "UNKNOWN" : "EDGE",
          },
        })
        await prisma.pushDelivery.create({
          data: {
            id: `${PREFIX}delivery_${fixture.key}`,
            nonce: `${PREFIX}nonce_${fixture.key}`.padEnd(43, "n").slice(0, 43),
            campaignId: CAMPAIGN,
            registrationId: `${PREFIX}reg_${fixture.key}`,
            localDay: LOCAL_DAY,
            languageSlug: fixture.language,
            country: fixture.country,
            timeZone: "Pacific/Auckland",
            status: fixture.status,
            sendingAt: SENDING_AT,
          },
        })
      }
      // The same install rotated its token, so its older row is superseded. It
      // is in no audience page, so it never claimed a day and has no live row.
      await prisma.pushRegistration.create({
        data: {
          id: SUPERSEDED_REGISTRATION,
          expoPushToken: `ExponentPushToken[${PREFIX}accepted_phone_old]`,
          testDeviceId: `${PREFIX}device_accepted_phone_old`,
          viewerDigest: SHARED_DIGEST,
          platform: "IOS",
          appBuild: "1.0.0",
          appLanguageSlug: "french",
          phoneLocale: "fr-FR",
          timeZone: "Europe/Paris",
          country: "FR",
          countrySource: "EDGE",
          status: "SUPERSEDED",
        },
      })
      // The accepted phone tapped, and watched twice.
      await prisma.pushOpen.create({
        data: {
          id: `${PREFIX}open_live`,
          deliveryId: `${PREFIX}delivery_accepted_phone`,
          campaignId: CAMPAIGN,
          registrationId: `${PREFIX}reg_accepted_phone`,
          viewerDigest: SHARED_DIGEST,
          sessionDigest: "e1".repeat(32),
          languageSlug: "french",
          country: "FR",
          receivedAt: OPEN_AT,
        },
      })
      for (const suffix of ["one", "two"]) {
        await prisma.pushAttribution.create({
          data: {
            id: `${PREFIX}attribution_${suffix}`,
            episodeId: `${PREFIX}episode_${suffix}`,
            openId: `${PREFIX}open_live`,
            campaignId: CAMPAIGN,
            registrationId: `${PREFIX}reg_accepted_phone`,
            viewerDigest: SHARED_DIGEST,
            languageSlug: "french",
            country: "FR",
            mediaId: "the-video",
            attributedAt: new Date(OPEN_AT.getTime() + 60_000),
          },
        })
      }
      // An admin's test device received the test send, tapped it, and watched.
      // It is deliberately a DIFFERENT device from every live row, and its
      // language and country are the live ones: a kind filter that went missing
      // would raise the audience, opened, and attributed counts below.
      await prisma.pushRegistration.create({
        data: {
          id: TEST_DEVICE_REGISTRATION,
          expoPushToken: `ExponentPushToken[${PREFIX}test_device]`,
          testDeviceId: `${PREFIX}device_test_device`,
          viewerDigest: digestFor("test_device"),
          platform: "IOS",
          appBuild: "1.0.0",
          appLanguageSlug: "french",
          phoneLocale: "fr-FR",
          timeZone: "Europe/Paris",
          country: "FR",
          countrySource: "EDGE",
        },
      })
      await prisma.pushDelivery.create({
        data: {
          id: `${PREFIX}delivery_test`,
          nonce: `${PREFIX}nonce_test`.padEnd(43, "t").slice(0, 43),
          kind: "TEST",
          campaignId: CAMPAIGN,
          registrationId: TEST_DEVICE_REGISTRATION,
          localDay: LOCAL_DAY,
          languageSlug: "french",
          country: "FR",
          timeZone: "Europe/Paris",
          status: "ACCEPTED",
          sendingAt: SENDING_AT,
        },
      })
      await prisma.pushOpen.create({
        data: {
          id: `${PREFIX}open_test`,
          deliveryId: `${PREFIX}delivery_test`,
          campaignId: CAMPAIGN,
          registrationId: TEST_DEVICE_REGISTRATION,
          viewerDigest: digestFor("test_device"),
          languageSlug: "french",
          country: "FR",
          receivedAt: OPEN_AT,
        },
      })
      await prisma.pushAttribution.create({
        data: {
          id: `${PREFIX}attribution_test`,
          episodeId: `${PREFIX}episode_test`,
          openId: `${PREFIX}open_test`,
          campaignId: CAMPAIGN,
          registrationId: TEST_DEVICE_REGISTRATION,
          viewerDigest: digestFor("test_device"),
          languageSlug: "french",
          country: "FR",
          mediaId: "the-video",
          attributedAt: OPEN_AT,
        },
      })
    })

    afterAll(async () => {
      await clean(prisma)
      await prisma.$disconnect()
    })

    it("counts every status the send path writes, devices not rows", async () => {
      const report = await readPushCampaignReport(prisma, CAMPAIGN)
      expect(report.status).toBe("SENT")
      expect(report.sendingStartedAt?.toISOString()).toBe(
        SENDING_AT.toISOString(),
      )
      expect(report.totals).toEqual({
        // 12 live rows, one per device the campaign reached.
        audience: 12,
        accepted: 3,
        handedOff: 1,
        unknown: 1,
        pending: 2,
        failed: 1,
        invalid: 1,
        suppressed: 1,
        unreachable: 1,
        missed: 1,
        opened: 1,
        attributed: 1,
        attributedWatchStarts: 2,
      })
    })

    it("counts each device of one viewer, not the viewer", async () => {
      const report = await readPushCampaignReport(prisma, CAMPAIGN)
      const french = report.byLanguage.find((slice) => slice.key === "french")
      // The phone and the tablet share one viewer digest and count twice.
      expect(french?.counts.audience).toBe(2)
      expect(french?.counts.accepted).toBe(2)
      expect(
        await prisma.pushRegistration.count({
          where: { viewerDigest: SHARED_DIGEST, status: "ACTIVE" },
        }),
      ).toBe(2)
    })

    it("counts a superseded re-registration once", async () => {
      const report = await readPushCampaignReport(prisma, CAMPAIGN)
      const french = report.byLanguage.find((slice) => slice.key === "french")
      // Three registrations carry the digest; the superseded one never claimed
      // a day, so the phone behind it counts once, through its live row.
      expect(
        await prisma.pushRegistration.count({
          where: { viewerDigest: SHARED_DIGEST },
        }),
      ).toBe(3)
      expect(
        await prisma.pushDelivery.count({
          where: {
            campaignId: CAMPAIGN,
            registrationId: SUPERSEDED_REGISTRATION,
          },
        }),
      ).toBe(0)
      expect(french?.counts.audience).toBe(2)
    })

    it("keeps the China Android device in the audience and nowhere else (AE17)", async () => {
      const report = await readPushCampaignReport(prisma, CAMPAIGN)
      const china = report.byCountry.find((slice) => slice.key === "CN")
      expect(china?.counts).toEqual({
        audience: 1,
        accepted: 0,
        handedOff: 0,
        unknown: 0,
        pending: 0,
        failed: 0,
        invalid: 0,
        suppressed: 0,
        unreachable: 1,
        missed: 0,
        opened: 0,
        attributed: 0,
        attributedWatchStarts: 0,
      })
    })

    it("leaves the test send out of every count", async () => {
      const report = await readPushCampaignReport(prisma, CAMPAIGN)
      // The rows exist; the report reads none of them.
      expect(
        await prisma.pushOpen.count({ where: { campaignId: CAMPAIGN } }),
      ).toBe(2)
      expect(
        await prisma.pushAttribution.count({ where: { campaignId: CAMPAIGN } }),
      ).toBe(3)
      expect(report.totals.audience).toBe(12)
      expect(report.totals.opened).toBe(1)
      expect(report.totals.attributed).toBe(1)
      expect(report.totals.attributedWatchStarts).toBe(2)
      const french = report.byLanguage.find((slice) => slice.key === "french")
      expect(french?.counts.audience).toBe(2)
      expect(french?.counts.opened).toBe(1)
      expect(french?.counts.attributed).toBe(1)
      expect(french?.counts.attributedWatchStarts).toBe(2)
    })

    it("names the devices with no country under one key, last", async () => {
      const report = await readPushCampaignReport(prisma, CAMPAIGN)
      expect(report.byCountry.map((slice) => slice.key)).toEqual([
        "CN",
        "FR",
        "NZ",
        "(unknown)",
      ])
      expect(report.byCountry.at(-1)?.counts.audience).toBe(1)
    })

    it("raises opened and attributed on a later read of a sent campaign", async () => {
      const before = await readPushCampaignReport(prisma, CAMPAIGN)
      await prisma.pushOpen.create({
        data: {
          id: `${PREFIX}open_late`,
          deliveryId: `${PREFIX}delivery_handed_off`,
          campaignId: CAMPAIGN,
          registrationId: `${PREFIX}reg_handed_off`,
          languageSlug: "english",
          country: "NZ",
          receivedAt: new Date(OPEN_AT.getTime() + 3 * 60 * 60 * 1_000),
        },
      })
      await prisma.pushAttribution.create({
        data: {
          id: `${PREFIX}attribution_late`,
          episodeId: `${PREFIX}episode_late`,
          openId: `${PREFIX}open_late`,
          campaignId: CAMPAIGN,
          registrationId: `${PREFIX}reg_handed_off`,
          languageSlug: "english",
          country: "NZ",
          mediaId: "the-video",
          attributedAt: new Date(OPEN_AT.getTime() + 4 * 60 * 60 * 1_000),
        },
      })
      const after = await readPushCampaignReport(prisma, CAMPAIGN)
      expect(before.totals.opened).toBe(1)
      expect(after.totals.opened).toBe(2)
      expect(after.totals.attributed).toBe(2)
      expect(after.totals.attributedWatchStarts).toBe(3)
    })
  },
)

/** One distinct viewer per fixture: a hash, never a derivation of the key's
 * letters, which collided and merged two viewers into one. */
function digestFor(key: string): string {
  return createHash("sha256").update(`${PREFIX}${key}`).digest("hex")
}

async function clean(prisma: PrismaClient): Promise<void> {
  await prisma.pushAttribution.deleteMany({ where: { campaignId: CAMPAIGN } })
  await prisma.pushOpen.deleteMany({ where: { campaignId: CAMPAIGN } })
  await prisma.pushDelivery.deleteMany({ where: { campaignId: CAMPAIGN } })
  await prisma.pushCampaign.deleteMany({ where: { id: CAMPAIGN } })
  await prisma.pushRegistration.deleteMany({
    where: { id: { startsWith: `${PREFIX}reg_` } },
  })
}
