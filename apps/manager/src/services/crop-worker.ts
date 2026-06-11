// Crop-worker HTTP client (plan 2026-06-09-002 "Crop-worker HTTP API").
//
// apps/crop-worker owns ffprobe/FFmpeg work (visual fingerprinting + 9:16
// rendering) and reads/writes the shared Railway S3 artifact bucket directly.
// Manager submits jobs and polls status; the worker keeps job state in-memory,
// so an unknown workerJobId (404) means the job was lost (worker restart) and
// the caller resubmits — bounded by CROP_WORKER_MAX_RESUBMITS.
//
// Discriminated envelopes instead of throws so workflow steps can map
// failures to typed step errors. `retryable` advertises whether a transient
// retry is safe.

import { env } from "@/config/env"

const CROP_WORKER_HTTP_TIMEOUT_MS = 15_000

export const CROP_WORKER_POLL_INTERVAL_MS = 5_000
export const CROP_WORKER_MAX_RESUBMITS = 2

// queue_full (409) is a normal operational state while long renders drain the
// worker's bounded queue — wait and resubmit instead of failing the job.
export const CROP_WORKER_QUEUE_FULL_RETRY_INTERVAL_MS = 30_000
export const CROP_WORKER_MAX_QUEUE_FULL_RETRIES = 10

export type CropWorkerJobKind = "fingerprint" | "render"

export type CropWorkerRenderMode = "preview" | "full"

export type CropWorkerSubmitBody =
  | {
      kind: "fingerprint"
      jobId: string
      assetId: string
      source: { url: string }
    }
  | {
      kind: "render"
      jobId: string
      assetId: string
      source: { url: string }
      render: {
        mode: CropWorkerRenderMode
        cropPlan: { assetId: string }
        timelineMap?: { assetId: string }
        previewFrameCount?: number
      }
    }

export type CropWorkerJobStatus = "queued" | "running" | "completed" | "failed"

export type CropWorkerArtifactRef = {
  assetId: string
  artifactType: string
  ext: string
}

export type CropWorkerJobResult = {
  artifacts: CropWorkerArtifactRef[]
  report: unknown
}

export type CropWorkerJobSnapshot = {
  workerJobId: string
  kind: CropWorkerJobKind
  status: CropWorkerJobStatus
  progress: number | null
  message: string | null
  error: string | null
  result: CropWorkerJobResult | null
}

export type CropWorkerSubmitAccepted = {
  workerJobId: string
  status: CropWorkerJobStatus
}

export type CropWorkerFailureReason =
  | "config_missing"
  | "network_error"
  | "parse_error"
  | "worker_error"
  | "queue_full"
  | "job_lost"
  | "timeout"

export type CropWorkerFailure = {
  ok: false
  reason: CropWorkerFailureReason
  messages: string[]
  retryable: boolean
}

export type CropWorkerEnvelope<T> = { ok: true; data: T } | CropWorkerFailure

export type CropWorkerClientOptions = {
  baseUrl?: string
  bearer?: string
  fetchImpl?: typeof fetch
}

function resolveConfig(
  options: CropWorkerClientOptions,
): { baseUrl: string; bearer: string } | CropWorkerFailure {
  const baseUrl = options.baseUrl ?? env.CROP_WORKER_BASE_URL
  const bearer = options.bearer ?? env.CROP_WORKER_API_KEY
  if (!baseUrl || !bearer) {
    return {
      ok: false,
      reason: "config_missing",
      messages: [
        "CROP_WORKER_BASE_URL and CROP_WORKER_API_KEY must be set on apps/manager to call the crop-worker",
      ],
      retryable: false,
    }
  }

  return { baseUrl, bearer }
}

