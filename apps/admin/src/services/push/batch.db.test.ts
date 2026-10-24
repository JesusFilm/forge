/**
 * The batch store against real Postgres.
 *
 * The unit suite fakes this port, so every predicate there is correct by
 * construction. This file is the only place the conditional updates, the status
 * gates, and the dead-token pair are proven against the real statements.
 *
 * Run with:
 *   PUSH_DB_TEST=1 DATABASE_URL=postgresql://forge@localhost:5432/forge_admin_push_test \
 *     pnpm --filter @forge/admin exec vitest run src/services/push/batch.db.test.ts
 */
import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { env } from "@/config/env"

import { createPushBatchStore, runPushCampaignBatch } from "./batch"
import type { PushSendOutcome, PushTransport } from "./transport"

const databaseUrl = process.env.DATABASE_URL
// Sibling database suites run against the same database at the same time, so
// every row this file writes and every row it deletes carries this prefix.
const PREFIX = "push_batch_db_"
// The audience read is global by design, and the push database suites share one
// database. Every registration here carries this app-language slug and the
// campaign filters on it, so this suite can never claim a sibling's phone.
const LANGUAGE = `${PREFIX}lang`
const ZONE = "Pacific/Auckland"
const OTHER_ZONE = "Asia/Dubai"
const INSTANT = new Date("2026-10-01T20:00:00.000Z")
// Two hours before NOW, which is inside the lateness limit on purpose: this
// group has to send, not be retired.
const OTHER_INSTANT = new Date("2026-10-01T18:00:00.000Z")
const NOW = new Date("2026-10-01T20:00:05.000Z")

function config(overrides: Record<string, unknown> = {}) {
  return {
    campaignsEnabled: true,
    batchPageSize: 5_000,
    stepMaxDurationMs: 220_000,
    stepReserveMs: 40_000,
    chunkDeadlineMs: 10_000,
    providerConcurrency: 3,
    messagesPerSecond: 5_000,
    receiptPageSize: 10_000,
    blockedCountries: ["CN"],
    ...overrides,
  }
}

function transportThat(answer: (index: number) => PushSendOutcome): {
  transport: PushTransport
  sent: string[][]
} {
  const sent: string[][] = []
  return {
    sent,
    transport: {
      async sendChunk(messages) {
        sent.push(messages.map((message) => message.token))
        return messages.map((_message, index) => answer(index))
      },
      async fetchReceipts() {
        return new Map()
      },
    },
  }
}

