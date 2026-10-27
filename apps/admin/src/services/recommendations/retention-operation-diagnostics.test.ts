import { afterEach, describe, expect, it, vi } from "vitest"
import { monitorEventLoopDelay } from "node:perf_hooks"
import { getHeapStatistics } from "node:v8"
import {
  createRetentionDecisionObservation,
  isRetentionDecisionObservation,
  safeRetentionDecisionObservation,
} from "./retention-operation-diagnostics"
import { unlinkExpiredDecisionLinks } from "./retention-decision-links"

vi.mock("node:perf_hooks", async (original) => {
  const actual = await original<typeof import("node:perf_hooks")>()
  return {
    ...actual,
    monitorEventLoopDelay: vi.fn(actual.monitorEventLoopDelay),
  }
})
vi.mock("node:v8", async (original) => {
  const actual = await original<typeof import("node:v8")>()
  return { ...actual, getHeapStatistics: vi.fn(actual.getHeapStatistics) }
})

afterEach(() => vi.restoreAllMocks())
const now = new Date("2026-10-27T00:00:00Z")
function transaction(
  rows = [
    {
      requestId: "private-request",
      projectionGenerationId: "private-generation",
    },
  ],
) {
  return {
    $queryRaw: vi.fn(async () => rows),
    recommendationPersonalizationDecision: {
      updateMany: vi.fn(async () => ({ count: rows.length })),
    },
  }
}

