import { afterEach, describe, expect, it, vi } from "vitest"

import { recordHistoryAttempt } from "./catalog-generation"

describe("GA report attempt accounting", () => {
  afterEach(() => vi.unstubAllGlobals())

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
