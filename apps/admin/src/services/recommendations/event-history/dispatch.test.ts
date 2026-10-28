import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createRecommendationEventEnvelope } from "./envelope"
import { createRecommendationEventDispatcher } from "./dispatch"
import { RecommendationClickHouseError } from "./clickhouse"

const event = createRecommendationEventEnvelope({
  family: "selection",
  logicalId: "selection:1",
  revision: 1,
  occurredAt: new Date("2026-10-28T00:00:00.000Z"),
  acceptedAt: new Date("2026-10-28T00:00:01.000Z"),
  expiresAt: new Date("2026-11-28T00:00:00.000Z"),
  payload: { source: "recommendation" },
  allowedFields: ["source"],
})

describe("recommendation event dispatch", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-10-28T00:01:00.000Z"))
  })
  afterEach(() => vi.useRealTimers())
  it("starts immediately and returns before the insert settles", async () => {
    let settle!: () => void
    const insert = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve
        }),
    )
    const register = vi.fn()
    const dispatcher = createRecommendationEventDispatcher({
      client: { insert },
      register,
      maxInFlight: 1,
      maxInFlightBytes: 1_000_000,
    })

    expect(dispatcher.dispatch([event])).toBeUndefined()
    expect(insert).toHaveBeenCalledTimes(1)
    expect(register).toHaveBeenCalledTimes(1)
    expect(dispatcher.snapshot().inFlightEvents).toBe(1)
    settle()
    await dispatcher.drain()
    expect(dispatcher.snapshot().confirmedEvents).toBe(1)
  })

  it("drops saturated work immediately, then releases capacity", async () => {
    let settle!: () => void
    const insert = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            settle = resolve
          }),
      )
      .mockResolvedValue(undefined)
    const dispatcher = createRecommendationEventDispatcher({
      client: { insert },
      maxInFlight: 1,
      maxInFlightBytes: 1_000_000,
    })
    dispatcher.dispatch([event])
    dispatcher.dispatch([event])
    expect(insert).toHaveBeenCalledTimes(1)
    expect(dispatcher.snapshot().capacityDroppedEvents).toBe(1)
    settle()
    await dispatcher.drain()
    dispatcher.dispatch([event])
    await dispatcher.drain()
    expect(dispatcher.snapshot().confirmedEvents).toBe(2)
  })

  it("observes a rejected batch without retrying or rejecting the caller", async () => {
    const insert = vi
      .fn()
      .mockRejectedValue(new RecommendationClickHouseError("timeout"))
    const dispatcher = createRecommendationEventDispatcher({
      client: { insert },
    })
    expect(dispatcher.dispatch([event, event])).toBeUndefined()
    await dispatcher.drain()
    expect(insert).toHaveBeenCalledTimes(1)
    expect(dispatcher.snapshot().attemptedEvents).toBe(2)
    expect(dispatcher.snapshot().failedEvents.timeout).toBe(2)
    expect(dispatcher.snapshot().confirmedEvents).toBe(0)
  })

  it("keeps observer and registration faults outside the delivery promise", async () => {
    const dispatcher = createRecommendationEventDispatcher({
      client: { insert: vi.fn().mockResolvedValue(undefined) },
      register: () => {
        throw new Error("no request context")
      },
      observe: () => {
        throw new Error("telemetry unavailable")
      },
    })
    dispatcher.dispatch([event])
    await dispatcher.drain()
    expect(dispatcher.snapshot().confirmedEvents).toBe(1)
    expect(dispatcher.snapshot().lifetimeRegistrationFailures).toBe(1)
  })

  it("does not send disabled or expired events", async () => {
    const insert = vi.fn()
    const disabled = createRecommendationEventDispatcher({ client: null })
    disabled.dispatch([event])
    expect(disabled.snapshot().disabledDroppedEvents).toBe(1)
    const expired = createRecommendationEventDispatcher({
      client: { insert },
      now: () => Date.parse("2027-01-01"),
    })
    expired.dispatch([event])
    expect(expired.snapshot().invalidDroppedEvents).toBe(1)
    expect(insert).not.toHaveBeenCalled()
  })

  it("refuses an envelope with an unapproved sensitive field", () => {
    const insert = vi.fn()
    const dispatcher = createRecommendationEventDispatcher({
      client: { insert },
    })
    dispatcher.dispatch([
      { ...event, payload: { email: "person@example.org" } },
    ])
    expect(dispatcher.snapshot().invalidDroppedEvents).toBe(1)
    expect(insert).not.toHaveBeenCalled()
  })

  it("counts configuration drops separately from an intentionally disabled export", () => {
    const dispatcher = createRecommendationEventDispatcher({
      client: null,
      disabledReason: "configuration",
    })
    dispatcher.dispatch([event, event])
    expect(dispatcher.snapshot().configurationDroppedEvents).toBe(2)
    expect(dispatcher.snapshot().disabledDroppedEvents).toBe(0)
  })

  it("measures a failed producer preparation without a send", () => {
    const insert = vi.fn()
    const dispatcher = createRecommendationEventDispatcher({
      client: { insert },
    })
    dispatcher.recordPreparationFailure("selection")
    expect(dispatcher.snapshot().preparationDroppedEvents).toBe(1)
    expect(dispatcher.snapshot().byFamily.selection?.dropped).toBe(1)
    expect(dispatcher.snapshot().attemptedEvents).toBe(0)
    expect(insert).not.toHaveBeenCalled()
  })

  it("stops aggregate logging on close", async () => {
    vi.useFakeTimers()
    const log = vi.fn()
    const dispatcher = createRecommendationEventDispatcher({
      client: null,
      log,
      observationIntervalMs: 10,
    })
    await dispatcher.close()
    vi.advanceTimersByTime(100)
    expect(log).not.toHaveBeenCalled()
  })
})
