import { beforeEach, describe, expect, it, vi } from "vitest"
import { sampleRecommendationWaits } from "./recommendation-wait-sampler"

const pg = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
  on: vi.fn(),
  construct: vi.fn(),
}))
vi.mock("pg", () => ({
  Client: class {
    constructor(options: unknown) {
      pg.construct(options)
    }
    connect = pg.connect
    query = pg.query
    end = pg.end
    on = pg.on
  },
}))
vi.mock("node:timers/promises", () => ({ setTimeout: async () => {} }))

describe("bounded database observer", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pg.connect.mockResolvedValue(undefined)
    pg.end.mockResolvedValue(undefined)
    pg.query.mockResolvedValue({ rows: [] })
  })
  it("rejects unsafe duration/frequency before opening a connection", async () => {
    for (const options of [
      { durationMs: 900001 },
      { durationMs: Number.NaN },
      { intervalMs: 99 },
    ]) {
      await expect(
        sampleRecommendationWaits({ connectionString: "private", ...options }),
      ).rejects.toThrow(RangeError)
    }
    expect(pg.construct).not.toHaveBeenCalled()
  })
  it("closes on database failure and emits only a bounded code, not credentials or SQL", async () => {
    const log = vi.fn()
    pg.query.mockRejectedValueOnce(
      Object.assign(new Error("private DATABASE_URL and SQL"), {
        code: "57014",
      }),
    )
    expect(
      await sampleRecommendationWaits({ connectionString: "private", log }),
    ).toMatchObject({ stopped: "error", errorCode: "57014" })
    expect(pg.end).toHaveBeenCalledOnce()
    expect(log.mock.calls.flat().join()).not.toContain("private")
  })
  it("stops at the output cap with a read-only, statement-bounded connection", async () => {
    const log = vi.fn()
    pg.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes("WITH tagged")
        ? Array.from({ length: 32 }, () => ({ observationId: "fixture" }))
        : [],
    }))
    const summary = await sampleRecommendationWaits({
      connectionString: "private",
      log,
    })
    expect(summary).toMatchObject({ stopped: "output_limit", samples: 5000 })
    expect(pg.query).toHaveBeenCalledWith(
      "SET default_transaction_read_only = on",
    )
    expect(pg.query).toHaveBeenCalledWith("SET statement_timeout = '750ms'")
    expect(pg.end).toHaveBeenCalledOnce()
  })
  it("closes when the output sink fails, including before sampling starts", async () => {
    await expect(
      sampleRecommendationWaits({
        connectionString: "private",
        log: () => {
          throw new Error("broken output")
        },
      }),
    ).rejects.toThrow("broken output")
    expect(pg.end).toHaveBeenCalledOnce()
  })
  it("stops after one expensive poll instead of adding database pressure", async () => {
    const now = vi
      .spyOn(performance, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(101)
    try {
      expect(
        await sampleRecommendationWaits({
          connectionString: "private",
          log: () => {},
        }),
      ).toMatchObject({ stopped: "overhead", polls: 1, queryWallMs: 101 })
      expect(pg.end).toHaveBeenCalledOnce()
    } finally {
      now.mockRestore()
    }
  })
  it("reports abort without issuing an activity query", async () => {
    const controller = new AbortController()
    controller.abort()
    expect(
      await sampleRecommendationWaits({
        connectionString: "private",
        signal: controller.signal,
        log: () => {},
      }),
    ).toMatchObject({ stopped: "aborted", polls: 0 })
    expect(
      pg.query.mock.calls.some(([sql]) => sql.includes("WITH tagged")),
    ).toBe(false)
    expect(pg.end).toHaveBeenCalledOnce()
  })
})