describe.skipIf(env.PUSH_DB_TEST !== "1")(
  "the push batch store against Postgres",
  () => {
    let prisma: PrismaClient

    beforeAll(() => {
      prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    })

    beforeEach(async () => {
      await clean(prisma)
      await prisma.pushRegistration.createMany({
        data: [1, 2, 3].map((index) => ({
          id: `${PREFIX}reg_${index}`,
          expoPushToken: `${PREFIX}ExponentPushToken[t${index}]`,
          testDeviceId: `${PREFIX}device${index}`,
          platform: index === 3 ? ("ANDROID" as const) : ("IOS" as const),
          appBuild: "1.0.0",
          appLanguageSlug: LANGUAGE,
          phoneLocale: "en-NZ",
          timeZone: index === 1 ? ZONE : OTHER_ZONE,
          country: index === 3 ? "CN" : "NZ",
          countrySource: "EDGE" as const,
        })),
      })
      await prisma.pushCampaign.create({
        data: {
          id: `${PREFIX}campaign`,
          status: "SCHEDULED",
          mode: "WAVE",
          sendDate: new Date("2026-10-02T00:00:00.000Z"),
          localHour: 9,
          destinationKind: "SERIES",
          destinationSlug: "washi-gospel",
          audienceScope: "EVERYWHERE",
          languageFilter: [LANGUAGE],
        },
      })
      await prisma.pushCampaignCopy.create({
        data: {
          id: `${PREFIX}copy_en`,
          campaignId: `${PREFIX}campaign`,
          languageSlug: "english",
          title: "Good news",
          body: "Watch today",
        },
      })
      await prisma.pushCampaignZone.createMany({
        data: [
          {
            id: `${PREFIX}zone_a`,
            campaignId: `${PREFIX}campaign`,
            timeZone: ZONE,
            scheduledAt: INSTANT,
            status: "PENDING",
          },
          {
            id: `${PREFIX}zone_b`,
            campaignId: `${PREFIX}campaign`,
            timeZone: OTHER_ZONE,
            scheduledAt: OTHER_INSTANT,
            status: "PENDING",
          },
        ],
      })
    })

    afterAll(async () => {
      await clean(prisma)
      await prisma.$disconnect()
    })

    it("reads only the zones stored at the group's own instant", async () => {
      const store = createPushBatchStore(prisma)

      await expect(
        store.readZonesAt({
          campaignId: `${PREFIX}campaign`,
          instant: INSTANT,
        }),
      ).resolves.toEqual([ZONE])
    })

    it("moves the campaign to sending only from scheduled", async () => {
      const store = createPushBatchStore(prisma)

      const first = await store.startSending({
        campaignId: `${PREFIX}campaign`,
        now: NOW,
      })
      const second = await store.startSending({
        campaignId: `${PREFIX}campaign`,
        now: NOW,
      })

      expect([first, second]).toEqual([true, false])
      const campaign = await prisma.pushCampaign.findUniqueOrThrow({
        where: { id: `${PREFIX}campaign` },
        select: { status: true, sendingStartedAt: true },
      })
      expect(campaign.status).toBe("SENDING")
      expect(campaign.sendingStartedAt).toEqual(NOW)
    })

    it("moves only the group's own zones, and only from the status it expects", async () => {
      const store = createPushBatchStore(prisma)

      const moved = await store.markZones({
        campaignId: `${PREFIX}campaign`,
        timeZones: [ZONE],
        from: ["PENDING"],
        to: "DISPATCHING",
      })

      expect(moved).toBe(1)
      const zones = await prisma.pushCampaignZone.findMany({
        where: { campaignId: `${PREFIX}campaign` },
        orderBy: { timeZone: "asc" },
        select: { timeZone: true, status: true },
      })
      expect(zones).toEqual([
        { timeZone: OTHER_ZONE, status: "PENDING" },
        { timeZone: ZONE, status: "DISPATCHING" },
      ])
    })

    it("sends one page end to end and records a ticket per row", async () => {
      const { transport, sent } = transportThat((index) => ({
        kind: "accepted",
        ticketId: `${PREFIX}ticket_${index}`,
      }))

      const result = await runPushCampaignBatch(
        {
          campaignId: `${PREFIX}campaign`,
          kind: "LIVE",
          groupInstant: INSTANT.toISOString(),
          cursor: null,
        },
        {
          store: createPushBatchStore(prisma),
          transport,
          config: config(),
          now: () => NOW,
        },
      )

      expect(result.status).toBe("exhausted")
      expect(sent).toEqual([[`${PREFIX}ExponentPushToken[t1]`]])
      const rows = await prisma.pushDelivery.findMany({
        where: { campaignId: `${PREFIX}campaign` },
        select: { registrationId: true, status: true, ticketId: true },
      })
      expect(rows).toEqual([
        {
          registrationId: `${PREFIX}reg_1`,
          status: "ACCEPTED",
          ticketId: `${PREFIX}ticket_0`,
        },
      ])
    })

    it("records an Android phone in a blocked country as unreachable, unsent", async () => {
      // The blocked Android phone shares the other zone's group with reg_2.
      const { transport, sent } = transportThat(() => ({
        kind: "accepted",
        ticketId: `${PREFIX}ticket_x`,
      }))

      const result = await runPushCampaignBatch(
        {
          campaignId: `${PREFIX}campaign`,
          kind: "LIVE",
          groupInstant: OTHER_INSTANT.toISOString(),
          cursor: null,
        },
        {
          store: createPushBatchStore(prisma),
          transport,
          config: config(),
          now: () => NOW,
        },
      )

      expect(result.counts.unreachable).toBe(1)
      expect(sent[0]).toEqual([`${PREFIX}ExponentPushToken[t2]`])
      const unreachable = await prisma.pushDelivery.findFirstOrThrow({
        where: {
          campaignId: `${PREFIX}campaign`,
          registrationId: `${PREFIX}reg_3`,
        },
        select: { status: true, error: true },
      })
      expect(unreachable).toEqual({
        status: "UNREACHABLE",
        error: "no_transport",
      })
    })

    it("retires the delivery and the registration on a dead-token ticket", async () => {
      const { transport } = transportThat(() => ({
        kind: "dead_token",
        providerCode: "DeviceNotRegistered",
      }))

      await runPushCampaignBatch(
        {
          campaignId: `${PREFIX}campaign`,
          kind: "LIVE",
          groupInstant: INSTANT.toISOString(),
          cursor: null,
        },
        {
          store: createPushBatchStore(prisma),
          transport,
          config: config(),
          now: () => NOW,
        },
      )

      const delivery = await prisma.pushDelivery.findFirstOrThrow({
        where: { campaignId: `${PREFIX}campaign` },
        select: { status: true, error: true },
      })
      const registration = await prisma.pushRegistration.findUniqueOrThrow({
        where: { id: `${PREFIX}reg_1` },
        select: { status: true },
      })
      expect(delivery).toEqual({
        status: "INVALID",
        error: "DeviceNotRegistered",
      })
      expect(registration.status).toBe("INVALID")
    })

    it("stores the provider's code and never its message, which embeds the token", async () => {
      // The real dead-token message is
      // '"ExponentPushToken[x]" is not a registered push notification recipient'.
      const { transport } = transportThat(() => ({
        kind: "dead_token",
        providerCode: "DeviceNotRegistered",
      }))

      await runPushCampaignBatch(
        {
          campaignId: `${PREFIX}campaign`,
          kind: "LIVE",
          groupInstant: INSTANT.toISOString(),
          cursor: null,
        },
        {
          store: createPushBatchStore(prisma),
          transport,
          config: config(),
          now: () => NOW,
        },
      )

      const rows = await prisma.pushDelivery.findMany({
        where: { campaignId: `${PREFIX}campaign` },
        select: { error: true },
      })
      for (const row of rows) {
        expect(row.error).not.toContain("ExponentPushToken")
        expect(row.error).not.toContain("registered push notification")
      }
    })

    it("resends a reserved row on a replay, and never resends an accepted one", async () => {
      const store = createPushBatchStore(prisma)
      const first = transportThat((index) => ({
        kind: "accepted",
        ticketId: `${PREFIX}ticket_${index}`,
      }))
      const input = {
        campaignId: `${PREFIX}campaign`,
        kind: "LIVE" as const,
        groupInstant: INSTANT.toISOString(),
        cursor: null,
      }
      const deps = { store, config: config(), now: () => NOW }

      await runPushCampaignBatch(input, { ...deps, transport: first.transport })
      const replay = transportThat((index) => ({
        kind: "accepted",
        ticketId: `${PREFIX}replay_${index}`,
      }))
      await runPushCampaignBatch(input, {
        ...deps,
        transport: replay.transport,
      })

      expect(first.sent).toHaveLength(1)
      // The row is accepted now, so the replay finds nothing to send.
      expect(replay.sent).toEqual([])
      const rows = await prisma.pushDelivery.findMany({
        where: { campaignId: `${PREFIX}campaign` },
        select: { ticketId: true },
      })
      expect(rows).toEqual([{ ticketId: `${PREFIX}ticket_0` }])
    })

    it("sends exactly once after a reverted chunk is replayed", async () => {
      const store = createPushBatchStore(prisma)
      const input = {
        campaignId: `${PREFIX}campaign`,
        kind: "LIVE" as const,
        groupInstant: INSTANT.toISOString(),
        cursor: null,
      }
      const deps = { store, config: config(), now: () => NOW }

      // The first attempt reverts the chunk: the rows go back to reserved.
      const failing: PushTransport = {
        async sendChunk() {
          const { PushProviderRetryableError } = await import("./errors")
          throw new PushProviderRetryableError("http_429")
        },
        async fetchReceipts() {
          return new Map()
        },
      }
      await expect(
        runPushCampaignBatch(input, {
          ...deps,
          transport: failing,
          backoffMs: () => 0,
        }),
      ).rejects.toThrow()

      const reserved = await prisma.pushDelivery.findMany({
        where: { campaignId: `${PREFIX}campaign` },
        select: { status: true },
      })
      expect(reserved).toEqual([{ status: "RESERVED" }])

      const replay = transportThat((index) => ({
        kind: "accepted",
        ticketId: `${PREFIX}replay_${index}`,
      }))
      await runPushCampaignBatch(input, {
        ...deps,
        transport: replay.transport,
      })

      expect(replay.sent).toEqual([[`${PREFIX}ExponentPushToken[t1]`]])
      const after = await prisma.pushDelivery.findMany({
        where: { campaignId: `${PREFIX}campaign` },
        select: { status: true, ticketId: true },
      })
      expect(after).toEqual([
        { status: "ACCEPTED", ticketId: `${PREFIX}replay_0` },
      ])
    })

    it("leaves an indeterminate chunk at sending, so no replay resends it", async () => {
      const store = createPushBatchStore(prisma)
      const input = {
        campaignId: `${PREFIX}campaign`,
        kind: "LIVE" as const,
        groupInstant: INSTANT.toISOString(),
        cursor: null,
      }
      const deps = { store, config: config(), now: () => NOW }
      const timingOut: PushTransport = {
        async sendChunk() {
          const { PushProviderIndeterminateError } = await import("./errors")
          throw new PushProviderIndeterminateError("provider_timeout")
        },
        async fetchReceipts() {
          return new Map()
        },
      }

      await runPushCampaignBatch(input, { ...deps, transport: timingOut })
      const replay = transportThat(() => ({
        kind: "accepted",
        ticketId: `${PREFIX}replay_0`,
      }))
      await runPushCampaignBatch(input, {
        ...deps,
        transport: replay.transport,
      })

      expect(replay.sent).toEqual([])
      const rows = await prisma.pushDelivery.findMany({
        where: { campaignId: `${PREFIX}campaign` },
        select: { status: true, ticketId: true },
      })
      expect(rows).toEqual([{ status: "SENDING", ticketId: null }])
    })

    it("frees a reserved row's day when the group goes late", async () => {
      const store = createPushBatchStore(prisma)
      const input = {
        campaignId: `${PREFIX}campaign`,
        kind: "LIVE" as const,
        groupInstant: INSTANT.toISOString(),
        cursor: null,
      }
      const failing: PushTransport = {
        async sendChunk() {
          const { PushProviderRetryableError } = await import("./errors")
          throw new PushProviderRetryableError("http_429")
        },
        async fetchReceipts() {
          return new Map()
        },
      }
      await expect(
        runPushCampaignBatch(input, {
          store,
          transport: failing,
          config: config(),
          now: () => NOW,
          backoffMs: () => 0,
        }),
      ).rejects.toThrow()

      const late = new Date(INSTANT.getTime() + 4 * 60 * 60 * 1_000)
      const result = await runPushCampaignBatch(input, {
        store,
        transport: transportThat(() => ({
          kind: "accepted",
          ticketId: "x",
        })).transport,
        config: config(),
        now: () => late,
      })

      expect(result.status).toBe("late")
      expect(result.counts.missed).toBe(1)
      const rows = await prisma.pushDelivery.findMany({
        where: { campaignId: `${PREFIX}campaign` },
        select: { status: true },
      })
      // A missed row sits outside the daily-claim index, so the phone's day is
      // free for another campaign.
      expect(rows).toEqual([{ status: "MISSED" }])
    })

    it("sends a test to the test devices without claiming their day", async () => {
      await prisma.pushTestDevice.create({
        data: {
          id: `${PREFIX}td_1`,
          label: "Owner iPhone",
          registrationId: `${PREFIX}reg_1`,
        },
      })
      const { transport, sent } = transportThat(() => ({
        kind: "accepted",
        ticketId: `${PREFIX}test_ticket`,
      }))

      await runPushCampaignBatch(
        {
          campaignId: `${PREFIX}campaign`,
          kind: "TEST",
          groupInstant: null,
          cursor: null,
        },
        {
          store: createPushBatchStore(prisma),
          transport,
          config: config(),
          now: () => NOW,
        },
      )

      expect(sent).toEqual([[`${PREFIX}ExponentPushToken[t1]`]])
      const rows = await prisma.pushDelivery.findMany({
        where: { campaignId: `${PREFIX}campaign` },
        select: { kind: true, status: true },
      })
      expect(rows).toEqual([{ kind: "TEST", status: "ACCEPTED" }])
      // The campaign never left scheduled: a test send does not open the wave.
      const campaign = await prisma.pushCampaign.findUniqueOrThrow({
        where: { id: `${PREFIX}campaign` },
        select: { status: true },
      })
      expect(campaign.status).toBe("SCHEDULED")
    })

    it("still sends the live row to a phone that already got the test", async () => {
      await prisma.pushTestDevice.create({
        data: {
          id: `${PREFIX}td_1`,
          label: "Owner iPhone",
          registrationId: `${PREFIX}reg_1`,
        },
      })
      const store = createPushBatchStore(prisma)
      const deps = { store, config: config(), now: () => NOW }

      await runPushCampaignBatch(
        {
          campaignId: `${PREFIX}campaign`,
          kind: "TEST",
          groupInstant: null,
          cursor: null,
        },
        {
          ...deps,
          transport: transportThat(() => ({
            kind: "accepted",
            ticketId: `${PREFIX}test_ticket`,
          })).transport,
        },
      )
      const live = transportThat(() => ({
        kind: "accepted",
        ticketId: `${PREFIX}live_ticket`,
      }))
      await runPushCampaignBatch(
        {
          campaignId: `${PREFIX}campaign`,
          kind: "LIVE",
          groupInstant: INSTANT.toISOString(),
          cursor: null,
        },
        { ...deps, transport: live.transport },
      )

      expect(live.sent).toEqual([[`${PREFIX}ExponentPushToken[t1]`]])
      const rows = await prisma.pushDelivery.findMany({
        where: { campaignId: `${PREFIX}campaign` },
        orderBy: { kind: "asc" },
        select: { kind: true, status: true },
      })
      expect(rows).toEqual([
        { kind: "LIVE", status: "ACCEPTED" },
        { kind: "TEST", status: "ACCEPTED" },
      ])
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
