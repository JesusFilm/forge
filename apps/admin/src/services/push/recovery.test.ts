/**
 * KTD2's recovery sweep. A run the runtime no longer holds leaves its pending
 * zones missed; a run the runtime still holds is left completely alone.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { PUSH_RECEIPT_MIN_AGE_MS } from "./receipts"
import {
  PUSH_RECOVERY_SENDING_STALE_MS,
  readPushRuntimeRunLiveness,
  sweepOrphanedPushCampaigns,
  type PushRecoveryStore,
} from "./recovery"

const runs = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock("workflow/runtime", () => ({ getWorld: () => ({ runs }) }))

const NOW = new Date("2026-10-01T12:00:00.000Z")

type Calls = {
  zonesMissed: string[]
  deliveriesMissed: string[]
  staleSending: { campaignId: string; before: Date }[]
  paused: { campaignId: string; reason: string }[]
}

function campaign(overrides: Record<string, unknown> = {}) {
  return {
    id: "campaign-1",
    status: "SENDING" as const,
    workflowRunLogId: "ledger-1",
    runtimeRunId: "runtime-1",
    ...overrides,
  }
}

function fakeStore(
  overrides: Partial<PushRecoveryStore> = {},
  campaigns = [campaign()],
) {
  const calls: Calls = {
    zonesMissed: [],
    deliveriesMissed: [],
    staleSending: [],
    paused: [],
  }
  const store: PushRecoveryStore = {
    readActiveCampaigns: vi.fn(async () => campaigns),
    markZonesMissed: vi.fn(async (campaignId) => {
      calls.zonesMissed.push(campaignId)
      return 2
    }),
    markReservedMissed: vi.fn(async (campaignId) => {
      calls.deliveriesMissed.push(campaignId)
      return 7
    }),
    markStaleSendingUnknown: vi.fn(async ({ campaignId, before }) => {
      calls.staleSending.push({ campaignId, before })
      return 1
    }),
    pauseCampaign: vi.fn(async ({ campaignId, reason }) => {
      calls.paused.push({ campaignId, reason })
      return true
    }),
    ...overrides,
  }
  return { store, calls }
}

let logs: string[]

beforeEach(() => {
  logs = []
  vi.spyOn(console, "info").mockImplementation((line: unknown) => {
    logs.push(String(line))
  })
  vi.spyOn(console, "warn").mockImplementation((line: unknown) => {
    logs.push(String(line))
  })
})

describe("sweepOrphanedPushCampaigns", () => {
  it("marks the pending zones missed for a sending campaign with no live run", async () => {
    const { store, calls } = fakeStore()

    const result = await sweepOrphanedPushCampaigns({
      store,
      readRuntimeStatus: vi.fn(async () => "terminal" as const),
      now: () => NOW,
    })

    expect(calls.zonesMissed).toEqual(["campaign-1"])
    expect(calls.deliveriesMissed).toEqual(["campaign-1"])
    expect(result).toMatchObject({
      campaignsInspected: 1,
      campaignsSwept: 1,
      zonesMissed: 2,
      deliveriesMissed: 7,
      deliveriesUnknown: 1,
    })
    expect(logs.some((line) => line.includes("event=zone_missed"))).toBe(true)
  })

  it("calls a sending row indeterminate once it is past the receipt floor", async () => {
    const { store, calls } = fakeStore()

    await sweepOrphanedPushCampaigns({
      store,
      readRuntimeStatus: vi.fn(async () => "terminal" as const),
      now: () => NOW,
    })

    expect(calls.staleSending).toEqual([
      {
        campaignId: "campaign-1",
        before: new Date(NOW.getTime() - PUSH_RECEIPT_MIN_AGE_MS),
      },
    ])
  })

  // The sweep is the only reader of a cancelled campaign's leftovers, and R11's
  // cancel is best effort, so the two floors have to stay one rule.
  it("uses the same staleness floor the receipt step uses", () => {
    expect(PUSH_RECOVERY_SENDING_STALE_MS).toBe(PUSH_RECEIPT_MIN_AGE_MS)
  })

  it("retires a cancelled campaign's leftovers without moving its status", async () => {
    const { store, calls } = fakeStore({}, [
      campaign({ status: "CANCELLED" as const }),
    ])
    store.pauseCampaign = vi.fn(async () => false)

    const result = await sweepOrphanedPushCampaigns({
      store,
      readRuntimeStatus: vi.fn(async () => "terminal" as const),
      now: () => NOW,
    })

    expect(calls.zonesMissed).toEqual(["campaign-1"])
    expect(calls.deliveriesMissed).toEqual(["campaign-1"])
    expect(calls.staleSending).toHaveLength(1)
    expect(result.campaignsSwept).toBe(1)
  })

  it("leaves a campaign with a live run completely alone", async () => {
    const { store, calls } = fakeStore()

    const result = await sweepOrphanedPushCampaigns({
      store,
      readRuntimeStatus: vi.fn(async () => "alive" as const),
      now: () => NOW,
    })

    expect(calls.zonesMissed).toEqual([])
    expect(calls.deliveriesMissed).toEqual([])
    expect(calls.paused).toEqual([])
    expect(result.campaignsSwept).toBe(0)
  })

  it("leaves a campaign alone when the runtime cannot be read", async () => {
    const { store, calls } = fakeStore()

    const result = await sweepOrphanedPushCampaigns({
      store,
      readRuntimeStatus: vi.fn(async () => "unknown" as const),
      now: () => NOW,
    })

    expect(calls.zonesMissed).toEqual([])
    expect(result.campaignsSwept).toBe(0)
  })

  it("sweeps a scheduled campaign that never got a run at all", async () => {
    const { store, calls } = fakeStore({}, [
      campaign({
        status: "SCHEDULED" as const,
        workflowRunLogId: null,
        runtimeRunId: null,
      }),
    ])
    const readRuntimeStatus = vi.fn(async () => "alive" as const)

    const result = await sweepOrphanedPushCampaigns({
      store,
      readRuntimeStatus,
      now: () => NOW,
    })

    expect(readRuntimeStatus).not.toHaveBeenCalled()
    expect(calls.zonesMissed).toEqual(["campaign-1"])
    expect(result.campaignsSwept).toBe(1)
  })

  it("sweeps a campaign whose ledger row carries no runtime id yet", async () => {
    const { store, calls } = fakeStore({}, [campaign({ runtimeRunId: null })])

    await sweepOrphanedPushCampaigns({
      store,
      readRuntimeStatus: vi.fn(async () => "alive" as const),
      now: () => NOW,
    })

    expect(calls.zonesMissed).toEqual(["campaign-1"])
  })

  it("pauses the campaign so the stale-worker alert stops firing", async () => {
    const { store, calls } = fakeStore()

    await sweepOrphanedPushCampaigns({
      store,
      readRuntimeStatus: vi.fn(async () => "terminal" as const),
      now: () => NOW,
    })

    expect(calls.paused).toEqual([
      { campaignId: "campaign-1", reason: "run_not_alive" },
    ])
  })

  it("keeps sweeping after one campaign fails", async () => {
    const { store, calls } = fakeStore({}, [
      campaign({ id: "campaign-bad" }),
      campaign({ id: "campaign-good" }),
    ])
    store.markZonesMissed = vi.fn(async (campaignId: string) => {
      if (campaignId === "campaign-bad") throw new Error("write failed")
      calls.zonesMissed.push(campaignId)
      return 1
    })

    const result = await sweepOrphanedPushCampaigns({
      store,
      readRuntimeStatus: vi.fn(async () => "terminal" as const),
      now: () => NOW,
    })

    expect(calls.zonesMissed).toEqual(["campaign-good"])
    expect(result.campaignsSwept).toBe(1)
    expect(result.failures).toBe(1)
  })

  it("never lets an error class name reach the log with a provider message", async () => {
    const { store } = fakeStore()
    store.markZonesMissed = vi.fn(async () => {
      throw new Error("ExponentPushToken[secret] blew up")
    })

    await sweepOrphanedPushCampaigns({
      store,
      readRuntimeStatus: vi.fn(async () => "terminal" as const),
      now: () => NOW,
    })

    expect(logs.join("\n")).not.toContain("ExponentPushToken")
  })
})

/**
 * The sweep's only liveness predicate. Calling a live wave terminal retires
 * zones that were about to send, so every status the runtime can answer is
 * pinned here rather than inferred.
 *
 * `@workflow/world` 4.1.1 answers exactly `pending`, `running`, `completed`,
 * `failed`, or `cancelled` — its `WorkflowRunStatusSchema` is the whole
 * vocabulary, and a run asleep inside `sleep()` reports `running`.
 */
