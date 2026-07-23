// In-memory job registry + TWO independent bounded lanes keyed by workload
// (prepare and render — devotional renders share render capacity). Worker state
// is deliberately in-memory:
// manager polls GET /jobs/{workerJobId} and treats 404 after a restart as a
// lost job, resubmitting (bounded). Single replica only — see railway.toml.

import { randomUUID } from "node:crypto"
import { env } from "./config/env.js"
import { toJobErrorBody } from "./errors.js"
import type {
  JobErrorBody,
  JobKind,
  JobResult,
  WorkerJobStatus,
} from "./types.js"

export type JobRecord = {
  workerJobId: string
  kind: JobKind
  /**
   * Logical job identity used for in-flight dedupe (see submit). Routes
   * derive it from the request body's stable ids — `prepare:{assetId}` /
   * `render:{assetId}:{propsHash}` / devotional output+input hash — deliberately
   * NOT the manager jobId, so
   * a re-launched workflow or operator retry for the same asset re-attaches
   * to the running job instead of double-rendering.
   */
  dedupeKey: string
  status: WorkerJobStatus
  progress: number
  message: string | null
  error: JobErrorBody | null
  result: JobResult | null
  createdAt: Date
  updatedAt: Date
}

export type JobProgress = (progress: number, message: string) => void

export type JobExecutor = (context: {
  onProgress: JobProgress
  signal: AbortSignal
}) => Promise<JobResult>

export type SubmitOutcome =
  | { ok: true; job: JobRecord; deduped: boolean }
  | { ok: false; reason: "queue_full" }

export type JobQueue = {
  submit(kind: JobKind, dedupeKey: string, execute: JobExecutor): SubmitOutcome
  get(workerJobId: string): JobRecord | undefined
  cancel(workerJobId: string): JobRecord | undefined
}

export type LaneConfig = {
  concurrency: number
  limit: number
}

export type CreateJobLanesOptions = {
  prepare?: Partial<LaneConfig>
  render?: Partial<LaneConfig>
  /** Injectable clock (tests). Defaults to `() => new Date()`. */
  now?: () => Date
}

// Terminal (completed/failed/cancelled) records are kept long enough for manager's
// poll loop to read the outcome, then evicted on the next submit so the
// in-memory registry can't grow unboundedly over the process lifetime.
// 24h is orders of magnitude beyond the longest poll ceiling (80min render).
export const TERMINAL_RECORD_RETENTION_MS = 24 * 60 * 60 * 1000

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

type Lane = {
  kind: JobKind
  concurrency: number
  limit: number
  pending: Array<{
    job: JobRecord
    execute: JobExecutor
    controller: AbortController
  }>
  runningCount: number
}

