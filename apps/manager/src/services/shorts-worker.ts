// Shorts-worker HTTP client (plan 2026-06-11-002 "Manager changes") —
// faithful clone of src/services/crop-worker.ts.
//
// apps/shorts-worker owns the bytes (ffmpeg clip trim + whisper word
// captions in the prepare lane, Remotion renders in the render lane) and
// reads/writes the shared Railway S3 artifact bucket directly. Manager
// submits jobs and polls status; the worker keeps job state in-memory, so an
// unknown workerJobId (404) means the job was lost (worker restart) and the
// caller resubmits — bounded by SHORTS_WORKER_MAX_RESUBMITS.
//
// Discriminated envelopes instead of throws so workflow steps can map
// failures to typed step errors. `retryable` advertises whether a transient
// retry is safe.

import { env } from "@/config/env"
import type { ShortRenderProps } from "@/lib/shorts-props"

const SHORTS_WORKER_HTTP_TIMEOUT_MS = 15_000

export const SHORTS_WORKER_POLL_INTERVAL_MS = 5_000
export const SHORTS_WORKER_MAX_RESUBMITS = 2

// queue_full (409) is a normal operational state while long renders drain
// the worker's bounded per-lane queues — wait and resubmit instead of
// failing the job.
export const SHORTS_WORKER_QUEUE_FULL_RETRY_INTERVAL_MS = 30_000
export const SHORTS_WORKER_MAX_QUEUE_FULL_RETRIES = 10

// Poll ceilings per kind. Each MUST stay strictly ABOVE the worker's
// matching enqueue-time job deadline (prepare 45min, render 70min — see
// apps/shorts-worker config/env.ts) so the worker's own deadline always
// classifies the failure first (root CLAUDE.md: outbound timeout shorter
// than caller budget, seen from the worker's side). Raise the pairs
// together, worker strictly below manager.
export const SHORTS_PREPARE_POLL_TIMEOUT_MS = 50 * 60_000
export const SHORTS_RENDER_POLL_TIMEOUT_MS = 80 * 60_000

export type ShortsWorkerJobKind = "prepare" | "render"

export type ShortsWorkerSubmitBody =
  | {
      kind: "prepare"
      /** Manager job id — log correlation only, deliberately NOT in the dedupe key. */
      jobId: string
      assetId: string
      source: { url: string }
      clip: { startSec: number; endSec: number }
      transcription: { language: string | null }
    }
  | {
      kind: "render"
      jobId: string
      assetId: string
      /** Opaque manager-computed sha256 hex (lib/shorts-props computePropsHash). */
      propsHash: string
      draftVersion: number
      props: ShortRenderProps
    }

// Mirrors apps/shorts-worker/src/routes/jobs.ts `jobDedupeKey` — the two
// halves of this contract must stay in sync (root CLAUDE.md: client mirrors
// server dedupe). The caller's manager job id is deliberately excluded so a
// re-launched workflow or operator retry re-attaches to the running worker
// job instead of duplicating it.
export function shortsWorkerDedupeKey(body: ShortsWorkerSubmitBody): string {
  if (body.kind === "prepare") {
    return `prepare:${body.assetId}`
  }
  return `render:${body.assetId}:${body.propsHash}`
}

export type ShortsWorkerJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"

export type ShortsWorkerArtifactRef = {
  assetId: string
  artifactType: string
  ext: string
}

export type ShortsWorkerJobResult = {
  artifacts: ShortsWorkerArtifactRef[]
  report: unknown
}

// Structured failure detail from GET /jobs/{id} (worker types.ts
// JobErrorBody) — unlike crop-worker's plain string `error`.
export type ShortsWorkerJobError = {
  reason: string
  messages: string[]
  retryable: boolean
}

export type ShortsWorkerJobSnapshot = {
  workerJobId: string
  kind: ShortsWorkerJobKind
  status: ShortsWorkerJobStatus
  progress: number | null
  message: string | null
  error: ShortsWorkerJobError | null
  result: ShortsWorkerJobResult | null
}

export type ShortsWorkerSubmitAccepted = {
  workerJobId: string
  status: ShortsWorkerJobStatus
}

export type ShortsWorkerFailureReason =
  | "config_missing"
  | "network_error"
  | "parse_error"
  | "worker_error"
  | "queue_full"
  | "job_lost"
  | "timeout"

export type ShortsWorkerFailure = {
  ok: false
  reason: ShortsWorkerFailureReason
  messages: string[]
  retryable: boolean
}

export type ShortsWorkerEnvelope<T> =
  | { ok: true; data: T }
  | ShortsWorkerFailure

export type ShortsWorkerClientOptions = {
  baseUrl?: string
  bearer?: string
  fetchImpl?: typeof fetch
}

type ShortsWorkerResolvedConfig = {
  ok: true
  baseUrl: string
  bearer: string
}

