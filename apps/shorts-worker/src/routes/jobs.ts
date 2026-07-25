// POST /jobs + GET /jobs/{workerJobId} — the shorts-worker HTTP contract
// from docs/plans/2026-06-11-002-feat-manager-shorts-studio-plan.md.

import type { IncomingMessage, ServerResponse } from "node:http"
import { z } from "zod"
import { shortInputPropsSchema } from "@forge/shorts-compositions/schema"
import { validateBearer, type ValidateBearerOptions } from "../auth.js"
import { env } from "../config/env.js"
import { createJobDeadline } from "../deadline.js"
import { runDevotionalRender } from "../devotional-render.js"
import {
  InvalidJsonBodyError,
  readJsonBody,
  RequestBodyTooLargeError,
  sendJson,
  UnsupportedContentTypeError,
} from "../http.js"
import type { JobQueue, JobRecord } from "../jobs.js"
import { runPrepare } from "../prepare.js"
import { runRender } from "../render.js"
import {
  parseAllowedHosts,
  SourceUrlRejectedError,
  validateSourceUrl,
} from "../source-url.js"
import type { JobStatusBody } from "../types.js"

// Matches storage's SAFE_KEY_PATTERN: ids become flat S3 key components.
const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/
// Opaque manager-computed sha256 hex (plan decision 8) — shape-checked only,
// NEVER recomputed here.
const PROPS_HASH_PATTERN = /^[a-f0-9]{64}$/

const assetIdSchema = z.string().regex(SAFE_ID_PATTERN)

const prepareJobSchema = z.looseObject({
  kind: z.literal("prepare"),
  /** Manager job id — log correlation only, deliberately NOT in the dedupe key. */
  jobId: z.string().min(1).optional(),
  assetId: assetIdSchema,
  source: z.looseObject({ url: z.string().min(1) }),
  clip: z
    .looseObject({
      startSec: z.number().min(0),
      endSec: z.number(),
    })
    .refine((clip) => clip.endSec > clip.startSec, {
      message: "clip.endSec must be greater than clip.startSec",
    }),
  transcription: z.looseObject({
    language: z.string().min(1).nullable(),
  }),
})

const renderJobSchema = z.looseObject({
  kind: z.literal("render"),
  jobId: z.string().min(1).optional(),
  assetId: assetIdSchema,
  propsHash: z.string().regex(PROPS_HASH_PATTERN),
  draftVersion: z.number().int().min(0),
  // Full composition props minus the server-injected clipUrl (plan decision
  // 15) — the schema is the compositions package's, single source of truth.
  props: shortInputPropsSchema.omit({ clipUrl: true }),
})

const devotionalRenderJobSchema = z.looseObject({
  kind: z.literal("devotional-render"),
  jobId: z.string().min(1).optional(),
  /** Durable workflow identity for provenance/log correlation. */
  runId: z.string().regex(SAFE_ID_PATTERN).max(128),
  /** Prefix holding the uploaded input spec + narration/music artifacts. */
  inputAssetId: assetIdSchema.max(128),
  /** Separate run-scoped prefix for worker-produced outputs. */
  outputAssetId: assetIdSchema.max(128),
  /** Opaque sha256 of the uploaded input set; shape-checked, never recomputed. */
  inputHash: z.string().regex(PROPS_HASH_PATTERN),
})

export const jobRequestSchema = z.discriminatedUnion("kind", [
  prepareJobSchema,
  renderJobSchema,
  devotionalRenderJobSchema,
])

export type JobRequest = z.infer<typeof jobRequestSchema>

// Logical job identity for in-flight dedupe (plan decision 8). Deliberately
// excludes the caller's job id so a re-launched workflow or operator retry
// re-attaches to the running job. The manager client mirrors these keys
// pre-submit (root CLAUDE.md: client mirrors server dedupe).
export function jobDedupeKey(body: JobRequest): string {
  if (body.kind === "prepare") {
    return `prepare:${body.assetId}`
  }
  if (body.kind === "render") {
    return `render:${body.assetId}:${body.propsHash}`
  }
  return `devotional-render:${body.outputAssetId}:${body.inputHash}`
}

export type JobsRouteOptions = {
  queue: JobQueue
  auth?: ValidateBearerOptions
  /** Drives the production-only loopback-http rejection on source.url (defaults to env). */
  nodeEnv?: string
  allowedSourceHosts?: string[]
  runPrepareImpl?: typeof runPrepare
  runRenderImpl?: typeof runRender
  runDevotionalRenderImpl?: typeof runDevotionalRender
}

function toStatusBody(job: JobRecord): JobStatusBody {
  return {
    workerJobId: job.workerJobId,
    kind: job.kind,
    status: job.status,
    progress: job.progress,
    message: job.message,
    error: job.error,
    result: job.result,
  }
}