function networkFailure(error: unknown): CropWorkerFailure {
  const isTimeout =
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  return {
    ok: false,
    reason: "network_error",
    messages: [
      isTimeout
        ? `crop-worker request timed out after ${CROP_WORKER_HTTP_TIMEOUT_MS}ms`
        : error instanceof Error
          ? error.message
          : String(error),
    ],
    retryable: true,
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

const JOB_STATUSES = new Set(["queued", "running", "completed", "failed"])
const JOB_KINDS = new Set(["fingerprint", "render"])

function parseJobResult(value: unknown): CropWorkerJobResult | null {
  const record = asRecord(value)
  if (!record || !Array.isArray(record.artifacts)) {
    return null
  }

  const artifacts: CropWorkerArtifactRef[] = []
  for (const entry of record.artifacts) {
    const ref = asRecord(entry)
    if (
      !ref ||
      typeof ref.assetId !== "string" ||
      typeof ref.artifactType !== "string" ||
      typeof ref.ext !== "string"
    ) {
      return null
    }
    artifacts.push({
      assetId: ref.assetId,
      artifactType: ref.artifactType,
      ext: ref.ext,
    })
  }

  return { artifacts, report: record.report ?? null }
}

function parseJobSnapshot(value: unknown): CropWorkerJobSnapshot | null {
  const record = asRecord(value)
  if (
    !record ||
    typeof record.workerJobId !== "string" ||
    typeof record.kind !== "string" ||
    !JOB_KINDS.has(record.kind) ||
    typeof record.status !== "string" ||
    !JOB_STATUSES.has(record.status)
  ) {
    return null
  }

  const result = record.result == null ? null : parseJobResult(record.result)
  if (record.result != null && result === null) {
    return null
  }

  return {
    workerJobId: record.workerJobId,
    kind: record.kind as CropWorkerJobKind,
    status: record.status as CropWorkerJobStatus,
    progress: typeof record.progress === "number" ? record.progress : null,
    message: typeof record.message === "string" ? record.message : null,
    error: typeof record.error === "string" ? record.error : null,
    result,
  }
}

export async function submitCropWorkerJob(
  body: CropWorkerSubmitBody,
  options: CropWorkerClientOptions = {},
): Promise<CropWorkerEnvelope<CropWorkerSubmitAccepted>> {
  const config = resolveConfig(options)
  if ("ok" in config) {
    return config
  }

  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(
      new URL("/jobs", config.baseUrl),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.bearer}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(CROP_WORKER_HTTP_TIMEOUT_MS),
      },
    )
  } catch (error) {
    return networkFailure(error)
  }

  if (response.status === 409) {
    return {
      ok: false,
      reason: "queue_full",
      messages: ["crop-worker queue is full"],
      retryable: true,
    }
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: "worker_error",
      messages: [`crop-worker job submission returned ${response.status}`],
      retryable: response.status >= 500 || response.status === 429,
    }
  }

  const payload = asRecord(await response.json().catch(() => undefined))
  if (
    !payload ||
    typeof payload.workerJobId !== "string" ||
    typeof payload.status !== "string" ||
    !JOB_STATUSES.has(payload.status)
  ) {
    return {
      ok: false,
      reason: "parse_error",
      messages: ["crop-worker job submission returned an unexpected payload"],
      retryable: true,
    }
  }

  return {
    ok: true,
    data: {
      workerJobId: payload.workerJobId,
      status: payload.status as CropWorkerJobStatus,
    },
  }
}

export async function getCropWorkerJob(
  workerJobId: string,
  options: CropWorkerClientOptions = {},
): Promise<CropWorkerEnvelope<CropWorkerJobSnapshot>> {
  const config = resolveConfig(options)
  if ("ok" in config) {
    return config
  }

  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(
      new URL(`/jobs/${encodeURIComponent(workerJobId)}`, config.baseUrl),
      {
        method: "GET",
        headers: { authorization: `Bearer ${config.bearer}` },
        signal: AbortSignal.timeout(CROP_WORKER_HTTP_TIMEOUT_MS),
      },
    )
  } catch (error) {
    return networkFailure(error)
  }

  if (response.status === 404) {
    return {
      ok: false,
      reason: "job_lost",
      messages: [
        `crop-worker no longer knows job ${workerJobId} (worker restart?)`,
      ],
      retryable: true,
    }
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: "worker_error",
      messages: [`crop-worker status poll returned ${response.status}`],
      retryable: response.status >= 500 || response.status === 429,
    }
  }

  const snapshot = parseJobSnapshot(
    await response.json().catch(() => undefined),
  )
  if (!snapshot) {
    return {
      ok: false,
      reason: "parse_error",
      messages: ["crop-worker status poll returned an unexpected payload"],
      retryable: true,
    }
  }

  return { ok: true, data: snapshot }
}