function resolveConfig(
  options: ShortsWorkerClientOptions,
): ShortsWorkerResolvedConfig | ShortsWorkerFailure {
  const baseUrl = options.baseUrl ?? env.SHORTS_WORKER_BASE_URL
  const bearer = options.bearer ?? env.SHORTS_WORKER_API_KEY
  if (!baseUrl || !bearer) {
    return {
      ok: false,
      reason: "config_missing",
      messages: [
        "SHORTS_WORKER_BASE_URL and SHORTS_WORKER_API_KEY must be set on apps/manager to call the shorts-worker",
      ],
      retryable: false,
    }
  }

  return { ok: true, baseUrl, bearer }
}

function networkFailure(error: unknown): ShortsWorkerFailure {
  const isTimeout =
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  return {
    ok: false,
    reason: "network_error",
    messages: [
      isTimeout
        ? `shorts-worker request timed out after ${SHORTS_WORKER_HTTP_TIMEOUT_MS}ms`
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
const JOB_KINDS = new Set(["prepare", "render"])

function parseJobResult(value: unknown): ShortsWorkerJobResult | null {
  const record = asRecord(value)
  if (!record || !Array.isArray(record.artifacts)) {
    return null
  }

  const artifacts: ShortsWorkerArtifactRef[] = []
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

function parseJobError(value: unknown): ShortsWorkerJobError | null {
  const record = asRecord(value)
  if (
    !record ||
    typeof record.reason !== "string" ||
    !Array.isArray(record.messages) ||
    !record.messages.every((message) => typeof message === "string") ||
    typeof record.retryable !== "boolean"
  ) {
    return null
  }

  return {
    reason: record.reason,
    messages: record.messages as string[],
    retryable: record.retryable,
  }
}

function parseJobSnapshot(value: unknown): ShortsWorkerJobSnapshot | null {
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

  // Same policy as a malformed result: a PRESENT but malformed error object
  // is a worker contract drift and must surface loudly as parse_error, not
  // be silently nulled into the "failed without an envelope" path.
  const error = record.error == null ? null : parseJobError(record.error)
  if (record.error != null && error === null) {
    return null
  }

  return {
    workerJobId: record.workerJobId,
    kind: record.kind as ShortsWorkerJobKind,
    status: record.status as ShortsWorkerJobStatus,
    progress: typeof record.progress === "number" ? record.progress : null,
    message: typeof record.message === "string" ? record.message : null,
    error,
    result,
  }
}

export async function submitShortsWorkerJob(
  body: ShortsWorkerSubmitBody,
  options: ShortsWorkerClientOptions = {},
): Promise<ShortsWorkerEnvelope<ShortsWorkerSubmitAccepted>> {
  const config = resolveConfig(options)
  if (!config.ok) {
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
        signal: AbortSignal.timeout(SHORTS_WORKER_HTTP_TIMEOUT_MS),
      },
    )
  } catch (error) {
    return networkFailure(error)
  }

  if (response.status === 409) {
    return {
      ok: false,
      reason: "queue_full",
      messages: ["shorts-worker queue is full"],
      retryable: true,
    }
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: "worker_error",
      messages: [`shorts-worker job submission returned ${response.status}`],
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
      messages: ["shorts-worker job submission returned an unexpected payload"],
      retryable: true,
    }
  }

  return {
    ok: true,
    data: {
      workerJobId: payload.workerJobId,
      status: payload.status as ShortsWorkerJobStatus,
    },
  }
}

export async function getShortsWorkerJob(
  workerJobId: string,
  options: ShortsWorkerClientOptions = {},
): Promise<ShortsWorkerEnvelope<ShortsWorkerJobSnapshot>> {
  const config = resolveConfig(options)
  if (!config.ok) {
    return config
  }

  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(
      new URL(`/jobs/${encodeURIComponent(workerJobId)}`, config.baseUrl),
      {
        method: "GET",
        headers: { authorization: `Bearer ${config.bearer}` },
        signal: AbortSignal.timeout(SHORTS_WORKER_HTTP_TIMEOUT_MS),
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
        `shorts-worker no longer knows job ${workerJobId} (worker restart?)`,
      ],
      retryable: true,
    }
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: "worker_error",
      messages: [`shorts-worker status poll returned ${response.status}`],
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
      messages: ["shorts-worker status poll returned an unexpected payload"],
      retryable: true,
    }
  }

  return { ok: true, data: snapshot }
}

