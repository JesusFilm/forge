/**
 * KTD2 — the dispatch order, the run lifecycle, and the kill switch.
 *
 * `workflow/api` is mocked, because a `"use workflow"` function is inert in
 * tests and a resolver that forgot `start()` would otherwise pass. The campaign
 * service is mocked too: its own transitions are proven in its own suite.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { wrapStartSpy } from "@/test-helpers/workflow-dispatch"

const { start } = vi.hoisted(() => ({ start: vi.fn() }))
vi.mock("workflow/api", () => ({ start }))

const campaignService = vi.hoisted(() => ({
  schedulePushCampaign: vi.fn(async () => undefined),
  confirmPushSendNow: vi.fn(async () => undefined),
  cancelPushCampaign: vi.fn(async () => ({ zonesCancelled: 2 })),
  recordPushTestSend: vi.fn(async () => ({
    id: "campaign-1",
    status: "TESTED",
  })),
}))
vi.mock("./campaign.service", () => campaignService)

const zoneSchedule = vi.hoisted(() => ({
  readPushCampaignZoneCounts: vi.fn(async () => [
    { timeZone: "Pacific/Auckland", registrations: 3 },
    { timeZone: "Asia/Dubai", registrations: 5 },
  ]),
}))
vi.mock("./zone-schedule", async (importOriginal) => {
  const original = await importOriginal<typeof import("./zone-schedule")>()
  return { ...original, ...zoneSchedule }
})

vi.mock("@/db/client", () => ({ prisma: { id: "shared" } }))

// The cancel event is the assertion, not a side effect to tolerate: the run's
// own gate is what ends a wave that already dispatched a group.
const runtime = vi.hoisted(() => {
  const world = {
    runs: { get: vi.fn(async () => ({ specVersion: 2 })) },
    events: { create: vi.fn(async () => ({})) },
  }
  return { world, getWorld: vi.fn(() => world) }
})
vi.mock("workflow/runtime", () => ({ getWorld: runtime.getWorld }))

const {
  PUSH_CAMPAIGN_WORKFLOW_KEY,
  cancelPushCampaignRun,
  dispatchPushCampaignRun,
  failPushCampaignRun,
  finishPushCampaignRun,
  planPushCampaignZones,
  readNextPushZoneGroup,
  readPushCampaignRunState,
  schedulePushCampaignRun,
  sendPushCampaignNowRun,
  sendPushCampaignTestRun,
  startPushCampaignRun,
} = await import("./dispatch")
const { PushCampaignsDisabledError, PushRunAlreadyActiveError } =
  await import("./errors")
const { runPushCampaign } = await import("@/workflows/pushCampaign")

const CAMPAIGN_ID = "campaign-1"
const NOW = new Date("2026-10-01T09:00:00.000Z")

type FakeState = {
  campaign: Record<string, unknown> | null
  ledger: Record<string, unknown> | null
  pendingZones: { timeZone: string; scheduledAt: Date }[]
  /** What `pushCampaignZone.count` answers: the dispatching or dispatched set. */
  dispatchedZones: number
  /** What a `pushDelivery.updateMany` reports it moved. */
  deliveriesMoved: number
}

type FakeCalls = {
  ledgerCreates: Record<string, unknown>[]
  ledgerUpdates: { id: string; data: Record<string, unknown> }[]
  campaignUpdates: {
    where: Record<string, unknown>
    data: Record<string, unknown>
  }[]
  zoneCreates: Record<string, unknown>[][]
  zoneUpdates: {
    where: Record<string, unknown>
    data: Record<string, unknown>
  }[]
  deliveryUpdates: {
    where: Record<string, unknown>
    data: Record<string, unknown>
  }[]
  ledgerUpdateManys: {
    where: Record<string, unknown>
    data: Record<string, unknown>
  }[]
}

