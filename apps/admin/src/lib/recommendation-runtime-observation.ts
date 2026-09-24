import { AsyncLocalStorage } from "node:async_hooks"
import { randomUUID } from "node:crypto"
import { monitorEventLoopDelay, performance } from "node:perf_hooks"

type Operation = "seeded" | "for_you" | "selection"
type Timing = {
  calls: number
  inFlight: number
  firstStartedOffsetMs: number
  maxStartedOffsetMs?: number
  elapsedMs: number
  maxMs: number
  errors: number
  errorCode?: string
  sqlState?: string
  inputRows?: number
}
type Observation = {
  observationId: string
  operation: Operation
  startedAt: string
  started: number
  timings: Record<string, Timing>
  pendingMax: number
  omittedTimings: number
  closed: boolean
  databaseTransactions: Array<{ ordinal: number; backendPid: number | null }>
  omittedTransactions: number
  log: (line: string) => void
}

// Next can evaluate API, RSC and SSR module graphs independently. Share the
// context with the singleton Prisma clients and use only one runtime sampler.
const runtime = globalThis as typeof globalThis & {
  recommendationObservation?: AsyncLocalStorage<Observation>
  recommendationLoopWindow?: ReturnType<typeof createLoopWindow>
}
const context = (runtime.recommendationObservation ??= new AsyncLocalStorage())

function createLoopWindow() {
  const histogram = monitorEventLoopDelay({ resolution: 20 })
  histogram.enable()
  const started = performance.now()
  const window = {
    histogram,
    previousMaxMs: 0,
    started,
    previousStarted: started,
  }
  setInterval(() => {
    window.previousMaxMs = histogram.max / 1e6
    window.previousStarted = window.started
    window.started = performance.now()
    histogram.reset()
  }, 1_000).unref()
  return window
}

function errorCode(error: unknown): string {
  // Never inspect/serialize an Error: Next's source-map inspection can itself
  // block the event loop. Do not include messages, stacks, SQL or parameters.
  try {
    if (typeof error !== "object" || error == null) return "unknown"
    const code = "code" in error ? error.code : undefined
    if (typeof code === "string" && /^(P\d{4}|[0-9A-Z]{5})$/.test(code)) {
      return code
    }
    if (
      "name" in error &&
      error.name === "RecommendationRetrievalTimeoutError"
    ) {
      return "deadline"
    }
  } catch {
    // Hostile error accessors cannot replace the original failure.
  }
  return "unknown"
}

function emit(observation: Observation, fields: Record<string, unknown>) {
  try {
    observation.log(
      JSON.stringify({
        event: "recommendation.runtime",
        schemaVersion: 1,
        operation: observation.operation,
        observationId: observation.observationId,
        // The transport's timestamp can be ingestion time, including log lag.
        startedAt: observation.startedAt,
        ...fields,
      }),
    )
  } catch {
    // A diagnostic must never change a mutation's result.
  }
}

function sqlState(error: unknown): string | undefined {
  try {
    if (typeof error !== "object" || error == null || !("meta" in error)) return
    const meta = error.meta
    if (typeof meta !== "object" || meta == null || !("code" in meta)) return
    return typeof meta.code === "string" && /^[0-9A-Z]{5}$/.test(meta.code)
      ? meta.code
      : undefined
  } catch {
    return undefined
  }
}

/** Driver/application wall time, not PostgreSQL execution or exclusive time. */
export function startRecommendationTiming(label: string, inputRows?: number) {
  const observation = context.getStore()
  if (!observation || observation.closed) return undefined
  if (!/^[a-zA-Z_.$]{1,100}$/.test(label)) return undefined
  const started = performance.now()
  const startedOffsetMs =
    Math.round((started - observation.started) * 1_000) / 1_000
  let timing = observation.timings[label]
  if (!timing) {
    // Leave room for JSON escaping and trace metadata in the 16 KiB syslog
    // envelope. Excess labels are explicitly counted rather than truncated.
    if (Object.keys(observation.timings).length >= 32) {
      observation.omittedTimings++
      return undefined
    }
    timing = observation.timings[label] = {
      calls: 0,
      inFlight: 0,
      firstStartedOffsetMs: startedOffsetMs,
      elapsedMs: 0,
      maxMs: 0,
      errors: 0,
    }
  }
  timing.calls++
  timing.inFlight++
  if (inputRows != null && Number.isSafeInteger(inputRows) && inputRows >= 0) {
    timing.inputRows = Math.max(timing.inputRows ?? 0, inputRows)
  }
  let finished = false
  return (error?: unknown, rejected = error !== undefined) => {
    if (finished) return
    finished = true
    const elapsedMs = performance.now() - started
    timing.inFlight--
    timing.elapsedMs += elapsedMs
    if (timing.maxStartedOffsetMs == null || elapsedMs > timing.maxMs) {
      timing.maxMs = elapsedMs
      timing.maxStartedOffsetMs = startedOffsetMs
    }
    if (rejected) {
      timing.errors++
      timing.errorCode = errorCode(error)
      timing.sqlState = sqlState(error)
    }
    if (observation.closed) {
      emit(observation, {
        phase: "late_operation",
        label,
        startedOffsetMs,
        elapsedMs,
        outcome: rejected ? "rejected" : "resolved",
        ...(rejected
          ? { errorCode: errorCode(error), sqlState: sqlState(error) }
          : {}),
      })
    }
  }
}

