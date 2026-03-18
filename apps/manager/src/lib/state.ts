// Local job state manager.
// In development, persists to .data/jobs.json with a mutex for concurrency safety.
// In production, this should be backed by a durable store (Strapi or database).

if (process.env.NODE_ENV === "production") {
  console.warn(
    "⚠️ WARNING: File-based job state is not durable on Railway. Data will be lost on deploy/restart. Replace with database before production use.",
  )
}

import { readFile, writeFile, mkdir, rename } from "node:fs/promises"
import { join, dirname } from "node:path"
import type {
  JobRecord,
  JobStatus,
  WorkflowStepName,
  StepStatus,
} from "@/types/job"
import { buildInitialSteps } from "@/lib/workflow-steps"

export type { JobRecord, JobStatus, WorkflowStepName, StepStatus }

const STATE_FILE = join(process.cwd(), ".data", "jobs.json")

type JobStore = {
  jobs: Record<string, JobRecord>
}

// Simple promise-based mutex to serialize file read-modify-write cycles.
let mutexPromise: Promise<void> = Promise.resolve()

function withMutex<T>(fn: () => Promise<T>): Promise<T> {
  const result = mutexPromise.then(fn)
  mutexPromise = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

let dirCreated = false

async function readStore(): Promise<JobStore> {
  try {
    const data = await readFile(STATE_FILE, "utf-8")
    const parsed: unknown = JSON.parse(data)
    if (typeof parsed === "object" && parsed !== null && "jobs" in parsed) {
      return parsed as JobStore
    }
    return { jobs: {} }
  } catch {
    return { jobs: {} }
  }
}

async function writeStore(store: JobStore): Promise<void> {
  if (!dirCreated) {
    await mkdir(dirname(STATE_FILE), { recursive: true })
    dirCreated = true
  }
  // Atomic write: write to temp file, then rename
  const tmpFile = `${STATE_FILE}.tmp`
  await writeFile(tmpFile, JSON.stringify(store, null, 2))
  await rename(tmpFile, STATE_FILE)
}

export async function createJob(
  muxAssetId: string,
  muxPlaybackId: string,
  languages: string[] = [],
): Promise<JobRecord> {
  return withMutex(async () => {
    const store = await readStore()
    const id = crypto.randomUUID()
    const now = new Date().toISOString()

    const job: JobRecord = {
      id,
      muxAssetId,
      muxPlaybackId,
      languages,
      status: "pending",
      retries: 0,
      createdAt: now,
      updatedAt: now,
      artifacts: {},
      steps: buildInitialSteps(),
      errors: [],
    }

    store.jobs[id] = job
    await writeStore(store)
    return job
  })
}

export async function getJob(id: string): Promise<JobRecord | null> {
  const store = await readStore()
  return store.jobs[id] ?? null
}

export async function listJobs(): Promise<JobRecord[]> {
  const store = await readStore()
  return Object.values(store.jobs).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
}

export async function updateJob(
  id: string,
  updates: Partial<
    Pick<
      JobRecord,
      | "status"
      | "currentStep"
      | "artifacts"
      | "startedAt"
      | "completedAt"
      | "retries"
    >
  >,
): Promise<JobRecord | null> {
  return withMutex(async () => {
    const store = await readStore()
    const job = store.jobs[id]
    if (!job) return null

    store.jobs[id] = {
      ...job,
      ...updates,
      updatedAt: new Date().toISOString(),
    }
    await writeStore(store)
    return store.jobs[id]
  })
}

export async function updateStepStatus(
  jobId: string,
  stepName: WorkflowStepName,
  status: StepStatus,
  error?: string,
): Promise<JobRecord | null> {
  return withMutex(async () => {
    const store = await readStore()
    const job = store.jobs[jobId]
    if (!job) return null

    const now = new Date().toISOString()
    const step = job.steps.find((s) => s.name === stepName)
    if (step) {
      step.status = status
      if (status === "running" && !step.startedAt) {
        step.startedAt = now
      }
      if (status === "completed" || status === "failed") {
        step.finishedAt = now
      }
      if (error) {
        step.error = error
      }
    }

    if (error) {
      job.errors.push({ step: stepName, message: error, at: now })
    }

    job.updatedAt = now
    await writeStore(store)
    return store.jobs[jobId]
  })
}
