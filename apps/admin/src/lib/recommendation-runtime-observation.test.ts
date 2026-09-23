import { performance } from "node:perf_hooks"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  observeRecommendationRuntime,
  startRecommendationDatabaseTransaction,
  startRecommendationTiming,
  timeRecommendationOperation,
} from "./recommendation-runtime-observation"

describe("recommendation runtime observation", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it("retains source start time and the longest repeated call's monotonic offset", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-09-23T02:00:00.000Z"))
    let now = 1_000
    vi.spyOn(performance, "now").mockImplementation(() => now)
    const log = vi.fn()
    await observeRecommendationRuntime(
      "seeded",
      async () => {
        now = 1_010
        const first = startRecommendationTiming("db.raw.$queryRaw")!
        now = 1_030
        first()
        now = 1_040
        const longest = startRecommendationTiming("db.raw.$queryRaw")!
        // A corrected wall clock must not distort the operation duration/offset.
        vi.setSystemTime(new Date("2026-09-22T02:00:00.000Z"))
        now = 1_120
        longest()
        now = 1_125
        const last = startRecommendationTiming("db.raw.$queryRaw")!
        now = 1_130
        last()
        return { result: "served" }
      },
      log,
    )
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({
      startedAt: "2026-09-23T02:00:00.000Z",
      elapsedMs: 130,
      timings: {
        "db.raw.$queryRaw": {
          calls: 3,
          inFlight: 0,
          firstStartedOffsetMs: 10,
          maxStartedOffsetMs: 40,
          maxMs: 80,
          elapsedMs: 105,
        },
      },
    })
  })

  it("aligns an unfinished operation's late rejection with its original source start", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-09-23T02:00:00.000Z"))
    let now = 1_000
    vi.spyOn(performance, "now").mockImplementation(() => now)
    const log = vi.fn()
    let finish: ReturnType<typeof startRecommendationTiming>
    await observeRecommendationRuntime(
      "seeded",
      async () => {
        now = 1_050
        finish = startRecommendationTiming("candidate_evidence.insert", 220)
        now = 1_080
        return { result: "unavailable", reason: "delivery_timeout" }
      },
      log,
    )
    const complete = JSON.parse(log.mock.calls[0][0])
    expect(complete.timings["candidate_evidence.insert"]).toMatchObject({
      firstStartedOffsetMs: 50,
      inFlight: 1,
      elapsedMs: 0,
    })
    expect(
      complete.timings["candidate_evidence.insert"].maxStartedOffsetMs,
    ).toBeUndefined()
    now = 1_250
    finish?.({ code: "P2028" }, true)
    expect(JSON.parse(log.mock.calls[1][0])).toMatchObject({
      observationId: complete.observationId,
      startedAt: "2026-09-23T02:00:00.000Z",
      phase: "late_operation",
      startedOffsetMs: 50,
      elapsedMs: 200,
      outcome: "rejected",
      errorCode: "P2028",
    })
  })

  it("correlates concurrent transactions without reusing identities or exceeding bounds", async () => {
    const logs: string[] = []
    expect(startRecommendationDatabaseTransaction()).toBeUndefined()
    const tags = await Promise.all(
      ["seeded", "for_you"].map((operation) =>
        observeRecommendationRuntime(
          operation as "seeded" | "for_you",
          async () => {
            const first = startRecommendationDatabaseTransaction()!
            first.recordBackend(1234)
            // Invalid backend metadata never changes the outcome or enters logs.
            first.recordBackend("private")
            for (let i = 1; i < 12; i++)
              startRecommendationDatabaseTransaction()?.recordBackend(2000 + i)
            return first.applicationName
          },
          (line) => logs.push(line),
        ),
      ),
    )
    expect(tags[0]).not.toBe(tags[1])
    for (const line of logs) {
      const event = JSON.parse(line)
      expect(event.databaseTransactions).toHaveLength(8)
      expect(event.omittedTransactions).toBe(4)
      expect(event.databaseTransactions[0]).toEqual({
        ordinal: 1,
        backendPid: 1234,
      })
      expect(tags).toContain(`watch:${event.observationId}:1`)
      expect(line).not.toContain("private")
    }
  })
  it("bounds timing labels below the forwarding envelope and counts omissions", async () => {
    const log = vi.fn()
    await observeRecommendationRuntime(
      "seeded",
      async () => {
        for (let i = 0; i < 8; i++)
          startRecommendationDatabaseTransaction()?.recordBackend(
            Number.MAX_SAFE_INTEGER,
          )
        for (let index = 0; index < 64; index++) {
          const label =
            "a".repeat(98) +
            String.fromCharCode(65 + Math.floor(index / 26), 65 + (index % 26))
          startRecommendationTiming(label, Number.MAX_SAFE_INTEGER)?.(
            { code: "P2010", meta: { code: "23514" } },
            true,
          )
        }
      },
      log,
    )
    const event = JSON.parse(log.mock.calls[0][0])
    expect(Object.keys(event.timings)).toHaveLength(32)
    expect(event.omittedTimings).toBe(32)
    expect(
      Buffer.byteLength(JSON.stringify({ message: log.mock.calls[0][0] })),
    ).toBeLessThan(14 * 1024)
  })
  it("retains a raw-query SQLSTATE without its database error message", async () => {
    const log = vi.fn()
    const error = Object.assign(new Error("private SQL"), {
      code: "P2010",
      meta: { code: "23514", message: "private parameters" },
    })
    await expect(
      observeRecommendationRuntime(
        "seeded",
        () =>
          timeRecommendationOperation("candidate_evidence.insert", async () => {
            throw error
          }),
        log,
      ),
    ).rejects.toBe(error)
    expect(
      JSON.parse(log.mock.calls[0][0]).timings["candidate_evidence.insert"],
    ).toMatchObject({ errorCode: "P2010", sqlState: "23514", errors: 1 })
    expect(log.mock.calls[0][0]).not.toContain("private")
  })
  it("distinguishes semantic timeouts from resolved selections without logging payloads", async () => {
    const logs: string[] = []
    const log = (line: string) => logs.push(line)
    const response = {
      result: "unavailable",
      reason: "delivery_timeout",
      capability: "private-capability",
    }
    expect(
      await observeRecommendationRuntime("seeded", async () => response, log),
    ).toBe(response)
    await observeRecommendationRuntime(
      "selection",
      async () => ({ status: "accepted", selectionId: "private-selection" }),
      log,
    )
    expect(logs.map((line) => JSON.parse(line))).toMatchObject([
      { operation: "seeded", outcome: "unavailable", timeoutFallback: true },
      { operation: "selection", outcome: "resolved", timeoutFallback: false },
    ])
    expect(logs.join()).not.toContain("private")
  })

  it("keeps concurrent observations separate, retains failed inner stages and rethrows the exact error", async () => {
    const logs: string[] = []
    const error = Object.assign(new Error("secret SQL parameters"), {
      code: "P2028",
    })
    await Promise.all([
      observeRecommendationRuntime(
        "seeded",
        async () => {
          await expect(
            timeRecommendationOperation(
              "persistence",
              async () => {
                throw error
              },
              120,
            ),
          ).rejects.toBe(error)
          return { result: "unavailable", reason: "delivery_timeout" }
        },
        (line) => logs.push(line),
      ),
      observeRecommendationRuntime(
        "selection",
        async () => {
          await timeRecommendationOperation("budget", async () => true)
        },
        (line) => logs.push(line),
      ),
    ])
    const delivery = logs
      .map((line) => JSON.parse(line))
      .find((row) => row.operation === "seeded")
    const selection = logs
      .map((line) => JSON.parse(line))
      .find((row) => row.operation === "selection")
    expect(delivery.timings.persistence).toMatchObject({
      calls: 1,
      errors: 1,
      errorCode: "P2028",
      inFlight: 0,
      inputRows: 120,
    })
    expect(delivery.timings.budget).toBeUndefined()
    expect(selection.timings.persistence).toBeUndefined()
    expect(logs.join()).not.toContain("secret")
  })

  it("records pending work and its later settlement without calling it a committed mutation", async () => {
    const log = vi.fn()
    let finish: ReturnType<typeof startRecommendationTiming>
    await observeRecommendationRuntime(
      "seeded",
      async () => {
        finish = startRecommendationTiming("transaction.commit_ack")
        return { result: "unavailable", reason: "delivery_timeout" }
      },
      log,
    )
    expect(
      JSON.parse(log.mock.calls[0][0]).timings["transaction.commit_ack"]
        .inFlight,
    ).toBe(1)
    finish?.()
    finish?.()
    expect(log).toHaveBeenCalledTimes(2)
    expect(JSON.parse(log.mock.calls[1][0])).toMatchObject({
      phase: "late_operation",
      outcome: "resolved",
      label: "transaction.commit_ack",
    })
  })

  it("does not let a throwing logger or error-code accessor alter mutation results", async () => {
    const log = () => {
      throw new Error("collector failed")
    }
    const error = Object.defineProperty(new Error("original"), "code", {
      get() {
        throw new Error("accessor")
      },
    })
    await expect(
      observeRecommendationRuntime("selection", async () => 42, log),
    ).resolves.toBe(42)
    await expect(
      observeRecommendationRuntime(
        "selection",
        () =>
          timeRecommendationOperation("budget", async () => {
            throw error
          }),
        log,
      ),
    ).rejects.toBe(error)
  })
})
