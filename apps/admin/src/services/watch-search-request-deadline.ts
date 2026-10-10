// Request-start-derived deadline for the MODERN (Typesense) Watch search path.
//
// The public GraphQL resolver passes `hardTimeoutMs`; every other caller
// (offline evaluation, benchmarks, comparison, shadow, agent tools) omits it
// and keeps the unbounded behavior. The DEFAULT (Postgres) path implements the
// same budget split inside `watch-search.service.ts`.

import { WatchSearchTimeoutError } from "./watch-search.service"

export const WATCH_SEARCH_DEADLINE_EXCEEDED_EVENT =
  "watch_search_deadline_exceeded"
// Lane reason when the embedding misses its share of the budget; the DEFAULT
// path reports the same value.
export const REQUEST_BUDGET_EXCEEDED_REASON = "request_budget_exceeded"
// Matches the DEFAULT path: the cutoff leaves this much of the budget for
// retrieval, availability hydration, and response assembly.
const WATCH_SEARCH_HYDRATION_RESERVE_MS = 400
const WATCH_SEARCH_HYDRATION_RESERVE_FRACTION = 0.3

export type WatchSearchDeadlineStage =
  | "serving_profile"
  | "language_resolution"
  | "retrieval"
  | "target_language"
  | "availability_hydration"
  | "response"

export type WatchSearchRequestDeadline = {
  readonly startedAtMs: number
  readonly deadlineAtMs: number
  // The query embedding wait stops here (the semantic lane degrades and
  // retrieval goes out lexical-only). Serving-profile and language stages
  // that miss it fail the request.
  readonly retrievalDeadlineAtMs: number
  // Last stage entered, for the query-free timeout log only.
  stage: WatchSearchDeadlineStage
}

export function createWatchSearchRequestDeadline({
  startedAtMs,
  hardTimeoutMs,
}: {
  startedAtMs: number
  hardTimeoutMs: number
}): WatchSearchRequestDeadline {
  const deadlineAtMs = startedAtMs + hardTimeoutMs
  return {
    startedAtMs,
    deadlineAtMs,
    retrievalDeadlineAtMs:
      deadlineAtMs -
      Math.min(
        WATCH_SEARCH_HYDRATION_RESERVE_MS,
        hardTimeoutMs * WATCH_SEARCH_HYDRATION_RESERVE_FRACTION,
      ),
    stage: "language_resolution",
  }
}

export function remainingBudgetMs(atMs: number): number {
  return Math.max(0, atMs - performance.now())
}

export type DeadlineOutcome<T> =
  | { status: "fulfilled"; value: T; elapsedMs: number }
  | { status: "rejected"; error: unknown; elapsedMs: number }
  | { status: "timed_out"; elapsedMs: number }

// Never rejects. The handlers attach synchronously, so a promise abandoned at
// the deadline can reject later without becoming an unhandled rejection. A
// promise that settles at or after `atMs` reports `timed_out`, even when it was
// already resolved: an elapsed budget never returns success.
export function settleBeforeDeadline<T>(
  promise: Promise<T>,
  atMs: number,
): Promise<DeadlineOutcome<T>> {
  const startedAt = performance.now()
  const timedOut = (): DeadlineOutcome<T> => ({
    status: "timed_out",
    elapsedMs: performance.now() - startedAt,
  })
  let timeout: ReturnType<typeof setTimeout> | undefined
  const settled = promise.then(
    (value): DeadlineOutcome<T> =>
      performance.now() >= atMs
        ? timedOut()
        : {
            status: "fulfilled",
            value,
            elapsedMs: performance.now() - startedAt,
          },
    (error: unknown): DeadlineOutcome<T> =>
      performance.now() >= atMs
        ? timedOut()
        : {
            status: "rejected",
            error,
            elapsedMs: performance.now() - startedAt,
          },
  )
  if (startedAt >= atMs) return Promise.resolve(timedOut())
  const expired = new Promise<DeadlineOutcome<T>>((resolve) => {
    timeout = setTimeout(() => resolve(timedOut()), remainingBudgetMs(atMs))
  })
  return Promise.race([settled, expired]).finally(() => {
    if (timeout) clearTimeout(timeout)
  })
}

// Resolves with the promise's value or throws the deadline error.
export async function beforeDeadline<T>(
  promise: Promise<T>,
  atMs: number,
): Promise<T> {
  const outcome = await settleBeforeDeadline(promise, atMs)
  if (outcome.status === "fulfilled") return outcome.value
  if (outcome.status === "rejected") throw outcome.error
  throw new WatchSearchTimeoutError(WATCH_SEARCH_DEADLINE_EXCEEDED_EVENT)
}

// Stage boundary check: call BEFORE starting a dependency call, so no new
// work is dispatched once the budget is gone (including after the caller has
// already received the deadline error).
export function assertBeforeDeadline(atMs: number): void {
  if (performance.now() >= atMs) {
    throw new WatchSearchTimeoutError(WATCH_SEARCH_DEADLINE_EXCEEDED_EVENT)
  }
}

// Carries the lane reason through the existing embedding-failure branch.
export class WatchSearchStageBudgetError extends Error {
  constructor() {
    super(REQUEST_BUDGET_EXCEEDED_REASON)
    this.name = "WatchSearchStageBudgetError"
  }
}

export function isWatchSearchDeadlineExceeded(error: unknown): boolean {
  return (
    error instanceof WatchSearchTimeoutError &&
    error.event === WATCH_SEARCH_DEADLINE_EXCEEDED_EVENT
  )
}