describe("readPushRuntimeRunLiveness", () => {
  beforeEach(() => {
    runs.get.mockReset()
  })

  it.each([
    ["pending", "alive"],
    ["running", "alive"],
    ["completed", "terminal"],
    ["failed", "terminal"],
    ["cancelled", "terminal"],
  ] as const)("reads a %s run as %s", async (status, liveness) => {
    runs.get.mockResolvedValueOnce({ runId: "run-1", status })

    await expect(readPushRuntimeRunLiveness("run-1")).resolves.toBe(liveness)
  })

  it("asks for the run without resolving its data", async () => {
    runs.get.mockResolvedValueOnce({ runId: "run-1", status: "running" })

    await readPushRuntimeRunLiveness("run-1")

    expect(runs.get).toHaveBeenCalledWith("run-1", { resolveData: "none" })
  })

  it("answers unknown when the lookup rejects, so the campaign survives", async () => {
    runs.get.mockRejectedValueOnce(new Error("runtime unreachable"))

    await expect(readPushRuntimeRunLiveness("run-1")).resolves.toBe("unknown")
  })

  it("answers unknown at the deadline and swallows the late rejection", async () => {
    let failLookup: (error: Error) => void = () => {}
    runs.get.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        failLookup = reject
      }),
    )
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on("unhandledRejection", onUnhandled)

    try {
      // The deadline is a real one-second timer. Fake timers never reached it
      // here, so the test waits it out rather than pretending to.
      await expect(readPushRuntimeRunLiveness("run-1")).resolves.toBe("unknown")
      failLookup(new Error("answered after the deadline"))
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(unhandled).toEqual([])
    } finally {
      process.off("unhandledRejection", onUnhandled)
    }
  })
})