function fakePrisma(state: Partial<FakeState> = {}) {
  const store: FakeState = {
    campaign: {
      id: CAMPAIGN_ID,
      status: "SCHEDULED",
      workflowRunLogId: null,
      lastError: null,
      mode: "WAVE",
      sendDate: new Date("2026-10-02T00:00:00.000Z"),
      localHour: 9,
      audienceScope: "EVERYWHERE",
      countries: [],
      languageFilter: [],
    },
    ledger: null,
    pendingZones: [],
    dispatchedZones: 0,
    deliveriesMoved: 0,
    ...state,
  }
  const calls: FakeCalls = {
    ledgerCreates: [],
    ledgerUpdates: [],
    campaignUpdates: [],
    zoneCreates: [],
    zoneUpdates: [],
    deliveryUpdates: [],
    ledgerUpdateManys: [],
  }
  let ledgerSeq = 0
  const prisma = {
    workflowRun: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        ledgerSeq += 1
        calls.ledgerCreates.push(data)
        store.ledger = { id: `ledger-${ledgerSeq}`, ...data }
        return store.ledger
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string }
          data: Record<string, unknown>
        }) => {
          calls.ledgerUpdates.push({ id: where.id, data })
          store.ledger = { ...(store.ledger ?? {}), ...data }
          return store.ledger
        },
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>
          data: Record<string, unknown>
        }) => {
          calls.ledgerUpdateManys.push({ where, data })
          if (store.ledger) store.ledger = { ...store.ledger, ...data }
          return { count: 1 }
        },
      ),
      findUnique: vi.fn(async () => store.ledger),
      findMany: vi.fn(async () => (store.ledger ? [store.ledger] : [])),
    },
    pushCampaign: {
      findUnique: vi.fn(async () => store.campaign),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>
          data: Record<string, unknown>
        }) => {
          calls.campaignUpdates.push({ where, data })
          if (store.campaign) store.campaign = { ...store.campaign, ...data }
          return { count: 1 }
        },
      ),
    },
    pushCampaignZone: {
      count: vi.fn(async () => store.dispatchedZones),
      createMany: vi.fn(
        async ({ data }: { data: Record<string, unknown>[] }) => {
          calls.zoneCreates.push(data)
          return { count: data.length }
        },
      ),
      findMany: vi.fn(async ({ where, take }: Record<string, never>) => {
        const scheduledAt = (where as Record<string, unknown>).scheduledAt as
          | Date
          | undefined
        const rows = store.pendingZones.filter(
          (zone) =>
            scheduledAt === undefined ||
            zone.scheduledAt.getTime() === scheduledAt.getTime(),
        )
        const sorted = [...rows].sort(
          (left, right) =>
            left.scheduledAt.getTime() - right.scheduledAt.getTime(),
        )
        return take ? sorted.slice(0, take as number) : sorted
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>
          data: Record<string, unknown>
        }) => {
          calls.zoneUpdates.push({ where, data })
          const scheduledAt = where.scheduledAt as Date | undefined
          const before = store.pendingZones.length
          store.pendingZones = store.pendingZones.filter(
            (zone) =>
              scheduledAt !== undefined &&
              zone.scheduledAt.getTime() !== scheduledAt.getTime(),
          )
          return { count: before - store.pendingZones.length }
        },
      ),
    },
    pushDelivery: {
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>
          data: Record<string, unknown>
        }) => {
          calls.deliveryUpdates.push({ where, data })
          return { count: store.deliveriesMoved }
        },
      ),
    },
  }
  return { prisma: prisma as never, spies: prisma, calls, store }
}

const dispatch = wrapStartSpy<never>(start)

