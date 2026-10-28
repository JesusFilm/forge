import {
  RecommendationClickHouseError,
  type RecommendationClickHouseClient,
} from "./clickhouse"
import {
  parseRecommendationEventEnvelope,
  RECOMMENDATION_EVENT_FAMILIES,
  type RecommendationEventEnvelope,
  type RecommendationEventFamily,
} from "./envelope"

export type DispatchFailureReason =
  | "configuration"
  | "invalid_input"
  | "timeout"
  | "transport"
  | "response"
  | "conflict"
  | "unknown"

export type DispatchSnapshot = Readonly<{
  window: "process_lifetime"
  windowStartedAt: string
  observedAt: string
  attemptedEvents: number
  confirmedEvents: number
  failedEvents: Record<DispatchFailureReason, number>
  unknownOutcomeEvents: number
  capacityDroppedEvents: number
  invalidDroppedEvents: number
  preparationDroppedEvents: number
  disabledDroppedEvents: number
  configurationDroppedEvents: number
  lifetimeRegistrationFailures: number
  inFlightEvents: number
  inFlightRequests: number
  inFlightBytes: number
  completedRequests: number
  durationMsTotal: number
  byFamily: Partial<
    Record<
      RecommendationEventFamily,
      { attempted: number; confirmed: number; failed: number; dropped: number }
    >
  >
}>

type Options = {
  client: Pick<RecommendationClickHouseClient, "insert"> | null
  disabledReason?: "configuration"
  register?: (started: Promise<void>) => void
  observe?: (snapshot: DispatchSnapshot) => void
  maxInFlight?: number
  maxInFlightBytes?: number
  now?: () => number
  log?: (line: string) => void
  observationIntervalMs?: number
}

const failureReasons: DispatchFailureReason[] = [
  "configuration",
  "invalid_input",
  "timeout",
  "transport",
  "response",
  "conflict",
  "unknown",
]

function reason(error: unknown): DispatchFailureReason {
  return error instanceof RecommendationClickHouseError ? error.code : "unknown"
}