export async function timeRecommendationOperation<T>(
  label: string,
  operation: () => Promise<T>,
  inputRows?: number,
): Promise<T> {
  const finish = startRecommendationTiming(label, inputRows)
  try {
    const result = await operation()
    finish?.()
    return result
  } catch (error) {
    finish?.(error, true)
    throw error
  }
}

export function observeRecommendationPoolQueue(pending: number): void {
  const observation = context.getStore()
  if (observation && !observation.closed) {
    observation.pendingMax = Math.max(observation.pendingMax, pending)
  }
}

/** Transaction-local correlation only; never a viewer or durable ledger ID. */
export function startRecommendationDatabaseTransaction() {
  const observation = context.getStore()
  if (!observation || observation.closed) return undefined
  if (observation.databaseTransactions.length >= 8) {
    observation.omittedTransactions++
    return undefined
  }
  const transaction = {
    ordinal: observation.databaseTransactions.length + 1,
    backendPid: null as number | null,
  }
  observation.databaseTransactions.push(transaction)
  return {
    applicationName: `watch:${observation.observationId}:${transaction.ordinal}`,
    recordBackend(backendPid: unknown) {
      if (
        typeof backendPid === "number" &&
        Number.isSafeInteger(backendPid) &&
        backendPid > 0
      ) {
        transaction.backendPid = backendPid
      }
    },
  }
}

export async function observeRecommendationRuntime<T>(
  operation: Operation,
  work: () => Promise<T>,
  log: (line: string) => void = (line) => console.info(line),
): Promise<T> {
  const loop = (runtime.recommendationLoopWindow ??= createLoopWindow())
  const observation: Observation = {
    observationId: randomUUID(),
    operation,
    startedAt: new Date().toISOString(),
    started: performance.now(),
    timings: Object.create(null),
    pendingMax: 0,
    omittedTimings: 0,
    closed: false,
    databaseTransactions: [],
    omittedTransactions: 0,
    log,
  }
  const loopStart = performance.eventLoopUtilization()
  return context.run(observation, async () => {
    let outcome = "resolved"
    let failure: string | undefined
    let timeoutFallback = false
    try {
      const result = await work()
      if (typeof result === "object" && result != null && "result" in result) {
        if (
          ["served", "fallback", "empty", "unavailable"].includes(
            String(result.result),
          )
        ) {
          outcome = String(result.result)
        }
        if ("reason" in result) {
          timeoutFallback =
            result.reason === "delivery_timeout" ||
            result.reason === "retrieval_timeout"
        }
      }
      return result
    } catch (error) {
      outcome = "rejected"
      failure = errorCode(error)
      throw error
    } finally {
      observation.closed = true
      const utilization = performance.eventLoopUtilization(loopStart)
      emit(observation, {
        phase: "complete",
        outcome,
        timeoutFallback,
        ...(failure ? { errorCode: failure } : {}),
        elapsedMs: performance.now() - observation.started,
        poolAcquisitionSamples: observation.timings["pool.acquire"]?.calls ?? 0,
        poolPendingMax: observation.timings["pool.acquire"]
          ? observation.pendingMax
          : null,
        // Process-wide overlapping work, not CPU attributed to this request.
        loopActiveMs: utilization.active,
        loopIdleMs: utilization.idle,
        recentLoopMaxMs: Math.max(loop.previousMaxMs, loop.histogram.max / 1e6),
        loopWindowMs: performance.now() - loop.previousStarted,
        omittedTimings: observation.omittedTimings,
        databaseTransactions: observation.databaseTransactions,
        omittedTransactions: observation.omittedTransactions,
        timings: observation.timings,
      })
    }
  })
}
