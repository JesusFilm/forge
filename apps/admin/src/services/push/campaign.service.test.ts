import type { PushCampaignStatus } from "@prisma/client"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  PushFrozenError,
  PushInputError,
  PushInvalidTransitionError,
  PushNotTestedError,
} from "./errors"
import {
  cancelPushCampaign,
  confirmPushSendNow,
  createPushCampaignDraft,
  readPushTestSendOutcome,
  recordPushTestSend,
  schedulePushCampaign,
  updatePushCampaign,
} from "./campaign.service"

/**
 * What these suites read back off a mocked Prisma call. Every field is
 * declared present because the assertions below name the ones they read.
 */
type PrismaCallArgs = {
  where: Record<string, unknown>
  data: Record<string, unknown>
  orderBy: unknown
  take: number
  select: unknown
}

const ACTOR = "user_1"
const CAMPAIGN = "campaign_1"

const COPY = [
  { languageSlug: "english", title: "An announcement", body: "Watch tonight" },
  { languageSlug: "arabic", title: "إعلان", body: "شاهد الليلة" },
]

type CampaignRow = {
  id: string
  status: PushCampaignStatus
  destinationKind: "VIDEO" | "SERIES" | "EXPERIENCE" | null
  destinationSlug: string | null
}

function buildClient(
  campaign: Partial<CampaignRow> | null = { status: "TESTED" },
  options: { moved?: number; published?: boolean } = {},
) {
  // The destination re-check counts catalog rows; one row means published.
  // One spy per table, so a test can tell which catalog the check read.
  const catalogCount = () =>
    vi.fn(async (_args: { where: Record<string, unknown> }) =>
      options.published === false ? 0 : 1,
    )
  const row: CampaignRow | null =
    campaign === null
      ? null
      : {
          id: CAMPAIGN,
          status: "TESTED",
          destinationKind: "SERIES",
          destinationSlug: "jesus",
          ...campaign,
        }
  const client = {
    pushCampaign: {
      create: vi.fn(async (_args: PrismaCallArgs) => ({
        id: CAMPAIGN,
        status: "DRAFT",
      })),
      findUnique: vi.fn(async (_args: PrismaCallArgs) => row),
      updateMany: vi.fn(async (_args: PrismaCallArgs) => ({
        count: options.moved ?? 1,
      })),
    },
    pushCampaignCopy: {
      deleteMany: vi.fn(async (_args: PrismaCallArgs) => ({ count: 0 })),
      createMany: vi.fn(async (_args: PrismaCallArgs) => ({
        count: COPY.length,
      })),
    },
    pushCampaignZone: {
      updateMany: vi.fn(async (_args: PrismaCallArgs) => ({ count: 2 })),
    },
    pushDelivery: {
      findMany: vi.fn(async (_args: PrismaCallArgs) => []),
      updateMany: vi.fn(async (_args: PrismaCallArgs) => ({ count: 3 })),
    },
    video: { count: catalogCount() },
    experienceLocale: { count: catalogCount() },
    $transaction: vi.fn(async (run: (tx: unknown) => unknown) => run(client)),
  }
  return client
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe("push campaign draft", () => {
  it("creates a draft that records the actor", async () => {
    const client = buildClient()

    await createPushCampaignDraft(client as never, { actorId: ACTOR })

    expect(client.pushCampaign.create).toHaveBeenCalledWith({
      data: { status: "DRAFT", lastActorId: ACTOR },
      select: { id: true, status: true },
    })
  })
})

describe("push campaign edits", () => {
  it("saves copy, destination, and audience on a draft", async () => {
    const client = buildClient({ status: "DRAFT" })

    await updatePushCampaign(client as never, {
      campaignId: CAMPAIGN,
      actorId: ACTOR,
      update: {
        copies: COPY,
        destination: { kind: "VIDEO", slug: "jesus" },
        audience: { scope: "COUNTRIES", countries: ["sa"] },
      },
    })

    const [update] = client.pushCampaign.updateMany.mock.calls[0]
    expect(update.where).toEqual({
      id: CAMPAIGN,
      status: { in: ["DRAFT", "TESTED"] },
    })
    expect(update.data).toMatchObject({
      status: "DRAFT",
      lastActorId: ACTOR,
      destinationKind: "VIDEO",
      destinationSlug: "jesus",
      audienceScope: "COUNTRIES",
      countries: ["SA"],
      languageFilter: [],
    })
    expect(client.pushCampaignCopy.deleteMany).toHaveBeenCalledWith({
      where: { campaignId: CAMPAIGN },
    })
    expect(client.pushCampaignCopy.createMany).toHaveBeenCalledWith({
      data: COPY.map((copy) => ({ ...copy, campaignId: CAMPAIGN })),
    })
  })

  it("sends a tested campaign back to draft when it is edited", async () => {
    const client = buildClient({ status: "TESTED" })

    const state = await updatePushCampaign(client as never, {
      campaignId: CAMPAIGN,
      actorId: ACTOR,
      update: { copies: COPY },
    })

    expect(state.status).toBe("DRAFT")
    expect(client.pushCampaign.updateMany.mock.calls[0][0].data.status).toBe(
      "DRAFT",
    )
  })

  it("leaves the copy rows alone when the edit does not name them", async () => {
    const client = buildClient({ status: "DRAFT" })

    await updatePushCampaign(client as never, {
      campaignId: CAMPAIGN,
      actorId: ACTOR,
      update: { destination: { kind: "SERIES", slug: "jesus" } },
    })

    expect(client.pushCampaignCopy.deleteMany).not.toHaveBeenCalled()
    expect(client.pushCampaignCopy.createMany).not.toHaveBeenCalled()
  })

  it.each(["SENDING", "SENT", "CANCELLED", "PAUSED"] as const)(
    "refuses an edit while the campaign is %s (AE12)",
    async (status) => {
      const client = buildClient({ status })

      await expect(
        updatePushCampaign(client as never, {
          campaignId: CAMPAIGN,
          actorId: ACTOR,
          update: { copies: COPY },
        }),
      ).rejects.toThrowError(PushFrozenError)
      expect(client.pushCampaign.updateMany).not.toHaveBeenCalled()
    },
  )

  it("refuses an edit to a scheduled campaign", async () => {
    const client = buildClient({ status: "SCHEDULED" })

    await expect(
      updatePushCampaign(client as never, {
        campaignId: CAMPAIGN,
        actorId: ACTOR,
        update: { copies: COPY },
      }),
    ).rejects.toThrowError(PushFrozenError)
  })

  it("refuses a title one character over the cap", async () => {
    const client = buildClient({ status: "DRAFT" })

    await expect(
      updatePushCampaign(client as never, {
        campaignId: CAMPAIGN,
        actorId: ACTOR,
        update: {
          copies: [{ ...COPY[0], title: "a".repeat(51) }],
        },
      }),
    ).rejects.toThrowError(PushInputError)
  })

  it("refuses a copy set with no English row", async () => {
    const client = buildClient({ status: "DRAFT" })

    await expect(
      updatePushCampaign(client as never, {
        campaignId: CAMPAIGN,
        actorId: ACTOR,
        update: { copies: [COPY[1]] },
      }),
    ).rejects.toThrowError(PushInputError)
  })

  it("refuses an edit to a campaign that is gone", async () => {
    const client = buildClient(null, { moved: 0 })

    await expect(
      updatePushCampaign(client as never, {
        campaignId: CAMPAIGN,
        actorId: ACTOR,
        update: { copies: COPY },
      }),
    ).rejects.toThrowError(PushInvalidTransitionError)
    expect(client.pushCampaign.updateMany).not.toHaveBeenCalled()
  })

  it("refuses an edit that lost the race to a status change", async () => {
    const client = buildClient({ status: "DRAFT" }, { moved: 0 })

    await expect(
      updatePushCampaign(client as never, {
        campaignId: CAMPAIGN,
        actorId: ACTOR,
        update: { copies: COPY },
      }),
    ).rejects.toThrowError(PushInvalidTransitionError)
  })
})

describe("push campaign test send", () => {
  it("records the test send and moves a draft to tested", async () => {
    const client = buildClient({ status: "DRAFT" })
    const now = new Date("2026-10-01T09:00:00.000Z")

    await recordPushTestSend(client as never, {
      campaignId: CAMPAIGN,
      actorId: ACTOR,
      now,
    })

    const [update] = client.pushCampaign.updateMany.mock.calls[0]
    expect(update.where).toEqual({
      id: CAMPAIGN,
      status: { in: ["DRAFT", "TESTED"] },
    })
    expect(update.data).toMatchObject({
      status: "TESTED",
      testSentAt: now,
      lastActorId: ACTOR,
    })
  })

  it("refuses to record a test send once sending started", async () => {
    const client = buildClient({ status: "SENDING" })

    await expect(
      recordPushTestSend(client as never, {
        campaignId: CAMPAIGN,
        actorId: ACTOR,
      }),
    ).rejects.toThrowError(PushFrozenError)
  })

  it("reads the newest outcome per test phone", async () => {
    const client = buildClient()
    client.pushDelivery.findMany = vi.fn(async (_args: PrismaCallArgs) => [
      {
        id: "delivery_new",
        status: "ACCEPTED",
        error: null,
        createdAt: new Date("2026-10-01T10:00:00.000Z"),
        registrationId: "reg_1",
        registration: {
          testDeviceId: "device1",
          testDevice: { label: "Urim iPhone" },
        },
      },
      {
        id: "delivery_old",
        status: "FAILED",
        error: "DeviceNotRegistered",
        createdAt: new Date("2026-10-01T09:00:00.000Z"),
        registrationId: "reg_1",
        registration: {
          testDeviceId: "device1",
          testDevice: { label: "Urim iPhone" },
        },
      },
    ]) as never

    const outcome = await readPushTestSendOutcome(client as never, CAMPAIGN)

    expect(outcome).toEqual([
      {
        deliveryId: "delivery_new",
        registrationId: "reg_1",
        testDeviceId: "device1",
        label: "Urim iPhone",
        status: "ACCEPTED",
        error: null,
        sentAt: new Date("2026-10-01T10:00:00.000Z"),
      },
    ])
    const [read] = client.pushDelivery.findMany.mock.calls[0]
    expect(read.where).toEqual({ campaignId: CAMPAIGN, kind: "TEST" })
    expect(read.take).toBeGreaterThan(0)
  })
})

describe("push campaign scheduling", () => {
  it("schedules a tested campaign as a wave", async () => {
    const client = buildClient({ status: "TESTED" })

    await schedulePushCampaign(client as never, {
      campaignId: CAMPAIGN,
      actorId: ACTOR,
      sendDate: "2026-10-05",
      localHour: 9,
    })

    const [update] = client.pushCampaign.updateMany.mock.calls[0]
    expect(update.where).toEqual({ id: CAMPAIGN, status: { in: ["TESTED"] } })
    expect(update.data).toMatchObject({
      status: "SCHEDULED",
      mode: "WAVE",
      localHour: 9,
      lastActorId: ACTOR,
    })
    expect(update.data.sendDate).toEqual(new Date("2026-10-05T00:00:00.000Z"))
  })

  it("refuses to schedule a campaign with no test send (AE11)", async () => {
    const client = buildClient({ status: "DRAFT" })

    const error = await schedulePushCampaign(client as never, {
      campaignId: CAMPAIGN,
      actorId: ACTOR,
      sendDate: "2026-10-05",
      localHour: 9,
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(PushNotTestedError)
    expect((error as PushNotTestedError).status).toBe("DRAFT")
    expect(client.pushCampaign.updateMany).not.toHaveBeenCalled()
  })

  it.each(["SCHEDULED", "SENDING", "SENT", "CANCELLED"] as const)(
    "refuses to schedule a campaign that is %s",
    async (status) => {
      const client = buildClient({ status })

      const error = await schedulePushCampaign(client as never, {
        campaignId: CAMPAIGN,
        actorId: ACTOR,
        sendDate: "2026-10-05",
        localHour: 9,
      }).catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(PushInvalidTransitionError)
      expect((error as PushInvalidTransitionError).from).toBe(status)
    },
  )

  it("refuses to schedule a campaign with no destination", async () => {
    const client = buildClient({
      status: "TESTED",
      destinationKind: null,
      destinationSlug: null,
    })

    await expect(
      schedulePushCampaign(client as never, {
        campaignId: CAMPAIGN,
        actorId: ACTOR,
        sendDate: "2026-10-05",
        localHour: 9,
      }),
    ).rejects.toThrowError(PushInputError)
  })

  it("refuses an hour outside the day", async () => {
    const client = buildClient({ status: "TESTED" })

    await expect(
      schedulePushCampaign(client as never, {
        campaignId: CAMPAIGN,
        actorId: ACTOR,
        sendDate: "2026-10-05",
        localHour: 24,
      }),
    ).rejects.toThrowError(PushInputError)
  })

  it("refuses to schedule a campaign whose destination is no longer published", async () => {
    const client = buildClient({ status: "TESTED" }, { published: false })

    const error = await schedulePushCampaign(client as never, {
      campaignId: CAMPAIGN,
      actorId: ACTOR,
      sendDate: "2026-10-05",
      localHour: 9,
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(PushInputError)
    expect((error as PushInputError).message).toContain("not published")
    expect(client.pushCampaign.updateMany).not.toHaveBeenCalled()
  })

  it("re-checks the destination against the published catalog by its slug", async () => {
    const client = buildClient({
      status: "TESTED",
      destinationKind: "SERIES",
      destinationSlug: "jesus",
    })

    await schedulePushCampaign(client as never, {
      campaignId: CAMPAIGN,
      actorId: ACTOR,
      sendDate: "2026-10-05",
      localHour: 9,
    })

    const [read] = client.video.count.mock.calls[0]
    expect(read.where).toMatchObject({
      slug: "jesus",
      deletedAt: null,
      label: { in: ["SERIES", "COLLECTION"] },
      locales: { some: { status: "PUBLISHED", deletedAt: null } },
      NOT: { restrictViewPlatforms: { has: "watch" } },
    })
    expect(client.experienceLocale.count).not.toHaveBeenCalled()
  })

  it("re-checks an experience destination against its published locale", async () => {
    const client = buildClient({
      status: "TESTED",
      destinationKind: "EXPERIENCE",
      destinationSlug: "easter",
    })

    await schedulePushCampaign(client as never, {
      campaignId: CAMPAIGN,
      actorId: ACTOR,
      sendDate: "2026-10-05",
      localHour: 9,
    })

    const [read] = client.experienceLocale.count.mock.calls[0]
    expect(read.where).toEqual({
      slug: "easter",
      status: "PUBLISHED",
      experience: { archivedAt: null },
    })
    expect(client.video.count).not.toHaveBeenCalled()
  })

  it("logs the schedule with the actor, the campaign, and the audience", async () => {
    const client = buildClient({ status: "TESTED" })
    const log = vi.spyOn(console, "info").mockImplementation(() => {})

    await schedulePushCampaign(client as never, {
      campaignId: CAMPAIGN,
      actorId: ACTOR,
      sendDate: "2026-10-05",
      localHour: 9,
      audienceCount: 1234,
    })

    expect(log).toHaveBeenCalledWith(
      `[push] event=campaign_scheduled campaign=${CAMPAIGN} actor=${ACTOR} mode=wave audience=1234`,
    )
  })
})

describe("push campaign send now", () => {
  it("moves a tested campaign to scheduled in immediate mode", async () => {
    const client = buildClient({ status: "TESTED" })

    await confirmPushSendNow(client as never, {
      campaignId: CAMPAIGN,
      actorId: ACTOR,
    })

    const [update] = client.pushCampaign.updateMany.mock.calls[0]
    expect(update.where).toEqual({ id: CAMPAIGN, status: { in: ["TESTED"] } })
    expect(update.data).toMatchObject({
      status: "SCHEDULED",
      mode: "IMMEDIATE",
      sendDate: null,
      localHour: null,
      lastActorId: ACTOR,
    })
  })

  it("refuses a send now while the campaign is already sending", async () => {
    const client = buildClient({ status: "SENDING" })

    const error = await confirmPushSendNow(client as never, {
      campaignId: CAMPAIGN,
      actorId: ACTOR,
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(PushInvalidTransitionError)
    expect((error as PushInvalidTransitionError).from).toBe("SENDING")
  })

  it("refuses a send now before a test send (AE11)", async () => {
    const client = buildClient({ status: "DRAFT" })

    await expect(
      confirmPushSendNow(client as never, {
        campaignId: CAMPAIGN,
        actorId: ACTOR,
      }),
    ).rejects.toThrowError(PushNotTestedError)
  })

  it("logs the send now with the actor, the campaign, and the audience", async () => {
    const client = buildClient({ status: "TESTED" })
    const log = vi.spyOn(console, "info").mockImplementation(() => {})

    await confirmPushSendNow(client as never, {
      campaignId: CAMPAIGN,
      actorId: ACTOR,
      audienceCount: 7,
    })

    expect(log).toHaveBeenCalledWith(
      `[push] event=campaign_send_now campaign=${CAMPAIGN} actor=${ACTOR} mode=immediate audience=7`,
    )
  })
})

describe("push campaign cancel", () => {
  it.each(["SCHEDULED", "SENDING"] as const)(
    "cancels a campaign that is %s and the zones that have not started (AE12)",
    async (status) => {
      const client = buildClient({ status })

      const result = await cancelPushCampaign(client as never, {
        campaignId: CAMPAIGN,
        actorId: ACTOR,
      })

      expect(result.zonesCancelled).toBe(2)
      expect(client.pushCampaign.updateMany.mock.calls[0][0].where).toEqual({
        id: CAMPAIGN,
        status: { in: ["SCHEDULED", "SENDING"] },
      })
      expect(client.pushCampaignZone.updateMany).toHaveBeenCalledWith({
        where: { campaignId: CAMPAIGN, status: "PENDING" },
        data: { status: "CANCELLED" },
      })
    },
  )

  it.each(["DRAFT", "TESTED", "SENT", "CANCELLED"] as const)(
    "refuses to cancel a campaign that is %s",
    async (status) => {
      const client = buildClient({ status })

      await expect(
        cancelPushCampaign(client as never, {
          campaignId: CAMPAIGN,
          actorId: ACTOR,
        }),
      ).rejects.toThrowError(PushInvalidTransitionError)
      expect(client.pushCampaignZone.updateMany).not.toHaveBeenCalled()
      expect(client.pushDelivery.updateMany).not.toHaveBeenCalled()
    },
  )

  // A reserved row sits inside `push_delivery_daily_claim_key`, so a cancel
  // that left it there would suppress every other campaign to that phone.
  it("retires the rows a cancelled send had only reserved", async () => {
    const client = buildClient({ status: "SENDING" })

    await cancelPushCampaign(client as never, {
      campaignId: CAMPAIGN,
      actorId: ACTOR,
    })

    expect(client.pushDelivery.updateMany).toHaveBeenCalledWith({
      where: { campaignId: CAMPAIGN, kind: "LIVE", status: "RESERVED" },
      data: { status: "MISSED" },
    })
  })
})