describe("retention decision observations", () => {
  it.each(["select", "update"] as const)(
    "preserves a %s rejection and records its actual boundary",
    async (boundary) => {
      const tx = transaction()
      const error = Object.assign(new Error("private SQL and parameters"), {
        code: "P2028",
      })
      if (boundary === "select") tx.$queryRaw.mockRejectedValueOnce(error)
      else
        tx.recommendationPersonalizationDecision.updateMany.mockRejectedValueOnce(
          error,
        )
      const observation = createRetentionDecisionObservation("manual-cli")
      const histogram = vi
        .mocked(monitorEventLoopDelay)
        .mock.results.at(-1)!.value
      const disable = vi.spyOn(histogram, "disable")
      try {
        await expect(
          unlinkExpiredDecisionLinks(tx as never, now, 100, observation.record),
        ).rejects.toBe(error)
      } finally {
        const result = observation.finish(false)
        expect(result).toMatchObject({
          executionContext: "manual-cli",
          boundary,
          gcAttribution: "unmeasured",
          selectedCount: boundary === "select" ? null : 1,
          unlinkedCount: null,
        })
        expect(result.incompleteStageMs).toBeGreaterThanOrEqual(0)
        expect(isRetentionDecisionObservation(result)).toBe(true)
        expect(JSON.stringify(result)).not.toMatch(
          /private|SQL|parameters|P2028/,
        )
        expect(disable).toHaveBeenCalledOnce()
        observation.finish(false)
        expect(disable).toHaveBeenCalledOnce()
      }
    },
  )

  it.each([0, 1])(
    "finishes and disposes a successful page of %i rows",
    async (count) => {
      const tx = transaction(count ? undefined : [])
      const observation = createRetentionDecisionObservation("scheduled-job")
      const histogram = vi
        .mocked(monitorEventLoopDelay)
        .mock.results.at(-1)!.value
      const disable = vi.spyOn(histogram, "disable")
      try {
        await expect(
          unlinkExpiredDecisionLinks(tx as never, now, 100, observation.record),
        ).resolves.toEqual({ selectedCount: count, unlinkedCount: count })
      } finally {
        const result = observation.finish(true)
        expect(result).toMatchObject({
          executionContext: "scheduled-job",
          boundary: "complete",
          selectedCount: count,
          unlinkedCount: count || null,
        })
        expect(result.heapLimitBytes).toBe(getHeapStatistics().heap_size_limit)
        expect(result.heapUsedStartBytes).toBeGreaterThan(0)
        expect(result.heapUsedEndBytes).toBeGreaterThan(0)
        expect(result.scope).toBe("executing-process-wide-decision-operation")
        expect(disable).toHaveBeenCalledOnce()
      }
      expect(
        tx.recommendationPersonalizationDecision.updateMany,
      ).toHaveBeenCalledTimes(count)
    },
  )

  it("measures a real local event-loop stall in the executing process", async () => {
    const observation = createRetentionDecisionObservation("unspecified")
    try {
      observation.record("select")
      await new Promise((resolve) => setTimeout(resolve, 45))
      const until = performance.now() + 65
      while (performance.now() < until) {
        /* owned test-process stall */
      }
      await new Promise((resolve) => setTimeout(resolve, 45))
      observation.record("selected", 0)
    } finally {
      const result = observation.finish(true)
      expect(result.selectMs).toBeGreaterThanOrEqual(100)
      expect(result.loopActiveMs).toBeGreaterThanOrEqual(40)
      expect(result.loopDelayMaxMs).toBeGreaterThanOrEqual(40)
      expect(result.gcAttribution).toBe("unmeasured")
    }
  })

  it("does not invent a zero delay when no histogram sample exists", () => {
    const observation = createRetentionDecisionObservation("worker-job")
    expect(observation.finish(true).loopDelayMaxMs).toBeNull()
  })

  it("cannot replace query results/errors when an observer throws", async () => {
    const tx = transaction()
    const observer = () => {
      throw new Error("diagnostic failure")
    }
    await expect(
      unlinkExpiredDecisionLinks(tx as never, now, 100, observer),
    ).resolves.toEqual({ selectedCount: 1, unlinkedCount: 1 })
    const original = new Error("original failure")
    tx.recommendationPersonalizationDecision.updateMany.mockRejectedValueOnce(
      original,
    )
    await expect(
      unlinkExpiredDecisionLinks(tx as never, now, 100, observer),
    ).rejects.toBe(original)
  })

  it("disposes after a sampling failure and preserves the failure boundary", () => {
    const observation = createRetentionDecisionObservation("manual-cli")
    const histogram = vi
      .mocked(monitorEventLoopDelay)
      .mock.results.at(-1)!.value
    const disable = vi.spyOn(histogram, "disable")
    observation.record("update")
    vi.mocked(getHeapStatistics).mockImplementationOnce(() => {
      throw new Error("heap unavailable")
    })
    expect(observation.finish(false)).toMatchObject({
      boundary: "update",
      heapUsedEndBytes: null,
    })
    expect(disable).toHaveBeenCalledOnce()
  })

  it("survives sampler construction failure without changing query behavior", async () => {
    vi.mocked(monitorEventLoopDelay).mockImplementationOnce(() => {
      throw new Error("sampler unavailable")
    })
    const observation = createRetentionDecisionObservation("manual-cli")
    try {
      await expect(
        unlinkExpiredDecisionLinks(
          transaction() as never,
          now,
          100,
          observation.record,
        ),
      ).resolves.toEqual({ selectedCount: 1, unlinkedCount: 1 })
    } finally {
      expect(observation.finish(true)).toMatchObject({
        boundary: "complete",
        loopDelayMaxMs: null,
      })
    }
  })

  it("copies only safe data fields and rejects invalid numeric or enum values", () => {
    const good = createRetentionDecisionObservation("manual-cli").finish(true)
    const hostile = { ...good, sql: "private", arguments: ["private"] }
    expect(isRetentionDecisionObservation(hostile)).toBe(false)
    expect(safeRetentionDecisionObservation(hostile)).toEqual(good)
    for (const invalid of [
      { ...good, heapLimitBytes: Infinity },
      { ...good, selectedCount: 5001 },
      { ...good, processCpuUserMs: -1 },
      { ...good, executionContext: "private" },
      { ...good, gcAttribution: "proved" },
    ]) {
      expect(isRetentionDecisionObservation(invalid)).toBe(false)
      expect(safeRetentionDecisionObservation(invalid)).toBeNull()
    }
    const getter = { ...good }
    Object.defineProperty(getter, "heapUsedEndBytes", {
      get: () => {
        throw new Error("unsafe accessor")
      },
    })
    expect(safeRetentionDecisionObservation(getter)).toBeNull()
  })
})
