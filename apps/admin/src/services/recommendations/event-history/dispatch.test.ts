import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createRecommendationEventEnvelope,
  RecommendationEventEnvelopeError,
} from "./envelope"
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
  it("counts eligible prepared events when configuration is missing without preparing payloads", async () => {
    const prepare = vi.fn(() => [event])
    const misconfigured = createRecommendationEventDispatcher({
      client: null,
      disabledReason: "configuration",
    })
    misconfigured.dispatchPrepared("selection", prepare, 2)
    expect(prepare).not.toHaveBeenCalled()
    expect(misconfigured.snapshot().configurationDroppedEvents).toBe(2)
    expect(misconfigured.snapshot().byFamily.selection?.dropped).toBe(2)

    const deliberatelyDisabled = createRecommendationEventDispatcher({
      client: null,
    })
    deliberatelyDisabled.dispatchPrepared("selection", prepare, 1)
    expect(prepare).not.toHaveBeenCalled()
    expect(deliberatelyDisabled.snapshot().disabledDroppedEvents).toBe(1)
    expect(deliberatelyDisabled.snapshot().configurationDroppedEvents).toBe(0)
    await Promise.all([misconfigured.close(), deliberatelyDisabled.close()])
  })

  it("rejects a prepared batch declared under the wrong family", async () => {
    const insert = vi.fn().mockResolvedValue(undefined)
    const dispatcher = createRecommendationEventDispatcher({
      client: { insert },
    })
    dispatcher.dispatchPrepared("request", () => [event])
    expect(insert).not.toHaveBeenCalled()
    expect(dispatcher.snapshot().preparationDroppedEvents).toBe(1)
    await dispatcher.close()
  })
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

  it("counts an invalid acknowledgement as unknown persistence without retrying", async () => {
    const visit = createRecommendationEventEnvelope({
      family: "experiment-visit",
      logicalId: "ab-visit:ambiguous-ack",
      revision: 1,
      occurredAt: new Date(event.occurredAt),
      acceptedAt: new Date(event.acceptedAt),
      expiresAt: new Date(event.expiresAt),
      payload: { arm: "control" },
      allowedFields: ["arm"],
    })
    const insert = vi
      .fn()
      .mockRejectedValue(new RecommendationClickHouseError("response"))
    const dispatcher = createRecommendationEventDispatcher({
      client: { insert },
    })

    expect(dispatcher.dispatch([visit])).toBeUndefined()
    await dispatcher.close()

    expect(insert).toHaveBeenCalledTimes(1)
    expect(dispatcher.snapshot()).toMatchObject({
      attemptedEvents: 1,
      confirmedEvents: 0,
      failedEvents: { response: 1 },
      unknownOutcomeEvents: 1,
      byExperimentArm: {
        control: { attempted: 1, confirmed: 0, failed: 1, unknownOutcome: 1 },
      },
    })
  })

  it("measures delivery loss by validated experiment arm without creating arbitrary labels", async () => {
    const visit = (id: string, arm: string) =>
      createRecommendationEventEnvelope({
        ...event,
        family: "experiment-visit",
        logicalId: `ab-visit:${id}`,
        occurredAt: new Date(event.occurredAt),
        acceptedAt: new Date(event.acceptedAt),
        expiresAt: new Date(event.expiresAt),
        payload: { arm },
        allowedFields: ["arm"],
      })
    const control = visit("control", "control")
    const challenger = visit("challenger", "challenger")
    let fail!: (reason: unknown) => void
    const insert = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<void>((_resolve, reject) => (fail = reject)),
      )
      .mockResolvedValue(undefined)
    const dispatcher = createRecommendationEventDispatcher({
      client: { insert },
      maxInFlight: 1,
    })
    dispatcher.dispatch([control, challenger])
    dispatcher.dispatch([control, visit("unknown", "untrusted-label")])
    fail(new RecommendationClickHouseError("timeout"))
    await dispatcher.drain()
    dispatcher.dispatch([control, challenger])
    await dispatcher.drain()

    expect(dispatcher.snapshot().byExperimentArm).toEqual({
      control: {
        attempted: 2,
        confirmed: 1,
        failed: 1,
        unknownOutcome: 1,
        dropped: 1,
      },
      challenger: {
        attempted: 2,
        confirmed: 1,
        failed: 1,
        unknownOutcome: 1,
        dropped: 0,
      },
    })
    expect(insert).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(dispatcher.snapshot())).not.toContain(
      "untrusted-label",
    )
    await dispatcher.close()
  })

  it("does not attribute other families or invalid batches to experiment arms", async () => {
    const withArm = (family: typeof event.family) =>
      createRecommendationEventEnvelope({
        ...event,
        family,
        occurredAt: new Date(event.occurredAt),
        acceptedAt: new Date(event.acceptedAt),
        expiresAt: new Date(event.expiresAt),
        payload: { arm: "control" },
        allowedFields: ["arm"],
      })
    const insert = vi.fn().mockResolvedValue(undefined)
    const dispatcher = createRecommendationEventDispatcher({
      client: { insert },
    })
    dispatcher.dispatch([withArm("request")])
    dispatcher.dispatch([
      withArm("experiment-visit"),
      { ...withArm("experiment-visit"), payloadDigest: "invalid" },
    ])
    await dispatcher.drain()

    expect(insert).toHaveBeenCalledTimes(1)
    expect(dispatcher.snapshot().confirmedEvents).toBe(1)
    expect(dispatcher.snapshot().invalidDroppedEvents).toBe(2)
    expect(dispatcher.snapshot().byExperimentArm.control.attempted).toBe(0)
    expect(dispatcher.snapshot().byExperimentArm.control.dropped).toBe(0)
    await dispatcher.close()
  })

  it("classifies typed envelope rejection as invalid input", async () => {
    const dispatcher = createRecommendationEventDispatcher({
      client: {
        insert: vi
          .fn()
          .mockRejectedValue(
            new RecommendationEventEnvelopeError("Invalid event JSON"),
          ),
      },
    })
    dispatcher.dispatch([event])
    await dispatcher.drain()
    expect(dispatcher.snapshot().failedEvents.invalid_input).toBe(1)
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