/** Process-local observations. A crash can lose both events and unflushed counts. */
export function createRecommendationEventDispatcher(options: Options) {
  const now = options.now ?? Date.now
  const maxRequests = options.maxInFlight ?? 8
  const maxBytes = options.maxInFlightBytes ?? 8 * 1_048_576
  if (
    !Number.isSafeInteger(maxRequests) ||
    maxRequests < 1 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1
  )
    throw new RecommendationClickHouseError("configuration")
  const startedAt = now()
  let attemptedEvents = 0
  let confirmedEvents = 0
  let capacityDroppedEvents = 0
  let invalidDroppedEvents = 0
  let preparationDroppedEvents = 0
  let disabledDroppedEvents = 0
  let configurationDroppedEvents = 0
  let lifetimeRegistrationFailures = 0
  let inFlightEvents = 0
  let inFlightBytes = 0
  let completedRequests = 0
  let durationMsTotal = 0
  const failedEvents = Object.fromEntries(
    failureReasons.map((key) => [key, 0]),
  ) as Record<DispatchFailureReason, number>
  const families: Partial<
    Record<
      RecommendationEventFamily,
      { attempted: number; confirmed: number; failed: number; dropped: number }
    >
  > = {}
  const pending = new Set<Promise<void>>()
  let closed = false
  const family = (name: RecommendationEventFamily) =>
    (families[name] ??= { attempted: 0, confirmed: 0, failed: 0, dropped: 0 })

  function snapshot(): DispatchSnapshot {
    return {
      window: "process_lifetime",
      windowStartedAt: new Date(startedAt).toISOString(),
      observedAt: new Date(now()).toISOString(),
      attemptedEvents,
      confirmedEvents,
      failedEvents: { ...failedEvents },
      // A missing or interrupted acknowledgement cannot prove non-persistence.
      unknownOutcomeEvents:
        failedEvents.timeout + failedEvents.transport + failedEvents.unknown,
      capacityDroppedEvents,
      invalidDroppedEvents,
      preparationDroppedEvents,
      disabledDroppedEvents,
      configurationDroppedEvents,
      lifetimeRegistrationFailures,
      inFlightEvents,
      inFlightRequests: pending.size,
      inFlightBytes,
      completedRequests,
      durationMsTotal,
      byFamily: Object.fromEntries(
        Object.entries(families).map(([key, value]) => [key, { ...value }]),
      ),
    }
  }

  function safelyObserve() {
    try {
      options.observe?.(snapshot())
    } catch {
      /* instrumentation cannot affect delivery */
    }
  }

  // One aggregate log per interval, even when many events settle together.
  const interval =
    options.log && options.observationIntervalMs !== 0
      ? setInterval(() => {
          try {
            options.log?.(
              `[recommendation-event-history] ${JSON.stringify(snapshot())}`,
            )
          } catch {
            /* observer is best effort */
          }
        }, options.observationIntervalMs ?? 60_000)
      : null
  interval?.unref()

  function dispatch(events: readonly RecommendationEventEnvelope[]): void {
    const count = Array.isArray(events) ? events.length : 0
    if (closed || !options.client) {
      if (options.disabledReason === "configuration")
        configurationDroppedEvents += count
      else disabledDroppedEvents += count
      safelyObserve()
      return
    }
    let bytes = 0
    try {
      if (count < 1 || count > 100)
        throw new RecommendationClickHouseError("invalid_input")
      for (const event of events) {
        const json = JSON.stringify(event)
        const valid = parseRecommendationEventEnvelope(json)
        if (Date.parse(valid.expiresAt) <= now())
          throw new RecommendationClickHouseError("invalid_input")
        bytes += Buffer.byteLength(json)
      }
      if (bytes > 1_048_576)
        throw new RecommendationClickHouseError("invalid_input")
    } catch {
      invalidDroppedEvents += count
      safelyObserve()
      return
    }
    if (pending.size >= maxRequests || inFlightBytes + bytes > maxBytes) {
      capacityDroppedEvents += count
      for (const event of events) family(event.family).dropped++
      safelyObserve()
      return
    }
    attemptedEvents += count
    inFlightEvents += count
    inFlightBytes += bytes
    for (const event of events) family(event.family).attempted++
    const began = now()
    // Promise.resolve().then would defer the network start; call insert now.
    let started: Promise<void>
    try {
      started = Promise.resolve(options.client.insert(events))
    } catch (error) {
      started = Promise.reject(error)
    }
    const tracked = started
      .then(
        () => {
          confirmedEvents += count
          for (const event of events) family(event.family).confirmed++
        },
        (error: unknown) => {
          const code = reason(error)
          failedEvents[code] += count
          for (const event of events) family(event.family).failed++
        },
      )
      .then(() => {
        inFlightEvents -= count
        inFlightBytes -= bytes
        completedRequests++
        durationMsTotal += Math.max(0, now() - began)
        pending.delete(tracked)
        safelyObserve()
      })
    pending.add(tracked)
    try {
      options.register?.(tracked)
    } catch {
      lifetimeRegistrationFailures++
    }
    safelyObserve()
  }

  function recordPreparationFailure(
    eventFamily: RecommendationEventFamily,
    count = 1,
  ): void {
    if (
      !Number.isSafeInteger(count) ||
      count < 1 ||
      count > 100 ||
      !RECOMMENDATION_EVENT_FAMILIES.includes(eventFamily)
    )
      return
    preparationDroppedEvents += count
    family(eventFamily).dropped += count
    safelyObserve()
  }

  async function drain(): Promise<void> {
    await Promise.all([...pending])
  }

  async function close(): Promise<void> {
    closed = true
    if (interval) clearInterval(interval)
    await drain()
  }

  return {
    dispatch,
    snapshot,
    drain,
    close,
    recordPreparationFailure,
    isEnabled: () => !closed && options.client != null,
  }
}