beforeEach(() => {
  start.mockReset()
  campaignService.schedulePushCampaign.mockClear()
  campaignService.confirmPushSendNow.mockClear()
  campaignService.cancelPushCampaign.mockClear()
  campaignService.recordPushTestSend.mockClear()
  runtime.world.events.create.mockClear()
  runtime.world.runs.get.mockClear()
  vi.spyOn(console, "info").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("dispatchPushCampaignRun", () => {
  it("creates the ledger row before it starts the run", async () => {
    const { prisma, spies, calls } = fakePrisma()
    start.mockResolvedValueOnce({
      runId: "runtime-1",
      returnValue: Promise.resolve(undefined),
    })

    const result = await dispatchPushCampaignRun(
      { campaignId: CAMPAIGN_ID, actorId: "actor-1", kind: "LIVE" },
      { prisma, campaignsEnabled: true },
    )

    expect(calls.ledgerCreates[0]).toMatchObject({
      workflowKey: PUSH_CAMPAIGN_WORKFLOW_KEY,
      trigger: "MANUAL",
      actorId: "actor-1",
      subjectType: "push-campaign",
      subjectId: CAMPAIGN_ID,
    })
    expect(spies.workflowRun.create.mock.invocationCallOrder[0]).toBeLessThan(
      start.mock.invocationCallOrder[0],
    )
    expect(result).toMatchObject({
      workflowRunLogId: "ledger-1",
      runtimeRunId: "runtime-1",
      kind: "LIVE",
    })
  })

  it("dispatches through start, with the campaign and ledger ids", async () => {
    const { prisma } = fakePrisma()
    start.mockResolvedValueOnce({
      runId: "runtime-1",
      returnValue: Promise.resolve(undefined),
    })

    await dispatchPushCampaignRun(
      { campaignId: CAMPAIGN_ID, actorId: "actor-1", kind: "TEST" },
      { prisma, campaignsEnabled: true },
    )

    dispatch.expectDispatched(runPushCampaign, [
      { campaignId: CAMPAIGN_ID, ledgerRunId: "ledger-1", kind: "TEST" },
    ])
  })

  it("attaches the runtime run id to the ledger row", async () => {
    const { prisma, calls } = fakePrisma()
    start.mockResolvedValueOnce({
      runId: "runtime-7",
      returnValue: Promise.resolve(undefined),
    })

    await dispatchPushCampaignRun(
      { campaignId: CAMPAIGN_ID, actorId: "actor-1", kind: "LIVE" },
      { prisma, campaignsEnabled: true },
    )

    expect(calls.ledgerUpdates).toEqual([
      { id: "ledger-1", data: { runtimeRunId: "runtime-7" } },
    ])
  })

  it("marks the ledger failed and reverts the campaign when the start fails", async () => {
    const { prisma, calls } = fakePrisma()
    start.mockRejectedValueOnce(new Error("queue unavailable"))

    await expect(
      dispatchPushCampaignRun(
        { campaignId: CAMPAIGN_ID, actorId: "actor-1", kind: "LIVE" },
        { prisma, campaignsEnabled: true },
      ),
    ).rejects.toThrow("queue unavailable")

    expect(calls.ledgerUpdates.at(-1)?.data).toMatchObject({
      status: "FAILED",
      error: "queue unavailable",
    })
    const revert = calls.campaignUpdates.at(-1)
    expect(revert?.where).toMatchObject({ status: "SCHEDULED" })
    expect(revert?.data).toMatchObject({
      status: "TESTED",
      lastError: "queue unavailable",
      workflowRunLogId: null,
    })
  })

  it("does not revert a draft campaign when a test send fails to start", async () => {
    const { prisma, calls } = fakePrisma()
    start.mockRejectedValueOnce(new Error("queue unavailable"))

    await expect(
      dispatchPushCampaignRun(
        { campaignId: CAMPAIGN_ID, actorId: "actor-1", kind: "TEST" },
        { prisma, campaignsEnabled: true },
      ),
    ).rejects.toThrow("queue unavailable")

    expect(
      calls.campaignUpdates.filter((update) => update.data.status === "TESTED"),
    ).toEqual([])
  })
})

describe("the kill switch", () => {
  it.each([
    [
      "schedule",
      () =>
        schedulePushCampaignRun(
          {
            campaignId: CAMPAIGN_ID,
            actorId: "actor-1",
            sendDate: "2026-10-02",
            localHour: 9,
          },
          { prisma: fakePrisma().prisma, campaignsEnabled: false },
        ),
    ],
    [
      "send now",
      () =>
        sendPushCampaignNowRun(
          { campaignId: CAMPAIGN_ID, actorId: "actor-1" },
          { prisma: fakePrisma().prisma, campaignsEnabled: false },
        ),
    ],
    [
      "test send",
      () =>
        sendPushCampaignTestRun(
          { campaignId: CAMPAIGN_ID, actorId: "actor-1" },
          { prisma: fakePrisma().prisma, campaignsEnabled: false },
        ),
    ],
  ])("refuses to %s while the flag is off", async (_name, act) => {
    await expect(act()).rejects.toBeInstanceOf(PushCampaignsDisabledError)
    dispatch.expectNotDispatched()
  })
})

describe("one run per campaign", () => {
  it("refuses a second dispatch while a run is still queued", async () => {
    const { prisma } = fakePrisma({
      campaign: {
        id: CAMPAIGN_ID,
        status: "SCHEDULED",
        workflowRunLogId: "ledger-existing",
        lastError: null,
      },
      ledger: { id: "ledger-existing", status: "RUNNING" },
    })

    await expect(
      sendPushCampaignTestRun(
        { campaignId: CAMPAIGN_ID, actorId: "actor-1" },
        { prisma, campaignsEnabled: true },
      ),
    ).rejects.toBeInstanceOf(PushRunAlreadyActiveError)
    dispatch.expectNotDispatched()
  })

  it("allows a dispatch once the earlier run has finished", async () => {
    const { prisma } = fakePrisma({
      campaign: {
        id: CAMPAIGN_ID,
        status: "TESTED",
        workflowRunLogId: "ledger-old",
        lastError: null,
      },
      ledger: { id: "ledger-old", status: "SUCCEEDED" },
    })
    start.mockResolvedValueOnce({
      runId: "runtime-2",
      returnValue: Promise.resolve(undefined),
    })

    await expect(
      sendPushCampaignTestRun(
        { campaignId: CAMPAIGN_ID, actorId: "actor-1" },
        { prisma, campaignsEnabled: true },
      ),
    ).resolves.toMatchObject({ runtimeRunId: "runtime-2" })
  })
})

describe("the editor's three entry points", () => {
  it("schedules first, then dispatches the wave", async () => {
    const { prisma } = fakePrisma()
    start.mockResolvedValueOnce({
      runId: "runtime-1",
      returnValue: Promise.resolve(undefined),
    })

    await schedulePushCampaignRun(
      {
        campaignId: CAMPAIGN_ID,
        actorId: "actor-1",
        sendDate: "2026-10-02",
        localHour: 9,
        audienceCount: 42,
      },
      { prisma, campaignsEnabled: true },
    )

    expect(campaignService.schedulePushCampaign).toHaveBeenCalledOnce()
    expect(
      campaignService.schedulePushCampaign.mock.invocationCallOrder[0],
    ).toBeLessThan(start.mock.invocationCallOrder[0])
  })

  it("confirms the send now first, then dispatches one immediate run", async () => {
    const { prisma, calls } = fakePrisma()
    start.mockResolvedValueOnce({
      runId: "runtime-1",
      returnValue: Promise.resolve(undefined),
    })

    await sendPushCampaignNowRun(
      { campaignId: CAMPAIGN_ID, actorId: "actor-1", audienceCount: 9 },
      { prisma, campaignsEnabled: true },
    )

    expect(campaignService.confirmPushSendNow).toHaveBeenCalledOnce()
    expect(calls.ledgerCreates[0]).toMatchObject({
      details: { kind: "LIVE", mode: "IMMEDIATE", audienceCount: 9 },
    })
  })

  it("dispatches a test send without touching the campaign status", async () => {
    const { prisma } = fakePrisma()
    start.mockResolvedValueOnce({
      runId: "runtime-1",
      returnValue: Promise.resolve(undefined),
    })

    await sendPushCampaignTestRun(
      { campaignId: CAMPAIGN_ID, actorId: "actor-1" },
      { prisma, campaignsEnabled: true },
    )

    expect(campaignService.schedulePushCampaign).not.toHaveBeenCalled()
    expect(campaignService.confirmPushSendNow).not.toHaveBeenCalled()
    expect(campaignService.recordPushTestSend).not.toHaveBeenCalled()
  })

  it("cancels through the campaign service, whatever the runtime answers", async () => {
    const { prisma } = fakePrisma({
      campaign: {
        id: CAMPAIGN_ID,
        status: "SENDING",
        workflowRunLogId: "ledger-1",
        lastError: null,
      },
      ledger: { id: "ledger-1", runtimeRunId: "runtime-1", status: "RUNNING" },
    })

    await expect(
      cancelPushCampaignRun(
        { campaignId: CAMPAIGN_ID, actorId: "actor-1" },
        { prisma },
      ),
    ).resolves.toEqual({ zonesCancelled: 2 })
    expect(campaignService.cancelPushCampaign).toHaveBeenCalledOnce()
  })
})

/**
 * The runtime's cancel event makes the run terminal, so every later step is
 * refused. Which branch the cancel takes is therefore the whole correctness
 * question: an event on a wave that already dispatched a group loses its
 * receipts, and no event on a wave that dispatched nothing leaves the ledger
 * running for good.
 */
describe("the cancel event", () => {
  function cancelling(dispatchedZones: number) {
    return fakePrisma({
      campaign: {
        id: CAMPAIGN_ID,
        status: "SENDING",
        workflowRunLogId: "ledger-1",
        lastError: null,
      },
      ledger: { id: "ledger-1", runtimeRunId: "runtime-1", status: "RUNNING" },
      dispatchedZones,
    })
  }

  it("emits it and closes the ledger when no group was dispatched", async () => {
    const { prisma, calls } = cancelling(0)

    await cancelPushCampaignRun(
      { campaignId: CAMPAIGN_ID, actorId: "actor-1" },
      { prisma, now: () => NOW },
    )

    expect(runtime.world.events.create).toHaveBeenCalledWith("runtime-1", {
      eventType: "run_cancelled",
      specVersion: 2,
    })
    expect(calls.ledgerUpdateManys).toHaveLength(1)
    expect(calls.ledgerUpdateManys[0].where).toEqual({
      id: "ledger-1",
      status: { in: ["QUEUED", "RUNNING"] },
    })
    expect(calls.ledgerUpdateManys[0].data).toMatchObject({
      status: "CANCELLED",
      finishedAt: NOW,
    })
  })

  it("withholds it once a zone is dispatching, so the run still reconciles", async () => {
    const { prisma, calls } = cancelling(1)
    const logs: string[] = []
    vi.spyOn(console, "info").mockImplementation((line: unknown) => {
      logs.push(String(line))
    })

    await cancelPushCampaignRun(
      { campaignId: CAMPAIGN_ID, actorId: "actor-1" },
      { prisma, now: () => NOW },
    )

    expect(runtime.world.events.create).not.toHaveBeenCalled()
    expect(calls.ledgerUpdateManys).toEqual([])
    expect(
      logs.some((line) => line.includes("event=run_cancel_deferred")),
    ).toBe(true)
  })

  it("counts a dispatched zone as owed receipts too", async () => {
    const { prisma, spies } = cancelling(0)

    await cancelPushCampaignRun(
      { campaignId: CAMPAIGN_ID, actorId: "actor-1" },
      { prisma, now: () => NOW },
    )

    expect(spies.pushCampaignZone.count).toHaveBeenCalledWith({
      where: {
        campaignId: CAMPAIGN_ID,
        status: { in: ["DISPATCHING", "DISPATCHED"] },
      },
    })
  })

  it("leaves the ledger alone when the campaign never had a run", async () => {
    const { prisma, calls } = fakePrisma({
      campaign: {
        id: CAMPAIGN_ID,
        status: "SCHEDULED",
        workflowRunLogId: null,
        lastError: null,
      },
    })

    await cancelPushCampaignRun(
      { campaignId: CAMPAIGN_ID, actorId: "actor-1" },
      { prisma, now: () => NOW },
    )

    expect(runtime.world.events.create).not.toHaveBeenCalled()
    expect(calls.ledgerUpdateManys).toEqual([])
  })
})

describe("planPushCampaignZones", () => {
  it("writes one row per zone at the wave's own instant", async () => {
    const { prisma, calls } = fakePrisma()

    const groupCount = await planPushCampaignZones(
      { campaignId: CAMPAIGN_ID },
      { prisma, now: () => NOW },
    )

    expect(groupCount).toBe(2)
    const rows = calls.zoneCreates[0]
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.timeZone).sort()).toEqual([
      "Asia/Dubai",
      "Pacific/Auckland",
    ])
    expect(rows.every((row) => row.audienceCount !== 0)).toBe(true)
  })

  it("puts every zone on one instant for a send now", async () => {
    const { prisma, calls } = fakePrisma({
      campaign: {
        id: CAMPAIGN_ID,
        status: "SCHEDULED",
        workflowRunLogId: null,
        lastError: null,
        mode: "IMMEDIATE",
        sendDate: null,
        localHour: null,
        audienceScope: "EVERYWHERE",
        countries: [],
        languageFilter: [],
      },
    })

    const groupCount = await planPushCampaignZones(
      { campaignId: CAMPAIGN_ID },
      { prisma, now: () => NOW },
    )

    expect(groupCount).toBe(1)
    const rows = calls.zoneCreates[0]
    expect(
      new Set(rows.map((row) => (row.scheduledAt as Date).getTime())),
    ).toEqual(new Set([NOW.getTime()]))
  })

  it("skips a row it already wrote, so a replay keeps the planned instants", async () => {
    const { prisma, spies } = fakePrisma()

    await planPushCampaignZones(
      { campaignId: CAMPAIGN_ID },
      { prisma, now: () => NOW },
    )

    expect(spies.pushCampaignZone.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    )
  })
})

