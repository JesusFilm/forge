// In-memory job registry + bounded queue. Worker state is deliberately
// in-memory (plan deviation 2): manager polls GET /jobs/{workerJobId} and
// treats 404 after a restart as a lost job, resubmitting (bounded).

import { randomUUID } from "node:crypto"
import { env } from "./config/env.js"
import type { JobKind, JobResult, WorkerJobStatus } from "./types.js"

export type JobRecord = {
  workerJobId: string
  kind: JobKind
  /**
   * Logical job identity used for in-flight dedupe (see submit). Routes
   * derive it from the request body's stable ids (assetId, mode, plan/map
   * asset ids) — deliberately NOT the manager jobId, so a re-launched
   * workflow or operator retry for the same asset re-attaches to the
   * running job instead of double-rendering.
   */
  dedupeKey: string
  status: WorkerJobStatus
  progress: number
  message: string | null
  error: string | null
  result: JobResult | null
  createdAt: Date
  updatedAt: Date
}

export type JobProgress = (progress: number, message: string) => void

export type JobExecutor = (context: {
  onProgress: JobProgress
}) => Promise<JobResult>

export type SubmitOutcome =
  | { ok: true; job: JobRecord; deduped: boolean }
  | { ok: false; reason: "queue_full" }

export type JobQueue = {
  submit(kind: JobKind, dedupeKey: string, execute: JobExecutor): SubmitOutcome
  get(workerJobId: string): JobRecord | undefined
}

export type CreateJobQueueOptions = {
  concurrency?: number
  limit?: number
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

export function createJobQueue({
  concurrency = env.CROP_WORKER_MAX_CONCURRENT_JOBS,
  limit = env.CROP_WORKER_QUEUE_LIMIT,
}: CreateJobQueueOptions = {}): JobQueue {
  const jobs = new Map<string, JobRecord>()
  const pending: Array<{ job: JobRecord; execute: JobExecutor }> = []
  let runningCount = 0

  function inFlightCount(): number {
    return pending.length + runningCount
  }

  function pump(): void {
    while (runningCount < concurrency && pending.length > 0) {
      const entry = pending.shift()!
      runningCount += 1
      void runJob(entry)
    }
  }

  async function runJob(entry: {
    job: JobRecord
    execute: JobExecutor
  }): Promise<void> {
    const { job, execute } = entry

    // Slot-leak guard: the ENTIRE body lives inside try/catch/finally so a
    // synchronous throw anywhere (status mutation, logging, executor call)
    // still releases the concurrency slot and pumps the queue.
    try {
      job.status = "running"
      job.updatedAt = new Date()
      console.log(
        `[crop-worker] event=job_started workerJobId=${job.workerJobId} kind=${job.kind}`,
      )

      const result = await execute({
        onProgress: (progress, message) => {
          job.progress = clampProgress(progress)
          job.message = message
          job.updatedAt = new Date()
        },
      })

      job.status = "completed"
      job.progress = 1
      job.result = result
      job.error = null
      job.updatedAt = new Date()
      console.log(
        `[crop-worker] event=job_completed workerJobId=${job.workerJobId} kind=${job.kind}`,
      )
    } catch (error) {
      job.status = "failed"
      job.error = error instanceof Error ? error.message : String(error)
      job.updatedAt = new Date()
      console.error(
        `[crop-worker] event=job_failed workerJobId=${job.workerJobId} kind=${job.kind} error=${JSON.stringify(job.error)}`,
      )
    } finally {
      runningCount -= 1
      pump()
    }
  }

  return {
    submit(kind, dedupeKey, execute) {
      // In-flight dedupe: a resubmission with the same logical identity
      // re-attaches to the ACTIVE (queued/running) job instead of enqueueing
      // a duplicate multi-hour render (manager restarts, SDK step retries,
      // operator retries). Completed/failed records do NOT dedupe — manager
      // resubmits after a failure intentionally.
      for (const existing of jobs.values()) {
        if (
          existing.dedupeKey === dedupeKey &&
          (existing.status === "queued" || existing.status === "running")
        ) {
          return { ok: true, job: existing, deduped: true }
        }
      }

      if (inFlightCount() >= limit) {
        return { ok: false, reason: "queue_full" }
      }

      const now = new Date()
      const job: JobRecord = {
        workerJobId: `wj_${randomUUID()}`,
        kind,
        dedupeKey,
        status: "queued",
        progress: 0,
        message: null,
        error: null,
        result: null,
        createdAt: now,
        updatedAt: now,
      }
      jobs.set(job.workerJobId, job)
      pending.push({ job, execute })
      queueMicrotask(pump)

      return { ok: true, job, deduped: false }
    },

    get(workerJobId) {
      return jobs.get(workerJobId)
    },
  }
}
