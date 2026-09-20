/**
 * Real-Postgres proof of KTD3: one claim statement per page, the daily claim
 * arbitrated by the partial unique index, and every status transition
 * conditional on the status it expects.
 *
 * The PrismaClient is built in `beforeAll`, never in the describe body:
 * `describe.skipIf` still runs the body to collect the tests, and a client
 * constructed there with no URL throws at collection time.
 *
 * Run with:
 *   PUSH_DB_TEST=1 DATABASE_URL=postgresql://forge@localhost:5432/forge_admin_push_test \
 *     pnpm --filter @forge/admin exec vitest run src/services/push/claims.db.test.ts
 */
import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { env } from "@/config/env"

import {
  cancelPendingPushZones,
  claimPushDeliveryPage,
  markPushReservedAsMissed,
  moveReservedToSending,
  revertSendingToReserved,
  transitionPushCampaignStatus,
  transitionPushZoneStatus,
  type PushClaimCandidate,
} from "./claims"

const databaseUrl = process.env.DATABASE_URL
// Sibling database suites run in parallel, so every read is scoped to the
// campaign ids this file created. The delivery ids come from the service, not
// from the prefix, so they are reached through their campaign.
const PREFIX = "push_claims_db_"

const ZONE = "Pacific/Auckland"
const OTHER_ZONE = "Asia/Riyadh"
const DAY = "2026-10-01"
const NEXT_DAY = "2026-10-02"

function candidate(
  overrides: Partial<PushClaimCandidate> = {},
): PushClaimCandidate {
  return {
    registrationId: `${PREFIX}reg_1`,
    languageSlug: "english",
    country: "NZ",
    timeZone: ZONE,
    localDay: DAY,
    ...overrides,
  }
}

