/**
 * Real-Postgres proof of KTD14: the nonce resolves through its unique index,
 * and the open table's unique delivery makes a replayed report a no-op.
 *
 * The PrismaClient is built in `beforeAll`, never in the describe body:
 * `describe.skipIf` still runs the body to collect the tests, and a client
 * constructed there with no URL throws at collection time.
 *
 * Run with:
 *   PUSH_DB_TEST=1 DATABASE_URL=postgresql://forge@localhost:5432/forge_admin_push_test \
 *     pnpm --filter @forge/admin exec vitest run src/services/push/open-report.service.db.test.ts
 */
import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { env } from "@/config/env"

import { reportPushOpen } from "./open-report.service"

const databaseUrl = process.env.DATABASE_URL
const PREFIX = "push_open_db_"
const CAMPAIGN = `${PREFIX}campaign`
const REGISTRATION = `${PREFIX}reg`
const DELIVERY = `${PREFIX}delivery`
// A nonce is exactly 43 base64url characters, so the test value is padded.
const NONCE = "pushopendbtestnonce".padEnd(43, "o")
const UNKNOWN_NONCE = "pushopendbtestunknown".padEnd(43, "z")
const STORED_DIGEST = "3".repeat(64)
const OTHER_DIGEST = "4".repeat(64)
const SESSION_DIGEST = "5".repeat(64)
const SENDING_AT = new Date("2026-10-01T20:00:00.000Z")

describe.skipIf(env.PUSH_DB_TEST !== "1")(
  "push open reports against Postgres",
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
          viewerDigest: STORED_DIGEST,
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
          status: "SENDING",
          destinationKind: "SERIES",
          destinationSlug: "a-series",
        },
      })
      await prisma.pushDelivery.create({
        data: {
          id: DELIVERY,
          nonce: NONCE,
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

    it("stores one open with the delivery's own snapshot", async () => {
      const receipt = await reportPushOpen(prisma, {
        input: { nonce: NONCE },
        viewerDigest: null,
        sessionDigest: null,
      })
      expect(receipt.outcome).toBe("STORED")

      const open = await prisma.pushOpen.findUniqueOrThrow({
        where: { deliveryId: DELIVERY },
      })
      expect(open.campaignId).toBe(CAMPAIGN)
      expect(open.registrationId).toBe(REGISTRATION)
      expect(open.languageSlug).toBe("french")
      expect(open.country).toBe("FR")
      expect(open.viewerDigest).toBe(STORED_DIGEST)
      expect(open.sessionDigest).toBeNull()
      expect(open.viewerMismatch).toBe(false)
    })

    it("keeps one open per delivery when the report replays", async () => {
      await reportPushOpen(prisma, {
        input: { nonce: NONCE },
        viewerDigest: null,
        sessionDigest: null,
      })
      const second = await reportPushOpen(prisma, {
        input: { nonce: NONCE },
        viewerDigest: null,
        sessionDigest: null,
      })
      expect(second.outcome).toBe("DUPLICATE")
      expect(
        await prisma.pushOpen.count({ where: { deliveryId: DELIVERY } }),
      ).toBe(1)
    })

    it("stores nothing for a nonce nobody issued", async () => {
      const receipt = await reportPushOpen(prisma, {
        input: { nonce: UNKNOWN_NONCE },
        viewerDigest: null,
        sessionDigest: null,
      })
      expect(receipt.outcome).toBe("UNKNOWN")
      expect(
        await prisma.pushOpen.count({ where: { campaignId: CAMPAIGN } }),
      ).toBe(0)
    })

    it("flags an open whose handle is not the registration's viewer", async () => {
      await reportPushOpen(prisma, {
        input: { nonce: NONCE },
        viewerDigest: OTHER_DIGEST,
        sessionDigest: SESSION_DIGEST,
      })
      const open = await prisma.pushOpen.findUniqueOrThrow({
        where: { deliveryId: DELIVERY },
      })
      expect(open.viewerMismatch).toBe(true)
      expect(open.viewerDigest).toBe(OTHER_DIGEST)
      expect(open.sessionDigest).toBe(SESSION_DIGEST)
    })

    it("hands the attribution seam the delivery's sending time", async () => {
      const seen: { deliverySendingAt: Date | null }[] = []
      await reportPushOpen(
        prisma,
        {
          input: { nonce: NONCE },
          viewerDigest: null,
          sessionDigest: null,
        },
        { afterOpenStored: (open) => void seen.push(open) },
      )
      expect(seen).toHaveLength(1)
      expect(seen[0].deliverySendingAt?.toISOString()).toBe(
        SENDING_AT.toISOString(),
      )
    })
  },
)

async function clean(prisma: PrismaClient): Promise<void> {
  await prisma.pushOpen.deleteMany({ where: { campaignId: CAMPAIGN } })
  await prisma.pushDelivery.deleteMany({ where: { campaignId: CAMPAIGN } })
  await prisma.pushCampaign.deleteMany({ where: { id: CAMPAIGN } })
  await prisma.pushRegistration.deleteMany({ where: { id: REGISTRATION } })
}