export function createJobsRoute({
  queue,
  auth = {},
  nodeEnv = env.NODE_ENV,
  allowedSourceHosts = parseAllowedHosts(
    env.SHORTS_WORKER_ALLOWED_SOURCE_HOSTS,
  ),
  runPrepareImpl = runPrepare,
  runRenderImpl = runRender,
  runDevotionalRenderImpl = runDevotionalRender,
}: JobsRouteOptions) {
  function authorize(
    request: IncomingMessage,
    response: ServerResponse,
  ): boolean {
    const outcome = validateBearer(request.headers.authorization, auth)
    if (outcome === "ok") return true

    if (outcome === "config_missing") {
      sendJson(response, 503, { error: "config_missing" })
      return false
    }

    sendJson(response, 401, { error: "unauthorized" })
    return false
  }

  async function submitJob(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    let rawBody: unknown
    try {
      rawBody = await readJsonBody(request)
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        sendJson(response, 413, { error: "body_too_large" })
        return
      }
      if (
        error instanceof UnsupportedContentTypeError ||
        error instanceof InvalidJsonBodyError
      ) {
        sendJson(response, 400, { error: "invalid_body" })
        return
      }
      throw error
    }

    const parsed = jobRequestSchema.safeParse(rawBody)
    if (!parsed.success) {
      sendJson(response, 400, { error: "invalid_body" })
      return
    }
    const body = parsed.data

    // Pre-enqueue SSRF gate: reject a disallowed source with 400 instead of
    // burning a lane slot. runPrepare re-validates before any spawn —
    // defense in depth (plan decision 10).
    if (body.kind === "prepare") {
      try {
        validateSourceUrl(
          body.source.url,
          allowedSourceHosts,
          nodeEnv === "production",
        )
      } catch (error) {
        if (error instanceof SourceUrlRejectedError) {
          console.warn(
            `[shorts-worker] event=job_rejected reason=source_rejected kind=${body.kind} jobId=${body.jobId ?? "-"} assetId=${body.assetId}`,
          )
          sendJson(response, 400, { error: "invalid_body" })
          return
        }
        throw error
      }
    }

    const dedupeKey = jobDedupeKey(body)

    // The per-job deadline starts here at ENQUEUE time, not job start —
    // manager's poll budget includes queue wait, so the worker's deadline
    // must too. Budgets stay strictly below manager's poll ceilings (see
    // config/env.ts). On a dedupe hit the fresh deadline is discarded; the
    // running job keeps the deadline from its own enqueue.
    const deadline = createJobDeadline(
      body.kind === "prepare"
        ? env.SHORTS_WORKER_PREPARE_JOB_TIMEOUT_MS
        : env.SHORTS_WORKER_RENDER_JOB_TIMEOUT_MS,
    )

    const outcome =
      body.kind === "prepare"
        ? queue.submit("prepare", dedupeKey, async ({ onProgress }) =>
            runPrepareImpl({
              assetId: body.assetId,
              sourceUrl: body.source.url,
              clip: { startSec: body.clip.startSec, endSec: body.clip.endSec },
              language: body.transcription.language,
              deps: { deadline, allowedHosts: allowedSourceHosts, nodeEnv },
              onProgress,
            }),
          )
        : body.kind === "render"
          ? queue.submit("render", dedupeKey, async ({ onProgress }) =>
              runRenderImpl({
                assetId: body.assetId,
                propsHash: body.propsHash,
                draftVersion: body.draftVersion,
                props: body.props,
                deps: { deadline },
                onProgress,
              }),
            )
          : queue.submit(
              "devotional-render",
              dedupeKey,
              async ({ onProgress, signal }) =>
                runDevotionalRenderImpl({
                  runId: body.runId,
                  inputAssetId: body.inputAssetId,
                  outputAssetId: body.outputAssetId,
                  inputHash: body.inputHash,
                  deps: {
                    deadline,
                    allowedHosts: allowedSourceHosts,
                    nodeEnv,
                    signal,
                  },
                  onProgress,
                }),
            )

    if (!outcome.ok) {
      console.warn(
        `[shorts-worker] event=job_rejected reason=queue_full kind=${body.kind} jobId=${body.jobId ?? "-"}`,
      )
      sendJson(response, 409, { error: "queue_full" })
      return
    }

    if (outcome.deduped) {
      console.log(
        `[shorts-worker] event=job_deduped workerJobId=${outcome.job.workerJobId} kind=${body.kind} jobId=${body.jobId ?? "-"} assetId=${body.kind === "devotional-render" ? body.outputAssetId : body.assetId} status=${outcome.job.status}`,
      )
    } else {
      console.log(
        `[shorts-worker] event=job_submitted workerJobId=${outcome.job.workerJobId} kind=${body.kind} jobId=${body.jobId ?? "-"} assetId=${body.kind === "devotional-render" ? body.outputAssetId : body.assetId}`,
      )
    }
    // On a dedupe hit this re-attaches the caller to the ACTIVE job: same
    // workerJobId, current status ("queued" | "running"). Manager's submit
    // client accepts any known status on the 202 path.
    sendJson(response, 202, {
      workerJobId: outcome.job.workerJobId,
      status: outcome.job.status,
    })
  }

  return async function handleJobsRoute(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (request.method === "POST" && url.pathname === "/jobs") {
      if (!authorize(request, response)) return true
      await submitJob(request, response)
      return true
    }

    const match = /^\/jobs\/([^/]+)$/.exec(url.pathname)
    if (request.method === "DELETE" && match?.[1]) {
      if (!authorize(request, response)) return true
      const job = queue.cancel(decodeURIComponent(match[1]))
      if (!job) {
        sendJson(response, 404, { error: "not_found" })
        return true
      }
      sendJson(response, 202, {
        workerJobId: job.workerJobId,
        status: job.status,
      })
      return true
    }
    if (request.method === "GET" && match?.[1]) {
      if (!authorize(request, response)) return true

      const job = queue.get(decodeURIComponent(match[1]))
      if (!job) {
        sendJson(response, 404, { error: "not_found" })
        return true
      }

      sendJson(response, 200, toStatusBody(job))
      return true
    }

    return false
  }
}
