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
  PUSH_RECEIPT_REQUEST_SIZE,
  createPushReceiptStore,
  groupPushReceiptWork,
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
    sentAt: new Date(NOW.getTime() - hoursAgo * 60 * 60 * 1_000),
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

/** A page of accepted rows, each with its own ticket. */
function acceptedRows(count: number) {
  return Array.from({ length: count }, (_value, index) => ({
    id: `delivery-${index}`,
    ticketId: `ticket-${index}`,
    registrationId: `reg-${index}`,
  }))
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
          sentAt: new Date(NOW.getTime() - 16 * 60_000),
          timeZones: ["recent"],
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

describe("groupPushReceiptWork", () => {
  const instant = new Date("2026-10-02T06:00:00.000Z").getTime()
  const later = new Date("2026-10-02T09:00:00.000Z").getTime()

  it("reconciles the zones that share a planned instant together", () => {
    const groups = groupPushReceiptWork(
      [
        { timeZone: "Pacific/Auckland", oldestSentAt: new Date(instant) },
        { timeZone: "Pacific/Fiji", oldestSentAt: new Date(instant + 60_000) },
        { timeZone: "Asia/Dubai", oldestSentAt: new Date(later) },
      ],
      new Map([
        ["Pacific/Auckland", instant],
        ["Pacific/Fiji", instant],
        ["Asia/Dubai", later],
      ]),
    )

    expect(groups).toEqual([
      {
        sentAt: new Date(instant),
        timeZones: ["Pacific/Auckland", "Pacific/Fiji"],
      },
      { sentAt: new Date(later), timeZones: ["Asia/Dubai"] },
    ])
  })

  it("takes the oldest send in the group, whichever zone holds it", () => {
    const groups = groupPushReceiptWork(
      [
        { timeZone: "Pacific/Fiji", oldestSentAt: new Date(instant + 60_000) },
        { timeZone: "Pacific/Auckland", oldestSentAt: new Date(instant) },
      ],
      new Map([
        ["Pacific/Auckland", instant],
        ["Pacific/Fiji", instant],
      ]),
    )

    expect(groups).toHaveLength(1)
    expect(groups[0].sentAt).toEqual(new Date(instant))
  })

  it("still groups a zone the campaign never planned", () => {
    // A test send reaches a device in a zone with no campaign zone row, and its
    // accepted rows must still reconcile.
    const groups = groupPushReceiptWork(
      [{ timeZone: "Europe/London", oldestSentAt: new Date(instant) }],
      new Map(),
    )

    expect(groups).toEqual([
      { sentAt: new Date(instant), timeZones: ["Europe/London"] },
    ])
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

  it("reconciles a group whose wave ended before its zone was stamped", async () => {
    // A flag flip or a cancel mid-dispatch leaves the zone missed and its
    // accepted rows holding tickets, so the group still reaches the provider.
    const { store, calls } = fakeStore({
      readReconcilableGroups: vi.fn(async () => [
        {
          sentAt: new Date(NOW.getTime() - 30 * 60_000),
          timeZones: ["Asia/Tokyo"],
        },
      ]),
    })
    const { transport, requested } = fakeTransport()

    const result = await reconcilePushCampaignReceipts(
      { campaignId: CAMPAIGN_ID },
      { store, transport, config: config(), now: () => NOW },
    )

    expect(requested).toEqual([["ticket-1"]])
    expect(calls.pages[0].timeZones).toEqual(["Asia/Tokyo"])
    expect(result.counts.handedOff).toBe(1)
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

  it("splits one page into requests the provider will answer", async () => {
    const { store } = fakeStore({
      readAcceptedPage: vi.fn(async () => ({
        rows: acceptedRows(700),
        nextCursor: null,
      })),
    })
    const requested: string[][] = []
    const transport: PushTransport = {
      sendChunk: vi.fn(async () => []),
      fetchReceipts: vi.fn(async (ids) => {
        requested.push([...ids])
        return new Map(
          [...ids].map((id) => [id, { kind: "handed_off" as const }]),
        )
      }),
    }

    const result = await reconcilePushCampaignReceipts(
      { campaignId: CAMPAIGN_ID },
      { store, transport, config: config(), now: () => NOW },
    )

    expect(requested.map((request) => request.length)).toEqual([
      PUSH_RECEIPT_REQUEST_SIZE,
      PUSH_RECEIPT_REQUEST_SIZE,
      700 - 2 * PUSH_RECEIPT_REQUEST_SIZE,
    ])
    expect(result.counts.handedOff).toBe(700)
  })

  it("defers mid-page when the budget runs out, and keeps what it applied", async () => {
    // The budget is measured per provider request: one page of 900 tickets is
    // three requests, and the third one would run past the step's reserve.
    let elapsedMs = 0
    const { store, calls } = fakeStore({
      readAcceptedPage: vi.fn(async () => ({
        rows: acceptedRows(900),
        nextCursor: null,
      })),
    })
    const requested: number[] = []
    const transport: PushTransport = {
      sendChunk: vi.fn(async () => []),
      fetchReceipts: vi.fn(async (ids) => {
        requested.push([...ids].length)
        elapsedMs += 30_000
        return new Map(
          [...ids].map((id) => [id, { kind: "handed_off" as const }]),
        )
      }),
    }

    const result = await reconcilePushCampaignReceipts(
      { campaignId: CAMPAIGN_ID },
      {
        store,
        transport,
        config: config({ stepMaxDurationMs: 100_000, stepReserveMs: 40_000 }),
        now: () => new Date(NOW.getTime() + elapsedMs),
      },
    )

    expect(requested).toEqual([
      PUSH_RECEIPT_REQUEST_SIZE,
      PUSH_RECEIPT_REQUEST_SIZE,
    ])
    expect(result.status).toBe("deferred")
    expect(calls.handedOff).toHaveLength(2 * PUSH_RECEIPT_REQUEST_SIZE)
    expect(result.counts.handedOff).toBe(2 * PUSH_RECEIPT_REQUEST_SIZE)
    expect(store.readStaleSendingPage).not.toHaveBeenCalled()
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

describe("the receipt store's failure writes", () => {
  type Statement = { sql: string; values: unknown[] }

  function fakePrisma() {
    return {
      $executeRaw: vi.fn(async (_statement: Statement) => 0),
      $transaction: vi.fn(async (statements: unknown[]) => statements),
      pushDelivery: { updateMany: vi.fn(async () => ({ count: 0 })) },
      pushRegistration: { updateMany: vi.fn(async () => ({ count: 0 })) },
    }
  }

  it("writes a whole page of failures in one statement", async () => {
    const prisma = fakePrisma()
    const rows = Array.from({ length: 300 }, (_value, index) => ({
      id: `delivery-${index}`,
      error: "ProviderError",
    }))

    await createPushReceiptStore(prisma as never).recordFailed(
      rows,
      PushDeliveryStatus.FAILED,
    )

    expect(prisma.$executeRaw).toHaveBeenCalledOnce()
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.pushDelivery.updateMany).not.toHaveBeenCalled()
  })

  it("pairs each row with its own error and casts the status", async () => {
    const prisma = fakePrisma()

    await createPushReceiptStore(prisma as never).recordFailed(
      [
        { id: "delivery-1", error: "ProviderError" },
        { id: "delivery-2", error: "MessageRateExceeded" },
      ],
      PushDeliveryStatus.FAILED,
    )

    const statement = prisma.$executeRaw.mock.calls[0][0]
    expect(statement.sql).toContain("FROM unnest(")
    expect(statement.sql).toContain("error = v.error")
    expect(statement.sql).toContain('::"PushDeliveryStatus"')
    expect(statement.values).toContain("failed")
    expect(statement.values).toContain('{"delivery-1","delivery-2"}')
    expect(statement.values).toContain(
      '{"ProviderError","MessageRateExceeded"}',
    )
  })

  it("only moves a row that is still accepted", async () => {
    const prisma = fakePrisma()

    await createPushReceiptStore(prisma as never).recordFailed(
      [{ id: "delivery-1", error: "ProviderError" }],
      PushDeliveryStatus.FAILED,
    )

    expect(prisma.$executeRaw.mock.calls[0][0].sql).toContain(
      `push_delivery.status = 'accepted'::"PushDeliveryStatus"`,
    )
  })

  it("fits a long provider code to the error column", async () => {
    const prisma = fakePrisma()

    await createPushReceiptStore(prisma as never).recordFailed(
      [{ id: "delivery-1", error: "E".repeat(120) }],
      PushDeliveryStatus.FAILED,
    )

    expect(prisma.$executeRaw.mock.calls[0][0].values).toContain(
      `{"${"E".repeat(64)}"}`,
    )
  })

  it("survives a provider code carrying a brace", async () => {
    // The provider names the code, and a brace is structural in a Postgres
    // array literal, so one odd code must not fail the page.
    const prisma = fakePrisma()

    await createPushReceiptStore(prisma as never).recordFailed(
      [{ id: "delivery-1", error: "Provider{Error}" }],
      PushDeliveryStatus.FAILED,
    )

    expect(prisma.$executeRaw.mock.calls[0][0].values).toContain(
      '{"ProviderError"}',
    )
  })

  it("retires a page of dead tokens and their registrations together", async () => {
    const prisma = fakePrisma()
    const rows = Array.from({ length: 300 }, (_value, index) => ({
      deliveryId: `delivery-${index}`,
      registrationId: `reg-${index}`,
      error: "DeviceNotRegistered",
    }))

    await createPushReceiptStore(prisma as never).recordDeadTokens(rows)

    expect(prisma.$transaction).toHaveBeenCalledOnce()
    expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(2)
    expect(prisma.$executeRaw).toHaveBeenCalledOnce()
    expect(prisma.pushRegistration.updateMany).toHaveBeenCalledOnce()
  })

  it("retires a dead token whose registration is already gone", async () => {
    const prisma = fakePrisma()

    await createPushReceiptStore(prisma as never).recordDeadTokens([
      {
        deliveryId: "delivery-1",
        registrationId: null,
        error: "DeviceNotRegistered",
      },
    ])

    expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(1)
    expect(prisma.pushRegistration.updateMany).not.toHaveBeenCalled()
  })

  it("writes nothing when a request answered no failures", async () => {
    const prisma = fakePrisma()
    const store = createPushReceiptStore(prisma as never)

    await store.recordFailed([], PushDeliveryStatus.FAILED)
    await store.recordDeadTokens([])

    expect(prisma.$executeRaw).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})
