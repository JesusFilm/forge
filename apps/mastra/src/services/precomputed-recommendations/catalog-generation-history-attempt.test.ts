import { afterEach, describe, expect, it, vi } from "vitest"

import { recordHistoryAttempt } from "./catalog-generation"
import { readGaWatchStartAggregatePage } from "./ga-watch-history"

describe("GA report attempt accounting", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  const report = JSON.stringify({
    dimensionHeaders: [
      { name: "pagePath" },
      { name: "customEvent:mediacomponentid" },
    ],
    metricHeaders: [{ name: "eventCount" }],
    rowCount: 1,
    rows: [
      {
        dimensionValues: [
          { value: "/watch/film.html/english.html" },
          { value: "media-id" },
        ],
        metricValues: [{ value: "4" }],
      },
    ],
    metadata: { timeZone: "America/New_York" },
  })
  const pageInput = {
    propertyId: "320198532",
    serviceAccountEmail:
      "watch-ga4-readonly@jesusfilm-org-1738781064783.iam.gserviceaccount.com",
    rangeStart: "2022-08-07",
    rangeEnd: "2026-10-05",
    offset: 0,
    limit: 1,
    tokenProvider: async () => ({
      ok: true as const,
      accessToken: "test-token",
    }),
  }

  it("gives all three same-report GA attempts separate heartbeats, reservations and receipts", async () => {
    vi.useFakeTimers()
    const events: string[] = []
    const ingest = vi.fn(async (raw: unknown) => {
      const call = raw as { action: string; callId?: string }
      events.push(call.action)
      if (call.action === "heartbeat") return { sourceState: "claimed" }
      if (call.action === "history_call_start")
        return { state: "pending", callId: call.callId }
      return { receiptStored: true }
    })
    let sent = 0
    const physical = vi.fn(async () => {
      sent += 1
      events.push("http")
      return sent < 3
        ? new Response("bad gateway", { status: 502 })
        : new Response(report, { status: 200 })
    }) as typeof fetch
    let reserved = 0
    const fetchImpl = (url: URL | RequestInfo, init?: RequestInit) =>
      recordHistoryAttempt({
        ingest,
        generationId: "generation-one",
        generationInputDigest: "a".repeat(64),
        sourceVideoId: "source-one",
        leaseToken: "a8f8a8f8-1111-4111-8111-a8f8a8f8a8f8",
        stage: reserved++ === 0 ? "snapshot_page" : "retry",
        requestDigest: "b".repeat(64),
        url,
        init,
        fetchImpl: physical,
      })
    const pending = readGaWatchStartAggregatePage({
      ...pageInput,
      fetchImpl,
    })
    const assertion = expect(pending).resolves.toMatchObject({
      requestCount: 3,
      rows: [{ starts: 4 }],
    })
    await vi.advanceTimersByTimeAsync(90_000)
    await assertion
    expect(events).toEqual(
      Array(3)
        .fill(["heartbeat", "history_call_start", "http", "history_call"])
        .flat(),
    )
    const starts = ingest.mock.calls
      .map(
        ([call]) =>
          call as {
            action: string
            callId?: string
            stage?: string
            requestDigest?: string
          },
      )
      .filter(({ action }) => action === "history_call_start")
    expect(starts.map(({ stage }) => stage)).toEqual([
      "snapshot_page",
      "retry",
      "retry",
    ])
    expect(new Set(starts.map(({ callId }) => callId)).size).toBe(3)
    expect(new Set(starts.map(({ requestDigest }) => requestDigest)).size).toBe(
      1,
    )
    const receipts = ingest.mock.calls
      .map(
        ([call]) =>
          call as { action: string; callId?: string; status?: string },
      )
      .filter(({ action }) => action === "history_call")
    expect(receipts.map(({ status }) => status)).toEqual([
      "failed",
      "failed",
      "succeeded",
    ])
    expect(receipts.map(({ callId }) => callId)).toEqual(
      starts.map(({ callId }) => callId),
    )
  })

  it("stops after a retry's lease heartbeat fails before another physical request", async () => {
    vi.useFakeTimers()
    const pause = new Error("stale_source_claim")
    let heartbeats = 0
    const ingest = vi.fn(async (raw: unknown) => {
      const call = raw as { action: string; callId?: string }
      if (call.action === "heartbeat") {
        heartbeats += 1
        if (heartbeats === 2) throw pause
        return { sourceState: "claimed" }
      }
      if (call.action === "history_call_start")
        return { state: "pending", callId: call.callId }
      return { receiptStored: true }
    })
    const physical = vi.fn(
      async () => new Response("bad gateway", { status: 502 }),
    ) as typeof fetch
    const fetchImpl = (url: URL | RequestInfo, init?: RequestInit) =>
      recordHistoryAttempt({
        ingest,
        generationId: "generation-one",
        generationInputDigest: "a".repeat(64),
        sourceVideoId: "source-one",
        leaseToken: "a8f8a8f8-1111-4111-8111-a8f8a8f8a8f8",
        stage: "retry",
        requestDigest: "b".repeat(64),
        url,
        init,
        fetchImpl: physical,
      })
    const pending = readGaWatchStartAggregatePage({ ...pageInput, fetchImpl })
    const assertion = expect(pending).rejects.toBe(pause)
    await vi.advanceTimersByTimeAsync(30_000)
    await assertion
    expect(heartbeats).toBe(2)
    expect(physical).toHaveBeenCalledTimes(1)
    expect(
      ingest.mock.calls.filter(
        ([call]) => (call as { action: string }).action === "history_call",
      ),
    ).toHaveLength(1)
  })

  it("does not retry after a paid attempt's terminal receipt fails to persist", async () => {
    const receiptFailure = new Error("protected_receipt_unstored")
    const ingest = vi.fn(async (raw: unknown) => {
      const call = raw as { action: string; callId?: string }
      if (call.action === "heartbeat") return { sourceState: "claimed" }
      if (call.action === "history_call_start")
        return { state: "pending", callId: call.callId }
      throw receiptFailure
    })
    const physical = vi.fn(
      async () => new Response("bad gateway", { status: 502 }),
    ) as typeof fetch
    const fetchImpl = (url: URL | RequestInfo, init?: RequestInit) =>
      recordHistoryAttempt({
        ingest,
        generationId: "generation-one",
        generationInputDigest: "a".repeat(64),
        sourceVideoId: "source-one",
        leaseToken: "a8f8a8f8-1111-4111-8111-a8f8a8f8a8f8",
        stage: "snapshot_page",
        requestDigest: "b".repeat(64),
        url,
        init,
        fetchImpl: physical,
      })
    await expect(
      readGaWatchStartAggregatePage({ ...pageInput, fetchImpl }),
    ).rejects.toBe(receiptFailure)
    expect(physical).toHaveBeenCalledTimes(1)
    expect(
      ingest.mock.calls.filter(
        ([call]) =>
          (call as { action: string }).action === "history_call_start",
      ),
    ).toHaveLength(1)
  })

  it("reserves each actual HTTP attempt before sending and records failed retries separately", async () => {
    const events: string[] = []
    const ingest = vi.fn(async (raw: unknown) => {
      const { action, callId } = raw as { action: string; callId: string }
      events.push(action)
      return action === "history_call_start"
        ? { state: "pending", callId }
        : { receiptStored: true }
    })
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockImplementationOnce(async () => {
          events.push("http")
          return new Response("unavailable", { status: 503 })
        })
        .mockImplementationOnce(async () => {
          events.push("http")
          return new Response("{}", { status: 200 })
        }),
    )
    const common = {
      ingest,
      generationId: "generation-one",
      generationInputDigest: "a".repeat(64),
      requestDigest: "b".repeat(64),
      url: new URL("https://analyticsdata.googleapis.com/v1beta/report"),
      init: { method: "POST", body: "{}" },
    }
    expect(
      (await recordHistoryAttempt({ ...common, stage: "qualification" }))
        .status,
    ).toBe(503)
    expect(
      (await recordHistoryAttempt({ ...common, stage: "retry" })).status,
    ).toBe(200)
    expect(events).toEqual([
      "history_call_start",
      "http",
      "history_call",
      "history_call_start",
      "http",
      "history_call",
    ])
    const starts = ingest.mock.calls
      .map(
        ([call]) => call as { action: string; callId: string; stage?: string },
      )
      .filter((call) => call.action === "history_call_start")
    expect(starts.map((call) => call.stage)).toEqual(["qualification", "retry"])
    expect(new Set(starts.map((call) => call.callId)).size).toBe(2)
    const receipts = ingest.mock.calls
      .map(([call]) => call as Record<string, unknown>)
      .filter((call) => call.action === "history_call")
    expect(receipts.map((call) => call.status)).toEqual(["failed", "succeeded"])
    expect(receipts.every((call) => !Object.hasOwn(call, "costUsd"))).toBe(true)
    expect(
      receipts.every((call) => !Object.hasOwn(call, "bytesProcessed")),
    ).toBe(true)
  })

  it("renews a long source read before every page and stops on a stale lease", async () => {
    const sequence: string[] = []
    let heartbeatCount = 0
    const ingest = vi.fn(async (raw: unknown) => {
      const call = raw as { action: string; callId?: string }
      sequence.push(call.action)
      if (call.action === "heartbeat")
        return {
          sourceState: ++heartbeatCount <= 2 ? "claimed" : "failed",
        }
      if (call.action === "history_call_start")
        return { state: "pending", callId: call.callId }
      return { receiptStored: true }
    })
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => {
      sequence.push("http")
      return new Response("{}", { status: 200 })
    })
    vi.stubGlobal("fetch", transport)
    const common = {
      ingest,
      generationId: "generation-one",
      generationInputDigest: "a".repeat(64),
      sourceVideoId: "source-one",
      leaseToken: "a8f8a8f8-1111-4111-8111-a8f8a8f8a8f8",
      stage: "snapshot_page" as const,
      url: new URL("https://analyticsdata.googleapis.com/v1beta/report"),
      init: { method: "POST", body: "{}" },
    }
    await recordHistoryAttempt({ ...common, requestDigest: "b".repeat(64) })
    await recordHistoryAttempt({ ...common, requestDigest: "c".repeat(64) })
    await expect(
      recordHistoryAttempt({ ...common, requestDigest: "d".repeat(64) }),
    ).rejects.toThrow("admin_contract_rejected")
    expect(sequence).toEqual([
      "heartbeat",
      "history_call_start",
      "http",
      "history_call",
      "heartbeat",
      "history_call_start",
      "http",
      "history_call",
      "heartbeat",
    ])
    expect(transport).toHaveBeenCalledTimes(2)
  })
})
