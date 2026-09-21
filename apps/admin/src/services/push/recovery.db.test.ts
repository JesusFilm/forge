/**
 * The recovery store against real Postgres.
 *
 * The sweep decides whether a live wave is retired, so its two-step join from
 * campaign to ledger to runtime id is proven here rather than only in a fake.
 *
 * Run with:
 *   PUSH_DB_TEST=1 DATABASE_URL=postgresql://forge@localhost:5432/forge_admin_push_test \
 *     pnpm --filter @forge/admin exec vitest run src/services/push/recovery.db.test.ts
 */
import { PrismaClient } from "@prisma/client"
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

import { env } from "@/config/env"

import {
  createPushRecoveryStore,
  sweepOrphanedPushCampaigns,
  type PushRecoveryStore,
} from "./recovery"

const databaseUrl = process.env.DATABASE_URL
const PREFIX = "push_recovery_db_"
const ZONE = "Pacific/Auckland"

/**
 * The sweep reads every live campaign on purpose, and the push database suites
 * run in parallel against one database. This wrapper keeps every real write
 * statement and narrows only the read, so the sweep cannot pause a sibling
 * suite's campaign. The unnarrowed read has its own test above.
 */
function scopedStore(prisma: PrismaClient): PushRecoveryStore {
  const store = createPushRecoveryStore(prisma)
  return {
    ...store,
    async readActiveCampaigns(limit) {
      const campaigns = await store.readActiveCampaigns(limit)
      return campaigns.filter((campaign) => campaign.id.startsWith(PREFIX))
    },
  }
}

