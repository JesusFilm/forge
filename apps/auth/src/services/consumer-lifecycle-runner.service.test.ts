import { describe, expect, it, vi } from "vitest"

import { runConsumerLifecycleJob } from "./consumer-lifecycle-runner.service"

describe("runConsumerLifecycleJob", () => {
  it("reconciles multiple pages and drains more than one thousand events", async () => {
    const reconcileBatch = vi
      .fn()
      .mockResolvedValueOnce({ processed: 500, nextCursor: "consumer-500" })
      .mockResolvedValueOnce({ processed: 500, nextCursor: "consumer-1000" })
      .mockResolvedValueOnce({ processed: 1, nextCursor: null })
    const deliverBatch = vi.fn(async () => {
      const invocation = deliverBatch.mock.calls.length
      if (invocation <= 20) return { delivered: 50, failed: 0 }
      if (invocation === 21) return { delivered: 1, failed: 0 }
      return { delivered: 0, failed: 0 }
    })
    const getHealth = vi.fn(async () => ({
      pending: 0,
      leased: 0,
      dead: 0,
      due: 0,
      backlog: 0,
    }))
    const retryBatch = vi.fn(async () => ({
      attempted: 0,
      finalized: 0,
      failed: 0,
    }))

    const result = await runConsumerLifecycleJob({
      workerId: "worker-1",
      reconciliation: { reconcileBatch },
      outbox: { deliverBatch, getHealth },
      deletion: { retryBatch },
    })

    expect(reconcileBatch.mock.calls).toEqual([
      [{ cursor: undefined }],
      [{ cursor: "consumer-500" }],
      [{ cursor: "consumer-1000" }],
    ])
    expect(deliverBatch).toHaveBeenCalledTimes(22)
    expect(result).toEqual({
      event: "consumer_lifecycle_run",
      reconciled: 1001,
      delivery: { batches: 21, delivered: 1001, failed: 0 },
      outbox: { pending: 0, leased: 0, dead: 0, due: 0, backlog: 0 },
      deletion: { attempted: 0, finalized: 0, failed: 0 },
      healthy: true,
      exitCode: 0,
    })
  })

  it("reports DEAD and due backlog as unhealthy and alertable", async () => {
    const result = await runConsumerLifecycleJob({
      workerId: "worker-1",
      reconciliation: {
        reconcileBatch: vi.fn(async () => ({ processed: 0, nextCursor: null })),
      },
      outbox: {
        deliverBatch: vi.fn(async () => ({ delivered: 0, failed: 0 })),
        getHealth: vi.fn(async () => ({
          pending: 4,
          leased: 1,
          dead: 2,
          due: 3,
          backlog: 7,
        })),
      },
      deletion: {
        retryBatch: vi.fn(async () => ({
          attempted: 0,
          finalized: 0,
          failed: 0,
        })),
      },
    })

    expect(result.healthy).toBe(false)
    expect(result.exitCode).toBe(1)
    expect(result.outbox).toEqual({
      pending: 4,
      leased: 1,
      dead: 2,
      due: 3,
      backlog: 7,
    })
  })
})
