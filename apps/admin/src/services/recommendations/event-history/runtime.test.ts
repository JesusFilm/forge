import { describe, expect, it, vi } from "vitest"
import { createRecommendationEventEnvelope } from "./envelope"

const { after, config } = vi.hoisted(() => ({
  after: vi.fn(),
  config: { RECOMMENDATION_EVENT_EXPORT_ENABLED: "true" },
}))
vi.mock("next/server", () => ({ after }))
vi.mock("@/config/env", () => ({ env: config }))

import {
  createNextRecommendationEventDispatcher,
  createConfiguredWorkerRecommendationEventDispatcher,
  createWorkerRecommendationEventDispatcher,
} from "./runtime"
import { RecommendationClickHouseError } from "./clickhouse"

const event = createRecommendationEventEnvelope({
  family: "request",
  logicalId: "request:1",
  revision: 1,
  occurredAt: new Date("2026-10-28T00:00:00.000Z"),
  acceptedAt: new Date("2026-10-28T00:00:01.000Z"),
  expiresAt: new Date("2026-11-28T00:00:00.000Z"),
  payload: { source: "watch" },
  allowedFields: ["source"],
})

describe("recommendation event runtime", () => {
  it("passes an already-started promise to Next after", async () => {
    const insert = vi.fn().mockResolvedValue(undefined)
    const runtime = createNextRecommendationEventDispatcher({
      enabled: true,
      client: { insert },
    })
    runtime.dispatch([event])
    expect(insert).toHaveBeenCalledTimes(1)
    expect(after).toHaveBeenCalledWith(expect.any(Promise))
    await runtime.close()
  })

  it("keeps disabled transport explicit and lets workers drain", async () => {
    const disabled = createWorkerRecommendationEventDispatcher({
      enabled: false,
    })
    disabled.dispatch([event])
    expect(disabled.snapshot().disabledDroppedEvents).toBe(1)
    await disabled.close()
  })

  it("rejects enabled export without a configured sink", () => {
    expect(() =>
      createWorkerRecommendationEventDispatcher({ enabled: true }),
    ).toThrow(new RecommendationClickHouseError("configuration"))
  })

  it("records missing enabled configuration as a drop", async () => {
    const runtime = createConfiguredWorkerRecommendationEventDispatcher()
    runtime.dispatch([event])
    expect(runtime.snapshot().configurationDroppedEvents).toBe(1)
    await runtime.close()
  })
})