describe("readNextPushZoneGroup", () => {
  it("returns the earliest pending group", async () => {
    const early = new Date("2026-10-02T00:00:00.000Z")
    const late = new Date("2026-10-02T03:00:00.000Z")
    const { prisma } = fakePrisma({
      campaign: {
        id: CAMPAIGN_ID,
        status: "SENDING",
        workflowRunLogId: null,
        lastError: null,
      },
      pendingZones: [
        { timeZone: "Asia/Tokyo", scheduledAt: late },
        { timeZone: "Pacific/Auckland", scheduledAt: early },
      ],
    })

    const next = await readNextPushZoneGroup(
      { campaignId: CAMPAIGN_ID },
      { prisma, now: () => new Date("2026-10-01T23:00:00.000Z") },
    )

    expect(next).toEqual({
      kind: "group",
      instant: early.toISOString(),
      zoneCount: 1,
    })
  })

  it("retires a late group instead of sleeping into the past, then returns the next", async () => {
    const stale = new Date("2026-10-01T00:00:00.000Z")
    const fresh = new Date("2026-10-01T08:30:00.000Z")
    const { prisma, calls } = fakePrisma({
      campaign: {
        id: CAMPAIGN_ID,
        status: "SENDING",
        workflowRunLogId: null,
        lastError: null,
      },
      pendingZones: [
        { timeZone: "Pacific/Auckland", scheduledAt: stale },
        { timeZone: "Asia/Tokyo", scheduledAt: fresh },
      ],
    })

    const next = await readNextPushZoneGroup(
      { campaignId: CAMPAIGN_ID },
      { prisma, now: () => NOW },
    )

    expect(calls.zoneUpdates[0].data).toMatchObject({ status: "MISSED" })
    expect(next).toEqual({
      kind: "group",
      instant: fresh.toISOString(),
      zoneCount: 1,
    })
  })

  it("reports the campaign ended once it leaves the sending statuses", async () => {
    const { prisma } = fakePrisma({
      campaign: {
        id: CAMPAIGN_ID,
        status: "CANCELLED",
        workflowRunLogId: null,
        lastError: null,
      },
    })

    await expect(
      readNextPushZoneGroup(
        { campaignId: CAMPAIGN_ID },
        { prisma, now: () => NOW },
      ),
    ).resolves.toEqual({ kind: "ended", status: "CANCELLED" })
  })

  it("reports no group when every zone is done", async () => {
    const { prisma } = fakePrisma({
      campaign: {
        id: CAMPAIGN_ID,
        status: "SENDING",
        workflowRunLogId: null,
        lastError: null,
      },
      pendingZones: [],
    })

    await expect(
      readNextPushZoneGroup(
        { campaignId: CAMPAIGN_ID },
        { prisma, now: () => NOW },
      ),
    ).resolves.toEqual({ kind: "none" })
  })
})