export function createJobLanes(options: CreateJobLanesOptions = {}): JobQueue {
  // Registry is shared across lanes (GET /jobs/{id} doesn't know the kind);
  // execution capacity is per-lane so a long render never starves prepares.
  const jobs = new Map<string, JobRecord>()
  const runningControllers = new Map<string, AbortController>()
  const now = options.now ?? (() => new Date())

  // Submit-time eviction of stale terminal records: a terminal record's
  // updatedAt IS its finish time (nothing mutates it after completed/failed),
  // so prune anything terminal older than the retention window. Active
  // (queued/running) jobs are never evicted regardless of age.
  function evictStaleTerminalRecords(): void {
    const cutoff = now().getTime() - TERMINAL_RECORD_RETENTION_MS
    for (const [workerJobId, record] of jobs) {
      if (
        (record.status === "completed" ||
          record.status === "failed" ||
          record.status === "cancelled") &&
        record.updatedAt.getTime() < cutoff
      ) {
        jobs.delete(workerJobId)
      }
    }
  }

  function lane(kind: JobKind, overrides?: Partial<LaneConfig>): Lane {
    return {
      kind,
      concurrency: overrides?.concurrency ?? 1,
      limit: overrides?.limit ?? env.SHORTS_WORKER_QUEUE_LIMIT,
      pending: [],
      runningCount: 0,
    }
  }

  const prepareLane = lane("prepare", options.prepare)
  const renderLane = lane("render", options.render)
  const lanes: Record<JobKind, Lane> = {
    prepare: prepareLane,
    render: renderLane,
    "devotional-render": renderLane,
  }

  function pump(target: Lane): void {
    while (
      target.runningCount < target.concurrency &&
      target.pending.length > 0
    ) {
      const entry = target.pending.shift()!
      target.runningCount += 1
      void runJob(target, entry)
    }
  }

  async function runJob(
    target: Lane,
    entry: {
      job: JobRecord
      execute: JobExecutor
      controller: AbortController
    },
  ): Promise<void> {
    const { job, execute, controller } = entry
    runningControllers.set(job.workerJobId, controller)

    // Slot-leak guard: the ENTIRE body lives inside try/catch/finally so a
    // synchronous throw anywhere (status mutation, logging, executor call)
    // still releases the lane slot and pumps the queue (root CLAUDE.md:
    // in-memory slot reservation fire-and-forget).
    try {
      job.status = "running"
      job.updatedAt = now()
      console.log(
        `[shorts-worker] event=job_started workerJobId=${job.workerJobId} kind=${job.kind}`,
      )

      const result = await execute({
        signal: controller.signal,
        onProgress: (progress, message) => {
          if (controller.signal.aborted) return
          job.progress = clampProgress(progress)
          job.message = message
          job.updatedAt = now()
        },
      })

      if (controller.signal.aborted) {
        job.status = "cancelled"
        job.message = "Cancelled"
        job.result = null
        job.error = null
        job.updatedAt = now()
        return
      }
      job.status = "completed"
      job.progress = 1
      job.result = result
      job.error = null
      job.updatedAt = now()
      console.log(
        `[shorts-worker] event=job_completed workerJobId=${job.workerJobId} kind=${job.kind}`,
      )
    } catch (error) {
      if (controller.signal.aborted) {
        job.status = "cancelled"
        job.message = "Cancelled"
        job.error = null
        job.result = null
        job.updatedAt = now()
        return
      }
      job.status = "failed"
      job.error = toJobErrorBody(error)
      job.updatedAt = now()
      console.error(
        `[shorts-worker] event=job_failed workerJobId=${job.workerJobId} kind=${job.kind} reason=${job.error.reason} retryable=${job.error.retryable} error=${JSON.stringify(job.error.messages.join("; "))}`,
      )
    } finally {
      runningControllers.delete(job.workerJobId)
      target.runningCount -= 1
      pump(target)
    }
  }

  return {
    submit(kind, dedupeKey, execute) {
      evictStaleTerminalRecords()

      // In-flight dedupe: a resubmission with the same logical identity
      // re-attaches to the ACTIVE (queued/running) job instead of enqueueing
      // a duplicate render (manager restarts, SDK step retries, operator
      // retries). Completed/failed records do NOT dedupe — manager resubmits
      // after a failure intentionally.
      for (const existing of jobs.values()) {
        if (
          existing.dedupeKey === dedupeKey &&
          (existing.status === "queued" || existing.status === "running")
        ) {
          return { ok: true, job: existing, deduped: true }
        }
      }

      const target = lanes[kind]
      if (target.pending.length + target.runningCount >= target.limit) {
        return { ok: false, reason: "queue_full" }
      }

      const submittedAt = now()
      const job: JobRecord = {
        workerJobId: `wj_${randomUUID()}`,
        kind,
        dedupeKey,
        status: "queued",
        progress: 0,
        message: null,
        error: null,
        result: null,
        createdAt: submittedAt,
        updatedAt: submittedAt,
      }
      const controller = new AbortController()
      jobs.set(job.workerJobId, job)
      target.pending.push({ job, execute, controller })
      queueMicrotask(() => pump(target))

      return { ok: true, job, deduped: false }
    },

    get(workerJobId) {
      return jobs.get(workerJobId)
    },

    cancel(workerJobId) {
      const job = jobs.get(workerJobId)
      if (!job || job.kind !== "devotional-render") return undefined
      if (job.status !== "queued" && job.status !== "running") return job
      const target = lanes["devotional-render"]
      const pendingIndex = target.pending.findIndex(
        (entry) => entry.job.workerJobId === workerJobId,
      )
      if (pendingIndex >= 0) {
        const [entry] = target.pending.splice(pendingIndex, 1)
        entry?.controller.abort()
      } else {
        // The running entry is not retained by the lane. Locate its controller
        // through a small side table maintained below.
        runningControllers.get(workerJobId)?.abort()
      }
      job.status = "cancelled"
      job.message = "Cancelled"
      job.error = null
      job.result = null
      job.updatedAt = now()
      return job
    },
  }
}
