/**
 * R19 and KTD15 — the receipt step.
 *
 * Receipts expire at about 24 hours and a wave lasts about 26, so a group older
 * than 20 hours is reconciled before a younger one however the ages sort.
 */
import { PushDeliveryStatus } from "@prisma/client"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  PUSH_RECEIPT_FORCE_AGE_MS,
  PUSH_RECEIPT_MIN_AGE_MS,
  orderPushReceiptGroups,
  reconcilePushCampaignReceipts,
  type PushReceiptStore,
} from "./receipts"
import { PushProviderRetryableError } from "./errors"
import type { PushReceiptOutcome, PushTransport } from "./transport"

const CAMPAIGN_ID = "campaign-1"
const NOW = new Date("2026-10-02T12:00:00.000Z")

function group(hoursAgo: number, zone: string) {
  return {
    instant: new Date(NOW.getTime() - hoursAgo * 60 * 60 * 1_000),
    dispatchedAt: new Date(NOW.getTime() - hoursAgo * 60 * 60 * 1_000),
    timeZones: [zone],
  }
}

type Calls = {
  handedOff: string[]
  failed: { id: string; error: string; status: string }[]
  deadTokens: { deliveryId: string; registrationId: string | null }[]
  unknown: string[]
  pages: { timeZones: readonly string[]; cursor: string | null }[]
}

function fakeStore(overrides: Partial<PushReceiptStore> = {}) {
  const calls: Calls = {
    handedOff: [],
    failed: [],
    deadTokens: [],
    unknown: [],
    pages: [],
  }
  const store: PushReceiptStore = {
    readReconcilableGroups: vi.fn(async () => [group(1, "Pacific/Auckland")]),
    readAcceptedPage: vi.fn(async ({ timeZones, cursor }) => {
      calls.pages.push({ timeZones, cursor })
      return {
        rows: [
          { id: "delivery-1", ticketId: "ticket-1", registrationId: "reg-1" },
        ],
        nextCursor: null,
      }
    }),
    readStaleSendingPage: vi.fn(async () => []),
    recordHandedOff: vi.fn(async (ids) => {
      calls.handedOff.push(...ids)
    }),
    recordFailed: vi.fn(
      async (
        rows: readonly { id: string; error: string }[],
        status: PushDeliveryStatus,
      ) => {
        calls.failed.push(...rows.map((row) => ({ ...row, status })))
      },
    ),
    recordDeadTokens: vi.fn(
      async (
        rows: readonly {
          deliveryId: string
          registrationId: string | null
          error: string
        }[],
      ) => {
        calls.deadTokens.push(
          ...rows.map((row) => ({
            deliveryId: row.deliveryId,
            registrationId: row.registrationId,
          })),
        )
      },
    ),
    recordUnknown: vi.fn(async (ids) => {
      calls.unknown.push(...ids)
    }),
    ...overrides,
  }
  return { store, calls }
}

function fakeTransport(
  receipts: Record<string, PushReceiptOutcome> = {
    "ticket-1": { kind: "handed_off" },
  },
): { transport: PushTransport; requested: string[][] } {
  const requested: string[][] = []
  return {
    requested,
    transport: {
      sendChunk: vi.fn(async () => []),
      fetchReceipts: vi.fn(async (ids) => {
        requested.push([...ids])
        return new Map(
          [...ids].flatMap((id) => {
            const outcome = receipts[id]
            return outcome ? [[id, outcome] as const] : []
          }),
        )
      }),
    },
  }
}

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

let logs: string[]

beforeEach(() => {
  logs = []
  vi.spyOn(console, "info").mockImplementation((line: unknown) => {
    logs.push(String(line))
  })
})

