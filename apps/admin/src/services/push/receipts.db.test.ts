/**
 * The receipt store against real Postgres.
 *
 * The unit suite fakes this port. Here the age windows, the page cursor, the
 * conditional status moves, and the `unnest` failure writes run as the real
 * statements.
 *
 * Run with:
 *   PUSH_DB_TEST=1 DATABASE_URL=postgresql://forge@localhost:5432/forge_admin_push_test \
 *     pnpm --filter @forge/admin exec vitest run src/services/push/receipts.db.test.ts
 */
import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { env } from "@/config/env"

import {
  createPushReceiptStore,
  reconcilePushCampaignReceipts,
} from "./receipts"
import type { PushReceiptOutcome, PushTransport } from "./transport"

const databaseUrl = process.env.DATABASE_URL
const PREFIX = "push_receipts_db_"
const ZONE = "Pacific/Auckland"
const OLD_ZONE = "Asia/Dubai"
const NOW = new Date("2026-10-02T12:00:00.000Z")
const RECENT_DISPATCH = new Date(NOW.getTime() - 60 * 60 * 1_000)
const ANCIENT_DISPATCH = new Date(NOW.getTime() - 21 * 60 * 60 * 1_000)

function config(overrides: Record<string, unknown> = {}) {
  return {
    campaignsEnabled: true,
    batchPageSize: 5_000,
    stepMaxDurationMs: 220_000,
    stepReserveMs: 40_000,
    chunkDeadlineMs: 10_000,
    providerConcurrency: 3,
    messagesPerSecond: 500,
    receiptPageSize: 10_000,
    blockedCountries: ["CN"],
    ...overrides,
  }
}

function transportThat(receipts: Record<string, PushReceiptOutcome>): {
  transport: PushTransport
  requested: string[][]
} {
  const requested: string[][] = []
  return {
    requested,
    transport: {
      async sendChunk() {
        return []
      },
      async fetchReceipts(ids) {
        requested.push([...ids])
        return new Map(
          [...ids].flatMap((id) => {
            const outcome = receipts[id]
            return outcome ? [[id, outcome] as const] : []
          }),
        )
      },
    },
  }
}

