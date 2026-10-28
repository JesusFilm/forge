import { describe, expect, it, vi } from "vitest"
import { recommendationHistoryEvent } from "./producers"
import { readOperatorRecommendationTrace } from "./trace-reader"

const at = new Date("2026-08-26T12:00:00.000Z")
const expiry = new Date("2026-09-24T12:00:00.000Z")
function event(
  family: "request" | "served-item" | "evidence",
  id: string,
  payload: Record<string, unknown>,
) {
  return recommendationHistoryEvent({
    family,
    logicalId: id,
    revision: 1,
    occurredAt: at,
    acceptedAt: at,
    expiresAt: expiry,
    payload,
  })
}

describe("operator recommendation history reader", () => {
  it("caps the whole paged read even when a later adapter call stalls", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] })
    vi.setSystemTime(at)
    try {
      const read = vi.fn(async () => new Promise<never>(() => undefined))
      const pending = readOperatorRecommendationTrace({ read } as never, {
        requestId: "request-1",
        itemIds: [],
        runId: "run-1",
        stageIds: Array.from({ length: 448 }, (_, index) => `stage-${index}`),
        asOf: at,
      })
      const rejected = expect(pending).rejects.toThrow(
        "Recommendation ClickHouse timeout",
      )
      await vi.advanceTimersByTimeAsync(3_500)
      await rejected
      expect(read).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
  it("reads bounded exported identities and marks a missing stage incomplete", async () => {
    const events = [
      event("request", "request-1", {
        requestId: "request-1",
        state: "issued",
      }),
      event("served-item", "item-1", {
        requestId: "request-1",
        itemId: "item-1",
        position: 1,
      }),
      event("evidence", "run-1", {
        requestId: "request-1",
        candidateRunId: "run-1",
        kind: "candidate-run",
      }),
    ]
    const read = vi.fn(
      async ({ logicalIds }: { logicalIds: readonly string[] }) =>
        events.filter((entry) => logicalIds.includes(entry.logicalId)),
    )
    const history = await readOperatorRecommendationTrace({ read } as never, {
      requestId: "request-1",
      itemIds: ["item-1"],
      runId: "run-1",
      stageIds: ["stage-1"],
      asOf: at,
    })
    expect(history.status).toBe("incomplete")
    expect(history.missing).toEqual(["evidence:stage-1"])
    expect(history.request?.payload).toMatchObject({ state: "issued" })
    expect(history.servedItems).toHaveLength(1)
    expect(history.candidateRun?.payload).toMatchObject({
      kind: "candidate-run",
    })
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({ family: "request", logicalIds: ["request-1"] }),
    )
  })

  it("rejects an unexpected nested provenance map from history", async () => {
    const unsafe = event("served-item", "item-1", {
      requestId: "request-1",
      itemId: "item-1",
      position: 1,
      candidateProvenance: {
        sources: [
          {
            generator: "semantic",
            evidence: { arbitraryLink: "opaque-profile-id" },
          },
        ],
      },
    })
    const read = vi.fn(async ({ family }: { family: string }) =>
      family === "served-item" ? [unsafe] : [],
    )
    await expect(
      readOperatorRecommendationTrace({ read } as never, {
        requestId: "request-1",
        itemIds: ["item-1"],
        runId: null,
        stageIds: [],
        asOf: at,
      }),
    ).rejects.toThrow("Recommendation ClickHouse response")
  })

  it("rejects a signed presentation URL from a historical response", async () => {
    const unsafe = event("served-item", "item-1", {
      requestId: "request-1",
      itemId: "item-1",
      position: 1,
      imageUrl: "https://images.example.test/cover.jpg?token=private",
    })
    const read = vi.fn(async ({ family }: { family: string }) =>
      family === "served-item" ? [unsafe] : [],
    )
    await expect(
      readOperatorRecommendationTrace({ read } as never, {
        requestId: "request-1",
        itemIds: ["item-1"],
        runId: null,
        stageIds: [],
        asOf: at,
      }),
    ).rejects.toThrow("Recommendation ClickHouse response")
  })
})