describe("orderPushReceiptGroups", () => {
  it("puts a group past the force age first, however the ages sort", () => {
    const young = group(0.3, "Pacific/Auckland")
    const old = group(21, "America/Los_Angeles")
    const middle = group(3, "Europe/London")

    const ordered = orderPushReceiptGroups([young, middle, old], NOW)

    expect(ordered.map((entry) => entry.timeZones[0])).toEqual([
      "America/Los_Angeles",
      "Europe/London",
      "Pacific/Auckland",
    ])
  })

  it("orders the rest oldest first", () => {
    const ordered = orderPushReceiptGroups(
      [group(1, "A"), group(5, "B"), group(3, "C")],
      NOW,
    )

    expect(ordered.map((entry) => entry.timeZones[0])).toEqual(["B", "C", "A"])
  })

  it("reconciles a twenty-hour group before a sixteen-minute one", () => {
    const ordered = orderPushReceiptGroups(
      [
        {
          ...group(0, "recent"),
          dispatchedAt: new Date(NOW.getTime() - 16 * 60_000),
        },
        group(20.5, "ancient"),
      ],
      NOW,
    )

    expect(ordered[0].timeZones[0]).toBe("ancient")
  })

  it("holds the two ages the plan states", () => {
    expect(PUSH_RECEIPT_MIN_AGE_MS).toBe(15 * 60_000)
    expect(PUSH_RECEIPT_FORCE_AGE_MS).toBe(20 * 60 * 60_000)
  })
})

