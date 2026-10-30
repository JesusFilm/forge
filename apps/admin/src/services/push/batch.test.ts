/**
 * KTD3, KTD11, KTD12 and KTD15 — one page of a campaign's send.
 *
 * The store port is faked here, so these tests prove the gates, the send set,
 * the error classes, and the budget. `batch.db.test.ts` proves the store itself
 * against Postgres, because a fake store implements every predicate correctly
 * by construction.
 */
import { PushCampaignStatus, PushDeliveryStatus } from "@prisma/client"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  PUSH_ANNOUNCEMENT_MAX_DATA_BYTES,
  PUSH_ANNOUNCEMENT_PAYLOAD_VERSION,
  PUSH_CHUNK_RETRY_ATTEMPTS,
  buildPushAnnouncementPayload,
  runPushCampaignBatch,
  shouldDeferNextPushChunk,
  splitPushChunks,
  type PushBatchStore,
} from "./batch"
import {
  PushProviderAuthError,
  PushProviderFatalError,
  PushProviderIndeterminateError,
  PushProviderRetryableError,
} from "./errors"
import type { PushClaimCandidate, PushSendingDelivery } from "./claims"
import type {
  PushSendOutcome,
  PushTransport,
  PushTransportMessage,
} from "./transport"

type ClaimArgs = { candidates: readonly PushClaimCandidate[] }

const CAMPAIGN_ID = "campaign-1"
const GROUP_INSTANT = "2026-10-01T00:00:00.000Z"
const NOW = new Date("2026-10-01T00:00:05.000Z")

type StoreCalls = {
  startSending: { campaignId: string }[]
  markZones: {
    from: string[]
    to: string
    timeZones: readonly string[] | null
  }[]
  markMissed: { timeZones: readonly string[] | undefined }[]
  moveReserved: { deliveryIds: string[]; expected: unknown }[]
  revert: { deliveryIds: string[] }[]
  accepted: { id: string; ticketId: string }[]
  failed: { id: string; error: string; status: string }[]
  deadTokens: {
    deliveryId: string
    registrationId: string | null
    error: string
  }[]
  unreachable: string[]
}

function registration(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `reg-${index}`,
    expoPushToken: `ExponentPushToken[token-${index}]`,
    platform: "IOS" as const,
    appLanguageSlug: "english",
    phoneLanguageSlug: "english",
    phoneLocale: "en-NZ",
    timeZone: "Pacific/Auckland",
    country: "NZ",
    ...overrides,
  }
}

