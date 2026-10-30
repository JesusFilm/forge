/**
 * Real-Postgres proof of the campaign delete. The mocked suite proves the gate's
 * branches; this one proves that the restricted report rows really go first, that
 * the audit row keeps the copy, that a refusal leaves every row, that a draft's
 * rolled-back transaction leaves every row and writes no audit row, and that
 * phones stay. A settled campaign's delivery pages commit before the transaction,
 * so they do not roll back. Run with PUSH_DB_TEST=1.
 */
import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { env } from "@/config/env"

import {
  deletePushCampaign,
  PUSH_CAMPAIGN_DELETE_LEDGER_KEY,
  PUSH_CAMPAIGN_DELETE_PAGE_SIZE,
} from "./campaign.service"
import { PushCampaignNotDeletableError, PushNotFoundError } from "./errors"

const databaseUrl = process.env.DATABASE_URL
const PREFIX = "push_delete_db_"
const CAMPAIGN = `${PREFIX}campaign`
const ACTOR = `${PREFIX}editor`
const NOW = new Date("2026-10-08T11:00:00.000Z")
/** Every live row's local day ended in every zone before NOW. */
const OLD_DAY = new Date("2026-10-05T00:00:00.000Z")
const OLD_CLAIM = new Date("2026-10-05T09:00:00.000Z")

async function clean(prisma: PrismaClient): Promise<void> {
  const where = { id: { startsWith: PREFIX } }
  await prisma.pushAttribution.deleteMany({ where })
  await prisma.pushOpen.deleteMany({ where })
  await prisma.pushDelivery.deleteMany({ where })
  await prisma.pushTestDevice.deleteMany({ where })
  await prisma.pushCampaign.deleteMany({ where })
  await prisma.pushRegistration.deleteMany({ where })
  // An audit row takes a generated id, so it is found by its subject.
  await prisma.workflowRun.deleteMany({
    where: { OR: [where, { subjectId: { startsWith: PREFIX } }] },
  })
}