describe("startPushCampaignRun", () => {
  it("marks the ledger running and plans the zones for a live run", async () => {
    const { prisma, calls } = fakePrisma()

    const result = await startPushCampaignRun(
      {
        campaignId: CAMPAIGN_ID,
        ledgerRunId: "ledger-1",
        kind: "LIVE",
        runtimeRunId: "runtime-1",
      },
      { prisma, now: () => NOW },
    )

    expect(result).toEqual({ kind: "LIVE", groupCount: 2 })
    expect(calls.ledgerUpdates[0].data).toMatchObject({ status: "RUNNING" })
    expect(calls.zoneCreates).toHaveLength(1)
  })

  it("plans no zone for a test run", async () => {
    const { prisma, calls } = fakePrisma()

    const result = await startPushCampaignRun(
      { campaignId: CAMPAIGN_ID, ledgerRunId: "ledger-1", kind: "TEST" },
      { prisma, now: () => NOW },
    )

    expect(result).toEqual({ kind: "TEST", groupCount: 0 })
    expect(calls.zoneCreates).toEqual([])
  })
})

describe("finishPushCampaignRun", () => {
  const counts = {
    accepted: 4,
    failed: 1,
    invalid: 0,
    suppressed: 2,
    unreachable: 3,
    missed: 0,
    indeterminate: 0,
    handedOff: 4,
  }

  it("marks a finished wave sent and the ledger succeeded", async () => {
    const { prisma, calls } = fakePrisma()

    await finishPushCampaignRun(
      {
        campaignId: CAMPAIGN_ID,
        ledgerRunId: "ledger-1",
        kind: "LIVE",
        outcome: "sent",
        counts,
      },
      { prisma, now: () => NOW },
    )

    expect(calls.campaignUpdates[0]).toMatchObject({
      where: { id: CAMPAIGN_ID, status: "SENDING" },
      data: { status: "SENT", completedAt: NOW },
    })
    expect(calls.ledgerUpdates[0].data).toMatchObject({ status: "SUCCEEDED" })
  })

  it("marks a paused run paused rather than sent", async () => {
    const { prisma, calls } = fakePrisma()

    await finishPushCampaignRun(
      {
        campaignId: CAMPAIGN_ID,
        ledgerRunId: "ledger-1",
        kind: "LIVE",
        outcome: "paused",
        counts,
      },
      { prisma, now: () => NOW },
    )

    expect(calls.campaignUpdates[0].data).toMatchObject({ status: "PAUSED" })
  })

  it("records the test send once a test run accepted at least one phone", async () => {
    const { prisma } = fakePrisma()

    await finishPushCampaignRun(
      {
        campaignId: CAMPAIGN_ID,
        ledgerRunId: "ledger-1",
        kind: "TEST",
        outcome: "sent",
        counts,
      },
      { prisma, now: () => NOW },
    )

    expect(campaignService.recordPushTestSend).toHaveBeenCalledOnce()
  })

  it("does not unlock scheduling when the test send reached nobody", async () => {
    const { prisma } = fakePrisma()

    await finishPushCampaignRun(
      {
        campaignId: CAMPAIGN_ID,
        ledgerRunId: "ledger-1",
        kind: "TEST",
        outcome: "sent",
        counts: { ...counts, accepted: 0 },
      },
      { prisma, now: () => NOW },
    )

    expect(campaignService.recordPushTestSend).not.toHaveBeenCalled()
  })

  it("records the test send under the editor who started the run", async () => {
    const { prisma } = fakePrisma({
      ledger: { id: "ledger-1", actorId: "admin-user-1", status: "RUNNING" },
    })

    await finishPushCampaignRun(
      {
        campaignId: CAMPAIGN_ID,
        ledgerRunId: "ledger-1",
        kind: "TEST",
        outcome: "sent",
        counts,
      },
      { prisma, now: () => NOW },
    )

    expect(campaignService.recordPushTestSend).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ actorId: "admin-user-1" }),
    )
  })

  it("falls back to the workflow actor when the ledger names none", async () => {
    const { prisma } = fakePrisma({
      ledger: { id: "ledger-1", actorId: null, status: "RUNNING" },
    })

    await finishPushCampaignRun(
      {
        campaignId: CAMPAIGN_ID,
        ledgerRunId: "ledger-1",
        kind: "TEST",
        outcome: "sent",
        counts,
      },
      { prisma, now: () => NOW },
    )

    expect(campaignService.recordPushTestSend).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ actorId: "workflow" }),
    )
  })

  it("never moves a cancelled campaign to sent", async () => {
    const { prisma, calls } = fakePrisma()

    await finishPushCampaignRun(
      {
        campaignId: CAMPAIGN_ID,
        ledgerRunId: "ledger-1",
        kind: "LIVE",
        outcome: "cancelled",
        counts,
      },
      { prisma, now: () => NOW },
    )

    expect(calls.campaignUpdates).toEqual([])
  })

  // The cancel path that withholds the runtime event ends here instead, so the
  // ledger has to read the same as the path that emits it.
  it("closes the ledger as cancelled when the run ends on a cancel", async () => {
    const { prisma, calls } = fakePrisma()

    await finishPushCampaignRun(
      {
        campaignId: CAMPAIGN_ID,
        ledgerRunId: "ledger-1",
        kind: "LIVE",
        outcome: "cancelled",
        counts,
      },
      { prisma, now: () => NOW },
    )

    expect(calls.ledgerUpdates[0].data).toMatchObject({
      status: "CANCELLED",
      finishedAt: NOW,
    })
  })
})