function fakeStore(
  overrides: Partial<PushBatchStore> = {},
  audience = [registration(1)],
) {
  const calls: StoreCalls = {
    startSending: [],
    markZones: [],
    markMissed: [],
    moveReserved: [],
    revert: [],
    accepted: [],
    failed: [],
    deadTokens: [],
    unreachable: [],
  }
  const rows = new Map<string, PushSendingDelivery>()
  const store: PushBatchStore = {
    readCampaign: vi.fn(async () => ({
      id: CAMPAIGN_ID,
      status: "SENDING" as const,
      mode: "WAVE" as const,
      sendDate: new Date("2026-10-01T00:00:00.000Z"),
      localHour: 9,
      destinationKind: "SERIES" as const,
      destinationSlug: "washi-gospel",
      audienceScope: "EVERYWHERE" as const,
      countries: [],
      languageFilter: [],
    })),
    readCopy: vi.fn(async () => [
      { languageSlug: "english", title: "Good news", body: "Watch today" },
    ]),
    readLanguages: vi.fn(async () => [{ slug: "english", bcp47: "en" }]),
    readZonesAt: vi.fn(async () => ["Pacific/Auckland"]),
    readAudiencePage: vi.fn(async () => ({
      audience,
      unreachable: [],
      nextCursor: null,
    })),
    readTestDevices: vi.fn(async () => audience),
    claimPage: vi.fn(async ({ candidates }: ClaimArgs) => {
      const claimed = candidates.map((candidate, index: number) => ({
        id: `delivery-${index + 1}`,
        nonce: `n${index + 1}`.padEnd(43, "x"),
        registrationId: candidate.registrationId,
        languageSlug: candidate.languageSlug,
        country: candidate.country,
        timeZone: candidate.timeZone,
        localDay: candidate.localDay,
      }))
      for (const row of claimed) rows.set(row.id, row)
      return { claimed, suppressed: [], alreadyClaimed: [] }
    }),
    readReserved: vi.fn(async () => []),
    markUnreachable: vi.fn(async ({ candidates }: ClaimArgs) => {
      calls.unreachable.push(...candidates.map((row) => row.registrationId))
      return candidates.length
    }),
    moveReservedToSending: vi.fn(
      async ({ deliveryIds, expectedCampaignStatus }) => {
        calls.moveReserved.push({
          deliveryIds: [...deliveryIds],
          expected: expectedCampaignStatus,
        })
        // The real statement returns the row as stored, so the fake echoes the
        // claimed row rather than a fixed language.
        return deliveryIds.flatMap((id: string) => {
          const row = rows.get(id)
          return row ? [row] : []
        })
      },
    ),
    revertSendingToReserved: vi.fn(async ({ deliveryIds }) => {
      calls.revert.push({ deliveryIds: [...deliveryIds] })
      return deliveryIds.length
    }),
    markReservedAsMissed: vi.fn(async ({ timeZones }) => {
      calls.markMissed.push({ timeZones })
      return 3
    }),
    startSending: vi.fn(async ({ campaignId }) => {
      calls.startSending.push({ campaignId })
      return true
    }),
    markZones: vi.fn(async ({ from, to, timeZones }) => {
      calls.markZones.push({ from: [...from], to, timeZones })
      return 1
    }),
    recordAccepted: vi.fn(async (rows) => {
      calls.accepted.push(...rows)
    }),
    recordFailed: vi.fn(
      async (
        rows: readonly { id: string; error: string }[],
        status: PushDeliveryStatus,
      ) => {
        calls.failed.push(...rows.map((row) => ({ ...row, status })))
      },
    ),
    recordDeadTokens: vi.fn(async (rows) => {
      calls.deadTokens.push(...rows)
    }),
    ...overrides,
  }
  return { store, calls }
}