describe.skipIf(env.PUSH_DB_TEST !== "1")(
  "the push recovery store against Postgres",
  () => {
    let prisma: PrismaClient

    beforeAll(() => {
      prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
      vi.spyOn(console, "info").mockImplementation(() => {})
      vi.spyOn(console, "warn").mockImplementation(() => {})
    })

    beforeEach(async () => {
      await clean(prisma)
      await prisma.workflowRun.create({
        data: {
          id: `${PREFIX}ledger`,
          workflowKey: "push-campaign",
          trigger: "MANUAL",
          status: "RUNNING",
          runtimeRunId: `${PREFIX}runtime`,
        },
      })
      await prisma.pushRegistration.create({
        data: {
          id: `${PREFIX}reg_1`,
          expoPushToken: `${PREFIX}ExponentPushToken[t1]`,
          testDeviceId: `${PREFIX}device1`,
          platform: "IOS",
          appBuild: "1.0.0",
          appLanguageSlug: "english",
          phoneLocale: "en-NZ",
          timeZone: ZONE,
          country: "NZ",
          countrySource: "EDGE",
        },
      })
      await prisma.pushCampaign.create({
        data: {
          id: `${PREFIX}campaign`,
          status: "SENDING",
          // Migration 0099 checks that anything past draft names a
          // destination, so the fixture has to carry one.
          destinationKind: "SERIES",
          destinationSlug: "washi-gospel",
          audienceScope: "EVERYWHERE",
          workflowRunLogId: `${PREFIX}ledger`,
        },
      })
      await prisma.pushCampaignZone.create({
        data: {
          id: `${PREFIX}zone`,
          campaignId: `${PREFIX}campaign`,
          timeZone: ZONE,
          scheduledAt: new Date("2026-10-01T20:00:00.000Z"),
          status: "PENDING",
        },
      })
      await prisma.pushDelivery.create({
        data: {
          id: `${PREFIX}delivery`,
          nonce: `${PREFIX}nonce`.padEnd(43, "x").slice(0, 43),
          kind: "LIVE",
          campaignId: `${PREFIX}campaign`,
          registrationId: `${PREFIX}reg_1`,
          localDay: new Date("2026-10-02T00:00:00.000Z"),
          languageSlug: "english",
          country: "NZ",
          timeZone: ZONE,
          status: "RESERVED",
        },
      })
    })

    afterAll(async () => {
      await clean(prisma)
      await prisma.$disconnect()
    })

    it("reads the runtime run id through the campaign's ledger row", async () => {
      const store = createPushRecoveryStore(prisma)

      const campaigns = await store.readActiveCampaigns(50)
      const mine = campaigns.find(
        (campaign) => campaign.id === `${PREFIX}campaign`,
      )

      expect(mine).toMatchObject({
        status: "SENDING",
        workflowRunLogId: `${PREFIX}ledger`,
        runtimeRunId: `${PREFIX}runtime`,
      })
    })

    it("retires a live campaign whose run the runtime no longer holds", async () => {
      const result = await sweepOrphanedPushCampaigns({
        store: scopedStore(prisma),
        readRuntimeStatus: vi.fn(async () => "terminal" as const),
      })

      expect(result.campaignsSwept).toBeGreaterThanOrEqual(1)
      await expect(
        prisma.pushCampaignZone.findUniqueOrThrow({
          where: { id: `${PREFIX}zone` },
          select: { status: true },
        }),
      ).resolves.toEqual({ status: "MISSED" })
      await expect(
        prisma.pushDelivery.findUniqueOrThrow({
          where: { id: `${PREFIX}delivery` },
          select: { status: true },
        }),
      ).resolves.toEqual({ status: "MISSED" })
      await expect(
        prisma.pushCampaign.findUniqueOrThrow({
          where: { id: `${PREFIX}campaign` },
          select: { status: true, lastError: true },
        }),
      ).resolves.toEqual({ status: "PAUSED", lastError: "run_not_alive" })
    })

    it("leaves a live run's campaign exactly as it found it", async () => {
      await sweepOrphanedPushCampaigns({
        store: scopedStore(prisma),
        readRuntimeStatus: vi.fn(async () => "alive" as const),
      })

      await expect(
        prisma.pushCampaign.findUniqueOrThrow({
          where: { id: `${PREFIX}campaign` },
          select: { status: true },
        }),
      ).resolves.toEqual({ status: "SENDING" })
      await expect(
        prisma.pushCampaignZone.findUniqueOrThrow({
          where: { id: `${PREFIX}zone` },
          select: { status: true },
        }),
      ).resolves.toEqual({ status: "PENDING" })
    })

    it("frees the phone's day, because a missed row leaves the claim index", async () => {
      await sweepOrphanedPushCampaigns({
        store: scopedStore(prisma),
        readRuntimeStatus: vi.fn(async () => "terminal" as const),
      })

      // A second campaign can now claim the same phone on the same local day.
      await prisma.pushCampaign.create({
        data: {
          id: `${PREFIX}campaign_next`,
          status: "SENDING",
          destinationKind: "SERIES",
          destinationSlug: "washi-gospel",
          audienceScope: "EVERYWHERE",
        },
      })
      await expect(
        prisma.pushDelivery.create({
          data: {
            id: `${PREFIX}delivery_next`,
            nonce: `${PREFIX}nonce2`.padEnd(43, "y").slice(0, 43),
            kind: "LIVE",
            campaignId: `${PREFIX}campaign_next`,
            registrationId: `${PREFIX}reg_1`,
            localDay: new Date("2026-10-02T00:00:00.000Z"),
            languageSlug: "english",
            country: "NZ",
            timeZone: ZONE,
            status: "RESERVED",
          },
        }),
      ).resolves.toMatchObject({ id: `${PREFIX}delivery_next` })
    })

    it("never touches a campaign that already finished", async () => {
      await prisma.pushCampaign.update({
        where: { id: `${PREFIX}campaign` },
        data: { status: "SENT" },
      })

      const result = await sweepOrphanedPushCampaigns({
        store: scopedStore(prisma),
        readRuntimeStatus: vi.fn(async () => "terminal" as const),
      })

      const swept = await prisma.pushCampaignZone.findUniqueOrThrow({
        where: { id: `${PREFIX}zone` },
        select: { status: true },
      })
      expect(swept).toEqual({ status: "PENDING" })
      expect(result.campaignsInspected).toBe(0)
    })
  },
)

async function clean(prisma: PrismaClient): Promise<void> {
  const where = { id: { startsWith: PREFIX } }
  await prisma.pushAttribution.deleteMany({ where })
  await prisma.pushOpen.deleteMany({ where })
  await prisma.pushDelivery.deleteMany({
    where: { campaignId: { startsWith: PREFIX } },
  })
  await prisma.pushCampaignZone.deleteMany({ where })
  await prisma.pushCampaignCopy.deleteMany({ where })
  await prisma.pushTestDevice.deleteMany({ where })
  await prisma.pushCampaign.deleteMany({ where })
  await prisma.pushRegistration.deleteMany({ where })
  await prisma.workflowRun.deleteMany({ where })
}
