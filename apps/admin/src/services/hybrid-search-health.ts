/**
 * Process-local counters and last-error state for query-embedding operations.
 *
 * Used by the search orchestrator to track attempts and failures of actual
 * OpenRouter embedding calls, and by the health probe endpoint to surface
 * that state to external monitors (Railway healthchecks, uptime tools,
 * curl-based checks) without requiring log tailing.
 *
 * Scope: single Node.js process. Counters reset on restart. When the CMS
 * runs on multiple Railway instances, each instance maintains its own
 * state — external monitors polling `/api/search/health` compute deltas
 * or averages across replicas as they see fit.
 *
 * Why not Prometheus/InfluxDB/Datadog: no metrics sink exists in this
 * app today, and adding one is net-new infrastructure outside the scope
 * of this bug. Structured log lines plus a pollable counter endpoint are
 * the pragmatic stand-in. A real sink can be layered on later without
 * changing the public shape.
 */

let attempts = 0
let failures = 0
let lastErrorMessage: string | null = null
let lastErrorClass: string | null = null
let lastErrorAt: string | null = null

export type SearchHealthStats = {
  attempts: number
  failures: number
  lastErrorMessage: string | null
  lastErrorClass: string | null
  /** ISO-8601 timestamp of the most recent failure, or null if none recorded. */
  lastErrorAt: string | null
}

/** Increment attempts counter before each real provider request. */
export function recordAttempt(): void {
  attempts += 1
}

/**
 * Record a query-embedding failure. Increments the failure counter and
 * captures the error's class name + message for operator visibility.
 * The attempts counter should have been incremented separately via
 * `recordAttempt()` before the failed call.
 */
export function recordFailure(error: unknown): void {
  failures += 1
  if (error instanceof Error) {
    lastErrorMessage = error.message
    lastErrorClass = error.constructor.name
  } else {
    lastErrorMessage = String(error)
    lastErrorClass = "UnknownError"
  }
  lastErrorAt = new Date().toISOString()
}

/**
 * Returns a snapshot of current counter and last-error state. Mutating the
 * returned object has no effect on internal state; callers are free to
 * forward it into a JSON response.
 */
export function getStats(): SearchHealthStats {
  return {
    attempts,
    failures,
    lastErrorMessage,
    lastErrorClass,
    lastErrorAt,
  }
}

/**
 * Resolves the given promise, or rejects with a timeout error if it does
 * not settle within `ms` milliseconds. Used by the health probe so a
 * hanging OpenRouter call cannot stall healthcheck pollers indefinitely.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out after ${ms}ms`))
    }, ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

/** Test hook — resets all counters and last-error state. Not for production use. */
export function __resetSearchHealthForTest(): void {
  attempts = 0
  failures = 0
  lastErrorMessage = null
  lastErrorClass = null
  lastErrorAt = null
}