describe.skipIf(env.PUSH_DB_TEST !== "1")(
  "the push receipt store against Postgres",
  () => {
    let prisma: PrismaClient

    beforeAll(() => {
      prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    })

    beforeEach(async () => {
      await clean(prisma)
      await seedRegistration(`${PREFIX}reg_1`, ZONE, "NZ")
      await prisma.pushCampaign.create({
        data: {
          id: `${PREFIX}campaign`,
          status: "SENDING",
          mode: "WAVE",
          destinationKind: "SERIES",
          destinationSlug: "washi-gospel",
          audienceScope: "EVERYWHERE",
        },
      })
      await prisma.pushCampaignZone.createMany({
        data: [
          {
            id: `${PREFIX}zone_recent`,
            campaignId: `${PREFIX}campaign`,
            timeZone: ZONE,
            scheduledAt: RECENT_DISPATCH,
            dispatchedAt: RECENT_DISPATCH,
            status: "DISPATCHED",
          },
          {
            id: `${PREFIX}zone_ancient`,
            campaignId: `${PREFIX}campaign`,
            timeZone: OLD_ZONE,
            scheduledAt: ANCIENT_DISPATCH,
            dispatchedAt: ANCIENT_DISPATCH,
            status: "DISPATCHED",
          },
        ],
      })
    })

    afterAll(async () => {
      await clean(prisma)
      await prisma.$disconnect()
    })

    async function seedRegistration(
      id: string,
      timeZone: string,
      country: string,
    ): Promise<void> {
      await prisma.pushRegistration.create({
        data: {
          id,
          expoPushToken: `${id}_ExponentPushToken[t]`,
          testDeviceId: `${id}_device`,
          platform: "IOS",
          appBuild: "1.0.0",
          appLanguageSlug: "english",
          phoneLocale: "en-NZ",
          timeZone,
          country,
          countrySource: "EDGE",
        },
      })
    }

    // An accepted row always carries `sending_at`: the statement that moves a
    // row to sending stamps it in the same update (claims.ts).
    async function seedDelivery(input: {
      id: string
      status: "ACCEPTED" | "SENDING"
      timeZone: string
      ticketId?: string | null
      sendingAt?: Date
      registrationId?: string
      localDay?: Date
    }): Promise<void> {
      await prisma.pushDelivery.create({
        data: {
          id: input.id,
          nonce: `${input.id}_nonce`.padEnd(43, "x").slice(0, 43),
          kind: "LIVE",
          campaignId: `${PREFIX}campaign`,
          registrationId: input.registrationId ?? `${PREFIX}reg_1`,
          localDay: input.localDay ?? new Date("2026-10-02T00:00:00.000Z"),
          languageSlug: "english",
          country: "NZ",
          timeZone: input.timeZone,
          status: input.status,
          ticketId: input.ticketId ?? null,
          sendingAt:
            input.sendingAt ??
            (input.status === "ACCEPTED" ? RECENT_DISPATCH : null),
        },
      })
    }

    it("reconciles the twenty-hour group before the one-hour group", async () => {
      // Receipts expire at about a day, so the group closest to expiry is read
      // first however the two ages sort.
      await seedRegistration(`${PREFIX}reg_2`, OLD_ZONE, "AE")
      await seedDelivery({
        id: `${PREFIX}d_recent`,
        status: "ACCEPTED",
        timeZone: ZONE,
        ticketId: `${PREFIX}ticket_recent`,
      })
      await seedDelivery({
        id: `${PREFIX}d_ancient`,
        status: "ACCEPTED",
        timeZone: OLD_ZONE,
        ticketId: `${PREFIX}ticket_ancient`,
        sendingAt: ANCIENT_DISPATCH,
        registrationId: `${PREFIX}reg_2`,
        localDay: new Date("2026-10-01T00:00:00.000Z"),
      })
      const { transport, requested } = transportThat({})

      await reconcilePushCampaignReceipts(
        { campaignId: `${PREFIX}campaign` },
        {
          store: createPushReceiptStore(prisma),
          transport,
          config: config(),
          now: () => NOW,
        },
      )

      expect(requested).toEqual([
        [`${PREFIX}ticket_ancient`],
        [`${PREFIX}ticket_recent`],
      ])
    })

    it("reconciles a zone the wave left missed with no dispatch stamp", async () => {
      // This is what batch.ts writes when the flag flips mid-group: the zone
      // moves to missed and never gets dispatched_at, while the chunks already
      // accepted still hold tickets that expire.
      await prisma.pushCampaignZone.update({
        where: { id: `${PREFIX}zone_recent` },
        data: { status: "MISSED", dispatchedAt: null },
      })
      await seedDelivery({
        id: `${PREFIX}d_paused`,
        status: "ACCEPTED",
        timeZone: ZONE,
        ticketId: `${PREFIX}ticket_paused`,
        sendingAt: new Date(NOW.getTime() - 30 * 60_000),
      })
      const { transport, requested } = transportThat({
        [`${PREFIX}ticket_paused`]: { kind: "handed_off" },
      })

      const result = await reconcilePushCampaignReceipts(
        { campaignId: `${PREFIX}campaign` },
        {
          store: createPushReceiptStore(prisma),
          transport,
          config: config(),
          now: () => NOW,
        },
      )

      expect(requested).toEqual([[`${PREFIX}ticket_paused`]])
      expect(result.counts.handedOff).toBe(1)
      await expect(
        prisma.pushDelivery.findUniqueOrThrow({
          where: { id: `${PREFIX}d_paused` },
          select: { status: true },
        }),
      ).resolves.toEqual({ status: "HANDED_OFF" })
    })

    it("reconciles a zone the campaign never planned", async () => {
      // A test device sits in a zone with no campaign zone row, so the group
      // cannot come from the zone table at all.
      await prisma.pushCampaignZone.deleteMany({
        where: { campaignId: `${PREFIX}campaign` },
      })
      await seedDelivery({
        id: `${PREFIX}d_unplanned`,
        status: "ACCEPTED",
        timeZone: ZONE,
        ticketId: `${PREFIX}ticket_unplanned`,
        sendingAt: new Date(NOW.getTime() - 30 * 60_000),
      })
      const { transport, requested } = transportThat({
        [`${PREFIX}ticket_unplanned`]: { kind: "handed_off" },
      })

      const result = await reconcilePushCampaignReceipts(
        { campaignId: `${PREFIX}campaign` },
        {
          store: createPushReceiptStore(prisma),
          transport,
          config: config(),
          now: () => NOW,
        },
      )

      expect(requested).toEqual([[`${PREFIX}ticket_unplanned`]])
      expect(result.counts.handedOff).toBe(1)
    })

    it("moves an accepted row to handed off, and only from accepted", async () => {
      await seedDelivery({
        id: `${PREFIX}d1`,
        status: "ACCEPTED",
        timeZone: ZONE,
        ticketId: `${PREFIX}ticket_1`,
      })
      const { transport } = transportThat({
        [`${PREFIX}ticket_1`]: { kind: "handed_off" },
      })

      const result = await reconcilePushCampaignReceipts(
        { campaignId: `${PREFIX}campaign` },
        {
          store: createPushReceiptStore(prisma),
          transport,
          config: config(),
          now: () => NOW,
        },
      )

      expect(result.counts.handedOff).toBe(1)
      await expect(
        prisma.pushDelivery.findUniqueOrThrow({
          where: { id: `${PREFIX}d1` },
          select: { status: true },
        }),
      ).resolves.toEqual({ status: "HANDED_OFF" })
    })

    it("writes each failed row its own provider code in one statement", async () => {
      await seedRegistration(`${PREFIX}reg_f2`, ZONE, "NZ")
      await seedDelivery({
        id: `${PREFIX}d_fail_1`,
        status: "ACCEPTED",
        timeZone: ZONE,
        ticketId: `${PREFIX}ticket_fail_1`,
      })
      await seedDelivery({
        id: `${PREFIX}d_fail_2`,
        status: "ACCEPTED",
        timeZone: ZONE,
        ticketId: `${PREFIX}ticket_fail_2`,
        registrationId: `${PREFIX}reg_f2`,
      })
      const { transport } = transportThat({
        [`${PREFIX}ticket_fail_1`]: {
          kind: "failed",
          providerCode: "MessageRateExceeded",
        },
        [`${PREFIX}ticket_fail_2`]: {
          kind: "failed",
          providerCode: "MismatchSenderId",
        },
      })

      const result = await reconcilePushCampaignReceipts(
        { campaignId: `${PREFIX}campaign` },
        {
          store: createPushReceiptStore(prisma),
          transport,
          config: config(),
          now: () => NOW,
        },
      )

      expect(result.counts.failed).toBe(2)
      const rows = await prisma.pushDelivery.findMany({
        where: { id: { in: [`${PREFIX}d_fail_1`, `${PREFIX}d_fail_2`] } },
        orderBy: { id: "asc" },
        select: { id: true, status: true, error: true },
      })
      expect(rows).toEqual([
        {
          id: `${PREFIX}d_fail_1`,
          status: "FAILED",
          error: "MessageRateExceeded",
        },
        {
          id: `${PREFIX}d_fail_2`,
          status: "FAILED",
          error: "MismatchSenderId",
        },
      ])
    })

    it("leaves a row that is no longer accepted where it is", async () => {
      await seedDelivery({
        id: `${PREFIX}d_open`,
        status: "ACCEPTED",
        timeZone: ZONE,
        ticketId: `${PREFIX}ticket_open`,
      })
      const store = createPushReceiptStore(prisma)
      await prisma.pushDelivery.update({
        where: { id: `${PREFIX}d_open` },
        data: { status: "HANDED_OFF" },
      })

      await store.recordFailed(
        [{ id: `${PREFIX}d_open`, error: "MessageRateExceeded" }],
        "FAILED",
      )

      await expect(
        prisma.pushDelivery.findUniqueOrThrow({
          where: { id: `${PREFIX}d_open` },
          select: { status: true, error: true },
        }),
      ).resolves.toEqual({ status: "HANDED_OFF", error: null })
    })

    it("retires every dead token and its registration in one pair", async () => {
      await seedRegistration(`${PREFIX}reg_d2`, ZONE, "NZ")
      await seedDelivery({
        id: `${PREFIX}d1`,
        status: "ACCEPTED",
        timeZone: ZONE,
        ticketId: `${PREFIX}ticket_1`,
      })
      await seedDelivery({
        id: `${PREFIX}d2`,
        status: "ACCEPTED",
        timeZone: ZONE,
        ticketId: `${PREFIX}ticket_2`,
        registrationId: `${PREFIX}reg_d2`,
      })
      const { transport } = transportThat({
        [`${PREFIX}ticket_1`]: {
          kind: "dead_token",
          providerCode: "DeviceNotRegistered",
        },
        [`${PREFIX}ticket_2`]: {
          kind: "dead_token",
          providerCode: "MismatchSenderId",
        },
      })

      await reconcilePushCampaignReceipts(
        { campaignId: `${PREFIX}campaign` },
        {
          store: createPushReceiptStore(prisma),
          transport,
          config: config(),
          now: () => NOW,
        },
      )

      const rows = await prisma.pushDelivery.findMany({
        where: { id: { in: [`${PREFIX}d1`, `${PREFIX}d2`] } },
        orderBy: { id: "asc" },
        select: { id: true, status: true, error: true },
      })
      expect(rows).toEqual([
        { id: `${PREFIX}d1`, status: "INVALID", error: "DeviceNotRegistered" },
        { id: `${PREFIX}d2`, status: "INVALID", error: "MismatchSenderId" },
      ])
      const registrations = await prisma.pushRegistration.findMany({
        where: { id: { in: [`${PREFIX}reg_1`, `${PREFIX}reg_d2`] } },
        select: { status: true },
      })
      expect(registrations).toEqual([
        { status: "INVALID" },
        { status: "INVALID" },
      ])
    })

    it("leaves a row the provider has not answered accepted", async () => {
      await seedDelivery({
        id: `${PREFIX}d1`,
        status: "ACCEPTED",
        timeZone: ZONE,
        ticketId: `${PREFIX}ticket_1`,
      })
      const { transport } = transportThat({})

      const result = await reconcilePushCampaignReceipts(
        { campaignId: `${PREFIX}campaign` },
        {
          store: createPushReceiptStore(prisma),
          transport,
          config: config(),
          now: () => NOW,
        },
      )

      expect(result.counts.pending).toBe(1)
      await expect(
        prisma.pushDelivery.findUniqueOrThrow({
          where: { id: `${PREFIX}d1` },
          select: { status: true },
        }),
      ).resolves.toEqual({ status: "ACCEPTED" })
    })

    it("turns an old sending row with no ticket into unknown", async () => {
      await seedDelivery({
        id: `${PREFIX}d_stuck`,
        status: "SENDING",
        timeZone: ZONE,
        sendingAt: new Date(NOW.getTime() - 30 * 60_000),
      })
      const { transport } = transportThat({})

      const result = await reconcilePushCampaignReceipts(
        { campaignId: `${PREFIX}campaign` },
        {
          store: createPushReceiptStore(prisma),
          transport,
          config: config(),
          now: () => NOW,
        },
      )

      expect(result.counts.unknown).toBe(1)
      await expect(
        prisma.pushDelivery.findUniqueOrThrow({
          where: { id: `${PREFIX}d_stuck` },
          select: { status: true },
        }),
      ).resolves.toEqual({ status: "UNKNOWN" })
    })

    it("leaves a sending row that has only just left alone", async () => {
      await seedDelivery({
        id: `${PREFIX}d_fresh`,
        status: "SENDING",
        timeZone: ZONE,
        sendingAt: new Date(NOW.getTime() - 60_000),
      })
      const { transport } = transportThat({})

      const result = await reconcilePushCampaignReceipts(
        { campaignId: `${PREFIX}campaign` },
        {
          store: createPushReceiptStore(prisma),
          transport,
          config: config(),
          now: () => NOW,
        },
      )

      expect(result.counts.unknown).toBe(0)
      await expect(
        prisma.pushDelivery.findUniqueOrThrow({
          where: { id: `${PREFIX}d_fresh` },
          select: { status: true },
        }),
      ).resolves.toEqual({ status: "SENDING" })
    })

    it("reads no group while every send is younger than fifteen minutes", async () => {
      // The zone stays an hour old and dispatched, so only the send's own age
      // can hold the group back.
      await seedDelivery({
        id: `${PREFIX}d1`,
        status: "ACCEPTED",
        timeZone: ZONE,
        ticketId: `${PREFIX}ticket_1`,
        sendingAt: new Date(NOW.getTime() - 60_000),
      })
      const { transport, requested } = transportThat({
        [`${PREFIX}ticket_1`]: { kind: "handed_off" },
      })

      const result = await reconcilePushCampaignReceipts(
        { campaignId: `${PREFIX}campaign` },
        {
          store: createPushReceiptStore(prisma),
          transport,
          config: config(),
          now: () => NOW,
        },
      )

      expect(requested).toEqual([])
      expect(result.counts.handedOff).toBe(0)
    })

    it("reads the young group on the final pass, which sets no age limit", async () => {
      await seedDelivery({
        id: `${PREFIX}d1`,
        status: "ACCEPTED",
        timeZone: ZONE,
        ticketId: `${PREFIX}ticket_1`,
        sendingAt: new Date(NOW.getTime() - 60_000),
      })
      const { transport } = transportThat({
        [`${PREFIX}ticket_1`]: { kind: "handed_off" },
      })

      const result = await reconcilePushCampaignReceipts(
        { campaignId: `${PREFIX}campaign`, minAgeMs: 0 },
        {
          store: createPushReceiptStore(prisma),
          transport,
          config: config(),
          now: () => NOW,
        },
      )

      expect(result.counts.handedOff).toBe(1)
    })

    it("pages a group larger than the page size across several reads", async () => {
      for (let index = 0; index < 4; index += 1) {
        await seedRegistration(`${PREFIX}reg_p${index}`, ZONE, "NZ")
        await seedDelivery({
          id: `${PREFIX}d_page_${index}`,
          status: "ACCEPTED",
          timeZone: ZONE,
          ticketId: `${PREFIX}ticket_page_${index}`,
          registrationId: `${PREFIX}reg_p${index}`,
        })
      }
      const { transport, requested } = transportThat(
        Object.fromEntries(
          Array.from({ length: 4 }, (_value, index) => [
            `${PREFIX}ticket_page_${index}`,
            { kind: "handed_off" as const },
          ]),
        ),
      )

      const result = await reconcilePushCampaignReceipts(
        { campaignId: `${PREFIX}campaign` },
        {
          store: createPushReceiptStore(prisma),
          transport,
          config: config({ receiptPageSize: 2 }),
          now: () => NOW,
        },
      )

      expect(requested.length).toBeGreaterThan(1)
      expect(result.counts.handedOff).toBe(4)
      const remaining = await prisma.pushDelivery.count({
        where: { campaignId: `${PREFIX}campaign`, status: "ACCEPTED" },
      })
      expect(remaining).toBe(0)
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
}