export type PollCropWorkerJobInput = {
  workerJobId: string
  onProgress?: (snapshot: CropWorkerJobSnapshot) => void | Promise<void>
  intervalMs?: number
  timeoutMs: number
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

// Polls a crop-worker job until it completes, fails, or the deadline is
// exceeded. Elapsed time is accumulated from intervalMs (deterministic for
// tests with an injected sleep). Transient poll failures (network/parse)
// keep polling until the deadline; job_lost returns immediately so the
// caller can resubmit.
export async function pollCropWorkerJob(
  input: PollCropWorkerJobInput,
  options: CropWorkerClientOptions = {},
): Promise<CropWorkerEnvelope<CropWorkerJobSnapshot>> {
  const intervalMs = input.intervalMs ?? CROP_WORKER_POLL_INTERVAL_MS
  const sleep = input.sleep ?? defaultSleep
  let elapsedMs = 0

  for (;;) {
    const polled = await getCropWorkerJob(input.workerJobId, options)

    if (!polled.ok) {
      if (polled.reason === "job_lost" || !polled.retryable) {
        return polled
      }
      // Transient poll failure — keep polling until the deadline.
    } else {
      const snapshot = polled.data
      if (snapshot.status === "completed") {
        return { ok: true, data: snapshot }
      }
      if (snapshot.status === "failed") {
        return {
          ok: false,
          reason: "worker_error",
          messages: [snapshot.error ?? "crop-worker job failed"],
          retryable: false,
        }
      }
      await input.onProgress?.(snapshot)
    }

    if (elapsedMs + intervalMs >= input.timeoutMs) {
      return {
        ok: false,
        reason: "timeout",
        messages: [
          `crop-worker job ${input.workerJobId} did not complete within ${input.timeoutMs}ms`,
        ],
        retryable: false,
      }
    }

    await sleep(intervalMs)
    elapsedMs += intervalMs
  }
}

export type RunCropWorkerJobInput = {
  body: CropWorkerSubmitBody
  pollTimeoutMs: number
  intervalMs?: number
  onProgress?: (snapshot: CropWorkerJobSnapshot) => void | Promise<void>
  maxResubmits?: number
  sleep?: (ms: number) => Promise<void>
}

// Submits one job, waiting out queue_full (409) responses: up to
// maxQueueFullRetries resubmissions spaced queueFullRetryIntervalMs apart
// before giving up with the queue_full envelope. This wait axis is separate
// from the job_lost resubmit counter in runCropWorkerJob.
async function submitWithQueueFullBackoff(
  input: RunCropWorkerJobInput,
  options: CropWorkerClientOptions,
): Promise<CropWorkerEnvelope<CropWorkerSubmitAccepted>> {
  const sleep = input.sleep ?? defaultSleep

  let submitted = await submitCropWorkerJob(input.body, options)
  for (
    let queueFullRetry = 0;
    !submitted.ok &&
    submitted.reason === "queue_full" &&
    queueFullRetry < CROP_WORKER_MAX_QUEUE_FULL_RETRIES;
    queueFullRetry += 1
  ) {
    console.log(
      `[crop-worker] event=queue_full_wait kind=${input.body.kind} assetId=${input.body.assetId} retry=${queueFullRetry + 1} waitMs=${CROP_WORKER_QUEUE_FULL_RETRY_INTERVAL_MS}`,
    )
    await sleep(CROP_WORKER_QUEUE_FULL_RETRY_INTERVAL_MS)
    submitted = await submitCropWorkerJob(input.body, options)
  }

  return submitted
}

// Submit + poll with bounded resubmission when the worker loses the job
// (in-memory state, 404 on poll). Total submissions <= 1 + maxResubmits
// (each submission additionally rides out queue_full waits).
export async function runCropWorkerJob(
  input: RunCropWorkerJobInput,
  options: CropWorkerClientOptions = {},
): Promise<CropWorkerEnvelope<CropWorkerJobSnapshot>> {
  const maxResubmits = input.maxResubmits ?? CROP_WORKER_MAX_RESUBMITS

  let lastFailure: CropWorkerFailure | null = null
  for (let attempt = 0; attempt <= maxResubmits; attempt += 1) {
    const submitted = await submitWithQueueFullBackoff(input, options)
    if (!submitted.ok) {
      return submitted
    }

    console.log(
      `[crop-worker] event=job_submitted kind=${input.body.kind} assetId=${input.body.assetId} workerJobId=${submitted.data.workerJobId} attempt=${attempt + 1}`,
    )

    const polled = await pollCropWorkerJob(
      {
        workerJobId: submitted.data.workerJobId,
        onProgress: input.onProgress,
        intervalMs: input.intervalMs,
        timeoutMs: input.pollTimeoutMs,
        sleep: input.sleep,
      },
      options,
    )

    if (polled.ok || polled.reason !== "job_lost") {
      return polled
    }

    lastFailure = polled
    console.warn(
      `[crop-worker] event=job_lost kind=${input.body.kind} assetId=${input.body.assetId} workerJobId=${submitted.data.workerJobId} attempt=${attempt + 1}`,
    )
  }

  // The bounded resubmit budget IS the retry policy for job_lost — advertise
  // retryable:false so callers (workflow steps) don't compound it with their
  // own retries.
  return lastFailure
    ? { ...lastFailure, retryable: false }
    : {
        ok: false,
        reason: "job_lost",
        messages: ["crop-worker lost the job after bounded resubmissions"],
        retryable: false,
      }
}