describe("failPushCampaignRun", () => {
  const failure = {
    name: "PushProviderAuthError",
    message: "answered UNAUTHORIZED",
  }

  it("marks the ledger failed and puts the reason on the campaign", async () => {
    const { prisma, calls } = fakePrisma()

    await failPushCampaignRun(
      {
        campaignId: CAMPAIGN_ID,
        ledgerRunId: "ledger-1",
        kind: "LIVE",
        error: failure,
      },
      { prisma },
    )

    expect(calls.campaignUpdates[0].data).toMatchObject({
      lastError: "PushProviderAuthError: answered UNAUTHORIZED",
    })
    expect(calls.ledgerUpdates.at(-1)?.data).toMatchObject({
      status: "FAILED",
    })
  })

  it("logs the error class and never a push token", async () => {
    const { prisma } = fakePrisma()
    const logs: string[] = []
    vi.spyOn(console, "error").mockImplementation((line: unknown) => {
      logs.push(String(line))
    })

    await failPushCampaignRun(
      {
        campaignId: CAMPAIGN_ID,
        ledgerRunId: "ledger-1",
        kind: "TEST",
        error: {
          name: "PrismaClientKnownRequestError",
          message: "ExponentPushToken[secret] already exists",
        },
      },
      { prisma },
    )

    const line = logs.find((entry) => entry.includes("event=run_failed"))
    expect(line).toContain("error_class=PrismaClientKnownRequestError")
    expect(line).not.toContain("ExponentPushToken")
  })

  it("redacts a push token before it reaches the campaign row", async () => {
    const { prisma, calls } = fakePrisma()

    await failPushCampaignRun(
      {
        campaignId: CAMPAIGN_ID,
        ledgerRunId: "ledger-1",
        kind: "LIVE",
        error: {
          name: "Error",
          message: "ExponentPushToken[abc123] is not registered",
        },
      },
      { prisma },
    )

    const lastError = String(calls.campaignUpdates[0].data.lastError)
    expect(lastError).not.toContain("abc123")
    expect(lastError).toContain("[redacted]")
  })

  it("retires the zones the run had not finished", async () => {
    const { prisma, calls } = fakePrisma({
      pendingZones: [
        { timeZone: "Pacific/Auckland", scheduledAt: NOW },
        { timeZone: "Asia/Dubai", scheduledAt: NOW },
      ],
    })

    await failPushCampaignRun(
      {
        campaignId: CAMPAIGN_ID,
        ledgerRunId: "ledger-1",
        kind: "LIVE",
        error: failure,
      },
      { prisma, now: () => NOW },
    )

    expect(calls.zoneUpdates).toEqual([
      {
        where: {
          campaignId: CAMPAIGN_ID,
          status: { in: ["PENDING", "DISPATCHING"] },
        },
        data: { status: "MISSED" },
      },
    ])
  })

  it("frees each phone's local day by retiring the reserved rows", async () => {
    const { prisma, calls } = fakePrisma({ deliveriesMoved: 4 })

    await failPushCampaignRun(
      {
        campaignId: CAMPAIGN_ID,
        ledgerRunId: "ledger-1",
        kind: "LIVE",
        error: failure,
      },
      { prisma, now: () => NOW },
    )

    expect(calls.deliveryUpdates).toEqual([
      {
        where: {
          campaignId: CAMPAIGN_ID,
          kind: "LIVE",
          status: "RESERVED",
        },
        data: { status: "MISSED" },
      },
    ])
  })

  it("pauses the campaign so it does not sit at sending for good", async () => {
    const { prisma, calls } = fakePrisma()

    await failPushCampaignRun(
      {
        campaignId: CAMPAIGN_ID,
        ledgerRunId: "ledger-1",
        kind: "LIVE",
        error: failure,
      },
      { prisma, now: () => NOW },
    )

    const pause = calls.campaignUpdates.at(-1)
    expect(pause?.where).toEqual({
      id: CAMPAIGN_ID,
      status: { in: ["SCHEDULED", "SENDING"] },
    })
    expect(pause?.data).toEqual({
      status: "PAUSED",
      lastError: "PushProviderAuthError: answered UNAUTHORIZED",
      completedAt: NOW,
    })
  })

  it("still marks the ledger failed when the retirement write throws", async () => {
    const { prisma, spies, calls } = fakePrisma()
    spies.pushCampaignZone.updateMany.mockRejectedValueOnce(
      new Error("ExponentPushToken[secret] blew up"),
    )
    const logs: string[] = []
    vi.spyOn(console, "warn").mockImplementation((line: unknown) => {
      logs.push(String(line))
    })

    await failPushCampaignRun(
      {
        campaignId: CAMPAIGN_ID,
        ledgerRunId: "ledger-1",
        kind: "LIVE",
        error: failure,
      },
      { prisma, now: () => NOW },
    )

    expect(calls.ledgerUpdates.at(-1)?.data).toMatchObject({
      status: "FAILED",
    })
    const line = logs.find((entry) =>
      entry.includes("event=run_failed_retire_incomplete"),
    )
    expect(line).toContain("error_class=Error")
    expect(logs.join("\n")).not.toContain("ExponentPushToken")
  })
})

describe("readPushCampaignRunState", () => {
  it("returns the ledger status the campaign page shows", async () => {
    const { prisma } = fakePrisma({
      campaign: {
        id: CAMPAIGN_ID,
        status: "SENDING",
        workflowRunLogId: "ledger-1",
        lastError: null,
      },
      ledger: {
        id: "ledger-1",
        runtimeRunId: "runtime-1",
        status: "RUNNING",
        error: null,
      },
    })

    await expect(
      readPushCampaignRunState(CAMPAIGN_ID, { prisma }),
    ).resolves.toEqual({
      workflowRunLogId: "ledger-1",
      runtimeRunId: "runtime-1",
      ledgerStatus: "RUNNING",
      error: null,
    })
  })

  it("returns the campaign's own error when no run exists yet", async () => {
    const { prisma } = fakePrisma({
      campaign: {
        id: CAMPAIGN_ID,
        status: "TESTED",
        workflowRunLogId: null,
        lastError: "queue unavailable",
      },
    })

    await expect(
      readPushCampaignRunState(CAMPAIGN_ID, { prisma }),
    ).resolves.toMatchObject({ ledgerStatus: null, error: "queue unavailable" })
  })
})