export type PollShortsWorkerJobInput = {
  workerJobId: string
  onProgress?: (snapshot: ShortsWorkerJobSnapshot) => void | Promise<void>
  intervalMs?: number
  timeoutMs: number
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

// Polls a shorts-worker job until it completes, fails, or the deadline is
// exceeded. Elapsed time is accumulated from intervalMs (deterministic for
// tests with an injected sleep) — HTTP round-trip time is NOT counted, so
// wall-clock can overrun the nominal timeoutMs by up to one round-trip per
// interval. That slack is acceptable by design: the budget is interval-based,
// and the worker's own per-job deadline (strictly BELOW this manager ceiling
// — see the poll-ceiling constants above) is the real bound that classifies
// an overrunning job first. Transient poll failures (network/parse) keep
// polling until the deadline; job_lost returns immediately so the caller can
// resubmit.
export async function pollShortsWorkerJob(
  input: PollShortsWorkerJobInput,
  options: ShortsWorkerClientOptions = {},
): Promise<ShortsWorkerEnvelope<ShortsWorkerJobSnapshot>> {
  const intervalMs = input.intervalMs ?? SHORTS_WORKER_POLL_INTERVAL_MS
  const sleep = input.sleep ?? defaultSleep
  let elapsedMs = 0

  for (;;) {
    const polled = await getShortsWorkerJob(input.workerJobId, options)

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
        // The worker's structured error envelope drives the manager-side
        // classification: retryable:false → FatalError in the workflow step.
        return {
          ok: false,
          reason: "worker_error",
          messages: snapshot.error
            ? [
                `${snapshot.error.reason}: ${snapshot.error.messages.join("; ")}`,
              ]
            : ["shorts-worker job failed"],
          retryable: snapshot.error?.retryable ?? false,
        }
      }
      await input.onProgress?.(snapshot)
    }

    if (elapsedMs + intervalMs >= input.timeoutMs) {
      return {
        ok: false,
        reason: "timeout",
        messages: [
          `shorts-worker job ${input.workerJobId} did not complete within ${input.timeoutMs}ms`,
        ],
        retryable: false,
      }
    }

    await sleep(intervalMs)
    elapsedMs += intervalMs
  }
}

export type RunShortsWorkerJobInput = {
  body: ShortsWorkerSubmitBody
  pollTimeoutMs: number
  intervalMs?: number
  onProgress?: (snapshot: ShortsWorkerJobSnapshot) => void | Promise<void>
  maxResubmits?: number
  sleep?: (ms: number) => Promise<void>
}

// Submits one job, waiting out queue_full (409) responses: up to
// maxQueueFullRetries resubmissions spaced queueFullRetryIntervalMs apart
// before giving up with the queue_full envelope. This wait axis is separate
// from the job_lost resubmit counter in runShortsWorkerJob.
async function submitWithQueueFullBackoff(
  input: RunShortsWorkerJobInput,
  options: ShortsWorkerClientOptions,
): Promise<ShortsWorkerEnvelope<ShortsWorkerSubmitAccepted>> {
  const sleep = input.sleep ?? defaultSleep

  let submitted = await submitShortsWorkerJob(input.body, options)
  for (
    let queueFullRetry = 0;
    !submitted.ok &&
    submitted.reason === "queue_full" &&
    queueFullRetry < SHORTS_WORKER_MAX_QUEUE_FULL_RETRIES;
    queueFullRetry += 1
  ) {
    console.log(
      `[shorts-worker] event=queue_full_wait kind=${input.body.kind} assetId=${input.body.assetId} retry=${queueFullRetry + 1} waitMs=${SHORTS_WORKER_QUEUE_FULL_RETRY_INTERVAL_MS}`,
    )
    await sleep(SHORTS_WORKER_QUEUE_FULL_RETRY_INTERVAL_MS)
    submitted = await submitShortsWorkerJob(input.body, options)
  }

  return submitted
}

// Submit + poll with bounded resubmission when the worker loses the job
// (in-memory state, 404 on poll). Total submissions <= 1 + maxResubmits
// (each submission additionally rides out queue_full waits). The worker
// dedupes by `prepare:{assetId}` / `render:{assetId}:{propsHash}` — see
// shortsWorkerDedupeKey — so resubmits re-attach to a still-running job.
export async function runShortsWorkerJob(
  input: RunShortsWorkerJobInput,
  options: ShortsWorkerClientOptions = {},
): Promise<ShortsWorkerEnvelope<ShortsWorkerJobSnapshot>> {
  const maxResubmits = input.maxResubmits ?? SHORTS_WORKER_MAX_RESUBMITS

  let lastFailure: ShortsWorkerFailure | null = null
  for (let attempt = 0; attempt <= maxResubmits; attempt += 1) {
    const submitted = await submitWithQueueFullBackoff(input, options)
    if (!submitted.ok) {
      return submitted
    }

    console.log(
      `[shorts-worker] event=job_submitted kind=${input.body.kind} assetId=${input.body.assetId} workerJobId=${submitted.data.workerJobId} attempt=${attempt + 1}`,
    )

    const polled = await pollShortsWorkerJob(
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
      `[shorts-worker] event=job_lost kind=${input.body.kind} assetId=${input.body.assetId} workerJobId=${submitted.data.workerJobId} attempt=${attempt + 1}`,
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
        messages: ["shorts-worker lost the job after bounded resubmissions"],
        retryable: false,
      }
}
