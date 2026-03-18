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

const STATE_FILE = join(process.cwd(), ".data", "jobs.json")

export type JobStatus = "pending" | "processing" | "completed" | "failed"

export type JobStep =
  | "transcription"
  | "translation"
  | "chapters"
  | "metadata"
  | "embeddings"

export const ALL_STEPS: readonly JobStep[] = [
  "transcription",
  "translation",
  "chapters",
  "metadata",
  "embeddings",
] as const

export type Job = {
  id: string
  assetId: string
  muxPlaybackId: string
  status: JobStatus
  currentStep: JobStep | null
  completedSteps: JobStep[]
  artifacts: Record<string, string>
  error: string | null
  createdAt: string
  updatedAt: string
}

type JobStore = {
  jobs: Record<string, Job>
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
  assetId: string,
  muxPlaybackId: string,
): Promise<Job> {
  return withMutex(async () => {
    const store = await readStore()
    const id = crypto.randomUUID()
    const now = new Date().toISOString()

    const job: Job = {
      id,
      assetId,
      muxPlaybackId,
      status: "pending",
      currentStep: null,
      completedSteps: [],
      artifacts: {},
      error: null,
      createdAt: now,
      updatedAt: now,
    }

    store.jobs[id] = job
    await writeStore(store)
    return job
  })
}

export async function getJob(id: string): Promise<Job | null> {
  const store = await readStore()
  return store.jobs[id] ?? null
}

export async function listJobs(): Promise<Job[]> {
  const store = await readStore()
  return Object.values(store.jobs).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
}

export async function updateJob(
  id: string,
  updates: Partial<
    Pick<
      Job,
      "status" | "currentStep" | "completedSteps" | "artifacts" | "error"
    >
  >,
): Promise<Job | null> {
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