describe.skipIf(env.PUSH_DB_TEST !== "1")(
  "push campaign delete against Postgres",
  () => {
    let prisma: PrismaClient

    beforeAll(() => {
      prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    })

    beforeEach(async () => {
      await clean(prisma)
    })

    afterAll(async () => {
      await clean(prisma)
      await prisma.$disconnect()
    })

    async function seedCampaign(input: {
      status: "TESTED" | "SENT" | "CANCELLED"
      workflowRunLogId?: string
    }): Promise<void> {
      await prisma.pushCampaign.create({
        data: {
          id: CAMPAIGN,
          status: input.status,
          destinationKind: "VIDEO",
          destinationSlug: "jesus",
          audienceScope: "COUNTRIES",
          countries: ["MX"],
          languageFilter: ["spanish"],
          workflowRunLogId: input.workflowRunLogId ?? null,
          copies: {
            create: [
              { languageSlug: "english", title: "Hello", body: "Watch" },
              { languageSlug: "spanish", title: "Hola", body: "Mira" },
            ],
          },
          zones: {
            create: [
              {
                timeZone: "Pacific/Auckland",
                scheduledAt: OLD_CLAIM,
                status: "DISPATCHED",
                audienceCount: 40,
              },
            ],
          },
        },
      })
    }

    async function seedPhone(): Promise<string> {
      const id = `${PREFIX}reg`
      await prisma.pushRegistration.create({
        data: {
          id,
          expoPushToken: `${PREFIX}token`,
          testDeviceId: `${PREFIX}device`,
          platform: "IOS",
          appBuild: "1.0.0",
          appLanguageSlug: "english",
          phoneLocale: "en-NZ",
          timeZone: "Pacific/Auckland",
          countrySource: "PHONE_REGION",
          testDevice: {
            create: { id: `${PREFIX}test_device`, label: "Test phone" },
          },
        },
      })
      return id
    }

    async function seedDelivery(input: {
      suffix: string
      kind: "LIVE" | "TEST"
      registrationId: string | null
      localDay?: Date
      createdAt?: Date
    }): Promise<string> {
      const id = `${PREFIX}delivery_${input.suffix}`
      await prisma.pushDelivery.create({
        data: {
          id,
          nonce: `${PREFIX}nonce_${input.suffix}`,
          kind: input.kind,
          campaignId: CAMPAIGN,
          registrationId: input.registrationId,
          localDay: input.localDay ?? OLD_DAY,
          languageSlug: "english",
          timeZone: "Pacific/Auckland",
          status: "HANDED_OFF",
          createdAt: input.createdAt ?? OLD_CLAIM,
        },
      })
      return id
    }

    /** An open and the watch start it led to, both restricted by the campaign. */
    async function seedReport(deliveryId: string): Promise<void> {
      await prisma.pushOpen.create({
        data: {
          id: `${PREFIX}open`,
          deliveryId,
          campaignId: CAMPAIGN,
          receivedAt: OLD_CLAIM,
          attributions: {
            create: {
              id: `${PREFIX}attribution`,
              episodeId: `${PREFIX}episode`,
              campaignId: CAMPAIGN,
              mediaId: "video_1",
              attributedAt: OLD_CLAIM,
            },
          },
        },
      })
    }

    async function campaignRowCounts() {
      const where = { campaignId: CAMPAIGN }
      return {
        campaign: await prisma.pushCampaign.count({ where: { id: CAMPAIGN } }),
        copies: await prisma.pushCampaignCopy.count({ where }),
        zones: await prisma.pushCampaignZone.count({ where }),
        deliveries: await prisma.pushDelivery.count({ where }),
        opens: await prisma.pushOpen.count({ where }),
        attributions: await prisma.pushAttribution.count({ where }),
      }
    }

    const terminal = async () => "terminal" as const

    function auditRows() {
      return prisma.workflowRun.findMany({
        where: {
          workflowKey: PUSH_CAMPAIGN_DELETE_LEDGER_KEY,
          subjectId: CAMPAIGN,
        },
      })
    }

    /** A run ledger row the campaign points at, as `dispatch.ts` writes one. */
    async function seedLedger(input: {
      id: string
      kind: "TEST" | "LIVE"
      status: "QUEUED" | "RUNNING"
      runtimeRunId?: string
    }): Promise<void> {
      await prisma.workflowRun.create({
        data: {
          id: `${PREFIX}${input.id}`,
          runtimeRunId: input.runtimeRunId
            ? `${PREFIX}${input.runtimeRunId}`
            : null,
          workflowKey: "push-campaign",
          trigger: "MANUAL",
          subjectId: CAMPAIGN,
          status: input.status,
          details: { kind: input.kind },
          startedAt: new Date("2026-10-08T09:00:00.000Z"),
        },
      })
    }

    it("deletes a sent campaign with its copy, zones, and report, and keeps the phone", async () => {
      const phone = await seedPhone()
      await seedCampaign({ status: "SENT" })
      const live = await seedDelivery({
        suffix: "live",
        kind: "LIVE",
        registrationId: phone,
      })
      await seedDelivery({
        suffix: "test",
        kind: "TEST",
        registrationId: phone,
      })
      await seedReport(live)

      // The control: the keys restrict a plain delete while report rows exist.
      await expect(
        prisma.pushCampaign.delete({ where: { id: CAMPAIGN } }),
      ).rejects.toThrow()

      const result = await deletePushCampaign(
        prisma,
        { campaignId: CAMPAIGN, actorId: ACTOR },
        { now: () => NOW, readRuntimeLiveness: terminal },
      )

      expect(result.deliveriesDeleted).toBe(2)
      expect(await campaignRowCounts()).toEqual({
        campaign: 0,
        copies: 0,
        zones: 0,
        deliveries: 0,
        opens: 0,
        attributions: 0,
      })
      expect(
        await prisma.pushRegistration.count({ where: { id: phone } }),
      ).toBe(1)
      expect(
        await prisma.pushTestDevice.count({
          where: { id: `${PREFIX}test_device` },
        }),
      ).toBe(1)

      const audit = await auditRows()
      expect(audit).toHaveLength(1)
      expect(audit[0]).toMatchObject({
        actorId: ACTOR,
        subjectType: "push-campaign",
        status: "SUCCEEDED",
      })
      expect(audit[0]?.details).toMatchObject({
        status: "SENT",
        destinationKind: "VIDEO",
        destinationSlug: "jesus",
        audienceScope: "COUNTRIES",
        countries: ["MX"],
        languageFilter: ["spanish"],
        deliveriesDeleted: 2,
        copies: [
          { languageSlug: "english", title: "Hello", body: "Watch" },
          { languageSlug: "spanish", title: "Hola", body: "Mira" },
        ],
        zones: [
          {
            timeZone: "Pacific/Auckland",
            status: "DISPATCHED",
            audienceCount: 40,
          },
        ],
      })
    })

    // Two tabs at once: both pass the gate, the row locks order them, and the
    // loser finds no row, which is the outcome its caller wanted.
    it("lets one of two concurrent deletes win and reads the other as not found", async () => {
      const phone = await seedPhone()
      await seedCampaign({ status: "TESTED" })
      await seedDelivery({
        suffix: "test",
        kind: "TEST",
        registrationId: phone,
      })
      const remove = () =>
        deletePushCampaign(
          prisma,
          { campaignId: CAMPAIGN, actorId: ACTOR },
          { now: () => NOW, readRuntimeLiveness: terminal },
        )

      const results = await Promise.allSettled([remove(), remove()])

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
      const rejected = results.filter((r) => r.status === "rejected")
      expect(rejected).toHaveLength(1)
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
        PushNotFoundError,
      )
      expect(await auditRows()).toHaveLength(1)
      expect((await campaignRowCounts()).campaign).toBe(0)
    })

    it("pages through more live rows than one page holds", async () => {
      await seedCampaign({ status: "SENT" })
      const total = PUSH_CAMPAIGN_DELETE_PAGE_SIZE + 3
      await prisma.pushDelivery.createMany({
        data: Array.from({ length: total }, (_, index) => ({
          id: `${PREFIX}bulk_${index}`,
          nonce: `${PREFIX}bulk_nonce_${index}`,
          kind: "LIVE" as const,
          campaignId: CAMPAIGN,
          registrationId: null,
          localDay: OLD_DAY,
          languageSlug: "english",
          timeZone: "Pacific/Auckland",
          status: "HANDED_OFF" as const,
          createdAt: OLD_CLAIM,
        })),
      })

      const result = await deletePushCampaign(
        prisma,
        { campaignId: CAMPAIGN, actorId: ACTOR },
        { now: () => NOW, readRuntimeLiveness: terminal },
      )

      expect(result.deliveriesDeleted).toBe(total)
      expect((await campaignRowCounts()).campaign).toBe(0)
    })

    it("refuses while a live row still guards its phone's day, and deletes nothing", async () => {
      const phone = await seedPhone()
      await seedCampaign({ status: "SENT" })
      const live = await seedDelivery({
        suffix: "live",
        kind: "LIVE",
        registrationId: phone,
        localDay: new Date("2026-10-08T00:00:00.000Z"),
        createdAt: new Date("2026-10-07T20:00:00.000Z"),
      })
      await seedReport(live)
      const before = await campaignRowCounts()

      await expect(
        deletePushCampaign(
          prisma,
          { campaignId: CAMPAIGN, actorId: ACTOR },
          { now: () => NOW, readRuntimeLiveness: terminal },
        ),
      ).rejects.toThrowError("Delete it after 2026-10-09 12:00 UTC.")
      expect(await campaignRowCounts()).toEqual(before)
      expect(await auditRows()).toHaveLength(0)
    })

    it("refuses while the runtime says the send run is alive, and deletes nothing", async () => {
      const phone = await seedPhone()
      await seedLedger({
        id: "ledger_live",
        kind: "LIVE",
        status: "RUNNING",
        runtimeRunId: "wrun_live",
      })
      await seedCampaign({
        status: "CANCELLED",
        workflowRunLogId: `${PREFIX}ledger_live`,
      })
      await seedDelivery({
        suffix: "live",
        kind: "LIVE",
        registrationId: phone,
      })
      const before = await campaignRowCounts()
      const asked: string[] = []

      await expect(
        deletePushCampaign(
          prisma,
          { campaignId: CAMPAIGN, actorId: ACTOR },
          {
            now: () => NOW,
            readRuntimeLiveness: async (runtimeRunId) => {
              asked.push(runtimeRunId)
              return "alive"
            },
          },
        ),
      ).rejects.toThrowError(/may still be collecting receipts/)
      expect(asked).toEqual([`${PREFIX}wrun_live`])
      expect(await campaignRowCounts()).toEqual(before)
      expect(await auditRows()).toHaveLength(0)
    })

    // The runtime lookup runs between the gate's read and the transaction, so
    // it stands in for a schedule that lands in that gap.
    it("rolls back every delete when a schedule lands after the gate read", async () => {
      const phone = await seedPhone()
      await seedLedger({
        id: "ledger_test",
        kind: "TEST",
        status: "RUNNING",
        runtimeRunId: "wrun_test",
      })
      await seedCampaign({
        status: "TESTED",
        workflowRunLogId: `${PREFIX}ledger_test`,
      })
      await seedDelivery({
        suffix: "test",
        kind: "TEST",
        registrationId: phone,
      })
      const before = await campaignRowCounts()

      await expect(
        deletePushCampaign(
          prisma,
          { campaignId: CAMPAIGN, actorId: ACTOR },
          {
            now: () => NOW,
            readRuntimeLiveness: async () => {
              await prisma.pushCampaign.update({
                where: { id: CAMPAIGN },
                data: { status: "SCHEDULED" },
              })
              return "terminal"
            },
          },
        ),
      ).rejects.toThrowError(PushCampaignNotDeletableError)
      expect(await campaignRowCounts()).toEqual(before)
      expect(await auditRows()).toHaveLength(0)
    })

    // The runtime lookup runs between the gate's read and the transaction, so
    // it stands in for a new test run that starts in that gap.
    it("rolls back every delete when a new run starts after the gate read", async () => {
      const phone = await seedPhone()
      await prisma.workflowRun.createMany({
        data: [
          {
            id: `${PREFIX}ledger_old`,
            runtimeRunId: `${PREFIX}wrun_old`,
            workflowKey: "push-campaign",
            trigger: "MANUAL",
            subjectId: CAMPAIGN,
            status: "RUNNING",
            details: { kind: "TEST" },
            startedAt: new Date("2026-10-08T09:00:00.000Z"),
          },
          {
            id: `${PREFIX}ledger_new`,
            workflowKey: "push-campaign",
            trigger: "MANUAL",
            subjectId: CAMPAIGN,
            status: "QUEUED",
            details: { kind: "TEST" },
          },
        ],
      })
      await seedCampaign({
        status: "TESTED",
        workflowRunLogId: `${PREFIX}ledger_old`,
      })
      await seedDelivery({
        suffix: "test",
        kind: "TEST",
        registrationId: phone,
      })
      const before = await campaignRowCounts()

      await expect(
        deletePushCampaign(
          prisma,
          { campaignId: CAMPAIGN, actorId: ACTOR },
          {
            now: () => NOW,
            readRuntimeLiveness: async () => {
              await prisma.pushCampaign.update({
                where: { id: CAMPAIGN },
                data: { workflowRunLogId: `${PREFIX}ledger_new` },
              })
              return "terminal"
            },
          },
        ),
      ).rejects.toThrowError(PushCampaignNotDeletableError)
      expect(await campaignRowCounts()).toEqual(before)
      expect(await auditRows()).toHaveLength(0)
    })
  },
)
