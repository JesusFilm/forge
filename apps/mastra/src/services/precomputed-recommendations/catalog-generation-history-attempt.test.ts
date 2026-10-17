import { afterEach, describe, expect, it, vi } from "vitest"

import { recordHistoryAttempt } from "./catalog-generation"
import { fetchGaPhysical } from "./ga-physical-transport"
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

  it("retries a settled physical connection reset before returning the page", async () => {
    vi.useFakeTimers()
    const events: string[] = []
    const reset = new TypeError("fetch failed", {
      cause: Object.assign(new Error("connection reset"), {
        code: "ECONNRESET",
      }),
    })
    const ingest = vi.fn(async (raw: unknown) => {
      const call = raw as { action: string; callId?: string }
      events.push(call.action)
      return call.action === "history_call_start"
        ? { state: "pending", callId: call.callId }
        : { receiptStored: true }
    })
    const physical = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () => {
        events.push("http")
        throw reset
      })
      .mockImplementationOnce(async () => {
        events.push("http")
        return new Response(report, { status: 200 })
      })
    vi.stubGlobal("fetch", physical)
    let reserved = 0
    const pending = readGaWatchStartAggregatePage({
      ...pageInput,
      fetchImpl: (url, init) =>
        recordHistoryAttempt({
          ingest,
          generationId: "generation-one",
          generationInputDigest: "a".repeat(64),
          stage: reserved++ === 0 ? "snapshot_page" : "retry",
          requestDigest: "b".repeat(64),
          url,
          init,
        }),
    })
    const assertion = expect(pending).resolves.toMatchObject({
      requestCount: 2,
      rows: [{ starts: 4 }],
    })
    await vi.advanceTimersByTimeAsync(30_000)
    await assertion
    expect(events).toEqual([
      "history_call_start",
      "http",
      "history_call",
      "history_call_start",
      "http",
      "history_call",
    ])
    expect(physical).toHaveBeenCalledTimes(2)
    const starts = ingest.mock.calls
      .map(
        ([call]) => call as { action: string; stage?: string; callId?: string },
      )
      .filter(({ action }) => action === "history_call_start")
    expect(starts.map(({ stage }) => stage)).toEqual(["snapshot_page", "retry"])
    expect(new Set(starts.map(({ callId }) => callId)).size).toBe(2)
    expect(
      ingest.mock.calls
        .map(
          ([call]) =>
            call as { action: string; status?: string; errorCode?: string },
        )
        .filter(({ action }) => action === "history_call"),
    ).toMatchObject([
      { status: "failed", errorCode: "analytics_unavailable" },
      { status: "succeeded" },
    ])
  })

  it("retries a physical failure inside an admitted external fetch adapter", async () => {
    vi.useFakeTimers()
    const reset = new TypeError("fetch failed", {
      cause: Object.assign(new Error("connection reset"), {
        code: "ECONNRESET",
      }),
    })
    const physical = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(reset)
      .mockResolvedValueOnce(new Response(report, { status: 200 }))
    const admit = vi.fn(async () => undefined)
    const ingest = vi.fn(async (raw: unknown) => {
      const call = raw as { action: string; callId?: string }
      return call.action === "history_call_start"
        ? { state: "pending", callId: call.callId }
        : { receiptStored: true }
    })
    const pending = readGaWatchStartAggregatePage({
      ...pageInput,
      fetchImpl: (url, init) =>
        recordHistoryAttempt({
          ingest,
          generationId: "generation-one",
          generationInputDigest: "a".repeat(64),
          stage: "snapshot_page",
          requestDigest: "b".repeat(64),
          url,
          init,
          fetchImpl: async (resource, requestInit) => {
            await admit()
            return fetchGaPhysical(resource, requestInit, physical)
          },
        }),
    })
    const assertion = expect(pending).resolves.toMatchObject({
      requestCount: 2,
      rows: [{ starts: 4 }],
    })
    await vi.advanceTimersByTimeAsync(30_000)
    await assertion
    expect(admit).toHaveBeenCalledTimes(2)
    expect(physical).toHaveBeenCalledTimes(2)
    expect(
      ingest.mock.calls.filter(
        ([call]) => (call as { action: string }).action === "history_call",
      ),
    ).toHaveLength(2)
  })

  it("does not retry a quota-admission TypeError with the same native cause before physical fetch", async () => {
    const localFailure = new TypeError("quota admission failed", {
      cause: Object.assign(new Error("connection reset"), {
        code: "ECONNRESET",
      }),
    })
    const admit = vi.fn(async () => {
      throw localFailure
    })
    const physical = vi.fn<typeof fetch>()
    const ingest = vi.fn(async (raw: unknown) => {
      const call = raw as { action: string; callId?: string }
      return call.action === "history_call_start"
        ? { state: "pending", callId: call.callId }
        : { receiptStored: true }
    })
    await expect(
      readGaWatchStartAggregatePage({
        ...pageInput,
        fetchImpl: (url, init) =>
          recordHistoryAttempt({
            ingest,
            generationId: "generation-one",
            generationInputDigest: "a".repeat(64),
            stage: "snapshot_page",
            requestDigest: "b".repeat(64),
            url,
            init,
            fetchImpl: async (resource, requestInit) => {
              await admit()
              return fetchGaPhysical(resource, requestInit, physical)
            },
          }),
      }),
    ).rejects.toBe(localFailure)
    expect(admit).toHaveBeenCalledOnce()
    expect(physical).not.toHaveBeenCalled()
    expect(
      ingest.mock.calls
        .map(([call]) => call as { action: string; errorCode?: string })
        .filter(({ action }) => action === "history_call"),
    ).toMatchObject([{ errorCode: "analytics_unavailable" }])
  })

  it.each([
    ["arbitrary TypeError", new TypeError("fetch failed")],
    ["cancellation", new DOMException("cancelled", "AbortError")],
  ])("does not retry %s from the physical fetch", async (_label, failure) => {
    const physical = vi.fn<typeof fetch>().mockRejectedValue(failure)
    const ingest = vi.fn(async (raw: unknown) => {
      const call = raw as { action: string; callId?: string }
      return call.action === "history_call_start"
        ? { state: "pending", callId: call.callId }
        : { receiptStored: true }
    })
    await expect(
      readGaWatchStartAggregatePage({
        ...pageInput,
        fetchImpl: (url, init) =>
          recordHistoryAttempt({
            ingest,
            generationId: "generation-one",
            generationInputDigest: "a".repeat(64),
            stage: "snapshot_page",
            requestDigest: "b".repeat(64),
            url,
            init,
            fetchImpl: (resource, requestInit) =>
              fetchGaPhysical(resource, requestInit, physical),
          }),
      }),
    ).rejects.toBe(failure)
    expect(physical).toHaveBeenCalledOnce()
    expect(
      ingest.mock.calls.filter(
        ([call]) => (call as { action: string }).action === "history_call",
      ),
    ).toHaveLength(1)
  })

  it("does not retry a native-looking failure after its request signal aborts", async () => {
    const controller = new AbortController()
    const failure = new TypeError("fetch failed", {
      cause: Object.assign(new Error("connection reset"), {
        code: "ECONNRESET",
      }),
    })
    const physical = vi.fn<typeof fetch>().mockImplementation(async () => {
      controller.abort()
      throw failure
    })
    const ingest = vi.fn(async (raw: unknown) => {
      const call = raw as { action: string; callId?: string }
      return call.action === "history_call_start"
        ? { state: "pending", callId: call.callId }
        : { receiptStored: true }
    })
    await expect(
      readGaWatchStartAggregatePage({
        ...pageInput,
        fetchImpl: (url, init) =>
          recordHistoryAttempt({
            ingest,
            generationId: "generation-one",
            generationInputDigest: "a".repeat(64),
            stage: "snapshot_page",
            requestDigest: "b".repeat(64),
            url,
            init: { ...init, signal: controller.signal },
            fetchImpl: (resource, requestInit) =>
              fetchGaPhysical(resource, requestInit, physical),
          }),
      }),
    ).rejects.toBe(failure)
    expect(physical).toHaveBeenCalledOnce()
  })

  it("does not retry when the physical failure's terminal receipt cannot persist", async () => {
    const connectionReset = () =>
      new TypeError("fetch failed", {
        cause: Object.assign(new Error("connection reset"), {
          code: "ECONNRESET",
        }),
      })
    const physicalFailure = connectionReset()
    const receiptFailure = connectionReset()
    const physical = vi.fn<typeof fetch>().mockRejectedValue(physicalFailure)
    const ingest = vi.fn(async (raw: unknown) => {
      const call = raw as { action: string; callId?: string }
      if (call.action === "history_call_start")
        return { state: "pending", callId: call.callId }
      if (call.action === "history_call") throw receiptFailure
      return { receiptStored: true }
    })
    await expect(
      readGaWatchStartAggregatePage({
        ...pageInput,
        fetchImpl: (url, init) =>
          recordHistoryAttempt({
            ingest,
            generationId: "generation-one",
            generationInputDigest: "a".repeat(64),
            stage: "snapshot_page",
            requestDigest: "b".repeat(64),
            url,
            init,
            fetchImpl: (resource, requestInit) =>
              fetchGaPhysical(resource, requestInit, physical),
          }),
      }),
    ).rejects.toBe(receiptFailure)
    expect(physical).toHaveBeenCalledOnce()
    expect(
      ingest.mock.calls.filter(
        ([call]) =>
          (call as { action: string }).action === "history_call_start",
      ),
    ).toHaveLength(1)
    expect(
      ingest.mock.calls.filter(
        ([call]) => (call as { action: string }).action === "history_call",
      ),
    ).toHaveLength(1)
  })

  it("exhausts the same three-attempt budget across physical and HTTP failures", async () => {
    vi.useFakeTimers()
    const reset = () =>
      new TypeError("fetch failed", {
        cause: Object.assign(new Error("connection reset"), {
          code: "ECONNRESET",
        }),
      })
    const first = reset()
    const final = reset()
    const physical = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(first)
      .mockResolvedValueOnce(new Response("bad gateway", { status: 502 }))
      .mockRejectedValueOnce(final)
    vi.stubGlobal("fetch", physical)
    const ingest = vi.fn(async (raw: unknown) => {
      const call = raw as { action: string; callId?: string }
      return call.action === "history_call_start"
        ? { state: "pending", callId: call.callId }
        : { receiptStored: true }
    })
    let reserved = 0
    const pending = readGaWatchStartAggregatePage({
      ...pageInput,
      fetchImpl: (url, init) =>
        recordHistoryAttempt({
          ingest,
          generationId: "generation-one",
          generationInputDigest: "a".repeat(64),
          stage: reserved++ === 0 ? "snapshot_page" : "retry",
          requestDigest: "b".repeat(64),
          url,
          init,
        }),
    })
    const assertion = expect(pending).rejects.toBe(final)
    await vi.advanceTimersByTimeAsync(90_000)
    await assertion
    expect(physical).toHaveBeenCalledTimes(3)
    const starts = ingest.mock.calls
      .map(
        ([call]) => call as { action: string; stage?: string; callId?: string },
      )
      .filter(({ action }) => action === "history_call_start")
    expect(starts.map(({ stage }) => stage)).toEqual([
      "snapshot_page",
      "retry",
      "retry",
    ])
    expect(new Set(starts.map(({ callId }) => callId)).size).toBe(3)
    expect(
      ingest.mock.calls
        .map(
          ([call]) =>
            call as { action: string; status?: string; errorCode?: string },
        )
        .filter(({ action }) => action === "history_call"),
    ).toMatchObject([
      { status: "failed", errorCode: "analytics_unavailable" },
      { status: "failed", errorCode: "ga_http_502" },
      { status: "failed", errorCode: "analytics_unavailable" },
    ])
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
    expect(receipts[0]?.errorCode).toBe("ga_http_503")
    expect(receipts.every((call) => !Object.hasOwn(call, "costUsd"))).toBe(true)
    expect(
      receipts.every((call) => !Object.hasOwn(call, "bytesProcessed")),
    ).toBe(true)
  })

  it("records an aborted request timeout without retrying or changing the thrown error", async () => {
    const controller = new AbortController()
    const timeout = new DOMException("request timed out", "TimeoutError")
    const ingest = vi.fn(async (raw: unknown) => {
      const call = raw as { action: string; callId?: string }
      return call.action === "history_call_start"
        ? { state: "pending", callId: call.callId }
        : { receiptStored: true }
    })
    const physical = vi.fn(async () => {
      controller.abort(timeout)
      throw timeout
    }) as typeof fetch
    await expect(
      recordHistoryAttempt({
        ingest,
        generationId: "generation-one",
        generationInputDigest: "a".repeat(64),
        stage: "snapshot_page",
        requestDigest: "b".repeat(64),
        url: new URL("https://analyticsdata.googleapis.com/v1beta/report"),
        init: { method: "POST", signal: controller.signal },
        fetchImpl: physical,
      }),
    ).rejects.toBe(timeout)
    const receipts = ingest.mock.calls
      .map(([call]) => call as Record<string, unknown>)
      .filter((call) => call.action === "history_call")
    expect(physical).toHaveBeenCalledOnce()
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({
      status: "failed",
      errorCode: "ga_timeout",
    })
  })

  it("records HTTP 429 without retrying the physical request", async () => {
    const ingest = vi.fn(async (raw: unknown) => {
      const call = raw as { action: string; callId?: string }
      return call.action === "history_call_start"
        ? { state: "pending", callId: call.callId }
        : { receiptStored: true }
    })
    const physical = vi.fn(async () => new Response("", { status: 429 }))
    await expect(
      readGaWatchStartAggregatePage({
        ...pageInput,
        fetchImpl: (url, init) =>
          recordHistoryAttempt({
            ingest,
            generationId: "generation-one",
            generationInputDigest: "a".repeat(64),
            stage: "snapshot_page",
            requestDigest: "b".repeat(64),
            url,
            init,
            fetchImpl: physical,
          }),
      }),
    ).rejects.toMatchObject({ code: "analytics_unavailable" })
    expect(physical).toHaveBeenCalledOnce()
    expect(
      ingest.mock.calls
        .map(([call]) => call as Record<string, unknown>)
        .find((call) => call.action === "history_call"),
    ).toMatchObject({ status: "failed", errorCode: "ga_http_429" })
  })

  it("keeps an unrelated TimeoutError generic when the request signal did not abort", async () => {
    const timeout = new DOMException("unrelated timeout", "TimeoutError")
    const ingest = vi.fn(async (raw: unknown) => {
      const call = raw as { action: string; callId?: string }
      return call.action === "history_call_start"
        ? { state: "pending", callId: call.callId }
        : { receiptStored: true }
    })
    await expect(
      recordHistoryAttempt({
        ingest,
        generationId: "generation-one",
        generationInputDigest: "a".repeat(64),
        stage: "snapshot_page",
        requestDigest: "b".repeat(64),
        url: new URL("https://analyticsdata.googleapis.com/v1beta/report"),
        init: { method: "POST", signal: new AbortController().signal },
        fetchImpl: async () => {
          throw timeout
        },
      }),
    ).rejects.toBe(timeout)
    expect(
      ingest.mock.calls
        .map(([call]) => call as Record<string, unknown>)
        .find((call) => call.action === "history_call"),
    ).toMatchObject({ status: "failed", errorCode: "analytics_unavailable" })
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
