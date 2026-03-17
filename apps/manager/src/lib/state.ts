// Local job state manager.
// In development, persists to .data/jobs.json.
// In production, this should be backed by a durable store (Strapi or database).

import { readFile, writeFile, mkdir } from "node:fs/promises"
import { join, dirname } from "node:path"

const STATE_FILE = join(process.cwd(), ".data", "jobs.json")

export type JobStatus = "pending" | "processing" | "completed" | "failed"

export type JobStep =
  | "transcription"
  | "translation"
  | "voiceover"
  | "chapters"
  | "metadata"
  | "embeddings"

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

async function readStore(): Promise<JobStore> {
  try {
    const data = await readFile(STATE_FILE, "utf-8")
    return JSON.parse(data) as JobStore
  } catch {
    return { jobs: {} }
  }
}

async function writeStore(store: JobStore): Promise<void> {
  await mkdir(dirname(STATE_FILE), { recursive: true })
  await writeFile(STATE_FILE, JSON.stringify(store, null, 2))
}

export async function createJob(
  assetId: string,
  muxPlaybackId: string,
): Promise<Job> {
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
  const store = await readStore()
  const job = store.jobs[id]
  if (!job) return null

  Object.assign(job, updates, { updatedAt: new Date().toISOString() })
  await writeStore(store)
  return job
}