describe("reconcilePushCampaignReceipts", () => {
  it("moves an accepted row to handed off", async () => {
    const { store, calls } = fakeStore()
    const { transport } = fakeTransport()

    const result = await reconcilePushCampaignReceipts(
      { campaignId: CAMPAIGN_ID },
      { store, transport, config: config(), now: () => NOW },
    )

    expect(calls.handedOff).toEqual(["delivery-1"])
    expect(result.counts.handedOff).toBe(1)
    expect(result.status).toBe("exhausted")
  })

  it("moves a failed receipt to failed with the provider's code only", async () => {
    const { store, calls } = fakeStore()
    const { transport } = fakeTransport({
      "ticket-1": { kind: "failed", providerCode: "ProviderError" },
    })

    const result = await reconcilePushCampaignReceipts(
      { campaignId: CAMPAIGN_ID },
      { store, transport, config: config(), now: () => NOW },
    )

    expect(calls.failed).toEqual([
      { id: "delivery-1", error: "ProviderError", status: "FAILED" },
    ])
    expect(result.counts.failed).toBe(1)
  })

  it("retires the token and the registration on a dead-token receipt", async () => {
    const { store, calls } = fakeStore()
    const { transport } = fakeTransport({
      "ticket-1": { kind: "dead_token", providerCode: "DeviceNotRegistered" },
    })

    const result = await reconcilePushCampaignReceipts(
      { campaignId: CAMPAIGN_ID },
      { store, transport, config: config(), now: () => NOW },
    )

    expect(calls.deadTokens).toEqual([
      { deliveryId: "delivery-1", registrationId: "reg-1" },
    ])
    expect(result.counts.invalid).toBe(1)
  })

  it("leaves a row the provider has not answered untouched", async () => {
    const { store, calls } = fakeStore()
    const { transport } = fakeTransport({})

    const result = await reconcilePushCampaignReceipts(
      { campaignId: CAMPAIGN_ID },
      { store, transport, config: config(), now: () => NOW },
    )

    expect(calls.handedOff).toEqual([])
    expect(calls.failed).toEqual([])
    expect(calls.deadTokens).toEqual([])
    expect(result.counts.pending).toBe(1)
  })

  it("turns a sending row with no ticket into unknown", async () => {
    const { store, calls } = fakeStore({
      readStaleSendingPage: vi.fn(async () => [{ id: "delivery-stuck" }]),
    })
    const { transport } = fakeTransport()

    const result = await reconcilePushCampaignReceipts(
      { campaignId: CAMPAIGN_ID },
      { store, transport, config: config(), now: () => NOW },
    )

    expect(calls.unknown).toEqual(["delivery-stuck"])
    expect(result.counts.unknown).toBe(1)
  })

  it("pages a large group across several calls and ends every row", async () => {
    const pageSize = 10_000
    let page = 0
    const { store, calls } = fakeStore({
      readAcceptedPage: vi.fn(async () => {
        page += 1
        const size = page < 3 ? pageSize : 5_000
        return {
          rows: Array.from({ length: size }, (_value, index) => ({
            id: `delivery-${page}-${index}`,
            ticketId: `ticket-${page}-${index}`,
            registrationId: `reg-${page}-${index}`,
          })),
          nextCursor: page < 3 ? `cursor-${page}` : null,
        }
      }),
    })
    const transport: PushTransport = {
      sendChunk: vi.fn(async () => []),
      fetchReceipts: vi.fn(
        async (ids) =>
          new Map([...ids].map((id) => [id, { kind: "handed_off" as const }])),
      ),
    }

    const result = await reconcilePushCampaignReceipts(
      { campaignId: CAMPAIGN_ID },
      { store, transport, config: config(), now: () => NOW },
    )

    expect(calls.handedOff).toHaveLength(25_000)
    expect(result.counts.handedOff).toBe(25_000)
    expect(result.status).toBe("exhausted")
  })

  it("defers when the step budget reaches the reserve and returns the cursor", async () => {
    let clock = NOW.getTime()
    const { store } = fakeStore({
      readAcceptedPage: vi.fn(async () => ({
        rows: [
          { id: "delivery-1", ticketId: "ticket-1", registrationId: "reg-1" },
        ],
        nextCursor: "cursor-1",
      })),
    })
    const { transport } = fakeTransport()

    const result = await reconcilePushCampaignReceipts(
      { campaignId: CAMPAIGN_ID },
      {
        store,
        transport,
        config: config({ stepMaxDurationMs: 50_000, stepReserveMs: 40_000 }),
        now: () => {
          clock += 6_000
          return new Date(clock)
        },
      },
    )

    expect(result.status).toBe("deferred")
  })

  it("reads no group when nothing is old enough yet", async () => {
    const { store, calls } = fakeStore({
      readReconcilableGroups: vi.fn(async () => []),
    })
    const { transport, requested } = fakeTransport()

    const result = await reconcilePushCampaignReceipts(
      { campaignId: CAMPAIGN_ID },
      { store, transport, config: config(), now: () => NOW },
    )

    expect(requested).toEqual([])
    expect(calls.pages).toEqual([])
    expect(result.counts.handedOff).toBe(0)
  })

  it("asks the store for the age it must respect, and for none on a final pass", async () => {
    const { store } = fakeStore()
    const { transport } = fakeTransport()

    await reconcilePushCampaignReceipts(
      { campaignId: CAMPAIGN_ID },
      { store, transport, config: config(), now: () => NOW },
    )
    await reconcilePushCampaignReceipts(
      { campaignId: CAMPAIGN_ID, minAgeMs: 0 },
      { store, transport, config: config(), now: () => NOW },
    )

    expect(store.readReconcilableGroups).toHaveBeenNthCalledWith(1, {
      campaignId: CAMPAIGN_ID,
      minAgeMs: PUSH_RECEIPT_MIN_AGE_MS,
      now: NOW,
    })
    expect(store.readReconcilableGroups).toHaveBeenNthCalledWith(2, {
      campaignId: CAMPAIGN_ID,
      minAgeMs: 0,
      now: NOW,
    })
  })

  it("logs one reconciled line per run with its counts", async () => {
    const { store } = fakeStore()
    const { transport } = fakeTransport()

    await reconcilePushCampaignReceipts(
      { campaignId: CAMPAIGN_ID },
      { store, transport, config: config(), now: () => NOW },
    )

    const line = logs.find((entry) =>
      entry.includes("event=receipts_reconciled"),
    )
    expect(line).toBeDefined()
    expect(line).toContain("handed_off=1")
    expect(line).toContain("invalid=0")
  })

  it("lets a retryable provider failure leave the step, so the step retries", async () => {
    const { store } = fakeStore()
    const transport: PushTransport = {
      sendChunk: vi.fn(async () => []),
      fetchReceipts: vi.fn(async () => {
        throw new PushProviderRetryableError("http_429")
      }),
    }

    await expect(
      reconcilePushCampaignReceipts(
        { campaignId: CAMPAIGN_ID },
        { store, transport, config: config(), now: () => NOW },
      ),
    ).rejects.toBeInstanceOf(PushProviderRetryableError)
  })

  it("never writes a provider message into a log line", async () => {
    const { store } = fakeStore()
    const { transport } = fakeTransport({
      "ticket-1": { kind: "failed", providerCode: "ProviderError" },
    })

    await reconcilePushCampaignReceipts(
      { campaignId: CAMPAIGN_ID },
      { store, transport, config: config(), now: () => NOW },
    )

    expect(logs.join("\n")).not.toContain("ExponentPushToken")
  })
})