function fakeTransport(
  send: (
    messages: readonly { token: string }[],
  ) => Promise<PushSendOutcome[]> = async (messages) =>
    messages.map((_message, index) => ({
      kind: "accepted" as const,
      ticketId: `ticket-${index + 1}`,
    })),
): { transport: PushTransport; sent: { token: string }[][] } {
  const sent: { token: string }[][] = []
  return {
    sent,
    transport: {
      sendChunk: vi.fn(async (messages: readonly PushTransportMessage[]) => {
        sent.push(messages.map((message) => ({ token: message.token })))
        return send(messages)
      }),
      fetchReceipts: vi.fn(async () => new Map()),
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

function liveInput(overrides: Record<string, unknown> = {}) {
  return {
    campaignId: CAMPAIGN_ID,
    kind: "LIVE" as const,
    groupInstant: GROUP_INSTANT,
    cursor: null,
    ...overrides,
  }
}

let logs: string[]

beforeEach(() => {
  logs = []
  vi.spyOn(console, "info").mockImplementation((line: unknown) => {
    logs.push(String(line))
  })
  vi.spyOn(console, "error").mockImplementation((line: unknown) => {
    logs.push(String(line))
  })
})

describe("splitPushChunks", () => {
  it("splits at the provider's limit and keeps the order", () => {
    const rows = Array.from({ length: 250 }, (_value, index) => index)

    const chunks = splitPushChunks(rows, 100)

    expect(chunks.map((chunk) => chunk.length)).toEqual([100, 100, 50])
    expect(chunks[2][49]).toBe(249)
  })

  it("returns nothing for an empty set", () => {
    expect(splitPushChunks([], 100)).toEqual([])
  })
})

describe("shouldDeferNextPushChunk", () => {
  it("always lets the first chunk run, however tight the budget", () => {
    expect(
      shouldDeferNextPushChunk({
        chunksStarted: 0,
        elapsedMs: 500_000,
        stepMaxDurationMs: 1_000,
        stepReserveMs: 40_000,
      }),
    ).toBe(false)
  })

  it("defers once the remaining budget reaches the reserve", () => {
    expect(
      shouldDeferNextPushChunk({
        chunksStarted: 1,
        elapsedMs: 180_000,
        stepMaxDurationMs: 220_000,
        stepReserveMs: 40_000,
      }),
    ).toBe(true)
  })

  it("keeps going while the remaining budget is above the reserve", () => {
    expect(
      shouldDeferNextPushChunk({
        chunksStarted: 1,
        elapsedMs: 179_000,
        stepMaxDurationMs: 220_000,
        stepReserveMs: 40_000,
      }),
    ).toBe(false)
  })
})

describe("buildPushAnnouncementPayload", () => {
  it("carries the version, destination, and nonce the app parses", () => {
    const payload = buildPushAnnouncementPayload({
      destinationKind: "SERIES",
      destinationSlug: "washi-gospel",
      nonce: "n".repeat(43),
    })

    expect(payload).toEqual({
      version: PUSH_ANNOUNCEMENT_PAYLOAD_VERSION,
      family: "announcement",
      kind: "series",
      slug: "washi-gospel",
      nonce: "n".repeat(43),
    })
  })

  it("stays well inside the payload cap the app enforces", () => {
    const payload = buildPushAnnouncementPayload({
      destinationKind: "EXPERIENCE",
      destinationSlug: "x".repeat(191),
      nonce: "n".repeat(43),
    })

    expect(Buffer.byteLength(JSON.stringify(payload), "utf8")).toBeLessThan(
      PUSH_ANNOUNCEMENT_MAX_DATA_BYTES,
    )
  })
})

describe("the three gates before every page", () => {
  it("marks the group's rows missed and pauses when the flag is off", async () => {
    const { store, calls } = fakeStore()
    const { transport, sent } = fakeTransport()

    const result = await runPushCampaignBatch(liveInput(), {
      store,
      transport,
      config: config({ campaignsEnabled: false }),
      now: () => NOW,
    })

    expect(result.status).toBe("paused")
    expect(calls.markMissed).toEqual([{ timeZones: ["Pacific/Auckland"] }])
    expect(sent).toEqual([])
    expect(logs.some((line) => line.includes("event=zone_missed"))).toBe(true)
  })

  it("stops without sending when the campaign is cancelled", async () => {
    const { store } = fakeStore({
      readCampaign: vi.fn(async () => ({
        id: CAMPAIGN_ID,
        status: "CANCELLED" as const,
        mode: "WAVE" as const,
        sendDate: new Date(GROUP_INSTANT),
        localHour: 9,
        destinationKind: "SERIES" as const,
        destinationSlug: "washi-gospel",
        audienceScope: "EVERYWHERE" as const,
        countries: [],
        languageFilter: [],
      })),
    })
    const { transport, sent } = fakeTransport()

    const result = await runPushCampaignBatch(liveInput(), {
      store,
      transport,
      config: config(),
      now: () => NOW,
    })

    expect(result.status).toBe("cancelled")
    expect(sent).toEqual([])
  })

  it("marks a group three hours and one minute past as missed", async () => {
    const { store, calls } = fakeStore()
    const { transport, sent } = fakeTransport()
    const late = new Date(
      new Date(GROUP_INSTANT).getTime() + 3 * 60 * 60 * 1_000 + 60_000,
    )

    const result = await runPushCampaignBatch(liveInput(), {
      store,
      transport,
      config: config(),
      now: () => late,
    })

    expect(result.status).toBe("late")
    expect(calls.markMissed).toEqual([{ timeZones: ["Pacific/Auckland"] }])
    expect(calls.markZones.at(-1)).toMatchObject({ to: "MISSED" })
    expect(sent).toEqual([])
    expect(logs.some((line) => line.includes("event=zone_missed"))).toBe(true)
  })

  it("sends a group two hours past, which is not late", async () => {
    const { store } = fakeStore()
    const { transport, sent } = fakeTransport()
    const behind = new Date(
      new Date(GROUP_INSTANT).getTime() + 2 * 60 * 60 * 1_000,
    )

    const result = await runPushCampaignBatch(liveInput(), {
      store,
      transport,
      config: config(),
      now: () => behind,
    })

    expect(result.status).toBe("exhausted")
    expect(sent).toHaveLength(1)
  })

  it("marks the rest of a group missed when the flag flips between pages", async () => {
    const { store, calls } = fakeStore()
    const { transport, sent } = fakeTransport()

    const result = await runPushCampaignBatch(liveInput({ cursor: "reg-9" }), {
      store,
      transport,
      config: config({ campaignsEnabled: false }),
      now: () => NOW,
    })

    expect(result.status).toBe("paused")
    expect(calls.startSending).toEqual([])
    expect(calls.markMissed).toHaveLength(1)
    expect(sent).toEqual([])
  })
})

describe("the first page of a group", () => {
  it("moves the campaign to sending and the zones to dispatching", async () => {
    const { store, calls } = fakeStore()
    const { transport } = fakeTransport()

    await runPushCampaignBatch(liveInput(), {
      store,
      transport,
      config: config(),
      now: () => NOW,
    })

    expect(calls.startSending).toEqual([{ campaignId: CAMPAIGN_ID }])
    expect(calls.markZones[0]).toMatchObject({
      from: ["PENDING"],
      to: "DISPATCHING",
    })
  })

  it("does not move the campaign again on a later page", async () => {
    const { store, calls } = fakeStore()
    const { transport } = fakeTransport()

    await runPushCampaignBatch(liveInput({ cursor: "reg-3" }), {
      store,
      transport,
      config: config(),
      now: () => NOW,
    })

    expect(calls.startSending).toEqual([])
  })

  it("marks the zones dispatched and logs one line when the group is exhausted", async () => {
    const { store, calls } = fakeStore()
    const { transport } = fakeTransport()

    const result = await runPushCampaignBatch(liveInput(), {
      store,
      transport,
      config: config(),
      now: () => NOW,
    })

    expect(result.status).toBe("exhausted")
    expect(calls.markZones.at(-1)).toMatchObject({ to: "DISPATCHED" })
    expect(
      logs.filter((line) => line.includes("event=zone_dispatched")),
    ).toHaveLength(1)
  })
})

describe("the send set", () => {
  it("returns only a cursor and counts, never the page contents", async () => {
    const { store } = fakeStore(
      {
        readAudiencePage: vi.fn(async () => ({
          audience: [registration(1), registration(2)],
          unreachable: [],
          nextCursor: "reg-2",
        })),
      },
      [registration(1), registration(2)],
    )
    const { transport } = fakeTransport()

    const result = await runPushCampaignBatch(liveInput(), {
      store,
      transport,
      config: config(),
      now: () => NOW,
    })

    expect(Object.keys(result).sort()).toEqual([
      "counts",
      "nextCursor",
      "status",
    ])
    expect(result.nextCursor).toBe("reg-2")
    expect(result.status).toBe("continue")
    expect(JSON.stringify(result)).not.toContain("ExponentPushToken")
  })

  it("records an unreachable phone without sending to it", async () => {
    const { store, calls } = fakeStore({
      readAudiencePage: vi.fn(async () => ({
        audience: [registration(1)],
        unreachable: [registration(2, { platform: "ANDROID", country: "CN" })],
        nextCursor: null,
      })),
    })
    const { transport, sent } = fakeTransport()

    const result = await runPushCampaignBatch(liveInput(), {
      store,
      transport,
      config: config(),
      now: () => NOW,
    })

    expect(calls.unreachable).toEqual(["reg-2"])
    expect(result.counts.unreachable).toBe(1)
    expect(sent[0].map((message) => message.token)).toEqual([
      "ExponentPushToken[token-1]",
    ])
  })

  it("adds a reserved row this campaign already holds, so a replay resends it once", async () => {
    const replayedRow = {
      id: "delivery-replayed",
      nonce: "r".repeat(43),
      registrationId: "reg-1",
      languageSlug: "english",
      country: "NZ",
      timeZone: "Pacific/Auckland",
    }
    const replayMoves: { deliveryIds: string[]; expected: unknown }[] = []
    const { store } = fakeStore({
      claimPage: vi.fn(async () => ({
        claimed: [],
        suppressed: [],
        alreadyClaimed: ["reg-1"],
      })),
      readReserved: vi.fn(async () => [replayedRow]),
      moveReservedToSending: vi.fn(
        async ({ deliveryIds, expectedCampaignStatus }) => {
          replayMoves.push({
            deliveryIds: [...deliveryIds],
            expected: expectedCampaignStatus,
          })
          return deliveryIds.includes(replayedRow.id) ? [replayedRow] : []
        },
      ),
    })
    const { transport } = fakeTransport()

    await runPushCampaignBatch(liveInput(), {
      store,
      transport,
      config: config(),
      now: () => NOW,
    })

    expect(replayMoves).toEqual([
      { deliveryIds: ["delivery-replayed"], expected: "SENDING" },
    ])
  })

  it("does not resend a row the replay finds already accepted", async () => {
    const { store, calls } = fakeStore({
      claimPage: vi.fn(async () => ({
        claimed: [],
        suppressed: [],
        alreadyClaimed: ["reg-1"],
      })),
      readReserved: vi.fn(async () => []),
    })
    const { transport, sent } = fakeTransport()

    const result = await runPushCampaignBatch(liveInput(), {
      store,
      transport,
      config: config(),
      now: () => NOW,
    })

    expect(calls.moveReserved).toEqual([])
    expect(sent).toEqual([])
    expect(result.counts.accepted).toBe(0)
  })

  it("skips a chunk whose rows another writer already moved", async () => {
    const { store } = fakeStore({
      moveReservedToSending: vi.fn(async () => []),
    })
    const { transport, sent } = fakeTransport()

    await runPushCampaignBatch(liveInput(), {
      store,
      transport,
      config: config(),
      now: () => NOW,
    })

    expect(sent).toEqual([])
  })

  it("names the campaign status the move must see, and passes null for a test send", async () => {
    const live = fakeStore()
    const test = fakeStore()
    const { transport } = fakeTransport()

    await runPushCampaignBatch(liveInput(), {
      store: live.store,
      transport,
      config: config(),
      now: () => NOW,
    })
    await runPushCampaignBatch(
      {
        campaignId: CAMPAIGN_ID,
        kind: "TEST",
        groupInstant: null,
        cursor: null,
      },
      { store: test.store, transport, config: config(), now: () => NOW },
    )

    expect(live.calls.moveReserved[0].expected).toBe("SENDING")
    expect(test.calls.moveReserved[0].expected).toBeNull()
  })

  it("splits a page into chunks of one hundred", async () => {
    const audience = Array.from({ length: 150 }, (_value, index) =>
      registration(index + 1),
    )
    const { store } = fakeStore(
      {
        readAudiencePage: vi.fn(async () => ({
          audience,
          unreachable: [],
          nextCursor: null,
        })),
      },
      audience,
    )
    const { transport, sent } = fakeTransport()

    await runPushCampaignBatch(liveInput(), {
      store,
      transport,
      config: config(),
      now: () => NOW,
    })

    expect(sent.map((chunk) => chunk.length)).toEqual([100, 50])
  })
})

describe("a test send", () => {
  it("reads the test devices, skips the daily claim, and skips the zones", async () => {
    const { store, calls } = fakeStore()
    const { transport, sent } = fakeTransport()

    const result = await runPushCampaignBatch(
      {
        campaignId: CAMPAIGN_ID,
        kind: "TEST",
        groupInstant: null,
        cursor: null,
      },
      { store, transport, config: config(), now: () => NOW },
    )

    expect(store.readTestDevices).toHaveBeenCalled()
    expect(store.readAudiencePage).not.toHaveBeenCalled()
    expect(calls.startSending).toEqual([])
    expect(calls.markZones).toEqual([])
    expect(sent).toHaveLength(1)
    expect(result.status).toBe("exhausted")
  })

  it("sends a test even while the campaign is still a draft", async () => {
    const { store } = fakeStore({
      readCampaign: vi.fn(async () => ({
        id: CAMPAIGN_ID,
        status: "DRAFT" as const,
        mode: "WAVE" as const,
        sendDate: null,
        localHour: null,
        destinationKind: "VIDEO" as const,
        destinationSlug: "jesus",
        audienceScope: "EVERYWHERE" as const,
        countries: [],
        languageFilter: [],
      })),
    })
    const { transport, sent } = fakeTransport()

    const result = await runPushCampaignBatch(
      {
        campaignId: CAMPAIGN_ID,
        kind: "TEST",
        groupInstant: null,
        cursor: null,
      },
      { store, transport, config: config(), now: () => NOW },
    )

    expect(result.status).toBe("exhausted")
    expect(sent).toHaveLength(1)
  })

  it("refuses a test send with no test device on the list", async () => {
    const { store } = fakeStore({
      readTestDevices: vi.fn(async () => []),
    })
    const { transport, sent } = fakeTransport()

    const result = await runPushCampaignBatch(
      {
        campaignId: CAMPAIGN_ID,
        kind: "TEST",
        groupInstant: null,
        cursor: null,
      },
      { store, transport, config: config(), now: () => NOW },
    )

    expect(result.counts.audience).toBe(0)
    expect(sent).toEqual([])
    expect(result.status).toBe("exhausted")
  })
})

describe("copy resolution", () => {
  it("sends each phone the copy its own language rung resolves", async () => {
    const audience = [
      registration(1, { appLanguageSlug: "french", phoneLocale: "fr-FR" }),
      registration(2, { appLanguageSlug: "swahili", phoneLocale: "en-GB" }),
    ]
    const { store } = fakeStore(
      {
        readCopy: vi.fn(async () => [
          { languageSlug: "english", title: "EN title", body: "EN body" },
          { languageSlug: "french", title: "FR title", body: "FR body" },
        ]),
        readLanguages: vi.fn(async () => [
          { slug: "english", bcp47: "en" },
          { slug: "french", bcp47: "fr" },
        ]),
        readAudiencePage: vi.fn(async () => ({
          audience,
          unreachable: [],
          nextCursor: null,
        })),
      },
      audience,
    )
    const captured: { title: string; body: string }[] = []
    const transport: PushTransport = {
      sendChunk: vi.fn(async (messages: readonly PushTransportMessage[]) => {
        captured.push(
          ...messages.map((message) => ({
            title: message.title,
            body: message.body,
          })),
        )
        return messages.map((_message, index: number) => ({
          kind: "accepted" as const,
          ticketId: `ticket-${index}`,
        }))
      }),
      fetchReceipts: vi.fn(async () => new Map()),
    }

    await runPushCampaignBatch(liveInput(), {
      store,
      transport,
      config: config(),
      now: () => NOW,
    })

    expect(captured).toEqual([
      { title: "FR title", body: "FR body" },
      { title: "EN title", body: "EN body" },
    ])
  })

  it("refuses the page when the campaign carries no English copy", async () => {
    const { store } = fakeStore({
      readCopy: vi.fn(async () => [
        { languageSlug: "french", title: "FR", body: "FR" },
      ]),
    })
    const { transport } = fakeTransport()

    await expect(
      runPushCampaignBatch(liveInput(), {
        store,
        transport,
        config: config(),
        now: () => NOW,
      }),
    ).rejects.toThrow(/English/)
  })

  it("refuses the page when the campaign names no destination", async () => {
    const { store } = fakeStore({
      readCampaign: vi.fn(async () => ({
        id: CAMPAIGN_ID,
        status: "SENDING" as const,
        mode: "WAVE" as const,
        sendDate: new Date(GROUP_INSTANT),
        localHour: 9,
        destinationKind: null,
        destinationSlug: null,
        audienceScope: "EVERYWHERE" as const,
        countries: [],
        languageFilter: [],
      })),
    })
    const { transport } = fakeTransport()

    await expect(
      runPushCampaignBatch(liveInput(), {
        store,
        transport,
        config: config(),
        now: () => NOW,
      }),
    ).rejects.toThrow(/destination/)
  })
})

describe("recording the provider's answer", () => {
  it("records a ticket per accepted row", async () => {
    const { store, calls } = fakeStore()
    const { transport } = fakeTransport()

    const result = await runPushCampaignBatch(liveInput(), {
      store,
      transport,
      config: config(),
      now: () => NOW,
    })

    expect(calls.accepted).toEqual([{ id: "delivery-1", ticketId: "ticket-1" }])
    expect(result.counts.accepted).toBe(1)
  })

  it("retires the token and the registration on a dead-token ticket", async () => {
    const { store, calls } = fakeStore()
    const { transport } = fakeTransport(async () => [
      { kind: "dead_token", providerCode: "DeviceNotRegistered" },
    ])

    const result = await runPushCampaignBatch(liveInput(), {
      store,
      transport,
      config: config(),
      now: () => NOW,
    })

    expect(calls.deadTokens).toEqual([
      {
        deliveryId: "delivery-1",
        registrationId: "reg-1",
        error: "DeviceNotRegistered",
      },
    ])
    expect(result.counts.invalid).toBe(1)
  })

  it("never writes the provider's message on a failed row", async () => {
    const { store, calls } = fakeStore()
    const { transport } = fakeTransport(async () => [
      { kind: "failed", providerCode: "MessageTooBig" },
    ])

    const result = await runPushCampaignBatch(liveInput(), {
      store,
      transport,
      config: config(),
      now: () => NOW,
    })

    expect(calls.failed).toEqual([
      { id: "delivery-1", error: "MessageTooBig", status: "FAILED" },
    ])
    expect(result.counts.failed).toBe(1)
  })
})

describe("the transport's error classes", () => {
  it("reverts the chunk and raises on a rate limit that outlives its retries", async () => {
    const { store, calls } = fakeStore()
    const transport: PushTransport = {
      sendChunk: vi.fn(async () => {
        throw new PushProviderRetryableError("http_429")
      }),
      fetchReceipts: vi.fn(async () => new Map()),
    }

    await expect(
      runPushCampaignBatch(liveInput(), {
        store,
        transport,
        config: config(),
        now: () => NOW,
        backoffMs: () => 0,
      }),
    ).rejects.toBeInstanceOf(PushProviderRetryableError)
    // Each attempt reverts its own chunk before it backs off, so the reverts
    // count the attempts and every one names the same rows.
    expect(calls.revert).toHaveLength(PUSH_CHUNK_RETRY_ATTEMPTS)
    expect(
      new Set(calls.revert.map((call) => call.deliveryIds.join(","))),
    ).toEqual(new Set(["delivery-1"]))
    expect(
      logs.filter((line) => line.includes("event=provider_retry")),
    ).toHaveLength(PUSH_CHUNK_RETRY_ATTEMPTS)
  })

  it("sends the chunk once when the retry succeeds", async () => {
    const { store, calls } = fakeStore()
    let attempts = 0
    const transport: PushTransport = {
      sendChunk: vi.fn(async (messages: readonly PushTransportMessage[]) => {
        attempts += 1
        if (attempts === 1) throw new PushProviderRetryableError("http_429")
        return messages.map((_message, index: number) => ({
          kind: "accepted" as const,
          ticketId: `ticket-${index + 1}`,
        }))
      }),
      fetchReceipts: vi.fn(async () => new Map()),
    }

    const result = await runPushCampaignBatch(liveInput(), {
      store,
      transport,
      config: config(),
      now: () => NOW,
      backoffMs: () => 0,
    })

    expect(attempts).toBe(2)
    expect(result.counts.accepted).toBe(1)
    expect(calls.accepted).toEqual([{ id: "delivery-1", ticketId: "ticket-1" }])
  })

  it("stops the chunk when a cancel lands between two attempts", async () => {
    const { store, calls } = fakeStore()
    const firstClaim = store.moveReservedToSending
    let claims = 0
    store.moveReservedToSending = vi.fn(async (args) => {
      claims += 1
      if (claims === 1) return firstClaim(args)
      // The cancel moved the campaign off sending, so the guarded re-claim
      // matches no row. Recorded so the guard itself can be read back.
      calls.moveReserved.push({
        deliveryIds: [...args.deliveryIds],
        expected: args.expectedCampaignStatus,
      })
      return []
    })
    let attempts = 0
    const transport: PushTransport = {
      sendChunk: vi.fn(async (messages: readonly PushTransportMessage[]) => {
        attempts += 1
        if (attempts === 1) throw new PushProviderRetryableError("http_429")
        return messages.map((_message, index: number) => ({
          kind: "accepted" as const,
          ticketId: `ticket-${index + 1}`,
        }))
      }),
      fetchReceipts: vi.fn(async () => new Map()),
    }

    const result = await runPushCampaignBatch(liveInput(), {
      store,
      transport,
      config: config(),
      now: () => NOW,
      backoffMs: () => 0,
    })

    // One send, one revert, and no second send: the re-claim carried the
    // status the page claimed under, so the cancel stopped the chunk.
    expect(attempts).toBe(1)
    expect(calls.revert).toHaveLength(1)
    expect(calls.moveReserved.at(-1)?.expected).toBe(PushCampaignStatus.SENDING)
    expect(result.status).toBe("cancelled")
    expect(calls.accepted).toEqual([])
  })

  it("leaves an indeterminate chunk at sending, so the receipts call it unknown", async () => {
    const { store, calls } = fakeStore()
    const transport: PushTransport = {
      sendChunk: vi.fn(async () => {
        throw new PushProviderIndeterminateError("provider_timeout")
      }),
      fetchReceipts: vi.fn(async () => new Map()),
    }

    const result = await runPushCampaignBatch(liveInput(), {
      store,
      transport,
      config: config(),
      now: () => NOW,
    })

    expect(calls.revert).toEqual([])
    expect(calls.accepted).toEqual([])
    expect(result.counts.indeterminate).toBe(1)
    expect(result.status).toBe("exhausted")
  })

  it("fails every row in an oversized chunk and keeps going", async () => {
    const audience = Array.from({ length: 150 }, (_value, index) =>
      registration(index + 1),
    )
    const { store, calls } = fakeStore(
      {
        readAudiencePage: vi.fn(async () => ({
          audience,
          unreachable: [],
          nextCursor: null,
        })),
      },
      audience,
    )
    let chunks = 0
    const transport: PushTransport = {
      sendChunk: vi.fn(async (messages: readonly PushTransportMessage[]) => {
        chunks += 1
        if (chunks === 1) throw new PushProviderFatalError("MESSAGE_TOO_BIG")
        return messages.map((_message, index: number) => ({
          kind: "accepted" as const,
          ticketId: `ticket-${index}`,
        }))
      }),
      fetchReceipts: vi.fn(async () => new Map()),
    }

    const result = await runPushCampaignBatch(liveInput(), {
      store,
      transport,
      config: config(),
      now: () => NOW,
    })

    expect(chunks).toBe(2)
    expect(calls.failed).toHaveLength(100)
    expect(calls.failed[0]).toMatchObject({
      error: "MESSAGE_TOO_BIG",
      status: "FAILED",
    })
    expect(result.counts.accepted).toBe(50)
  })

  it("stops the whole page on bad credentials and logs the auth failure", async () => {
    const audience = Array.from({ length: 150 }, (_value, index) =>
      registration(index + 1),
    )
    const { store, calls } = fakeStore(
      {
        readAudiencePage: vi.fn(async () => ({
          audience,
          unreachable: [],
          nextCursor: null,
        })),
      },
      audience,
    )
    let chunks = 0
    const transport: PushTransport = {
      sendChunk: vi.fn(async () => {
        chunks += 1
        throw new PushProviderAuthError("UNAUTHORIZED")
      }),
      fetchReceipts: vi.fn(async () => new Map()),
    }

    await expect(
      runPushCampaignBatch(liveInput(), {
        store,
        transport,
        config: config(),
        now: () => NOW,
      }),
    ).rejects.toBeInstanceOf(PushProviderAuthError)
    expect(chunks).toBe(1)
    expect(calls.failed).toHaveLength(100)
    expect(
      logs.some((line) => line.includes("event=provider_auth_failed")),
    ).toBe(true)
  })

  it("never writes a provider message into a log line", async () => {
    const { store } = fakeStore()
    const transport: PushTransport = {
      sendChunk: vi.fn(async () => {
        const error = new PushProviderAuthError("UNAUTHORIZED")
        Object.assign(error, {
          message: "ExponentPushToken[secret] is not registered",
        })
        throw error
      }),
      fetchReceipts: vi.fn(async () => new Map()),
    }

    await runPushCampaignBatch(liveInput(), {
      store,
      transport,
      config: config(),
      now: () => NOW,
    }).catch(() => undefined)

    expect(logs.join("\n")).not.toContain("ExponentPushToken")
  })
})

describe("the step budget", () => {
  it("defers the next chunk at the reserve and returns the same cursor", async () => {
    const audience = Array.from({ length: 250 }, (_value, index) =>
      registration(index + 1),
    )
    const { store } = fakeStore(
      {
        readAudiencePage: vi.fn(async () => ({
          audience,
          unreachable: [],
          nextCursor: "reg-250",
        })),
      },
      audience,
    )
    const { transport, sent } = fakeTransport()
    let clock = new Date(GROUP_INSTANT).getTime()

    const result = await runPushCampaignBatch(liveInput({ cursor: "reg-0" }), {
      store,
      transport,
      config: config({ stepMaxDurationMs: 50_000, stepReserveMs: 40_000 }),
      // Each read of the clock advances it, so the second chunk sees a budget
      // already inside the reserve.
      now: () => {
        clock += 6_000
        return new Date(clock)
      },
    })

    expect(result.status).toBe("deferred")
    expect(result.nextCursor).toBe("reg-0")
    expect(sent).toHaveLength(1)
  })
})
