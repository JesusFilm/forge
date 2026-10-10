// Per-JOB deadline: created at ENQUEUE time (manager's poll budget includes
// queue wait, so the worker's deadline must too) and threaded through
// runFingerprint/runRender so every ffmpeg/ffprobe invocation is capped at
// the remaining budget. Budgets live in config/env.ts and MUST stay strictly
// below manager's poll ceilings (root CLAUDE.md: outbound timeout shorter
// than caller budget).

export class JobDeadlineExceededError extends Error {
  constructor(elapsedMs: number) {
    super(`job deadline exceeded after ${Math.round(elapsedMs / 1000)}s`)
    this.name = "JobDeadlineExceededError"
  }
}

export type JobDeadline = {
  /** Milliseconds left before the job deadline; <= 0 means exceeded. */
  remainingMs(): number
  /**
   * Throws JobDeadlineExceededError when the deadline has passed, otherwise
   * returns min(capMs, remaining) for use as the next invocation's timeoutMs.
   */
  capTimeoutMs(capMs: number): number
}

export function createJobDeadline(
  budgetMs: number,
  now: () => number = Date.now,
): JobDeadline {
  const startedAtMs = now()
  const deadlineAtMs = startedAtMs + budgetMs

  return {
    remainingMs() {
      return deadlineAtMs - now()
    },
    capTimeoutMs(capMs) {
      const remaining = deadlineAtMs - now()
      if (remaining <= 0) {
        throw new JobDeadlineExceededError(now() - startedAtMs)
      }
      return Math.min(capMs, remaining)
    },
  }
}