describe.skipIf(env.PUSH_DB_TEST !== "1")(
  "push claims against Postgres",
  () => {
    let prisma: PrismaClient
    let second: PrismaClient

    beforeAll(() => {
      prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
      second = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    })

    beforeEach(async () => {
      await clean(prisma)
      await prisma.pushRegistration.createMany({
        data: [1, 2].map((index) => ({
          id: `${PREFIX}reg_${index}`,
          expoPushToken: `${PREFIX}token_${index}`,
          testDeviceId: `${PREFIX}device${index}`,
          platform: "IOS" as const,
          appBuild: "1.0.0",
          appLanguageSlug: "english",
          phoneLocale: "en-NZ",
          timeZone: ZONE,
          countrySource: "EDGE" as const,
        })),
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

    it("claims a page of phones in one statement", async () => {
      const result = await claimPushDeliveryPage(prisma, {
        campaignId: `${PREFIX}campaign_a`,
        kind: "LIVE",
        candidates: [
          candidate(),
          candidate({ registrationId: `${PREFIX}reg_2` }),
        ],
      })

      expect(result.claimed).toHaveLength(2)
      expect(result.suppressed).toEqual([])
      const rows = await prisma.pushDelivery.findMany({
        where: { campaignId: `${PREFIX}campaign_a` },
        orderBy: { registrationId: "asc" },
        select: {
          registrationId: true,
          status: true,
          kind: true,
          languageSlug: true,
          country: true,
          timeZone: true,
          nonce: true,
        },
      })
      expect(rows).toEqual([
        {
          registrationId: `${PREFIX}reg_1`,
          status: "RESERVED",
          kind: "LIVE",
          languageSlug: "english",
          country: "NZ",
          timeZone: ZONE,
          nonce: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        },
        {
          registrationId: `${PREFIX}reg_2`,
          status: "RESERVED",
          kind: "LIVE",
          languageSlug: "english",
          country: "NZ",
          timeZone: ZONE,
          nonce: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        },
      ])
    })

    it("gives one phone's day to one campaign and suppresses the other (AE8)", async () => {
      const first = await claimPushDeliveryPage(prisma, {
        campaignId: `${PREFIX}campaign_a`,
        kind: "LIVE",
        candidates: [candidate()],
      })
      const secondClaim = await claimPushDeliveryPage(prisma, {
        campaignId: `${PREFIX}campaign_b`,
        kind: "LIVE",
        candidates: [candidate()],
      })

      expect(first.claimed).toHaveLength(1)
      expect(secondClaim.claimed).toEqual([])
      expect(secondClaim.suppressed).toEqual([
        { registrationId: `${PREFIX}reg_1`, reason: "daily_claim" },
      ])
      const suppressed = await prisma.pushDelivery.findMany({
        where: { campaignId: `${PREFIX}campaign_b` },
        select: { status: true, error: true, localDay: true },
      })
      expect(suppressed).toEqual([
        {
          status: "SUPPRESSED",
          error: "daily_claim",
          localDay: new Date(`${DAY}T00:00:00.000Z`),
        },
      ])
    })

    it("keeps one claim when two connections claim the same phone and day", async () => {
      const [a, b] = await Promise.all([
        claimPushDeliveryPage(prisma, {
          campaignId: `${PREFIX}campaign_a`,
          kind: "LIVE",
          candidates: [candidate()],
        }),
        claimPushDeliveryPage(second, {
          campaignId: `${PREFIX}campaign_b`,
          kind: "LIVE",
          candidates: [candidate()],
        }),
      ])

      expect(a.claimed.length + b.claimed.length).toBe(1)
      expect(
        await prisma.pushDelivery.count({
          where: { registrationId: `${PREFIX}reg_1`, status: "RESERVED" },
        }),
      ).toBe(1)
    })

    it("reports a replayed page as already claimed, not as suppressed", async () => {
      await claimPushDeliveryPage(prisma, {
        campaignId: `${PREFIX}campaign_a`,
        kind: "LIVE",
        candidates: [candidate()],
      })

      const replay = await claimPushDeliveryPage(prisma, {
        campaignId: `${PREFIX}campaign_a`,
        kind: "LIVE",
        candidates: [candidate()],
      })

      expect(replay.claimed).toEqual([])
      expect(replay.suppressed).toEqual([])
      expect(replay.alreadyClaimed).toEqual([`${PREFIX}reg_1`])
      expect(
        await prisma.pushDelivery.count({
          where: { campaignId: `${PREFIX}campaign_a` },
        }),
      ).toBe(1)
    })

    it("delivers an evening and a next-morning campaign in one zone", async () => {
      const evening = await claimPushDeliveryPage(prisma, {
        campaignId: `${PREFIX}campaign_a`,
        kind: "LIVE",
        candidates: [candidate({ localDay: DAY })],
        now: new Date("2026-10-01T08:00:00.000Z"),
      })
      const morning = await claimPushDeliveryPage(prisma, {
        campaignId: `${PREFIX}campaign_b`,
        kind: "LIVE",
        candidates: [candidate({ localDay: NEXT_DAY })],
        now: new Date("2026-10-01T20:00:00.000Z"),
      })

      expect(evening.claimed).toHaveLength(1)
      expect(morning.claimed).toHaveLength(1)
    })

    it("suppresses the second campaign when the phone changed zone", async () => {
      await claimPushDeliveryPage(prisma, {
        campaignId: `${PREFIX}campaign_a`,
        kind: "LIVE",
        candidates: [candidate({ localDay: DAY })],
        now: new Date("2026-10-01T08:00:00.000Z"),
      })

      const afterFlight = await claimPushDeliveryPage(prisma, {
        campaignId: `${PREFIX}campaign_b`,
        kind: "LIVE",
        candidates: [candidate({ localDay: NEXT_DAY, timeZone: OTHER_ZONE })],
        now: new Date("2026-10-01T20:00:00.000Z"),
      })

      expect(afterFlight.claimed).toEqual([])
      expect(afterFlight.suppressed).toEqual([
        { registrationId: `${PREFIX}reg_1`, reason: "zone_guard" },
      ])
      expect(
        await prisma.pushDelivery.findFirst({
          where: { campaignId: `${PREFIX}campaign_b` },
          select: { status: true, error: true },
        }),
      ).toEqual({ status: "SUPPRESSED", error: "zone_guard" })
    })

    it("lets a zone change outside the guard window through", async () => {
      await claimPushDeliveryPage(prisma, {
        campaignId: `${PREFIX}campaign_a`,
        kind: "LIVE",
        candidates: [candidate({ localDay: DAY })],
        now: new Date("2026-10-01T08:00:00.000Z"),
      })

      const later = await claimPushDeliveryPage(prisma, {
        campaignId: `${PREFIX}campaign_b`,
        kind: "LIVE",
        candidates: [candidate({ localDay: NEXT_DAY, timeZone: OTHER_ZONE })],
        now: new Date("2026-10-02T08:00:00.000Z"),
      })

      expect(later.claimed).toHaveLength(1)
    })

    it("claims a test row beside the live row for a test phone", async () => {
      const live = await claimPushDeliveryPage(prisma, {
        campaignId: `${PREFIX}campaign_a`,
        kind: "LIVE",
        candidates: [candidate()],
      })
      const test = await claimPushDeliveryPage(prisma, {
        campaignId: `${PREFIX}campaign_a`,
        kind: "TEST",
        candidates: [candidate()],
      })
      const retest = await claimPushDeliveryPage(prisma, {
        campaignId: `${PREFIX}campaign_a`,
        kind: "TEST",
        candidates: [candidate()],
      })

      expect(live.claimed).toHaveLength(1)
      expect(test.claimed).toHaveLength(1)
      expect(retest.claimed).toHaveLength(1)
      expect(
        await prisma.pushDelivery.groupBy({
          by: ["kind"],
          where: { campaignId: `${PREFIX}campaign_a` },
          _count: { _all: true },
          orderBy: { kind: "asc" },
        }),
      ).toEqual([
        { kind: "LIVE", _count: { _all: 1 } },
        { kind: "TEST", _count: { _all: 2 } },
      ])
    })

    it("frees the phone's day once a claim is marked missed", async () => {
      await claimPushDeliveryPage(prisma, {
        campaignId: `${PREFIX}campaign_a`,
        kind: "LIVE",
        candidates: [candidate()],
      })

      const missed = await markPushReservedAsMissed(prisma, {
        campaignId: `${PREFIX}campaign_a`,
        timeZones: [ZONE],
      })
      const afterMiss = await claimPushDeliveryPage(prisma, {
        campaignId: `${PREFIX}campaign_b`,
        kind: "LIVE",
        candidates: [candidate()],
      })

      expect(missed).toBe(1)
      expect(afterMiss.claimed).toHaveLength(1)
    })
  },
)

describe.skipIf(env.PUSH_DB_TEST !== "1")(
  "push claim status transitions against Postgres",
  () => {
    let prisma: PrismaClient

    beforeAll(() => {
      prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    })

    beforeEach(async () => {
      await clean(prisma)
      await prisma.pushRegistration.create({
        data: {
          id: `${PREFIX}reg_1`,
          expoPushToken: `${PREFIX}token_1`,
          testDeviceId: `${PREFIX}device1`,
          platform: "IOS",
          appBuild: "1.0.0",
          appLanguageSlug: "english",
          phoneLocale: "en-NZ",
          timeZone: ZONE,
          countrySource: "EDGE",
        },
      })
      await prisma.pushCampaign.create({
        data: {
          id: `${PREFIX}campaign_a`,
          status: "SENDING",
          destinationKind: "SERIES",
          destinationSlug: "series-a",
        },
      })
    })

    afterAll(async () => {
      await clean(prisma)
      await prisma.$disconnect()
    })

    async function claimOne(): Promise<string> {
      const result = await claimPushDeliveryPage(prisma, {
        campaignId: `${PREFIX}campaign_a`,
        kind: "LIVE",
        candidates: [candidate()],
      })
      return result.claimed[0].id
    }

    it("moves reserved rows to sending while the campaign is sending", async () => {
      const id = await claimOne()

      const moved = await moveReservedToSending(prisma, {
        campaignId: `${PREFIX}campaign_a`,
        deliveryIds: [id],
      })

      expect(moved.map((row) => row.id)).toEqual([id])
      expect(moved[0].nonce).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(
        await prisma.pushDelivery.findUnique({
          where: { id },
          select: { status: true, sendingAt: true },
        }),
      ).toEqual({ status: "SENDING", sendingAt: expect.any(Date) })
    })

    it("moves nothing once the campaign leaves sending", async () => {
      const id = await claimOne()
      await prisma.pushCampaign.update({
        where: { id: `${PREFIX}campaign_a` },
        data: { status: "CANCELLED" },
      })

      const moved = await moveReservedToSending(prisma, {
        campaignId: `${PREFIX}campaign_a`,
        deliveryIds: [id],
      })

      expect(moved).toEqual([])
      expect(
        await prisma.pushDelivery.findUnique({
          where: { id },
          select: { status: true },
        }),
      ).toEqual({ status: "RESERVED" })
    })

    it("moves a row once, so a replay resends nothing", async () => {
      const id = await claimOne()

      const first = await moveReservedToSending(prisma, {
        campaignId: `${PREFIX}campaign_a`,
        deliveryIds: [id],
      })
      const replay = await moveReservedToSending(prisma, {
        campaignId: `${PREFIX}campaign_a`,
        deliveryIds: [id],
      })

      expect(first).toHaveLength(1)
      expect(replay).toEqual([])
    })

    it("moves a test row without the campaign being in sending", async () => {
      await prisma.pushCampaign.update({
        where: { id: `${PREFIX}campaign_a` },
        data: { status: "TESTED" },
      })
      const claim = await claimPushDeliveryPage(prisma, {
        campaignId: `${PREFIX}campaign_a`,
        kind: "TEST",
        candidates: [candidate()],
      })

      const moved = await moveReservedToSending(prisma, {
        campaignId: `${PREFIX}campaign_a`,
        deliveryIds: [claim.claimed[0].id],
        expectedCampaignStatus: null,
      })

      expect(moved).toHaveLength(1)
    })

    it("reverts a chunk that never reached the provider", async () => {
      const id = await claimOne()
      await moveReservedToSending(prisma, {
        campaignId: `${PREFIX}campaign_a`,
        deliveryIds: [id],
      })

      const reverted = await revertSendingToReserved(prisma, {
        campaignId: `${PREFIX}campaign_a`,
        deliveryIds: [id],
      })

      expect(reverted).toBe(1)
      expect(
        await prisma.pushDelivery.findUnique({
          where: { id },
          select: { status: true },
        }),
      ).toEqual({ status: "RESERVED" })
    })

    it("reverts nothing once a row has moved past sending", async () => {
      const id = await claimOne()
      await prisma.pushDelivery.update({
        where: { id },
        data: { status: "ACCEPTED" },
      })

      expect(
        await revertSendingToReserved(prisma, {
          campaignId: `${PREFIX}campaign_a`,
          deliveryIds: [id],
        }),
      ).toBe(0)
    })

    it("moves the campaign only from the status it expects", async () => {
      const wrongPrior = await transitionPushCampaignStatus(prisma, {
        campaignId: `${PREFIX}campaign_a`,
        from: ["SCHEDULED"],
        to: "SENT",
      })
      const rightPrior = await transitionPushCampaignStatus(prisma, {
        campaignId: `${PREFIX}campaign_a`,
        from: ["SENDING"],
        to: "SENT",
        actorId: "actor_1",
      })

      expect([wrongPrior, rightPrior]).toEqual([false, true])
      expect(
        await prisma.pushCampaign.findUnique({
          where: { id: `${PREFIX}campaign_a` },
          select: { status: true, lastActorId: true },
        }),
      ).toEqual({ status: "SENT", lastActorId: "actor_1" })
    })

    it("cancels the zones that have not started and leaves the rest", async () => {
      await prisma.pushCampaignZone.createMany({
        data: [
          {
            id: `${PREFIX}zone_pending`,
            campaignId: `${PREFIX}campaign_a`,
            timeZone: ZONE,
            scheduledAt: new Date("2026-10-01T20:00:00.000Z"),
            status: "PENDING",
          },
          {
            id: `${PREFIX}zone_dispatched`,
            campaignId: `${PREFIX}campaign_a`,
            timeZone: OTHER_ZONE,
            scheduledAt: new Date("2026-10-01T06:00:00.000Z"),
            status: "DISPATCHED",
          },
        ],
      })

      const cancelled = await cancelPendingPushZones(
        prisma,
        `${PREFIX}campaign_a`,
      )

      expect(cancelled).toBe(1)
      expect(
        await prisma.pushCampaignZone.findMany({
          where: { campaignId: `${PREFIX}campaign_a` },
          orderBy: { id: "asc" },
          select: { id: true, status: true },
        }),
      ).toEqual([
        { id: `${PREFIX}zone_dispatched`, status: "DISPATCHED" },
        { id: `${PREFIX}zone_pending`, status: "CANCELLED" },
      ])
    })

    it("moves a zone only from the status it expects", async () => {
      await prisma.pushCampaignZone.create({
        data: {
          id: `${PREFIX}zone_pending`,
          campaignId: `${PREFIX}campaign_a`,
          timeZone: ZONE,
          scheduledAt: new Date("2026-10-01T20:00:00.000Z"),
          status: "PENDING",
        },
      })

      const wrongPrior = await transitionPushZoneStatus(prisma, {
        zoneId: `${PREFIX}zone_pending`,
        from: ["DISPATCHING"],
        to: "DISPATCHED",
      })
      const rightPrior = await transitionPushZoneStatus(prisma, {
        zoneId: `${PREFIX}zone_pending`,
        from: ["PENDING"],
        to: "DISPATCHING",
      })

      expect([wrongPrior, rightPrior]).toEqual([false, true])
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
