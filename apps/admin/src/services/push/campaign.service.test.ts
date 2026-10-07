import type { PushCampaignStatus } from "@prisma/client"
import { beforeEach, describe, expect, it, vi } from "vitest"

const writePushCampaignContent = vi.hoisted(() => vi.fn())

vi.mock("./campaign-content.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./campaign-content.service")>()),
  writePushCampaignContent,
}))

import {
  PushCampaignNotDeletableError,
  PushFrozenError,
  PushInputError,
  PushInvalidTransitionError,
  PushNotFoundError,
  PushNotTestedError,
  PushStaleContentVersionError,
} from "./errors"
import {
  cancelPushCampaign,
  confirmPushSendNow,
  createPushCampaignDraft,
  deletePushCampaign,
  pinPushTestContentVersion,
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
  contentVersion: number
  lastActorId: string | null
  updatedAt: Date
  copies: { languageSlug: string; title: string; body: string }[]
}

/** Stands in for Prisma's column reference, so a test can name it in a `WHERE`. */
const LAST_TEST_CONTENT_VERSION_FIELD = { name: "lastTestContentVersion" }

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
          contentVersion: 5,
          lastActorId: ACTOR,
          updatedAt: new Date("2026-10-06T09:00:00.000Z"),
          // A pin refusal reads the content select, which always has copies.
          copies: [],
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
      fields: { lastTestContentVersion: LAST_TEST_CONTENT_VERSION_FIELD },
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
  it("saves through the shared content write as the dashboard, with the page's version", async () => {
    const client = buildClient({ status: "DRAFT" })
    const update = { copies: COPY }

    await updatePushCampaign(client as never, {
      campaignId: CAMPAIGN,
      actorId: ACTOR,
      expectedContentVersion: 6,
      update,
    })

    expect(writePushCampaignContent).toHaveBeenCalledWith(client, {
      source: "dashboard",
      campaignId: CAMPAIGN,
      actorId: ACTOR,
      expectedContentVersion: 6,
      update,
    })
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
      lastTestContentVersion: { not: null },
      contentVersion: { equals: LAST_TEST_CONTENT_VERSION_FIELD },
    })
    expect(update.data).toMatchObject({
      status: "TESTED",
      testSentAt: now,
      lastActorId: ACTOR,
    })
  })

  it("pins the test to the page's version in the update that checks it (KTD5)", async () => {
    const client = buildClient({ status: "DRAFT" })

    await pinPushTestContentVersion(client as never, {
      campaignId: CAMPAIGN,
      expectedContentVersion: 5,
    })

    const [update] = client.pushCampaign.updateMany.mock.calls[0]
    expect(update.where).toEqual({
      id: CAMPAIGN,
      status: { in: ["DRAFT", "TESTED"] },
      contentVersion: 5,
    })
    expect(update.data).toEqual({ lastTestContentVersion: 5 })
  })

  it("refuses a pin from a stale page and names the newer version (R34)", async () => {
    const updatedAt = new Date("2026-10-06T10:05:00.000Z")
    const client = buildClient(
      { status: "DRAFT", contentVersion: 6, lastActorId: "agent_1", updatedAt },
      { moved: 0 },
    )

    const pin = pinPushTestContentVersion(client as never, {
      campaignId: CAMPAIGN,
      expectedContentVersion: 5,
    })

    await expect(pin).rejects.toBeInstanceOf(PushStaleContentVersionError)
    await expect(pin).rejects.toMatchObject({
      currentContentVersion: 6,
      lastActorId: "agent_1",
      updatedAt,
    })
  })

  it("names the freeze when a pin finds the campaign already sending", async () => {
    const client = buildClient({ status: "SENDING" }, { moved: 0 })

    await expect(
      pinPushTestContentVersion(client as never, {
        campaignId: CAMPAIGN,
        expectedContentVersion: 5,
      }),
    ).rejects.toBeInstanceOf(PushFrozenError)
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

describe("push campaign delete", () => {
  const NOW = new Date("2026-10-08T11:00:00.000Z")

  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {})
  })
  const LEDGER = "ledger_1"
  const RUNTIME_RUN = "wrun_1"

  type Ledger = {
    status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED"
    runtimeRunId: string | null
    details: { kind: "TEST" | "LIVE" }
    startedAt: Date | null
    createdAt: Date
  }

  function buildDeleteClient(
    options: {
      campaign?: {
        status: PushCampaignStatus
        workflowRunLogId?: string | null
      } | null
      ledger?: Partial<Ledger>
      claimMax?: { localDay: Date | null; createdAt: Date | null }
      /** The size of each page of rows the paged delete reads, in order. */
      pages?: number[]
      /** Rows the conditional campaign delete moves. */
      deleted?: number
      /** Campaign rows that remain when the conditional delete moves none. */
      remaining?: number
      /** The row is gone by the time the transaction reads its snapshot. */
      goneBeforeTransaction?: boolean
    } = {},
  ) {
    const row =
      options.campaign === null
        ? null
        : {
            id: CAMPAIGN,
            workflowRunLogId: options.ledger ? LEDGER : null,
            createdAt: new Date("2026-10-01T09:00:00.000Z"),
            contentVersion: 7,
            destinationKind: "VIDEO",
            destinationSlug: "jesus",
            audienceScope: "COUNTRIES",
            countries: ["MX"],
            languageFilter: ["spanish"],
            copies: [
              { languageSlug: "english", title: "Hello", body: "Watch now" },
            ],
            zones: [
              {
                timeZone: "America/Mexico_City",
                status: "DISPATCHED",
                audienceCount: 40,
              },
            ],
            ...(options.campaign ?? { status: "SENT" as const }),
          }
    const ledger: Ledger | null = options.ledger
      ? {
          status: "SUCCEEDED",
          runtimeRunId: RUNTIME_RUN,
          details: { kind: "LIVE" },
          startedAt: new Date("2026-10-05T09:00:00.000Z"),
          createdAt: new Date("2026-10-05T09:00:00.000Z"),
          ...options.ledger,
        }
      : null
    const pages = [...(options.pages ?? [])]
    const client = {
      pushCampaign: {
        // Only the transaction's snapshot read selects the copy rows.
        findUnique: vi.fn(async (args: { select: { copies?: unknown } }) =>
          args.select.copies && options.goneBeforeTransaction ? null : row,
        ),
        deleteMany: vi.fn(async (_args: PrismaCallArgs) => ({
          count: options.deleted ?? 1,
        })),
        count: vi.fn(async (_args: PrismaCallArgs) => options.remaining ?? 1),
      },
      workflowRun: {
        findUnique: vi.fn(async (_args: PrismaCallArgs) => ledger),
        create: vi.fn(async (_args: PrismaCallArgs) => ({ id: "audit_1" })),
      },
      pushDelivery: {
        aggregate: vi.fn(async (_args: PrismaCallArgs) => ({
          _max: options.claimMax ?? { localDay: null, createdAt: null },
        })),
        findMany: vi.fn(async (_args: PrismaCallArgs) =>
          Array.from({ length: pages.shift() ?? 0 }, (_, index) => ({
            id: `delivery_${index}`,
          })),
        ),
        deleteMany: vi.fn(
          async (args: { where: { id?: { in: string[] } } }) => ({
            count: args.where.id ? args.where.id.in.length : 2,
          }),
        ),
      },
      pushOpen: {
        deleteMany: vi.fn(async (_args: PrismaCallArgs) => ({ count: 1 })),
      },
      pushAttribution: {
        deleteMany: vi.fn(async (_args: PrismaCallArgs) => ({ count: 1 })),
      },
      $transaction: vi.fn(async (run: (tx: unknown) => unknown) => run(client)),
    }
    return client
  }

  function remove(
    client: ReturnType<typeof buildDeleteClient>,
    liveness: "alive" | "terminal" | "unknown" = "terminal",
  ) {
    const readRuntimeLiveness = vi.fn(async (_runtimeRunId: string) => liveness)
    const result = deletePushCampaign(
      client as never,
      { campaignId: CAMPAIGN, actorId: ACTOR },
      { now: () => NOW, readRuntimeLiveness },
    )
    return { result, readRuntimeLiveness }
  }

  function expectNothingDeleted(client: ReturnType<typeof buildDeleteClient>) {
    expect(client.pushDelivery.deleteMany).not.toHaveBeenCalled()
    expect(client.$transaction).not.toHaveBeenCalled()
  }

  it.each(["DRAFT", "TESTED", "SENT", "PAUSED", "CANCELLED"] as const)(
    "deletes a campaign that is %s",
    async (status) => {
      const client = buildDeleteClient({ campaign: { status } })
      await expect(remove(client).result).resolves.toBeDefined()
      expect(client.pushCampaign.deleteMany).toHaveBeenCalledTimes(1)
    },
  )

  it.each(["SCHEDULED", "SENDING"] as const)(
    "asks for a cancel before it deletes a campaign that is %s",
    async (status) => {
      const client = buildDeleteClient({ campaign: { status } })
      await expect(remove(client).result).rejects.toThrowError(
        /Cancel it first/,
      )
      expectNothingDeleted(client)
    },
  )

  it("says a missing campaign does not exist", async () => {
    const client = buildDeleteClient({ campaign: null })
    await expect(remove(client).result).rejects.toThrowError(PushNotFoundError)
    expectNothingDeleted(client)
  })

  it("waits for a test that still collects receipts and names until when", async () => {
    const client = buildDeleteClient({
      campaign: { status: "TESTED" },
      ledger: {
        status: "RUNNING",
        details: { kind: "TEST" },
        startedAt: new Date("2026-10-08T10:50:00.000Z"),
      },
    })
    await expect(remove(client).result).rejects.toThrowError(
      "The last test is still collecting receipts until about 11:05 UTC. Delete the campaign after that.",
    )
    expectNothingDeleted(client)
  })

  it("deletes past a test ledger left running when the runtime says the run ended", async () => {
    const client = buildDeleteClient({
      campaign: { status: "TESTED" },
      ledger: {
        status: "RUNNING",
        details: { kind: "TEST" },
        startedAt: new Date("2026-10-08T09:00:00.000Z"),
      },
    })
    const { result, readRuntimeLiveness } = remove(client, "terminal")
    await expect(result).resolves.toBeDefined()
    expect(readRuntimeLiveness).toHaveBeenCalledWith(RUNTIME_RUN)
  })

  it.each(["alive", "unknown"] as const)(
    "waits while the runtime calls a running send %s",
    async (liveness) => {
      const client = buildDeleteClient({
        campaign: { status: "CANCELLED" },
        ledger: { status: "RUNNING" },
      })
      const { result, readRuntimeLiveness } = remove(client, liveness)
      await expect(result).rejects.toThrowError(PushCampaignNotDeletableError)
      expect(readRuntimeLiveness).toHaveBeenCalledWith(RUNTIME_RUN)
      expectNothingDeleted(client)
    },
  )

  // The recovery sweep pauses a campaign whose run died without its own
  // failure step, and that run's ledger row still reads running.
  it("deletes a paused campaign whose dead run left its ledger running", async () => {
    const client = buildDeleteClient({
      campaign: { status: "PAUSED" },
      ledger: { status: "RUNNING" },
    })
    await expect(remove(client, "terminal").result).resolves.toBeDefined()
    expect(client.pushCampaign.deleteMany).toHaveBeenCalledTimes(1)
  })

  it("asks no runtime about a ledger that already finished", async () => {
    const client = buildDeleteClient({ ledger: { status: "SUCCEEDED" } })
    const { result, readRuntimeLiveness } = remove(client, "alive")
    await expect(result).resolves.toBeDefined()
    expect(readRuntimeLiveness).not.toHaveBeenCalled()
  })

  it("waits until the last local day of its live rows has ended in every zone (KTD3)", async () => {
    const client = buildDeleteClient({
      claimMax: {
        localDay: new Date("2026-10-07T00:00:00.000Z"),
        createdAt: new Date("2026-10-07T10:00:00.000Z"),
      },
    })
    await expect(remove(client).result).rejects.toThrowError(
      "Delete it after 2026-10-08 12:00 UTC.",
    )
    expectNothingDeleted(client)
    expect(client.pushDelivery.aggregate.mock.calls[0]?.[0].where).toEqual({
      campaignId: CAMPAIGN,
      kind: "LIVE",
      status: {
        in: ["RESERVED", "SENDING", "ACCEPTED", "HANDED_OFF", "UNKNOWN"],
      },
    })
  })

  it("waits for the 20-hour zone guard when it ends later, rounded up to the minute", async () => {
    // A UTC-12 phone claimed at 21:30:30 local on its 7 October.
    const client = buildDeleteClient({
      claimMax: {
        localDay: new Date("2026-10-07T00:00:00.000Z"),
        createdAt: new Date("2026-10-08T09:30:30.000Z"),
      },
    })
    await expect(remove(client).result).rejects.toThrowError(
      "Delete it after 2026-10-09 05:31 UTC.",
    )
  })

  it("deletes once every phone's day has ended", async () => {
    const client = buildDeleteClient({
      claimMax: {
        localDay: new Date("2026-10-06T00:00:00.000Z"),
        createdAt: new Date("2026-10-06T10:00:00.000Z"),
      },
    })
    await expect(remove(client).result).resolves.toBeDefined()
  })

  it("deletes a settled campaign's rows in pages before the transaction", async () => {
    const client = buildDeleteClient({
      campaign: { status: "SENT", workflowRunLogId: LEDGER },
      ledger: { status: "SUCCEEDED" },
      pages: [5_000, 3],
    })

    const { deliveriesDeleted } = await remove(client).result

    expect(client.pushDelivery.findMany).toHaveBeenCalledTimes(3)
    expect(client.pushDelivery.findMany.mock.calls[0]?.[0]).toEqual({
      where: { campaignId: CAMPAIGN },
      select: { id: true },
      orderBy: { id: "asc" },
      take: 5_000,
    })
    // 5,003 in pages, then the 2 the transaction found.
    expect(deliveriesDeleted).toBe(5_005)
  })

  // A concurrent delete can take a page first: the loop reads again and stays
  // on short pages, so no single statement deletes every remaining row.
  it("keeps paging after a page that another delete already removed", async () => {
    const client = buildDeleteClient({ pages: [2, 2] })
    client.pushDelivery.deleteMany.mockImplementationOnce(async () => ({
      count: 0,
    }))

    const { deliveriesDeleted } = await remove(client).result

    expect(client.pushDelivery.findMany).toHaveBeenCalledTimes(3)
    // 0 from the taken page, 2 from the next, then 2 in the transaction.
    expect(deliveriesDeleted).toBe(4)
  })

  it("leaves a draft's test rows to the transaction", async () => {
    const client = buildDeleteClient({ campaign: { status: "TESTED" } })
    const { deliveriesDeleted } = await remove(client).result
    expect(client.pushDelivery.findMany).not.toHaveBeenCalled()
    expect(deliveriesDeleted).toBe(2)
  })

  // Deliveries go first, as the pages do, so two deletes lock rows in one order.
  it("deletes the report rows before the campaign, which their keys restrict", async () => {
    const client = buildDeleteClient()
    await remove(client).result
    const order = [
      client.pushDelivery.deleteMany,
      client.pushAttribution.deleteMany,
      client.pushOpen.deleteMany,
      client.pushCampaign.deleteMany,
      client.workflowRun.create,
    ].map((spy) => spy.mock.invocationCallOrder[0])
    expect(order).toEqual([...order].sort((a, b) => (a ?? 0) - (b ?? 0)))
    expect(client.pushOpen.deleteMany).toHaveBeenCalledWith({
      where: { campaignId: CAMPAIGN },
    })
  })

  it("deletes the campaign only while its status, run, and content are the ones read", async () => {
    const client = buildDeleteClient({
      campaign: { status: "TESTED", workflowRunLogId: LEDGER },
      ledger: { status: "SUCCEEDED", details: { kind: "TEST" } },
    })
    await remove(client).result
    expect(client.pushCampaign.deleteMany).toHaveBeenCalledWith({
      where: {
        id: CAMPAIGN,
        status: "TESTED",
        workflowRunLogId: LEDGER,
        contentVersion: 7,
      },
    })
  })

  it("rolls back when a schedule or a new run changed the campaign after the gate read", async () => {
    const client = buildDeleteClient({
      campaign: { status: "TESTED" },
      deleted: 0,
    })
    await expect(remove(client).result).rejects.toThrowError(
      /changed during the delete/,
    )
    expect(client.workflowRun.create).not.toHaveBeenCalled()
  })

  // Two tabs: the first delete commits, so the second's conditional delete
  // finds no row, which is the outcome the second caller wanted.
  it("reads as not found when another delete removed the campaign first", async () => {
    const client = buildDeleteClient({ deleted: 0, remaining: 0 })
    await expect(remove(client).result).rejects.toThrowError(PushNotFoundError)
    expect(client.workflowRun.create).not.toHaveBeenCalled()
  })

  it("reads as not found when the row is gone before the transaction starts", async () => {
    const client = buildDeleteClient({ goneBeforeTransaction: true })
    await expect(remove(client).result).rejects.toThrowError(PushNotFoundError)
    expect(client.pushCampaign.deleteMany).not.toHaveBeenCalled()
  })

  it("keeps an audit row with the copy that went out and the person who deleted it", async () => {
    const client = buildDeleteClient({
      campaign: { status: "SENT" },
      pages: [3],
    })

    await remove(client).result

    expect(client.workflowRun.create).toHaveBeenCalledTimes(1)
    const data = client.workflowRun.create.mock.calls[0]?.[0].data
    expect(data).toMatchObject({
      workflowKey: "push-campaign-delete",
      trigger: "MANUAL",
      actorId: ACTOR,
      subjectType: "push-campaign",
      subjectId: CAMPAIGN,
      status: "SUCCEEDED",
      startedAt: NOW,
      finishedAt: NOW,
    })
    expect(data?.details).toMatchObject({
      status: "SENT",
      createdAt: "2026-10-01T09:00:00.000Z",
      contentVersion: 7,
      destinationKind: "VIDEO",
      destinationSlug: "jesus",
      audienceScope: "COUNTRIES",
      countries: ["MX"],
      languageFilter: ["spanish"],
      copies: [{ languageSlug: "english", title: "Hello", body: "Watch now" }],
      zones: [
        {
          timeZone: "America/Mexico_City",
          status: "DISPATCHED",
          audienceCount: 40,
        },
      ],
      // 3 in pages, then the 2 the transaction found.
      deliveriesDeleted: 5,
    })
  })

  it("logs the delete with the actor, the status, and the row count", async () => {
    await remove(buildDeleteClient({ campaign: { status: "SENT" } })).result
    expect(console.info).toHaveBeenCalledWith(
      `[push] event=campaign_deleted campaign=${CAMPAIGN} actor=${ACTOR} status=sent deliveries=2`,
    )
  })
})
