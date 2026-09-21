/**
 * KTD2's recovery sweep. A run the runtime no longer holds leaves its pending
 * zones missed; a run the runtime still holds is left completely alone.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { sweepOrphanedPushCampaigns, type PushRecoveryStore } from "./recovery"

const NOW = new Date("2026-10-01T12:00:00.000Z")

type Calls = {
  zonesMissed: string[]
  deliveriesMissed: string[]
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
  const calls: Calls = { zonesMissed: [], deliveriesMissed: [], paused: [] }
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
    })
    expect(logs.some((line) => line.includes("event=zone_missed"))).toBe(true)
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
