// Typed error base for the worker. Every deliberate failure path extends
// WorkerError with a stable `reason` literal and a `retryable` hint so the
// job registry can surface the structured JobErrorBody contract instead of
// an opaque string (root CLAUDE.md: typed error classes, not raw throws).

import type { JobErrorBody } from "./types.js"

export class WorkerError extends Error {
  readonly reason: string
  readonly retryable: boolean

  constructor(message: string, reason: string, retryable: boolean) {
    super(message)
    this.name = "WorkerError"
    this.reason = reason
    this.retryable = retryable
  }
}

// Unknown errors default to retryable: false — the manager's bounded
// resubmit must not turn an unclassified crash into a duplicate multi-minute
// render. Transient failure modes get explicit retryable: true subclasses
// (CommandTimeoutError, deadline exhaustion from queue pressure).
export function toJobErrorBody(error: unknown): JobErrorBody {
  if (error instanceof WorkerError) {
    return {
      reason: error.reason,
      messages: [error.message],
      retryable: error.retryable,
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { reason: "internal_error", messages: [message], retryable: false }
}
